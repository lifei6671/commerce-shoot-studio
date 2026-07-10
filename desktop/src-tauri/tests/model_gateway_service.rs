use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::errors::ProviderTransportErrorKind;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::model_config::{
    ModelConfigError, ModelConfigService, SaveLocalModelConfigInput, SetDefaultModelConfigInput,
};
use commerce_shoot_studio_lib::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
    ModelGatewayRequest, ModelGatewayService,
};
use commerce_shoot_studio_lib::services::provider_connection::{
    ProviderConnectionError, ProviderConnectionProbe, ProviderConnectionResult,
    ProviderConnectionTester,
};
use commerce_shoot_studio_lib::services::secrets::{SecretScope, SecretService};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};
use rusqlite::Connection;

#[test]
fn deterministic_model_gateway_supports_all_capabilities_without_real_provider_calls() {
    let workspace_dir = initialized_workspace("model-gateway-mock");
    let service = ModelGatewayService::new();
    let capabilities = [
        "listing-copy",
        "prompt-plan",
        "product-selling-points",
        "viral-style-analysis",
        "scene-image-generation",
        "product-detail-generation",
        "clothing-base-model-generation",
        "clothing-tryon-generation",
        "image-edit",
    ];

    for capability_id in capabilities {
        let result = service
            .invoke(
                &workspace_dir,
                ModelGatewayRequest {
                    capability_id: capability_id.to_string(),
                    input: serde_json::json!({ "debug": true }),
                },
            )
            .expect("mock invocation should succeed");

        assert_eq!(result.provider_profile_id, "mock-local");
        assert_eq!(result.capability_id, capability_id);
        assert!(
            result.invocation_id.starts_with("model_invocation_"),
            "每次模型调用都应生成内部 invocation 记录",
        );
        assert!(result.output_json["mock"].as_bool().unwrap_or(false));
        assert!(
            !result.output_text.as_deref().unwrap_or_default().is_empty(),
            "mock output should provide visible UI text for debugging",
        );
    }

    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_passes_raw_input_to_adapter_without_storing_it() {
    let workspace_dir = initialized_workspace("model-gateway-raw-input");
    let adapter = CapturingAdapter::default();
    let service = ModelGatewayService::new();

    let result = service
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "product-selling-points".to_string(),
                input: serde_json::json!({
                    "prompt": {
                        "messages": [
                            {
                                "role": "system",
                                "content": "system rules"
                            }
                        ]
                    },
                    "userImages": [
                        {
                            "mimeType": "image/png",
                            "dataUrl": "data:image/png;base64,secret-image"
                        }
                    ]
                }),
            },
            &adapter,
        )
        .expect("mock invocation should succeed");

    assert_eq!(result.output_text.as_deref(), Some("captured"));
    let captured = adapter.captured_input.lock().expect("capture lock");
    let captured_input = captured.as_ref().expect("adapter should see raw input");
    assert_eq!(captured_input["prompt"]["messages"][0]["role"], "system");
    assert_eq!(
        captured_input["userImages"][0]["dataUrl"],
        "data:image/png;base64,secret-image",
    );

    let database = Connection::open(workspace_dir.join("workspace.db")).expect("db should open");
    let stored = database
        .query_row(
            "
            SELECT request_summary_json
            FROM model_invocations
            WHERE id = ?1
            ",
            [result.invocation_id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .expect("invocation should be stored");
    assert!(stored.contains("object:2 keys"));
    assert!(!stored.contains("system rules"));
    assert!(!stored.contains("secret-image"));

    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_preserves_provider_http_failure_for_task_normalization() {
    let workspace_dir = initialized_workspace("model-gateway-http-error");

    let error = ModelGatewayService::new()
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!({ "debug": true }),
            },
            &ProviderHttpErrorAdapter,
        )
        .expect_err("provider HTTP failure should propagate");

    assert_eq!(
        error,
        ModelConfigError::ProviderHttp {
            status_code: 429,
            provider_error_code: Some("rate_limit_exceeded".to_string()),
        }
    );
    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_preserves_provider_transport_failure_for_task_normalization() {
    let workspace_dir = initialized_workspace("model-gateway-transport-error");

    let error = ModelGatewayService::new()
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!({ "debug": true }),
            },
            &ProviderTransportErrorAdapter,
        )
        .expect_err("provider transport failure should propagate");

    assert_eq!(
        error,
        ModelConfigError::ProviderTransport(ProviderTransportErrorKind::Timeout)
    );
    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_maps_local_request_validation_without_fabricating_http_status() {
    let workspace_dir = initialized_workspace("model-gateway-request-invalid");

    let error = ModelGatewayService::new()
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!({ "debug": true }),
            },
            &ProviderRequestInvalidAdapter,
        )
        .expect_err("local request validation should propagate without an HTTP status");

    assert_eq!(
        error,
        ModelConfigError::Validation("当前 Provider 不支持该本地请求。".to_string())
    );
    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_preserves_non_http_provider_failure_without_fabricating_status() {
    let workspace_dir = initialized_workspace("model-gateway-provider-failure");

    let error = ModelGatewayService::new()
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!({ "debug": true }),
            },
            &ProviderUnavailableAdapter,
        )
        .expect_err("provider failure without a response should preserve its type");

    assert_eq!(
        error,
        ModelConfigError::Validation("读取 Provider 响应失败。".to_string())
    );
    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_records_sanitized_invocation_without_raw_input_or_response() {
    let workspace_dir = initialized_workspace("model-gateway-invocation");
    let service = ModelGatewayService::new();

    let result = service
        .invoke(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!({
                    "rawPrompt": "system prompt should never be stored",
                    "apiKey": "sk-test-secret",
                    "payload": {
                        "title": "黑色休闲翻领长袖衬衫"
                    }
                }),
            },
        )
        .expect("mock invocation should succeed");
    let database = Connection::open(workspace_dir.join("workspace.db")).expect("db should open");
    let stored = database
        .query_row(
            "
            SELECT status, capability_id, provider_profile_id, model,
                   request_summary_json, output_summary_json, error_json
            FROM model_invocations
            WHERE id = ?1
            ",
            [result.invocation_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .expect("invocation should be stored");

    assert_eq!(stored.0, "succeeded");
    assert_eq!(stored.1, "listing-copy");
    assert_eq!(stored.2, "mock-local");
    assert_eq!(stored.3, "mock-listing-copy-v1");
    assert!(stored.4.contains("object:3 keys"));
    assert!(!stored.4.contains("system prompt should never be stored"));
    assert!(!stored.4.contains("sk-test-secret"));
    assert!(!stored.5.contains("mock output"));
    assert!(stored.6.is_none());

    let scalar_result = service
        .invoke(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!("raw prompt should never be stored"),
            },
        )
        .expect("mock invocation should succeed for scalar input");
    let scalar_stored = database
        .query_row(
            "
            SELECT request_summary_json, output_summary_json, usage_json
            FROM model_invocations
            WHERE id = ?1
            ",
            [scalar_result.invocation_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .expect("scalar invocation should be stored");
    assert!(scalar_stored.0.contains("string"));
    assert!(!scalar_stored
        .0
        .contains("raw prompt should never be stored"));
    assert!(!scalar_stored
        .1
        .contains("raw prompt should never be stored"));
    assert!(!scalar_stored
        .2
        .as_deref()
        .unwrap_or_default()
        .contains("raw prompt should never be stored"));

    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_uses_current_default_provider_profile_in_mock_mode() {
    let workspace_dir = initialized_workspace("model-gateway-provider-profile");
    let model_config_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let gateway_service = ModelGatewayService::new();
    let capability_id = "scene-image-generation".to_string();

    let config = model_config_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "volcengine".to_string(),
                display_name: "火山引擎调试配置".to_string(),
                execution_mode: "sync".to_string(),
                model: "debug-compatible-model".to_string(),
                endpoint_path: Some("/v1/images/generations".to_string()),
                enabled: true,
            },
        )
        .expect("compatible config should save");
    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "volcengine".to_string(),
                capability_id: Some(capability_id.clone()),
            },
            "sk-test-secret".to_string(),
        )
        .expect("secret should save");
    model_config_service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: capability_id.clone(),
                config_id: config.id.clone(),
            },
        )
        .expect("default config should switch");
    model_config_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("config should pass before gateway invocation");

    let result = gateway_service
        .invoke(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id,
                input: serde_json::json!({ "debug": true }),
            },
        )
        .expect("mock gateway should use resolved default config");

    assert_eq!(result.provider_profile_id, "volcengine");
    assert_eq!(result.model, "debug-compatible-model");

    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_reuses_image_to_text_config_and_secret_for_clothing_scene_planning() {
    let workspace_dir = initialized_workspace("model-gateway-clothing-plan-config-fallback");
    let model_config_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let gateway_service = ModelGatewayService::new();
    let adapter = CapturingAdapter::default();
    let source_capability_id = "product-selling-points".to_string();

    let config = model_config_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: source_capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 图生文".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-5.1".to_string(),
                endpoint_path: Some("/responses".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");
    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "openai".to_string(),
                capability_id: Some(source_capability_id),
            },
            "sk-image-to-text-secret".to_string(),
        )
        .expect("secret should save");
    model_config_service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: "product-selling-points".to_string(),
                config_id: config.id.clone(),
            },
        )
        .expect("default config should switch");
    model_config_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("config should pass before gateway invocation");

    let result = gateway_service
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id: "clothing-scene-planning".to_string(),
                input: serde_json::json!({ "debug": true }),
            },
            &adapter,
        )
        .expect("clothing scene planning should reuse image-to-text provider config");

    assert_eq!(result.capability_id, "clothing-scene-planning");
    assert_eq!(result.provider_profile_id, "openai");
    assert_eq!(result.model, "gpt-5.1");
    assert_eq!(
        adapter
            .captured_api_key
            .lock()
            .expect("api key capture lock")
            .as_deref(),
        Some("sk-image-to-text-secret")
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn model_gateway_uses_openai_images_endpoint_for_legacy_text_to_image_config() {
    let workspace_dir = initialized_workspace("model-gateway-openai-image-endpoint");
    let model_config_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let gateway_service = ModelGatewayService::new();
    let adapter = CapturingAdapter::default();
    let capability_id = "clothing-base-model-generation".to_string();

    let config = model_config_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 文生图".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-image-1".to_string(),
                endpoint_path: None,
                enabled: true,
            },
        )
        .expect("config should save");
    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "openai".to_string(),
                capability_id: Some(capability_id.clone()),
            },
            "sk-test-secret".to_string(),
        )
        .expect("secret should save");
    model_config_service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: capability_id.clone(),
                config_id: config.id.clone(),
            },
        )
        .expect("default config should switch");
    model_config_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("config should pass before gateway invocation");

    let database = Connection::open(workspace_dir.join("workspace.db"))
        .expect("workspace database should open");
    database
        .execute(
            "UPDATE model_configs SET endpoint_path = '/v1/responses' WHERE id = ?1",
            [config.id.as_str()],
        )
        .expect("legacy endpoint should be written");
    model_config_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("legacy config should be marked available for the resolved image endpoint");

    gateway_service
        .invoke_with_adapter(
            &workspace_dir,
            ModelGatewayRequest {
                capability_id,
                input: serde_json::json!({ "debug": true }),
            },
            &adapter,
        )
        .expect("gateway invocation should resolve the image endpoint");

    assert_eq!(
        adapter
            .captured_endpoint_path
            .lock()
            .expect("endpoint capture lock")
            .as_deref(),
        Some("/v1/images/generations")
    );

    remove_workspace(&workspace_dir);
}

fn initialized_workspace(label: &str) -> PathBuf {
    let workspace_dir = unique_temp_workspace(label);
    WorkspaceService::new(WorkspaceFileSystem::new())
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    workspace_dir
}

fn unique_temp_workspace(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}"))
}

fn remove_workspace(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

#[derive(Default)]
struct SuccessfulConnectionTester;

impl ProviderConnectionTester for SuccessfulConnectionTester {
    fn test_connection(
        &self,
        _probe: ProviderConnectionProbe,
    ) -> Result<ProviderConnectionResult, ProviderConnectionError> {
        Ok(ProviderConnectionResult {
            elapsed_ms: 0,
            message: "Provider 连接可用。".to_string(),
            ok: true,
        })
    }
}

#[derive(Default)]
struct CapturingAdapter {
    captured_api_key: Mutex<Option<String>>,
    captured_endpoint_path: Mutex<Option<String>>,
    captured_input: Mutex<Option<serde_json::Value>>,
}

impl ModelGatewayAdapter for CapturingAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        *self.captured_api_key.lock().expect("api key capture lock") =
            request.api_key.map(str::to_string);
        *self
            .captured_endpoint_path
            .lock()
            .expect("endpoint capture lock") = Some(request.endpoint_path.to_string());
        *self.captured_input.lock().expect("capture lock") = Some(request.input.clone());
        Ok(ModelGatewayAdapterResult {
            output_text: Some("captured".to_string()),
            output_json: serde_json::json!({ "captured": true }),
            usage_json: None,
        })
    }
}

struct ProviderHttpErrorAdapter;

impl ModelGatewayAdapter for ProviderHttpErrorAdapter {
    fn invoke(
        &self,
        _request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        Err(ModelGatewayError::ProviderHttp {
            status_code: 429,
            provider_error_code: Some("rate_limit_exceeded".to_string()),
        })
    }
}

struct ProviderTransportErrorAdapter;

impl ModelGatewayAdapter for ProviderTransportErrorAdapter {
    fn invoke(
        &self,
        _request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        Err(ModelGatewayError::ProviderTransport(
            ProviderTransportErrorKind::Timeout,
        ))
    }
}

struct ProviderRequestInvalidAdapter;

impl ModelGatewayAdapter for ProviderRequestInvalidAdapter {
    fn invoke(
        &self,
        _request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        Err(ModelGatewayError::ProviderRequestInvalid(
            "当前 Provider 不支持该本地请求。".to_string(),
        ))
    }
}

struct ProviderUnavailableAdapter;

impl ModelGatewayAdapter for ProviderUnavailableAdapter {
    fn invoke(
        &self,
        _request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        Err(ModelGatewayError::ProviderUnavailable(
            "读取 Provider 响应失败。".to_string(),
        ))
    }
}
