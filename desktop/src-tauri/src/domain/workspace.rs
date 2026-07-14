use std::error::Error;
use std::fmt;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceStatus {
    pub initialized: bool,
    pub workspace_directory: PathBuf,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRepairResult {
    pub repaired: bool,
    pub messages: Vec<String>,
}

#[derive(Debug)]
pub enum WorkspaceError {
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    NotDirectory {
        path: PathBuf,
    },
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkspaceError::Io { path, source } => {
                write!(
                    formatter,
                    "工作区文件系统操作失败：{} ({source})",
                    path.display()
                )
            }
            WorkspaceError::NotDirectory { path } => {
                write!(formatter, "工作区路径不是目录：{}", path.display())
            }
        }
    }
}

impl Error for WorkspaceError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            WorkspaceError::Io { source, .. } => Some(source),
            WorkspaceError::NotDirectory { .. } => None,
        }
    }
}
