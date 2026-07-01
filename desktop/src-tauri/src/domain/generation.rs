use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::domain::assets::Asset;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceKind {
    Product,
    Clothing,
    Scene,
}

impl WorkspaceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            WorkspaceKind::Product => "product",
            WorkspaceKind::Clothing => "clothing",
            WorkspaceKind::Scene => "scene",
        }
    }
}

impl FromStr for WorkspaceKind {
    type Err = GenerationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "product" => Ok(Self::Product),
            "clothing" => Ok(Self::Clothing),
            "scene" => Ok(Self::Scene),
            _ => Err(GenerationError::InvalidValue(format!(
                "不支持的工作台类型：{value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GenerationTaskKind {
    PromptPlan,
    ImageGeneration,
    ImageEdit,
}

impl GenerationTaskKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PromptPlan => "prompt-plan",
            Self::ImageGeneration => "image-generation",
            Self::ImageEdit => "image-edit",
        }
    }
}

impl FromStr for GenerationTaskKind {
    type Err = GenerationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "prompt-plan" => Ok(Self::PromptPlan),
            "image-generation" => Ok(Self::ImageGeneration),
            "image-edit" => Ok(Self::ImageEdit),
            _ => Err(GenerationError::InvalidValue(format!(
                "不支持的任务类型：{value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GenerationTaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

impl GenerationTaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }
}

impl FromStr for GenerationTaskStatus {
    type Err = GenerationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            "interrupted" => Ok(Self::Interrupted),
            _ => Err(GenerationError::InvalidValue(format!(
                "不支持的任务状态：{value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GenerationTaskStage {
    Queued,
    Validating,
    RenderingPrompt,
    CallingProvider,
    PollingProvider,
    DownloadingResult,
    SavingResult,
    Completed,
    Failed,
}

impl GenerationTaskStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Validating => "validating",
            Self::RenderingPrompt => "rendering-prompt",
            Self::CallingProvider => "calling-provider",
            Self::PollingProvider => "polling-provider",
            Self::DownloadingResult => "downloading-result",
            Self::SavingResult => "saving-result",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

impl FromStr for GenerationTaskStage {
    type Err = GenerationError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "queued" => Ok(Self::Queued),
            "validating" => Ok(Self::Validating),
            "rendering-prompt" => Ok(Self::RenderingPrompt),
            "calling-provider" => Ok(Self::CallingProvider),
            "polling-provider" => Ok(Self::PollingProvider),
            "downloading-result" => Ok(Self::DownloadingResult),
            "saving-result" => Ok(Self::SavingResult),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            _ => Err(GenerationError::InvalidValue(format!(
                "不支持的任务阶段：{value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTask {
    pub id: String,
    pub retry_of_task_id: Option<String>,
    pub attempt_no: i64,
    pub idempotency_key: Option<String>,
    pub workspace: WorkspaceKind,
    pub kind: GenerationTaskKind,
    pub status: GenerationTaskStatus,
    pub stage: GenerationTaskStage,
    pub title: String,
    pub input_summary: Option<String>,
    pub prompt_plan_id: Option<String>,
    pub error: Option<NormalizedTaskError>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskAsset {
    pub role: String,
    pub sort_order: i64,
    pub asset: Asset,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: String,
    pub event_type: String,
    pub stage: Option<GenerationTaskStage>,
    pub detail: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskDetail {
    pub task: GenerationTask,
    pub input_assets: Vec<GenerationTaskAsset>,
    pub output_assets: Vec<GenerationTaskAsset>,
    pub events: Vec<TaskEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedTaskError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub stage: Option<GenerationTaskStage>,
    pub provider_status_code: Option<i64>,
    pub provider_error_code: Option<String>,
}

impl NormalizedTaskError {
    pub fn task_retry_required() -> Self {
        Self {
            code: "TASK_RETRY_REQUIRED".to_string(),
            message: "该幂等键对应的任务已失败，请使用 retryTask 创建新的重试任务。".to_string(),
            retryable: true,
            stage: Some(GenerationTaskStage::Failed),
            provider_status_code: None,
            provider_error_code: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenerationError {
    InvalidValue(String),
    Validation(String),
    NotFound(String),
    RetryRequired(NormalizedTaskError),
    Database(String),
    Serde(String),
}

impl fmt::Display for GenerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidValue(message) | Self::Validation(message) => {
                write!(formatter, "{message}")
            }
            Self::NotFound(task_id) => write!(formatter, "任务不存在：{task_id}"),
            Self::RetryRequired(error) => write!(formatter, "{}", error.message),
            Self::Database(message) | Self::Serde(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for GenerationError {}
