use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::settings::{
    AppSettings, SaveSettingsInput, SettingsService,
};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn get_settings_returns_default_values_for_new_workspace() {
    let workspace_dir = initialized_workspace("settings-default");
    let service = SettingsService::new();

    let settings = service
        .get_settings(&workspace_dir)
        .expect("settings should load");

    assert_eq!(
        settings.workspace_directory(),
        Some(workspace_dir.to_string_lossy().as_ref())
    );
    assert_eq!(
        settings.output_directory(),
        Some(workspace_dir.join("exports").to_string_lossy().as_ref())
    );
    assert!(!settings.launch_at_login());
    assert!(!settings.minimize_to_tray_on_close());
    assert!(settings.auto_create_date_folders());
    assert_eq!(settings.notification_sound(), "clear");
    assert!(settings.restore_workspace_on_launch());
    assert!(!settings.show_system_notifications());
    assert!(settings.retain_generation_history());

    remove_workspace(&workspace_dir);
}

#[test]
fn save_settings_merges_and_persists_partial_input() {
    let workspace_dir = initialized_workspace("settings-save");
    let service = SettingsService::new();

    let saved = service
        .save_settings(
            &workspace_dir,
            SaveSettingsInput {
                output_directory: Some(Some("exports/custom".to_string())),
                auto_create_date_folders: Some(false),
                launch_at_login: Some(true),
                minimize_to_tray_on_close: Some(true),
                notification_sound: Some("viral".to_string()),
                restore_workspace_on_launch: Some(false),
                show_failure_notifications: Some(true),
                ..SaveSettingsInput::default()
            },
        )
        .expect("settings should save");
    let loaded = service
        .get_settings(&workspace_dir)
        .expect("settings should reload");

    assert_eq!(saved.output_directory(), Some("exports/custom"));
    assert!(!loaded.auto_create_date_folders());
    assert!(loaded.launch_at_login());
    assert!(loaded.minimize_to_tray_on_close());
    assert_eq!(loaded.notification_sound(), "viral");
    assert!(!loaded.restore_workspace_on_launch());
    assert!(loaded.show_failure_notifications());
    assert!(
        !loaded.show_system_notifications(),
        "unspecified fields should keep the current or default value",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn get_settings_uses_defaults_for_missing_json_fields() {
    let workspace_dir = initialized_workspace("settings-forward-compatible");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("workspace database should open");
    database
        .connection()
        .execute(
            "
            UPDATE settings
            SET settings_json = '{\"restoreWorkspaceOnLaunch\":false}'
            WHERE id = 1
            ",
            [],
        )
        .expect("update partial settings json");
    let service = SettingsService::new();

    let settings = service
        .get_settings(&workspace_dir)
        .expect("settings should load with defaults");

    assert!(!settings.restore_workspace_on_launch());
    assert!(
        settings.retain_generation_history(),
        "missing fields should use AppSettings defaults",
    );
    assert_eq!(settings.notification_sound(), "clear");

    remove_workspace(&workspace_dir);
}

#[test]
fn app_settings_serialization_omits_empty_optional_paths() {
    let value = serde_json::to_value(AppSettings::default()).expect("settings should serialize");

    assert!(value.get("workspaceDirectory").is_none());
    assert!(value.get("outputDirectory").is_none());
    assert_eq!(value["autoCreateDateFolders"], true);
    assert_eq!(value["launchAtLogin"], false);
    assert_eq!(value["minimizeToTrayOnClose"], false);
    assert_eq!(value["notificationSound"], "clear");
    assert_eq!(value["restoreWorkspaceOnLaunch"], true);
}

fn initialized_workspace(label: &str) -> PathBuf {
    let workspace_dir = unique_temp_workspace(label);
    WorkspaceService::new(WorkspaceFileSystem::new())
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    workspace_dir
}

fn unique_temp_workspace(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}"))
}

fn remove_workspace(path: &Path) {
    let _ = fs::remove_dir_all(path);
}
