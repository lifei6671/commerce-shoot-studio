use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::notification_sound::play_notification_sound;
use crate::services::settings::{AppSettings, SaveSettingsInput, SettingsService};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn settings_get() -> Result<AppSettings, String> {
    SettingsService::new()
        .get_settings(&default_workspace_directory())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn settings_save(
    app: tauri::AppHandle,
    input: SaveSettingsInput,
) -> Result<AppSettings, String> {
    let workspace_directory = default_workspace_directory();
    let service = SettingsService::new();
    let previous_settings = service
        .get_settings(&workspace_directory)
        .map_err(|error| error.to_string())?;
    let requested_launch_at_login = input.launch_at_login;

    // 开机启动是 OS 级副作用。先应用系统状态，再写入 settings，避免保存成功但系统实际未生效。
    if let Some(enabled) = requested_launch_at_login {
        apply_launch_at_login(&app, enabled)?;
    }

    match service.save_settings(&workspace_directory, input) {
        Ok(settings) => Ok(settings),
        Err(error) => {
            if requested_launch_at_login.is_some() {
                let _ = apply_launch_at_login(&app, previous_settings.launch_at_login());
            }
            Err(error.to_string())
        }
    }
}

fn apply_launch_at_login(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager
            .enable()
            .map_err(|error| format!("开机自动启动启用失败：{error}"))?;
    } else {
        manager
            .disable()
            .map_err(|error| format!("开机自动启动关闭失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn settings_play_notification_sound(sound_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || play_notification_sound(&sound_id))
        .await
        .map_err(|error| format!("播放提示音失败：{error}"))?
        .map_err(|error| error.to_string())
}
