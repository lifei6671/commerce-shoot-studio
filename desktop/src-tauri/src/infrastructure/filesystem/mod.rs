use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::workspace::WorkspaceError;

#[derive(Debug, Clone, Copy, Default)]
pub struct WorkspaceFileSystem;

impl WorkspaceFileSystem {
    pub fn new() -> Self {
        Self
    }

    pub fn required_directories() -> &'static [&'static str] {
        &[
            "assets/source",
            "assets/reference",
            "assets/model",
            "assets/generated",
            "assets/thumbnail",
            "cache/tmp",
            "exports",
            "logs",
        ]
    }

    pub fn create_required_directories(
        &self,
        workspace_directory: &Path,
    ) -> Result<Vec<String>, WorkspaceError> {
        let mut created = Vec::new();
        self.create_directory(workspace_directory)?;

        for relative_directory in Self::required_directories() {
            let directory = workspace_directory.join(relative_directory);
            if directory.exists() && !directory.is_dir() {
                return Err(WorkspaceError::NotDirectory { path: directory });
            }

            if !directory.is_dir() {
                self.create_directory(&directory)?;
                created.push((*relative_directory).to_string());
            }
        }

        Ok(created)
    }

    pub fn missing_required_directories(&self, workspace_directory: &Path) -> Vec<String> {
        Self::required_directories()
            .iter()
            .filter(|relative_directory| !workspace_directory.join(relative_directory).is_dir())
            .map(|relative_directory| (*relative_directory).to_string())
            .collect()
    }

    pub fn is_cloud_sync_directory(&self, workspace_directory: &Path) -> bool {
        // 云同步软件经常锁定 SQLite WAL/SHM 文件。这里只做低成本启发式检测，
        // 真正阻止进入工作区仍交给后续 migration / DB 打开流程判断。
        let normalized_path = workspace_directory.to_string_lossy().to_lowercase();
        ["onedrive", "icloud drive", "dropbox", "坚果云"]
            .iter()
            .any(|marker| normalized_path.contains(marker))
    }

    fn create_directory(&self, path: &Path) -> Result<(), WorkspaceError> {
        if path.exists() && !path.is_dir() {
            return Err(WorkspaceError::NotDirectory {
                path: path.to_path_buf(),
            });
        }

        fs::create_dir_all(path).map_err(|source| WorkspaceError::Io {
            path: path.to_path_buf(),
            source,
        })
    }
}

pub fn default_workspace_directory() -> PathBuf {
    platform_data_directory().join("workspace")
}

pub fn default_output_directory(workspace_directory: &Path) -> PathBuf {
    workspace_directory.join("exports")
}

#[cfg(target_os = "windows")]
fn platform_data_directory() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("CommerceShootStudio")
}

#[cfg(target_os = "macos")]
fn platform_data_directory() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Library")
        .join("Application Support")
        .join("CommerceShootStudio")
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn platform_data_directory() -> PathBuf {
    if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg_data_home).join("commerce-shoot-studio");
    }

    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(".local")
        .join("share")
        .join("commerce-shoot-studio")
}
