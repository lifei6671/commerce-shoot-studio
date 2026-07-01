import type {
  CreateGenerationTaskInput,
  GenerationTask,
  GenerationTaskDetail,
  GenerationTaskPage,
  GenerationTaskQuery,
  RetryGenerationTaskInput,
} from "../types";

export interface GenerationPort {
  createTask(input: CreateGenerationTaskInput): Promise<GenerationTask>;
  retryTask(input: RetryGenerationTaskInput): Promise<GenerationTask>;
  cancelTask(taskId: string): Promise<GenerationTask>;
  deleteTask(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<GenerationTask>;
  getTaskDetail(taskId: string): Promise<GenerationTaskDetail>;
  listTasks(query?: GenerationTaskQuery): Promise<GenerationTaskPage>;
}
