use commerce_shoot_studio_lib::infrastructure::providers::openai_compatible::{
    normalize_openai_compatible_response, redact_provider_result_url,
};

#[test]
fn normalizes_chat_completion_text_response() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "choices": [
            {
                "message": {
                    "content": "适合电商详情页的文案"
                }
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 8,
            "total_tokens": 20
        }
    }))
    .expect("chat response should normalize");

    assert_eq!(
        normalized.output_text.as_deref(),
        Some("适合电商详情页的文案")
    );
    assert_eq!(normalized.usage_json["totalTokens"], 20);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn normalizes_openai_responses_output_text() {
    let normalized = normalize_openai_compatible_response(&serde_json::json!({
        "output_text": "生成方案摘要",
        "usage": {
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15
        }
    }))
    .expect("responses api response should normalize");

    assert_eq!(normalized.output_text.as_deref(), Some("生成方案摘要"));
    assert_eq!(normalized.usage_json["totalTokens"], 15);
    assert!(!normalized.raw_response_stored);
}

#[test]
fn redacts_signed_provider_result_urls_before_persistence() {
    let redacted = redact_provider_result_url(
        "https://cdn.example.com/result.png?token=abc&signature=sig&expires=123&X-Amz-Credential=secret&OSSAccessKeyId=id&security-token=token&authorization=Bearer%20x&safe=keep",
    );

    assert_eq!(redacted, "https://cdn.example.com/result.png?safe=keep");
}
