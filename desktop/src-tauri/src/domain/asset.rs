use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "TEXT", rename_all = "lowercase")]
pub enum AssetType {
    Person,
    Garment,
    Result,
}

impl AssetType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AssetType::Person => "person",
            AssetType::Garment => "garment",
            AssetType::Result => "result",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub asset_type: AssetType,
    pub original_name: String,
    pub relative_path: String,
    pub thumb_relative_path: String,
    pub mime_type: String,
    pub sha256: String,
    pub width: i64,
    pub height: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageResponse {
    pub asset: Asset,
    pub duplicate: bool,
    pub thumb_file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFileView {
    pub asset: Asset,
    pub file_path: String,
    pub thumb_file_path: String,
}
