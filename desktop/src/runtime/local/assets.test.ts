import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localAssetPort } from "./assets";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localAssetPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates asset list query to Tauri command", async () => {
    invokeMock.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });

    const result = await localAssetPort.listAssets({ kind: "source", page: 1, pageSize: 20 });

    expect(invokeMock).toHaveBeenCalledWith("asset_list", {
      query: { kind: "source", page: 1, pageSize: 20 },
    });
    expect(result.total).toBe(0);
  });

  it("delegates import, reveal and delete commands", async () => {
    invokeMock.mockResolvedValueOnce([{ id: "asset_1" }]);
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce(undefined);

    await localAssetPort.importImages({ kind: "reference", paths: ["/tmp/a.png"] });
    await localAssetPort.revealAsset("asset_1");
    await localAssetPort.deleteAsset("asset_1");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "asset_import_images", {
      input: { kind: "reference", paths: ["/tmp/a.png"] },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "asset_reveal", { assetId: "asset_1" });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "asset_delete", { assetId: "asset_1" });
  });

  it("delegates builtin model listing to Tauri command", async () => {
    invokeMock.mockResolvedValue([{ id: "builtin-a", label: "内置模特 01", fileName: "a.png", path: "/app/a.png" }]);

    const result = await localAssetPort.listBuiltinModels();

    expect(invokeMock).toHaveBeenCalledWith("asset_list_builtin_models");
    expect(result[0].label).toBe("内置模特 01");
  });
});
