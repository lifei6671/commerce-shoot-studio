import type {
  GarbageCollectionResult,
  InitializeWorkspaceInput,
  SwitchWorkspaceInput,
  WorkspaceRepairResult,
  WorkspaceStatus,
  WorkspaceStorageUsage,
} from "../types";

export interface WorkspacePort {
  getWorkspaceStatus(): Promise<WorkspaceStatus>;
  initializeWorkspace(input: InitializeWorkspaceInput): Promise<WorkspaceStatus>;
  switchWorkspace(input: SwitchWorkspaceInput): Promise<WorkspaceStatus>;
  repairWorkspace(): Promise<WorkspaceRepairResult>;
  getStorageUsage(): Promise<WorkspaceStorageUsage>;
  runGarbageCollection(): Promise<GarbageCollectionResult>;
}
