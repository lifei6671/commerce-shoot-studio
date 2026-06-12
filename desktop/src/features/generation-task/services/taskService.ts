import { invoke } from "@tauri-apps/api/core";

import type {
  GenerationTaskDetail,
  LocalGenerationTask,
  StartGenerationRequest,
} from "../model/taskTypes";

export async function startGeneration(
  request: StartGenerationRequest,
): Promise<LocalGenerationTask> {
  return invoke<LocalGenerationTask>("start_generation", { request });
}

export async function cancelGenerationTask(taskId: string): Promise<void> {
  return invoke<void>("cancel_generation_task", { taskId });
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
