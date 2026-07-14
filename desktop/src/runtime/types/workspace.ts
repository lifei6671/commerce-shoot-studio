import type { DateTimeString } from "./common";

export type WorkspaceStatus = {
  initialized: boolean;
  workspaceDirectory?: string;
  databasePath?: string;
  unavailableReason?: string;
  warnings?: string[];
  updatedAt: DateTimeString;
};

export type InitializeWorkspaceInput = {
  workspaceDirectory: string;
};

export type SwitchWorkspaceInput = InitializeWorkspaceInput;

export type WorkspaceRepairResult = {
  repaired: boolean;
  messages: string[];
};

export type WorkspaceStorageUsage = {
  assetBytes: number;
  cacheBytes: number;
  exportBytes: number;
  logBytes: number;
  totalBytes: number;
};

export type GarbageCollectionResult = {
  deletedFiles: number;
  reclaimedBytes: number;
};
