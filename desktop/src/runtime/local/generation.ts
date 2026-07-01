import { invoke } from "@tauri-apps/api/core";
import type {
  CreateGenerationTaskInput,
  GenerationPort,
  GenerationTask,
  GenerationTaskDetail,
  GenerationTaskPage,
  GenerationTaskQuery,
  RetryGenerationTaskInput,
} from "../index";

export const localGenerationPort: GenerationPort = {
  createTask(input: CreateGenerationTaskInput) {
    return invoke<GenerationTask>("generation_create_task", { input });
  },
  retryTask(input: RetryGenerationTaskInput) {
    return invoke<GenerationTask>("generation_retry_task", { input });
  },
  cancelTask(taskId: string) {
    return invoke<GenerationTask>("generation_cancel_task", { taskId });
  },
  deleteTask(taskId: string) {
    return invoke("generation_delete_task", { taskId });
  },
  getTask(taskId: string) {
    return invoke<GenerationTask>("generation_get_task", { taskId });
  },
  getTaskDetail(taskId: string) {
    return invoke<GenerationTaskDetail>("generation_get_task_detail", { taskId });
  },
  listTasks(query?: GenerationTaskQuery) {
    return invoke<GenerationTaskPage>("generation_list_tasks", { query });
  },
};
