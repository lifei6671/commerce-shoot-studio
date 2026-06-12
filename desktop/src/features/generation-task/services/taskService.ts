import { invoke } from "@tauri-apps/api/core";

import type {
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
