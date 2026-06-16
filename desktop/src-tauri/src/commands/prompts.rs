use tauri::State;

use crate::domain::prompt::{
    PromptBinding, PromptPreset, PromptPresetScenario, PromptTemplate, ResolvedPrompt,
    SavePromptBindingRequest, SavePromptPresetRequest, SavePromptPresetScenarioRequest,
    SavePromptTemplateRequest,
};
use crate::error::AppResult;
use crate::services::prompt_presets::{
    list_prompt_preset_scenarios as list_scenarios, list_prompt_presets as list_presets,
    save_prompt_preset_request, save_prompt_preset_scenario_request,
};
use crate::services::prompt_resolver::{
    get_prompt_binding_for_combination, preview_resolved_prompt_for_combination,
    save_prompt_binding_request,
};
use crate::services::prompt_templates::{
    delete_prompt_template_by_id, list_prompt_templates as list_templates,
    restore_default_prompt_templates as restore_templates, save_prompt_template_request,
};
use crate::state::AppState;

#[tauri::command]
pub async fn save_prompt_binding(
    state: State<'_, AppState>,
    binding: SavePromptBindingRequest,
) -> AppResult<PromptBinding> {
    save_prompt_binding_request(state.database(), binding).await
}

#[tauri::command]
pub async fn get_prompt_binding(
    state: State<'_, AppState>,
    combination_id: String,
) -> AppResult<Option<PromptBinding>> {
    get_prompt_binding_for_combination(state.database(), &combination_id).await
}

#[tauri::command]
pub async fn preview_resolved_prompt(
    state: State<'_, AppState>,
    combination_id: String,
    draft_prompt_binding: Option<SavePromptBindingRequest>,
    revision: Option<u64>,
) -> AppResult<ResolvedPrompt> {
    preview_resolved_prompt_for_combination(
        state.database(),
        &combination_id,
        draft_prompt_binding,
        revision,
    )
    .await
}

#[tauri::command]
pub async fn list_prompt_templates(state: State<'_, AppState>) -> AppResult<Vec<PromptTemplate>> {
    list_templates(state.database()).await
}

#[tauri::command]
pub async fn list_prompt_presets(state: State<'_, AppState>) -> AppResult<Vec<PromptPreset>> {
    list_presets(state.database()).await
}

#[tauri::command]
pub async fn save_prompt_preset(
    state: State<'_, AppState>,
    preset: SavePromptPresetRequest,
) -> AppResult<PromptPreset> {
    save_prompt_preset_request(state.database(), preset).await
}

#[tauri::command]
pub async fn list_prompt_preset_scenarios(
    state: State<'_, AppState>,
) -> AppResult<Vec<PromptPresetScenario>> {
    list_scenarios(state.database()).await
}

#[tauri::command]
pub async fn save_prompt_preset_scenario(
    state: State<'_, AppState>,
    scenario: SavePromptPresetScenarioRequest,
) -> AppResult<PromptPresetScenario> {
    save_prompt_preset_scenario_request(state.database(), scenario).await
}

#[tauri::command]
pub async fn save_prompt_template(
    state: State<'_, AppState>,
    template: SavePromptTemplateRequest,
) -> AppResult<PromptTemplate> {
    save_prompt_template_request(state.database(), template).await
}

#[tauri::command]
pub async fn delete_prompt_template(state: State<'_, AppState>, id: String) -> AppResult<()> {
    delete_prompt_template_by_id(state.database(), &id).await
}

#[tauri::command]
pub async fn restore_default_prompt_templates(
    state: State<'_, AppState>,
) -> AppResult<Vec<PromptTemplate>> {
    restore_templates(state.database()).await
}
