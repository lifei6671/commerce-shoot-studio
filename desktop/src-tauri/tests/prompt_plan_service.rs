use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::generation::WorkspaceKind;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
};
use commerce_shoot_studio_lib::services::prompt_plan::{CreatePromptPlanInput, PromptPlanService};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};
use serde_json::json;

#[test]
fn product_detail_prompt_plan_uses_text_to_text_capability_and_parses_scene_items() {
    let workspace_dir = initialized_workspace("prompt-plan-product-detail");

    let plan = PromptPlanService::new()
        .create_plan_with_adapter(
            &workspace_dir,
            CreatePromptPlanInput {
                workspace: WorkspaceKind::Product,
                intent: json!({
                    "platform": "淘宝天猫",
                    "language": "中文",
                    "ratio": "1:1",
                    "productSellingPoints": "儿童骑行头盔，轻量透气，适合日常通勤。",
                    "modules": [
                        { "moduleId": "scenario", "moduleTitle": "使用场景图", "description": "展示使用场景" }
                    ],
                    "viralStyles": [
                        {
                            "styleId": "style-1",
                            "styleTitle": "通勤质感风",
                            "subtitle": "突出简洁通勤气质",
                            "colors": ["#111827", "#F8FAFC"]
                        }
                    ]
                }),
            },
            &PromptPlanGatewayAdapter,
        )
        .expect("prompt plan should parse");

    assert_eq!(plan.workspace, WorkspaceKind::Product);
    assert_eq!(plan.status, "draft");
    assert_eq!(
        plan.user_editable_summary.as_deref(),
        Some("模型整理后的产品与卖点：儿童骑行头盔，核心卖点为轻量透气，并适合日常通勤表达。")
    );
    assert_eq!(plan.resolver_version, "product-detail-scene-description-v1");
    assert_eq!(plan.template_version, "v1");
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.items[0].id, "style-1-scenario");
    assert_eq!(plan.items[0].r#type, "scene");
    assert_eq!(plan.items[0].intent["moduleId"], "scenario");
    assert_eq!(plan.items[0].intent["styleTitle"], "通勤质感风");
    assert!(plan.items[0].display_summary.contains("儿童骑行头盔"));
    assert!(plan.items[0].intent["imagePrompt"]
        .as_str()
        .unwrap_or_default()
        .contains("禁止生成品牌 Logo"));

    remove_workspace(&workspace_dir);
}

#[test]
fn product_detail_prompt_plan_works_with_default_mock_config() {
    let workspace_dir = initialized_workspace("prompt-plan-default-mock");

    let plan = PromptPlanService::new()
        .create_plan(
            &workspace_dir,
            CreatePromptPlanInput {
                workspace: WorkspaceKind::Product,
                intent: json!({
                    "platform": "淘宝天猫",
                    "language": "中文",
                    "ratio": "1:1",
                    "productSellingPoints": "藏青运动风字母印花圆领短袖T恤，清爽休闲，日常好搭。",
                    "modules": [
                        { "moduleId": "hero", "moduleTitle": "首屏主视觉", "description": "突出上身效果" },
                        { "moduleId": "detail", "moduleTitle": "商品细节图", "description": "展示印花与面料" }
                    ],
                    "viralStyles": []
                }),
            },
        )
        .expect("default mock prompt plan should parse");

    assert_eq!(plan.workspace, WorkspaceKind::Product);
    assert_eq!(plan.status, "draft");
    assert_eq!(plan.items.len(), 2);
    assert_eq!(plan.items[0].intent["moduleId"], "hero");
    assert_eq!(plan.items[1].intent["moduleId"], "detail");
    assert!(plan.items[0]
        .intent
        .get("imagePrompt")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .contains("禁止生成品牌 Logo"));

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

struct PromptPlanGatewayAdapter;

impl ModelGatewayAdapter for PromptPlanGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        assert_eq!(request.capability_id, "prompt-plan");
        assert_eq!(request.input["prompt"]["id"], "product-detail-scene-prompt");
        assert_eq!(request.input["maxOutputTokens"], 12000);
        assert_eq!(request.input["prompt"]["messages"][0]["role"], "system");
        assert_eq!(request.input["prompt"]["messages"][1]["role"], "user");
        assert_eq!(request.input["context"]["platform"], "淘宝天猫");
        assert_eq!(
            request.input["context"]["modules"][0]["moduleId"],
            "scenario"
        );
        assert!(request.input["prompt"]["messages"][1]["content"]
            .as_str()
            .unwrap_or_default()
            .contains("\"moduleTitle\":\"使用场景图\""));

        Ok(ModelGatewayAdapterResult {
            output_text: Some(
                json!({
                    "version": "v1",
                    "productSummary": "模型整理后的产品与卖点：儿童骑行头盔，核心卖点为轻量透气，并适合日常通勤表达。",
                    "groups": [
                        {
                            "styleId": "style-1",
                            "styleTitle": "通勤质感风",
                            "colors": ["#111827", "#F8FAFC"],
                            "visualConsistency": {
                                "productAnchor": "儿童骑行头盔主体",
                                "backgroundAnchor": "浅灰摄影棚背景",
                                "lightingAnchor": "柔和左上方光源",
                                "compositionAnchor": "主体居中并保留右侧信息区",
                                "textAreaAnchor": "右侧预留文字安全区"
                            },
                            "items": [
                                {
                                    "moduleId": "scenario",
                                    "moduleTitle": "使用场景图",
                                    "sceneTitle": "日常通勤场景",
                                    "sceneDescription": "画面以儿童骑行头盔为主体，置于浅灰摄影棚背景中，整体延续通勤质感风的克制配色和柔和左上方光源。商品位于画面中央偏左，右侧预留卖点信息区，用于使用场景图模块，强调已提供的轻量透气和日常通勤信息，不添加品牌、价格或认证。",
                                    "imagePrompt": "适配 1:1 比例的电商详情页画面，商品主体为儿童骑行头盔，置于浅灰摄影棚背景中，柔和左上方光源，主体中央偏左，右侧预留文字安全区；用于使用场景图模块，强调已提供的轻量透气和日常通勤信息，禁止生成品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标。",
                                    "textOverlay": {
                                        "headline": "日常通勤",
                                        "subheadline": "轻量透气"
                                    },
                                    "constraints": [
                                        "不得编造商品参数",
                                        "不得生成品牌 Logo",
                                        "不得生成价格、销量、认证标识",
                                        "图片中只预留文字安全区，不直接生成可读文字",
                                        "imagePrompt 必须与 sceneDescription 保持一致"
                                    ]
                                }
                            ]
                        }
                    ]
                })
                .to_string(),
            ),
            output_json: json!({ "type": "text" }),
            usage_json: None,
        })
    }
}
