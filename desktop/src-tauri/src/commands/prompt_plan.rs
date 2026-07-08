use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::prompt_plan::{CreatePromptPlanInput, PromptPlan, PromptPlanService};

#[tauri::command]
pub async fn prompt_plan_create(input: CreatePromptPlanInput) -> Result<PromptPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        PromptPlanService::new()
            .create_plan(&default_workspace_directory(), input)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("场景描述生成任务执行失败：{error}"))?
}
