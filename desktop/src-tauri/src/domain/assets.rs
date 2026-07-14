use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    Source,
    Reference,
    Model,
    Generated,
    Thumbnail,
}

impl AssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetKind::Source => "source",
            AssetKind::Reference => "reference",
            AssetKind::Model => "model",
            AssetKind::Generated => "generated",
            AssetKind::Thumbnail => "thumbnail",
        }
    }

    pub fn directory_name(self) -> &'static str {
        self.as_str()
    }
}

impl FromStr for AssetKind {
    type Err = AssetError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "source" => Ok(AssetKind::Source),
            "reference" => Ok(AssetKind::Reference),
            "model" => Ok(AssetKind::Model),
            "generated" => Ok(AssetKind::Generated),
            "thumbnail" => Ok(AssetKind::Thumbnail),
            _ => Err(AssetError::InvalidKind(value.to_string())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetLifecycle {
    Staged,
    Active,
    Deleted,
}

impl AssetLifecycle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Staged => "staged",
            Self::Active => "active",
            Self::Deleted => "deleted",
        }
    }
}

impl FromStr for AssetLifecycle {
    type Err = AssetError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "staged" => Ok(Self::Staged),
            "active" => Ok(Self::Active),
            "deleted" => Ok(Self::Deleted),
            _ => Err(AssetError::InvalidInput(format!(
                "不支持的资产生命周期：{value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub kind: AssetKind,
    pub name: String,
    pub original_name: String,
    pub mime_type: String,
    pub relative_path: String,
    pub sha256: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size_bytes: i64,
    pub lifecycle: AssetLifecycle,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetError {
    InvalidKind(String),
    InvalidInput(String),
    Io { path: PathBuf, message: String },
    NotFound(String),
    Database(String),
}

impl fmt::Display for AssetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AssetError::InvalidKind(value) => write!(formatter, "不支持的资产类型：{value}"),
            AssetError::InvalidInput(message) => write!(formatter, "{message}"),
            AssetError::Io { path, message } => {
                write!(
                    formatter,
                    "资产文件操作失败：{} ({message})",
                    path.display()
                )
            }
            AssetError::NotFound(asset_id) => write!(formatter, "资产不存在：{asset_id}"),
            AssetError::Database(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for AssetError {}
