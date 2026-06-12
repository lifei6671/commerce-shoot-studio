use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInputLimits {
    pub min_garments: u32,
    pub max_garments: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelParamSchema {
    pub key: String,
    pub label: String,
    pub kind: ModelParamKind,
    pub required: bool,
    pub default_value: Value,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub options: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelParamKind {
    Integer,
    Select,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOutputSchema {
    pub count_param_key: String,
    pub min_count: u32,
    pub max_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefinition {
    pub provider: String,
    pub model_id: String,
    pub display_name: String,
    pub advanced: bool,
    pub input_limits: ModelInputLimits,
    pub params_schema: Vec<ModelParamSchema>,
    pub output: ModelOutputSchema,
    pub provider_base_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveModelConfigRequest {
    pub id: Option<String>,
    pub provider: String,
    pub model_id: String,
    pub params_json: Value,
}

#[derive(Debug, Clone)]
pub struct ValidateModelConfigInput {
    pub request: SaveModelConfigRequest,
    pub advanced_models: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedModelConfig {
    pub definition: ModelDefinition,
    pub input_limits: ModelInputLimits,
    pub normalized_output_count: u32,
    pub normalized_params_json: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: String,
    pub provider: String,
    pub model_id: String,
    pub params_json: Value,
    pub input_limits: ModelInputLimits,
    pub normalized_output_count: u32,
    pub created_at: String,
    pub updated_at: String,
}
