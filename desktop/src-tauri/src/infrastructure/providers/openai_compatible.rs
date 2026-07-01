use reqwest::Url;

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedProviderOutput {
    pub output_text: Option<String>,
    pub output_json: serde_json::Value,
    pub usage_json: serde_json::Value,
    pub raw_response_stored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderNormalizeError {
    UnsupportedResponseShape,
}

impl std::fmt::Display for ProviderNormalizeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedResponseShape => write!(formatter, "Provider 返回结构暂不支持。"),
        }
    }
}

impl std::error::Error for ProviderNormalizeError {}

pub fn normalize_openai_compatible_response(
    response: &serde_json::Value,
) -> Result<NormalizedProviderOutput, ProviderNormalizeError> {
    let output_text = response
        .get("output_text")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            response
                .get("choices")
                .and_then(serde_json::Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(serde_json::Value::as_str)
        })
        .map(str::to_string);

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

    serde_json::json!({
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
