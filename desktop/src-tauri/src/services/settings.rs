use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::infrastructure::database::{DatabaseError, WorkspaceDatabase};
use crate::infrastructure::filesystem::default_output_directory;

#[derive(Debug)]
pub enum SettingsServiceError {
    Database(DatabaseError),
    Serde(serde_json::Error),
}

impl std::fmt::Display for SettingsServiceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsServiceError::Database(source) => write!(formatter, "{source}"),
            SettingsServiceError::Serde(source) => {
                write!(formatter, "设置 JSON 解析失败：{source}")
            }
        }
    }
}

impl std::error::Error for SettingsServiceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            SettingsServiceError::Database(source) => Some(source),
            SettingsServiceError::Serde(source) => Some(source),
        }
    }
}

impl From<DatabaseError> for SettingsServiceError {
    fn from(source: DatabaseError) -> Self {
        SettingsServiceError::Database(source)
    }
}

impl From<rusqlite::Error> for SettingsServiceError {
    fn from(source: rusqlite::Error) -> Self {
        SettingsServiceError::Database(DatabaseError::from(source))
    }
}

impl From<serde_json::Error> for SettingsServiceError {
    fn from(source: serde_json::Error) -> Self {
        SettingsServiceError::Serde(source)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_directory: Option<String>,
    launch_at_login: bool,
    minimize_to_tray_on_close: bool,
    auto_create_date_folders: bool,
    notification_sound: String,
    restore_workspace_on_launch: bool,
    show_system_notifications: bool,
    show_task_done_notifications: bool,
    show_failure_notifications: bool,
    retain_generation_history: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            workspace_directory: None,
            output_directory: None,
            launch_at_login: false,
            minimize_to_tray_on_close: false,
            auto_create_date_folders: true,
            notification_sound: "clear".to_string(),
            restore_workspace_on_launch: true,
            show_system_notifications: false,
            show_task_done_notifications: false,
            show_failure_notifications: false,
            retain_generation_history: true,
        }
    }
}

impl AppSettings {
    pub fn workspace_directory(&self) -> Option<&str> {
        self.workspace_directory.as_deref()
    }

    pub fn output_directory(&self) -> Option<&str> {
        self.output_directory.as_deref()
    }

    pub fn restore_workspace_on_launch(&self) -> bool {
        self.restore_workspace_on_launch
    }

    pub fn launch_at_login(&self) -> bool {
        self.launch_at_login
    }

    pub fn minimize_to_tray_on_close(&self) -> bool {
        self.minimize_to_tray_on_close
    }

    pub fn auto_create_date_folders(&self) -> bool {
        self.auto_create_date_folders
    }

    pub fn notification_sound(&self) -> &str {
        &self.notification_sound
    }

    pub fn show_system_notifications(&self) -> bool {
        self.show_system_notifications
    }

    pub fn show_failure_notifications(&self) -> bool {
        self.show_failure_notifications
    }

    pub fn retain_generation_history(&self) -> bool {
        self.retain_generation_history
    }

    fn apply(&mut self, input: SaveSettingsInput) {
        if let Some(value) = input.workspace_directory {
            self.workspace_directory = value;
        }
        if let Some(value) = input.output_directory {
            self.output_directory = value;
        }
        if let Some(value) = input.launch_at_login {
            self.launch_at_login = value;
        }
        if let Some(value) = input.minimize_to_tray_on_close {
            self.minimize_to_tray_on_close = value;
        }
        if let Some(value) = input.auto_create_date_folders {
            self.auto_create_date_folders = value;
        }
        if let Some(value) = input.notification_sound {
            self.notification_sound = normalized_notification_sound(value);
        }
        if let Some(value) = input.restore_workspace_on_launch {
            self.restore_workspace_on_launch = value;
        }
        if let Some(value) = input.show_system_notifications {
            self.show_system_notifications = value;
        }
        if let Some(value) = input.show_task_done_notifications {
            self.show_task_done_notifications = value;
        }
        if let Some(value) = input.show_failure_notifications {
            self.show_failure_notifications = value;
        }
        if let Some(value) = input.retain_generation_history {
            self.retain_generation_history = value;
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsInput {
    pub workspace_directory: Option<Option<String>>,
    pub output_directory: Option<Option<String>>,
    pub launch_at_login: Option<bool>,
    pub minimize_to_tray_on_close: Option<bool>,
    pub auto_create_date_folders: Option<bool>,
    pub notification_sound: Option<String>,
    pub restore_workspace_on_launch: Option<bool>,
    pub show_system_notifications: Option<bool>,
    pub show_task_done_notifications: Option<bool>,
    pub show_failure_notifications: Option<bool>,
    pub retain_generation_history: Option<bool>,
}

#[derive(Debug, Clone, Default)]
pub struct SettingsService;

impl SettingsService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_settings(
        &self,
        workspace_directory: &Path,
    ) -> Result<AppSettings, SettingsServiceError> {
        let database = WorkspaceDatabase::open(workspace_directory)?;
        load_settings_for_workspace(&database, workspace_directory)
    }

    pub fn save_settings(
        &self,
        workspace_directory: &Path,
        input: SaveSettingsInput,
    ) -> Result<AppSettings, SettingsServiceError> {
        let database = WorkspaceDatabase::open(workspace_directory)?;
        let mut settings = load_settings_for_workspace(&database, workspace_directory)?;
        settings.apply(input);
        save_settings(&database, &settings)?;
        Ok(settings)
    }

    pub fn ensure_initialized_settings(
        &self,
        workspace_directory: &Path,
    ) -> Result<AppSettings, SettingsServiceError> {
        let database = WorkspaceDatabase::open(workspace_directory)?;
        let mut settings = load_settings(&database)?;
        apply_workspace_defaults(&mut settings, workspace_directory);
        save_settings(&database, &settings)?;
        Ok(settings)
    }
}

fn load_settings_for_workspace(
    database: &WorkspaceDatabase,
    workspace_directory: &Path,
) -> Result<AppSettings, SettingsServiceError> {
    let mut settings = load_settings(database)?;
    apply_workspace_defaults(&mut settings, workspace_directory);
    Ok(settings)
}

fn load_settings(database: &WorkspaceDatabase) -> Result<AppSettings, SettingsServiceError> {
    let settings_json: Option<String> = database
        .connection()
        .query_row(
            "SELECT settings_json FROM settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    match settings_json {
        Some(value) => Ok(serde_json::from_str(&value)?),
        None => Ok(AppSettings::default()),
    }
}

fn apply_workspace_defaults(settings: &mut AppSettings, workspace_directory: &Path) {
    if settings.workspace_directory.is_none() {
        settings.workspace_directory = Some(path_to_string(workspace_directory));
    }
    if settings.output_directory.is_none() {
        settings.output_directory = Some(path_to_string(&default_output_directory(
            workspace_directory,
        )));
    }
    settings.notification_sound =
        normalized_notification_sound(settings.notification_sound.clone());
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn normalized_notification_sound(value: String) -> String {
    match value.as_str() {
        "clear" | "soft" | "success" | "viral" => value,
        _ => "clear".to_string(),
    }
}

fn save_settings(
    database: &WorkspaceDatabase,
    settings: &AppSettings,
) -> Result<(), SettingsServiceError> {
    let settings_json = serde_json::to_string(settings)?;
    // settings 只保存本地 UI/工作区偏好，禁止混入 API Key、raw prompt 或 Provider 响应。
    database.connection().execute(
        "
        INSERT INTO settings (id, settings_json, updated_at)
        VALUES (1, ?1, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            settings_json = excluded.settings_json,
            updated_at = datetime('now')
        ",
        params![settings_json],
    )?;
    Ok(())
}
