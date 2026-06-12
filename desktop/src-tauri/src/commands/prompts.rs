use tauri::State;

use crate::domain::prompt::{PromptBinding, ResolvedPrompt, SavePromptBindingRequest};
use crate::error::AppResult;
use crate::services::prompt_resolver::{
    preview_resolved_prompt_for_combination, save_prompt_binding_request,
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
