use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime};

use chrono::Utc;
use serde_json::json;
use sqlx::Row;
use tauri::Manager;

use crate::domain::system_settings::{
    CacheStats, ClearCacheResult, DefaultSaveLocation, ProxyMode, ProxyProtocol, ProxySettings,
    SystemSettings, SystemSettingsView, TestProxyResult,
};
use crate::error::{AppError, AppResult};
use crate::storage::file_store::WorkspacePaths;
use crate::storage::sqlite::WorkspaceDatabase;

const SETTINGS_FILE: &str = "system-settings.json";
const LAUNCH_AGENT_ID: &str = "com.lifei6671.commerce-shoot-studio";
const PROXY_TEST_TIMEOUT_SECONDS: u64 = 10;
const BYTES_PER_GB: u64 = 1024 * 1024 * 1024;
const AUTO_BACKUP_PREFIX: &str = "workspace-auto-";
const AUTO_BACKUP_SUFFIX: &str = ".db";
#[cfg(not(target_os = "macos"))]
const AUTOSTART_APP_NAME: &str = "Commerce Shoot Studio";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SystemMaintenanceResult {
    pub backup_created: bool,
    pub cache_cleaned: bool,
    pub removed_bytes: u64,
    pub removed_files: u64,
}

pub fn settings_file_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(SETTINGS_FILE)
}

pub fn default_workspace_root(app_handle: &tauri::AppHandle) -> AppResult<PathBuf> {
    let app_config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|_| AppError::WorkspaceUnavailable)?;
    Ok(default_workspace_root_from_app_config_dir(&app_config_dir))
}

fn default_workspace_root_from_app_config_dir(app_config_dir: &Path) -> PathBuf {
    app_config_dir.to_path_buf()
}

pub fn load_system_settings(
    app_config_dir: &Path,
    default_workspace_root: &Path,
) -> AppResult<SystemSettings> {
    let settings_path = settings_file_path(app_config_dir);
    if !settings_path.exists() {
        return Ok(SystemSettings::with_workspace_root(
            default_workspace_root.to_string_lossy().to_string(),
        ));
    }

    let content = fs::read_to_string(settings_path)?;
    let mut settings: SystemSettings = serde_json::from_str(&content)
        .map_err(|err| AppError::InvalidInput(format!("system settings are invalid: {err}")))?;
    if settings.workspace_root.trim().is_empty() {
        settings.workspace_root = default_workspace_root.to_string_lossy().to_string();
    }
    Ok(normalize_system_settings(settings))
}

pub fn save_system_settings(
    app_config_dir: &Path,
    settings: SystemSettings,
) -> AppResult<SystemSettings> {
    fs::create_dir_all(app_config_dir)?;
    let settings = normalize_system_settings(settings);
    if settings.workspace_root.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "workspace root cannot be empty".to_string(),
        ));
    }
    fs::create_dir_all(Path::new(&settings.workspace_root))?;
    apply_launch_at_login(settings.launch_at_login)?;

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|err| AppError::InvalidInput(format!("system settings cannot be saved: {err}")))?;
    fs::write(settings_file_path(app_config_dir), content)?;
    Ok(settings)
}

pub fn system_settings_view(
    app_config_dir: &Path,
    current_workspace_root: &Path,
    default_workspace_root: &Path,
) -> AppResult<SystemSettingsView> {
    let settings = load_system_settings(app_config_dir, default_workspace_root)?;
    let workspace_change_requires_restart =
        normalize_path_text(Path::new(&settings.workspace_root))
            != normalize_path_text(current_workspace_root);
    Ok(SystemSettingsView {
        settings,
        current_workspace_root: current_workspace_root.to_string_lossy().to_string(),
        workspace_change_requires_restart,
    })
}

pub async fn collect_cache_stats(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
) -> AppResult<CacheStats> {
    let referenced_thumbnails = referenced_thumbnail_paths(database).await?;
    Ok(scan_cache_stats(paths, &referenced_thumbnails))
}

pub async fn clear_cache(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
) -> AppResult<ClearCacheResult> {
    let before = collect_cache_stats(database, paths).await?;
    let referenced_thumbnails = referenced_thumbnail_paths(database).await?;
    let (removed_bytes, removed_files) = remove_clearable_cache(paths, &referenced_thumbnails)?;
    let stats = collect_cache_stats(database, paths).await?;
    Ok(ClearCacheResult {
        removed_bytes: removed_bytes.min(before.total_bytes),
        removed_files,
        stats,
    })
}

pub async fn run_system_maintenance(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    settings: &SystemSettings,
) -> AppResult<SystemMaintenanceResult> {
    let settings = normalize_system_settings(settings.clone());
    let mut result = SystemMaintenanceResult::default();

    if settings.auto_backup_enabled {
        result.backup_created = maybe_create_auto_backup(database, paths, &settings).await?;
        prune_auto_backups(paths, settings.backup_retention_count as usize)?;
    }

    if settings.auto_cache_cleanup_enabled {
        let stats = collect_cache_stats(database, paths).await?;
        if stats.total_bytes > u64::from(settings.cache_cleanup_threshold_gb) * BYTES_PER_GB {
            let cleanup = clear_cache(database, paths).await?;
            result.cache_cleaned = cleanup.removed_files > 0 || cleanup.removed_bytes > 0;
            result.removed_bytes = cleanup.removed_bytes;
            result.removed_files = cleanup.removed_files;
        }
    }

    Ok(result)
}

pub fn build_proxy_client(settings: &SystemSettings) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder();
    if settings.proxy.mode == ProxyMode::Manual {
        let proxy_url = manual_proxy_url(&settings.proxy)?;
        let mut proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|err| AppError::InvalidInput(format!("proxy config invalid: {err}")))?;
        if !settings.proxy.username.trim().is_empty() {
            proxy = proxy.basic_auth(&settings.proxy.username, &settings.proxy.password);
        }
        builder = builder.proxy(proxy);
    } else if settings.proxy.mode == ProxyMode::None {
        builder = builder.no_proxy();
    }

    builder
        .build()
        .map_err(|err| AppError::InvalidInput(format!("http client cannot be created: {err}")))
}

pub async fn test_proxy_connection(
    settings: SystemSettings,
    test_domain: &str,
) -> AppResult<TestProxyResult> {
    let settings = normalize_system_settings(settings);
    validate_proxy_settings(&settings)?;
    let test_url = normalize_proxy_test_url(test_domain)?;
    let client = build_proxy_client(&settings)?;
    let started_at = Instant::now();
    let timeout = Duration::from_secs(PROXY_TEST_TIMEOUT_SECONDS);

    let response = match client.head(&test_url).timeout(timeout).send().await {
        Ok(response) if response.status() != reqwest::StatusCode::METHOD_NOT_ALLOWED => response,
        _ => client
            .get(&test_url)
            .timeout(timeout)
            .send()
            .await
            .map_err(|err| AppError::InvalidInput(format!("proxy test failed: {err}")))?,
    };

    let status = response.status();
    if status.is_server_error() {
        return Err(AppError::InvalidInput(format!(
            "proxy test failed with status {}",
            status.as_u16()
        )));
    }

    Ok(TestProxyResult {
        test_url,
        status_code: status.as_u16(),
        elapsed_ms: started_at.elapsed().as_millis(),
    })
}

pub fn notify_generation_finished(app_config_dir: &Path, status: &str, task_id: &str) {
    let fallback_root = app_config_dir.to_path_buf();
    let Ok(settings) = load_system_settings(app_config_dir, &fallback_root) else {
        return;
    };
    let should_notify = match status {
        "succeeded" => settings.notify_on_task_success,
        "failed" => settings.notify_on_task_failure,
        _ => false,
    };
    if !should_notify {
        return;
    }
    let message = match status {
        "succeeded" => format!("任务 {task_id} 已生成完成"),
        "failed" => format!("任务 {task_id} 生成失败，请查看任务历史"),
        _ => return,
    };
    let _ = show_system_notification("商拍工坊", &message, settings.notification_duration_seconds);
}

fn normalize_system_settings(mut settings: SystemSettings) -> SystemSettings {
    settings.notification_duration_seconds = settings.notification_duration_seconds.clamp(3, 30);
    settings.backup_retention_count = settings.backup_retention_count.clamp(1, 30);
    settings.cache_cleanup_threshold_gb = settings.cache_cleanup_threshold_gb.clamp(1, 1024);
    settings.proxy.host = settings.proxy.host.trim().to_string();
    if settings.proxy.protocol == ProxyProtocol::Socks5 {
        settings.proxy.protocol = ProxyProtocol::Http;
    }
    if settings.default_save_location == DefaultSaveLocation::AskEveryTime {
        settings.default_save_location = DefaultSaveLocation::Workspace;
    }
    if settings.proxy.mode == ProxyMode::Manual && settings.proxy.host.is_empty() {
        settings.proxy.mode = ProxyMode::None;
    }
    settings
}

fn manual_proxy_url(proxy: &ProxySettings) -> AppResult<String> {
    let host = proxy.host.trim();
    let port = proxy
        .port
        .ok_or_else(|| AppError::InvalidInput("manual proxy port is required".to_string()))?;
    if host.is_empty() {
        return Err(AppError::InvalidInput(
            "manual proxy host is required".to_string(),
        ));
    }
    let protocol = match proxy.protocol {
        ProxyProtocol::Http => "http",
        ProxyProtocol::Https => "https",
        ProxyProtocol::Socks5 => {
            return Err(AppError::InvalidInput(
                "socks proxy is not supported".to_string(),
            ));
        }
    };
    Ok(format!("{protocol}://{host}:{port}"))
}

fn validate_proxy_settings(settings: &SystemSettings) -> AppResult<()> {
    if settings.proxy.mode != ProxyMode::Manual {
        return Ok(());
    }
    if settings.proxy.host.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "manual proxy host is required".to_string(),
        ));
    }
    if matches!(settings.proxy.port, None | Some(0)) {
        return Err(AppError::InvalidInput(
            "manual proxy port is required".to_string(),
        ));
    }
    Ok(())
}

fn normalize_proxy_test_url(test_domain: &str) -> AppResult<String> {
    let value = test_domain.trim();
    if value.is_empty() || value.chars().any(char::is_whitespace) {
        return Err(AppError::InvalidInput(
            "proxy test domain is invalid".to_string(),
        ));
    }
    if value.starts_with("http://") || value.starts_with("https://") {
        return Ok(value.to_string());
    }
    Ok(format!("https://{value}"))
}

async fn referenced_thumbnail_paths(database: &WorkspaceDatabase) -> AppResult<HashSet<String>> {
    let rows = sqlx::query("SELECT thumb_relative_path FROM assets")
        .fetch_all(database.pool())
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("thumb_relative_path").ok())
        .collect())
}

fn scan_cache_stats(paths: &WorkspacePaths, referenced_thumbnails: &HashSet<String>) -> CacheStats {
    let thumbnail_cache_bytes = referenced_thumbnails
        .iter()
        .map(|relative| file_size(paths.root().join(relative)))
        .sum();
    let temporary_files_bytes = dir_size(paths.root().join("cache").join("tmp"))
        + dir_size(paths.root().join("tmp"))
        + dir_size(paths.root().join("temp"));
    let model_response_cache_bytes = dir_size(paths.root().join("cache").join("model"))
        + dir_size(paths.root().join("cache").join("provider"))
        + dir_size(paths.root().join("cache").join("responses"));
    let cache_root = paths.root().join("cache");
    let cache_total = dir_size(&cache_root);
    let other_cache_bytes =
        cache_total.saturating_sub(temporary_files_bytes + model_response_cache_bytes);
    let total_bytes = thumbnail_cache_bytes
        + temporary_files_bytes
        + model_response_cache_bytes
        + other_cache_bytes;
    CacheStats {
        total_bytes,
        thumbnail_cache_bytes,
        temporary_files_bytes,
        model_response_cache_bytes,
        other_cache_bytes,
    }
}

fn remove_clearable_cache(
    paths: &WorkspacePaths,
    referenced_thumbnails: &HashSet<String>,
) -> AppResult<(u64, u64)> {
    let mut removed_bytes = 0;
    let mut removed_files = 0;

    for relative in [
        "cache/tmp",
        "cache/model",
        "cache/provider",
        "cache/responses",
        "tmp",
        "temp",
    ] {
        let (bytes, files) = remove_dir_contents(paths.root().join(relative))?;
        removed_bytes += bytes;
        removed_files += files;
    }

    let thumbnail_root = paths.root().join("assets/cache/thumbs");
    if thumbnail_root.exists() {
        for entry in fs::read_dir(thumbnail_root)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let relative = path
                .strip_prefix(paths.root())
                .ok()
                .map(|value| value.to_string_lossy().replace('\\', "/"));
            if relative
                .as_ref()
                .is_some_and(|value| referenced_thumbnails.contains(value))
            {
                continue;
            }
            let size = file_size(&path);
            fs::remove_file(path)?;
            removed_bytes += size;
            removed_files += 1;
        }
    }

    Ok((removed_bytes, removed_files))
}

async fn maybe_create_auto_backup(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    settings: &SystemSettings,
) -> AppResult<bool> {
    let database_path = paths.database_path();
    if !database_path.exists() {
        return Ok(false);
    }
    if !is_auto_backup_due(paths, settings.backup_frequency.clone())? {
        return Ok(false);
    }

    fs::create_dir_all(paths.backups_dir())?;
    let timestamp = Utc::now().format("%Y%m%d%H%M%S");
    let backup_path = paths.backups_dir().join(format!(
        "{AUTO_BACKUP_PREFIX}{timestamp}{AUTO_BACKUP_SUFFIX}"
    ));
    let backup_path_text = backup_path.to_string_lossy().to_string();
    let mut writer = database.writer().await;
    sqlx::query("VACUUM main INTO ?")
        .bind(backup_path_text)
        .execute(&mut *writer)
        .await?;
    Ok(true)
}

fn is_auto_backup_due(
    paths: &WorkspacePaths,
    frequency: crate::domain::system_settings::BackupFrequency,
) -> AppResult<bool> {
    let interval = match frequency {
        crate::domain::system_settings::BackupFrequency::Daily => Duration::from_secs(24 * 60 * 60),
        crate::domain::system_settings::BackupFrequency::Weekly => {
            Duration::from_secs(7 * 24 * 60 * 60)
        }
    };
    let latest_backup = auto_backup_entries(paths)?
        .into_iter()
        .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
        .max();
    let Some(latest_backup) = latest_backup else {
        return Ok(true);
    };
    Ok(SystemTime::now()
        .duration_since(latest_backup)
        .unwrap_or_default()
        >= interval)
}

fn prune_auto_backups(paths: &WorkspacePaths, retention_count: usize) -> AppResult<()> {
    let mut backups: Vec<(PathBuf, SystemTime)> = auto_backup_entries(paths)?
        .into_iter()
        .filter_map(|path| {
            let modified = fs::metadata(&path).ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect();
    backups.sort_by(|(_, left), (_, right)| right.cmp(left));
    for (path, _) in backups.into_iter().skip(retention_count) {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn auto_backup_entries(paths: &WorkspacePaths) -> AppResult<Vec<PathBuf>> {
    let backups_dir = paths.backups_dir();
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(backups_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if file_name.starts_with(AUTO_BACKUP_PREFIX) && file_name.ends_with(AUTO_BACKUP_SUFFIX) {
            entries.push(path);
        }
    }
    Ok(entries)
}

fn dir_size(path: impl AsRef<Path>) -> u64 {
    let path = path.as_ref();
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return file_size(path);
    }
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| dir_size(entry.path()))
        .sum()
}

fn file_size(path: impl AsRef<Path>) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn remove_dir_contents(path: impl AsRef<Path>) -> AppResult<(u64, u64)> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok((0, 0));
    }
    let mut removed_bytes = 0;
    let mut removed_files = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let size = dir_size(&entry_path);
        let file_count = count_files(&entry_path);
        if entry_path.is_dir() {
            fs::remove_dir_all(entry_path)?;
        } else {
            fs::remove_file(entry_path)?;
        }
        removed_bytes += size;
        removed_files += file_count;
    }
    Ok((removed_bytes, removed_files))
}

fn count_files(path: impl AsRef<Path>) -> u64 {
    let path = path.as_ref();
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return 1;
    }
    fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| count_files(entry.path()))
                .sum()
        })
        .unwrap_or(0)
}

fn normalize_path_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn apply_launch_at_login(enabled: bool) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        apply_macos_launch_agent(enabled)
    }
    #[cfg(target_os = "windows")]
    {
        apply_windows_run_key(enabled)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        apply_linux_autostart(enabled)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = enabled;
        Err(AppError::InvalidInput(
            "launch at login is not supported on this platform".to_string(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_launch_agent(enabled: bool) -> AppResult<()> {
    let home = std::env::var("HOME")
        .map_err(|_| AppError::InvalidInput("HOME is unavailable".to_string()))?;
    let launch_agents = PathBuf::from(home).join("Library/LaunchAgents");
    fs::create_dir_all(&launch_agents)?;
    let plist_path = launch_agents.join(format!("{LAUNCH_AGENT_ID}.plist"));
    if !enabled {
        if plist_path.exists() {
            fs::remove_file(plist_path)?;
        }
        return Ok(());
    }
    let executable = std::env::current_exe()?;
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        executable.to_string_lossy()
    );
    fs::write(plist_path, plist)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_run_key(enabled: bool) -> AppResult<()> {
    let exe = std::env::current_exe()?;
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    if enabled {
        let command_value = windows_startup_command_value(&exe);
        let status = Command::new("reg")
            .args([
                "add",
                key,
                "/v",
                AUTOSTART_APP_NAME,
                "/t",
                "REG_SZ",
                "/d",
                command_value.as_str(),
                "/f",
            ])
            .status()?;
        if !status.success() {
            return Err(AppError::InvalidInput(
                "failed to update Windows startup entry".to_string(),
            ));
        }
    } else {
        let output = Command::new("reg")
            .args(["delete", key, "/v", AUTOSTART_APP_NAME, "/f"])
            .output()?;
        if !output.status.success() {
            let message = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if !is_missing_windows_startup_entry_message(&message) {
                return Err(AppError::InvalidInput(
                    "failed to update Windows startup entry".to_string(),
                ));
            }
        }
    }
    Ok(())
}

#[cfg(any(target_os = "windows", test))]
fn windows_startup_command_value(executable: &Path) -> String {
    format!("\"{}\"", executable.to_string_lossy())
}

#[cfg(any(target_os = "windows", test))]
fn is_missing_windows_startup_entry_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("unable to find the specified registry key or value")
        || lower.contains("system was unable to find")
        || message.contains("系统找不到指定的注册表项或值")
        || message.contains("找不到指定的注册表项")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn apply_linux_autostart(enabled: bool) -> AppResult<()> {
    let home = std::env::var("HOME")
        .map_err(|_| AppError::InvalidInput("HOME is unavailable".to_string()))?;
    let autostart_dir = PathBuf::from(home).join(".config/autostart");
    fs::create_dir_all(&autostart_dir)?;
    let desktop_path = autostart_dir.join("commerce-shoot-studio.desktop");
    if !enabled {
        if desktop_path.exists() {
            fs::remove_file(desktop_path)?;
        }
        return Ok(());
    }
    let exe = std::env::current_exe()?;
    let desktop = format!(
        "[Desktop Entry]\nType=Application\nName={AUTOSTART_APP_NAME}\nExec={}\nX-GNOME-Autostart-enabled=true\n",
        exe.to_string_lossy()
    );
    fs::write(desktop_path, desktop)?;
    Ok(())
}

#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos")), test))]
fn notification_timeout_millis(duration_seconds: u32) -> u32 {
    duration_seconds.clamp(3, 30) * 1000
}

#[cfg(any(target_os = "windows", test))]
fn build_windows_notification_script(title: &str, message: &str, duration_seconds: u32) -> String {
    let timeout_ms = notification_timeout_millis(duration_seconds);
    format!(
        "[reflection.assembly]::LoadWithPartialName('System.Windows.Forms') > $null; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle = {}; $n.BalloonTipText = {}; $n.Visible = $true; $n.ShowBalloonTip({timeout_ms}); Start-Sleep -Milliseconds {timeout_ms};",
        json!(title),
        json!(message)
    )
}

fn show_system_notification(title: &str, message: &str, duration_seconds: u32) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let _ = duration_seconds;
        let script = format!(
            "display notification {} with title {}",
            json!(message),
            json!(title)
        );
        let _ = Command::new("osascript").args(["-e", &script]).status()?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let script = build_windows_notification_script(title, message, duration_seconds);
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .status()?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let timeout_ms = notification_timeout_millis(duration_seconds).to_string();
        let _ = Command::new("notify-send")
            .args(["-t", &timeout_ms, title, message])
            .status()?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sqlite::WorkspaceDatabase;

    #[test]
    fn default_workspace_root_uses_user_app_config_directory() {
        let app_config_dir = PathBuf::from(
            "/Users/tester/Library/Application Support/com.lifei6671.commerce-shoot-studio",
        );

        let root = default_workspace_root_from_app_config_dir(&app_config_dir);

        assert_eq!(root, app_config_dir);
    }

    #[test]
    fn manual_proxy_url_requires_complete_manual_config() {
        let proxy = ProxySettings {
            mode: ProxyMode::Manual,
            protocol: ProxyProtocol::Http,
            host: "127.0.0.1".to_string(),
            port: Some(7890),
            username: String::new(),
            password: String::new(),
        };
        assert_eq!(manual_proxy_url(&proxy).unwrap(), "http://127.0.0.1:7890");
    }

    #[test]
    fn proxy_test_url_defaults_to_https() {
        assert_eq!(
            normalize_proxy_test_url("google.com").unwrap(),
            "https://google.com"
        );
        assert_eq!(
            normalize_proxy_test_url("https://example.com").unwrap(),
            "https://example.com"
        );
        assert!(normalize_proxy_test_url("bad host").is_err());
    }

    #[test]
    fn manual_proxy_validation_requires_host_and_positive_port() {
        let mut settings = SystemSettings::default();
        settings.proxy.mode = ProxyMode::Manual;
        settings.proxy.host = "127.0.0.1".to_string();
        settings.proxy.port = Some(0);
        assert!(validate_proxy_settings(&settings).is_err());

        settings.proxy.port = Some(7890);
        assert!(validate_proxy_settings(&settings).is_ok());
    }

    #[test]
    fn system_settings_normalizes_unsupported_socks_proxy_protocol() {
        let mut settings = SystemSettings::default();
        settings.proxy.protocol = ProxyProtocol::Socks5;

        let normalized = normalize_system_settings(settings);

        assert_eq!(normalized.proxy.protocol, ProxyProtocol::Http);
    }

    #[test]
    fn system_settings_normalizes_unsupported_default_save_location() {
        let mut settings = SystemSettings::default();
        settings.default_save_location = DefaultSaveLocation::AskEveryTime;

        let normalized = normalize_system_settings(settings);

        assert_eq!(
            normalized.default_save_location,
            DefaultSaveLocation::Workspace
        );
    }

    #[test]
    fn windows_startup_delete_missing_entry_is_non_fatal() {
        assert!(is_missing_windows_startup_entry_message(
            "ERROR: The system was unable to find the specified registry key or value."
        ));
        assert!(is_missing_windows_startup_entry_message(
            "错误: 系统找不到指定的注册表项或值。"
        ));
        assert!(!is_missing_windows_startup_entry_message(
            "ERROR: Access is denied."
        ));
    }

    #[test]
    fn windows_startup_command_value_quotes_executable_path() {
        assert_eq!(
            windows_startup_command_value(Path::new(
                r"C:\Program Files\Commerce Shoot Studio\commerce-shoot-studio.exe"
            )),
            r#""C:\Program Files\Commerce Shoot Studio\commerce-shoot-studio.exe""#
        );
    }

    #[test]
    fn windows_notification_script_uses_configured_duration() {
        let script = build_windows_notification_script("商拍工坊", "任务完成", 12);

        assert!(script.contains("ShowBalloonTip(12000)"));
        assert!(script.contains("Start-Sleep -Milliseconds 12000"));
    }

    #[tokio::test]
    async fn system_maintenance_creates_auto_backup_and_cleans_cache_over_threshold() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());
        paths.ensure().expect("workspace");
        let cache_dir = paths.root().join("cache/tmp");
        fs::create_dir_all(&cache_dir).expect("cache dir");
        let cache_file = cache_dir.join("large.tmp");
        fs::File::create(&cache_file)
            .expect("cache file")
            .set_len(BYTES_PER_GB + 1)
            .expect("large cache file");

        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("database");
        sqlx::query(
            "CREATE TABLE assets (
                id TEXT PRIMARY KEY,
                thumb_relative_path TEXT NOT NULL
            )",
        )
        .execute(database.pool())
        .await
        .expect("table");
        let mut settings =
            SystemSettings::with_workspace_root(paths.root().to_string_lossy().to_string());
        settings.auto_backup_enabled = true;
        settings.auto_cache_cleanup_enabled = true;
        settings.cache_cleanup_threshold_gb = 1;

        let result = run_system_maintenance(&database, &paths, &settings)
            .await
            .expect("maintenance");

        assert!(result.backup_created);
        assert!(result.cache_cleaned);
        assert_eq!(
            fs::read_dir(paths.backups_dir()).expect("backups").count(),
            1
        );
        assert!(!cache_file.exists());
    }

    #[tokio::test]
    async fn auto_backup_contains_committed_wal_changes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());
        paths.ensure().expect("workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("database");
        sqlx::query("PRAGMA wal_autocheckpoint = 0")
            .execute(database.pool())
            .await
            .expect("disable autocheckpoint");
        sqlx::query("CREATE TABLE backup_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(database.pool())
            .await
            .expect("create probe table");
        sqlx::query("INSERT INTO backup_probe (id, value) VALUES ('latest', 'committed')")
            .execute(database.pool())
            .await
            .expect("insert probe");
        let mut settings =
            SystemSettings::with_workspace_root(paths.root().to_string_lossy().to_string());
        settings.auto_backup_enabled = true;

        assert!(maybe_create_auto_backup(&database, &paths, &settings)
            .await
            .expect("backup"));
        let backup_path = fs::read_dir(paths.backups_dir())
            .expect("backup dir")
            .next()
            .expect("backup entry")
            .expect("backup entry")
            .path();
        let backup = WorkspaceDatabase::connect(&backup_path)
            .await
            .expect("backup database");
        let value: String =
            sqlx::query_scalar("SELECT value FROM backup_probe WHERE id = 'latest'")
                .fetch_one(backup.pool())
                .await
                .expect("backup row");

        assert_eq!(value, "committed");
    }

    #[tokio::test]
    async fn cache_clear_keeps_referenced_thumbnails() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().to_path_buf());
        paths.ensure().expect("workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("database");
        sqlx::query(
            "CREATE TABLE assets (
                id TEXT PRIMARY KEY,
                thumb_relative_path TEXT NOT NULL
            )",
        )
        .execute(database.pool())
        .await
        .expect("table");
        let referenced = "assets/cache/thumbs/used.jpg";
        let orphan = "assets/cache/thumbs/orphan.jpg";
        fs::create_dir_all(paths.root().join("assets/cache/thumbs")).expect("thumb dir");
        fs::write(paths.root().join(referenced), b"used").expect("used");
        fs::write(paths.root().join(orphan), b"orphan").expect("orphan");
        sqlx::query("INSERT INTO assets (id, thumb_relative_path) VALUES ('a1', ?)")
            .bind(referenced)
            .execute(database.pool())
            .await
            .expect("insert");

        let result = clear_cache(&database, &paths).await.expect("clear");

        assert!(paths.root().join(referenced).exists());
        assert!(!paths.root().join(orphan).exists());
        assert_eq!(result.removed_files, 1);
    }
}
