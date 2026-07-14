export type AppSettings = {
  autoCreateDateFolders: boolean;
  launchAtLogin: boolean;
  minimizeToTrayOnClose: boolean;
  notificationSound: "clear" | "soft" | "success" | "viral";
  workspaceDirectory?: string;
  outputDirectory?: string;
  restoreWorkspaceOnLaunch: boolean;
  showSystemNotifications: boolean;
  showTaskDoneNotifications: boolean;
  showFailureNotifications: boolean;
  retainGenerationHistory: boolean;
};

export type SaveSettingsInput = Partial<Omit<AppSettings, "outputDirectory" | "workspaceDirectory">> & {
  outputDirectory?: string | null;
  workspaceDirectory?: string | null;
};
