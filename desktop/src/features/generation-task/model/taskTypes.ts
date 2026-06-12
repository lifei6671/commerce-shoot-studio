import type { SaveModelConfigRequest } from "../../model-config/model/modelTypes";
import type { SavePromptBindingRequest } from "../../prompt/model/promptTypes";

export type GenerationTaskStatus =
  | "queued"
  | "preparing"
  | "calling_model"
  | "waiting_result"
  | "saving_result"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunningGenerationTaskStatus = Extract<
  GenerationTaskStatus,
  "queued" | "preparing" | "calling_model" | "waiting_result" | "saving_result"
>;

export type GenerationTaskInputRole = "person" | "garment" | "reference" | "mask";

export type GenerationTaskInputAsset = {
  assetId: string;
  role: GenerationTaskInputRole;
  viewType?: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

export type GenerationTaskRequestSummary = Record<string, unknown>;

export type CreateGenerationTaskSnapshotRequest = {
  id?: string | null;
  combinationId?: string | null;
  provider: string;
  modelId: string;
  requestSummaryJson?: GenerationTaskRequestSummary | null;
  inputSnapshotJson: Record<string, unknown>;
  finalPromptSnapshotJson: Record<string, unknown>;
  modelConfigSnapshotJson: Record<string, unknown>;
  assetSnapshotJson: Record<string, unknown>;
  inputAssets: GenerationTaskInputAsset[];
  outputCount: number;
};

export type StartGenerationRequest = {
  combinationId: string;
  draftPromptBinding?: SavePromptBindingRequest | null;
  draftModelConfig?: SaveModelConfigRequest | null;
  revision?: number | null;
};

export type LocalGenerationTask = {
  id: string;
  combinationId?: string | null;
  provider: string;
  modelId: string;
  status: GenerationTaskStatus;
  progress: number;
  requestSummaryJson?: GenerationTaskRequestSummary | null;
  inputSnapshotJson: Record<string, unknown>;
  finalPromptSnapshotJson: Record<string, unknown>;
  modelConfigSnapshotJson: Record<string, unknown>;
  assetSnapshotJson: Record<string, unknown>;
  outputCount: number;
  createdAt: string;
  updatedAt: string;
};

export type GenerationTaskResult = {
  id: string;
  taskId: string;
  assetId: string;
  sortOrder: number;
  sourceUrl?: string | null;
  createdAt: string;
};

export type GenerationTaskResultAsset = GenerationTaskResult & {
  relativePath: string;
  thumbRelativePath: string;
  filePath: string;
  thumbFilePath: string;
  mimeType: string;
  width: number;
  height: number;
};

export type GenerationTaskDetail = {
  task: LocalGenerationTask;
  results: GenerationTaskResultAsset[];
};
