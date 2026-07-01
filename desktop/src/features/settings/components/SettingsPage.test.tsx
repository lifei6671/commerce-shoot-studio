import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import type { RuntimeInfo, RuntimeInfoPort, SettingsPort, ShellPort, WorkspacePort } from "../../../runtime";
import { ToastProvider } from "../../../shared/ui/toast";
import type { AppSettings } from "../../../runtime";

function createSettingsPort(): SettingsPort {
  return {
    getSettings: vi.fn(() =>
      Promise.resolve({
        autoCreateDateFolders: true,
        launchAtLogin: false,
        minimizeToTrayOnClose: false,
        notificationSound: "clear" as const,
        outputDirectory: "/workspace/exports",
        restoreWorkspaceOnLaunch: false,
        retainGenerationHistory: true,
        showFailureNotifications: true,
        showSystemNotifications: false,
        showTaskDoneNotifications: true,
        workspaceDirectory: "/workspace/current",
      }),
    ),
    playNotificationSound: vi.fn(() => Promise.resolve()),
    saveSettings: vi.fn((input) =>
      Promise.resolve({
        autoCreateDateFolders: input.autoCreateDateFolders ?? true,
        launchAtLogin: input.launchAtLogin ?? false,
        minimizeToTrayOnClose: input.minimizeToTrayOnClose ?? false,
        notificationSound: input.notificationSound ?? ("clear" as const),
        outputDirectory: input.outputDirectory ?? "/workspace/exports",
        restoreWorkspaceOnLaunch: input.restoreWorkspaceOnLaunch ?? false,
        retainGenerationHistory: input.retainGenerationHistory ?? true,
        showFailureNotifications: input.showFailureNotifications ?? true,
        showSystemNotifications: input.showSystemNotifications ?? false,
        showTaskDoneNotifications: input.showTaskDoneNotifications ?? true,
        workspaceDirectory: input.workspaceDirectory ?? "/workspace/current",
      }),
    ),
  };
}

function createWorkspacePort(): Pick<WorkspacePort, "getStorageUsage" | "runGarbageCollection"> {
  return {
    getStorageUsage: vi.fn(() =>
      Promise.resolve({
        assetBytes: 1024 * 1024 * 2,
        cacheBytes: 1024 * 512,
        exportBytes: 1024 * 1024,
        logBytes: 1024,
        totalBytes: 1024 * 1024 * 3 + 1024 * 513,
      }),
    ),
    runGarbageCollection: vi.fn(() => Promise.resolve({ deletedFiles: 1, reclaimedBytes: 1024 })),
  };
}

function createShellPort(): ShellPort {
  return {
    chooseDirectory: vi.fn(() => Promise.resolve("/workspace/chosen")),
    notify: vi.fn(() => Promise.resolve()),
    revealPath: vi.fn(() => Promise.resolve()),
  };
}

function createRuntimeInfoPort(features: Partial<RuntimeInfo["features"]> = {}): RuntimeInfoPort {
  const runtimeInfo: RuntimeInfo = {
    features: {
      mode: "local",
      supportsDirectoryPicker: true,
      supportsLocalFileReveal: true,
      supportsLocalModelConfig: true,
      supportsSecretManagement: true,
      supportsSystemNotification: false,
      supportsWorkspaceSwitch: true,
      ...features,
    },
    mode: "local",
    version: "0.1.0-test",
  };

  return {
    getRuntimeInfo: vi.fn(() => Promise.resolve(runtimeInfo)),
  };
}

describe("SettingsPage", () => {
  function renderSettingsPage(props: ComponentProps<typeof SettingsPage>) {
    return render(
      <ToastProvider>
        <SettingsPage {...props} />
      </ToastProvider>,
    );
  }

  it("loads settings from runtime ports and saves changed output directory after explicit confirmation", async () => {
    const user = userEvent.setup();
    const settingsPort = createSettingsPort();
    const shellPort = createShellPort();
    const runtimeInfoPort = createRuntimeInfoPort();
    const workspacePort = createWorkspacePort();

    renderSettingsPage({
      runtimeInfoPort,
      settingsPort,
      shellPort,
      workspacePort,
    });

    expect(await screen.findByDisplayValue("/workspace/current")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/workspace/exports")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启动时恢复上次工作内容" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    expect(screen.getByText("512 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "系统通知" })).toBeDisabled();
    expect(screen.getByText("当前运行环境暂不支持系统通知")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "选择输出目录" }));

    expect(shellPort.chooseDirectory).toHaveBeenCalledWith({
      defaultPath: "/workspace/exports",
      title: "选择输出目录",
    });
    await waitFor(() =>
      expect(settingsPort.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          outputDirectory: "/workspace/chosen",
          autoCreateDateFolders: true,
          launchAtLogin: false,
          minimizeToTrayOnClose: false,
          notificationSound: "clear",
          restoreWorkspaceOnLaunch: false,
          workspaceDirectory: "/workspace/current",
        }),
      ),
    );
    expect(screen.getByDisplayValue("/workspace/chosen")).toBeInTheDocument();
  });

  it("persists startup and tray toggles through the settings runtime port", async () => {
    const user = userEvent.setup();
    const settingsPort = createSettingsPort();

    renderSettingsPage({
      runtimeInfoPort: createRuntimeInfoPort(),
      settingsPort,
      shellPort: createShellPort(),
      workspacePort: createWorkspacePort(),
    });

    await screen.findByDisplayValue("/workspace/current");
    await user.click(screen.getByRole("button", { name: "开机自动启动" }));
    await user.click(screen.getByRole("button", { name: "关闭窗口时最小化到系统托盘" }));

    await waitFor(() =>
      expect(settingsPort.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          launchAtLogin: true,
          minimizeToTrayOnClose: true,
        }),
      ),
    );
  });

  it("disables workspace directory edits when runtime does not support workspace switching", async () => {
    const user = userEvent.setup();
    const settingsPort = createSettingsPort();
    const shellPort = createShellPort();

    renderSettingsPage({
      runtimeInfoPort: createRuntimeInfoPort({ supportsWorkspaceSwitch: false }),
      settingsPort,
      shellPort,
      workspacePort: createWorkspacePort(),
    });

    const workspaceRow = await screen.findByTestId("workspace-directory-row");
    const outputRow = screen.getByTestId("output-directory-row");

    expect(within(workspaceRow).getByRole("textbox", { name: "工作区目录" })).toBeDisabled();
    expect(within(workspaceRow).getByRole("button", { name: "选择工作区目录" })).toBeDisabled();
    expect(within(outputRow).getByRole("button", { name: "选择输出目录" })).toBeEnabled();

    await user.click(within(workspaceRow).getByRole("button", { name: "选择工作区目录" }));

    expect(shellPort.chooseDirectory).not.toHaveBeenCalled();
  });

  it("serializes immediate saves so OS-level side effects cannot race", async () => {
    const user = userEvent.setup();
    const settingsPort = createSettingsPort();
    const firstSave = createDeferred<AppSettings>();
    const secondSave = createDeferred<AppSettings>();
    vi.mocked(settingsPort.saveSettings)
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    renderSettingsPage({
      runtimeInfoPort: createRuntimeInfoPort(),
      settingsPort,
      shellPort: createShellPort(),
      workspacePort: createWorkspacePort(),
    });

    await screen.findByDisplayValue("/workspace/current");
    await user.click(screen.getByRole("button", { name: "开机自动启动" }));
    await waitFor(() => expect(settingsPort.saveSettings).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "开机自动启动" }));

    expect(settingsPort.saveSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "开机自动启动" })).toHaveAttribute("aria-pressed", "false");

    firstSave.resolve(createSavedSettings({ launchAtLogin: true }));
    await waitFor(() => expect(settingsPort.saveSettings).toHaveBeenCalledTimes(2));
    expect(settingsPort.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ launchAtLogin: false }),
    );

    await act(async () => {
      secondSave.resolve(createSavedSettings({ launchAtLogin: false }));
      await secondSave.promise;
    });

    expect(screen.getByRole("button", { name: "开机自动启动" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reveals workspace and output directories through ShellPort", async () => {
    const user = userEvent.setup();
    const settingsPort = createSettingsPort();
    const shellPort = createShellPort();

    renderSettingsPage({
      runtimeInfoPort: createRuntimeInfoPort(),
      settingsPort,
      shellPort,
      workspacePort: createWorkspacePort(),
    });

    await screen.findByDisplayValue("/workspace/current");

    const workspaceRow = screen.getByTestId("workspace-directory-row");
    await user.click(within(workspaceRow).getByRole("button", { name: "打开文件夹" }));

    expect(shellPort.revealPath).toHaveBeenCalledWith("/workspace/current");
  });

  it("shows a status message when revealing a directory fails", async () => {
    const user = userEvent.setup();
    const shellPort = createShellPort();
    vi.mocked(shellPort.revealPath).mockRejectedValueOnce(new Error("无法打开文件夹"));

    renderSettingsPage({
      runtimeInfoPort: createRuntimeInfoPort(),
      settingsPort: createSettingsPort(),
      shellPort,
      workspacePort: createWorkspacePort(),
    });

    await screen.findByDisplayValue("/workspace/current");
    await user.click(
      within(screen.getByTestId("workspace-directory-row")).getByRole("button", {
        name: "打开文件夹",
      }),
    );

    expect(await screen.findByText("无法打开文件夹")).toBeInTheDocument();
  });
});

function createSavedSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    autoCreateDateFolders: true,
    launchAtLogin: false,
    minimizeToTrayOnClose: false,
    notificationSound: "clear",
    outputDirectory: "/workspace/exports",
    restoreWorkspaceOnLaunch: false,
    retainGenerationHistory: true,
    showFailureNotifications: true,
    showSystemNotifications: false,
    showTaskDoneNotifications: true,
    workspaceDirectory: "/workspace/current",
    ...patch,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}
