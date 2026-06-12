use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInput {
    pub task_id: String,
    pub provider: String,
    pub model_id: String,
    pub images: Vec<GenerateInputImage>,
    pub prompt: PromptPayload,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateInputImage {
    pub asset_id: String,
    pub role: String,
    pub mime_type: String,
    pub resolved_local_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPayload {
    pub system: Option<String>,
    pub user: String,
    pub negative: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderRuntimeContext {
    pub timeout: Duration,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteCancelResult {
    Confirmed,
    NotSupported,
}

impl Default for ProviderRuntimeContext {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(120),
            cancelled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub provider: String,
    pub model_id: String,
    pub images: Vec<GeneratedImage>,
    pub response_summary_json: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderErrorCode {
    MissingCredential,
    UnsupportedProvider,
    UnsupportedModel,
    InvalidInput,
    RequestTimeout,
    Cancelled,
    RateLimited,
    RemoteError,
    ResponseInvalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub provider: String,
    pub model_id: Option<String>,
    pub code: ProviderErrorCode,
    pub message: String,
    pub status_code: Option<u16>,
    pub retryable: bool,
}

impl ProviderError {
    pub fn new(
        provider: impl Into<String>,
        model_id: Option<String>,
        code: ProviderErrorCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            provider: provider.into(),
            model_id,
            code,
            message: message.into(),
            status_code: None,
            retryable: false,
        }
    }

    pub fn with_status_code(mut self, status_code: u16) -> Self {
        self.status_code = Some(status_code);
        self.retryable = status_code == 429 || status_code >= 500;
        self
    }
}

pub trait ImageGenerationProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;

    fn generate<'a>(
        &'a self,
        input: GenerateInput,
        api_key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a>>;

    fn cancel_remote<'a>(
        &'a self,
        _task_id: &'a str,
        _api_key: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<RemoteCancelResult, ProviderError>> + Send + 'a>> {
        Box::pin(async { Ok(RemoteCancelResult::NotSupported) })
    }
}
