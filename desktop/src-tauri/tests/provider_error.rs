use commerce_shoot_studio_lib::domain::errors::{
    normalize_provider_http_error, normalize_provider_transport_error, ProviderTransportErrorKind,
};

#[test]
fn maps_provider_rate_limit_to_retryable_normalized_error() {
    let error = normalize_provider_http_error(429, Some("rate_limit_exceeded"));

    assert_eq!(error.code, "PROVIDER_RATE_LIMITED");
    assert!(error.retryable);
    assert_eq!(error.provider_status_code, Some(429));
    assert_eq!(
        error.provider_error_code.as_deref(),
        Some("rate_limit_exceeded")
    );
    assert_eq!(error.message, "Provider 限流，请稍后重试。");
}

#[test]
fn maps_provider_timeout_to_retryable_normalized_error() {
    let error = normalize_provider_transport_error(ProviderTransportErrorKind::Timeout);

    assert_eq!(error.code, "PROVIDER_TIMEOUT");
    assert!(error.retryable);
    assert_eq!(error.message, "Provider 连接超时。");
}

#[test]
fn sanitizes_provider_error_code_without_using_raw_error_as_message() {
    let error = normalize_provider_http_error(500, Some("server_error sk-test-secret\nraw body"));

    assert_eq!(error.code, "PROVIDER_UNKNOWN_ERROR");
    assert!(!error.retryable);
    assert_eq!(error.provider_status_code, Some(500));
    assert_eq!(
        error.provider_error_code.as_deref(),
        Some("server_error_redacted_raw_body")
    );
    assert_eq!(
        error.message,
        "Provider 返回异常，请稍后重试或检查模型配置。"
    );
    assert!(!error.message.contains("sk-test-secret"));
    assert!(!error
        .provider_error_code
        .unwrap_or_default()
        .contains("sk-test-secret"));
}
