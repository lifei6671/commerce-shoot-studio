use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::domain::errors::{
    normalize_provider_http_error, normalize_provider_transport_error, ProviderTransportErrorKind,
};
use crate::infrastructure::database::WorkspaceDatabase;
use crate::infrastructure::providers::deterministic::DeterministicModelGatewayAdapter;
use crate::infrastructure::providers::http_model_gateway::HttpModelGatewayAdapter;
use crate::services::model_config::{
    default_resolved_config_for_capability, provider_profile, ModelConfigError,
    ResolvedModelConfig, CAPABILITIES,
};
use crate::services::secrets::{SecretError, SecretScope, SecretService};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelGatewayRequest {
    pub capability_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelGatewayResult {
    pub invocation_id: String,
    pub capability_id: String,
    pub provider_profile_id: String,
    pub model: String,
    pub output_text: Option<String>,
    pub output_json: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ModelGatewayAdapterRequest<'a> {
    pub api_key: Option<&'a str>,
    pub base_url: &'a str,
    pub capability_id: &'a str,
    pub endpoint_path: &'a str,
    pub input: &'a serde_json::Value,
    pub input_summary: &'a str,
    pub model: &'a str,
    pub provider_profile_id: &'a str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelGatewayAdapterResult {
    pub output_text: Option<String>,
    pub output_json: serde_json::Value,
    pub usage_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelGatewayError {
    ProviderUnavailable(String),
    ProviderRequestInvalid(String),
    ProviderHttp {
        status_code: i64,
        provider_error_code: Option<String>,
    },
    ProviderTransport(ProviderTransportErrorKind),
}

impl std::fmt::Display for ModelGatewayError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProviderUnavailable(message) | Self::ProviderRequestInvalid(message) => {
                write!(formatter, "{message}")
            }
            Self::ProviderHttp {
                status_code,
                provider_error_code,
            } => write!(
                formatter,
                "{}",
                normalize_provider_http_error(*status_code, provider_error_code.as_deref()).message
            ),
            Self::ProviderTransport(kind) => write!(
                formatter,
                "{}",
                normalize_provider_transport_error(*kind).message
            ),
        }
    }
}

impl std::error::Error for ModelGatewayError {}

pub trait ModelGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ModelGatewayService;

impl ModelGatewayService {
    pub fn new() -> Self {
        Self
    }

    pub fn invoke(
        &self,
        workspace_directory: &Path,
        request: ModelGatewayRequest,
    ) -> Result<ModelGatewayResult, ModelConfigError> {
        self.invoke_with_adapter(
            workspace_directory,
            request,
            &DeterministicModelGatewayAdapter,
        )
    }

    pub fn invoke_real_provider(
        &self,
        workspace_directory: &Path,
        request: ModelGatewayRequest,
    ) -> Result<ModelGatewayResult, ModelConfigError> {
        let resolved_context =
            resolve_gateway_context(workspace_directory, &request.capability_id)?;
        if resolved_context.config.provider_profile_id == "mock-local" {
            return Err(ModelConfigError::Validation(no_available_model_message()));
        }
        let diagnostic_log_path = Some(
            workspace_directory
                .join("logs")
                .join("model-gateway-diagnostics.jsonl"),
        );
        let adapter = HttpModelGatewayAdapter::new(diagnostic_log_path)
            .map_err(model_config_error_from_gateway_error)?;

        self.invoke_with_resolved_context(workspace_directory, request, &adapter, resolved_context)
    }

    pub fn stream_real_provider<F>(
        &self,
        workspace_directory: &Path,
        request: ModelGatewayRequest,
        mut on_delta: F,
    ) -> Result<ModelGatewayResult, ModelConfigError>
    where
        F: FnMut(&str) -> Result<(), ModelConfigError>,
    {
        let resolved_context =
            resolve_gateway_context(workspace_directory, &request.capability_id)?;
        if resolved_context.config.provider_profile_id == "mock-local" {
            return Err(ModelConfigError::Validation(no_available_model_message()));
        }
        let diagnostic_log_path = Some(
            workspace_directory
                .join("logs")
                .join("model-gateway-diagnostics.jsonl"),
        );
        let adapter = HttpModelGatewayAdapter::new(diagnostic_log_path)
            .map_err(model_config_error_from_gateway_error)?;
        let database =
            WorkspaceDatabase::open(workspace_directory).map_err(ModelConfigError::from)?;
        let invocation_id = create_invocation_id();
        let input_summary = summarize_input(&request.input);
        let api_key = resolved_context.api_key.as_deref();
        let adapter_result = adapter
            .invoke_stream(
                ModelGatewayAdapterRequest {
                    api_key,
                    base_url: &resolved_context.base_url,
                    capability_id: &request.capability_id,
                    endpoint_path: &resolved_context.endpoint_path,
                    input: &request.input,
                    input_summary: &input_summary,
                    model: &resolved_context.config.view.model,
                    provider_profile_id: &resolved_context.config.provider_profile_id,
                },
                |delta| {
                    on_delta(delta).map_err(|source| {
                        ModelGatewayError::ProviderUnavailable(source.to_string())
                    })
                },
            )
            .map_err(model_config_error_from_gateway_error)?;

        let request_summary_json = serde_json::json!({
            "inputSummary": input_summary,
            "stream": true,
        });
        let output_summary_json = summarize_output(&adapter_result);

        insert_invocation(
            &database,
            &invocation_id,
            &request.capability_id,
            &resolved_context.config.provider_profile_id,
            &resolved_context.config.view.model,
            &request_summary_json,
            &output_summary_json,
            adapter_result.usage_json.as_ref(),
        )?;

        Ok(ModelGatewayResult {
            invocation_id,
            capability_id: request.capability_id.clone(),
            provider_profile_id: resolved_context.config.provider_profile_id,
            model: resolved_context.config.view.model,
            output_text: adapter_result.output_text,
            output_json: adapter_result.output_json,
        })
    }

    pub fn invoke_with_adapter<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        request: ModelGatewayRequest,
        adapter: &T,
    ) -> Result<ModelGatewayResult, ModelConfigError> {
        let resolved_context =
            resolve_gateway_context(workspace_directory, &request.capability_id)?;
        self.invoke_with_resolved_context(workspace_directory, request, adapter, resolved_context)
    }

    fn invoke_with_resolved_context<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        request: ModelGatewayRequest,
        adapter: &T,
        resolved_context: ResolvedGatewayContext,
    ) -> Result<ModelGatewayResult, ModelConfigError> {
        let database =
            WorkspaceDatabase::open(workspace_directory).map_err(ModelConfigError::from)?;
        let invocation_id = create_invocation_id();
        let input_summary = summarize_input(&request.input);
        let api_key = resolved_context.api_key.as_deref();
        let adapter_result = adapter
            .invoke(ModelGatewayAdapterRequest {
                api_key,
                base_url: &resolved_context.base_url,
                capability_id: &request.capability_id,
                endpoint_path: &resolved_context.endpoint_path,
                input: &request.input,
                input_summary: &input_summary,
                model: &resolved_context.config.view.model,
                provider_profile_id: &resolved_context.config.provider_profile_id,
            })
            .map_err(model_config_error_from_gateway_error)?;
        let request_summary_json = serde_json::json!({
            "inputSummary": input_summary,
        });
        let output_summary_json = summarize_output(&adapter_result);

        insert_invocation(
            &database,
            &invocation_id,
            &request.capability_id,
            &resolved_context.config.provider_profile_id,
            &resolved_context.config.view.model,
            &request_summary_json,
            &output_summary_json,
            adapter_result.usage_json.as_ref(),
        )?;

        Ok(ModelGatewayResult {
            invocation_id,
            capability_id: request.capability_id.clone(),
            provider_profile_id: resolved_context.config.provider_profile_id,
            model: resolved_context.config.view.model,
            output_text: adapter_result.output_text,
            output_json: adapter_result.output_json,
        })
    }
}

fn model_config_error_from_gateway_error(source: ModelGatewayError) -> ModelConfigError {
    match source {
        ModelGatewayError::ProviderHttp {
            status_code,
            provider_error_code,
        } => ModelConfigError::ProviderHttp {
            status_code,
            provider_error_code,
        },
        ModelGatewayError::ProviderTransport(kind) => ModelConfigError::ProviderTransport(kind),
        ModelGatewayError::ProviderRequestInvalid(message)
        | ModelGatewayError::ProviderUnavailable(message) => ModelConfigError::Validation(message),
    }
}

struct ResolvedGatewayContext {
    api_key: Option<String>,
    base_url: String,
    config: ResolvedModelConfig,
    endpoint_path: String,
}

fn resolve_gateway_context(
    workspace_directory: &Path,
    capability_id: &str,
) -> Result<ResolvedGatewayContext, ModelConfigError> {
    let config = default_resolved_config_for_capability(workspace_directory, capability_id)?;
    if !config.view.enabled
        || !config.view.secret_status.configured
        || config.view.connection_status != "available"
    {
        return Err(ModelConfigError::Validation(no_available_model_message()));
    }
    let profile = provider_profile(&config.provider_profile_id).ok_or_else(|| {
        ModelConfigError::Validation("provider_profile_id 不在内置 allowlist 中。".to_string())
    })?;
    let category = capability_category(capability_id)?;
    let endpoint_path = resolve_endpoint_path(
        profile.id,
        profile.default_endpoint_path,
        category,
        config.view.endpoint_path.as_deref(),
    )
    .unwrap_or_else(|| "/chat/completions".to_string());
    let api_key = if profile.requires_secret {
        Some(
            SecretService::new()
                .reveal_secret(
                    workspace_directory,
                    SecretScope {
                        provider_profile_id: config.provider_profile_id.clone(),
                        capability_id: Some(config.view.capability_id.clone()),
                    },
                )
                .map_err(ModelConfigError::from)?,
        )
    } else {
        None
    };

    Ok(ResolvedGatewayContext {
        api_key,
        base_url: config.view.base_url.clone(),
        config,
        endpoint_path,
    })
}

fn capability_category(capability_id: &str) -> Result<&'static str, ModelConfigError> {
    CAPABILITIES
        .iter()
        .find(|capability| capability.id == capability_id)
        .map(|capability| capability.category)
        .ok_or_else(|| ModelConfigError::Validation("不支持的 capabilityId。".to_string()))
}

fn resolve_endpoint_path(
    provider_profile_id: &str,
    default_endpoint_path: Option<&str>,
    category: &str,
    configured_endpoint_path: Option<&str>,
) -> Option<String> {
    if provider_profile_id == "openai" && category == "text-to-image" {
        return Some("/v1/images/generations".to_string());
    }

    if provider_profile_id == "openai" && category == "image-to-image" {
        return Some("/v1/images/edits".to_string());
    }

    if provider_profile_id == "volcengine" && matches!(category, "text-to-image" | "image-to-image")
    {
        return Some("/images/generations".to_string());
    }

    if provider_profile_id == "volcengine" && category == "image-to-text" {
        return Some("/responses".to_string());
    }

    configured_endpoint_path
        .map(str::to_string)
        .or_else(|| default_endpoint_path.map(str::to_string))
}

fn summarize_input(input: &serde_json::Value) -> String {
    match input {
        serde_json::Value::Object(map) => format!("object:{} keys", map.len()),
        serde_json::Value::Array(items) => format!("array:{} items", items.len()),
        serde_json::Value::String(value) => format!("string:{} chars", value.chars().count()),
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Null => "null".to_string(),
    }
}

fn summarize_output(result: &ModelGatewayAdapterResult) -> serde_json::Value {
    // invocation 表只保存结构化摘要，不保存 Provider 原始响应或模型完整输出。
    serde_json::json!({
        "hasOutputText": result.output_text.is_some(),
        "outputJsonSummary": summarize_input(&result.output_json),
    })
}

fn insert_invocation(
    database: &WorkspaceDatabase,
    invocation_id: &str,
    capability_id: &str,
    provider_profile_id: &str,
    model: &str,
    request_summary_json: &serde_json::Value,
    output_summary_json: &serde_json::Value,
    usage_json: Option<&serde_json::Value>,
) -> Result<(), ModelConfigError> {
    database.connection().execute(
        "
        INSERT INTO model_invocations (
            id, capability_id, provider_profile_id, model, status,
            request_summary_json, output_summary_json, usage_json, completed_at
        )
        VALUES (?1, ?2, ?3, ?4, 'succeeded', ?5, ?6, ?7, datetime('now'))
        ",
        params![
            invocation_id,
            capability_id,
            provider_profile_id,
            model,
            request_summary_json.to_string(),
            output_summary_json.to_string(),
            usage_json.map(serde_json::Value::to_string),
        ],
    )?;
    Ok(())
}

fn create_invocation_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("model_invocation_{nanos}")
}

fn no_available_model_message() -> String {
    "没有可用模型".to_string()
}

impl From<SecretError> for ModelConfigError {
    fn from(source: SecretError) -> Self {
        Self::Validation(source.to_string())
    }
}
