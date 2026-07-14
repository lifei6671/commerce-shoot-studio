import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { localRuntimeInfoPort } from "./runtime-info";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localRuntimeInfoPort", () => {
  it("loads runtime info through the runtime_info command", async () => {
    invokeMock.mockResolvedValueOnce({
      features: {
        mode: "local",
        supportsDirectoryPicker: true,
        supportsLocalFileReveal: true,
        supportsLocalModelConfig: true,
        supportsSecretManagement: true,
        supportsSystemNotification: true,
        supportsWorkspaceSwitch: true,
      },
      mode: "local",
      version: "0.1.0-test",
    });

    await expect(localRuntimeInfoPort.getRuntimeInfo()).resolves.toMatchObject({
      features: {
        supportsLocalModelConfig: true,
        supportsSecretManagement: true,
      },
      mode: "local",
    });
    expect(invokeMock).toHaveBeenCalledWith("runtime_info");
  });
});
