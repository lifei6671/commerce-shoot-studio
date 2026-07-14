use crate::domain::generation::NormalizedTaskError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderTransportErrorKind {
    Timeout,
    Network,
}

pub fn normalize_provider_http_error(
    status_code: i64,
    provider_error_code: Option<&str>,
) -> NormalizedTaskError {
    let (code, message, retryable) = match status_code {
        401 | 403 => ("API_KEY_INVALID", "API Key 无效或无权限。", false),
        408 | 504 => ("PROVIDER_TIMEOUT", "Provider 连接超时。", true),
        429 => ("PROVIDER_RATE_LIMITED", "Provider 限流，请稍后重试。", true),
        400 | 422 => ("VALIDATION_ERROR", "Provider 拒绝了当前请求参数。", false),
        _ => (
            "PROVIDER_UNKNOWN_ERROR",
            "Provider 返回异常，请稍后重试或检查模型配置。",
            false,
        ),
    };

    NormalizedTaskError {
        code: code.to_string(),
        message: message.to_string(),
        retryable,
        stage: None,
        provider_status_code: Some(status_code),
        provider_error_code: provider_error_code.and_then(sanitize_provider_error_code),
    }
}

pub fn normalize_provider_transport_error(kind: ProviderTransportErrorKind) -> NormalizedTaskError {
    let (code, message, retryable) = match kind {
        ProviderTransportErrorKind::Timeout => ("PROVIDER_TIMEOUT", "Provider 连接超时。", true),
        ProviderTransportErrorKind::Network => ("NETWORK_ERROR", "Provider 网络连接失败。", true),
    };

    NormalizedTaskError {
        code: code.to_string(),
        message: message.to_string(),
        retryable,
        stage: None,
        provider_status_code: None,
        provider_error_code: None,
    }
}

fn sanitize_provider_error_code(value: &str) -> Option<String> {
    let sanitized = value
        .split_whitespace()
        .map(|segment| {
            if looks_like_secret(segment) {
                "redacted".to_string()
            } else {
                segment
                    .chars()
                    .map(|character| {
                        if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
                        {
                            character
                        } else {
                            '_'
                        }
                    })
                    .collect()
            }
        })
        .collect::<Vec<String>>()
        .join("_");

    if sanitized.trim_matches('_').is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn looks_like_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("sk-")
        || lower.starts_with("bearer")
        || lower.contains("apikey")
        || lower.contains("api_key")
        || lower.contains("authorization")
}
