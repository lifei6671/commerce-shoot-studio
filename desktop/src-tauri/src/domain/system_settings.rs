use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettings {
    pub launch_at_login: bool,
    pub close_to_tray: bool,
    pub notify_on_task_success: bool,
    pub notify_on_task_failure: bool,
    pub notification_duration_seconds: u32,
    pub workspace_root: String,
    pub default_save_location: DefaultSaveLocation,
    pub auto_backup_enabled: bool,
    pub backup_frequency: BackupFrequency,
    pub backup_retention_count: u32,
    pub auto_cache_cleanup_enabled: bool,
    pub cache_cleanup_threshold_gb: u32,
    pub proxy: ProxySettings,
    pub ui_language: UiLanguage,
    pub theme_mode: ThemeMode,
    pub log_level: LogLevel,
}

impl SystemSettings {
    pub fn with_workspace_root(workspace_root: String) -> Self {
        Self {
            workspace_root,
            ..Self::default()
        }
    }
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            close_to_tray: true,
            notify_on_task_success: true,
            notify_on_task_failure: true,
            notification_duration_seconds: 5,
            workspace_root: String::new(),
            default_save_location: DefaultSaveLocation::Workspace,
            auto_backup_enabled: true,
            backup_frequency: BackupFrequency::Daily,
            backup_retention_count: 7,
            auto_cache_cleanup_enabled: true,
            cache_cleanup_threshold_gb: 10,
            proxy: ProxySettings::default(),
            ui_language: UiLanguage::FollowSystem,
            theme_mode: ThemeMode::FollowSystem,
            log_level: LogLevel::Info,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettingsView {
    pub settings: SystemSettings,
    pub current_workspace_root: String,
    pub system_proxy_detected: bool,
    pub workspace_change_requires_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProxyResult {
    pub test_url: String,
    pub status_code: u16,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DefaultSaveLocation {
    Workspace,
    AskEveryTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackupFrequency {
    Daily,
    Weekly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UiLanguage {
    FollowSystem,
    ZhCn,
    EnUs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    FollowSystem,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    pub mode: ProxyMode,
    pub protocol: ProxyProtocol,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: String,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            mode: ProxyMode::None,
            protocol: ProxyProtocol::Http,
            host: String::new(),
            port: None,
            username: String::new(),
            password: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    None,
    System,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyProtocol {
    Http,
    Https,
    Socks5,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub total_bytes: u64,
    pub thumbnail_cache_bytes: u64,
    pub temporary_files_bytes: u64,
    pub model_response_cache_bytes: u64,
    pub other_cache_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearCacheResult {
    pub removed_bytes: u64,
    pub removed_files: u64,
    pub stats: CacheStats,
}
