use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::services::model_config::ModelConfigError;
use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayRequest, ModelGatewayService,
};
use crate::services::prompt_registry::{
    get_prompt_template, render_prompt_for_roles, render_roleless_prompt, PromptRegistryError,
    PromptTemplateId,
};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSellingPointsInput {
    #[serde(default)]
    pub image_paths: Vec<String>,
    #[serde(default)]
    pub images: Vec<ProductSellingPointsImageInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSellingPointsImageInput {
    pub original_name: Option<String>,
    pub mime_type: Option<String>,
    pub data_url: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViralStyleAnalysisInput {
    pub platform: String,
    pub product_selling_points: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistResult {
    pub text: String,
    pub capability_id: String,
    pub prompt_id: String,
    pub prompt_version: String,
    #[serde(skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AiAssistService;

impl AiAssistService {
    pub fn new() -> Self {
        Self
    }

    pub fn generate_product_selling_points(
        &self,
        workspace_directory: &Path,
        input: ProductSellingPointsInput,
    ) -> Result<AiAssistResult, AiAssistError> {
        self.generate_product_selling_points_with_gateway(
            workspace_directory,
            input,
            |workspace_directory, request| {
                ModelGatewayService::new().invoke_real_provider(workspace_directory, request)
            },
        )
    }

    pub fn generate_product_selling_points_stream<F>(
        &self,
        workspace_directory: &Path,
        input: ProductSellingPointsInput,
        mut on_delta: F,
    ) -> Result<AiAssistResult, AiAssistError>
    where
        F: FnMut(&str) -> Result<(), AiAssistError>,
    {
        let request_context = build_product_selling_points_request(input)?;
        let gateway_result = ModelGatewayService::new().stream_real_provider(
            workspace_directory,
            request_context.gateway_request,
            |delta| {
                on_delta(delta).map_err(|error| ModelConfigError::Validation(error.to_string()))
            },
        )?;

        Ok(AiAssistResult {
            text: gateway_result.output_text.unwrap_or_default(),
            capability_id: request_context.capability_id,
            prompt_id: request_context.prompt_id,
            prompt_version: request_context.prompt_version,
            data: Value::Null,
        })
    }

    pub fn analyze_viral_style(
        &self,
        workspace_directory: &Path,
        input: ViralStyleAnalysisInput,
    ) -> Result<AiAssistResult, AiAssistError> {
        self.analyze_viral_style_with_gateway(
            workspace_directory,
            input,
            |workspace_directory, request| {
                ModelGatewayService::new().invoke_real_provider(workspace_directory, request)
            },
        )
    }

    pub fn analyze_viral_style_with_adapter<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        input: ViralStyleAnalysisInput,
        adapter: &T,
    ) -> Result<AiAssistResult, AiAssistError> {
        self.analyze_viral_style_with_gateway(
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

    pub fn generate_product_selling_points_with_adapter<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        input: ProductSellingPointsInput,
        adapter: &T,
    ) -> Result<AiAssistResult, AiAssistError> {
        self.generate_product_selling_points_with_gateway(
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

    fn generate_product_selling_points_with_gateway<F>(
        &self,
        workspace_directory: &Path,
        input: ProductSellingPointsInput,
        invoke_gateway: F,
    ) -> Result<AiAssistResult, AiAssistError>
    where
        F: FnOnce(
            &Path,
            ModelGatewayRequest,
        )
            -> Result<crate::services::model_gateway::ModelGatewayResult, ModelConfigError>,
    {
        let request_context = build_product_selling_points_request(input)?;
        let gateway_result = invoke_gateway(workspace_directory, request_context.gateway_request)?;

        Ok(AiAssistResult {
            text: gateway_result.output_text.unwrap_or_default(),
            capability_id: request_context.capability_id,
            prompt_id: request_context.prompt_id,
            prompt_version: request_context.prompt_version,
            data: Value::Null,
        })
    }

    fn analyze_viral_style_with_gateway<F>(
        &self,
        workspace_directory: &Path,
        input: ViralStyleAnalysisInput,
        invoke_gateway: F,
    ) -> Result<AiAssistResult, AiAssistError>
    where
        F: FnOnce(
            &Path,
            ModelGatewayRequest,
        )
            -> Result<crate::services::model_gateway::ModelGatewayResult, ModelConfigError>,
    {
        let request_context = build_viral_style_analysis_request(input)?;
        let gateway_result = invoke_gateway(workspace_directory, request_context.gateway_request)?;
        let output_text = gateway_result.output_text.unwrap_or_default();
        let data = parse_viral_style_analysis_output(&output_text)?;

        Ok(AiAssistResult {
            text: output_text,
            capability_id: request_context.capability_id,
            prompt_id: request_context.prompt_id,
            prompt_version: request_context.prompt_version,
            data,
        })
    }
}

struct ProductSellingPointsRequestContext {
    capability_id: String,
    gateway_request: ModelGatewayRequest,
    prompt_id: String,
    prompt_version: String,
}

struct ViralStyleAnalysisRequestContext {
    capability_id: String,
    gateway_request: ModelGatewayRequest,
    prompt_id: String,
    prompt_version: String,
}

fn build_product_selling_points_request(
    input: ProductSellingPointsInput,
) -> Result<ProductSellingPointsRequestContext, AiAssistError> {
    if input.image_paths.is_empty() && input.images.is_empty() {
        return Err(AiAssistError::Validation("请先上传商品图。".to_string()));
    }

    let template = get_prompt_template(PromptTemplateId::ProductSellingPoints)?;
    let mut images = input
        .images
        .iter()
        .map(prepare_user_image_input)
        .collect::<Result<Vec<_>, _>>()?;
    let path_images = input
        .image_paths
        .iter()
        .map(|path| prepare_user_image(path))
        .collect::<Result<Vec<_>, _>>()?;
    images.extend(path_images);
    if images.is_empty() {
        return Err(AiAssistError::Validation("请先上传商品图。".to_string()));
    }
    let prompt_messages = render_prompt_for_roles(PromptTemplateId::ProductSellingPoints)?;
    let roleless_prompt = render_roleless_prompt(PromptTemplateId::ProductSellingPoints)?;
    let capability_id = template.capability_id.to_string();
    let prompt_id = template.id.to_string();
    let prompt_version = template.version.to_string();

    Ok(ProductSellingPointsRequestContext {
        capability_id: capability_id.clone(),
        prompt_id,
        prompt_version,
        gateway_request: ModelGatewayRequest {
            capability_id,
            input: json!({
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
                "userImages": images
                    .iter()
                    .map(|image| json!({
                        "originalName": image.original_name,
                        "mimeType": image.mime_type,
                        "dataUrl": image.data_url,
                    }))
                    .collect::<Vec<_>>(),
            }),
        },
    })
}

fn build_viral_style_analysis_request(
    input: ViralStyleAnalysisInput,
) -> Result<ViralStyleAnalysisRequestContext, AiAssistError> {
    let platform = input.platform.trim();
    let product_selling_points = input.product_selling_points.trim();
    if platform.is_empty() {
        return Err(AiAssistError::Validation(
            "爆款风格分析缺少目标平台。".to_string(),
        ));
    }
    if product_selling_points.is_empty() {
        return Err(AiAssistError::Validation("请先补充商品卖点。".to_string()));
    }

    let template = get_prompt_template(PromptTemplateId::ViralStyleAnalysis)?;
    let prompt_messages = render_viral_style_prompt_messages(platform, product_selling_points)?;
    let roleless_prompt = render_viral_style_roleless_prompt(platform, product_selling_points)?;
    let capability_id = template.capability_id.to_string();
    let prompt_id = template.id.to_string();
    let prompt_version = template.version.to_string();

    Ok(ViralStyleAnalysisRequestContext {
        capability_id: capability_id.clone(),
        prompt_id,
        prompt_version,
        gateway_request: ModelGatewayRequest {
            capability_id,
            input: json!({
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
                "context": {
                    "platform": platform,
                    "productSellingPoints": product_selling_points,
                },
            }),
        },
    })
}

fn render_viral_style_prompt_messages(
    platform: &str,
    product_selling_points: &str,
) -> Result<Vec<crate::services::prompt_registry::PromptMessage>, AiAssistError> {
    let mut messages = render_prompt_for_roles(PromptTemplateId::ViralStyleAnalysis)?;
    for message in &mut messages {
        message.content =
            render_viral_style_variables(&message.content, platform, product_selling_points);
    }
    Ok(messages)
}

fn render_viral_style_roleless_prompt(
    platform: &str,
    product_selling_points: &str,
) -> Result<String, AiAssistError> {
    Ok(render_viral_style_variables(
        &render_roleless_prompt(PromptTemplateId::ViralStyleAnalysis)?,
        platform,
        product_selling_points,
    ))
}

fn render_viral_style_variables(
    content: &str,
    platform: &str,
    product_selling_points: &str,
) -> String {
    content
        .replace("{{platform}}", platform)
        .replace("{{productSellingPoints}}", product_selling_points)
}

fn parse_viral_style_analysis_output(output_text: &str) -> Result<Value, AiAssistError> {
    let data: Value = serde_json::from_str(output_text.trim())
        .map_err(|_| AiAssistError::Validation("爆款风格分析返回的 JSON 无法解析。".to_string()))?;
    let items = data
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| AiAssistError::Validation("爆款风格分析返回结构缺少 items。".to_string()))?;
    if items.len() != 4 {
        return Err(AiAssistError::Validation(
            "爆款风格分析需要返回 4 个风格方向。".to_string(),
        ));
    }
    for item in items {
        if item
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .is_empty()
            || item
                .get("subtitle")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .is_empty()
        {
            return Err(AiAssistError::Validation(
                "爆款风格分析返回结构缺少标题或副标题。".to_string(),
            ));
        }
        for field_name in [
            "reasoning",
            "designFocus",
            "globalStyleNote",
            "fontStyleDescription",
            "colorDescription",
            "iconStyle",
        ] {
            if item
                .get(field_name)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err(AiAssistError::Validation(
                    "爆款风格分析返回结构缺少生图指导字段。".to_string(),
                ));
            }
        }
        let colors = item
            .get("colors")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                AiAssistError::Validation("爆款风格分析返回结构缺少配色。".to_string())
            })?;
        if colors.len() < 2 || colors.len() > 3 {
            return Err(AiAssistError::Validation(
                "每个爆款风格需要返回 2-3 个颜色。".to_string(),
            ));
        }
        if colors
            .iter()
            .any(|color| !is_hex_color(color.as_str().unwrap_or_default()))
        {
            return Err(AiAssistError::Validation(
                "爆款风格分析颜色必须是 6 位 HEX 色值。".to_string(),
            ));
        }
    }
    Ok(data)
}

fn is_hex_color(value: &str) -> bool {
    let value = value.trim();
    value.len() == 7
        && value.starts_with('#')
        && value
            .as_bytes()
            .iter()
            .skip(1)
            .all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Debug, Clone)]
struct PreparedUserImage {
    original_name: String,
    mime_type: String,
    data_url: String,
}

fn prepare_user_image(path: &str) -> Result<PreparedUserImage, AiAssistError> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(AiAssistError::Validation(
            "商品图片不存在或不是普通文件。".to_string(),
        ));
    }
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AiAssistError::Validation("商品图片缺少扩展名。".to_string()))?;
    let mime_type = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => {
            return Err(AiAssistError::Validation(format!(
                "暂不支持的图片格式：{extension}。当前版本请使用 png、jpg、jpeg 或 webp。"
            )))
        }
    };
    let bytes = fs::read(&path).map_err(|_| AiAssistError::Io("读取商品图片失败。".to_string()))?;
    if bytes.is_empty() {
        return Err(AiAssistError::Validation(
            "商品图片内容不能为空。".to_string(),
        ));
    }

    Ok(PreparedUserImage {
        original_name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "商品图片".to_string()),
        mime_type: mime_type.to_string(),
        data_url: format!("data:{mime_type};base64,{}", encode_base64(&bytes)),
    })
}

fn prepare_user_image_input(
    image: &ProductSellingPointsImageInput,
) -> Result<PreparedUserImage, AiAssistError> {
    if let Some(data_url) = image
        .data_url
        .as_deref()
        .map(str::trim)
        .filter(|data_url| !data_url.is_empty())
    {
        return prepare_user_image_data_url(image, data_url);
    }

    if let Some(path) = image
        .path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return prepare_user_image(path);
    }

    Err(AiAssistError::Validation(
        "商品图片缺少可用的图片数据。".to_string(),
    ))
}

fn prepare_user_image_data_url(
    image: &ProductSellingPointsImageInput,
    data_url: &str,
) -> Result<PreparedUserImage, AiAssistError> {
    let (mime_type, payload) = data_url
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or_else(|| AiAssistError::Validation("商品图片数据格式无效。".to_string()))?;
    if !matches!(mime_type, "image/png" | "image/jpeg" | "image/webp") {
        return Err(AiAssistError::Validation(
            "商品图片需要转换为 png、jpg、jpeg 或 webp 后再使用。".to_string(),
        ));
    }
    if payload.trim().is_empty() {
        return Err(AiAssistError::Validation(
            "商品图片内容不能为空。".to_string(),
        ));
    }
    if image
        .mime_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|declared_mime_type| declared_mime_type != mime_type)
    {
        return Err(AiAssistError::Validation(
            "商品图片 MIME 类型与图片数据不一致。".to_string(),
        ));
    }

    Ok(PreparedUserImage {
        original_name: image
            .original_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("商品图片.webp")
            .to_string(),
        mime_type: mime_type.to_string(),
        data_url: data_url.to_string(),
    })
}

fn encode_base64(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);

    for chunk in input.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        let combined = ((first as u32) << 16) | ((second as u32) << 8) | third as u32;

        output.push(ALPHABET[((combined >> 18) & 0x3f) as usize] as char);
        output.push(ALPHABET[((combined >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[((combined >> 6) & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[(combined & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiAssistError {
    Validation(String),
    Io(String),
    Model(String),
    Prompt(String),
}

impl std::fmt::Display for AiAssistError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(message)
            | Self::Io(message)
            | Self::Model(message)
            | Self::Prompt(message) => {
                write!(formatter, "{message}")
            }
        }
    }
}

impl std::error::Error for AiAssistError {}

impl From<PromptRegistryError> for AiAssistError {
    fn from(source: PromptRegistryError) -> Self {
        Self::Prompt(source.to_string())
    }
}

impl From<ModelConfigError> for AiAssistError {
    fn from(source: ModelConfigError) -> Self {
        Self::Model(source.to_string())
    }
}
