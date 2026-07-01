use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChooseDirectoryInput {
    title: Option<String>,
    default_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotificationInput {
    title: String,
    body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevealCommand {
    program: String,
    args: Vec<String>,
}

impl RevealCommand {
    pub fn program(&self) -> &str {
        &self.program
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }
}

#[tauri::command]
pub async fn shell_choose_directory(
    app: AppHandle,
    input: Option<ChooseDirectoryInput>,
) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file();

    if let Some(input) = input {
        if let Some(title) = input.title.filter(|value| !value.trim().is_empty()) {
            dialog = dialog.set_title(title);
        }
        if let Some(default_path) = input.default_path.filter(|value| !value.trim().is_empty()) {
            dialog = dialog.set_directory(PathBuf::from(default_path));
        }
    }

    let selected = dialog
        .blocking_pick_folder()
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|error| error.to_string())
        })
        .transpose()?;

    Ok(selected)
}

#[tauri::command]
pub fn shell_reveal_path(path: String) -> Result<(), String> {
    let command = reveal_command_for_platform(std::env::consts::OS, Path::new(&path))?;
    let status = Command::new(command.program())
        .args(command.args())
        .status()
        .map_err(|error| format!("打开系统文件管理器失败：{error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("打开系统文件管理器失败，退出码：{status}"))
    }
}

#[tauri::command]
pub fn shell_notify(input: SystemNotificationInput) -> Result<(), String> {
    let _ = (input.title, input.body);
    // MVP 暂不接系统通知插件；RuntimeInfo 已显式返回 supportsSystemNotification=false。
    Ok(())
}

pub fn reveal_command_for_platform(platform: &str, path: &Path) -> Result<RevealCommand, String> {
    let target = path_to_string(path)?;

    match platform {
        "macos" => Ok(RevealCommand {
            program: "open".to_string(),
            args: vec!["-R".to_string(), target],
        }),
        "windows" => Ok(RevealCommand {
            program: "explorer".to_string(),
            args: vec![format!("/select,{target}")],
        }),
        _ => {
            let linux_target = linux_reveal_target(path)?;
            Ok(RevealCommand {
                program: "xdg-open".to_string(),
                args: vec![linux_target],
            })
        }
    }
}

fn path_to_string(path: &Path) -> Result<String, String> {
    let value = path.to_string_lossy().to_string();
    if value.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    Ok(value)
}

fn linux_reveal_target(path: &Path) -> Result<String, String> {
    // Linux 没有统一的“在文件管理器中选中此文件”协议。
    // 对文件路径打开父目录，避免 xdg-open 直接打开图片或其他资产文件。
    let target = if path.is_file() || path.extension().is_some() {
        path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or(path)
    } else {
        path
    };

    path_to_string(target)
}
