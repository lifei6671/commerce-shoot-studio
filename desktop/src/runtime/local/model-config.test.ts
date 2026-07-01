import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localModelConfigPort } from "./model-config";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localModelConfigPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates config commands to Tauri", async () => {
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce([{ id: "mock-local" }]);
    invokeMock.mockResolvedValueOnce({ id: "cfg_1" });
    invokeMock.mockResolvedValueOnce({ id: "cfg_1", isDefault: true });
    invokeMock.mockResolvedValueOnce({ ok: true });
    invokeMock.mockResolvedValueOnce(undefined);

    await localModelConfigPort.listConfigs();
    await localModelConfigPort.listProviderProfiles();
    await localModelConfigPort.saveConfig({
      capabilityId: "scene-image-generation",
      displayName: "场景 Mock",
      enabled: true,
      executionMode: "sync",
      model: "mock-scene-image-v1",
      providerProfileId: "mock-local",
    });
    await localModelConfigPort.setDefaultConfig({
      capabilityId: "scene-image-generation",
      configId: "cfg_1",
    });
    await localModelConfigPort.testConfig("cfg_1");
    await localModelConfigPort.deleteConfig("cfg_1");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "model_config_list_configs");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "model_config_list_provider_profiles");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "model_config_save_config", {
      input: {
        capabilityId: "scene-image-generation",
        displayName: "场景 Mock",
        enabled: true,
        executionMode: "sync",
        model: "mock-scene-image-v1",
        providerProfileId: "mock-local",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "model_config_set_default_config", {
      input: { capabilityId: "scene-image-generation", configId: "cfg_1" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "model_config_test_config", {
      configId: "cfg_1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, "model_config_delete_config", {
      configId: "cfg_1",
    });
  });
});
