use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageCombinationRequest {
    pub id: Option<String>,
    pub name: String,
    pub person_asset_id: String,
    pub garment_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCombination {
    pub id: String,
    pub name: String,
    pub person_asset_id: String,
    pub garment_asset_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCombinationSummary {
    pub id: String,
    pub name: String,
    pub person_asset_id: Option<String>,
    pub garment_count: i64,
    pub created_at: String,
    pub updated_at: String,
}
