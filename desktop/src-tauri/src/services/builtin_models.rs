use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltinModel {
    pub id: String,
    pub label: String,
    pub file_name: String,
    pub path: PathBuf,
    pub thumbnail_path: Option<PathBuf>,
}

#[derive(Debug)]
pub enum BuiltinModelError {
    Io { path: PathBuf, message: String },
}

impl fmt::Display for BuiltinModelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { path, message } => {
                write!(
                    formatter,
                    "读取内置模特目录失败：{}，{}",
                    path.display(),
                    message
                )
            }
        }
    }
}

impl std::error::Error for BuiltinModelError {}

pub struct BuiltinModelService;

impl BuiltinModelService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_builtin_models(
        &self,
        directory: &Path,
        thumbnail_directory: &Path,
    ) -> Result<Vec<BuiltinModel>, BuiltinModelError> {
        if !directory.is_dir() {
            return Ok(Vec::new());
        }

        let mut paths = Vec::new();
        for entry in fs::read_dir(directory).map_err(|source| BuiltinModelError::Io {
            path: directory.to_path_buf(),
            message: source.to_string(),
        })? {
            let entry = entry.map_err(|source| BuiltinModelError::Io {
                path: directory.to_path_buf(),
                message: source.to_string(),
            })?;
            let path = entry.path();
            if path.is_file() && is_supported_image(&path) {
                paths.push(path);
            }
        }

        paths.sort_by_key(|path| file_name(path).to_ascii_lowercase());

        Ok(paths
            .into_iter()
            .enumerate()
            .map(|(index, path)| {
                let id = file_stem(&path);
                BuiltinModel {
                    thumbnail_path: find_thumbnail_path(thumbnail_directory, &id),
                    id,
                    label: format!("内置模特 {:02}", index + 1),
                    file_name: file_name(&path),
                    path,
                }
            })
            .collect())
    }
}

fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|extension| matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp"))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "model.png".to_string())
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| file_name(path))
}

fn find_thumbnail_path(thumbnail_directory: &Path, id: &str) -> Option<PathBuf> {
    let path = thumbnail_directory.join(format!("{id}.png"));
    path.is_file().then_some(path)
}
