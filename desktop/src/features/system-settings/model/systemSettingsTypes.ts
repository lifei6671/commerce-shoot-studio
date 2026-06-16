export type DefaultSaveLocation = "workspace" | "ask_every_time";
export type BackupFrequency = "daily" | "weekly";
export type UiLanguage = "follow_system" | "zh_cn" | "en_us";
export type ThemeMode = "follow_system" | "light" | "dark";
export type LogLevel = "error" | "warn" | "info" | "debug";
export type ProxyMode = "none" | "system" | "manual";
export type ProxyProtocol = "http" | "https";

export type ProxySettings = {
  mode: ProxyMode;
  protocol: ProxyProtocol;
  host: string;
  port?: number | null;
  username: string;
  password: string;
};

export type SystemSettings = {
  launchAtLogin: boolean;
  closeToTray: boolean;
  notifyOnTaskSuccess: boolean;
  notifyOnTaskFailure: boolean;
  notificationDurationSeconds: number;
  workspaceRoot: string;
  defaultSaveLocation: DefaultSaveLocation;
  autoBackupEnabled: boolean;
  backupFrequency: BackupFrequency;
  backupRetentionCount: number;
  autoCacheCleanupEnabled: boolean;
  cacheCleanupThresholdGb: number;
  proxy: ProxySettings;
  uiLanguage: UiLanguage;
  themeMode: ThemeMode;
  logLevel: LogLevel;
};

export type SystemSettingsView = {
  settings: SystemSettings;
  currentWorkspaceRoot: string;
  systemProxyDetected: boolean;
  workspaceChangeRequiresRestart: boolean;
};

export type TestProxyResult = {
  testUrl: string;
  statusCode: number;
  elapsedMs: number;
};

export type CacheStats = {
  totalBytes: number;
  thumbnailCacheBytes: number;
  temporaryFilesBytes: number;
  modelResponseCacheBytes: number;
  otherCacheBytes: number;
};

export type ClearCacheResult = {
  removedBytes: number;
  removedFiles: number;
  stats: CacheStats;
};
