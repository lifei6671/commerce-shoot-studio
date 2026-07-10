use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::ai_assist::{
    AiAssistService, ProductSellingPointsImageInput, ProductSellingPointsInput,
    ViralStyleAnalysisInput,
};
use commerce_shoot_studio_lib::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
};
use commerce_shoot_studio_lib::services::prompt_registry::{
    render_prompt_for_roles, render_roleless_prompt, PromptTemplateId,
};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn product_selling_points_prompt_keeps_rules_as_system_and_task_as_user() {
    let messages = render_prompt_for_roles(PromptTemplateId::ProductSellingPoints)
        .expect("prompt should render");

    assert_eq!(messages[0].role, "system");
    assert!(messages[0]
        .content
        .contains("你是一名专业的电商商品详情页文案策划"));
    assert!(messages[0].content.contains("优先读取图片中的可见文字"));
    assert!(messages[0].content.contains("商品类目"));
    assert!(messages[0]
        .content
        .contains("不得编造图片无法确认的品牌、型号、价格"));
    assert!(messages[0].content.contains("如信息不足，写“需补充”"));
    assert_eq!(messages[1].role, "user");
    assert!(messages[1].content.contains("请根据上传图片识别商品信息"));
    assert!(!messages[1]
        .content
        .contains("你是一名专业的电商商品详情页文案策划"));
}

#[test]
fn product_selling_points_prompt_can_render_roleless_fallback() {
    let prompt = render_roleless_prompt(PromptTemplateId::ProductSellingPoints)
        .expect("prompt should render");

    assert!(prompt.contains("【应用规则】"));
    assert!(prompt.contains("【用户任务】"));
    assert!(prompt.contains("如果多张图片中明显包含多个不同商品"));
    assert!(prompt.contains("请根据上传图片识别商品信息"));
}

#[test]
fn viral_style_analysis_prompt_keeps_rules_as_system_and_task_as_user() {
    let messages = render_prompt_for_roles(PromptTemplateId::ViralStyleAnalysis)
        .expect("prompt should render");

    assert_eq!(messages[0].role, "system");
    assert!(messages[0]
        .content
        .contains("你是一名专业的电商视觉营销与爆款内容策划专家"));
    assert!(messages[0].content.contains("输出必须是合法 JSON"));
    assert!(messages[0].content.contains("小标题控制在 8-15 个汉字"));
    assert!(messages[0]
        .content
        .contains("每个风格方向只返回 2-3 个颜色"));
    assert!(messages[0].content.contains("globalStyleNote"));
    assert!(messages[0].content.contains("fontStyleDescription"));
    assert!(messages[0].content.contains("colorDescription"));
    assert!(messages[0].content.contains("iconStyle"));
    assert!(messages[0].content.contains("colors"));
    assert!(messages[0].content.contains(r#""id":"style-4""#));
    assert!(!messages[0].content.contains("palettes"));
    assert_eq!(messages[1].role, "user");
    assert!(messages[1]
        .content
        .contains("请根据以下信息生成爆款风格分析"));
}

#[test]
fn viral_style_analysis_assist_uses_platform_and_product_selling_points() {
    let workspace_dir = initialized_workspace("ai-assist-viral-style-analysis");

    let result = AiAssistService::new()
        .analyze_viral_style_with_adapter(
            &workspace_dir,
            ViralStyleAnalysisInput {
                platform: "淘宝天猫".to_string(),
                product_selling_points: "黑色翻领长袖版型，后背图案装饰，适合日常通勤。"
                    .to_string(),
            },
            &ViralStyleGatewayAdapter,
        )
        .expect("viral style analysis should run");

    assert_eq!(result.capability_id, "viral-style-analysis");
    assert_eq!(result.prompt_id, "viral-style-analysis");
    assert_eq!(result.data["items"][0]["title"], "通勤质感风");
    assert_eq!(result.data["items"][0]["colors"][0], "#111827");
    assert_eq!(
        result.data["items"][0]["globalStyleNote"],
        "柔和侧光，均匀漫射，低饱和氛围，细腻呈现面料肌理"
    );
    assert_eq!(
        result.data["items"][0]["fontStyleDescription"],
        "常规字重无衬线体，规整端正，沉稳商务感"
    );
    assert_eq!(
        result.data["items"][0]["colorDescription"],
        "深藏青（产品固有原色），浅米灰（大面积背景），雾霾蓝（卖点强调）"
    );
    assert_eq!(result.data["items"][0]["iconStyle"], "细线性简约商务风格");
    assert!(result.data["items"][0].get("palettes").is_none());

    remove_workspace(&workspace_dir);
}

#[test]
fn viral_style_analysis_assist_rejects_styles_without_generation_guidance() {
    let workspace_dir = initialized_workspace("ai-assist-viral-style-analysis-missing-guidance");

    let result = AiAssistService::new().analyze_viral_style_with_adapter(
        &workspace_dir,
        ViralStyleAnalysisInput {
            platform: "淘宝天猫".to_string(),
            product_selling_points: "黑色翻领长袖版型，后背图案装饰，适合日常通勤。".to_string(),
        },
        &MinimalViralStyleGatewayAdapter,
    );

    assert!(result
        .expect_err("missing generation guidance fields should be rejected")
        .to_string()
        .contains("爆款风格分析返回结构缺少生图指导字段"));

    remove_workspace(&workspace_dir);
}

#[test]
fn product_selling_points_assist_uses_uploaded_image_and_builtin_prompt() {
    let workspace_dir = initialized_workspace("ai-assist-product-selling-points");
    let image_path = workspace_dir.join("source.png");
    fs::write(&image_path, tiny_png()).expect("fixture should write");

    let result = AiAssistService::new()
        .generate_product_selling_points_with_adapter(
            &workspace_dir,
            ProductSellingPointsInput {
                image_paths: vec![image_path.to_string_lossy().to_string()],
                images: Vec::new(),
            },
            &SuccessfulGatewayAdapter,
        )
        .expect("assist should run");

    assert!(result.text.contains("1、产品名称："));
    assert!(result.text.contains("2、核心卖点："));
    assert_eq!(result.prompt_id, "product-selling-points");
    assert_eq!(result.capability_id, "product-selling-points");

    remove_workspace(&workspace_dir);
}

#[test]
fn product_selling_points_assist_rejects_mock_local_default_instead_of_fake_output() {
    let workspace_dir = initialized_workspace("ai-assist-rejects-mock-local");
    let image_path = workspace_dir.join("source.png");
    fs::write(&image_path, tiny_png()).expect("fixture should write");

    let result = AiAssistService::new().generate_product_selling_points(
        &workspace_dir,
        ProductSellingPointsInput {
            image_paths: vec![image_path.to_string_lossy().to_string()],
            images: Vec::new(),
        },
    );

    assert!(result
        .expect_err("mock-local must not be shown as real AI writing")
        .to_string()
        .contains("没有可用模型"));

    remove_workspace(&workspace_dir);
}

#[test]
fn product_selling_points_assist_rejects_unsupported_image_format_before_model_call() {
    let workspace_dir = initialized_workspace("ai-assist-unsupported-image");
    let image_path = workspace_dir.join("source.gif");
    fs::write(&image_path, b"GIF89a").expect("fixture should write");

    let result = AiAssistService::new().generate_product_selling_points(
        &workspace_dir,
        ProductSellingPointsInput {
            image_paths: vec![image_path.to_string_lossy().to_string()],
            images: Vec::new(),
        },
    );

    assert!(result
        .expect_err("gif should be rejected until webp conversion dependency is approved")
        .to_string()
        .contains("暂不支持的图片格式"));

    remove_workspace(&workspace_dir);
}

#[test]
fn product_selling_points_assist_accepts_browser_converted_webp_data_url() {
    let workspace_dir = initialized_workspace("ai-assist-browser-webp-data-url");

    let result = AiAssistService::new()
        .generate_product_selling_points_with_adapter(
            &workspace_dir,
            ProductSellingPointsInput {
                image_paths: Vec::new(),
                images: vec![ProductSellingPointsImageInput {
                    original_name: Some("source.webp".to_string()),
                    mime_type: Some("image/webp".to_string()),
                    data_url: Some("data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=".to_string()),
                    path: None,
                }],
            },
            &WebpGatewayAdapter,
        )
        .expect("browser-converted webp data URL should run");

    assert!(result.text.contains("1、产品名称："));

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

fn tiny_png() -> &'static [u8] {
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xdac\xfc\xff\x1f\x00\x03\x03\x02\x00\xef\xbf\xa7\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
}

struct SuccessfulGatewayAdapter;

impl ModelGatewayAdapter for SuccessfulGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        assert_eq!(request.capability_id, "product-selling-points");
        assert_eq!(request.input["prompt"]["messages"][0]["role"], "system");
        assert_eq!(request.input["prompt"]["messages"][1]["role"], "user");
        assert!(request.input["userImages"][0]["dataUrl"]
            .as_str()
            .unwrap_or_default()
            .starts_with("data:image/png;base64,"));

        Ok(ModelGatewayAdapterResult {
            output_text: Some("1、产品名称：测试商品\n2、核心卖点：需补充".to_string()),
            output_json: serde_json::json!({ "test": true }),
            usage_json: None,
        })
    }
}

struct WebpGatewayAdapter;

impl ModelGatewayAdapter for WebpGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        assert_eq!(
            request.input["userImages"][0]["originalName"],
            "source.webp"
        );
        assert_eq!(request.input["userImages"][0]["mimeType"], "image/webp");
        assert!(request.input["userImages"][0]["dataUrl"]
            .as_str()
            .unwrap_or_default()
            .starts_with("data:image/webp;base64,"));

        Ok(ModelGatewayAdapterResult {
            output_text: Some("1、产品名称：WebP 商品".to_string()),
            output_json: serde_json::json!({ "test": true }),
            usage_json: None,
        })
    }
}

struct ViralStyleGatewayAdapter;

impl ModelGatewayAdapter for ViralStyleGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        assert_eq!(request.capability_id, "viral-style-analysis");
        assert_eq!(request.input["prompt"]["messages"][0]["role"], "system");
        assert_eq!(request.input["prompt"]["messages"][1]["role"], "user");
        assert_eq!(request.input["context"]["platform"], "淘宝天猫");
        assert!(request.input["context"]["productSellingPoints"]
            .as_str()
            .unwrap_or_default()
            .contains("黑色翻领长袖版型"));
        assert!(request.input.get("userImages").is_none());

        Ok(ModelGatewayAdapterResult {
            output_text: Some(
                serde_json::json!({
                    "platform": "淘宝天猫",
                    "items": [
                        {
                            "id": "style-1",
                            "title": "通勤质感风",
                            "subtitle": "突出黑色翻领衬衫的简洁通勤气质，适合天猫详情页表达。",
                            "reasoning": "适配上班族日常穿搭需求。",
                            "designFocus": "突出服装版型、面料质感和通勤搭配场景。",
                            "globalStyleNote": "柔和侧光，均匀漫射，低饱和氛围，细腻呈现面料肌理",
                            "fontStyleDescription": "常规字重无衬线体，规整端正，沉稳商务感",
                            "colors": ["#111827", "#F8FAFC"],
                            "colorDescription": "深藏青（产品固有原色），浅米灰（大面积背景），雾霾蓝（卖点强调）",
                            "iconStyle": "细线性简约商务风格"
                        },
                        {
                            "id": "style-2",
                            "title": "街头潮酷风",
                            "subtitle": "放大后背图案装饰记忆点，适合年轻人群点击。",
                            "reasoning": "适配年轻用户社媒种草场景。",
                            "designFocus": "突出后背图案和街头穿搭氛围。",
                            "globalStyleNote": "硬朗侧逆光，高对比暗调背景，突出轮廓和视觉冲击",
                            "fontStyleDescription": "稍粗无衬线体，利落紧凑，街头潮流感",
                            "colors": ["#0F172A", "#EF4444"],
                            "colorDescription": "深黑蓝（主体压暗），亮红色（视觉强调）",
                            "iconStyle": "粗线条街头图形风格"
                        },
                        {
                            "id": "style-3",
                            "title": "简约百搭风",
                            "subtitle": "强化黑色单品的搭配效率，适合详情页快速理解。",
                            "reasoning": "适配极简穿搭人群审美。",
                            "designFocus": "突出多场景搭配和基础款价值。",
                            "globalStyleNote": "柔化顶侧光，低对比度光影，克制高级，干净沉静氛围",
                            "fontStyleDescription": "中等字重无衬线体，间距宽松，简约高级感",
                            "colors": ["#111111", "#FFFFFF"],
                            "colorDescription": "黑色（产品固有色），白色（大面积背景）",
                            "iconStyle": "极细线性极简风格"
                        },
                        {
                            "id": "style-4",
                            "title": "细节品质风",
                            "subtitle": "用细节图与质感表达承接核心卖点，增强购买信任。",
                            "reasoning": "适配细节品质和购买信任表达。",
                            "designFocus": "突出领型、走线、面料纹理和局部细节。",
                            "globalStyleNote": "微距柔光，局部高光控制，突出纹理、结构和工艺细节",
                            "fontStyleDescription": "常规字重无衬线体，规整清晰，专业说明感",
                            "colors": ["#27272A", "#F4F4F5", "#71717A"],
                            "colorDescription": "炭黑色（主体细节），浅灰白（背景），中性灰（信息强调）",
                            "iconStyle": "细线性参数说明风格"
                        }
                    ]
                })
                .to_string(),
            ),
            output_json: serde_json::json!({ "type": "text" }),
            usage_json: None,
        })
    }
}

struct MinimalViralStyleGatewayAdapter;

impl ModelGatewayAdapter for MinimalViralStyleGatewayAdapter {
    fn invoke(
        &self,
        _request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        Ok(ModelGatewayAdapterResult {
            output_text: Some(
                serde_json::json!({
                    "platform": "淘宝天猫",
                    "items": [
                        {"id": "style-1", "title": "通勤质感风", "subtitle": "通勤质感心智", "designFocus": "突出版型。", "colors": ["#111827", "#F8FAFC"]},
                        {"id": "style-2", "title": "街头潮酷风", "subtitle": "街头点击记忆", "designFocus": "突出图案。", "colors": ["#0F172A", "#EF4444"]},
                        {"id": "style-3", "title": "简约百搭风", "subtitle": "简约百搭卖点", "designFocus": "突出搭配。", "colors": ["#111111", "#FFFFFF"]},
                        {"id": "style-4", "title": "细节品质风", "subtitle": "细节品质信任", "designFocus": "突出细节。", "colors": ["#27272A", "#F4F4F5", "#71717A"]}
                    ]
                })
                .to_string(),
            ),
            output_json: serde_json::json!({ "type": "text" }),
            usage_json: None,
        })
    }
}
