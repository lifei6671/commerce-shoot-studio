use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::capability::{CapabilityService, ModelCapabilityView};

#[tauri::command]
pub fn capability_list_capabilities() -> Result<Vec<ModelCapabilityView>, String> {
    CapabilityService::new()
        .list_capabilities(&default_workspace_directory())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn capability_get_capability(capability_id: String) -> Result<ModelCapabilityView, String> {
    CapabilityService::new()
        .get_capability(&default_workspace_directory(), &capability_id)
        .map_err(|error| error.to_string())
}
