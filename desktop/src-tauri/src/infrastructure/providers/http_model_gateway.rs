use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use reqwest::{StatusCode, Url};
use serde_json::{json, Value};

use crate::infrastructure::providers::openai_compatible::normalize_openai_compatible_response;
use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
};

#[derive(Debug, Clone, Copy)]
pub struct HttpModelGatewayRequestConfig<'a> {
    pub endpoint_path: &'a str,
    pub model: &'a str,
    pub provider_profile_id: &'a str,
}

pub struct HttpModelGatewayAdapter {
    client: Client,
    diagnostic_log_path: Option<PathBuf>,
}

impl HttpModelGatewayAdapter {
    pub fn new(diagnostic_log_path: Option<PathBuf>) -> Result<Self, ModelGatewayError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| {
                ModelGatewayError::ProviderUnavailable("Provider 客户端初始化失败。".to_string())
            })?;
        Ok(Self {
            client,
            diagnostic_log_path,
        })
    }

    fn write_diagnostic(&self, payload: Value) {
        let Some(path) = self.diagnostic_log_path.as_deref() else {
            return;
        };
        eprintln!("[model-gateway-diagnostics] {payload}");
        let _ = append_diagnostic_json_line(path, payload);
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
        let request_started_at = Instant::now();
        let mut response = match self
            .client
            .post(endpoint)
            .bearer_auth(api_key)
            .header(CONTENT_TYPE, "application/json")
            .timeout(model_gateway_request_timeout(request.capability_id))
            .body(request_body.to_string())
            .send()
        {
            Ok(response) => response,
            Err(source) => {
                let message = if source.is_timeout() {
                    "Provider 调用超时。"
                } else {
                    "Provider 网络调用失败。"
                };
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "request_error",
                    "elapsedMs": request_started_at.elapsed().as_millis(),
                    "isTimeout": source.is_timeout(),
                    "error": message,
                    "source": source.to_string(),
                }));
                return Err(ModelGatewayError::ProviderUnavailable(message.to_string()));
            }
        };
        let status = response.status();
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "stream_response_status",
            "elapsedMs": request_started_at.elapsed().as_millis(),
            "status": status.as_u16(),
            "success": status.is_success(),
        }));
        if !status.is_success() {
            return Err(ModelGatewayError::ProviderUnavailable(
                provider_status_error(status),
            ));
        }

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
            "outputText": output_text,
        }));

        Ok(ModelGatewayAdapterResult {
            output_text: Some(output_text),
            output_json: json!({
                "type": "text",
                "stream": true,
            }),
            usage_json: Some(usage_json),
        })
    }
}

impl ModelGatewayAdapter for HttpModelGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        let api_key = request
            .api_key
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ModelGatewayError::ProviderUnavailable("模型配置缺少 API Key。".to_string())
            })?;
        let endpoint = provider_endpoint(request.base_url, request.endpoint_path)?;
        let request_body = build_model_gateway_request_body(
            &HttpModelGatewayRequestConfig {
                endpoint_path: request.endpoint_path,
                model: request.model,
                provider_profile_id: request.provider_profile_id,
            },
            request.input,
        )?;
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "request",
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
        let request_started_at = Instant::now();
        let response = match self
            .client
            .post(endpoint)
            .bearer_auth(api_key)
            .header(CONTENT_TYPE, "application/json")
            .timeout(model_gateway_request_timeout(request.capability_id))
            .body(request_body.to_string())
            .send()
        {
            Ok(response) => response,
            Err(source) => {
                let message = if source.is_timeout() {
                    "Provider 调用超时。"
                } else {
                    "Provider 网络调用失败。"
                };
                self.write_diagnostic(json!({
                    "timestampMs": current_timestamp_ms(),
                    "event": "request_error",
                    "elapsedMs": request_started_at.elapsed().as_millis(),
                    "isTimeout": source.is_timeout(),
                    "error": message,
                    "source": source.to_string(),
                }));
                return Err(ModelGatewayError::ProviderUnavailable(message.to_string()));
            }
        };
        let status = response.status();
        let response_text = response.text().map_err(|_| {
            ModelGatewayError::ProviderUnavailable("读取 Provider 响应失败。".to_string())
        })?;
        self.write_diagnostic(json!({
            "timestampMs": current_timestamp_ms(),
            "event": "response",
            "elapsedMs": request_started_at.elapsed().as_millis(),
            "status": status.as_u16(),
            "success": status.is_success(),
            "responseByteLength": response_text.len(),
            "rawResponse": response_text,
        }));
        if !status.is_success() {
            return Err(ModelGatewayError::ProviderUnavailable(
                provider_status_error(status),
            ));
        }
        let response_json: Value = serde_json::from_str(&response_text).map_err(|_| {
            self.write_diagnostic(json!({
                "timestampMs": current_timestamp_ms(),
                "event": "response_parse_failed",
                "responseByteLength": response_text.len(),
                "rawResponse": response_text,
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

        Ok(ModelGatewayAdapterResult {
            output_text: normalized.output_text,
            output_json: normalized.output_json,
            usage_json: Some(normalized.usage_json),
        })
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

    let mut body = json!({
        "model": config.model,
        "prompt": prompt.roleless,
        "images": images,
        "max_tokens": max_output_tokens,
        "temperature": 0.2,
    });
    if config.provider_profile_id == "volcengine"
        && config.endpoint_path.contains("/images/generations")
    {
        body["watermark"] = Value::Bool(false);
    }

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

pub fn model_gateway_request_timeout(capability_id: &str) -> Duration {
    if capability_id == "prompt-plan" {
        return Duration::from_secs(300);
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
        "endpointPath": config.endpoint_path,
        "model": config.model,
        "body": sanitize_diagnostic_value(None, body),
    })
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

fn provider_status_error(status: StatusCode) -> String {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return "Provider 鉴权失败，请检查 API Key 和模型权限。".to_string();
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return "Provider 请求过于频繁，请稍后重试。".to_string();
    }
    format!("Provider 调用失败（HTTP {}）。", status.as_u16())
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
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| sanitize_diagnostic_value(key, item))
                .collect(),
        ),
        Value::String(text) => sanitize_diagnostic_string(key, text),
        Value::Number(_) | Value::Bool(_) | Value::Null => value.clone(),
    }
}

fn sanitize_diagnostic_string(key: Option<&str>, text: &str) -> Value {
    if text.starts_with("data:image/") {
        return summarize_image_data_url(text);
    }

    match key {
        Some("model") | Some("role") | Some("type") | Some("text") | Some("content")
        | Some("prompt") | Some("instructions") => Value::String(text.to_string()),
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
        drain_complete_sse_blocks, parse_model_gateway_sse_event,
        sanitize_model_gateway_request_for_diagnostics, HttpModelGatewayRequestConfig,
        ModelGatewaySseEvent,
    };
    use serde_json::json;

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
    fn diagnostic_request_keeps_full_prompt_text_for_debugging() {
        let diagnostic = sanitize_model_gateway_request_for_diagnostics(
            &HttpModelGatewayRequestConfig {
                endpoint_path: "/images/generations",
                model: "doubao-seedream-4-0-250828",
                provider_profile_id: "volcengine",
            },
            &json!({
                "model": "doubao-seedream-4-0-250828",
                "prompt": "完整商品生图 prompt",
                "images": ["data:image/png;base64,abc123"],
            }),
        );

        assert_eq!(diagnostic["body"]["prompt"], "完整商品生图 prompt");
        assert_eq!(diagnostic["body"]["images"][0]["mimeType"], "image/png");
        assert_eq!(diagnostic["body"]["images"][0]["kind"], "imageDataUrl");
    }
}
