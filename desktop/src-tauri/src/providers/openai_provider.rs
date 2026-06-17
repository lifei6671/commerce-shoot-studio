use std::path::Path;
use std::time::Duration;

use base64::Engine;
use reqwest::multipart;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::providers::provider_trait::{
    GenerateInput, GenerateResult, GeneratedImage, ImageGenerationProvider, PromptPayload,
    ProviderError, ProviderErrorCode,
};

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const OPENAI_IMAGES_EDITS_PATH: &str = "images/edits";
const OPENAI_PROVIDER: &str = "openai";
const DEFAULT_OPENAI_REQUEST_TIMEOUT_SECONDS: u64 = 120;
const MIN_OPENAI_REQUEST_TIMEOUT_SECONDS: u64 = 30;
const MAX_OPENAI_REQUEST_TIMEOUT_SECONDS: u64 = 600;

#[derive(Debug, Clone)]
pub struct OpenAiImageProvider {
    client: reqwest::Client,
}

impl OpenAiImageProvider {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    pub fn with_client(client: reqwest::Client) -> Self {
        Self { client }
    }

    pub fn provider_name(&self) -> &'static str {
        OPENAI_PROVIDER
    }

    pub async fn generate(
        &self,
        input: GenerateInput,
        api_key: &str,
    ) -> Result<GenerateResult, ProviderError> {
        self.generate_openai(input, api_key).await
    }

    async fn generate_openai(
        &self,
        input: GenerateInput,
        api_key: &str,
    ) -> Result<GenerateResult, ProviderError> {
        self.validate_input(&input, api_key)?;

        let image_count = normalized_image_count(&input.params);
        let prompt = compose_openai_prompt(&input.prompt);
        let mut form = multipart::Form::new()
            .text("model", input.model_id.clone())
            .text("prompt", prompt)
            .text("n", image_count.to_string());

        if let Some(size) = input.params.get("size").and_then(Value::as_str) {
            form = form.text("size", size.to_string());
        }
        if let Some(quality) = input.params.get("quality").and_then(Value::as_str) {
            form = form.text("quality", quality.to_string());
        }

        for image in &input.images {
            let file_name = image
                .resolved_local_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("input.png")
                .to_string();
            let bytes = std::fs::read(&image.resolved_local_path).map_err(|err| {
                ProviderError::new(
                    OPENAI_PROVIDER,
                    Some(input.model_id.clone()),
                    ProviderErrorCode::InvalidInput,
                    format!("input image {} could not be read: {err}", image.asset_id),
                )
            })?;
            let part = multipart::Part::bytes(bytes)
                .file_name(file_name)
                .mime_str(&image.mime_type)
                .map_err(|err| {
                    ProviderError::new(
                        OPENAI_PROVIDER,
                        Some(input.model_id.clone()),
                        ProviderErrorCode::InvalidInput,
                        format!("input image {} mime type is invalid: {err}", image.asset_id),
                    )
                })?;
            form = form.part("image[]", part);
        }

        let response = self
            .client
            .post(openai_images_edits_url(input.provider_base_url.as_deref()))
            .bearer_auth(api_key)
            .multipart(form)
            .timeout(openai_request_timeout(&input.params))
            .send()
            .await
            .map_err(|err| map_request_error(&input.model_id, err))?;

        let status = response.status();
        let body = response.text().await.map_err(|err| {
            ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::ResponseInvalid,
                format!("OpenAI response could not be read: {err}"),
            )
        })?;

        if !status.is_success() {
            return Err(map_remote_error(&input.model_id, status.as_u16(), &body));
        }

        let parsed: OpenAiImagesResponse = serde_json::from_str(&body).map_err(|err| {
            ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::ResponseInvalid,
                format!("OpenAI response JSON is invalid: {err}"),
            )
        })?;

        let summary_source = parsed.usage.clone().map(|usage| json!({ "usage": usage }));
        let images = decode_openai_images(&input.model_id, parsed)?;
        Ok(GenerateResult {
            provider: OPENAI_PROVIDER.to_string(),
            model_id: input.model_id,
            response_summary_json: self.response_summary(
                status.as_u16(),
                images.len(),
                summary_source.as_ref(),
            ),
            images,
        })
    }

    pub fn response_summary(
        &self,
        status_code: u16,
        image_count: usize,
        response: Option<&Value>,
    ) -> Value {
        let usage = response.and_then(|value| value.get("usage")).cloned();
        json!({
            "provider": OPENAI_PROVIDER,
            "statusCode": status_code,
            "imageCount": image_count,
            "usage": usage,
        })
    }

    fn validate_input(&self, input: &GenerateInput, api_key: &str) -> Result<(), ProviderError> {
        if input.provider != OPENAI_PROVIDER {
            return Err(ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::UnsupportedProvider,
                "provider is not supported by OpenAI adapter",
            ));
        }
        if !matches!(
            input.model_id.as_str(),
            "gpt-image-2" | "gpt-image-1" | "gpt-image-1-mini" | "gpt-image-1.5"
        ) {
            return Err(ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::UnsupportedModel,
                format!(
                    "model {} is not supported by OpenAI adapter",
                    input.model_id
                ),
            ));
        }
        if api_key.trim().is_empty() {
            return Err(ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::MissingCredential,
                "OpenAI API key is not configured",
            ));
        }
        if input.prompt.user.trim().is_empty() {
            return Err(ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::InvalidInput,
                "prompt is required",
            ));
        }
        if input.images.is_empty() {
            return Err(ProviderError::new(
                OPENAI_PROVIDER,
                Some(input.model_id.clone()),
                ProviderErrorCode::InvalidInput,
                "at least one input image is required",
            ));
        }
        Ok(())
    }
}

impl Default for OpenAiImageProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageGenerationProvider for OpenAiImageProvider {
    fn provider_name(&self) -> &'static str {
        OpenAiImageProvider::provider_name(self)
    }

    fn generate<'a>(
        &'a self,
        input: GenerateInput,
        api_key: &'a str,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a>,
    > {
        Box::pin(async move { self.generate_openai(input, api_key).await })
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiImagesResponse {
    data: Option<Vec<OpenAiImage>>,
    usage: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct OpenAiImage {
    b64_json: Option<String>,
    url: Option<String>,
}

fn normalized_image_count(params: &Value) -> u32 {
    params
        .get("outputCount")
        .or_else(|| params.get("n"))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| (1..=4).contains(value))
        .unwrap_or(1)
}

fn openai_request_timeout(params: &Value) -> Duration {
    let seconds = params
        .get("timeoutSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_OPENAI_REQUEST_TIMEOUT_SECONDS)
        .clamp(
            MIN_OPENAI_REQUEST_TIMEOUT_SECONDS,
            MAX_OPENAI_REQUEST_TIMEOUT_SECONDS,
        );
    Duration::from_secs(seconds)
}

fn compose_openai_prompt(prompt: &PromptPayload) -> String {
    [
        prompt
            .system
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("系统规则:\n{value}")),
        Some(format!("细节描述:\n{}", prompt.user.trim())),
        prompt
            .negative
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("避坑描述:\n{value}")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn decode_openai_images(
    model_id: &str,
    response: OpenAiImagesResponse,
) -> Result<Vec<GeneratedImage>, ProviderError> {
    let data = response.data.unwrap_or_default();
    let mut images = Vec::with_capacity(data.len());
    for image in data {
        let Some(b64_json) = image.b64_json else {
            return Err(ProviderError::new(
                OPENAI_PROVIDER,
                Some(model_id.to_string()),
                ProviderErrorCode::ResponseInvalid,
                "OpenAI response did not include b64_json image data",
            ));
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64_json.as_bytes())
            .map_err(|err| {
                ProviderError::new(
                    OPENAI_PROVIDER,
                    Some(model_id.to_string()),
                    ProviderErrorCode::ResponseInvalid,
                    format!("OpenAI b64_json image data is invalid: {err}"),
                )
            })?;
        images.push(GeneratedImage {
            bytes,
            mime_type: "image/png".to_string(),
            source_url: image.url,
        });
    }

    if images.is_empty() {
        return Err(ProviderError::new(
            OPENAI_PROVIDER,
            Some(model_id.to_string()),
            ProviderErrorCode::ResponseInvalid,
            "OpenAI response did not include generated images",
        ));
    }
    Ok(images)
}

fn openai_images_edits_url(provider_base_url: Option<&str>) -> String {
    let base_url = provider_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(OPENAI_BASE_URL);
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        OPENAI_IMAGES_EDITS_PATH
    )
}

fn map_request_error(model_id: &str, err: reqwest::Error) -> ProviderError {
    let code = if err.is_timeout() {
        ProviderErrorCode::RequestTimeout
    } else {
        ProviderErrorCode::RemoteError
    };
    ProviderError::new(
        OPENAI_PROVIDER,
        Some(model_id.to_string()),
        code,
        format!("OpenAI request failed: {err}"),
    )
}

fn map_remote_error(model_id: &str, status_code: u16, body: &str) -> ProviderError {
    let code = match status_code {
        401 | 403 => ProviderErrorCode::MissingCredential,
        429 => ProviderErrorCode::RateLimited,
        _ => ProviderErrorCode::RemoteError,
    };
    ProviderError::new(
        OPENAI_PROVIDER,
        Some(model_id.to_string()),
        code,
        sanitized_remote_error_message(status_code, body),
    )
    .with_status_code(status_code)
}

fn sanitized_remote_error_message(status_code: u16, body: &str) -> String {
    let value = serde_json::from_str::<Value>(body).ok();
    let message = value
        .as_ref()
        .and_then(|value| value.pointer("/error/message"))
        .and_then(Value::as_str)
        .unwrap_or("OpenAI provider returned an error");
    format!("OpenAI provider returned HTTP {status_code}: {message}")
}

#[allow(dead_code)]
fn file_name_for_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("input.png")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_prompt_includes_system_user_and_negative_sections() {
        let prompt = compose_openai_prompt(&PromptPayload {
            system: Some("keep ecommerce composition".to_string()),
            user: "render linen dress".to_string(),
            negative: Some("blur, watermark".to_string()),
        });

        assert_eq!(
            prompt,
            "系统规则:\nkeep ecommerce composition\n\n细节描述:\nrender linen dress\n\n避坑描述:\nblur, watermark"
        );
    }

    #[test]
    fn openai_request_timeout_uses_configured_bounds() {
        assert_eq!(
            openai_request_timeout(&json!({"timeoutSeconds": 480})),
            Duration::from_secs(480)
        );
        assert_eq!(
            openai_request_timeout(&json!({"timeoutSeconds": 12})),
            Duration::from_secs(MIN_OPENAI_REQUEST_TIMEOUT_SECONDS)
        );
        assert_eq!(
            openai_request_timeout(&json!({"timeoutSeconds": 900})),
            Duration::from_secs(MAX_OPENAI_REQUEST_TIMEOUT_SECONDS)
        );
        assert_eq!(
            openai_request_timeout(&json!({})),
            Duration::from_secs(DEFAULT_OPENAI_REQUEST_TIMEOUT_SECONDS)
        );
    }

    #[test]
    fn openai_request_url_uses_custom_base_url_when_configured() {
        assert_eq!(
            openai_images_edits_url(Some("https://gateway.example.com/v1")),
            "https://gateway.example.com/v1/images/edits"
        );
        assert_eq!(
            openai_images_edits_url(Some("https://gateway.example.com/v1/")),
            "https://gateway.example.com/v1/images/edits"
        );
        assert_eq!(
            openai_images_edits_url(None),
            "https://api.openai.com/v1/images/edits"
        );
    }

    #[test]
    fn visible_openai_model_definitions_are_supported_by_adapter() {
        for definition in crate::services::model_validator::list_model_definitions(false)
            .into_iter()
            .filter(|definition| definition.provider == OPENAI_PROVIDER)
        {
            let result = OpenAiImageProvider::new().validate_input(
                &GenerateInput {
                    task_id: "task_visible_model".to_string(),
                    provider: OPENAI_PROVIDER.to_string(),
                    model_id: definition.model_id.clone(),
                    provider_base_url: None,
                    images: Vec::new(),
                    prompt: PromptPayload {
                        system: None,
                        user: "render garment".to_string(),
                        negative: None,
                    },
                    params: json!({}),
                },
                "placeholder-api-key",
            );

            assert!(
                !matches!(
                    result,
                    Err(ProviderError {
                        code: ProviderErrorCode::UnsupportedModel,
                        ..
                    })
                ),
                "{} is listed but not supported by OpenAI adapter",
                definition.model_id
            );
        }
    }
}
