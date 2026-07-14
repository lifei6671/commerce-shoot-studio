import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { localShellPort } from "./shell";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localShellPort", () => {
  it("chooses a directory through the shell_choose_directory command", async () => {
    invokeMock.mockResolvedValueOnce("/tmp/workspace");

    await expect(
      localShellPort.chooseDirectory({
        defaultPath: "/tmp",
        title: "选择工作区",
      }),
    ).resolves.toBe("/tmp/workspace");

    expect(invokeMock).toHaveBeenCalledWith("shell_choose_directory", {
      input: {
        defaultPath: "/tmp",
        title: "选择工作区",
      },
    });
  });

  it("reveals a path through the shell_reveal_path command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(localShellPort.revealPath("/tmp/workspace")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("shell_reveal_path", {
      path: "/tmp/workspace",
    });
  });

  it("keeps notify as a runtime command even when system notification is disabled", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(
      localShellPort.notify({
        body: "任务完成",
        title: "商拍工坊",
      }),
    ).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("shell_notify", {
      input: {
        body: "任务完成",
        title: "商拍工坊",
      },
    });
  });
});
