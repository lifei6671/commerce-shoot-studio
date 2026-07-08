use reqwest::Url;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedProviderOutput {
    pub output_text: Option<String>,
    pub output_json: serde_json::Value,
    pub usage_json: serde_json::Value,
    pub raw_response_stored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderNormalizeError {
    OutputTruncated,
    UnsupportedResponseShape,
}

impl std::fmt::Display for ProviderNormalizeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OutputTruncated => {
                write!(
                    formatter,
                    "模型输出被 token 上限截断，请减少模块/风格数量或提高输出 token 上限。"
                )
            }
            Self::UnsupportedResponseShape => write!(formatter, "Provider 返回结构暂不支持。"),
        }
    }
}

impl std::error::Error for ProviderNormalizeError {}

pub fn normalize_openai_compatible_response(
    response: &Value,
) -> Result<NormalizedProviderOutput, ProviderNormalizeError> {
    if response_was_truncated(response) {
        return Err(ProviderNormalizeError::OutputTruncated);
    }

    if let Some(images) = image_generation_outputs(response) {
        return Ok(NormalizedProviderOutput {
            output_text: None,
            output_json: serde_json::json!({
                "type": "image",
                "images": images,
            }),
            usage_json: normalize_usage(response.get("usage")),
            raw_response_stored: false,
        });
    }

    let output_text = response
        .get("output_text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| responses_message_output_text(response))
        .or_else(|| chat_completion_output_text(response));

    let output_text = output_text.ok_or(ProviderNormalizeError::UnsupportedResponseShape)?;

    Ok(NormalizedProviderOutput {
        output_text: Some(output_text),
        output_json: serde_json::json!({
            "type": "text",
        }),
        usage_json: normalize_usage(response.get("usage")),
        raw_response_stored: false,
    })
}

fn response_was_truncated(response: &Value) -> bool {
    let chat_completion_truncated = response
        .get("choices")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|choice| choice.get("finish_reason").and_then(Value::as_str) == Some("length"));

    let responses_api_truncated = response.get("status").and_then(Value::as_str)
        == Some("incomplete")
        && response
            .get("incomplete_details")
            .and_then(|details| details.get("reason"))
            .and_then(Value::as_str)
            == Some("max_output_tokens");

    chat_completion_truncated || responses_api_truncated
}

fn responses_message_output_text(response: &Value) -> Option<String> {
    let parts = response
        .get("output")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter_map(|content| {
            let content_type = content.get("type").and_then(Value::as_str);
            if matches!(content_type, Some("output_text") | Some("text")) {
                return content.get("text").and_then(Value::as_str);
            }
            None
        })
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>();

    non_empty_join(parts)
}

fn chat_completion_output_text(response: &Value) -> Option<String> {
    let content = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))?;

    if let Some(text) = content.as_str().filter(|text| !text.trim().is_empty()) {
        return Some(text.to_string());
    }

    let parts = content
        .as_array()?
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>();

    non_empty_join(parts)
}

fn image_generation_outputs(response: &Value) -> Option<Vec<Value>> {
    let images = response
        .get("data")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(image_generation_output)
        .collect::<Vec<_>>();

    if images.is_empty() {
        None
    } else {
        Some(images)
    }
}

fn image_generation_output(item: &Value) -> Option<Value> {
    let size = item.get("size").and_then(Value::as_str);
    let mut image = if let Some(url) = item.get("url").and_then(Value::as_str) {
        serde_json::json!({
            "url": url,
            "mimeType": image_mime_type_from_url(url),
        })
    } else if let Some(encoded) = item.get("b64_json").and_then(Value::as_str) {
        serde_json::json!({
            "dataUrl": format!("data:image/png;base64,{encoded}"),
            "mimeType": "image/png",
        })
    } else {
        return None;
    };

    if let Some(size) = size {
        image["size"] = serde_json::json!(size);
    }
    Some(image)
}

fn image_mime_type_from_url(url: &str) -> &'static str {
    let path = Url::parse(url)
        .map(|parsed| parsed.path().to_ascii_lowercase())
        .unwrap_or_else(|_| url.to_ascii_lowercase());
    if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        return "image/jpeg";
    }
    if path.ends_with(".webp") {
        return "image/webp";
    }
    if path.ends_with(".gif") {
        return "image/gif";
    }
    "image/png"
}

fn non_empty_join(parts: Vec<&str>) -> Option<String> {
    if parts.is_empty() {
        return None;
    }
    Some(parts.join(""))
}

pub fn redact_provider_result_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return "provider_result_url_redacted".to_string();
    };
    let safe_pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !is_sensitive_query_key(key))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();

    url.set_query(None);
    if !safe_pairs.is_empty() {
        let mut serializer = url.query_pairs_mut();
        for (key, value) in safe_pairs {
            serializer.append_pair(&key, &value);
        }
    }
    url.to_string()
}

fn normalize_usage(usage: Option<&serde_json::Value>) -> serde_json::Value {
    let input_tokens = usage
        .and_then(|value| {
            value
                .get("input_tokens")
                .or_else(|| value.get("prompt_tokens"))
        })
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|value| {
            value
                .get("output_tokens")
                .or_else(|| value.get("completion_tokens"))
        })
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let total_tokens = usage
        .and_then(|value| value.get("total_tokens"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(input_tokens + output_tokens);
    let generated_images = usage
        .and_then(|value| value.get("generated_images"))
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);

    serde_json::json!({
        "generatedImages": generated_images,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    })
}

fn is_sensitive_query_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized == "token"
        || normalized == "signature"
        || normalized == "expires"
        || normalized == "ossaccesskeyid"
        || normalized == "security-token"
        || normalized == "authorization"
        || normalized.starts_with("x-amz-")
}
