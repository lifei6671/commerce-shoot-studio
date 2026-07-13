use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client as BlockingClient;
use reqwest::header::CONTENT_TYPE;
use reqwest::{Client, Url};
use serde_json::{json, Value};
use tokio::sync::Notify;

use crate::domain::errors::{normalize_provider_http_error, ProviderTransportErrorKind};
use crate::infrastructure::providers::openai_compatible::normalize_openai_compatible_response;
use crate::infrastructure::providers::openai_images::{
    build_openai_image_edit_multipart, OpenAiMultipartBody,
};
use crate::services::model_config::{image_size_options, validate_image_size};
use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
};
use crate::services::provider_connection::{
    supports_seedream_single_image_options, VOLCENGINE_SEEDREAM_5_PRO_MODEL,
};

#[derive(Debug, Clone, Copy)]
pub struct HttpModelGatewayRequestConfig<'a> {
    pub endpoint_path: &'a str,
    pub model: &'a str,
    pub provider_profile_id: &'a str,
}

pub struct HttpModelGatewayAdapter {
    blocking_client: OnceLock<BlockingClient>,
    client: Client,
    concurrency_registry: ProviderConcurrencyRegistry,
    diagnostic_log_path: Option<PathBuf>,
}

/// Provider 限流在整个进程内共享，避免多个本地任务各自创建并发池。
#[derive(Clone, Default)]
pub struct ProviderConcurrencyRegistry {
    pools: Arc<Mutex<std::collections::HashMap<String, Arc<ProviderConcurrencyPool>>>>,
}

impl ProviderConcurrencyRegistry {
    fn pool(
        &self,
        provider_profile_id: &str,
        base_url: &str,
    ) -> Result<Arc<ProviderConcurrencyPool>, ModelGatewayError> {
        let local_origin = local_provider_origin(base_url);
        let (key, limit) = match local_origin {
            Some(origin) => (format!("local:{origin}"), 1),
            None => (
                format!("provider:{provider_profile_id}"),
                provider_concurrency_limit(provider_profile_id),
            ),
        };
        let mut pools = self.pools.lock().map_err(|_| {
            ModelGatewayError::ProviderUnavailable("Provider 并发控制不可用。".to_string())
        })?;
        Ok(pools
            .entry(key)
            .or_insert_with(|| Arc::new(ProviderConcurrencyPool::new(limit)))
            .clone())
    }

    async fn acquire(
        &self,
        provider_profile_id: &str,
        base_url: &str,
    ) -> Result<ProviderConcurrencyPermit, ModelGatewayError> {
        self.pool(provider_profile_id, base_url)?.acquire().await
    }

    fn acquire_blocking(
        &self,
        provider_profile_id: &str,
        base_url: &str,
    ) -> Result<ProviderConcurrencyPermit, ModelGatewayError> {
        self.pool(provider_profile_id, base_url)?.acquire_blocking()
    }
}

struct ProviderConcurrencyPool {
    available: Mutex<usize>,
    blocking_waiters: Condvar,
    async_waiters: Notify,
    #[cfg(test)]
    async_acquire_test_hook: Mutex<Option<Arc<ProviderAsyncAcquireTestHook>>>,
}

#[cfg(test)]
struct ProviderAsyncAcquireTestHook {
    reached_empty_check: tokio::sync::Barrier,
    continue_to_wait: tokio::sync::Barrier,
}

impl ProviderConcurrencyPool {
    fn new(limit: usize) -> Self {
        Self {
            available: Mutex::new(limit),
            blocking_waiters: Condvar::new(),
            async_waiters: Notify::new(),
            #[cfg(test)]
            async_acquire_test_hook: Mutex::new(None),
        }
    }

    async fn acquire(self: &Arc<Self>) -> Result<ProviderConcurrencyPermit, ModelGatewayError> {
        loop {
            let notified = self.async_waiters.notified();
            tokio::pin!(notified);
            // 多等待者先注册通知再检查容量，避免连续 notify_one 合并后遗漏唤醒。
            notified.as_mut().enable();
            {
                let mut available = self.available.lock().map_err(|_| {
                    ModelGatewayError::ProviderUnavailable("Provider 并发控制不可用。".to_string())
                })?;
                if *available > 0 {
                    *available -= 1;
                    return Ok(ProviderConcurrencyPermit { pool: self.clone() });
                }
            }
            #[cfg(test)]
            self.pause_async_acquire_after_empty_check().await;
            notified.await;
        }
    }

    #[cfg(test)]
    async fn pause_async_acquire_after_empty_check(&self) {
        let hook = self
            .async_acquire_test_hook
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if let Some(hook) = hook {
            hook.reached_empty_check.wait().await;
            hook.continue_to_wait.wait().await;
        }
    }

    fn acquire_blocking(self: &Arc<Self>) -> Result<ProviderConcurrencyPermit, ModelGatewayError> {
        let mut available = self.available.lock().map_err(|_| {
            ModelGatewayError::ProviderUnavailable("Provider 并发控制不可用。".to_string())
        })?;
        while *available == 0 {
            available = self.blocking_waiters.wait(available).map_err(|_| {
                ModelGatewayError::ProviderUnavailable("Provider 并发控制不可用。".to_string())
            })?;
        }
        *available -= 1;
        Ok(ProviderConcurrencyPermit { pool: self.clone() })
    }
}

struct ProviderConcurrencyPermit {
    pool: Arc<ProviderConcurrencyPool>,
}

pub(crate) struct ProviderInvocationLease {
    _permit: ProviderConcurrencyPermit,
}

pub struct LeasedModelGatewayAdapterResult {
    result: ModelGatewayAdapterResult,
    lease: ProviderInvocationLease,
}

impl LeasedModelGatewayAdapterResult {
    pub(crate) fn into_parts(self) -> (ModelGatewayAdapterResult, ProviderInvocationLease) {
        (self.result, self.lease)
    }

    fn into_result(self) -> ModelGatewayAdapterResult {
        self.result
    }
}

impl std::ops::Deref for LeasedModelGatewayAdapterResult {
    type Target = ModelGatewayAdapterResult;

    fn deref(&self) -> &Self::Target {
        &self.result
    }
}

impl Drop for ProviderConcurrencyPermit {
    fn drop(&mut self) {
        let mut available = self
            .pool
            .available
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *available += 1;
        drop(available);
        self.pool.blocking_waiters.notify_one();
        self.pool.async_waiters.notify_one();
    }
}

fn shared_provider_concurrency_registry() -> ProviderConcurrencyRegistry {
    static REGISTRY: OnceLock<ProviderConcurrencyRegistry> = OnceLock::new();
    REGISTRY
        .get_or_init(ProviderConcurrencyRegistry::default)
        .clone()
}

impl HttpModelGatewayAdapter {
    pub fn new(diagnostic_log_path: Option<PathBuf>) -> Result<Self, ModelGatewayError> {
        Ok(Self {
            blocking_client: OnceLock::new(),
            client: shared_async_http_client()?,
            concurrency_registry: shared_provider_concurrency_registry(),
            diagnostic_log_path,
        })
    }

    pub fn with_concurrency_registry(
        diagnostic_log_path: Option<PathBuf>,
        concurrency_registry: ProviderConcurrencyRegistry,
    ) -> Result<Self, ModelGatewayError> {
        let mut adapter = Self::new(diagnostic_log_path)?;
        adapter.concurrency_registry = concurrency_registry;
        Ok(adapter)
    }

    fn write_diagnostic(&self, payload: Value) {
        let Some(path) = self.diagnostic_log_path.as_deref() else {
            return;
        };
        eprintln!("[model-gateway-diagnostics] {payload}");
        let _ = append_diagnostic_json_line(path, payload);
    }

    fn blocking_client(&self) -> Result<&BlockingClient, ModelGatewayError> {
        if let Some(client) = self.blocking_client.get() {
            return Ok(client);
        }
        let client = BlockingClient::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| {
                ModelGatewayError::ProviderUnavailable("Provider 客户端初始化失败。".to_string())
            })?;
        let _ = self.blocking_client.set(client);
        self.blocking_client.get().ok_or_else(|| {
            ModelGatewayError::ProviderUnavailable("Provider 客户端初始化失败。".to_string())
        })
    }

    /// 真实 Provider 调用使用 async reqwest，并在完整 HTTP 生命周期内持有 Provider permit。
    pub async fn invoke_async(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<LeasedModelGatewayAdapterResult, ModelGatewayError> {
        let api_key = request
            .api_key
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ModelGatewayError::ProviderUnavailable("模型配置缺少 API Key。".to_string())
            })?;
        let endpoint = provider_endpoint(request.base_url, request.endpoint_path)?;
        let request_config = HttpModelGatewayRequestConfig {
            endpoint_path: request.endpoint_path,
            model: request.model,
            provider_profile_id: request.provider_profile_id,
        };
        let request_body = if uses_openai_image_edit(&request_config) {
            GatewayRequestBody::Multipart(build_openai_image_edit_multipart(
                request.model,
                request.input,
            )?)
        } else {
            GatewayRequestBody::Json(build_model_gateway_request_body(
                &request_config,
                request.input,
            )?)
        };
        write_debug_prompt_to_stderr(&request);
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "request",
            "capabilityId": request.capability_id,
            "request": request_body.diagnostic(&request_config),
        }));

        let permit = self
            .concurrency_registry
            .acquire(request.provider_profile_id, request.base_url)
            .await?;
        let request_started_at = Instant::now();
        let response = match self
            .client
            .post(endpoint)
            .bearer_auth(api_key)
            .header(CONTENT_TYPE, request_body.content_type())
            .timeout(model_gateway_request_timeout(
                request.provider_profile_id,
                request.capability_id,
            ))
            .body(request_body.into_bytes())
            .send()
            .await
        {
            Ok(response) => response,
            Err(source) => {
                let kind = if source.is_timeout() {
                    ProviderTransportErrorKind::Timeout
                } else {
                    ProviderTransportErrorKind::Network
                };
                let elapsed_ms = request_started_at.elapsed().as_millis();
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "request_error",
                    "elapsedMs": elapsed_ms,
                    "elapsed": format_elapsed_duration(elapsed_ms),
                    "isTimeout": source.is_timeout(),
                    "transportKind": transport_kind_for_diagnostic(kind),
                }));
                return Err(ModelGatewayError::ProviderTransport(kind));
            }
        };
        let status_code = i64::from(response.status().as_u16());
        let success = response.status().is_success();
        let response_text = response.text().await.map_err(|_| {
            ModelGatewayError::ProviderUnavailable("读取 Provider 响应失败。".to_string())
        })?;
        if !success {
            let error = provider_http_error(status_code, &response_text);
            self.write_diagnostic(response_diagnostic_payload(
                "response",
                request_started_at.elapsed().as_millis(),
                status_code,
                false,
                &response_text,
                provider_http_error_code(&error),
            ));
            return Err(error);
        }
        self.write_diagnostic(response_diagnostic_payload(
            "response",
            request_started_at.elapsed().as_millis(),
            status_code,
            true,
            &response_text,
            None,
        ));
        let response_json: Value = serde_json::from_str(&response_text).map_err(|_| {
            self.write_diagnostic(json!({
                "timestampMs": current_timestamp_ms(),
                "event": "response_parse_failed",
                "responseByteLength": response_text.len(),
            }));
            ModelGatewayError::ProviderUnavailable("Provider 返回的 JSON 无法解析。".to_string())
        })?;
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "response_shape",
            "shape": summarize_provider_response_shape(&response_json),
        }));
        let normalized =
            normalize_openai_compatible_response(&response_json).map_err(|source| {
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "response_normalize_failed",
                    "shape": summarize_provider_response_shape(&response_json),
                }));
                ModelGatewayError::ProviderUnavailable(source.to_string())
            })?;
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "normalized_response",
            "hasOutputText": normalized.output_text.is_some(),
            "outputShape": summarize_provider_response_shape(&normalized.output_json),
            "usageJson": normalized.usage_json.clone(),
        }));

        let result = ModelGatewayAdapterResult {
            output_text: normalized.output_text,
            output_json: normalized.output_json,
            usage_json: Some(normalized.usage_json),
        };
        write_debug_normalized_result_to_stderr(&request, &result);
        Ok(LeasedModelGatewayAdapterResult {
            result,
            lease: ProviderInvocationLease { _permit: permit },
        })
    }

    pub fn invoke_stream<F>(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
        mut on_delta: F,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError>
    where
        F: FnMut(&str) -> Result<(), ModelGatewayError>,
    {
        let api_key = request
            .api_key
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ModelGatewayError::ProviderUnavailable("模型配置缺少 API Key。".to_string())
            })?;
        let endpoint = provider_endpoint(request.base_url, request.endpoint_path)?;
        let request_body = build_model_gateway_stream_request_body(
            &HttpModelGatewayRequestConfig {
                endpoint_path: request.endpoint_path,
                model: request.model,
                provider_profile_id: request.provider_profile_id,
            },
            request.input,
        )?;
        write_debug_prompt_to_stderr(&request);
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "stream_request",
            "capabilityId": request.capability_id,
            "request": sanitize_model_gateway_request_for_diagnostics(
                &HttpModelGatewayRequestConfig {
                    endpoint_path: request.endpoint_path,
                    model: request.model,
                    provider_profile_id: request.provider_profile_id,
                },
                &request_body,
            ),
        }));
        let _permit = self
            .concurrency_registry
            .acquire_blocking(request.provider_profile_id, request.base_url)?;
        let request_started_at = Instant::now();
        let mut response = match self
            .blocking_client()?
            .post(endpoint)
            .bearer_auth(api_key)
            .header(CONTENT_TYPE, "application/json")
            .timeout(model_gateway_request_timeout(
                request.provider_profile_id,
                request.capability_id,
            ))
            .body(request_body.to_string())
            .send()
        {
            Ok(response) => response,
            Err(source) => {
                let kind = if source.is_timeout() {
                    ProviderTransportErrorKind::Timeout
                } else {
                    ProviderTransportErrorKind::Network
                };
                let elapsed_ms = request_started_at.elapsed().as_millis();
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "request_error",
                    "elapsedMs": elapsed_ms,
                    "elapsed": format_elapsed_duration(elapsed_ms),
                    "isTimeout": source.is_timeout(),
                    "transportKind": transport_kind_for_diagnostic(kind),
                }));
                return Err(ModelGatewayError::ProviderTransport(kind));
            }
        };
        let status = response.status();
        let status_code = i64::from(status.as_u16());
        if !status.is_success() {
            let response_text = response.text().unwrap_or_default();
            let error = provider_http_error(status_code, &response_text);
            self.write_diagnostic(response_diagnostic_payload(
                "stream_response_error",
                request_started_at.elapsed().as_millis(),
                status_code,
                false,
                &response_text,
                provider_http_error_code(&error),
            ));
            return Err(error);
        }
        let elapsed_ms = request_started_at.elapsed().as_millis();
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "stream_response_status",
            "elapsedMs": elapsed_ms,
            "elapsed": format_elapsed_duration(elapsed_ms),
            "status": status_code,
            "success": true,
        }));

        let mut pending = Vec::new();
        let mut output_text = String::new();
        let mut completed_response: Option<Value> = None;
        let mut buffer = [0_u8; 8192];

        loop {
            let bytes_read = response.read(&mut buffer).map_err(|_| {
                ModelGatewayError::ProviderUnavailable("读取 Provider 流式响应失败。".to_string())
            })?;
            if bytes_read == 0 {
                break;
            }

            pending.extend_from_slice(&buffer[..bytes_read]);
            for block in drain_complete_sse_blocks(&mut pending)? {
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "stream_response_block",
                    "blockByteLength": block.len(),
                }));
                if let Some(event) = parse_model_gateway_sse_event(&block) {
                    match event {
                        ModelGatewaySseEvent::Delta(delta) => {
                            if !delta.is_empty() {
                                on_delta(&delta)?;
                                output_text.push_str(&delta);
                            }
                        }
                        ModelGatewaySseEvent::DoneText(text) => {
                            if output_text.is_empty() {
                                output_text = text;
                            }
                        }
                        ModelGatewaySseEvent::Completed(response) => {
                            completed_response = Some(response);
                        }
                    }
                }
            }
        }

        if !pending.iter().all(u8::is_ascii_whitespace) {
            let pending = std::str::from_utf8(&pending).map_err(|_| {
                ModelGatewayError::ProviderUnavailable(
                    "Provider 流式响应包含无效 UTF-8 数据。".to_string(),
                )
            })?;
            if let Some(event) = parse_model_gateway_sse_event(pending) {
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "stream_response_tail",
                    "blockByteLength": pending.len(),
                }));
                match event {
                    ModelGatewaySseEvent::Delta(delta) => {
                        on_delta(&delta)?;
                        output_text.push_str(&delta);
                    }
                    ModelGatewaySseEvent::DoneText(text) => {
                        if output_text.is_empty() {
                            output_text = text;
                        }
                    }
                    ModelGatewaySseEvent::Completed(response) => {
                        completed_response = Some(response);
                    }
                }
            }
        }

        let usage_json = completed_response
            .as_ref()
            .and_then(|response| normalize_openai_compatible_response(response).ok())
            .map(|normalized| normalized.usage_json)
            .unwrap_or_else(|| {
                json!({
                    "stream": true,
                })
            });

        if output_text.trim().is_empty() {
            if let Some(response) = completed_response {
                let normalized = normalize_openai_compatible_response(&response)
                    .map_err(|source| ModelGatewayError::ProviderUnavailable(source.to_string()))?;
                output_text = normalized.output_text.unwrap_or_default();
            }
        }

        if output_text.trim().is_empty() {
            return Err(ModelGatewayError::ProviderUnavailable(
                "Provider 流式响应没有返回可用文本。".to_string(),
            ));
        }
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "stream_output_text",
            "outputTextCharCount": output_text.chars().count(),
        }));

        let result = ModelGatewayAdapterResult {
            output_text: Some(output_text),
            output_json: json!({
                "type": "text",
                "stream": true,
            }),
            usage_json: Some(usage_json),
        };
        write_debug_normalized_result_to_stderr(&request, &result);
        Ok(result)
    }
}

impl HttpModelGatewayAdapter {
    pub fn invoke_blocking_leased(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<LeasedModelGatewayAdapterResult, ModelGatewayError> {
        let api_key = request
            .api_key
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ModelGatewayError::ProviderUnavailable("模型配置缺少 API Key。".to_string())
            })?;
        let endpoint = provider_endpoint(request.base_url, request.endpoint_path)?;
        let request_config = HttpModelGatewayRequestConfig {
            endpoint_path: request.endpoint_path,
            model: request.model,
            provider_profile_id: request.provider_profile_id,
        };
        let request_body = if uses_openai_image_edit(&request_config) {
            GatewayRequestBody::Multipart(build_openai_image_edit_multipart(
                request.model,
                request.input,
            )?)
        } else {
            GatewayRequestBody::Json(build_model_gateway_request_body(
                &request_config,
                request.input,
            )?)
        };
        write_debug_prompt_to_stderr(&request);
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "request",
            "capabilityId": request.capability_id,
            "request": request_body.diagnostic(&request_config),
        }));
        let permit = self
            .concurrency_registry
            .acquire_blocking(request.provider_profile_id, request.base_url)?;
        let request_started_at = Instant::now();
        let response = match self
            .blocking_client()?
            .post(endpoint)
            .bearer_auth(api_key)
            .header(CONTENT_TYPE, request_body.content_type())
            .timeout(model_gateway_request_timeout(
                request.provider_profile_id,
                request.capability_id,
            ))
            .body(request_body.into_bytes())
            .send()
        {
            Ok(response) => response,
            Err(source) => {
                let kind = if source.is_timeout() {
                    ProviderTransportErrorKind::Timeout
                } else {
                    ProviderTransportErrorKind::Network
                };
                let elapsed_ms = request_started_at.elapsed().as_millis();
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "request_error",
                    "elapsedMs": elapsed_ms,
                    "elapsed": format_elapsed_duration(elapsed_ms),
                    "isTimeout": source.is_timeout(),
                    "transportKind": transport_kind_for_diagnostic(kind),
                }));
                return Err(ModelGatewayError::ProviderTransport(kind));
            }
        };
        let status = response.status();
        let status_code = i64::from(status.as_u16());
        let response_text_result = response.text();
        if !status.is_success() {
            let response_text = response_text_result.unwrap_or_default();
            let error = provider_http_error(status_code, &response_text);
            self.write_diagnostic(response_diagnostic_payload(
                "response",
                request_started_at.elapsed().as_millis(),
                status_code,
                false,
                &response_text,
                provider_http_error_code(&error),
            ));
            return Err(error);
        }
        let response_text = response_text_result.map_err(|_| {
            ModelGatewayError::ProviderUnavailable("读取 Provider 响应失败。".to_string())
        })?;
        self.write_diagnostic(response_diagnostic_payload(
            "response",
            request_started_at.elapsed().as_millis(),
            status_code,
            true,
            &response_text,
            None,
        ));
        let response_json: Value = serde_json::from_str(&response_text).map_err(|_| {
            self.write_diagnostic(json!({
                "timestampMs": current_timestamp_ms(),
                "event": "response_parse_failed",
                "responseByteLength": response_text.len(),
            }));
            ModelGatewayError::ProviderUnavailable("Provider 返回的 JSON 无法解析。".to_string())
        })?;
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "response_shape",
            "shape": summarize_provider_response_shape(&response_json),
        }));
        let normalized =
            normalize_openai_compatible_response(&response_json).map_err(|source| {
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "response_normalize_failed",
                    "shape": summarize_provider_response_shape(&response_json),
                }));
                ModelGatewayError::ProviderUnavailable(source.to_string())
            })?;
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "normalized_response",
            "hasOutputText": normalized.output_text.is_some(),
            "outputShape": summarize_provider_response_shape(&normalized.output_json),
            "usageJson": normalized.usage_json.clone(),
        }));

        let result = ModelGatewayAdapterResult {
            output_text: normalized.output_text,
            output_json: normalized.output_json,
            usage_json: Some(normalized.usage_json),
        };
        write_debug_normalized_result_to_stderr(&request, &result);
        Ok(LeasedModelGatewayAdapterResult {
            result,
            lease: ProviderInvocationLease { _permit: permit },
        })
    }
}

impl ModelGatewayAdapter for HttpModelGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        self.invoke_blocking_leased(request)
            .map(LeasedModelGatewayAdapterResult::into_result)
    }
}

fn shared_async_http_client() -> Result<Client, ModelGatewayError> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| {
            ModelGatewayError::ProviderUnavailable("Provider 异步客户端初始化失败。".to_string())
        })?;
    let _ = CLIENT.set(client);
    CLIENT.get().cloned().ok_or_else(|| {
        ModelGatewayError::ProviderUnavailable("Provider 异步客户端初始化失败。".to_string())
    })
}

fn provider_concurrency_limit(provider_profile_id: &str) -> usize {
    match provider_profile_id {
        "openai" | "volcengine" => 3,
        "deepseek" | "mock-local" => 4,
        _ => 1,
    }
}

fn local_provider_origin(base_url: &str) -> Option<String> {
    let url = Url::parse(base_url).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let normalized_host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(&host);
    matches!(normalized_host, "localhost" | "127.0.0.1" | "::1")
        .then(|| url.origin().ascii_serialization())
}

enum GatewayRequestBody {
    Json(Value),
    Multipart(OpenAiMultipartBody),
}

impl GatewayRequestBody {
    fn content_type(&self) -> &str {
        match self {
            Self::Json(_) => "application/json",
            Self::Multipart(body) => &body.content_type,
        }
    }

    fn into_bytes(self) -> Vec<u8> {
        match self {
            Self::Json(body) => body.to_string().into_bytes(),
            Self::Multipart(body) => body.body,
        }
    }

    fn diagnostic(&self, config: &HttpModelGatewayRequestConfig<'_>) -> Value {
        match self {
            Self::Json(body) => sanitize_model_gateway_request_for_diagnostics(config, body),
            Self::Multipart(body) => json!({
                "providerProfileId": config.provider_profile_id,
                "model": config.model,
                "multipart": {
                    "contentType": "multipart/form-data",
                    "bodyByteLength": body.body.len(),
                },
            }),
        }
    }
}

pub fn build_model_gateway_request_body(
    config: &HttpModelGatewayRequestConfig<'_>,
    input: &Value,
) -> Result<Value, ModelGatewayError> {
    let prompt = parse_prompt(input)?;
    let images = parse_user_images(input)?;
    let max_output_tokens = input
        .get("maxOutputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(2000);

    if uses_responses_api(config.provider_profile_id, config.endpoint_path) {
        let mut body = json!({
            "model": config.model,
            "input": responses_input(&images, &prompt.user),
            "max_output_tokens": max_output_tokens,
        });
        if !prompt.system.trim().is_empty() {
            body["instructions"] = Value::String(prompt.system);
        }
        if config.provider_profile_id == "volcengine" {
            body["thinking"] = json!({
                "type": "disabled",
            });
        }
        return Ok(body);
    }

    if config.endpoint_path.contains("/chat/completions") {
        return Ok(json!({
            "model": config.model,
            "messages": chat_completion_messages(&prompt, &images),
            "max_tokens": max_output_tokens,
            "temperature": 0.2,
        }));
    }

    if config.provider_profile_id == "openai"
        && config.endpoint_path.contains("/images/generations")
    {
        if input.get("kind").and_then(Value::as_str) != Some("clothing-base-model-generation") {
            return Err(ModelGatewayError::ProviderRequestInvalid(
                "OpenAI 文生图当前仅支持服饰基准模特生成。".to_string(),
            ));
        }
        if !images.is_empty() {
            return Err(ModelGatewayError::ProviderRequestInvalid(
                "OpenAI 服饰基准模特生成不支持参考图。".to_string(),
            ));
        }
        return Ok(json!({
            "model": config.model,
            "prompt": prompt.roleless,
            "size": "1024x1536",
        }));
    }

    if config.provider_profile_id == "volcengine"
        && config.endpoint_path.contains("/images/generations")
    {
        let explicit_size = input
            .get("size")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let scene_ratio = if input.get("kind").and_then(Value::as_str)
            == Some("scene-image-generation")
        {
            Some(input.get("ratio").and_then(Value::as_str).ok_or_else(|| {
                ModelGatewayError::ProviderRequestInvalid("场景生图任务缺少图片比例。".to_string())
            })?)
        } else {
            None
        };
        if let Some(size) = explicit_size {
            validate_image_size(config.provider_profile_id, config.model, size).map_err(|_| {
                ModelGatewayError::ProviderRequestInvalid(
                    "当前火山引擎模型不支持所选图片尺寸。".to_string(),
                )
            })?;
            if let Some(ratio) = scene_ratio {
                let size_ratio = image_size_options(config.provider_profile_id, config.model)
                    .into_iter()
                    .find(|option| option.provider_value == size)
                    .map(|option| option.ratio)
                    .ok_or_else(|| {
                        ModelGatewayError::ProviderRequestInvalid(
                            "当前火山引擎模型不支持所选图片尺寸。".to_string(),
                        )
                    })?;
                if size_ratio != ratio {
                    return Err(ModelGatewayError::ProviderRequestInvalid(
                        "场景图片尺寸必须与任务比例一致。".to_string(),
                    ));
                }
            }
        }
        let mapped_scene_size = if explicit_size.is_none() {
            if let Some(ratio) = scene_ratio {
                let options = image_size_options(config.provider_profile_id, config.model);
                let matching_option = if config.model == VOLCENGINE_SEEDREAM_5_PRO_MODEL {
                    // Pro 尺寸表按 1K、2K 排列；真实生成默认使用同一比例的 2K 档。
                    options.iter().rev().find(|option| option.ratio == ratio)
                } else {
                    options.iter().find(|option| option.ratio == ratio)
                };
                Some(
                    matching_option
                        .ok_or_else(|| {
                            ModelGatewayError::ProviderRequestInvalid(
                                "当前火山引擎模型不支持所选场景图片比例。".to_string(),
                            )
                        })?
                        .provider_value
                        .clone(),
                )
            } else {
                None
            }
        } else {
            None
        };
        let mut body = json!({
            "model": config.model,
            "prompt": prompt.roleless,
            "size": explicit_size
                .map(str::to_string)
                .or(mapped_scene_size)
                .unwrap_or_else(|| "2K".to_string()),
            "response_format": "url",
            "watermark": false,
        });
        if supports_seedream_single_image_options(config.model) {
            body["sequential_image_generation"] = Value::String("disabled".to_string());
            body["stream"] = Value::Bool(false);
        }
        match images.as_slice() {
            [] => {}
            [image] => {
                body["image"] = Value::String(image.clone());
            }
            _ => {
                body["image"] = Value::Array(images.into_iter().map(Value::String).collect());
            }
        }
        return Ok(body);
    }

    let body = json!({
        "model": config.model,
        "prompt": prompt.roleless,
        "images": images,
        "max_tokens": max_output_tokens,
        "temperature": 0.2,
    });

    Ok(body)
}

pub fn build_model_gateway_stream_request_body(
    config: &HttpModelGatewayRequestConfig<'_>,
    input: &Value,
) -> Result<Value, ModelGatewayError> {
    let mut body = build_model_gateway_request_body(config, input)?;
    body["stream"] = Value::Bool(true);
    Ok(body)
}

pub fn model_gateway_request_timeout(provider_profile_id: &str, capability_id: &str) -> Duration {
    if provider_profile_id == "volcengine"
        && matches!(
            capability_id,
            "clothing-base-model-generation"
                | "scene-image-generation"
                | "product-detail-generation"
                | "clothing-tryon-generation"
                | "image-edit"
        )
    {
        return Duration::from_secs(300);
    }
    if capability_id == "prompt-plan" {
        return Duration::from_secs(300);
    }
    if capability_id == "clothing-scene-planning" {
        return Duration::from_secs(90);
    }
    if matches!(capability_id, "clothing-tryon-generation" | "image-edit") {
        return Duration::from_secs(60);
    }
    Duration::from_secs(90)
}

#[derive(Debug, Clone, PartialEq)]
pub enum ModelGatewaySseEvent {
    Delta(String),
    DoneText(String),
    Completed(Value),
}

pub fn parse_model_gateway_sse_event(block: &str) -> Option<ModelGatewaySseEvent> {
    let data = block
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }

    let value: Value = serde_json::from_str(data).ok()?;
    match value.get("type").and_then(Value::as_str) {
        Some("response.output_text.delta") => value
            .get("delta")
            .and_then(Value::as_str)
            .map(|delta| ModelGatewaySseEvent::Delta(delta.to_string())),
        Some("response.output_text.done") => value
            .get("text")
            .and_then(Value::as_str)
            .map(|text| ModelGatewaySseEvent::DoneText(text.to_string())),
        Some("response.completed") => value
            .get("response")
            .cloned()
            .map(ModelGatewaySseEvent::Completed),
        _ => None,
    }
}

pub fn sanitize_model_gateway_request_for_diagnostics(
    config: &HttpModelGatewayRequestConfig<'_>,
    body: &Value,
) -> Value {
    json!({
        "providerProfileId": config.provider_profile_id,
        "model": config.model,
        "body": sanitize_diagnostic_value(None, body),
    })
}

#[cfg(debug_assertions)]
fn write_debug_prompt_to_stderr(request: &ModelGatewayAdapterRequest<'_>) {
    let debug_flag = std::env::var("COMMERCE_SHOOT_STUDIO_DEBUG_PROMPTS").ok();
    if let Some(payload) = debug_prompt_payload(
        debug_flag.as_deref(),
        request.capability_id,
        request.provider_profile_id,
        request.input,
    ) {
        eprintln!("[model-gateway-debug-prompt] {payload}");
    }
}

#[cfg(not(debug_assertions))]
fn write_debug_prompt_to_stderr(_: &ModelGatewayAdapterRequest<'_>) {}

#[cfg(debug_assertions)]
fn write_debug_normalized_result_to_stderr(
    request: &ModelGatewayAdapterRequest<'_>,
    result: &ModelGatewayAdapterResult,
) {
    let debug_flag = std::env::var("COMMERCE_SHOOT_STUDIO_DEBUG_PROMPTS").ok();
    if let Some(payload) = debug_normalized_result_payload(
        debug_flag.as_deref(),
        request.capability_id,
        request.provider_profile_id,
        request.model,
        result,
    ) {
        eprintln!("[model-gateway-debug-result] {payload}");
    }
}

#[cfg(not(debug_assertions))]
fn write_debug_normalized_result_to_stderr(
    _: &ModelGatewayAdapterRequest<'_>,
    _: &ModelGatewayAdapterResult,
) {
}

#[cfg(debug_assertions)]
fn debug_normalized_result_payload(
    debug_flag: Option<&str>,
    capability_id: &str,
    provider_profile_id: &str,
    model: &str,
    result: &ModelGatewayAdapterResult,
) -> Option<Value> {
    if debug_flag != Some("1") {
        return None;
    }
    Some(json!({
        "capabilityId": capability_id,
        "providerProfileId": provider_profile_id,
        "model": model,
        "status": "normalized",
        "outputTextCharCount": result.output_text.as_deref().map(|text| text.chars().count()),
        "outputJson": sanitize_debug_result_value(None, &result.output_json),
        "usageJson": result.usage_json,
    }))
}

#[cfg(debug_assertions)]
fn sanitize_debug_result_value(key: Option<&str>, value: &Value) -> Value {
    let normalized_key = key.unwrap_or_default().to_ascii_lowercase();
    if matches!(
        normalized_key.as_str(),
        "authorization" | "cookie" | "set-cookie" | "api_key" | "apikey" | "secret"
    ) {
        return Value::String("<omitted:sensitive>".to_string());
    }
    if normalized_key == "url" || normalized_key.ends_with("_url") {
        return json!({
            "type": "url",
            "charCount": value.as_str().map(str::len).unwrap_or(0),
        });
    }
    if matches!(
        normalized_key.as_str(),
        "dataurl" | "data_url" | "b64_json" | "base64" | "image_data"
    ) {
        return json!({
            "type": "image-data",
            "charCount": value.as_str().map(str::len).unwrap_or(0),
        });
    }

    match value {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| sanitize_debug_result_value(None, item))
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(child_key, child_value)| {
                    (
                        child_key.clone(),
                        sanitize_debug_result_value(Some(child_key), child_value),
                    )
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}

#[cfg(debug_assertions)]
fn debug_prompt_payload(
    debug_flag: Option<&str>,
    capability_id: &str,
    provider_profile_id: &str,
    input: &Value,
) -> Option<Value> {
    if debug_flag != Some("1") {
        return None;
    }
    let prompt = parse_prompt(input).ok()?;
    Some(json!({
        "capabilityId": capability_id,
        "providerProfileId": provider_profile_id,
        "systemPrompt": prompt.system,
        "userPrompt": prompt.user,
        "rolelessPrompt": prompt.roleless,
    }))
}

#[derive(Debug, Clone)]
struct PromptPayload {
    roleless: String,
    system: String,
    user: String,
}

fn parse_prompt(input: &Value) -> Result<PromptPayload, ModelGatewayError> {
    let prompt = input.get("prompt").ok_or_else(|| {
        ModelGatewayError::ProviderUnavailable("模型输入缺少 prompt。".to_string())
    })?;
    let messages = prompt
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ModelGatewayError::ProviderUnavailable("模型输入缺少 prompt messages。".to_string())
        })?;
    let system = message_content(messages, "system").unwrap_or_default();
    let user = message_content(messages, "user")
        .unwrap_or_else(|| "请根据上传图片识别商品信息。".to_string());
    let roleless = prompt
        .get("rolelessPrompt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("【应用规则】\n{system}\n\n【用户任务】\n{user}"));

    Ok(PromptPayload {
        roleless,
        system,
        user,
    })
}

fn message_content(messages: &[Value], role: &str) -> Option<String> {
    messages
        .iter()
        .find(|message| message.get("role").and_then(Value::as_str) == Some(role))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn parse_user_images(input: &Value) -> Result<Vec<String>, ModelGatewayError> {
    let Some(images) = input.get("userImages").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let data_urls = images
        .iter()
        .filter_map(|image| image.get("dataUrl").and_then(Value::as_str))
        .filter(|data_url| !data_url.trim().is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    Ok(data_urls)
}

fn uses_responses_api(provider_profile_id: &str, endpoint_path: &str) -> bool {
    endpoint_path.contains("/responses")
        || (provider_profile_id == "volcengine" && endpoint_path == "/responses")
}

fn uses_openai_image_edit(config: &HttpModelGatewayRequestConfig<'_>) -> bool {
    config.provider_profile_id == "openai" && config.endpoint_path.contains("/images/edits")
}

fn responses_input(images: &[String], user_prompt: &str) -> Value {
    let mut user_content = images
        .iter()
        .map(|image| {
            json!({
                "type": "input_image",
                "image_url": image,
            })
        })
        .collect::<Vec<_>>();
    user_content.push(json!({
        "type": "input_text",
        "text": user_prompt,
    }));
    Value::Array(vec![json!({
        "role": "user",
        "content": user_content,
    })])
}

fn chat_completion_messages(prompt: &PromptPayload, images: &[String]) -> Value {
    let mut messages = Vec::new();
    if !prompt.system.trim().is_empty() {
        messages.push(json!({
            "role": "system",
            "content": prompt.system,
        }));
    }

    if images.is_empty() {
        messages.push(json!({
            "role": "user",
            "content": prompt.user,
        }));
    } else {
        let mut user_content = vec![json!({
            "type": "text",
            "text": prompt.user,
        })];
        user_content.extend(images.iter().map(|image| {
            json!({
                "type": "image_url",
                "image_url": {
                    "url": image,
                },
            })
        }));
        messages.push(json!({
            "role": "user",
            "content": user_content,
        }));
    }

    Value::Array(messages)
}

fn provider_endpoint(base_url: &str, path: &str) -> Result<Url, ModelGatewayError> {
    if !path.starts_with('/') {
        return Err(ModelGatewayError::ProviderUnavailable(
            "Provider 接入路径必须以 / 开头。".to_string(),
        ));
    }
    let endpoint = format!("{}{}", base_url.trim_end_matches('/'), path);
    let url = Url::parse(&endpoint).map_err(|_| {
        ModelGatewayError::ProviderUnavailable("Provider 接入点不是有效 URL。".to_string())
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ModelGatewayError::ProviderUnavailable(
            "Provider 接入点只允许 http 或 https。".to_string(),
        ));
    }
    Ok(url)
}

fn provider_http_error(status_code: i64, response_body: &str) -> ModelGatewayError {
    let raw_error_code = serde_json::from_str::<Value>(response_body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/code")
                .or_else(|| value.get("code"))
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    let provider_error_code =
        normalize_provider_http_error(status_code, raw_error_code.as_deref()).provider_error_code;

    ModelGatewayError::ProviderHttp {
        status_code,
        provider_error_code,
    }
}

fn provider_http_error_code(error: &ModelGatewayError) -> Option<&str> {
    match error {
        ModelGatewayError::ProviderHttp {
            provider_error_code,
            ..
        } => provider_error_code.as_deref(),
        _ => None,
    }
}

fn response_diagnostic_payload(
    event: &str,
    elapsed_ms: u128,
    status_code: i64,
    success: bool,
    response_body: &str,
    provider_error_code: Option<&str>,
) -> Value {
    json!({
        "timestampMs": current_timestamp_ms(),
        "event": event,
        "elapsedMs": elapsed_ms,
        "elapsed": format_elapsed_duration(elapsed_ms),
        "status": status_code,
        "success": success,
        "responseByteLength": response_body.len(),
        "providerErrorCode": provider_error_code,
    })
}

fn format_elapsed_duration(elapsed_ms: u128) -> String {
    let total_seconds = elapsed_ms / 1_000;
    let milliseconds = elapsed_ms % 1_000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;

    if minutes > 0 {
        format!("{minutes}m {seconds}.{milliseconds:03}s")
    } else {
        format!("{seconds}.{milliseconds:03}s")
    }
}

fn transport_kind_for_diagnostic(kind: ProviderTransportErrorKind) -> &'static str {
    match kind {
        ProviderTransportErrorKind::Timeout => "timeout",
        ProviderTransportErrorKind::Network => "network",
    }
}

fn append_diagnostic_json_line(path: &Path, payload: Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{payload}")?;
    Ok(())
}

pub fn drain_complete_sse_blocks(buffer: &mut Vec<u8>) -> Result<Vec<String>, ModelGatewayError> {
    let mut blocks = Vec::new();
    while let Some((index, delimiter_length)) = next_sse_block_bytes(buffer) {
        let consumed_length = index + delimiter_length;
        let block = std::str::from_utf8(&buffer[..index]).map_err(|_| {
            ModelGatewayError::ProviderUnavailable(
                "Provider 流式响应包含无效 UTF-8 数据。".to_string(),
            )
        })?;
        blocks.push(block.to_string());
        buffer.drain(..consumed_length);
    }
    Ok(blocks)
}

fn next_sse_block_bytes(buffer: &[u8]) -> Option<(usize, usize)> {
    let mut index = 0;
    while index + 1 < buffer.len() {
        if buffer[index] == b'\n' && buffer[index + 1] == b'\n' {
            return Some((index, 2));
        }
        if index + 3 < buffer.len()
            && buffer[index] == b'\r'
            && buffer[index + 1] == b'\n'
            && buffer[index + 2] == b'\r'
            && buffer[index + 3] == b'\n'
        {
            return Some((index, 4));
        }
        index += 1;
    }
    None
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn sanitize_diagnostic_value(key: Option<&str>, value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sanitized = object
                .iter()
                .map(|(key, value)| {
                    (
                        key.clone(),
                        sanitize_diagnostic_value(Some(key.as_str()), value),
                    )
                })
                .collect();
            Value::Object(sanitized)
        }
        Value::Array(items) => json!({
            "kind": "array",
            "itemCount": items.len(),
            "items": items
                .iter()
                .map(|item| sanitize_diagnostic_value(key, item))
                .collect::<Vec<_>>(),
        }),
        Value::String(text) => sanitize_diagnostic_string(key, text),
        Value::Number(_) | Value::Bool(_) | Value::Null => value.clone(),
    }
}

fn sanitize_diagnostic_string(key: Option<&str>, text: &str) -> Value {
    if text.starts_with("data:image/") {
        return summarize_image_data_url(text);
    }

    match key {
        Some("model") | Some("role") | Some("type") => Value::String(text.to_string()),
        Some("image_url") | Some("url") => json!({
            "urlCharCount": text.chars().count(),
        }),
        _ => json!({
            "stringCharCount": text.chars().count(),
        }),
    }
}

fn summarize_image_data_url(data_url: &str) -> Value {
    let mime_type = data_url
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(';'))
        .map(|(mime_type, _)| mime_type)
        .unwrap_or("unknown");

    json!({
        "kind": "imageDataUrl",
        "mimeType": mime_type,
        "imageDataUrlLength": data_url.len(),
    })
}

fn summarize_provider_response_shape(response: &Value) -> Value {
    json!({
        "status": response.get("status").and_then(Value::as_str),
        "incompleteDetails": sanitize_optional_diagnostic_value(response.get("incomplete_details")),
        "topLevelKeys": response
            .as_object()
            .map(|object| object.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
        "hasOutputText": response.get("output_text").and_then(Value::as_str).is_some(),
        "outputItemTypes": response_output_item_string_field(response, "type"),
        "outputItemStatuses": response_output_item_string_field(response, "status"),
        "outputItemContentKinds": response_output_item_content_kinds(response),
        "outputContentTypes": response_output_content_types(response),
        "choiceMessageContentKinds": response_choice_message_content_kinds(response),
        "usageKeys": response
            .get("usage")
            .and_then(Value::as_object)
            .map(|object| object.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
    })
}

fn sanitize_optional_diagnostic_value(value: Option<&Value>) -> Value {
    value
        .map(|value| sanitize_diagnostic_value(None, value))
        .unwrap_or(Value::Null)
}

fn response_output_item_string_field(response: &Value, field: &str) -> Vec<String> {
    response
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get(field).and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn response_output_item_content_kinds(response: &Value) -> Vec<&'static str> {
    response
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("content"))
        .map(value_kind)
        .collect()
}

fn response_output_content_types(response: &Value) -> Vec<String> {
    response
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter_map(|content| content.get("type").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn response_choice_message_content_kinds(response: &Value) -> Vec<&'static str> {
    response
        .get("choices")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|choice| choice.get("message"))
        .filter_map(|message| message.get("content"))
        .map(value_kind)
        .collect()
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        debug_normalized_result_payload, debug_prompt_payload, drain_complete_sse_blocks,
        format_elapsed_duration, parse_model_gateway_sse_event, provider_http_error,
        response_diagnostic_payload, sanitize_model_gateway_request_for_diagnostics,
        GatewayRequestBody, HttpModelGatewayRequestConfig, ModelGatewaySseEvent,
        ProviderAsyncAcquireTestHook, ProviderConcurrencyRegistry,
    };
    use crate::infrastructure::providers::openai_images::OpenAiMultipartBody;
    use crate::services::model_gateway::{ModelGatewayAdapterResult, ModelGatewayError};
    use serde_json::json;
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn drains_sse_blocks_without_corrupting_split_utf8_characters() {
        let event = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"卖点内容\"}\n\n";
        let bytes = event.as_bytes();
        let split_index = bytes
            .windows("卖".len())
            .position(|window| window == "卖".as_bytes())
            .expect("test event should contain Chinese delta")
            + 1;
        let mut pending = Vec::new();

        pending.extend_from_slice(&bytes[..split_index]);
        let first_blocks = drain_complete_sse_blocks(&mut pending).unwrap();

        assert!(first_blocks.is_empty());

        pending.extend_from_slice(&bytes[split_index..]);
        let blocks = drain_complete_sse_blocks(&mut pending).unwrap();

        assert_eq!(pending, Vec::<u8>::new());
        assert_eq!(blocks.len(), 1);
        assert_eq!(
            parse_model_gateway_sse_event(&blocks[0]),
            Some(ModelGatewaySseEvent::Delta("卖点内容".to_string()))
        );
        assert!(!blocks[0].contains('\u{fffd}'));
    }

    #[test]
    fn diagnostic_request_summarizes_sensitive_text_and_array_shape() {
        let diagnostic = sanitize_model_gateway_request_for_diagnostics(
            &HttpModelGatewayRequestConfig {
                endpoint_path: "/v1/responses",
                model: "gpt-4.1-mini",
                provider_profile_id: "openai",
            },
            &json!({
                "model": "gpt-4.1-mini",
                "prompt": "prompt-raw-marker",
                "instructions": "instructions-raw-marker",
                "input": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "input_image",
                            "image_url": "data:image/png;base64,image-raw-marker"
                        },
                        {
                            "type": "input_text",
                            "text": "content-raw-marker sk-diagnostic-secret-marker"
                        }
                    ]
                }],
            }),
        );
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["providerProfileId"], "openai");
        assert!(diagnostic.get("endpointPath").is_none());
        assert_eq!(diagnostic["model"], "gpt-4.1-mini");
        assert_eq!(diagnostic["body"]["model"], "gpt-4.1-mini");
        assert_eq!(diagnostic["body"]["prompt"]["stringCharCount"], 17);
        assert_eq!(diagnostic["body"]["instructions"]["stringCharCount"], 23);
        assert_eq!(diagnostic["body"]["input"]["itemCount"], 1);
        assert_eq!(
            diagnostic["body"]["input"]["items"][0]["content"]["itemCount"],
            2
        );
        assert!(!serialized.contains("prompt-raw-marker"));
        assert!(!serialized.contains("instructions-raw-marker"));
        assert!(!serialized.contains("content-raw-marker"));
        assert!(!serialized.contains("data:image/png;base64,image-raw-marker"));
        assert!(!serialized.contains("sk-diagnostic-secret-marker"));
    }

    #[test]
    fn debug_prompt_payload_requires_explicit_debug_flag_and_omits_user_images() {
        let input = json!({
            "prompt": {
                "messages": [
                    { "role": "system", "content": "system-marker" },
                    { "role": "user", "content": "user-marker" }
                ],
                "rolelessPrompt": "effective-marker"
            },
            "userImages": [{ "dataUrl": "data:image/png;base64,image-raw-marker" }]
        });

        let payload = debug_prompt_payload(Some("1"), "listing-copy", "openai", &input)
            .expect("debug flag should enable payload");
        let serialized = payload.to_string();

        assert_eq!(payload["capabilityId"], "listing-copy");
        assert_eq!(payload["providerProfileId"], "openai");
        assert_eq!(payload["systemPrompt"], "system-marker");
        assert_eq!(payload["userPrompt"], "user-marker");
        assert_eq!(payload["rolelessPrompt"], "effective-marker");
        assert!(!serialized.contains("image-raw-marker"));
        assert!(debug_prompt_payload(Some("true"), "listing-copy", "openai", &input).is_none());
        assert!(debug_prompt_payload(None, "listing-copy", "openai", &input).is_none());
    }

    #[test]
    fn debug_normalized_result_payload_summarizes_text_and_omits_sensitive_data() {
        let output_text = "模型结果 https://example.com/private.png?token=secret-marker data:image/png;base64,raw-text-image-marker Authorization: Bearer sk-debug-secret";
        let result = ModelGatewayAdapterResult {
            output_text: Some(output_text.to_string()),
            output_json: json!({
                "type": "image",
                "images": [
                    {
                        "dataUrl": "data:image/png;base64,raw-image-marker",
                        "url": "https://example.com/private-image.png?token=secret-marker",
                        "mimeType": "image/png",
                        "size": "1024x1536"
                    }
                ]
            }),
            usage_json: Some(json!({
                "inputTokens": 12,
                "outputTokens": 34,
                "totalTokens": 46
            })),
        };

        let payload = debug_normalized_result_payload(
            Some("1"),
            "image-edit",
            "openai",
            "gpt-image-1",
            &result,
        )
        .expect("debug flag should enable normalized result logging");
        let serialized = payload.to_string();

        assert_eq!(payload["outputTextCharCount"], output_text.chars().count());
        assert!(payload.get("outputText").is_none());
        assert_eq!(payload["outputJson"]["images"][0]["mimeType"], "image/png");
        assert_eq!(payload["outputJson"]["images"][0]["size"], "1024x1536");
        assert_eq!(payload["usageJson"]["totalTokens"], 46);
        assert!(!serialized.contains("raw-image-marker"));
        assert!(!serialized.contains("raw-text-image-marker"));
        assert!(!serialized.contains("private-image.png"));
        assert!(!serialized.contains("secret-marker"));
        assert!(!serialized.contains("sk-debug-secret"));
        assert!(debug_normalized_result_payload(
            None,
            "image-edit",
            "openai",
            "gpt-image-1",
            &result,
        )
        .is_none());
    }

    #[test]
    fn json_request_diagnostic_omits_configured_endpoint_path() {
        let diagnostic = sanitize_model_gateway_request_for_diagnostics(
            &HttpModelGatewayRequestConfig {
                endpoint_path: "/private/sk-endpoint-secret/chat?api_key=sk-query-secret",
                model: "gpt-4.1-mini",
                provider_profile_id: "openai",
            },
            &json!({ "prompt": "hello" }),
        );
        let serialized = diagnostic.to_string();

        assert!(diagnostic.get("endpointPath").is_none());
        assert!(!serialized.contains("sk-endpoint-secret"));
        assert!(!serialized.contains("sk-query-secret"));
    }

    #[test]
    fn multipart_request_diagnostic_omits_configured_endpoint_path() {
        let request = GatewayRequestBody::Multipart(OpenAiMultipartBody {
            content_type: "multipart/form-data; boundary=test".to_string(),
            body: vec![1, 2, 3],
        });
        let diagnostic = request.diagnostic(&HttpModelGatewayRequestConfig {
            endpoint_path: "/private/sk-endpoint-secret/edits?api_key=sk-query-secret",
            model: "gpt-image-1",
            provider_profile_id: "openai",
        });
        let serialized = diagnostic.to_string();

        assert!(diagnostic.get("endpointPath").is_none());
        assert!(!serialized.contains("sk-endpoint-secret"));
        assert!(!serialized.contains("sk-query-secret"));
    }

    #[test]
    fn provider_http_error_extracts_nested_and_top_level_codes() {
        assert_eq!(
            provider_http_error(
                404,
                r#"{"error":{"code":"ModelNotOpen","message":"raw marker"}}"#,
            ),
            ModelGatewayError::ProviderHttp {
                status_code: 404,
                provider_error_code: Some("ModelNotOpen".to_string()),
            }
        );
        assert_eq!(
            provider_http_error(400, r#"{"code":"InvalidParameter"}"#),
            ModelGatewayError::ProviderHttp {
                status_code: 400,
                provider_error_code: Some("InvalidParameter".to_string()),
            }
        );
        assert_eq!(
            provider_http_error(500, "not json"),
            ModelGatewayError::ProviderHttp {
                status_code: 500,
                provider_error_code: None,
            }
        );
        assert_eq!(
            provider_http_error(500, r#"{"code":"server_error sk-test-secret"}"#),
            ModelGatewayError::ProviderHttp {
                status_code: 500,
                provider_error_code: Some("server_error_redacted".to_string()),
            }
        );
    }

    #[test]
    fn response_diagnostic_omits_raw_response_body() {
        let diagnostic = response_diagnostic_payload(
            "response",
            12,
            404,
            false,
            r#"{"error":{"code":"ModelNotOpen","message":"diagnostic-response-marker"}}"#,
            Some("ModelNotOpen"),
        );
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["elapsedMs"], 12);
        assert_eq!(diagnostic["elapsed"], "0.012s");
        assert_eq!(diagnostic["providerErrorCode"], "ModelNotOpen");
        assert!(diagnostic["responseByteLength"].as_u64().unwrap() > 0);
        assert!(!serialized.contains("diagnostic-response-marker"));
        assert!(!serialized.contains("rawResponse"));
    }

    #[test]
    fn formats_elapsed_duration_for_console_diagnostics() {
        assert_eq!(format_elapsed_duration(999), "0.999s");
        assert_eq!(format_elapsed_duration(60_000), "1m 0.000s");
        assert_eq!(format_elapsed_duration(90_002), "1m 30.002s");
    }

    #[tokio::test]
    async fn local_provider_concurrency_registry_allows_only_one_in_flight_request() {
        let registry = ProviderConcurrencyRegistry::default();
        let permit = registry
            .acquire("openai", "http://127.0.0.1:11434")
            .await
            .expect("first local request should acquire the permit");

        let blocked = tokio::time::timeout(
            Duration::from_millis(20),
            registry.acquire("openai", "http://127.0.0.1:11434"),
        )
        .await;
        assert!(
            blocked.is_err(),
            "second local request must wait for the permit"
        );

        drop(permit);
        let _ = registry
            .acquire("openai", "http://127.0.0.1:11434")
            .await
            .expect("permit should release after the first request completes");
    }

    #[tokio::test]
    async fn local_provider_same_origin_shares_pool_across_profiles() {
        let registry = ProviderConcurrencyRegistry::default();
        let permit = registry
            .acquire("openai", "http://LOCALHOST:11434/v1")
            .await
            .expect("first local request should acquire the permit");

        let blocked = tokio::time::timeout(
            Duration::from_millis(20),
            registry.acquire("volcengine", "http://localhost:11434/api/v3"),
        )
        .await;

        assert!(
            blocked.is_err(),
            "the same normalized local origin must share one pool across profiles"
        );
        drop(permit);
    }

    #[tokio::test]
    async fn ipv6_loopback_same_origin_shares_pool_across_profiles() {
        let registry = ProviderConcurrencyRegistry::default();
        let permit = registry
            .acquire("openai", "https://[::1]:11434/v1")
            .await
            .expect("first IPv6 loopback request should acquire the permit");

        let blocked = tokio::time::timeout(
            Duration::from_millis(20),
            registry.acquire("volcengine", "https://[::1]:11434/api/v3"),
        )
        .await;

        assert!(
            blocked.is_err(),
            "the same IPv6 loopback origin must share one pool across profiles"
        );
        drop(permit);
    }

    #[tokio::test]
    async fn local_provider_different_origins_use_separate_pools_for_same_profile() {
        let registry = ProviderConcurrencyRegistry::default();
        let first_permit = registry
            .acquire("openai", "http://127.0.0.1:11434/v1")
            .await
            .expect("first local origin should acquire the permit");

        let second_permit = tokio::time::timeout(
            Duration::from_millis(100),
            registry.acquire("openai", "http://127.0.0.1:11435/v1"),
        )
        .await
        .expect("a different local origin must not wait on the first origin")
        .expect("second local origin should acquire its own permit");

        drop(second_permit);
        drop(first_permit);
    }

    #[tokio::test]
    async fn remote_provider_different_origins_share_the_provider_pool() {
        let registry = ProviderConcurrencyRegistry::default();
        let first = registry
            .acquire("openai", "https://api.openai.example/v1")
            .await
            .expect("first remote request should acquire a permit");
        let second = registry
            .acquire("openai", "https://api.openai.example/v1")
            .await
            .expect("second remote request should acquire a permit");
        let third = registry
            .acquire("openai", "https://gateway.example/openai")
            .await
            .expect("third remote request should acquire a permit");

        let blocked = tokio::time::timeout(
            Duration::from_millis(20),
            registry.acquire("openai", "https://another-gateway.example/v1"),
        )
        .await;

        assert!(
            blocked.is_err(),
            "remote origins for one provider must share the provider-level limit"
        );
        drop(third);
        drop(second);
        drop(first);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn async_provider_pool_wakes_every_waiter_when_multiple_permits_release_together() {
        let registry = ProviderConcurrencyRegistry::default();
        let base_url = "https://api.openai.example/v1";
        let first = registry
            .acquire("openai", base_url)
            .await
            .expect("first request should acquire a permit");
        let second = registry
            .acquire("openai", base_url)
            .await
            .expect("second request should acquire a permit");
        let third = registry
            .acquire("openai", base_url)
            .await
            .expect("third request should acquire a permit");
        let pool = registry
            .pool("openai", base_url)
            .expect("provider pool should resolve");
        let hook = Arc::new(ProviderAsyncAcquireTestHook {
            reached_empty_check: tokio::sync::Barrier::new(3),
            continue_to_wait: tokio::sync::Barrier::new(3),
        });
        *pool
            .async_acquire_test_hook
            .lock()
            .expect("test hook lock should remain available") = Some(hook.clone());

        let first_registry = registry.clone();
        let first_waiter =
            tokio::spawn(async move { first_registry.acquire("openai", base_url).await });
        let second_registry = registry.clone();
        let second_waiter =
            tokio::spawn(async move { second_registry.acquire("openai", base_url).await });

        hook.reached_empty_check.wait().await;
        drop(first);
        drop(second);
        hook.continue_to_wait.wait().await;

        let (first_waiter_permit, second_waiter_permit) =
            tokio::time::timeout(Duration::from_millis(200), async {
                let first_waiter_permit = first_waiter
                    .await
                    .expect("first waiter task should finish")
                    .expect("first waiter should acquire a released permit");
                let second_waiter_permit = second_waiter
                    .await
                    .expect("second waiter task should finish")
                    .expect("second waiter should acquire a released permit");
                (first_waiter_permit, second_waiter_permit)
            })
            .await
            .expect("every waiter should wake after two permits are released");

        drop(first_waiter_permit);
        drop(second_waiter_permit);
        drop(third);
        assert_eq!(
            *pool
                .available
                .lock()
                .expect("available permit count should remain readable"),
            3
        );
    }

    #[tokio::test]
    async fn blocking_and_async_requests_share_the_same_provider_limit() {
        let registry = ProviderConcurrencyRegistry::default();
        let async_permit = registry
            .acquire("openai", "http://127.0.0.1:11434")
            .await
            .expect("async request should acquire the local permit");
        let blocking_registry = registry.clone();
        let (acquired_tx, acquired_rx) = std::sync::mpsc::channel();
        let blocking_worker = std::thread::spawn(move || {
            let permit = blocking_registry
                .acquire_blocking("openai", "http://127.0.0.1:11434")
                .expect("blocking request should eventually acquire the permit");
            acquired_tx.send(()).expect("report blocking acquisition");
            permit
        });

        assert!(acquired_rx.recv_timeout(Duration::from_millis(20)).is_err());
        drop(async_permit);
        acquired_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("blocking request should acquire the released async permit");
        drop(
            blocking_worker
                .join()
                .expect("blocking worker should finish"),
        );

        let blocking_permit = registry
            .acquire_blocking("openai", "http://127.0.0.1:11434")
            .expect("blocking request should acquire the local permit");
        let blocked_async = tokio::time::timeout(
            Duration::from_millis(20),
            registry.acquire("openai", "http://127.0.0.1:11434"),
        )
        .await;
        assert!(blocked_async.is_err());
        drop(blocking_permit);
        let _ = registry
            .acquire("openai", "http://127.0.0.1:11434")
            .await
            .expect("async request should acquire the released blocking permit");
    }
}
