import type { DateTimeString, PageRequest, PageResult, WorkspaceKind } from "./common";
import type { Asset } from "./assets";
import type { NormalizedTaskError } from "./errors";

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export type GenerationTaskStage =
  | "queued"
  | "validating"
  | "rendering-prompt"
  | "calling-provider"
  | "polling-provider"
  | "downloading-result"
  | "saving-result"
  | "completed"
  | "failed";

export type GenerationTaskKind = "prompt-plan" | "image-generation" | "image-edit" | "listing-copy";
export type GenerationTaskInputAssetRole = "source" | "reference" | "model";

export type GenerationTaskInputAssetInput = {
  assetId: string;
  role: GenerationTaskInputAssetRole;
  sortOrder: number;
};

export type GenerationTask = {
  id: string;
  retryOfTaskId?: string;
  attemptNo: number;
  idempotencyKey?: string;
  workspace: WorkspaceKind;
  kind: GenerationTaskKind;
  status: GenerationTaskStatus;
  stage: GenerationTaskStage;
  title: string;
  inputSummary?: string;
  promptPlanId?: string;
  error?: NormalizedTaskError;
  createdAt: DateTimeString;
  updatedAt: DateTimeString;
  completedAt?: DateTimeString;
};

export type GenerationTaskAsset = {
  role: string;
  sortOrder: number;
  asset: Asset;
};

export type TaskEvent = {
  id: string;
  eventType: string;
  stage?: GenerationTaskStage;
  detail?: unknown;
  createdAt: DateTimeString;
};

export type GenerationTaskDetail = {
  task: GenerationTask;
  input?: unknown;
  promptPlanSnapshot?: unknown;
  output?: unknown;
  inputAssets: GenerationTaskAsset[];
  outputAssets: GenerationTaskAsset[];
  events: TaskEvent[];
};

export type GenerationTaskQuery = PageRequest & {
  workspace?: WorkspaceKind;
  status?: GenerationTaskStatus;
};

export type GenerationTaskPage = PageResult<GenerationTask>;

export type LocalTaskExecutionResult = {
  taskId: string;
  invocationId?: string;
};

export type CreateGenerationTaskInput = {
  idempotencyKey?: string;
  workspace: WorkspaceKind;
  kind: GenerationTaskKind;
  title: string;
  promptPlanId?: string;
  input?: unknown;
  promptPlanSnapshot?: unknown;
  inputAssets?: GenerationTaskInputAssetInput[];
};

export type RetryGenerationTaskInput = {
  taskId: string;
};
