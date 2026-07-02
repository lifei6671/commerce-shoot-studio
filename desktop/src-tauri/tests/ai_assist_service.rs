use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::ai_assist::{
    AiAssistService, ProductSellingPointsImageInput, ProductSellingPointsInput,
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
    assert!(messages[0].content.contains("不要编造品牌、型号、价格"));
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
