use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptTemplateId {
    ProductSellingPoints,
    ProductDetailScenePrompt,
    ViralStyleAnalysis,
    ClothingBaseModelGeneration,
    ClothingScenePlanning,
    ClothingTryonGeneration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptMessage {
    pub role: &'static str,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptTemplate {
    pub id: &'static str,
    pub version: &'static str,
    pub capability_id: &'static str,
    pub system_rules: &'static str,
    pub module_config_rules: &'static str,
    pub scene_modules: &'static str,
    pub user_task: &'static str,
    pub negative_prompt: &'static str,
    pub output_format: &'static str,
}

const PRODUCT_SELLING_POINTS_TOML: &str = include_str!("prompts/product_selling_points.toml");
const PRODUCT_DETAIL_SCENE_PROMPT_TOML: &str =
    include_str!("prompts/product_detail_scene_prompt.toml");
const VIRAL_STYLE_ANALYSIS_TOML: &str = include_str!("prompts/viral_style_analysis.toml");
const CLOTHING_BASE_MODEL_GENERATION_TOML: &str =
    include_str!("prompts/clothing_base_model_generation.toml");
const CLOTHING_SCENE_PLANNING_TOML: &str = include_str!("prompts/clothing_scene_planning.toml");
const CLOTHING_TRYON_GENERATION_TOML: &str = include_str!("prompts/clothing_tryon_generation.toml");

static PRODUCT_SELLING_POINTS_PROMPT: OnceLock<Result<PromptTemplate, PromptRegistryError>> =
    OnceLock::new();
static PRODUCT_DETAIL_SCENE_PROMPT: OnceLock<Result<PromptTemplate, PromptRegistryError>> =
    OnceLock::new();
static VIRAL_STYLE_ANALYSIS_PROMPT: OnceLock<Result<PromptTemplate, PromptRegistryError>> =
    OnceLock::new();
static CLOTHING_BASE_MODEL_GENERATION_PROMPT: OnceLock<
    Result<PromptTemplate, PromptRegistryError>,
> = OnceLock::new();
static CLOTHING_SCENE_PLANNING_PROMPT: OnceLock<Result<PromptTemplate, PromptRegistryError>> =
    OnceLock::new();
static CLOTHING_TRYON_GENERATION_PROMPT: OnceLock<Result<PromptTemplate, PromptRegistryError>> =
    OnceLock::new();

pub fn get_prompt_template(
    id: PromptTemplateId,
) -> Result<&'static PromptTemplate, PromptRegistryError> {
    match id {
        PromptTemplateId::ProductSellingPoints => get_configured_template(
            &PRODUCT_SELLING_POINTS_PROMPT,
            "product_selling_points.toml",
            PRODUCT_SELLING_POINTS_TOML,
        ),
        PromptTemplateId::ProductDetailScenePrompt => get_configured_template(
            &PRODUCT_DETAIL_SCENE_PROMPT,
            "product_detail_scene_prompt.toml",
            PRODUCT_DETAIL_SCENE_PROMPT_TOML,
        ),
        PromptTemplateId::ViralStyleAnalysis => get_configured_template(
            &VIRAL_STYLE_ANALYSIS_PROMPT,
            "viral_style_analysis.toml",
            VIRAL_STYLE_ANALYSIS_TOML,
        ),
        PromptTemplateId::ClothingBaseModelGeneration => get_configured_template(
            &CLOTHING_BASE_MODEL_GENERATION_PROMPT,
            "clothing_base_model_generation.toml",
            CLOTHING_BASE_MODEL_GENERATION_TOML,
        ),
        PromptTemplateId::ClothingScenePlanning => get_configured_template(
            &CLOTHING_SCENE_PLANNING_PROMPT,
            "clothing_scene_planning.toml",
            CLOTHING_SCENE_PLANNING_TOML,
        ),
        PromptTemplateId::ClothingTryonGeneration => get_configured_template(
            &CLOTHING_TRYON_GENERATION_PROMPT,
            "clothing_tryon_generation.toml",
            CLOTHING_TRYON_GENERATION_TOML,
        ),
    }
}

pub fn render_prompt_for_roles(
    id: PromptTemplateId,
) -> Result<Vec<PromptMessage>, PromptRegistryError> {
    let template = get_prompt_template(id)?;
    let system_content = render_system_content(template);
    Ok(vec![
        PromptMessage {
            role: "system",
            content: system_content,
        },
        PromptMessage {
            role: "user",
            content: template.user_task.to_string(),
        },
    ])
}

pub fn render_roleless_prompt(id: PromptTemplateId) -> Result<String, PromptRegistryError> {
    let template = get_prompt_template(id)?;
    Ok(format!(
        "【应用规则】\n{}\n\n【用户任务】\n{}",
        render_system_content(template),
        template.user_task
    ))
}

fn render_system_content(template: &PromptTemplate) -> String {
    let negative_prompt = if template.negative_prompt.trim().is_empty() {
        String::new()
    } else {
        format!("【负向约束】\n{}", template.negative_prompt)
    };
    join_sections(&[
        template.system_rules,
        negative_prompt.as_str(),
        template.output_format,
    ])
}

fn get_configured_template(
    cell: &'static OnceLock<Result<PromptTemplate, PromptRegistryError>>,
    source_name: &'static str,
    source: &'static str,
) -> Result<&'static PromptTemplate, PromptRegistryError> {
    match cell.get_or_init(|| parse_prompt_config(source_name, source)) {
        Ok(template) => Ok(template),
        Err(error) => Err(error.clone()),
    }
}

fn parse_prompt_config(
    source_name: &'static str,
    source: &'static str,
) -> Result<PromptTemplate, PromptRegistryError> {
    Ok(PromptTemplate {
        id: parse_toml_string_value(source_name, source, "id")?,
        version: parse_toml_string_value(source_name, source, "version")?,
        capability_id: parse_toml_string_value(source_name, source, "capability_id")?,
        system_rules: parse_toml_string_value(source_name, source, "system_rules")?,
        module_config_rules: parse_optional_toml_string_value(source, "module_config_rules")
            .or_else(|| {
                parse_optional_toml_section(
                    source,
                    "[module_config_rules]",
                    &["\n[[scene_modules]]", "\nuser_task ="],
                )
            })
            .unwrap_or(""),
        scene_modules: parse_optional_toml_string_value(source, "scene_modules")
            .or_else(|| {
                parse_optional_toml_section(
                    source,
                    "[[scene_modules]]",
                    &["\nuser_task =", "\noutput_format ="],
                )
            })
            .unwrap_or(""),
        user_task: parse_toml_string_value(source_name, source, "user_task")?,
        negative_prompt: parse_optional_toml_string_value(source, "negative_prompt").unwrap_or(""),
        output_format: parse_toml_string_value(source_name, source, "output_format")?,
    })
}

fn parse_optional_toml_section(
    source: &'static str,
    section_marker: &str,
    end_markers: &[&str],
) -> Option<&'static str> {
    let start = source.find(section_marker)?;
    let section_source = &source[start..];
    let end = end_markers
        .iter()
        .filter_map(|marker| section_source.find(marker))
        .min()
        .unwrap_or(section_source.len());
    Some(trim_toml_section(&section_source[..end]))
}

fn trim_toml_section(value: &'static str) -> &'static str {
    let value = value.trim_start_matches(['\r', '\n']);
    value.trim_end_matches(['\r', '\n'])
}

fn parse_optional_toml_string_value(source: &'static str, key: &str) -> Option<&'static str> {
    find_assignment_value_start(source, key).and_then(|value_start| {
        let value_source = source[value_start..].trim_start();
        if let Some(multiline_source) = value_source.strip_prefix("\"\"\"") {
            let end_offset = multiline_source.find("\"\"\"")?;
            return Some(trim_multiline_toml_string(&multiline_source[..end_offset]));
        }

        if let Some(line_source) = value_source.strip_prefix('"') {
            let end_offset = line_source.find('"')?;
            return Some(&line_source[..end_offset]);
        }

        None
    })
}

fn parse_toml_string_value(
    source_name: &'static str,
    source: &'static str,
    key: &str,
) -> Result<&'static str, PromptRegistryError> {
    let value_start = find_assignment_value_start(source, key).ok_or_else(|| {
        PromptRegistryError::InvalidConfig(format!("{source_name} 缺少 `{key}` 字段。"))
    })?;
    let value_source = source[value_start..].trim_start();

    if let Some(multiline_source) = value_source.strip_prefix("\"\"\"") {
        let end_offset = multiline_source.find("\"\"\"").ok_or_else(|| {
            PromptRegistryError::InvalidConfig(format!(
                "{source_name} 的 `{key}` 多行字符串未闭合。"
            ))
        })?;
        return Ok(trim_multiline_toml_string(&multiline_source[..end_offset]));
    }

    if let Some(line_source) = value_source.strip_prefix('"') {
        let end_offset = line_source.find('"').ok_or_else(|| {
            PromptRegistryError::InvalidConfig(format!("{source_name} 的 `{key}` 字符串未闭合。"))
        })?;
        return Ok(&line_source[..end_offset]);
    }

    Err(PromptRegistryError::InvalidConfig(format!(
        "{source_name} 的 `{key}` 必须是 TOML 字符串。"
    )))
}

fn find_assignment_value_start(source: &str, key: &str) -> Option<usize> {
    let assignment_prefix = format!("{key} =");
    let mut offset = 0;
    let mut inside_multiline_string = false;
    for line in source.split_inclusive('\n') {
        let trimmed_line = line.trim_start();
        if !inside_multiline_string && trimmed_line.starts_with(&assignment_prefix) {
            let indent_len = line.len() - trimmed_line.len();
            let after_equals = &trimmed_line[assignment_prefix.len()..];
            let whitespace_len = after_equals.len() - after_equals.trim_start().len();
            return Some(offset + indent_len + assignment_prefix.len() + whitespace_len);
        }
        if line.matches("\"\"\"").count() % 2 == 1 {
            inside_multiline_string = !inside_multiline_string;
        }
        offset += line.len();
    }
    None
}

fn trim_multiline_toml_string(value: &'static str) -> &'static str {
    let value = if let Some(value) = value.strip_prefix("\r\n") {
        value
    } else if let Some(value) = value.strip_prefix('\n') {
        value
    } else {
        value
    };

    if let Some(value) = value.strip_suffix("\r\n") {
        value
    } else if let Some(value) = value.strip_suffix('\n') {
        value
    } else {
        value
    }
}

fn join_sections(sections: &[&str]) -> String {
    sections
        .iter()
        .map(|section| section.trim())
        .filter(|section| !section.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptRegistryError {
    InvalidConfig(String),
}

impl std::fmt::Display for PromptRegistryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfig(message) => write!(formatter, "内置 prompt 配置无效：{message}"),
        }
    }
}

impl std::error::Error for PromptRegistryError {}

#[cfg(test)]
mod tests {
    use super::{
        get_prompt_template, render_prompt_for_roles, render_roleless_prompt, PromptTemplateId,
        PRODUCT_DETAIL_SCENE_PROMPT_TOML,
    };
    use std::path::Path;

    #[test]
    fn prompt_templates_are_backed_by_one_toml_file_each() {
        let prompt_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/services/prompts");

        for file_name in [
            "product_selling_points.toml",
            "product_detail_scene_prompt.toml",
            "viral_style_analysis.toml",
            "clothing_base_model_generation.toml",
            "clothing_scene_planning.toml",
        ] {
            assert!(
                prompt_dir.join(file_name).is_file(),
                "prompt 配置文件不存在：{}",
                file_name
            );
        }
    }

    #[test]
    fn prompt_template_metadata_is_loaded_from_embedded_toml() {
        let template = get_prompt_template(PromptTemplateId::ProductDetailScenePrompt)
            .expect("product detail scene prompt should load");

        assert_eq!(template.id, "product-detail-scene-prompt");
        assert_eq!(template.version, "v1");
        assert_eq!(template.capability_id, "prompt-plan");
        assert!(template.system_rules.contains("资深电商视觉策略师"));
        assert!(template.user_task.contains("目标语言：{{language}}"));
        assert!(template
            .output_format
            .contains("sceneTitle 是该场景的主标题"));
    }

    #[test]
    fn product_detail_scene_prompt_embeds_visual_copywriting_rules() {
        let prompt = render_roleless_prompt(PromptTemplateId::ProductDetailScenePrompt)
            .expect("product detail scene prompt should render");

        assert!(prompt.contains("资深电商视觉策略师"));
        assert!(prompt.contains("画面内容"));
        assert!(prompt.contains("画面文字内容"));
        assert!(prompt.contains("设计说明"));
        assert!(prompt.contains("targetLanguage"));
        assert!(prompt.contains("sceneTitle 是该场景的主标题"));
        assert!(prompt.contains("image_prompt"));
        assert!(prompt.contains("copy_requirements"));
        assert!(prompt.contains("subheadline 可以为空字符串"));
        assert!(prompt.contains("资质证据不足"));
        assert!(prompt.contains("绝对化"));
        assert!(prompt.contains("合规风险"));
    }

    #[test]
    fn product_detail_scene_prompt_embeds_module_prompt_config() {
        let template = get_prompt_template(PromptTemplateId::ProductDetailScenePrompt)
            .expect("product detail scene prompt should load");

        assert!(!PRODUCT_DETAIL_SCENE_PROMPT_TOML.contains("module_config_rules = \"\"\""));
        assert!(!PRODUCT_DETAIL_SCENE_PROMPT_TOML.contains("scene_modules = \"\"\""));
        assert!(template
            .module_config_rules
            .trim_start()
            .starts_with("[module_config_rules]"));
        assert!(template
            .module_config_rules
            .contains("输入的商品卖点摘要是唯一事实来源"));
        assert!(template.module_config_rules.contains("version = \"3.0.0\""));
        assert!(template
            .module_config_rules
            .contains("copy_requirements 中的主标题、副标题、结构化信息"));
        assert!(template
            .scene_modules
            .trim_start()
            .starts_with("[[scene_modules]]"));
        assert!(template.scene_modules.contains("hero_visual"));
        assert!(template.scene_modules.contains("首屏主视觉"));
        assert!(template.scene_modules.contains("ingredient_composition"));
        assert!(template.scene_modules.contains("商品成分图"));
        assert!(template.user_task.contains("{{selectedSceneModules}}"));
    }

    #[test]
    fn product_selling_points_prompt_uses_general_ecommerce_rules() {
        let prompt = render_roleless_prompt(PromptTemplateId::ProductSellingPoints)
            .expect("product selling points prompt should render");

        assert!(prompt.contains("专业的电商商品详情页文案策划"));
        assert!(prompt.contains("优先读取图片中的可见文字"));
        assert!(prompt.contains("商品类目"));
        assert!(prompt.contains("美妆个护类"));
        assert!(prompt.contains("杯壶餐具类"));
        assert!(prompt.contains("食品级"));
        assert!(prompt.contains("核心卖点允许基于“图片可见信息 + 商品类目常见消费需求”"));
    }

    #[test]
    fn clothing_base_model_generation_prompt_defines_base_model_contract() {
        let template = get_prompt_template(PromptTemplateId::ClothingBaseModelGeneration)
            .expect("clothing base model generation prompt should load");
        let prompt = render_roleless_prompt(PromptTemplateId::ClothingBaseModelGeneration)
            .expect("clothing base model generation prompt should render");

        assert_eq!(template.id, "clothing-base-model-generation");
        assert_eq!(template.version, "v1");
        assert_eq!(template.capability_id, "clothing-base-model-generation");
        assert!(prompt.contains("{{gender}}"));
        assert!(prompt.contains("{{age}}"));
        assert!(prompt.contains("{{ethnicity}}"));
        assert!(prompt.contains("{{body}}"));
        assert!(prompt.contains("{{appearance}}"));
        assert!(prompt.contains("服饰试穿基准模特全身照"));
        assert!(prompt.contains("虚拟真人"));
        assert!(prompt.contains("照片级真实"));
        assert!(prompt.contains("禁止卡通"));
        assert!(prompt.contains("3D 卡通"));
        assert!(prompt.contains("不要生成品牌 Logo、文字、水印"));
        assert!(prompt.contains("婴儿、儿童、青少年"));
        assert!(prompt.contains("不得成人化、性感化"));
    }

    #[test]
    fn clothing_scene_planning_prompt_defines_scene_pose_contract() {
        let template = get_prompt_template(PromptTemplateId::ClothingScenePlanning)
            .expect("clothing scene planning prompt should load");
        let prompt = render_roleless_prompt(PromptTemplateId::ClothingScenePlanning)
            .expect("clothing scene planning prompt should render");

        assert_eq!(template.id, "clothing-scene-planning");
        assert_eq!(template.version, "v1");
        assert_eq!(template.capability_id, "clothing-scene-planning");
        assert!(prompt.contains("场景与动作规划阶段"));
        assert!(prompt.contains("服装参考：用户上传的服装原图"));
        assert!(prompt.contains("模特参考：用户选择的模特全身图"));
        assert!(!prompt.contains("{{clothingReference}}"));
        assert!(!prompt.contains("{{modelReference}}"));
        assert!(prompt.contains("{{selectedScenes}}"));
        assert!(prompt.contains("{{customScene}}"));
        assert!(prompt.contains("{{ratio}}"));
        assert!(prompt.contains("服装款式、颜色、版型、材质、花纹、文字、Logo"));
        assert!(prompt.contains("不得规划会遮挡、扭曲或覆盖服装文字、Logo、花纹的动作"));
        assert!(prompt.contains("每个场景必须输出 4 个动作"));
        assert!(prompt.contains("sceneVisualAnchor"));
        assert!(prompt.contains("scenePromptSegment"));
        assert!(prompt.contains("recommendedPoses"));
    }

    #[test]
    fn clothing_tryon_generation_prompt_defines_image_generation_contract() {
        let template = get_prompt_template(PromptTemplateId::ClothingTryonGeneration)
            .expect("clothing tryon generation prompt should load");
        let prompt = render_roleless_prompt(PromptTemplateId::ClothingTryonGeneration)
            .expect("clothing tryon generation prompt should render");
        let role_messages = render_prompt_for_roles(PromptTemplateId::ClothingTryonGeneration)
            .expect("clothing tryon role messages should render");

        assert_eq!(template.id, "clothing-tryon-generation");
        assert_eq!(template.version, "v2");
        assert_eq!(template.capability_id, "clothing-tryon-generation");
        assert!(prompt.contains("image-to-image 服饰试穿合成任务"));
        assert!(prompt.contains("{{referenceImageRoles}}"));
        assert!(prompt.contains("{{clothingReferenceLabels}}"));
        assert!(prompt.contains("{{modelReferenceLabel}}"));
        assert!(prompt.contains("{{scene}}"));
        assert!(prompt.contains("{{sceneVisualAnchor}}"));
        assert!(prompt.contains("{{scenePromptSegment}}"));
        assert!(prompt.contains("{{ratio}}"));
        assert!(prompt.contains("{{framing}}"));
        assert!(prompt.contains("{{perspective}}"));
        assert!(prompt.contains("{{shootingPosition}}"));
        assert!(prompt.contains("{{poseAction}}"));
        assert!(prompt.contains("不得新增不存在的图案、文字、Logo"));
        assert!(prompt.contains("【负向约束】"));
        assert!(prompt.contains("different person, face changed"));
        assert!(role_messages[0].content.contains("【负向约束】"));
        assert!(role_messages[0]
            .content
            .contains("different garment, changed clothing category"));
        assert!(!prompt.contains("{{garmentCategory}}"));
    }
}
