import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { LocalGenerationTask } from "../model/taskTypes";

const TASK_UPDATED_EVENT = "generation://task-updated";

export async function listenGenerationTaskUpdates(
  handler: (task: LocalGenerationTask) => void,
): Promise<UnlistenFn> {
  return listen<LocalGenerationTask>(TASK_UPDATED_EVENT, (event) => {
    handler(event.payload);
  });
}
