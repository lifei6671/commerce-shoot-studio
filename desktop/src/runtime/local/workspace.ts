import { invoke } from "@tauri-apps/api/core";
import type {
  GarbageCollectionResult,
  InitializeWorkspaceInput,
  WorkspacePort,
  WorkspaceStatus,
  WorkspaceStorageUsage,
} from "../index";

export const localWorkspacePort: Pick<
  WorkspacePort,
  "getStorageUsage" | "getWorkspaceStatus" | "initializeWorkspace" | "runGarbageCollection"
> = {
  getWorkspaceStatus() {
    return invoke<WorkspaceStatus>("workspace_get_status");
  },
  initializeWorkspace(input: InitializeWorkspaceInput) {
    return invoke<WorkspaceStatus>("workspace_initialize", input);
  },
  getStorageUsage() {
    return invoke<WorkspaceStorageUsage>("workspace_get_storage_usage");
  },
  runGarbageCollection() {
    return invoke<GarbageCollectionResult>("workspace_run_garbage_collection");
  },
};
