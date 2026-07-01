use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::infrastructure::database::WorkspaceDatabase;
use crate::infrastructure::providers::deterministic::DeterministicModelGatewayAdapter;
use crate::services::model_config::{default_resolved_config_for_capability, ModelConfigError};

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
    pub capability_id: &'a str,
    pub input_summary: &'a str,
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
}

impl std::fmt::Display for ModelGatewayError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProviderUnavailable(message) => write!(formatter, "{message}"),
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

    pub fn invoke_with_adapter<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        request: ModelGatewayRequest,
        adapter: &T,
    ) -> Result<ModelGatewayResult, ModelConfigError> {
        let config =
            default_resolved_config_for_capability(workspace_directory, &request.capability_id)?;
        if !config.view.enabled
            || !config.view.secret_status.configured
            || config.view.connection_status != "available"
        {
            return Err(ModelConfigError::Validation("模型能力不可用。".to_string()));
        }

        let database =
            WorkspaceDatabase::open(workspace_directory).map_err(ModelConfigError::from)?;
        let invocation_id = create_invocation_id();
        let input_summary = summarize_input(&request.input);
        let adapter_result = adapter
            .invoke(ModelGatewayAdapterRequest {
                capability_id: &request.capability_id,
                input_summary: &input_summary,
            })
            .map_err(|source| ModelConfigError::Validation(source.to_string()))?;
        let request_summary_json = serde_json::json!({
            "inputSummary": input_summary,
        });
        let output_summary_json = summarize_output(&adapter_result);

        insert_invocation(
            &database,
            &invocation_id,
            &request.capability_id,
            &config.provider_profile_id,
            &config.view.model,
            &request_summary_json,
            &output_summary_json,
            adapter_result.usage_json.as_ref(),
        )?;

        Ok(ModelGatewayResult {
            invocation_id,
            capability_id: request.capability_id.clone(),
            provider_profile_id: config.provider_profile_id,
            model: config.view.model,
            output_text: adapter_result.output_text,
            output_json: adapter_result.output_json,
        })
    }
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
