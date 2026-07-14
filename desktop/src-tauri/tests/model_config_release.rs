#![cfg(not(debug_assertions))]

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::model_config::{
    default_config_for_capability, ModelConfigError, ModelConfigService, SaveLocalModelConfigInput,
};
use commerce_shoot_studio_lib::services::model_gateway::{
    ModelGatewayRequest, ModelGatewayService,
};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};
use rusqlite::Connection;

#[test]
fn release_hides_and_removes_mock_configs_without_deleting_audit_history() {
    let workspace_directory = initialized_workspace("release-model-configs");
    let database = Connection::open(workspace_directory.join("workspace.db"))
        .expect("workspace database should open");
    database
        .execute(
            "
            INSERT INTO model_configs (
                id, capability_id, provider_profile_id, display_name, protocol,
                execution_mode, model, base_url, enabled, is_default
            )
            VALUES (
                'cfg_legacy_mock', 'listing-copy', 'mock-local', 'Legacy Mock',
                'openai-compatible', 'sync', 'mock-listing-copy-v1', 'mock://local', 1, 1
            )
            ",
            [],
        )
        .expect("legacy mock config should insert");
    database
        .execute(
            "
            INSERT INTO model_configs (
                id, capability_id, provider_profile_id, display_name, protocol,
                execution_mode, model, base_url, enabled, is_default
            )
            VALUES (
                'cfg_real_openai', 'listing-copy', 'openai', 'OpenAI Listing',
                'openai', 'sync', 'gpt-5-mini', 'https://api.openai.com', 1, 0
            )
            ",
            [],
        )
        .expect("real config should insert");
    database
        .execute(
            "
            INSERT INTO model_invocations (
                id, capability_id, provider_profile_id, model, status,
                request_summary_json, output_summary_json, completed_at
            )
            VALUES (
                'inv_legacy_mock', 'listing-copy', 'mock-local', 'mock-listing-copy-v1',
                'succeeded', '{}', '{}', datetime('now')
            )
            ",
            [],
        )
        .expect("legacy mock invocation should insert");
    drop(database);

    let service = ModelConfigService::new();
    let profiles = service
        .list_provider_profiles()
        .expect("release provider profiles should list");
    let configs = service
        .list_configs(&workspace_directory)
        .expect("release configs should list");

    assert!(profiles.iter().all(|profile| profile.id != "mock-local"));
    assert!(configs
        .iter()
        .all(|config| config.provider_profile_id != "mock-local"));
    assert!(configs.iter().any(|config| config.id == "cfg_real_openai"));
    assert!(matches!(
        service.get_config(&workspace_directory, "cfg_legacy_mock"),
        Err(ModelConfigError::NotFound(_))
    ));
    assert!(matches!(
        default_config_for_capability(&workspace_directory, "listing-copy"),
        Err(ModelConfigError::NotFound(_))
    ));
    assert!(matches!(
        service.save_config(
            &workspace_directory,
            SaveLocalModelConfigInput {
                id: Some("cfg_new_mock".to_string()),
                capability_id: "listing-copy".to_string(),
                provider_profile_id: "mock-local".to_string(),
                display_name: "New Mock".to_string(),
                execution_mode: "sync".to_string(),
                model: "mock-listing-copy-v1".to_string(),
                base_url: Some("mock://local".to_string()),
                endpoint_path: None,
                enabled: true,
            }
        ),
        Err(ModelConfigError::Validation(_))
    ));

    let database = Connection::open(workspace_directory.join("workspace.db"))
        .expect("workspace database should reopen");
    let invocation_count: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM model_invocations WHERE id = 'inv_legacy_mock'",
            [],
            |row| row.get(0),
        )
        .expect("legacy invocation should query");
    assert_eq!(invocation_count, 1);
    drop(database);

    fs::remove_dir_all(workspace_directory).expect("temporary workspace should clean up");
}

#[test]
fn release_rejects_deterministic_gateway_before_resolving_mock_config() {
    let workspace_directory = initialized_workspace("release-model-gateway");
    let error = ModelGatewayService::new()
        .invoke(
            &workspace_directory,
            ModelGatewayRequest {
                capability_id: "listing-copy".to_string(),
                input: serde_json::json!({ "debug": true }),
            },
        )
        .expect_err("release should reject deterministic gateway");

    assert_eq!(error.to_string(), "没有可用模型");
    fs::remove_dir_all(workspace_directory).expect("temporary workspace should clean up");
}

fn initialized_workspace(label: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    let workspace_directory =
        std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}"));
    WorkspaceService::new(WorkspaceFileSystem::new())
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_directory.clone(),
        })
        .expect("workspace should initialize");
    workspace_directory
}
