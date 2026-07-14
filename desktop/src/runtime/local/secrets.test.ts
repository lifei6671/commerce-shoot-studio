import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localSecretPort } from "./secrets";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localSecretPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates secret commands to Tauri", async () => {
    const scope = { capabilityId: "scene-image-generation" as const, providerProfileId: "openai-compatible" };
    invokeMock.mockResolvedValueOnce({ configured: false, storage: "sqlite-local" });
    invokeMock.mockResolvedValueOnce("sk-test");
    invokeMock.mockResolvedValueOnce({ configured: true, storage: "sqlite-local" });
    invokeMock.mockResolvedValueOnce({ ok: true });
    invokeMock.mockResolvedValueOnce(undefined);

    await localSecretPort.getSecretStatus(scope);
    await localSecretPort.revealSecret(scope);
    await localSecretPort.saveSecret(scope, "sk-test");
    await localSecretPort.testProviderConnection(scope);
    await localSecretPort.deleteSecret(scope);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "secret_get_status", { scope });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "secret_reveal", { scope });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "secret_save", { scope, value: "sk-test" });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "secret_test_provider_connection", { scope });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "secret_delete", { scope });
  });
});
