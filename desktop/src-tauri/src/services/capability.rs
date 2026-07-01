use std::path::Path;

use serde::Serialize;

use crate::services::model_config::{
    default_config_for_capability, ModelConfigError, CAPABILITIES,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilityView {
    pub id: String,
    pub category: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub display_name: Option<String>,
    pub max_input_assets: Option<i64>,
    pub supported_aspect_ratios: Vec<String>,
    pub max_image_count: Option<i64>,
    pub estimated_credit_cost: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CapabilityService;

impl CapabilityService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_capabilities(
        &self,
        workspace_directory: &Path,
    ) -> Result<Vec<ModelCapabilityView>, ModelConfigError> {
        CAPABILITIES
            .iter()
            .map(|capability| self.get_capability(workspace_directory, capability.id))
            .collect()
    }

    pub fn get_capability(
        &self,
        workspace_directory: &Path,
        capability_id: &str,
    ) -> Result<ModelCapabilityView, ModelConfigError> {
        let definition = CAPABILITIES
            .iter()
            .find(|capability| capability.id == capability_id)
            .ok_or_else(|| ModelConfigError::Validation("不支持的 capabilityId。".to_string()))?;
        let config = default_config_for_capability(workspace_directory, capability_id).ok();
        let available = config
            .as_ref()
            .map(|config| {
                config.enabled
                    && config.secret_status.configured
                    && config.connection_status == "available"
            })
            .unwrap_or(false);
        let unavailable_reason = match config.as_ref() {
            Some(config) if !config.enabled => Some("模型配置未启用。".to_string()),
            Some(config) if !config.secret_status.configured => {
                Some("缺少 Provider API Key。".to_string())
            }
            Some(config) if config.connection_status == "untested" => {
                Some("模型连接尚未测试。".to_string())
            }
            Some(config) if config.connection_status == "unavailable" => {
                Some("模型连接不可用。".to_string())
            }
            Some(_) if available => None,
            Some(_) => Some("未配置可用模型。".to_string()),
            None => Some("未配置可用模型。".to_string()),
        };

        Ok(ModelCapabilityView {
            id: definition.id.to_string(),
            category: definition.category.to_string(),
            available,
            unavailable_reason,
            display_name: Some(definition.display_name.to_string()),
            max_input_assets: Some(max_input_assets(definition.category)),
            supported_aspect_ratios: vec![
                "1:1".to_string(),
                "3:4".to_string(),
                "9:16".to_string(),
                "16:9".to_string(),
            ],
            max_image_count: Some(max_image_count(definition.category)),
            estimated_credit_cost: Some(0),
        })
    }
}

fn max_input_assets(category: &str) -> i64 {
    match category {
        "text-to-text" | "text-to-image" => 0,
        "image-to-text" => 3,
        "image-to-image" => 4,
        _ => 0,
    }
}

fn max_image_count(category: &str) -> i64 {
    match category {
        "text-to-image" | "image-to-image" => 4,
        _ => 1,
    }
}
