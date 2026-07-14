import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localGenerationPort } from "./generation";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localGenerationPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates task creation and listing to Tauri commands", async () => {
    invokeMock.mockResolvedValueOnce({ id: "task_1", status: "queued" });
    invokeMock.mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0 });

    await localGenerationPort.createTask({
      idempotencyKey: "click-1",
      inputAssets: [{ assetId: "asset_1", role: "source", sortOrder: 0 }],
      kind: "image-generation",
      title: "场景图",
      workspace: "scene",
    });
    await localGenerationPort.listTasks({ workspace: "scene", page: 1, pageSize: 20 });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "generation_create_task", {
      input: {
        idempotencyKey: "click-1",
        inputAssets: [{ assetId: "asset_1", role: "source", sortOrder: 0 }],
        kind: "image-generation",
        title: "场景图",
        workspace: "scene",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "generation_list_tasks", {
      query: { workspace: "scene", page: 1, pageSize: 20 },
    });
  });

  it("delegates retry, cancel, get and delete commands", async () => {
    invokeMock.mockResolvedValueOnce({ id: "task_retry" });
    invokeMock.mockResolvedValueOnce({ id: "task_1", status: "cancelled" });
    invokeMock.mockResolvedValueOnce({ id: "task_1" });
    invokeMock.mockResolvedValueOnce({
      events: [],
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_1",
            relativePath: "assets/generated/generated-1.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: { id: "task_1" },
    });
    invokeMock.mockResolvedValueOnce({ workspaceDirectory: "/tmp/workspace" });
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce({ invocationId: "inv_1", taskId: "task_1" });
    invokeMock.mockResolvedValueOnce({ invocationId: "inv_2", taskId: "task_retry" });

    await localGenerationPort.retryTask({ taskId: "task_1" });
    await localGenerationPort.cancelTask("task_retry");
    await localGenerationPort.getTask("task_retry");
    const detail = await localGenerationPort.getTaskDetail("task_retry");
    await localGenerationPort.deleteTask("task_retry");
    await localGenerationPort.runNext();
    await localGenerationPort.runTask("task_retry");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "generation_retry_task", {
      input: { taskId: "task_1" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "generation_cancel_task", {
      taskId: "task_retry",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "generation_get_task", {
      taskId: "task_retry",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "generation_get_task_detail", {
      taskId: "task_retry",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "workspace_get_status");
    expect(invokeMock).toHaveBeenNthCalledWith(6, "generation_delete_task", {
      taskId: "task_retry",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(7, "generation_run_next_task");
    expect(invokeMock).toHaveBeenNthCalledWith(8, "generation_run_task", {
      taskId: "task_retry",
    });
    expect(detail.outputAssets[0].asset.localPath).toBe("/tmp/workspace/assets/generated/generated-1.png");
    expect(detail.outputAssets[0].asset.url).toBe("asset://localhost//tmp/workspace/assets/generated/generated-1.png");
  });
});
