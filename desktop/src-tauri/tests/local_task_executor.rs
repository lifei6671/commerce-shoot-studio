use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::assets::AssetKind;
use commerce_shoot_studio_lib::domain::generation::{
    GenerationTaskKind, GenerationTaskStage, GenerationTaskStatus, WorkspaceKind,
};
use commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::assets::{AssetService, ImportImagesInput};
use commerce_shoot_studio_lib::services::generation::{
    CreateGenerationTaskInput, GenerationService, GenerationTaskInputAssetInput,
};
use commerce_shoot_studio_lib::services::local_task_executor::LocalTaskExecutor;
use commerce_shoot_studio_lib::services::model_config::{
    ModelConfigService, SaveLocalModelConfigInput, SetDefaultModelConfigInput,
};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn run_next_executes_oldest_queued_task_with_model_gateway_and_events() {
    let workspace_dir = initialized_workspace("local-executor-success");
    let generation_service = GenerationService::new();
    let first = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-exec-1"))
        .expect("first task should create");
    let second = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-exec-2"))
        .expect("second task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let executed = generation_service
        .get_task(&workspace_dir, &first.id)
        .expect("executed task should reload");
    let pending = generation_service
        .get_task(&workspace_dir, &second.id)
        .expect("pending task should reload");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    let invocation_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM model_invocations WHERE id = ?1 AND capability_id = 'scene-image-generation'",
            [result.invocation_id.as_deref().expect("invocation id")],
            |row| row.get(0),
        )
        .expect("invocation count should query");

    assert_eq!(result.task_id, first.id);
    assert_eq!(executed.status, GenerationTaskStatus::Succeeded);
    assert_eq!(executed.stage, GenerationTaskStage::Completed);
    assert_eq!(pending.status, GenerationTaskStatus::Queued);
    assert_eq!(invocation_count, 1);
    assert_eq!(
        task_event_count(&workspace_dir, &first.id, "task.provider-called"),
        1
    );
    assert_eq!(
        task_event_count(&workspace_dir, &first.id, "task.succeeded"),
        1
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_task_executes_requested_task_without_consuming_older_queue() {
    let workspace_dir = initialized_workspace("local-executor-targeted-task");
    let generation_service = GenerationService::new();
    let older = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-targeted-old"))
        .expect("older task should create");
    let target = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-targeted-new"))
        .expect("target task should create");

    let result = LocalTaskExecutor::new()
        .run_task(&workspace_dir, &target.id)
        .expect("executor should run")
        .expect("target task should exist");
    let older_task = generation_service
        .get_task(&workspace_dir, &older.id)
        .expect("older task should reload");
    let target_task = generation_service
        .get_task(&workspace_dir, &target.id)
        .expect("target task should reload");

    assert_eq!(result.task_id, target.id);
    assert_eq!(older_task.status, GenerationTaskStatus::Queued);
    assert_eq!(target_task.status, GenerationTaskStatus::Succeeded);
    assert_eq!(target_task.stage, GenerationTaskStage::Completed);

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_persists_generated_result_asset_for_scene_task() {
    let workspace_dir = initialized_workspace("local-executor-generated-asset");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-generated-asset"))
        .expect("task should create");

    LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");

    assert_eq!(detail.output_assets.len(), 1);
    let output = &detail.output_assets[0];
    assert_eq!(output.role, "output");
    assert_eq!(output.sort_order, 0);
    assert_eq!(output.asset.kind.as_str(), "generated");
    assert_eq!(output.asset.mime_type, "image/png");
    assert_eq!(output.asset.lifecycle.as_str(), "active");
    assert_eq!(output.asset.width, Some(1));
    assert_eq!(output.asset.height, Some(1));
    assert!(output.asset.relative_path.starts_with("assets/generated/"));
    assert!(workspace_dir
        .join(relative_path_to_platform(&output.asset.relative_path))
        .is_file());
    assert_eq!(
        task_event_count(&workspace_dir, &task.id, "task.result-saved"),
        1
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_persists_listing_copy_output_for_history_card() {
    let workspace_dir = initialized_workspace("local-executor-listing-copy");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(
            &workspace_dir,
            create_listing_copy_task("listing-copy-exec-1"),
        )
        .expect("listing copy task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    let invocation_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM model_invocations WHERE id = ?1 AND capability_id = 'listing-copy'",
            [result.invocation_id.as_deref().expect("invocation id")],
            |row| row.get(0),
        )
        .expect("invocation count should query");

    assert_eq!(result.task_id, task.id);
    assert_eq!(detail.task.status, GenerationTaskStatus::Succeeded);
    assert_eq!(detail.output_assets.len(), 0);
    assert_eq!(
        detail
            .output
            .as_ref()
            .and_then(|value| value.get("platform"))
            .and_then(serde_json::Value::as_str),
        Some("taobao")
    );
    assert_eq!(
        detail
            .output
            .as_ref()
            .and_then(|value| value.get("title"))
            .and_then(serde_json::Value::as_str),
        Some("藏青运动风字母印花圆领短袖T恤")
    );
    assert_eq!(invocation_count, 1);
    assert_eq!(
        task_event_count(&workspace_dir, &task.id, "task.output-saved"),
        1
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_invokes_product_detail_model_once_per_item_in_one_task() {
    let workspace_dir = initialized_workspace("local-executor-product-detail-items");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(
            &workspace_dir,
            create_product_detail_task("product-detail-items-exec-1"),
        )
        .expect("product detail task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    let task_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM generation_tasks WHERE idempotency_key = 'product-detail-items-exec-1'",
            [],
            |row| row.get(0),
        )
        .expect("task count should query");
    let invocation_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM model_invocations WHERE capability_id = 'product-detail-generation'",
            [],
            |row| row.get(0),
        )
        .expect("invocation count should query");

    assert_eq!(result.task_id, task.id);
    assert_eq!(task_count, 1);
    assert_eq!(invocation_count, 3);
    assert_eq!(
        task_event_count(&workspace_dir, &task.id, "task.item-provider-called"),
        3
    );
    assert_eq!(
        task_event_count(&workspace_dir, &task.id, "task.item-provider-succeeded"),
        3
    );
    assert_eq!(detail.output_assets.len(), 3);
    assert_eq!(
        detail
            .output_assets
            .iter()
            .map(|asset| asset.sort_order)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_preserves_unique_sort_orders_when_items_return_multiple_images() {
    let workspace_dir = initialized_workspace("local-executor-product-detail-multi-image");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(
            &workspace_dir,
            create_product_detail_multi_image_task("product-detail-multi-image-exec-1"),
        )
        .expect("product detail task should create");

    LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");

    assert_eq!(detail.task.status, GenerationTaskStatus::Succeeded);
    assert_eq!(detail.output_assets.len(), 4);
    assert_eq!(
        detail
            .output_assets
            .iter()
            .map(|asset| asset.sort_order)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_keeps_successful_product_detail_items_when_one_item_is_invalid() {
    let workspace_dir = initialized_workspace("local-executor-product-detail-partial-failure");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(
            &workspace_dir,
            create_product_detail_task_with_invalid_item("product-detail-partial-failure-exec-1"),
        )
        .expect("product detail task should create");

    LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");

    assert_eq!(detail.task.status, GenerationTaskStatus::Succeeded);
    assert_eq!(detail.output_assets.len(), 2);
    assert_eq!(
        detail
            .output_assets
            .iter()
            .map(|asset| asset.sort_order)
            .collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert_eq!(
        task_event_count(&workspace_dir, &task.id, "task.item-failed"),
        1
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_returns_none_when_queue_is_empty() {
    let workspace_dir = initialized_workspace("local-executor-empty");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should inspect queue");

    assert!(result.is_none());

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_respects_single_local_concurrency() {
    let workspace_dir = initialized_workspace("local-executor-concurrency");
    let generation_service = GenerationService::new();
    generation_service
        .create_task(&workspace_dir, create_scene_task("scene-running-1"))
        .expect("first task should create");
    generation_service
        .create_task(&workspace_dir, create_scene_task("scene-running-2"))
        .expect("second task should create");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE idempotency_key = 'scene-running-1'",
            [],
        )
        .expect("mark running");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should inspect queue");
    let queued_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM generation_tasks WHERE status = 'queued'",
            [],
            |row| row.get(0),
        )
        .expect("queued count should query");

    assert!(result.is_none());
    assert_eq!(queued_count, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_marks_task_failed_when_model_capability_is_unavailable() {
    let workspace_dir = initialized_workspace("local-executor-model-unavailable");
    let model_service = ModelConfigService::new();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: "scene-image-generation".to_string(),
                provider_profile_id: "volcengine".to_string(),
                display_name: "火山引擎场景图".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-image-test".to_string(),
                base_url: None,
                endpoint_path: Some("/images/generations".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");
    model_service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: "scene-image-generation".to_string(),
                config_id: config.id,
            },
        )
        .expect("default config should switch");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-failed-1"))
        .expect("task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should handle provider failure")
        .expect("task should be attempted");
    let failed = generation_service
        .get_task(&workspace_dir, &task.id)
        .expect("failed task should reload");

    assert_eq!(result.task_id, task.id);
    assert!(result.invocation_id.is_none());
    assert_eq!(failed.status, GenerationTaskStatus::Failed);
    assert_eq!(failed.stage, GenerationTaskStage::Failed);
    assert!(
        failed.completed_at.is_some(),
        "failed terminal tasks should record completed_at"
    );
    assert_eq!(
        failed.error.as_ref().map(|error| error.code.as_str()),
        Some("MODEL_CAPABILITY_UNAVAILABLE")
    );
    assert_eq!(task_event_count(&workspace_dir, &task.id, "task.failed"), 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn clothing_scene_planning_rejects_mock_local_default_instead_of_fake_scenes() {
    let workspace_dir = initialized_workspace("local-executor-clothing-plan-no-mock");
    let generation_service = GenerationService::new();
    let mut input = create_clothing_scene_planning_task("clothing-plan-no-mock");
    input.input_assets = create_clothing_reference_input_assets(&workspace_dir);
    let task = generation_service
        .create_task(&workspace_dir, input)
        .expect("task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should handle unavailable provider")
        .expect("task should be attempted");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("failed task detail should load");

    assert_eq!(result.task_id, task.id);
    assert!(result.invocation_id.is_none());
    assert_eq!(detail.task.status, GenerationTaskStatus::Failed);
    assert_eq!(detail.task.stage, GenerationTaskStage::Failed);
    assert!(detail.output.is_none());
    assert_eq!(
        detail.task.error.as_ref().map(|error| error.code.as_str()),
        Some("MODEL_CAPABILITY_UNAVAILABLE")
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn clothing_tryon_generation_rejects_mock_local_default_instead_of_fake_images() {
    let workspace_dir = initialized_workspace("local-executor-clothing-tryon-no-mock");
    let generation_service = GenerationService::new();
    let mut input = create_clothing_tryon_task("clothing-tryon-no-mock");
    input.input_assets = create_clothing_reference_input_assets(&workspace_dir);
    let task = generation_service
        .create_task(&workspace_dir, input)
        .expect("task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should handle unavailable provider")
        .expect("task should be attempted");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("failed task detail should load");

    assert_eq!(result.task_id, task.id);
    assert!(result.invocation_id.is_none());
    assert_eq!(detail.task.status, GenerationTaskStatus::Failed);
    assert_eq!(detail.task.stage, GenerationTaskStage::Failed);
    assert!(detail.output_assets.is_empty());
    assert_eq!(
        detail.task.error.as_ref().map(|error| error.code.as_str()),
        Some("MODEL_CAPABILITY_UNAVAILABLE")
    );

    remove_workspace(&workspace_dir);
}

fn create_scene_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Scene,
        kind: GenerationTaskKind::ImageGeneration,
        title: "场景图任务".to_string(),
        prompt_plan_id: None,
        input: Some(serde_json::json!({
            "prompt": "白色摄影棚，柔光",
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn create_listing_copy_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Product,
        kind: GenerationTaskKind::ListingCopy,
        title: "商品上架文案".to_string(),
        prompt_plan_id: Some("local-product-plan".to_string()),
        input: Some(serde_json::json!({
            "platform": "taobao",
            "productSellingPoints": "藏青运动风字母印花圆领短袖T恤",
            "scenes": [
                {
                    "moduleId": "hero",
                    "sceneDescription": "首屏主视觉展示商品上身效果。"
                }
            ]
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn create_clothing_scene_planning_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Clothing,
        kind: GenerationTaskKind::ImageGeneration,
        title: "服饰场景动作规划".to_string(),
        prompt_plan_id: None,
        input: Some(serde_json::json!({
            "kind": "clothing-scene-planning",
            "selectedScenes": ["都市街头"],
            "customScene": "午后暖调阳光",
            "aiRecommended": false,
            "ratio": "3:4"
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn create_clothing_tryon_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Clothing,
        kind: GenerationTaskKind::ImageGeneration,
        title: "服饰出图".to_string(),
        prompt_plan_id: None,
        input: Some(serde_json::json!({
            "kind": "clothing-tryon-generation",
            "ratio": "3:4",
            "modelFeatures": {
                "gender": "女",
                "ageRange": "青年",
                "ethnicityAppearance": "东亚面孔",
                "face": "柔和鹅蛋脸，五官清晰",
                "body": "匀称身材，肩颈自然",
                "hair": "黑色中长直发",
                "skinTone": "自然暖白肤色",
                "overallStyle": "简约都市气质",
                "identityAnchor": ["保持脸部身份", "保持自然身材比例"]
            },
            "items": [
                {
                    "id": "scene-1-pose-1",
                    "scene": "都市街头",
                    "sceneVisualAnchor": "城市核心商圈人行道",
                    "scenePromptSegment": "街头时尚摄影，自然光充足",
                    "cameraSetup": {
                        "framing": "全身",
                        "perspective": "正面",
                        "shootingPosition": "平视机位"
                    },
                    "poseAction": "自然站立，展示服装正面版型",
                    "ratio": "3:4"
                }
            ]
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn create_clothing_reference_input_assets(
    workspace_dir: &Path,
) -> Vec<GenerationTaskInputAssetInput> {
    let source_path = workspace_dir.join("clothing-source.png");
    let model_path = workspace_dir.join("clothing-model.png");
    let png = transparent_png_bytes();
    fs::write(&source_path, &png).expect("source image should write");
    fs::write(&model_path, &png).expect("model image should write");
    let asset_service = AssetService::new();
    let source = asset_service
        .import_images(
            workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Source,
                paths: vec![source_path.to_string_lossy().to_string()],
            },
        )
        .expect("source image should import")
        .remove(0);
    let model = asset_service
        .import_images(
            workspace_dir,
            ImportImagesInput {
                kind: AssetKind::Model,
                paths: vec![model_path.to_string_lossy().to_string()],
            },
        )
        .expect("model image should import")
        .remove(0);

    vec![
        GenerationTaskInputAssetInput {
            asset_id: source.id,
            role: "source".to_string(),
            sort_order: 0,
        },
        GenerationTaskInputAssetInput {
            asset_id: model.id,
            role: "model".to_string(),
            sort_order: 1,
        },
    ]
}

fn create_product_detail_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Product,
        kind: GenerationTaskKind::ImageGeneration,
        title: "商品详情图".to_string(),
        prompt_plan_id: Some("local-product-plan".to_string()),
        input: Some(serde_json::json!({
            "items": [
                {
                    "imageId": "hero",
                    "moduleId": "hero",
                    "imagePrompt": "首屏主视觉，保留文字安全区。"
                },
                {
                    "imageId": "selling-point",
                    "moduleId": "selling-point",
                    "imagePrompt": "核心卖点图，展示商品外观。"
                },
                {
                    "imageId": "detail",
                    "moduleId": "detail",
                    "imagePrompt": "商品细节图，展示印花与面料。"
                }
            ]
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn create_product_detail_multi_image_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Product,
        kind: GenerationTaskKind::ImageGeneration,
        title: "商品详情图".to_string(),
        prompt_plan_id: Some("local-product-plan".to_string()),
        input: Some(serde_json::json!({
            "mockImageCount": 2,
            "items": [
                {
                    "imageId": "hero",
                    "moduleId": "hero",
                    "imagePrompt": "首屏主视觉，保留文字安全区。"
                },
                {
                    "imageId": "detail",
                    "moduleId": "detail",
                    "imagePrompt": "商品细节图，展示印花与面料。"
                }
            ]
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn create_product_detail_task_with_invalid_item(
    idempotency_key: &str,
) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Product,
        kind: GenerationTaskKind::ImageGeneration,
        title: "商品详情图".to_string(),
        prompt_plan_id: Some("local-product-plan".to_string()),
        input: Some(serde_json::json!({
            "items": [
                {
                    "imageId": "hero",
                    "moduleId": "hero",
                    "imagePrompt": "首屏主视觉。"
                },
                {
                    "imageId": "invalid",
                    "moduleId": "invalid"
                },
                {
                    "imageId": "detail",
                    "moduleId": "detail",
                    "imagePrompt": "商品细节图。"
                }
            ]
        })),
        prompt_plan_snapshot: None,
        input_assets: Vec::new(),
    }
}

fn task_event_count(workspace_dir: &Path, task_id: &str, event_type: &str) -> i64 {
    let database = WorkspaceDatabase::open(workspace_dir).expect("database should open");
    database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM task_events WHERE task_id = ?1 AND event_type = ?2",
            (task_id, event_type),
            |row| row.get(0),
        )
        .expect("event count should query")
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

fn relative_path_to_platform(relative_path: &str) -> PathBuf {
    relative_path.split('/').collect()
}

fn transparent_png_bytes() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]
}
