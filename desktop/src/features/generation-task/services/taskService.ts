import { invoke } from "@tauri-apps/api/core";

import type {
  GenerationTaskDetail,
  LocalGenerationTask,
  StartGenerationRequest,
} from "../model/taskTypes";
import type { SaveModelConfigRequest } from "../../model-config/model/modelTypes";

export async function startGeneration(
  request: StartGenerationRequest,
): Promise<LocalGenerationTask> {
  return invoke<LocalGenerationTask>("start_generation", { request });
}

export async function cancelGenerationTask(taskId: string): Promise<LocalGenerationTask> {
  return invoke<LocalGenerationTask>("cancel_generation_task", { taskId });
}

export async function getGenerationTaskDetail(
  taskId: string,
): Promise<GenerationTaskDetail | null> {
  return invoke<GenerationTaskDetail | null>("get_generation_task_detail", {
    taskId,
  });
}

export async function getLatestGenerationTaskByCombination(
  combinationId: string,
): Promise<GenerationTaskDetail | null> {
  return invoke<GenerationTaskDetail | null>(
    "get_latest_generation_task_by_combination",
    { combinationId },
  );
}

export async function listRunningGenerationTasks(): Promise<GenerationTaskDetail[]> {
  return invoke<GenerationTaskDetail[]>("list_running_generation_tasks");
}

export async function listRecentGenerationTasks(
  limit = 20,
): Promise<GenerationTaskDetail[]> {
  return invoke<GenerationTaskDetail[]>("list_recent_generation_tasks", {
    limit,
  });
}

export async function openGenerationResult(assetId: string): Promise<void> {
  return invoke<void>("open_generation_result", { assetId });
}

export async function retryGenerationTask(taskId: string): Promise<LocalGenerationTask> {
  return invoke<LocalGenerationTask>("retry_generation_task", { taskId });
}

export async function rerunGenerationFromCurrentCombination(
  combinationId: string,
  modelConfig: SaveModelConfigRequest,
): Promise<LocalGenerationTask> {
  return invoke<LocalGenerationTask>("rerun_generation_from_current_combination", {
    combinationId,
    modelConfig,
  });
}
