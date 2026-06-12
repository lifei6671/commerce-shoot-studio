use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::model::SaveModelConfigRequest;
use crate::domain::prompt::SavePromptBindingRequest;

pub const RUNNING_TASK_STATUSES: &[&str] = &[
    "queued",
    "preparing",
    "calling_model",
    "waiting_result",
    "saving_result",
];

pub const APP_UNEXPECTED_SHUTDOWN: &str = "APP_UNEXPECTED_SHUTDOWN";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerationTaskInputRole {
    Person,
    Garment,
    Reference,
    Mask,
}

impl GenerationTaskInputRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            GenerationTaskInputRole::Person => "person",
            GenerationTaskInputRole::Garment => "garment",
            GenerationTaskInputRole::Reference => "reference",
            GenerationTaskInputRole::Mask => "mask",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskInputAsset {
    pub asset_id: String,
    pub role: GenerationTaskInputRole,
    pub view_type: Option<String>,
    pub sort_order: i64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGenerationTaskSnapshotRequest {
    pub id: Option<String>,
    pub combination_id: Option<String>,
    pub provider: String,
    pub model_id: String,
    pub request_summary_json: Option<Value>,
    pub input_snapshot_json: Value,
    pub final_prompt_snapshot_json: Value,
    pub model_config_snapshot_json: Value,
    pub asset_snapshot_json: Value,
    pub input_assets: Vec<GenerationTaskInputAsset>,
    pub output_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartGenerationRequest {
    pub combination_id: String,
    pub draft_prompt_binding: Option<SavePromptBindingRequest>,
    pub draft_model_config: Option<SaveModelConfigRequest>,
    pub revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGenerationTaskResultRequest {
    pub id: Option<String>,
    pub task_id: String,
    pub asset_id: String,
    pub sort_order: i64,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGenerationTask {
    pub id: String,
    pub combination_id: Option<String>,
    pub provider: String,
    pub model_id: String,
    pub status: String,
    pub progress: i64,
    pub request_summary_json: Option<Value>,
    pub input_snapshot_json: Value,
    pub final_prompt_snapshot_json: Value,
    pub model_config_snapshot_json: Value,
    pub asset_snapshot_json: Value,
    pub output_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskResult {
    pub id: String,
    pub task_id: String,
    pub asset_id: String,
    pub sort_order: i64,
    pub source_url: Option<String>,
    pub created_at: String,
}
