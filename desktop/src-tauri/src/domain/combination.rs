use serde::{Deserialize, Serialize};

use crate::domain::model::{ModelInputLimits, SaveModelConfigRequest};
use crate::domain::prompt::{ResolvedPrompt, SavePromptBindingRequest};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageCombinationRequest {
    pub id: Option<String>,
    pub name: String,
    pub person_asset_id: String,
    pub garment_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCombination {
    pub id: String,
    pub name: String,
    pub person_asset_id: String,
    pub garment_asset_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCombinationSummary {
    pub id: String,
    pub name: String,
    pub person_asset_id: Option<String>,
    pub garment_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftImageCombination {
    pub id: Option<String>,
    pub name: Option<String>,
    pub person_asset_id: Option<String>,
    pub garment_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateCombinationRequest {
    pub revision: u64,
    pub draft_combination: DraftImageCombination,
    pub draft_prompt_binding: Option<SavePromptBindingRequest>,
    pub draft_model_config: Option<SaveModelConfigRequest>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationReasonCode {
    PersonAssetRequired,
    GarmentCountBelowMin,
    GarmentCountAboveMax,
    AssetNotFound,
    PromptBindingRequired,
    PromptRequiredVariableMissing,
    PromptTemplateInvalid,
    ModelConfigRequired,
    ModelParamInvalid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReason {
    pub code: ValidationReasonCode,
    pub message: String,
    pub field: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveValidationLimits {
    pub min_garments: u32,
    pub max_garments: u32,
    pub normalized_output_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveModel {
    pub provider: String,
    pub model_id: String,
    pub advanced: bool,
    pub params_json: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateCombinationResponse {
    pub revision: u64,
    pub executable: bool,
    pub reasons: Vec<ValidationReason>,
    pub warnings: Vec<ValidationWarning>,
    pub effective_limits: EffectiveValidationLimits,
    pub resolved_prompt: Option<ResolvedPrompt>,
    pub effective_model: Option<EffectiveModel>,
}

impl Default for EffectiveValidationLimits {
    fn default() -> Self {
        Self {
            min_garments: 1,
            max_garments: 1,
            normalized_output_count: 1,
        }
    }
}

impl From<ModelInputLimits> for EffectiveValidationLimits {
    fn from(value: ModelInputLimits) -> Self {
        Self {
            min_garments: value.min_garments,
            max_garments: value.max_garments,
            normalized_output_count: 1,
        }
    }
}
