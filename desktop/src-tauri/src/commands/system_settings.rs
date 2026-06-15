use tauri::{AppHandle, Manager, State};

use crate::domain::system_settings::{
    CacheStats, ClearCacheResult, SystemSettings, SystemSettingsView, TestProxyResult,
};
use crate::error::{AppError, AppResult};
use crate::services::system_settings::{
    clear_cache, collect_cache_stats, default_workspace_root, run_system_maintenance,
    save_system_settings, system_settings_view,
    test_proxy_connection as test_proxy_connection_with_settings,
};
use crate::state::AppState;

#[tauri::command]
pub async fn get_system_settings(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<SystemSettingsView> {
    let app_config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|_| AppError::WorkspaceUnavailable)?;
    let default_workspace_root = default_workspace_root(&app_handle)?;
    system_settings_view(
        &app_config_dir,
        state.workspace_paths().root(),
        &default_workspace_root,
    )
}

#[tauri::command]
pub async fn save_system_settings_command(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    settings: SystemSettings,
) -> AppResult<SystemSettingsView> {
    let app_config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|_| AppError::WorkspaceUnavailable)?;
    let default_workspace_root = default_workspace_root(&app_handle)?;
    let saved_settings = save_system_settings(&app_config_dir, settings)?;
    run_system_maintenance(state.database(), state.workspace_paths(), &saved_settings).await?;
    system_settings_view(
        &app_config_dir,
        state.workspace_paths().root(),
        &default_workspace_root,
    )
}

#[tauri::command]
pub async fn get_cache_stats(state: State<'_, AppState>) -> AppResult<CacheStats> {
    collect_cache_stats(state.database(), state.workspace_paths()).await
}

#[tauri::command]
pub async fn clear_workspace_cache(state: State<'_, AppState>) -> AppResult<ClearCacheResult> {
    clear_cache(state.database(), state.workspace_paths()).await
}

#[tauri::command]
pub async fn test_proxy_connection(
    settings: SystemSettings,
    test_domain: String,
) -> AppResult<TestProxyResult> {
    test_proxy_connection_with_settings(settings, &test_domain).await
}
