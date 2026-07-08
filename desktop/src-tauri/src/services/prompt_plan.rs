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
        parse_product_detail_scene_plan(
            input.workspace,
            &source,
            &request_context.prompt_version,
            &request_context.target_language,
        )
    }
}

struct PromptPlanRequestContext {
    gateway_request: ModelGatewayRequest,
    prompt_version: String,
    target_language: String,
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
        target_language: language.to_string(),
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
    let selected_scene_modules = selected_scene_module_configs(
        get_prompt_template(PromptTemplateId::ProductDetailScenePrompt)?.scene_modules,
        modules,
    )?;

    Ok(content
        .replace("{{platform}}", platform)
        .replace("{{language}}", language)
        .replace("{{ratio}}", ratio)
        .replace("{{productSellingPoints}}", product_selling_points)
        .replace("{{modulesJson}}", &modules_json)
        .replace("{{selectedSceneModules}}", &selected_scene_modules)
        .replace("{{viralStylesJson}}", &viral_styles_json)
        .replace("{target_platform}", platform)
        .replace("{target_language}", language))
}

fn selected_scene_module_configs(
    scene_modules: &'static str,
    modules: &Value,
) -> Result<String, PromptPlanError> {
    let modules = modules
        .as_array()
        .ok_or_else(|| PromptPlanError::Validation("模块信息结构无效。".to_string()))?;
    let mut selected = Vec::new();
    for (index, module) in modules.iter().enumerate() {
        let config_id = scene_module_config_id(module).ok_or_else(|| {
            PromptPlanError::Validation("存在无法匹配配置的详情页模块。".to_string())
        })?;
        let section = find_scene_module_config(scene_modules, config_id).ok_or_else(|| {
            PromptPlanError::Validation(format!("详情页模块 `{config_id}` 缺少内置 prompt 配置。"))
        })?;
        selected.push(render_scene_module_execution_brief(
            section,
            module,
            index + 1,
        ));
    }
    Ok(selected.join("\n\n"))
}

fn render_scene_module_execution_brief(section: &str, module: &Value, index: usize) -> String {
    let module_id = module
        .get("moduleId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let module_title = module
        .get("moduleTitle")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let user_description = module
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let config_id =
        extract_scene_module_field(section, "id").unwrap_or_else(|| module_id.to_string());
    let config_name =
        extract_scene_module_field(section, "name").unwrap_or_else(|| module_title.to_string());
    let ui_subtitle = extract_scene_module_field(section, "ui_subtitle").unwrap_or_default();
    let image_type_rule =
        extract_scene_module_field(section, "image_type_rule").unwrap_or_default();
    let core_goal = extract_scene_module_field(section, "core_goal").unwrap_or_default();
    let callout_strategy =
        extract_scene_module_field(section, "callout_strategy").unwrap_or_default();
    let required_info = extract_scene_module_field(section, "required_info").unwrap_or_default();
    let missing_info_policy =
        extract_scene_module_field(section, "missing_info_policy").unwrap_or_default();
    let image_prompt_template =
        extract_scene_module_field(section, "image_prompt_template").unwrap_or_default();
    let copy_requirements_template =
        extract_scene_module_field(section, "copy_requirements_template").unwrap_or_default();
    let placeholder_examples = extract_copy_requirement_placeholders(&copy_requirements_template);
    let placeholder_line = if placeholder_examples.is_empty() {
        "禁止原样返回模板中的说明性占位句；所有引号内文案都必须结合商品卖点、模块目标和目标语言重新生成。".to_string()
    } else {
        format!(
            "禁止原样返回模板占位句，例如：{}。这些句子只说明生成方向，不是最终文案。",
            placeholder_examples.join("、")
        )
    };

    [
        format!("模块 {index} 执行指令"),
        format!("模块配置 id：{config_id}"),
        format!("输入 moduleId：{module_id}"),
        format!("模块名称：{}", first_non_empty(&config_name, module_title)),
        optional_brief_line("用户选择描述", user_description),
        optional_brief_line("UI 副标题", &ui_subtitle),
        optional_brief_line("core_goal", &core_goal),
        optional_brief_line("必要事实", &required_info),
        optional_brief_line("缺失信息处理", &missing_info_policy),
        "image_type 生成指令：".to_string(),
        format!(
            "- 必须遵守规则：{}",
            first_non_empty(
                &image_type_rule,
                "格式为：模块名称: 基于商品卖点提炼的具体核心观点。"
            )
        ),
        "- 冒号后的核心观点必须从商品卖点中提炼具体、可转化的核心观点，并服务 core_goal；不得输出“核心价值”“差异优势”“品质升级”“卖点展示”等泛词。".to_string(),
        "- 如果 core_goal 与 ui_subtitle 不一致，以 core_goal 为准；ui_subtitle 只用于理解 UI 模块，不是可照抄标题。".to_string(),
        "image_prompt 生成指令：".to_string(),
        "- 必须围绕 image_type 的具体核心观点、core_goal、商品卖点、目标平台、目标语言、画面比例和爆款风格改写模板。".to_string(),
        "- 必须输出一段新的、可直接发给下一步文生图模型的完整 image_prompt；禁止原样返回 image_prompt 模板句子。".to_string(),
        "- 必须把模板中的商品主体、商品形态、第一购买理由、场景和文字区改写成当前商品的具体生图描述。".to_string(),
        "- 必须保留模板中的构图、镜头、光影、产品锁定、禁用项和文字生成规则；这些内容是约束，不是可复制答案。".to_string(),
        format!("image_prompt 参考约束（只能理解和改写，不能原样返回）：\n{}", image_prompt_template.trim()),
        "copy_requirements 生成指令：".to_string(),
        "- copy_requirements 只输出给用户可编辑、并需要进入画面的文字清单；必须保留主标题和目标语言；副标题与标注标签二选一，不能同时输出。".to_string(),
        "- 判断规则：画面如果存在明确可指向的商品局部、结构、动作点、规格、配件、SKU 或成分锚点，并且标注能提升理解，则输出标注标签并省略副标题；否则输出副标题并省略标注标签。".to_string(),
        "- 主标题和副标题的排版、字体、位置、字号、颜色和安全边距必须融合到对应字段同一行，不要单独输出“主标题排版”或“副标题排版”。".to_string(),
        "- 不要输出“结构化信息: 不使用”“标注标签: 不使用”“缺失信息: 已足够”这类空项；不要输出通用的“文字生成要求”说明。".to_string(),
        "- 必须把模板占位句改写成结合商品卖点的具体文案；主标题、副标题、结构化信息和标注标签都要服务 image_type 的核心观点。".to_string(),
        format!("- {placeholder_line}"),
        "- 如果某项信息缺失，只在“缺失信息”字段写需补充；不得在主标题、副标题、标注或 image_prompt 中编造。".to_string(),
        optional_brief_line("标注策略", &callout_strategy),
        format!(
            "copy_requirements 字段结构与排版规则：\n{}",
            copy_requirements_template.trim()
        ),
    ]
    .into_iter()
    .filter(|line| !line.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn optional_brief_line(label: &str, value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        format!("{label}：{}", value.trim())
    }
}

fn first_non_empty<'a>(primary: &'a str, fallback: &'a str) -> &'a str {
    if primary.trim().is_empty() {
        fallback
    } else {
        primary
    }
}

fn extract_scene_module_field(section: &str, key: &str) -> Option<String> {
    let assignment_prefix = format!("{key} =");
    let mut offset = 0;
    for line in section.split_inclusive('\n') {
        let trimmed_line = line.trim_start();
        if trimmed_line.starts_with(&assignment_prefix) {
            let value_start = offset
                + (line.len() - trimmed_line.len())
                + assignment_prefix.len()
                + trimmed_line[assignment_prefix.len()..].len()
                - trimmed_line[assignment_prefix.len()..].trim_start().len();
            return parse_scene_module_value(&section[value_start..]);
        }
        offset += line.len();
    }
    None
}

fn parse_scene_module_value(source: &str) -> Option<String> {
    let source = source.trim_start();
    if let Some(rest) = source.strip_prefix("'''") {
        let end = rest.find("'''")?;
        return Some(trim_multiline_scene_value(&rest[..end]).to_string());
    }
    if let Some(rest) = source.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(rest[..end].to_string());
    }
    if let Some(rest) = source.strip_prefix('[') {
        let end = rest.find(']')?;
        return Some(
            rest[..end]
                .split(',')
                .map(|item| item.trim().trim_matches('"'))
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
                .join("、"),
        );
    }
    None
}

fn trim_multiline_scene_value(value: &str) -> &str {
    let value = value
        .strip_prefix("\r\n")
        .or_else(|| value.strip_prefix('\n'))
        .unwrap_or(value);
    value
        .strip_suffix("\r\n")
        .or_else(|| value.strip_suffix('\n'))
        .unwrap_or(value)
}

fn extract_copy_requirement_placeholders(template: &str) -> Vec<String> {
    template
        .lines()
        .filter_map(|line| {
            let (_, value) = line.split_once(':')?;
            let value = value.trim();
            let quoted = value.strip_prefix('"')?;
            let end = quoted.find('"')?;
            let placeholder = quoted[..end].trim();
            if placeholder.is_empty() {
                None
            } else {
                Some(format!("“{placeholder}”"))
            }
        })
        .take(4)
        .collect()
}

fn scene_module_config_id(module: &Value) -> Option<&'static str> {
    let module_id = module.get("moduleId").and_then(Value::as_str).unwrap_or("");
    let module_title = module
        .get("moduleTitle")
        .and_then(Value::as_str)
        .unwrap_or("");
    match module_id {
        "hero" | "hero_visual" => Some("hero_visual"),
        "selling-point" | "core_selling_point" => Some("core_selling_point"),
        "scenario" | "usage_scene" => Some("usage_scene"),
        "angle" | "multi_angle" => Some("multi_angle"),
        "atmosphere" | "atmosphere_scene" => Some("atmosphere_scene"),
        "detail" | "product_detail" => Some("product_detail"),
        "brand_story" => Some("brand_story"),
        "size_capacity_size_chart" => Some("size_capacity_size_chart"),
        "effect_comparison" => Some("effect_comparison"),
        "spec_parameter_table" => Some("spec_parameter_table"),
        "craft_process" => Some("craft_process"),
        "accessories_gifts" => Some("accessories_gifts"),
        "series_showcase" => Some("series_showcase"),
        "ingredient_composition" => Some("ingredient_composition"),
        _ => match module_title {
            "首屏主视觉" => Some("hero_visual"),
            "核心卖点图" => Some("core_selling_point"),
            "使用场景图" => Some("usage_scene"),
            "多角度图" => Some("multi_angle"),
            "场景氛围图" => Some("atmosphere_scene"),
            "商品细节图" => Some("product_detail"),
            "品牌故事图" => Some("brand_story"),
            "尺寸/容量/尺码图" => Some("size_capacity_size_chart"),
            "效果对比图" => Some("effect_comparison"),
            "详细规格/参数表" => Some("spec_parameter_table"),
            "工艺制作图" => Some("craft_process"),
            "配件/赠品图" => Some("accessories_gifts"),
            "系列展示图" => Some("series_showcase"),
            "商品成分图" => Some("ingredient_composition"),
            _ => None,
        },
    }
}

fn find_scene_module_config<'a>(scene_modules: &'a str, config_id: &str) -> Option<&'a str> {
    let id_marker = format!("id = \"{config_id}\"");
    let id_position = scene_modules.find(&id_marker)?;
    let start = scene_modules[..id_position]
        .rfind("[[scene_modules]]")
        .unwrap_or(0);
    let end = scene_modules[id_position..]
        .find("\n[[scene_modules]]")
        .map(|offset| id_position + offset)
        .unwrap_or(scene_modules.len());
    Some(&scene_modules[start..end])
}

fn parse_product_detail_scene_plan(
    workspace: WorkspaceKind,
    output_text: &str,
    template_version: &str,
    target_language: &str,
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
    let mut design_specs: Vec<String> = Vec::new();
    for group in groups {
        let style_id = required_string(group, "styleId", "场景描述生成返回结构缺少 styleId。")?;
        let style_title =
            required_string(group, "styleTitle", "场景描述生成返回结构缺少 styleTitle。")?;
        let colors = group
            .get("colors")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()));
        let group_design_spec = optional_string(group, "design_spec")
            .or_else(|| optional_string(group, "designSpec"))
            .ok_or_else(|| {
                PromptPlanError::Validation("场景描述生成返回结构缺少 design_spec。".to_string())
            })?;
        reject_unresolved_template_variables("design_spec", group_design_spec)?;
        if !design_specs.iter().any(|value| value == group_design_spec) {
            design_specs.push(group_design_spec.to_string());
        }
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
            let image_type = optional_string(item, "image_type")
                .or_else(|| optional_string(item, "imageType"))
                .unwrap_or(module_title);
            reject_generic_image_type(image_type)?;
            let scene_title = optional_string(item, "sceneTitle")
                .or_else(|| image_type.split_once(':').map(|(_, title)| title.trim()))
                .ok_or_else(|| {
                    PromptPlanError::Validation(
                        "场景描述生成返回结构缺少 sceneTitle 主标题。".to_string(),
                    )
                })?;
            if scene_title.trim().is_empty() {
                return Err(PromptPlanError::Validation(
                    "场景描述生成返回结构缺少 sceneTitle 主标题。".to_string(),
                ));
            }
            let image_prompt = optional_string(item, "image_prompt")
                .or_else(|| optional_string(item, "imagePrompt"))
                .ok_or_else(|| {
                    PromptPlanError::Validation(
                        "场景描述生成返回结构缺少 image_prompt。".to_string(),
                    )
                })?;
            let raw_copy_requirements = optional_string(item, "copy_requirements")
                .or_else(|| optional_string(item, "copyRequirements"))
                .or_else(|| optional_string(item, "sceneDescription"))
                .ok_or_else(|| {
                    PromptPlanError::Validation(
                        "场景描述生成返回结构缺少 copy_requirements。".to_string(),
                    )
                })?;
            let copy_requirements = normalize_copy_requirements(raw_copy_requirements);
            let design_spec = optional_string(item, "design_spec")
                .or_else(|| optional_string(item, "designSpec"))
                .unwrap_or(group_design_spec);
            reject_unresolved_template_variables("image_prompt", image_prompt)?;
            reject_unresolved_template_variables("copy_requirements", &copy_requirements)?;
            reject_unresolved_template_variables("design_spec", design_spec)?;
            let text_overlay = normalize_text_overlay(item.get("textOverlay"), scene_title);
            let plan_item_id = format!("{style_id}-{module_id}");
            let item_index = item
                .get("index")
                .and_then(Value::as_i64)
                .unwrap_or_else(|| items.len() as i64 + 1);

            items.push(PromptPlanItem {
                id: plan_item_id,
                r#type: "scene".to_string(),
                title: format!("{style_title} · {module_title}"),
                display_summary: copy_requirements.clone(),
                intent: json!({
                    "index": item_index,
                    "styleId": style_id,
                    "styleTitle": style_title,
                    "colors": colors,
                    "visualConsistency": visual_consistency,
                    "moduleId": module_id,
                    "moduleTitle": module_title,
                    "designSpec": design_spec,
                    "imageType": image_type,
                    "targetLanguage": target_language,
                    "sceneTitle": scene_title,
                    "sceneDescription": copy_requirements,
                    "imagePrompt": image_prompt,
                    "copyRequirements": copy_requirements,
                    "textOverlay": text_overlay,
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
        user_editable_summary: Some(if design_specs.is_empty() {
            product_summary.to_string()
        } else {
            design_specs.join("\n\n")
        }),
        resolver_version: "product-detail-scene-description-v1".to_string(),
        template_version: template_version.to_string(),
        items,
        created_at: now.clone(),
        updated_at: now,
        confirmed_at: None,
    })
}

fn optional_string<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn normalize_text_overlay(text_overlay: Option<&Value>, scene_title: &str) -> Value {
    let mut object = text_overlay
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let headline_is_empty = object
        .get("headline")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none();
    if headline_is_empty {
        object.insert(
            "headline".to_string(),
            Value::String(scene_title.to_string()),
        );
    }
    Value::Object(object)
}

fn normalize_copy_requirements(value: &str) -> String {
    let mut normalized = Vec::new();
    let mut main_title: Option<String> = None;
    let mut main_title_layout: Option<String> = None;
    let mut subtitle: Option<String> = None;
    let mut subtitle_layout: Option<String> = None;
    let mut has_label = false;

    for line in value.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(content) = line.strip_prefix("主标题排版:") {
            main_title_layout = Some(content.trim().trim_end_matches('。').to_string());
            continue;
        }
        if let Some(content) = line.strip_prefix("副标题排版:") {
            subtitle_layout = Some(content.trim().trim_end_matches('。').to_string());
            continue;
        }
        if let Some(content) = line.strip_prefix("主标题:") {
            main_title = Some(content.trim().trim_end_matches('。').to_string());
            continue;
        }
        if let Some(content) = line.strip_prefix("副标题:") {
            subtitle = Some(content.trim().trim_end_matches('。').to_string());
            continue;
        }
        if should_drop_copy_requirement_line(line, has_label) {
            continue;
        }
        if line.starts_with("标注标签:") || line.starts_with("标注 ") {
            has_label = true;
        }
        normalized.push(line.trim_end_matches('。').to_string());
    }

    if let Some(title) = main_title.as_deref() {
        normalized.insert(
            0,
            merge_copy_text_and_layout("主标题", &title, main_title_layout.as_deref()),
        );
    }
    if !has_label {
        if let Some(subtitle) = subtitle.as_deref() {
            let insert_index = if main_title.is_some() { 1 } else { 0 };
            normalized.insert(
                insert_index,
                merge_copy_text_and_layout("副标题", &subtitle, subtitle_layout.as_deref()),
            );
        }
    }

    normalized.join("\n")
}

fn merge_copy_text_and_layout(label: &str, text: &str, layout: Option<&str>) -> String {
    match layout.map(str::trim).filter(|value| !value.is_empty()) {
        Some(layout) => format!("{label}: {text}；排版: {layout}"),
        None => format!("{label}: {text}"),
    }
}

fn should_drop_copy_requirement_line(line: &str, label_enabled: bool) -> bool {
    if line.starts_with("文字生成要求:") {
        return true;
    }
    if line.starts_with("结构化信息:") {
        return line_has_empty_copy_value(line);
    }
    if line.starts_with("标注标签:") {
        return line_has_empty_copy_value(line);
    }
    if line.starts_with("线条样式:") {
        return !label_enabled || line_has_empty_copy_value(line);
    }
    if line.starts_with("缺失信息:") {
        return line_has_empty_copy_value(line)
            || line.contains("已足够")
            || line.contains("无需补充")
            || line.contains("不缺失");
    }
    false
}

fn line_has_empty_copy_value(line: &str) -> bool {
    let value = line
        .split_once(':')
        .map(|(_, value)| value)
        .unwrap_or(line)
        .trim()
        .trim_end_matches('。');
    value.is_empty()
        || value == "不使用"
        || value == "暂不使用"
        || value == "通常不使用"
        || value == "无"
        || value == "没有"
        || value.starts_with("不使用；")
        || value.starts_with("暂不使用；")
        || value.starts_with("通常不使用；")
}

fn reject_unresolved_template_variables(field: &str, value: &str) -> Result<(), PromptPlanError> {
    if value.contains('{') || value.contains('}') {
        return Err(PromptPlanError::Validation(format!(
            "场景描述生成返回的 {field} 仍包含未填充占位符。"
        )));
    }
    Ok(())
}

fn reject_generic_image_type(image_type: &str) -> Result<(), PromptPlanError> {
    let core = image_type
        .split_once(':')
        .map(|(_, value)| value.trim())
        .unwrap_or(image_type.trim());
    let generic_terms = [
        "核心价值",
        "传递核心价值",
        "差异优势",
        "卖点展示",
        "品质升级",
        "产品亮点",
        "商品亮点",
        "核心卖点",
    ];
    if generic_terms
        .iter()
        .any(|term| core == *term || core.ends_with(term))
    {
        return Err(PromptPlanError::Validation(format!(
            "场景描述生成返回的 image_type `{image_type}` 过于泛化，必须基于商品卖点生成具体核心观点。"
        )));
    }
    Ok(())
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
    use super::{parse_product_detail_scene_plan, prompt_plan_parse_failure_diagnostic};
    use crate::domain::generation::WorkspaceKind;

    #[test]
    fn parse_failure_diagnostic_does_not_include_raw_model_output() {
        let raw_output = "包含商品卖点和 raw prompt 的非 JSON 返回";
        let diagnostic = prompt_plan_parse_failure_diagnostic(raw_output);
        let serialized = diagnostic.to_string();

        assert!(serialized.contains("outputTextCharCount"));
        assert!(!serialized.contains(raw_output));
        assert!(!serialized.contains("raw prompt"));
    }

    #[test]
    fn product_detail_scene_plan_requires_scene_title() {
        let output = serde_json::json!({
            "version": "v1",
            "productSummary": "商品摘要",
            "groups": [{
                "styleId": "style-1",
                "styleTitle": "清爽风",
                "colors": [],
                "design_spec": "产品与卖点\n产品：商品摘要。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点\n\n视觉定调\n风格：清爽电商风格\n色彩：中性色背景，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质",
                "items": [{
                    "moduleId": "hero",
                    "moduleTitle": "首屏主视觉",
                    "sceneDescription": "画面描述",
                    "imagePrompt": "生图提示词",
                    "textOverlay": {
                        "subheadline": ""
                    },
                    "constraints": []
                }]
            }]
        });

        let error = parse_product_detail_scene_plan(
            WorkspaceKind::Product,
            &output.to_string(),
            "v1",
            "简体中文",
        )
        .expect_err("missing sceneTitle should fail");

        assert!(error.to_string().contains("sceneTitle 主标题"));
    }

    #[test]
    fn product_detail_scene_plan_rejects_unresolved_template_variables() {
        let output = serde_json::json!({
            "version": "v1",
            "productSummary": "商品摘要",
            "groups": [{
                "styleId": "style-1",
                "styleTitle": "清爽风",
                "colors": [],
                "design_spec": "产品与卖点\n产品：商品摘要。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点\n\n视觉定调\n风格：清爽电商风格\n色彩：中性色背景，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质",
                "items": [{
                    "moduleId": "hero",
                    "moduleTitle": "首屏主视觉",
                    "image_type": "首屏主视觉: 传递清爽洁面体验",
                    "sceneTitle": "传递清爽洁面体验",
                    "image_prompt": "一张高清电商图，{visual_style}，商品位于画面中央。",
                    "copy_requirements": "主标题: \"核心价值\", 排版: {main_title_typography}, 画面上方, 大号\n目标语言: 中文",
                    "textOverlay": {
                        "headline": "核心价值",
                        "subheadline": ""
                    },
                    "constraints": []
                }]
            }]
        })
        .to_string();

        let error = parse_product_detail_scene_plan(WorkspaceKind::Product, &output, "v1", "中文")
            .expect_err("unresolved template variables should be rejected");

        assert!(error.to_string().contains("占位符"));
    }

    #[test]
    fn product_detail_scene_plan_rejects_generic_image_type() {
        let output = serde_json::json!({
            "version": "v1",
            "productSummary": "商品摘要",
            "groups": [{
                "styleId": "style-1",
                "styleTitle": "清爽风",
                "colors": [],
                "design_spec": "产品与卖点\n产品：商品摘要。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点\n\n视觉定调\n风格：清爽电商风格\n色彩：中性色背景，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质",
                "items": [{
                    "moduleId": "hero",
                    "moduleTitle": "首屏主视觉",
                    "image_type": "首屏主视觉: 传递核心价值",
                    "sceneTitle": "传递核心价值",
                    "image_prompt": "一张高清电商图，展示商品主体和清晰文字。",
                    "copy_requirements": "主标题: \"传递核心价值\"\n目标语言: 中文",
                    "textOverlay": {
                        "headline": "传递核心价值",
                        "subheadline": ""
                    },
                    "constraints": []
                }]
            }]
        })
        .to_string();

        let error = parse_product_detail_scene_plan(WorkspaceKind::Product, &output, "v1", "中文")
            .expect_err("generic image_type should be rejected");

        assert!(error.to_string().contains("image_type"));
        assert!(error.to_string().contains("过于泛化"));
    }

    #[test]
    fn product_detail_scene_plan_compacts_copy_requirements_for_display_and_generation() {
        let output = serde_json::json!({
            "version": "v1",
            "productSummary": "商品摘要",
            "groups": [{
                "styleId": "style-1",
                "styleTitle": "清爽风",
                "colors": [],
                "design_spec": "产品与卖点\n产品：商品摘要。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点\n\n视觉定调\n风格：清爽电商风格\n色彩：中性色背景，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质",
                "items": [{
                    "moduleId": "hero",
                    "moduleTitle": "首屏主视觉",
                    "image_type": "首屏主视觉: 传递氨基酸温和清洁",
                    "sceneTitle": "传递氨基酸温和清洁",
                    "image_prompt": "一张高清电商首屏图，展示氨基酸洁面产品和清晰标题。",
                    "copy_requirements": "主标题: \"氨基酸温和清洁\"\n主标题排版: 位置=画面下方居中；字号=画面高度的9%-12%；字体=粗体无衬线体；字重=加粗；颜色=与背景强对比；对齐=居中；安全边距=距离边缘至少8%；最大行数=1-2行。\n副标题: \"净澈清透，日常洁面新体验\"\n副标题排版: 位置=主标题正下方；字号=画面高度的3.5%-5%；字体=干净无衬线体；字重=中等；颜色=弱于主标题但清晰可读；对齐=居中；与主标题间距=主标题高度的15%-25%；最大行数=1行。\n结构化信息: 不使用。\n标注标签: 不使用。\n文字生成要求: 主标题和副标题必须作为画面内清晰可读文字生成；禁止乱码、伪文字、额外促销词、虚假参数或虚假认证。\n目标语言: 中文\n缺失信息: 核心卖点已足够。",
                    "textOverlay": {
                        "headline": "氨基酸温和清洁",
                        "subheadline": "净澈清透，日常洁面新体验"
                    },
                    "constraints": []
                }]
            }]
        })
        .to_string();

        let plan = parse_product_detail_scene_plan(WorkspaceKind::Product, &output, "v1", "中文")
            .expect("valid plan should parse");
        let copy_requirements = plan.items[0].intent["copyRequirements"]
            .as_str()
            .expect("copy requirements should be text");

        assert!(copy_requirements.contains("主标题: \"氨基酸温和清洁\"；排版: 位置=画面下方居中"));
        assert!(copy_requirements
            .contains("副标题: \"净澈清透，日常洁面新体验\"；排版: 位置=主标题正下方"));
        assert!(copy_requirements.contains("目标语言: 中文"));
        assert!(!copy_requirements.contains("结构化信息: 不使用"));
        assert!(!copy_requirements.contains("标注标签: 不使用"));
        assert!(!copy_requirements.contains("文字生成要求:"));
        assert!(!copy_requirements.contains("缺失信息: 核心卖点已足够"));
        assert_eq!(plan.items[0].display_summary, copy_requirements);
    }

    #[test]
    fn product_detail_scene_plan_uses_either_subtitle_or_labels() {
        let output = serde_json::json!({
            "version": "v1",
            "productSummary": "商品摘要",
            "groups": [{
                "styleId": "style-1",
                "styleTitle": "清爽风",
                "colors": [],
                "design_spec": "产品与卖点\n产品：商品摘要。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点\n\n视觉定调\n风格：清爽电商风格\n色彩：中性色背景，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质",
                "items": [{
                    "moduleId": "detail",
                    "moduleTitle": "商品细节图",
                    "image_type": "商品细节图: 放大泵头与瓶身质感",
                    "sceneTitle": "放大泵头与瓶身质感",
                    "image_prompt": "一张高清电商细节图，展示洁面产品泵头和瓶身质感。",
                    "copy_requirements": "主标题: \"细节看得见\"\n主标题排版: 位置=画面顶部左侧；字号=画面高度的6%-8%；字体=粗体无衬线体；字重=加粗；颜色=与背景强对比；对齐=左对齐；安全边距=距离边缘至少8%；最大行数=1行。\n副标题: \"泵头与瓶身质感清晰呈现\"\n副标题排版: 位置=主标题下方；字号=画面高度的3%-4.2%；字体=干净无衬线体；字重=常规；颜色=弱于主标题；对齐=跟随主标题；与主标题间距=主标题高度的15%-25%；最大行数=1行。\n标注标签: 使用 2 个线性标注。\n标注 1: \"按压泵头\" -> 指向: 商品泵头。\n标注 2: \"细腻瓶身\" -> 指向: 商品瓶身。\n目标语言: 中文",
                    "textOverlay": {
                        "headline": "细节看得见",
                        "subheadline": "泵头与瓶身质感清晰呈现"
                    },
                    "constraints": []
                }]
            }]
        })
        .to_string();

        let plan = parse_product_detail_scene_plan(WorkspaceKind::Product, &output, "v1", "中文")
            .expect("valid plan should parse");
        let copy_requirements = plan.items[0].intent["copyRequirements"]
            .as_str()
            .expect("copy requirements should be text");

        assert!(copy_requirements.contains("主标题: \"细节看得见\""));
        assert!(copy_requirements.contains("标注标签: 使用 2 个线性标注"));
        assert!(copy_requirements.contains("标注 1: \"按压泵头\""));
        assert!(copy_requirements.contains("标注 2: \"细腻瓶身\""));
        assert!(copy_requirements.contains("目标语言: 中文"));
        assert!(!copy_requirements.contains("副标题:"));
        assert!(!copy_requirements.contains("泵头与瓶身质感清晰呈现"));
    }

    #[test]
    fn product_detail_scene_plan_carries_target_language_and_headline() {
        let output = serde_json::json!({
            "version": "v1",
            "productSummary": "商品摘要",
            "groups": [{
                "styleId": "style-1",
                "styleTitle": "清爽风",
                "colors": [],
                "design_spec": "产品与卖点\n产品：商品摘要。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点\n\n视觉定调\n风格：清爽电商风格\n色彩：中性色背景，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质",
                "items": [{
                    "moduleId": "hero",
                    "moduleTitle": "首屏主视觉",
                    "targetLanguage": "简体中文",
                    "sceneTitle": "清爽洁面",
                    "sceneDescription": "画面描述",
                    "imagePrompt": "生图提示词",
                    "textOverlay": {
                        "subheadline": ""
                    },
                    "constraints": []
                }]
            }]
        });

        let plan = parse_product_detail_scene_plan(
            WorkspaceKind::Product,
            &output.to_string(),
            "v1",
            "简体中文",
        )
        .expect("valid plan should parse");
        let intent = &plan.items[0].intent;

        assert_eq!(
            intent
                .get("targetLanguage")
                .and_then(serde_json::Value::as_str),
            Some("简体中文")
        );
        assert_eq!(
            intent.get("sceneTitle").and_then(serde_json::Value::as_str),
            Some("清爽洁面")
        );
        assert_eq!(
            intent
                .get("textOverlay")
                .and_then(|value| value.get("headline"))
                .and_then(serde_json::Value::as_str),
            Some("清爽洁面")
        );
        assert_eq!(
            intent
                .get("textOverlay")
                .and_then(|value| value.get("subheadline"))
                .and_then(serde_json::Value::as_str),
            Some("")
        );
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
