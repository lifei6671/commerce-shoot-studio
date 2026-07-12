import type {
  CreateGenerationTaskInput,
  DeleteGenerationResultImageInput,
  GenerationTask,
  GenerationTaskDetail,
  GenerationTaskPage,
  GenerationTaskQuery,
  LocalTaskExecutionResult,
  ReplaceGenerationResultImageInput,
  RetryGenerationTaskInput,
} from "../types";

export interface GenerationPort {
  createTask(input: CreateGenerationTaskInput): Promise<GenerationTask>;
  retryTask(input: RetryGenerationTaskInput): Promise<GenerationTask>;
  cancelTask(taskId: string): Promise<GenerationTask>;
  deleteTask(taskId: string): Promise<void>;
  replaceResultImage(input: ReplaceGenerationResultImageInput): Promise<void>;
  deleteResultImage(input: DeleteGenerationResultImageInput): Promise<void>;
  getTask(taskId: string): Promise<GenerationTask>;
  getTaskDetail(taskId: string): Promise<GenerationTaskDetail>;
  listTasks(query?: GenerationTaskQuery): Promise<GenerationTaskPage>;
  runNext(): Promise<LocalTaskExecutionResult | null>;
  runTask(taskId: string): Promise<LocalTaskExecutionResult | null>;
}
