use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFeatureFlagsDto {
    mode: String,
    supports_local_file_reveal: bool,
    supports_directory_picker: bool,
    supports_system_notification: bool,
    supports_local_model_config: bool,
    supports_secret_management: bool,
    supports_workspace_switch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfoDto {
    mode: String,
    version: String,
    features: RuntimeFeatureFlagsDto,
}

#[tauri::command]
pub fn runtime_info() -> RuntimeInfoDto {
    RuntimeInfoDto {
        mode: "local".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        features: RuntimeFeatureFlagsDto {
            mode: "local".to_string(),
            supports_local_file_reveal: true,
            supports_directory_picker: true,
            // 当前尚未接入 notification 插件，不能提前暴露原生通知能力。
            supports_system_notification: false,
            supports_local_model_config: true,
            supports_secret_management: true,
            supports_workspace_switch: false,
        },
    }
}

impl RuntimeInfoDto {
    pub fn mode_name(&self) -> &str {
        &self.mode
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn features(&self) -> &RuntimeFeatureFlagsDto {
        &self.features
    }
}

impl RuntimeFeatureFlagsDto {
    pub fn mode_name(&self) -> &str {
        &self.mode
    }

    pub fn supports_local_file_reveal(&self) -> bool {
        self.supports_local_file_reveal
    }

    pub fn supports_directory_picker(&self) -> bool {
        self.supports_directory_picker
    }

    pub fn supports_system_notification(&self) -> bool {
        self.supports_system_notification
    }

    pub fn supports_local_model_config(&self) -> bool {
        self.supports_local_model_config
    }

    pub fn supports_secret_management(&self) -> bool {
        self.supports_secret_management
    }

    pub fn supports_workspace_switch(&self) -> bool {
        self.supports_workspace_switch
    }
}
