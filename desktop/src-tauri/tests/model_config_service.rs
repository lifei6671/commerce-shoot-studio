use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::capability::CapabilityService;
use commerce_shoot_studio_lib::services::model_config::{
    LocalModelConfigView, ModelConfigService, SaveLocalModelConfigInput, SetDefaultModelConfigInput,
};
use commerce_shoot_studio_lib::services::provider_connection::{
    ProviderConnectionError, ProviderConnectionProbe, ProviderConnectionResult,
    ProviderConnectionTester,
};
use commerce_shoot_studio_lib::services::secrets::{SecretScope, SecretService};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn model_config_lists_builtin_mock_profile_and_seeded_mock_configs() {
    let workspace_dir = initialized_workspace("model-config-defaults");
    let service = ModelConfigService::new();

    let profiles = service
        .list_provider_profiles()
        .expect("provider profiles should list");
    let configs = service
        .list_configs(&workspace_dir)
        .expect("configs should list");
    let capabilities = CapabilityService::new()
        .list_capabilities(&workspace_dir)
        .expect("capabilities should list");

    assert!(profiles.iter().any(|profile| profile.id == "mock-local"));
    assert_eq!(
        configs.len(),
        capabilities.len(),
        "每个模型能力都应有一个默认 mock 配置，方便无外网调试",
    );
    assert!(configs
        .iter()
        .all(|config| config.provider_label == "Mock Local"));
    assert!(configs.iter().all(|config| config.secret_status.configured));
    assert!(configs.iter().all(|config| !config.model.trim().is_empty()));

    remove_workspace(&workspace_dir);
}

#[test]
fn provider_profiles_include_current_release_allowlist() {
    let service = ModelConfigService::new();

    let profiles = service
        .list_provider_profiles()
        .expect("provider profiles should list");

    assert!(profiles.iter().any(|profile| profile.id == "openai"));
    assert!(profiles.iter().any(|profile| profile.id == "deepseek"));
    assert!(profiles.iter().any(|profile| profile.id == "volcengine"));
    let deepseek = profiles
        .iter()
        .find(|profile| profile.id == "deepseek")
        .expect("deepseek profile should exist");
    assert_eq!(
        deepseek.supported_categories,
        vec!["text-to-text"],
        "DeepSeek 第一版只作为文生文能力接入，避免 UI 误选图片能力",
    );
}

#[test]
fn saving_config_updates_capability_immediately_without_api_key_for_mock_provider() {
    let workspace_dir = initialized_workspace("model-config-save");
    let model_service = ModelConfigService::new();
    let capability_service = CapabilityService::new();

    let saved = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: "scene-image-generation".to_string(),
                provider_profile_id: "mock-local".to_string(),
                display_name: "场景图 Mock".to_string(),
                execution_mode: "sync".to_string(),
                model: "mock-scene-image-v1".to_string(),
                endpoint_path: None,
                enabled: true,
            },
        )
        .expect("config should save");
    let capability = capability_service
        .get_capability(&workspace_dir, "scene-image-generation")
        .expect("capability should load");

    assert_eq!(saved.provider_label, "Mock Local");
    assert!(saved.secret_status.configured);
    assert!(capability.available);

    remove_workspace(&workspace_dir);
}

#[test]
fn provider_connection_status_is_persisted_after_test_config() {
    let workspace_dir = initialized_workspace("model-config-connection-status");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "listing-copy".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 文案".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-4.1-mini".to_string(),
                endpoint_path: Some("/v1/chat/completions".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");
    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "openai".to_string(),
                capability_id: Some(capability_id),
            },
            "sk-test-secret".to_string(),
        )
        .expect("secret should save");

    let test_result = model_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("test config should persist status");
    let reloaded = model_service
        .get_config(&workspace_dir, &config.id)
        .expect("config should reload");

    assert!(test_result.ok);
    assert_eq!(reloaded.connection_status, "available");
    assert!(reloaded.connection_tested_at.is_some());

    remove_workspace(&workspace_dir);
}

#[test]
fn test_config_passes_resolved_provider_probe_to_connection_tester() {
    let workspace_dir = initialized_workspace("model-config-provider-probe");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "listing-copy".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "deepseek".to_string(),
                display_name: "DeepSeek 文案".to_string(),
                execution_mode: "sync".to_string(),
                model: "deepseek-v4-flash".to_string(),
                endpoint_path: Some("/chat/completions".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");
    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "deepseek".to_string(),
                capability_id: Some(capability_id),
            },
            "sk-test-secret".to_string(),
        )
        .expect("secret should save");
    let tester = RecordingConnectionTester::new(true);

    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &tester)
        .expect("test config should use tester");
    let probe = tester
        .take_probe()
        .expect("provider probe should be recorded");

    assert_eq!(probe.provider_profile_id, "deepseek");
    assert_eq!(probe.base_url, "https://api.deepseek.com");
    assert_eq!(probe.model, "deepseek-v4-flash");
    assert_eq!(probe.api_key, "sk-test-secret");
    assert_eq!(probe.endpoint_path, "/chat/completions");
    assert_eq!(probe.category, "text-to-text");

    remove_workspace(&workspace_dir);
}

#[test]
fn volcengine_image_generation_uses_images_generations_endpoint() {
    let workspace_dir = initialized_workspace("model-config-volcengine-image-endpoint");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "scene-image-generation".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "volcengine".to_string(),
                display_name: "火山文生图".to_string(),
                execution_mode: "sync".to_string(),
                model: "doubao-seedream-4-0-250828".to_string(),
                endpoint_path: Some("/chat/completions".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");

    assert_eq!(config.endpoint_path.as_deref(), Some("/images/generations"));

    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "volcengine".to_string(),
                capability_id: Some(capability_id),
            },
            "ak-test-secret".to_string(),
        )
        .expect("secret should save");
    let tester = RecordingConnectionTester::new(true);

    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &tester)
        .expect("test config should use tester");
    let probe = tester
        .take_probe()
        .expect("provider probe should be recorded");

    assert_eq!(probe.provider_profile_id, "volcengine");
    assert_eq!(probe.base_url, "https://ark.cn-beijing.volces.com/api/v3");
    assert_eq!(probe.endpoint_path, "/images/generations");
    assert_eq!(probe.category, "text-to-image");
    assert_eq!(probe.model, "doubao-seedream-4-0-250828");

    remove_workspace(&workspace_dir);
}

#[test]
fn volcengine_image_understanding_uses_responses_endpoint() {
    let workspace_dir = initialized_workspace("model-config-volcengine-image-understanding");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "viral-style-analysis".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "volcengine".to_string(),
                display_name: "火山图片理解".to_string(),
                execution_mode: "sync".to_string(),
                model: "doubao-seed-2-1-pro-260628".to_string(),
                endpoint_path: Some("/chat/completions".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");

    assert_eq!(config.endpoint_path.as_deref(), Some("/responses"));

    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "volcengine".to_string(),
                capability_id: Some(capability_id),
            },
            "ak-test-secret".to_string(),
        )
        .expect("secret should save");
    let tester = RecordingConnectionTester::new(true);

    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &tester)
        .expect("test config should use tester");
    let probe = tester
        .take_probe()
        .expect("provider probe should be recorded");

    assert_eq!(probe.provider_profile_id, "volcengine");
    assert_eq!(probe.base_url, "https://ark.cn-beijing.volces.com/api/v3");
    assert_eq!(probe.endpoint_path, "/responses");
    assert_eq!(probe.category, "image-to-text");
    assert_eq!(probe.model, "doubao-seed-2-1-pro-260628");

    remove_workspace(&workspace_dir);
}

#[test]
fn testing_one_category_config_marks_related_defaults_without_extra_provider_calls() {
    let workspace_dir = initialized_workspace("model-config-related-category-status");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let scene_config = save_volcengine_text_to_image_config(
        &model_service,
        &workspace_dir,
        "scene-image-generation",
    );
    let detail_config = save_volcengine_text_to_image_config(
        &model_service,
        &workspace_dir,
        "product-detail-generation",
    );

    for config in [&scene_config, &detail_config] {
        model_service
            .set_default_config(
                &workspace_dir,
                SetDefaultModelConfigInput {
                    capability_id: config.capability_id.clone(),
                    config_id: config.id.clone(),
                },
            )
            .expect("default should switch");
        secret_service
            .save_secret(
                &workspace_dir,
                SecretScope {
                    provider_profile_id: "volcengine".to_string(),
                    capability_id: Some(config.capability_id.clone()),
                },
                "ak-test-secret".to_string(),
            )
            .expect("secret should save");
    }

    let tester = CountingConnectionTester::default();
    model_service
        .test_config_with_tester(&workspace_dir, &scene_config.id, &tester)
        .expect("test config should use tester once");

    assert_eq!(tester.call_count(), 1);
    assert_eq!(
        model_service
            .get_config(&workspace_dir, &scene_config.id)
            .expect("scene config should reload")
            .connection_status,
        "available"
    );
    assert_eq!(
        model_service
            .get_config(&workspace_dir, &detail_config.id)
            .expect("detail config should reload")
            .connection_status,
        "available"
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn test_config_persists_unavailable_when_provider_connection_fails() {
    let workspace_dir = initialized_workspace("model-config-provider-failed");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "listing-copy".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 文案".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-4.1-mini".to_string(),
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
                capability_id: Some(capability_id),
            },
            "sk-test-secret".to_string(),
        )
        .expect("secret should save");

    let result = model_service
        .test_config_with_tester(
            &workspace_dir,
            &config.id,
            &RecordingConnectionTester::new(false),
        )
        .expect("failed provider test should still persist status");
    let reloaded = model_service
        .get_config(&workspace_dir, &config.id)
        .expect("config should reload");

    assert!(!result.ok);
    assert_eq!(reloaded.connection_status, "unavailable");
    assert_eq!(
        reloaded.connection_message.as_deref(),
        Some("Provider 连接失败。")
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn modifying_endpoint_or_secret_invalidates_provider_connection_status() {
    let workspace_dir = initialized_workspace("model-config-connection-invalidate");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "listing-copy".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 文案".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-4.1-mini".to_string(),
                endpoint_path: Some("/v1/chat/completions".to_string()),
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
    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("test config should mark available");

    let endpoint_changed = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: Some(config.id.clone()),
                capability_id: capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 文案".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-4.1-mini".to_string(),
                endpoint_path: Some("/v1/responses".to_string()),
                enabled: true,
            },
        )
        .expect("config should save after endpoint change");
    assert_eq!(endpoint_changed.connection_status, "untested");
    assert!(endpoint_changed.connection_tested_at.is_none());

    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("test config should mark available again");
    secret_service
        .save_secret(
            &workspace_dir,
            SecretScope {
                provider_profile_id: "openai".to_string(),
                capability_id: Some(capability_id),
            },
            "sk-test-secret-rotated".to_string(),
        )
        .expect("rotating secret should invalidate related configs");
    let secret_changed = model_service
        .get_config(&workspace_dir, &config.id)
        .expect("config should reload after secret change");

    assert_eq!(secret_changed.connection_status, "untested");
    assert!(secret_changed.connection_tested_at.is_none());

    remove_workspace(&workspace_dir);
}

#[test]
fn saving_same_secret_does_not_invalidate_provider_connection_status() {
    let workspace_dir = initialized_workspace("model-config-same-secret-keeps-status");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_id = "listing-copy".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "volcengine".to_string(),
                display_name: "火山文生文".to_string(),
                execution_mode: "sync".to_string(),
                model: "deepseek-v4-flash-260425".to_string(),
                endpoint_path: Some("/chat/completions".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");
    let scope = SecretScope {
        provider_profile_id: "volcengine".to_string(),
        capability_id: Some(capability_id),
    };
    secret_service
        .save_secret(&workspace_dir, scope.clone(), "ak-test-secret".to_string())
        .expect("secret should save");
    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("test config should mark available");

    secret_service
        .save_secret(&workspace_dir, scope, "ak-test-secret".to_string())
        .expect("saving same secret should be a no-op");
    let reloaded = model_service
        .get_config(&workspace_dir, &config.id)
        .expect("config should reload");

    assert_eq!(reloaded.connection_status, "available");

    remove_workspace(&workspace_dir);
}

#[test]
fn provider_connection_status_controls_capability_availability() {
    let workspace_dir = initialized_workspace("model-config-capability-status");
    let model_service = ModelConfigService::new();
    let secret_service = SecretService::new();
    let capability_service = CapabilityService::new();
    let capability_id = "listing-copy".to_string();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.clone(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 文案".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-4.1-mini".to_string(),
                endpoint_path: Some("/v1/chat/completions".to_string()),
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
    model_service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: capability_id.clone(),
                config_id: config.id.clone(),
            },
        )
        .expect("default should switch");

    let untested = capability_service
        .get_capability(&workspace_dir, &capability_id)
        .expect("capability should load");
    assert!(!untested.available);
    assert_eq!(
        untested.unavailable_reason.as_deref(),
        Some("模型连接尚未测试。")
    );

    model_service
        .test_config_with_tester(&workspace_dir, &config.id, &SuccessfulConnectionTester)
        .expect("test config should mark available");
    let available = capability_service
        .get_capability(&workspace_dir, &capability_id)
        .expect("capability should reload");

    assert!(available.available);

    remove_workspace(&workspace_dir);
}

#[test]
fn set_default_config_is_unique_per_capability() {
    let workspace_dir = initialized_workspace("model-config-default");
    let service = ModelConfigService::new();
    let first = service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: "listing-copy".to_string(),
                provider_profile_id: "mock-local".to_string(),
                display_name: "文案 Mock A".to_string(),
                execution_mode: "sync".to_string(),
                model: "mock-copy-a".to_string(),
                endpoint_path: None,
                enabled: true,
            },
        )
        .expect("first config should save");
    let second = service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: "listing-copy".to_string(),
                provider_profile_id: "mock-local".to_string(),
                display_name: "文案 Mock B".to_string(),
                execution_mode: "sync".to_string(),
                model: "mock-copy-b".to_string(),
                endpoint_path: None,
                enabled: true,
            },
        )
        .expect("second config should save");

    service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: "listing-copy".to_string(),
                config_id: second.id.clone(),
            },
        )
        .expect("default should update");
    let configs = service
        .list_configs(&workspace_dir)
        .expect("configs should reload");

    assert!(
        !configs
            .iter()
            .find(|config| config.id == first.id)
            .expect("first config should exist")
            .is_default
    );
    assert!(
        configs
            .iter()
            .find(|config| config.id == second.id)
            .expect("second config should exist")
            .is_default
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn secrets_are_saved_only_in_secret_status_boundary() {
    let workspace_dir = initialized_workspace("model-secret");
    let service = SecretService::new();
    let scope = SecretScope {
        provider_profile_id: "openai".to_string(),
        capability_id: Some("scene-image-generation".to_string()),
    };

    let status = service
        .save_secret(&workspace_dir, scope.clone(), "sk-test-secret".to_string())
        .expect("secret should save");
    let loaded = service
        .get_secret_status(&workspace_dir, scope)
        .expect("secret status should load");

    assert!(status.configured);
    assert!(loaded.configured);
    assert_eq!(loaded.storage, "sqlite-local");

    remove_workspace(&workspace_dir);
}

#[test]
fn secret_can_be_revealed_after_user_requests_plaintext() {
    let workspace_dir = initialized_workspace("model-secret-reveal");
    let service = SecretService::new();
    let scope = SecretScope {
        provider_profile_id: "deepseek".to_string(),
        capability_id: Some("listing-copy".to_string()),
    };

    service
        .save_secret(
            &workspace_dir,
            scope.clone(),
            "sk-visible-secret".to_string(),
        )
        .expect("secret should save");

    let revealed = service
        .reveal_secret(&workspace_dir, scope)
        .expect("secret should reveal");

    assert_eq!(revealed, "sk-visible-secret");

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

fn save_volcengine_text_to_image_config(
    model_service: &ModelConfigService,
    workspace_dir: &Path,
    capability_id: &str,
) -> LocalModelConfigView {
    model_service
        .save_config(
            workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: capability_id.to_string(),
                provider_profile_id: "volcengine".to_string(),
                display_name: format!("{capability_id} 火山文生图"),
                execution_mode: "sync".to_string(),
                model: "doubao-seedream-4-0-250828".to_string(),
                endpoint_path: Some("/chat/completions".to_string()),
                enabled: true,
            },
        )
        .expect("volcengine text-to-image config should save")
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
struct CountingConnectionTester {
    call_count: AtomicUsize,
}

impl CountingConnectionTester {
    fn call_count(&self) -> usize {
        self.call_count.load(Ordering::SeqCst)
    }
}

impl ProviderConnectionTester for CountingConnectionTester {
    fn test_connection(
        &self,
        _probe: ProviderConnectionProbe,
    ) -> Result<ProviderConnectionResult, ProviderConnectionError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        Ok(ProviderConnectionResult {
            elapsed_ms: 0,
            message: "Provider 连接可用。".to_string(),
            ok: true,
        })
    }
}

struct RecordingConnectionTester {
    ok: bool,
    probe: std::sync::Mutex<Option<ProviderConnectionProbe>>,
}

impl RecordingConnectionTester {
    fn new(ok: bool) -> Self {
        Self {
            ok,
            probe: std::sync::Mutex::new(None),
        }
    }

    fn take_probe(&self) -> Option<ProviderConnectionProbe> {
        self.probe
            .lock()
            .expect("probe lock should not poison")
            .take()
    }
}

impl ProviderConnectionTester for RecordingConnectionTester {
    fn test_connection(
        &self,
        probe: ProviderConnectionProbe,
    ) -> Result<ProviderConnectionResult, ProviderConnectionError> {
        *self.probe.lock().expect("probe lock should not poison") = Some(probe);
        Ok(ProviderConnectionResult {
            elapsed_ms: 0,
            message: if self.ok {
                "Provider 连接可用。".to_string()
            } else {
                "Provider 连接失败。".to_string()
            },
            ok: self.ok,
        })
    }
}
