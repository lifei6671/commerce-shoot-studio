import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { localSettingsPort } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localSettingsPort", () => {
  it("loads settings through the settings_get command", async () => {
    invokeMock.mockResolvedValueOnce({
      retainGenerationHistory: true,
      restoreWorkspaceOnLaunch: true,
      showFailureNotifications: false,
      showSystemNotifications: false,
      showTaskDoneNotifications: false,
    });

    await expect(localSettingsPort.getSettings()).resolves.toMatchObject({
      restoreWorkspaceOnLaunch: true,
      showSystemNotifications: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("settings_get");
  });

  it("saves partial settings through the settings_save command", async () => {
    invokeMock.mockResolvedValueOnce({
      outputDirectory: "exports/custom",
      retainGenerationHistory: true,
      restoreWorkspaceOnLaunch: false,
      showFailureNotifications: false,
      showSystemNotifications: false,
      showTaskDoneNotifications: false,
    });

    await localSettingsPort.saveSettings({
      outputDirectory: "exports/custom",
      restoreWorkspaceOnLaunch: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("settings_save", {
      input: {
        outputDirectory: "exports/custom",
        restoreWorkspaceOnLaunch: false,
      },
    });
  });

  it("plays notification sound through the settings_play_notification_sound command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await localSettingsPort.playNotificationSound("viral");

    expect(invokeMock).toHaveBeenCalledWith("settings_play_notification_sound", {
      soundId: "viral",
    });
  });

  it("allows clearing optional directory settings with null", async () => {
    invokeMock.mockResolvedValueOnce({
      retainGenerationHistory: true,
      restoreWorkspaceOnLaunch: true,
      showFailureNotifications: false,
      showSystemNotifications: false,
      showTaskDoneNotifications: false,
    });

    await localSettingsPort.saveSettings({
      outputDirectory: null,
    });

    expect(invokeMock).toHaveBeenCalledWith("settings_save", {
      input: {
        outputDirectory: null,
      },
    });
  });
});
