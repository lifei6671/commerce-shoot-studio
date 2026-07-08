use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::domain::generation::WorkspaceKind;
use crate::services::model_config::{default_config_for_capability, ModelConfigError};
use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayRequest, ModelGatewayResult, ModelGatewayService,
};
use crate::services::prompt_registry::{
    get_prompt_template, render_prompt_for_roles, render_roleless_prompt, PromptRegistryError,
    PromptTemplateId,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePromptPlanInput {
    pub workspace: WorkspaceKind,
    pub intent: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePromptPlanInput {
    pub plan_id: String,
    pub user_editable_summary: Option<String>,
    #[serde(default)]
    pub items: Vec<PromptPlanUpdateItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPlanUpdateItem {
    pub id: String,
    pub display_summary: String,
    pub intent: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPlan {
    pub id: String,
    pub workspace: WorkspaceKind,
    pub status: String,
    pub user_editable_summary: Option<String>,
    pub resolver_version: String,
    pub template_version: String,
    pub items: Vec<PromptPlanItem>,
    pub created_at: String,
    pub updated_at: String,
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPlanItem {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub display_summary: String,
    pub intent: Value,
    pub editable: bool,
    pub required: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PromptPlanService;

impl PromptPlanService {
    pub fn new() -> Self {
        Self
    }

    pub fn create_plan(
        &self,
        workspace_directory: &Path,
        input: CreatePromptPlanInput,
    ) -> Result<PromptPlan, PromptPlanError> {
        self.create_plan_with_gateway(
            workspace_directory,
            input,
            |workspace_directory, request| {
                let config =
                    default_config_for_capability(workspace_directory, &request.capability_id)?;
                if config.provider_profile_id == "mock-local" {
                    ModelGatewayService::new().invoke(workspace_directory, request)
                } else {
                    ModelGatewayService::new().invoke_real_provider(workspace_directory, request)
                }
            },
        )
    }

    pub fn create_plan_with_adapter<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        input: CreatePromptPlanInput,
        adapter: &T,
    ) -> Result<PromptPlan, PromptPlanError> {
        self.create_plan_with_gateway(
            workspace_directory,
            input,
            |workspace_directory, request| {
                ModelGatewayService::new().invoke_with_adapter(
                    workspace_directory,
                    request,
                    adapter,
                )
            },
        )
    }

    fn create_plan_with_gateway<F>(
        &self,
        workspace_directory: &Path,
        input: CreatePromptPlanInput,
        invoke_gateway: F,
    ) -> Result<PromptPlan, PromptPlanError>
    where
        F: FnOnce(&Path, ModelGatewayRequest) -> Result<ModelGatewayResult, ModelConfigError>,
    {
        if input.workspace != WorkspaceKind::Product {
            return Err(PromptPlanError::Validation(
                "当前 prompt plan 仅支持商品详情页。".to_string(),
            ));
        }

        let request_context = build_product_detail_scene_request(&input.intent)?;
        let gateway_result = invoke_gateway(workspace_directory, request_context.gateway_request)?;
        let output_text = gateway_result.output_text.unwrap_or_default();
        let source = if output_text.trim().is_empty() {
            gateway_result.output_json.to_string()
        } else {
            output_text
        };
        parse_product_detail_scene_plan(input.workspace, &source, &request_context.prompt_version)
    }
}

struct PromptPlanRequestContext {
    gateway_request: ModelGatewayRequest,
    prompt_version: String,
}

fn build_product_detail_scene_request(
    intent: &Value,
) -> Result<PromptPlanRequestContext, PromptPlanError> {
    let platform = required_string(intent, "platform", "场景描述生成缺少目标平台。")?;
    let language = required_string(intent, "language", "场景描述生成缺少目标语言。")?;
    let ratio = required_string(intent, "ratio", "场景描述生成缺少画面比例。")?;
    let product_selling_points =
        required_string(intent, "productSellingPoints", "请先补充商品卖点。")?;
    let modules = required_array(intent, "modules", "请先选择商品模块。")?;
    let viral_styles = intent
        .get("viralStyles")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let template = get_prompt_template(PromptTemplateId::ProductDetailScenePrompt)?;
    let modules_value = Value::Array(modules);
    let viral_styles_value = Value::Array(viral_styles);
    let prompt_messages = render_product_detail_scene_prompt_messages(
        platform,
        language,
        ratio,
        product_selling_points,
        &modules_value,
        &viral_styles_value,
    )?;
    let roleless_prompt = render_product_detail_scene_roleless_prompt(
        platform,
        language,
        ratio,
        product_selling_points,
        &modules_value,
        &viral_styles_value,
    )?;

    Ok(PromptPlanRequestContext {
        prompt_version: template.version.to_string(),
        gateway_request: ModelGatewayRequest {
            capability_id: template.capability_id.to_string(),
            input: json!({
                "maxOutputTokens": 12000,
                "prompt": {
                    "id": template.id,
                    "version": template.version,
                    "messages": prompt_messages
                        .iter()
                        .map(|message| json!({
                            "role": message.role,
                            "content": message.content,
                        }))
                        .collect::<Vec<_>>(),
                    "rolelessPrompt": roleless_prompt,
                },
                "context": intent,
            }),
        },
    })
}

fn render_product_detail_scene_prompt_messages(
    platform: &str,
    language: &str,
    ratio: &str,
    product_selling_points: &str,
    modules: &Value,
    viral_styles: &Value,
) -> Result<Vec<crate::services::prompt_registry::PromptMessage>, PromptPlanError> {
    let mut messages = render_prompt_for_roles(PromptTemplateId::ProductDetailScenePrompt)?;
    for message in &mut messages {
        message.content = render_product_detail_scene_variables(
            &message.content,
            platform,
            language,
            ratio,
            product_selling_points,
            modules,
            viral_styles,
        )?;
    }
    Ok(messages)
}

fn render_product_detail_scene_roleless_prompt(
    platform: &str,
    language: &str,
    ratio: &str,
    product_selling_points: &str,
    modules: &Value,
    viral_styles: &Value,
) -> Result<String, PromptPlanError> {
    render_product_detail_scene_variables(
        &render_roleless_prompt(PromptTemplateId::ProductDetailScenePrompt)?,
        platform,
        language,
        ratio,
        product_selling_points,
        modules,
        viral_styles,
    )
}

fn render_product_detail_scene_variables(
    content: &str,
    platform: &str,
    language: &str,
    ratio: &str,
    product_selling_points: &str,
    modules: &Value,
    viral_styles: &Value,
) -> Result<String, PromptPlanError> {
    let modules_json = serde_json::to_string(modules)
        .map_err(|error| PromptPlanError::Validation(format!("模块信息序列化失败：{error}")))?;
    let viral_styles_json = serde_json::to_string(viral_styles)
        .map_err(|error| PromptPlanError::Validation(format!("风格信息序列化失败：{error}")))?;

    Ok(content
        .replace("{{platform}}", platform)
        .replace("{{language}}", language)
        .replace("{{ratio}}", ratio)
        .replace("{{productSellingPoints}}", product_selling_points)
        .replace("{{modulesJson}}", &modules_json)
        .replace("{{viralStylesJson}}", &viral_styles_json))
}

fn parse_product_detail_scene_plan(
    workspace: WorkspaceKind,
    output_text: &str,
    template_version: &str,
) -> Result<PromptPlan, PromptPlanError> {
    let data: Value = serde_json::from_str(output_text.trim()).map_err(|_| {
        eprintln!(
            "[prompt-plan-diagnostics] {}",
            prompt_plan_parse_failure_diagnostic(output_text)
        );
        PromptPlanError::Validation("场景描述生成返回的 JSON 无法解析。".to_string())
    })?;
    if data.get("version").and_then(Value::as_str) != Some("v1") {
        return Err(PromptPlanError::Validation(
            "场景描述生成返回结构缺少 version=v1。".to_string(),
        ));
    }
    let product_summary = required_string(
        &data,
        "productSummary",
        "场景描述生成返回结构缺少 productSummary。",
    )?;
    let groups = data
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            PromptPlanError::Validation("场景描述生成返回结构缺少 groups。".to_string())
        })?;
    if groups.is_empty() {
        return Err(PromptPlanError::Validation(
            "场景描述生成至少需要返回一个风格分组。".to_string(),
        ));
    }

    let now = current_timestamp();
    let mut items = Vec::new();
    for group in groups {
        let style_id = required_string(group, "styleId", "场景描述生成返回结构缺少 styleId。")?;
        let style_title =
            required_string(group, "styleTitle", "场景描述生成返回结构缺少 styleTitle。")?;
        let colors = group
            .get("colors")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()));
        let visual_consistency = group
            .get("visualConsistency")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let group_items = group
            .get("items")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PromptPlanError::Validation("场景描述生成返回结构缺少 items。".to_string())
            })?;
        if group_items.is_empty() {
            return Err(PromptPlanError::Validation(
                "每个风格分组至少需要返回一个模块。".to_string(),
            ));
        }

        for item in group_items {
            let module_id =
                required_string(item, "moduleId", "场景描述生成返回结构缺少 moduleId。")?;
            let module_title = required_string(
                item,
                "moduleTitle",
                "场景描述生成返回结构缺少 moduleTitle。",
            )?;
            let scene_description = required_string(
                item,
                "sceneDescription",
                "场景描述生成返回结构缺少 sceneDescription。",
            )?;
            let image_prompt = required_string(
                item,
                "imagePrompt",
                "场景描述生成返回结构缺少 imagePrompt。",
            )?;
            let scene_title = item
                .get("sceneTitle")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(module_title);
            let plan_item_id = format!("{style_id}-{module_id}");

            items.push(PromptPlanItem {
                id: plan_item_id,
                r#type: "scene".to_string(),
                title: format!("{style_title} · {module_title}"),
                display_summary: scene_description.to_string(),
                intent: json!({
                    "styleId": style_id,
                    "styleTitle": style_title,
                    "colors": colors,
                    "visualConsistency": visual_consistency,
                    "moduleId": module_id,
                    "moduleTitle": module_title,
                    "sceneTitle": scene_title,
                    "sceneDescription": scene_description,
                    "imagePrompt": image_prompt,
                    "textOverlay": item.get("textOverlay").cloned().unwrap_or_else(|| json!({})),
                    "constraints": item.get("constraints").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
                }),
                editable: true,
                required: true,
                sort_order: items.len() as i64,
                created_at: now.clone(),
                updated_at: now.clone(),
            });
        }
    }

    Ok(PromptPlan {
        id: create_prompt_plan_id(),
        workspace,
        status: "draft".to_string(),
        user_editable_summary: Some(product_summary.to_string()),
        resolver_version: "product-detail-scene-description-v1".to_string(),
        template_version: template_version.to_string(),
        items,
        created_at: now.clone(),
        updated_at: now,
        confirmed_at: None,
    })
}

fn required_string<'a>(
    value: &'a Value,
    field: &str,
    message: &str,
) -> Result<&'a str, PromptPlanError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PromptPlanError::Validation(message.to_string()))
}

fn required_array(
    value: &Value,
    field: &str,
    message: &str,
) -> Result<Vec<Value>, PromptPlanError> {
    let items = value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| PromptPlanError::Validation(message.to_string()))?;
    if items.is_empty() {
        return Err(PromptPlanError::Validation(message.to_string()));
    }
    Ok(items.clone())
}

fn create_prompt_plan_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("prompt_plan_{nanos}")
}

fn current_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("unix-ms-{millis}")
}

fn prompt_plan_parse_failure_diagnostic(output_text: &str) -> Value {
    json!({
        "event": "product_detail_scene_json_parse_failed",
        "outputTextCharCount": output_text.chars().count(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptPlanError {
    Validation(String),
    Model(String),
    Prompt(String),
}

impl std::fmt::Display for PromptPlanError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(message) | Self::Model(message) | Self::Prompt(message) => {
                write!(formatter, "{message}")
            }
        }
    }
}

impl std::error::Error for PromptPlanError {}

#[cfg(test)]
mod tests {
    use super::prompt_plan_parse_failure_diagnostic;

    #[test]
    fn parse_failure_diagnostic_does_not_include_raw_model_output() {
        let raw_output = "包含商品卖点和 raw prompt 的非 JSON 返回";
        let diagnostic = prompt_plan_parse_failure_diagnostic(raw_output);
        let serialized = diagnostic.to_string();

        assert!(serialized.contains("outputTextCharCount"));
        assert!(!serialized.contains(raw_output));
        assert!(!serialized.contains("raw prompt"));
    }
}

impl From<ModelConfigError> for PromptPlanError {
    fn from(source: ModelConfigError) -> Self {
        Self::Model(source.to_string())
    }
}

impl From<PromptRegistryError> for PromptPlanError {
    fn from(source: PromptRegistryError) -> Self {
        Self::Prompt(source.to_string())
    }
}
