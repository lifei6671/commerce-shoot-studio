use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use reqwest::{blocking::Response, StatusCode, Url};
use serde_json::{json, Value};

use crate::infrastructure::providers::openai_images::build_openai_image_edit_multipart;

pub(crate) const VOLCENGINE_SEEDREAM_5_PRO_MODEL: &str = "doubao-seedream-5-0-pro-260628";

fn supports_seedream_single_image_probe_options(model: &str) -> bool {
    matches!(
        model,
        "doubao-seedream-5-0-lite-260128"
            | "doubao-seedream-4-5-251128"
            | "doubao-seedream-4-0-250828"
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderConnectionProbe {
    pub provider_profile_id: String,
    pub base_url: String,
    pub endpoint_path: String,
    pub category: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderConnectionResult {
    pub ok: bool,
    pub message: String,
    pub elapsed_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderConnectionError {
    InvalidEndpoint(String),
    Transport(String),
}

impl std::fmt::Display for ProviderConnectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidEndpoint(message) | Self::Transport(message) => {
                write!(formatter, "{message}")
            }
        }
    }
}

impl std::error::Error for ProviderConnectionError {}

pub trait ProviderConnectionTester {
    fn test_connection(
        &self,
        probe: ProviderConnectionProbe,
    ) -> Result<ProviderConnectionResult, ProviderConnectionError>;
}

pub struct HttpProviderConnectionTester {
    client: Client,
}

struct ProviderProbeRequest {
    content_type: String,
    body: Vec<u8>,
}

impl HttpProviderConnectionTester {
    pub fn new() -> Result<Self, ProviderConnectionError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| {
                ProviderConnectionError::Transport("Provider 连接客户端初始化失败。".to_string())
            })?;
        Ok(Self { client })
    }
}

impl ProviderConnectionTester for HttpProviderConnectionTester {
    fn test_connection(
        &self,
        probe: ProviderConnectionProbe,
    ) -> Result<ProviderConnectionResult, ProviderConnectionError> {
        if probe.api_key.trim().is_empty() {
            return Ok(ProviderConnectionResult {
                ok: false,
                message: "模型配置缺少 API Key。".to_string(),
                elapsed_ms: 0,
            });
        }

        let endpoint = provider_endpoint(&probe.base_url, &probe.endpoint_path)?;
        let request = provider_probe_request(&probe)?;
        write_connection_diagnostic(connection_probe_request_diagnostic(&probe, &request));
        let started_at = Instant::now();
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(&probe.api_key)
            .header(CONTENT_TYPE, request.content_type)
            .timeout(provider_probe_timeout(&probe))
            .body(request.body)
            .send();
        let elapsed_ms = elapsed_ms(started_at);

        match response {
            Ok(response) => {
                let (result, diagnostic) = result_from_response(response, elapsed_ms);
                write_connection_diagnostic(diagnostic);
                Ok(result)
            }
            Err(source) if source.is_timeout() => {
                write_connection_diagnostic(connection_probe_transport_diagnostic(
                    "timeout", elapsed_ms,
                ));
                Ok(ProviderConnectionResult {
                    ok: false,
                    message: "Provider 连接超时。".to_string(),
                    elapsed_ms,
                })
            }
            Err(_) => {
                write_connection_diagnostic(connection_probe_transport_diagnostic(
                    "network_error",
                    elapsed_ms,
                ));
                Ok(ProviderConnectionResult {
                    ok: false,
                    message: "Provider 网络连接失败。".to_string(),
                    elapsed_ms,
                })
            }
        }
    }
}

fn provider_probe_request(
    probe: &ProviderConnectionProbe,
) -> Result<ProviderProbeRequest, ProviderConnectionError> {
    if probe.provider_profile_id == "openai"
        && probe.category == "image-to-image"
        && probe.endpoint_path == "/v1/images/edits"
    {
        let multipart = build_openai_image_edit_multipart(
            &probe.model,
            &json!({
                "prompt": { "rolelessPrompt": "hello" },
                "userImages": [{ "dataUrl": probe_png_data_url() }],
            }),
        )
        .map_err(|_| {
            ProviderConnectionError::Transport("OpenAI 图生图探测请求构造失败。".to_string())
        })?;
        return Ok(ProviderProbeRequest {
            content_type: multipart.content_type,
            body: multipart.body,
        });
    }

    Ok(ProviderProbeRequest {
        content_type: "application/json".to_string(),
        body: provider_probe_body(probe).to_string().into_bytes(),
    })
}

fn provider_probe_body(probe: &ProviderConnectionProbe) -> Value {
    if probe.provider_profile_id == "volcengine" && probe.category == "image-to-text" {
        return json!({
            "model": probe.model,
            "input": image_understanding_input("Which model series supports image input?"),
            "max_output_tokens": 16,
        });
    }

    if probe.provider_profile_id == "volcengine"
        && matches!(probe.category.as_str(), "text-to-image" | "image-to-image")
    {
        let size = if probe.model == VOLCENGINE_SEEDREAM_5_PRO_MODEL {
            "1K"
        } else {
            "2K"
        };
        let mut body = json!({
            "model": probe.model,
            "prompt": "hello",
            "response_format": "url",
            "size": size,
            "watermark": true,
        });
        if supports_seedream_single_image_probe_options(&probe.model) {
            body["sequential_image_generation"] = Value::String("disabled".to_string());
            body["stream"] = Value::Bool(false);
        }
        if probe.category == "image-to-image" {
            // 单图探测使用字符串 data URL；避免依赖本地文件或外部测试图片。
            body["image"] = Value::String(probe_png_data_url().to_string());
        }
        return body;
    }

    if probe.provider_profile_id == "openai" && probe.endpoint_path.contains("/images/generations")
    {
        return json!({
            "model": probe.model,
            "prompt": "hello",
            "size": "1024x1024",
        });
    }

    if probe.provider_profile_id == "openai" && probe.endpoint_path.contains("/responses") {
        return json!({
            "model": probe.model,
            "input": openai_responses_input(probe),
            "max_output_tokens": 16,
        });
    }

    // OpenAI-compatible 网关通常接受 chat/completions 结构。
    // 探测只发送 hello 和极小图片 data url，不持久化原始请求/响应。
    json!({
        "model": probe.model,
        "messages": [
            {
                "role": "user",
                "content": openai_compatible_content(probe),
            }
        ],
        "max_tokens": 16,
        "temperature": 0,
    })
}

fn openai_responses_input(probe: &ProviderConnectionProbe) -> Value {
    if matches!(probe.category.as_str(), "image-to-image" | "image-to-text") {
        return image_understanding_input("hello");
    }

    Value::String("hello".to_string())
}

fn openai_compatible_content(probe: &ProviderConnectionProbe) -> Value {
    if matches!(probe.category.as_str(), "image-to-image" | "image-to-text") {
        return json!([
            { "type": "text", "text": "hello" },
            {
                "type": "image_url",
                "image_url": { "url": probe_png_data_url() }
            }
        ]);
    }

    Value::String("hello".to_string())
}

fn provider_probe_timeout(probe: &ProviderConnectionProbe) -> Duration {
    if probe.provider_profile_id == "volcengine"
        && matches!(probe.category.as_str(), "text-to-image" | "image-to-image")
    {
        return Duration::from_secs(300);
    }

    if matches!(
        probe.category.as_str(),
        "text-to-image" | "image-to-image" | "image-to-text"
    ) {
        return Duration::from_secs(60);
    }

    Duration::from_secs(10)
}

fn image_understanding_input(prompt: &str) -> Value {
    json!([
        {
            "role": "user",
            "content": [
                {
                    "type": "input_image",
                    "image_url": probe_png_data_url(),
                },
                {
                    "type": "input_text",
                    "text": prompt,
                }
            ]
        }
    ])
}

fn probe_png_data_url() -> &'static str {
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR42u3OIQEAAAACIP+f1hkWWEB6FgEBAQEBAQEBAQEBAQEBgXdgl/rw4tnPBf0AAAAASUVORK5CYII="
}

fn provider_endpoint(base_url: &str, path: &str) -> Result<Url, ProviderConnectionError> {
    if !path.starts_with('/') {
        return Err(ProviderConnectionError::InvalidEndpoint(
            "Provider 探测路径必须以 / 开头。".to_string(),
        ));
    }

    let endpoint = format!("{}{}", base_url.trim_end_matches('/'), path);
    let url = Url::parse(&endpoint).map_err(|_| {
        ProviderConnectionError::InvalidEndpoint("Provider 接入点不是有效 URL。".to_string())
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ProviderConnectionError::InvalidEndpoint(
            "Provider 接入点只允许 http 或 https。".to_string(),
        ));
    }
    Ok(url)
}

fn result_from_response(response: Response, elapsed_ms: i64) -> (ProviderConnectionResult, Value) {
    let status = response.status();
    if status.is_success() {
        let result = ProviderConnectionResult {
            ok: true,
            message: "Provider 连接可用。".to_string(),
            elapsed_ms,
        };
        return (
            result,
            connection_probe_response_diagnostic(
                status,
                elapsed_ms,
                response.content_length().map(|length| length as usize),
                None,
            ),
        );
    }

    let response_body = response.text().ok();
    let provider_error_code = response_body.as_deref().and_then(provider_error_code);
    let result = result_from_error_status(status, provider_error_code.as_deref(), elapsed_ms);
    let diagnostic = connection_probe_response_diagnostic(
        status,
        elapsed_ms,
        response_body.as_ref().map(|body| body.len()),
        provider_error_code.as_deref(),
    );
    (result, diagnostic)
}

fn write_connection_diagnostic(payload: Value) {
    eprintln!("[provider-connection-diagnostic] {payload}");
}

fn connection_probe_request_diagnostic(
    probe: &ProviderConnectionProbe,
    request: &ProviderProbeRequest,
) -> Value {
    json!({
        "event": "connection_probe_request",
        "providerProfileId": probe.provider_profile_id,
        "baseUrl": safe_diagnostic_base_url(&probe.base_url),
        "category": probe.category,
        "model": probe.model,
        "contentType": request.content_type,
        "requestByteLength": request.body.len(),
    })
}

fn connection_probe_response_diagnostic(
    status: StatusCode,
    elapsed_ms: i64,
    response_byte_length: Option<usize>,
    provider_error_code: Option<&str>,
) -> Value {
    json!({
        "event": "connection_probe_response",
        "status": status.as_u16(),
        "success": status.is_success(),
        "elapsedMs": elapsed_ms,
        "elapsed": format_elapsed_duration(elapsed_ms),
        "responseByteLength": response_byte_length,
        "providerErrorCode": safe_diagnostic_provider_error_code(provider_error_code),
    })
}

fn connection_probe_transport_diagnostic(kind: &str, elapsed_ms: i64) -> Value {
    json!({
        "event": "connection_probe_transport_error",
        "kind": kind,
        "elapsedMs": elapsed_ms,
        "elapsed": format_elapsed_duration(elapsed_ms),
    })
}

fn safe_diagnostic_base_url(base_url: &str) -> String {
    let Ok(url) = Url::parse(base_url) else {
        return "<invalid-base-url>".to_string();
    };
    url.origin().ascii_serialization()
}

fn safe_diagnostic_provider_error_code(error_code: Option<&str>) -> Option<&str> {
    match error_code {
        Some(
            "ModelNotOpen"
            | "ModelNotFound"
            | "InvalidEndpointOrModel.NotFound"
            | "NotFound"
            | "InvalidParameter"
            | "InvalidRequestError",
        ) => error_code,
        _ => None,
    }
}

fn result_from_error_status(
    status: StatusCode,
    provider_error_code: Option<&str>,
    elapsed_ms: i64,
) -> ProviderConnectionResult {
    // 只使用脱敏后的 Provider error.code 做归一化，不透传 raw response/message。
    let (ok, message) = match (status, provider_error_code) {
        (
            StatusCode::NOT_FOUND,
            Some("ModelNotOpen" | "ModelNotFound" | "InvalidEndpointOrModel.NotFound" | "NotFound"),
        ) => (
            false,
            "模型不存在、未开通，或当前 API Key 无权限访问。".to_string(),
        ),
        (StatusCode::BAD_REQUEST, Some("InvalidParameter" | "InvalidRequestError")) => {
            (false, "Provider 请求参数不兼容。".to_string())
        }
        (status, _) => match status {
            StatusCode::OK => (true, "Provider 连接可用。".to_string()),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                (false, "API Key 无效或无权限。".to_string())
            }
            StatusCode::TOO_MANY_REQUESTS => (false, "Provider 限流，请稍后重试。".to_string()),
            StatusCode::NOT_FOUND => (false, "Provider 接入点不可用。".to_string()),
            _ if status.is_success() => (true, "Provider 连接可用。".to_string()),
            _ => (false, format!("Provider 返回状态码 {}。", status.as_u16())),
        },
    };

    ProviderConnectionResult {
        ok,
        message,
        elapsed_ms,
    }
}

fn provider_error_code(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.pointer("/error/code")?.as_str().map(str::to_string))
}

fn elapsed_ms(started_at: Instant) -> i64 {
    started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

fn format_elapsed_duration(elapsed_ms: i64) -> String {
    let elapsed_ms = elapsed_ms.max(0);
    let total_seconds = elapsed_ms / 1_000;
    let milliseconds = elapsed_ms % 1_000;
    let minutes = total_seconds / 60;
    let seconds = total_seconds % 60;

    if minutes == 0 {
        format!("{seconds}.{milliseconds:03}s")
    } else {
        format!("{minutes}m {seconds}.{milliseconds:03}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(
        category: &str,
        endpoint_path: &str,
        provider_profile_id: &str,
    ) -> ProviderConnectionProbe {
        ProviderConnectionProbe {
            provider_profile_id: provider_profile_id.to_string(),
            base_url: "https://example.com".to_string(),
            endpoint_path: endpoint_path.to_string(),
            category: category.to_string(),
            model: "test-model".to_string(),
            api_key: "sk-test".to_string(),
        }
    }

    #[test]
    fn builds_text_probe_with_hello() {
        let body = provider_probe_body(&probe("text-to-text", "/chat/completions", "deepseek"));

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["messages"][0]["content"], "hello");
    }

    #[test]
    fn builds_image_to_image_probe_with_base64_image() {
        let body = provider_probe_body(&probe("image-to-image", "/chat/completions", "deepseek"));
        let content = body["messages"][0]["content"].as_array().unwrap();

        assert_eq!(content[0]["text"], "hello");
        assert!(content[1]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn builds_openai_responses_probe() {
        let body = provider_probe_body(&probe("text-to-text", "/v1/responses", "openai"));

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["input"], "hello");
        assert_eq!(body["max_output_tokens"], 16);
    }

    #[test]
    fn builds_openai_responses_image_to_text_probe() {
        let body = provider_probe_body(&probe("image-to-text", "/v1/responses", "openai"));
        let content = body["input"][0]["content"].as_array().unwrap();

        assert_eq!(body["model"], "test-model");
        assert_eq!(content[0]["type"], "input_image");
        assert!(content[0]["image_url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(content[1]["type"], "input_text");
        assert_eq!(content[1]["text"], "hello");
    }

    #[test]
    fn builds_openai_text_to_image_probe_for_images_generations() {
        let body = provider_probe_body(&probe("text-to-image", "/v1/images/generations", "openai"));

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["prompt"], "hello");
        assert_eq!(body["size"], "1024x1024");
        assert!(body.get("input").is_none());
        assert!(body.get("messages").is_none());
        assert!(body.get("max_output_tokens").is_none());
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn builds_openai_image_to_image_probe_as_multipart() {
        let request =
            provider_probe_request(&probe("image-to-image", "/v1/images/edits", "openai"))
                .expect("OpenAI 图生图探测请求应可构造");

        assert!(request
            .content_type
            .starts_with("multipart/form-data; boundary="));
        assert!(request
            .body
            .windows(b"name=\"model\"".len())
            .any(|part| part == b"name=\"model\""));
        assert!(request
            .body
            .windows(b"name=\"prompt\"".len())
            .any(|part| part == b"name=\"prompt\""));
        assert!(request
            .body
            .windows(b"name=\"image[]\"".len())
            .any(|part| part == b"name=\"image[]\""));
    }

    #[test]
    fn builds_volcengine_image_to_text_responses_probe() {
        let body = provider_probe_body(&probe("image-to-text", "/responses", "volcengine"));
        let content = body["input"][0]["content"].as_array().unwrap();

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["max_output_tokens"], 16);
        assert_eq!(content[0]["type"], "input_image");
        assert!(content[0]["image_url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(content[1]["type"], "input_text");
        assert_eq!(
            content[1]["text"],
            "Which model series supports image input?"
        );
    }

    #[test]
    fn unknown_volcengine_image_model_probe_uses_minimal_request() {
        let body =
            provider_probe_body(&probe("text-to-image", "/images/generations", "volcengine"));

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["prompt"], "hello");
        assert!(body.get("sequential_image_generation").is_none());
        assert!(body.get("sequential_image_generation_options").is_none());
        assert_eq!(body["response_format"], "url");
        assert_eq!(body["size"], "2K");
        assert!(body.get("stream").is_none());
        assert_eq!(body["watermark"], true);
    }

    #[test]
    fn uses_longer_timeout_for_image_probe() {
        assert_eq!(
            provider_probe_timeout(&probe("text-to-image", "/images/generations", "volcengine")),
            Duration::from_secs(300)
        );
        assert_eq!(
            provider_probe_timeout(&probe("image-to-image", "/v1/images/edits", "openai")),
            Duration::from_secs(60)
        );
        assert_eq!(
            provider_probe_timeout(&probe("image-to-text", "/responses", "volcengine")),
            Duration::from_secs(60)
        );
        assert_eq!(
            provider_probe_timeout(&probe("text-to-text", "/chat/completions", "deepseek")),
            Duration::from_secs(10)
        );
    }

    #[test]
    fn normalizes_volcengine_model_not_open_error() {
        let result = result_from_error_status(StatusCode::NOT_FOUND, Some("ModelNotOpen"), 12);

        assert!(!result.ok);
        assert_eq!(
            result.message,
            "模型不存在、未开通，或当前 API Key 无权限访问。"
        );
        assert_eq!(result.elapsed_ms, 12);
    }

    #[test]
    fn keeps_plain_not_found_as_endpoint_unavailable() {
        let result = result_from_error_status(StatusCode::NOT_FOUND, None, 12);

        assert!(!result.ok);
        assert_eq!(result.message, "Provider 接入点不可用。");
    }

    #[test]
    fn extracts_provider_error_code_without_raw_message() {
        let body = r#"{
            "error": {
                "code": "InvalidEndpointOrModel.NotFound",
                "message": "raw provider message should not be returned"
            }
        }"#;

        assert_eq!(
            provider_error_code(body).as_deref(),
            Some("InvalidEndpointOrModel.NotFound")
        );
    }

    #[test]
    fn seedream_5_pro_probe_omits_unsupported_group_and_stream_fields() {
        let mut probe = probe("image-to-image", "/images/generations", "volcengine");
        probe.model = "doubao-seedream-5-0-pro-260628".to_string();
        let body = provider_probe_body(&probe);

        assert_eq!(body["model"], "doubao-seedream-5-0-pro-260628");
        assert_eq!(body["prompt"], "hello");
        assert!(body["image"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(body.get("sequential_image_generation").is_none());
        assert!(body.get("sequential_image_generation_options").is_none());
        assert!(body.get("stream").is_none());
        assert_eq!(body["response_format"], "url");
        assert_eq!(body["size"], "1K");
    }

    #[test]
    fn seedream_lite_probe_uses_single_image_non_streaming_mode() {
        let mut probe = probe("image-to-image", "/images/generations", "volcengine");
        probe.model = "doubao-seedream-5-0-lite-260128".to_string();
        let body = provider_probe_body(&probe);

        assert!(body["image"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(body["sequential_image_generation"], "disabled");
        assert!(body.get("sequential_image_generation_options").is_none());
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn connection_probe_request_diagnostic_omits_secret_and_body_content() {
        let mut probe = probe("image-to-image", "/v1/images/edits", "openai");
        probe.api_key = "sk-connection-diagnostic-secret".to_string();
        let request = provider_probe_request(&probe).expect("探测请求应可构造");

        let diagnostic = connection_probe_request_diagnostic(&probe, &request);
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["event"], "connection_probe_request");
        assert_eq!(diagnostic["providerProfileId"], "openai");
        assert!(diagnostic.get("endpointPath").is_none());
        assert!(diagnostic["requestByteLength"].as_u64().unwrap() > 0);
        assert!(!serialized.contains("sk-connection-diagnostic-secret"));
        assert!(!serialized.contains("hello"));
        assert!(!serialized.contains("data:image/png;base64,"));
        assert!(!serialized.contains("Content-Disposition"));
    }

    #[test]
    fn connection_probe_request_diagnostic_omits_user_configured_paths() {
        let mut probe = probe(
            "text-to-text",
            "/private/sk-endpoint-secret/chat/completions?api_key=sk-query-secret#response",
            "openai",
        );
        probe.base_url = "https://gateway.example/private/sk-base-secret".to_string();
        let request = provider_probe_request(&probe).expect("探测请求应可构造");

        let diagnostic = connection_probe_request_diagnostic(&probe, &request);
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["baseUrl"], "https://gateway.example");
        assert!(diagnostic.get("endpointPath").is_none());
        assert!(!serialized.contains("sk-base-secret"));
        assert!(!serialized.contains("sk-endpoint-secret"));
        assert!(!serialized.contains("sk-query-secret"));
        assert!(!serialized.contains("/private/"));
        assert!(!serialized.contains("response"));
    }

    #[test]
    fn connection_probe_response_diagnostic_omits_raw_response_body() {
        let raw_body = r#"{"error":{"code":"ModelNotOpen","message":"response-raw-marker"}}"#;

        let diagnostic = connection_probe_response_diagnostic(
            StatusCode::NOT_FOUND,
            12,
            Some(raw_body.len()),
            provider_error_code(raw_body).as_deref(),
        );
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["event"], "connection_probe_response");
        assert_eq!(diagnostic["status"], 404);
        assert_eq!(diagnostic["elapsedMs"], 12);
        assert_eq!(diagnostic["elapsed"], "0.012s");
        assert_eq!(diagnostic["providerErrorCode"], "ModelNotOpen");
        assert_eq!(diagnostic["responseByteLength"], raw_body.len());
        assert!(!serialized.contains("response-raw-marker"));
        assert!(!serialized.contains("rawResponse"));
    }

    #[test]
    fn connection_probe_response_diagnostic_redacts_unknown_provider_error_code() {
        let diagnostic = connection_probe_response_diagnostic(
            StatusCode::BAD_REQUEST,
            12,
            None,
            Some("unknown-code-sk-connection-diagnostic-secret"),
        );
        let serialized = diagnostic.to_string();

        assert!(diagnostic["providerErrorCode"].is_null());
        assert!(!serialized.contains("unknown-code-sk-connection-diagnostic-secret"));
        assert!(!serialized.contains("sk-connection-diagnostic-secret"));
    }

    #[test]
    fn connection_probe_transport_diagnostic_includes_human_readable_elapsed() {
        let diagnostic = connection_probe_transport_diagnostic("timeout", 60_002);

        assert_eq!(diagnostic["elapsedMs"], 60_002);
        assert_eq!(diagnostic["elapsed"], "1m 0.002s");
    }
}
