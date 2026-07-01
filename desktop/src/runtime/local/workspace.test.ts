import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localWorkspacePort } from "./workspace";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localWorkspacePort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates garbage collection to Tauri command", async () => {
    invokeMock.mockResolvedValue({ deletedFiles: 1, reclaimedBytes: 128 });

    const result = await localWorkspacePort.runGarbageCollection();

    expect(invokeMock).toHaveBeenCalledWith("workspace_run_garbage_collection");
    expect(result).toEqual({ deletedFiles: 1, reclaimedBytes: 128 });
  });

  it("delegates storage usage to Tauri command", async () => {
    invokeMock.mockResolvedValue({
      assetBytes: 1,
      cacheBytes: 2,
      exportBytes: 3,
      logBytes: 4,
      totalBytes: 10,
    });

    const result = await localWorkspacePort.getStorageUsage();

    expect(invokeMock).toHaveBeenCalledWith("workspace_get_storage_usage");
    expect(result).toEqual({
      assetBytes: 1,
      cacheBytes: 2,
      exportBytes: 3,
      logBytes: 4,
      totalBytes: 10,
    });
  });
});
