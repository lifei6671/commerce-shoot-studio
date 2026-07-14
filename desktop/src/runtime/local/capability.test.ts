import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localCapabilityPort } from "./capability";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localCapabilityPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates capability commands to Tauri", async () => {
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce({ id: "prompt-plan", available: true });

    await localCapabilityPort.listCapabilities();
    await localCapabilityPort.getCapability("prompt-plan");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "capability_list_capabilities");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "capability_get_capability", {
      capabilityId: "prompt-plan",
    });
  });
});
