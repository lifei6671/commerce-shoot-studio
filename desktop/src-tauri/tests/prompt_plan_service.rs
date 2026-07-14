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
        Some("产品与卖点\n产品：儿童骑行头盔，轻量透气，适合日常通勤。\n卖点：轻量透气 / 日常通勤 / 佩戴舒适\n顾虑：佩戴闷热 / 安全感不足 / 日常不百搭\n视觉重心：儿童骑行头盔作为画面视觉中心，直观展示轻量透气与通勤价值\n\n视觉定调\n风格：通勤质感风，突出简洁通勤气质\n色彩：#111827/#F8FAFC 作为统一配色，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：柔和左上方光源，突出商品轮廓与材质")
    );
    assert_eq!(plan.resolver_version, "product-detail-scene-description-v1");
    assert_eq!(plan.template_version, "v1");
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.items[0].id, "style-1-scenario");
    assert_eq!(plan.items[0].r#type, "scene");
    assert_eq!(plan.items[0].intent["moduleId"], "scenario");
    assert_eq!(plan.items[0].intent["styleTitle"], "通勤质感风");
    assert_eq!(plan.items[0].intent["targetLanguage"], "中文");
    assert_eq!(plan.items[0].intent["sceneTitle"], "日常通勤场景");
    assert!(plan.items[0]
        .display_summary
        .contains("主标题: \"日常通勤场景\""));
    assert!(plan.items[0].intent["imagePrompt"]
        .as_str()
        .unwrap_or_default()
        .contains("禁止新增未提供的品牌 Logo"));
    assert!(plan.items[0].intent["copyRequirements"]
        .as_str()
        .unwrap_or_default()
        .contains("主标题: \"日常通勤场景\""));
    assert_eq!(
        plan.items[0].intent["imageType"],
        "使用场景图: 呈现真实使用场景"
    );
    assert_eq!(
        plan.items[0].intent["designSpec"],
        "产品与卖点\n产品：儿童骑行头盔，轻量透气，适合日常通勤。\n卖点：轻量透气 / 日常通勤 / 佩戴舒适\n顾虑：佩戴闷热 / 安全感不足 / 日常不百搭\n视觉重心：儿童骑行头盔作为画面视觉中心，直观展示轻量透气与通勤价值\n\n视觉定调\n风格：通勤质感风，突出简洁通勤气质\n色彩：#111827/#F8FAFC 作为统一配色，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：柔和左上方光源，突出商品轮廓与材质"
    );
    assert_eq!(plan.items[0].intent["index"], 1);

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
    assert_eq!(plan.items[0].intent["targetLanguage"], "中文");
    assert!(plan.items[0]
        .intent
        .get("imagePrompt")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .contains("禁止新增未提供的品牌 Logo"));

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
        let system_prompt = request.input["prompt"]["messages"][0]["content"]
            .as_str()
            .unwrap_or_default();
        let user_prompt = request.input["prompt"]["messages"][1]["content"]
            .as_str()
            .unwrap_or_default();
        assert!(system_prompt.contains("输入的商品卖点摘要是唯一事实来源"));
        assert!(!system_prompt.contains("[module_config_rules]"));
        assert!(!system_prompt.contains("[module_config_rules.global_rules]"));
        assert!(!system_prompt.contains("{target_language}"));
        assert!(user_prompt.contains("已选模块执行指令"));
        assert!(!user_prompt.contains("[module_config_rules]"));
        assert!(!user_prompt.contains("[[scene_modules]]"));
        assert!(!user_prompt.contains("image_type_rule ="));
        assert!(!user_prompt.contains("copy_requirements_template ="));
        assert!(user_prompt.contains("usage_scene"));
        assert!(user_prompt.contains("使用场景图"));
        assert!(user_prompt.contains("image_type 生成指令"));
        assert!(user_prompt.contains("必须从商品卖点中提炼具体、可转化的核心观点"));
        assert!(user_prompt.contains("core_goal：让用户代入真实使用方式"));
        assert!(user_prompt.contains("image_prompt 生成指令"));
        assert!(user_prompt.contains("禁止原样返回 image_prompt 模板句子"));
        assert!(user_prompt.contains("必须把模板中的商品主体、商品形态、第一购买理由、场景和文字区改写成当前商品的具体生图描述"));
        assert!(user_prompt.contains("copy_requirements 生成指令"));
        assert!(user_prompt.contains("design_spec"));
        assert!(user_prompt.contains("产品与卖点"));
        assert!(user_prompt.contains("视觉定调"));
        assert!(user_prompt.contains("副标题与标注标签二选一，不能同时输出"));
        assert!(user_prompt.contains(
            "画面如果存在明确可指向的商品局部、结构、动作点、规格、配件、SKU 或成分锚点"
        ));
        assert!(user_prompt
            .contains("不要输出“结构化信息: 不使用”“标注标签: 不使用”“缺失信息: 已足够”这类空项"));
        assert!(user_prompt.contains("禁止原样返回模板占位句"));
        assert!(user_prompt.contains("概括核心使用场景"));
        assert!(user_prompt.contains("画面需要直接生成主标题和副标题文字"));
        assert!(user_prompt.contains("标注标签: 默认不使用"));
        assert!(user_prompt.contains("目标语言：中文"));
        assert!(!user_prompt.contains("{target_language}"));
        assert!(!user_prompt.contains("ingredient_composition"));
        assert!(!user_prompt.contains("商品成分图"));
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
                            "design_spec": "产品与卖点\n产品：儿童骑行头盔，轻量透气，适合日常通勤。\n卖点：轻量透气 / 日常通勤 / 佩戴舒适\n顾虑：佩戴闷热 / 安全感不足 / 日常不百搭\n视觉重心：儿童骑行头盔作为画面视觉中心，直观展示轻量透气与通勤价值\n\n视觉定调\n风格：通勤质感风，突出简洁通勤气质\n色彩：#111827/#F8FAFC 作为统一配色，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：柔和左上方光源，突出商品轮廓与材质",
                            "visualConsistency": {
                                "productAnchor": "儿童骑行头盔主体",
                                "backgroundAnchor": "浅灰摄影棚背景",
                                "lightingAnchor": "柔和左上方光源",
                                "compositionAnchor": "主体居中并保留右侧信息区",
                                "textAreaAnchor": "右侧预留文字安全区"
                            },
                            "items": [
                                {
                                    "index": 1,
                                    "moduleId": "scenario",
                                    "moduleTitle": "使用场景图",
                                    "image_type": "使用场景图: 呈现真实使用场景",
                                    "sceneTitle": "日常通勤场景",
                                    "image_prompt": "适配 1:1 比例的电商详情页画面，商品主体为儿童骑行头盔，置于浅灰摄影棚背景中，柔和左上方光源，主体中央偏左，右侧生成清晰可读的中文标题和副标题；用于使用场景图模块，强调已提供的轻量透气和日常通勤信息，图片内文字必须严格按照 copy_requirements 生成，禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标。",
                                    "copy_requirements": "主标题: \"日常通勤场景\"\n主标题排版: 位置=右侧信息区；字号=画面高度的 7%-10%；字体=中等偏粗无衬线体；字重=加粗；颜色=与背景强对比；对齐=左对齐；安全边距=距离边缘至少 8%；最大行数=1 行。\n副标题: \"轻量透气\"\n副标题排版: 位置=主标题下方；字号=画面高度的 3%-4.5%；字体=常规无衬线体；字重=常规；颜色=弱于主标题；对齐=跟随主标题；与主标题间距=主标题高度的 15%-25%；最大行数=1 行。\n结构化信息: 不使用。\n标注标签: 默认不使用；仅当画面中有明确动作点/接触点/安装点时使用 1-2 个线性标注。\n文字生成要求: 主标题、副标题和已启用标注必须作为画面内清晰可读文字生成；禁止乱码、伪文字、额外促销词、虚假参数或虚假认证。\n目标语言: 中文",
                                    "textOverlay": {
                                        "headline": "日常通勤",
                                        "subheadline": "轻量透气"
                                    },
                                    "constraints": [
                                        "不得编造商品参数",
                                        "不得新增未提供的品牌 Logo",
                                        "不得生成价格、销量、认证标识",
                                        "图片中文字必须严格按照 copy_requirements 生成",
                                        "image_prompt 必须与 copy_requirements 保持一致"
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
