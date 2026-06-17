use commerce_shoot_studio::providers::openai_provider::OpenAiImageProvider;
use commerce_shoot_studio::providers::provider_trait::{
    GenerateInput, GenerateInputImage, PromptPayload, ProviderErrorCode,
};
use commerce_shoot_studio::services::credential_service::{
    InMemoryCredentialStore, ProviderCredentialService,
};
use serde_json::json;
use std::path::PathBuf;

#[tokio::test]
async fn credential_service_masks_key_without_exposing_secret() {
    let service = ProviderCredentialService::new(InMemoryCredentialStore::default());

    service
        .set_provider_api_key("openai", "placeholder-api-key-value")
        .await
        .expect("set key");

    let status = service
        .get_provider_credential_status("openai")
        .await
        .expect("status");
    assert!(status.configured);
    assert_eq!(status.provider, "openai");
    assert_eq!(status.masked_key.as_deref(), Some("plac****alue"));

    let api_key = service
        .read_provider_api_key("openai")
        .await
        .expect("read key");
    assert_eq!(api_key, "placeholder-api-key-value");
}

#[test]
fn openai_provider_builds_sanitized_response_summary() {
    let provider = OpenAiImageProvider::new();
    let summary = provider.response_summary(200, 2, Some(&json!({
        "id": "response_1",
        "object": "image",
        "data": [{"b64_json": "AAA", "url": "https://cdn.example.com/result.png?token=placeholder"}],
        "api_key": "placeholder",
        "Authorization": "placeholder"
    })));

    assert_eq!(summary["provider"], "openai");
    assert_eq!(summary["statusCode"], 200);
    assert_eq!(summary["imageCount"], 2);
    assert!(summary.get("rawResponse").is_none());
    assert!(summary.get("api_key").is_none());
    assert!(summary.get("Authorization").is_none());
}

#[tokio::test]
async fn openai_provider_rejects_unsupported_model_without_http_call() {
    let provider = OpenAiImageProvider::new();
    let input = GenerateInput {
        task_id: "task_1".to_string(),
        provider: "openai".to_string(),
        model_id: "custom-model".to_string(),
        provider_base_url: None,
        images: vec![GenerateInputImage {
            asset_id: "person_1".to_string(),
            role: "person".to_string(),
            mime_type: "image/png".to_string(),
            resolved_local_path: PathBuf::from("/tmp/person.png"),
        }],
        prompt: PromptPayload {
            system: None,
            user: "try on outfit".to_string(),
            negative: None,
        },
        params: json!({"outputCount": 1}),
    };

    let error = provider
        .generate(input, "placeholder-api-key")
        .await
        .expect_err("unsupported model");

    assert_eq!(error.code, ProviderErrorCode::UnsupportedModel);
    assert_eq!(error.provider, "openai");
    assert_eq!(error.model_id.as_deref(), Some("custom-model"));
    assert!(!error.message.contains("placeholder-api-key"));
}
