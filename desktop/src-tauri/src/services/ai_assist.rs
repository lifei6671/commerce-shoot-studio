use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::domain::assets::{AssetError, AssetKind, AssetLifecycle};
use crate::domain::errors::{normalize_provider_http_error, normalize_provider_transport_error};
use crate::services::assets::AssetService;
use crate::services::model_config::ModelConfigError;
use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayError, ModelGatewayInvocationError, ModelGatewayRequest,
    ModelGatewayService,
};
use crate::services::prompt_registry::{
    get_prompt_template, render_prompt_for_roles, render_roleless_prompt, PromptRegistryError,
    PromptTemplateId,
};

const IMAGE_TEXT_RECOGNITION_MAX_OUTPUT_TOKENS: i64 = 12_000;

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeImageTextInput {
    pub asset_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTextBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizedImageTextItem {
    pub id: String,
    pub text: String,
    #[serde(rename = "box")]
    pub box_: ImageTextBox,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTextRecognitionResult {
    pub items: Vec<RecognizedImageTextItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTextRecognitionError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
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

    pub fn recognize_image_text(
        &self,
        workspace_directory: &Path,
        input: RecognizeImageTextInput,
    ) -> Result<ImageTextRecognitionResult, ImageTextRecognitionError> {
        self.recognize_image_text_with_gateway(
            workspace_directory,
            input,
            |workspace_directory, request| {
                ModelGatewayService::new()
                    .invoke_real_provider_detailed(workspace_directory, request)
            },
        )
    }

    pub fn recognize_image_text_with_adapter<T: ModelGatewayAdapter>(
        &self,
        workspace_directory: &Path,
        input: RecognizeImageTextInput,
        adapter: &T,
    ) -> Result<ImageTextRecognitionResult, ImageTextRecognitionError> {
        self.recognize_image_text_with_gateway(
            workspace_directory,
            input,
            |workspace_directory, request| {
                ModelGatewayService::new().invoke_with_adapter_detailed(
                    workspace_directory,
                    request,
                    adapter,
                )
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

    fn recognize_image_text_with_gateway<F>(
        &self,
        workspace_directory: &Path,
        input: RecognizeImageTextInput,
        invoke_gateway: F,
    ) -> Result<ImageTextRecognitionResult, ImageTextRecognitionError>
    where
        F: FnOnce(
            &Path,
            ModelGatewayRequest,
        ) -> Result<
            crate::services::model_gateway::ModelGatewayResult,
            ModelGatewayInvocationError,
        >,
    {
        let asset_id = input.asset_id.trim();
        if asset_id.is_empty() {
            return Err(ImageTextRecognitionError::new(
                "ASSET_NOT_FOUND",
                "当前图片不可用，请重新选择图片。",
                false,
            ));
        }
        let asset = AssetService::new()
            .get_asset(workspace_directory, asset_id)
            .map_err(image_text_asset_error)?;
        if asset.kind != AssetKind::Generated
            || asset.lifecycle != AssetLifecycle::Active
            || asset.deleted_at.is_some()
        {
            return Err(ImageTextRecognitionError::new(
                "ASSET_NOT_FOUND",
                "当前图片不可用，请重新选择图片。",
                false,
            ));
        }
        if !matches!(
            asset.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp"
        ) {
            return Err(ImageTextRecognitionError::new(
                "UNSUPPORTED_IMAGE_FORMAT",
                "当前图片格式不支持文字识别。",
                false,
            ));
        }
        let path = AssetService::new()
            .asset_file_path(workspace_directory, asset_id)
            .map_err(image_text_asset_error)?;
        if !path.is_file() {
            return Err(ImageTextRecognitionError::new(
                "ASSET_FILE_MISSING",
                "当前图片文件不存在，请重新生成或恢复图片。",
                false,
            ));
        }
        let bytes = fs::read(&path).map_err(|_| {
            ImageTextRecognitionError::new(
                "ASSET_FILE_MISSING",
                "读取当前图片失败，请检查工作区文件。",
                false,
            )
        })?;
        if bytes.is_empty() {
            return Err(ImageTextRecognitionError::new(
                "ASSET_FILE_MISSING",
                "当前图片文件为空，请重新生成图片。",
                false,
            ));
        }

        let template =
            get_prompt_template(PromptTemplateId::ImageTextRecognition).map_err(|_| {
                ImageTextRecognitionError::new(
                    "PROMPT_TEMPLATE_INVALID",
                    "文字识别配置不可用。",
                    false,
                )
            })?;
        let prompt_messages = render_prompt_for_roles(PromptTemplateId::ImageTextRecognition)
            .map_err(|_| {
                ImageTextRecognitionError::new(
                    "PROMPT_TEMPLATE_INVALID",
                    "文字识别配置不可用。",
                    false,
                )
            })?;
        let roleless_prompt = render_roleless_prompt(PromptTemplateId::ImageTextRecognition)
            .map_err(|_| {
                ImageTextRecognitionError::new(
                    "PROMPT_TEMPLATE_INVALID",
                    "文字识别配置不可用。",
                    false,
                )
            })?;
        let request = ModelGatewayRequest {
            capability_id: template.capability_id.to_string(),
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
                "userImages": [{
                    "originalName": asset.original_name,
                    "mimeType": asset.mime_type,
                    "dataUrl": format!(
                        "data:{};base64,{}",
                        asset.mime_type,
                        encode_base64(&bytes)
                    ),
                }],
                "maxOutputTokens": IMAGE_TEXT_RECOGNITION_MAX_OUTPUT_TOKENS,
            }),
        };
        let gateway_result =
            invoke_gateway(workspace_directory, request).map_err(image_text_model_error)?;
        normalize_image_text_recognition_output(gateway_result.output_text.as_deref())
    }
}

impl ImageTextRecognitionError {
    fn new(code: &str, message: &str, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            retryable,
        }
    }
}

impl std::fmt::Display for ImageTextRecognitionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for ImageTextRecognitionError {}

fn image_text_asset_error(source: AssetError) -> ImageTextRecognitionError {
    match source {
        AssetError::NotFound(_) => ImageTextRecognitionError::new(
            "ASSET_NOT_FOUND",
            "当前图片不可用，请重新选择图片。",
            false,
        ),
        AssetError::Io { .. } => ImageTextRecognitionError::new(
            "ASSET_FILE_MISSING",
            "读取当前图片失败，请检查工作区文件。",
            false,
        ),
        AssetError::InvalidKind(_) | AssetError::InvalidInput(_) => ImageTextRecognitionError::new(
            "ASSET_NOT_FOUND",
            "当前图片不可用，请重新选择图片。",
            false,
        ),
        AssetError::Database(_) => ImageTextRecognitionError::new(
            "WORKSPACE_UNAVAILABLE",
            "读取当前图片失败，请检查工作区状态。",
            false,
        ),
    }
}

fn image_text_model_error(source: ModelGatewayInvocationError) -> ImageTextRecognitionError {
    match source {
        ModelGatewayInvocationError::Config(source) => match source {
            ModelConfigError::ProviderHttp {
                status_code,
                provider_error_code,
            } => {
                let normalized =
                    normalize_provider_http_error(status_code, provider_error_code.as_deref());
                ImageTextRecognitionError {
                    code: normalized.code,
                    message: normalized.message,
                    retryable: normalized.retryable,
                }
            }
            ModelConfigError::ProviderTransport(kind) => {
                let normalized = normalize_provider_transport_error(kind);
                ImageTextRecognitionError {
                    code: normalized.code,
                    message: normalized.message,
                    retryable: normalized.retryable,
                }
            }
            ModelConfigError::NotFound(_) | ModelConfigError::Validation(_) => {
                ImageTextRecognitionError::new(
                    "MODEL_CAPABILITY_UNAVAILABLE",
                    "没有可用的图生文模型，请先在模型配置中完成配置并测试连接。",
                    false,
                )
            }
            ModelConfigError::Database(_) => ImageTextRecognitionError::new(
                "MODEL_CONFIG_UNAVAILABLE",
                "读取文字识别模型配置失败。",
                false,
            ),
        },
        ModelGatewayInvocationError::Provider(source) => match source {
            ModelGatewayError::ProviderHttp {
                status_code,
                provider_error_code,
            } => {
                let normalized =
                    normalize_provider_http_error(status_code, provider_error_code.as_deref());
                ImageTextRecognitionError {
                    code: normalized.code,
                    message: normalized.message,
                    retryable: normalized.retryable,
                }
            }
            ModelGatewayError::ProviderTransport(kind) => {
                let normalized = normalize_provider_transport_error(kind);
                ImageTextRecognitionError {
                    code: normalized.code,
                    message: normalized.message,
                    retryable: normalized.retryable,
                }
            }
            ModelGatewayError::ProviderRequestInvalid(_) => ImageTextRecognitionError::new(
                "MODEL_CAPABILITY_UNAVAILABLE",
                "没有可用的图生文模型，请先在模型配置中完成配置并测试连接。",
                false,
            ),
            ModelGatewayError::ProviderUnavailable(_) => ImageTextRecognitionError::new(
                "IMAGE_TEXT_RECOGNITION_PROVIDER_UNAVAILABLE",
                "文字识别服务响应异常，请重试。",
                true,
            ),
        },
    }
}

fn normalize_image_text_recognition_output(
    output_text: Option<&str>,
) -> Result<ImageTextRecognitionResult, ImageTextRecognitionError> {
    let output_text = output_text.unwrap_or_default();
    let invalid = |reason, item_index, field| {
        invalid_image_text_recognition_output(reason, output_text, item_index, field)
    };
    let value = parse_image_text_recognition_json(output_text)
        .map_err(|reason| invalid(reason, None, None))?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid("top_level_not_object", None, None))?;
    let items = object
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("items_missing_or_invalid", None, None))?;
    if items.len() > 100 {
        return Err(invalid("items_too_many", None, None));
    }
    enum ProviderBox {
        Canonical(ImageTextBox),
        Legacy {
            x: f64,
            y: f64,
            width: f64,
            height: f64,
        },
    }

    struct ProviderItem {
        source_index: usize,
        text: String,
        box_: ProviderBox,
    }

    #[derive(Clone, Copy)]
    struct BoxIssue {
        reason: &'static str,
        field: &'static str,
    }

    let mut parsed = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let item = item
            .as_object()
            .ok_or_else(|| invalid("item_not_object", Some(index), None))?;
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty() && text.chars().count() <= 500)
            .ok_or_else(|| invalid("text_invalid", Some(index), Some("text")))?;
        let box_ = (|| -> Result<ProviderBox, BoxIssue> {
            let box_value = item.get("box").and_then(Value::as_object).ok_or(BoxIssue {
                reason: "box_missing_or_invalid",
                field: "box",
            })?;
            let coordinate = |field: &'static str| {
                let value = box_value
                    .get(field)
                    .and_then(Value::as_f64)
                    .ok_or(BoxIssue {
                        reason: "coordinate_type",
                        field,
                    })?;
                if !value.is_finite() {
                    return Err(BoxIssue {
                        reason: "coordinate_non_finite",
                        field,
                    });
                }
                Ok(value)
            };
            let uses_edges = ["left", "top", "right", "bottom"]
                .iter()
                .any(|field| box_value.contains_key(*field));
            if uses_edges {
                let left = coordinate("left")?;
                let top = coordinate("top")?;
                let right = coordinate("right")?;
                let bottom = coordinate("bottom")?;
                if !(0.0..=1.0).contains(&left)
                    || !(0.0..=1.0).contains(&top)
                    || !(0.0..=1.0).contains(&right)
                    || !(0.0..=1.0).contains(&bottom)
                {
                    return Err(BoxIssue {
                        reason: "coordinate_range",
                        field: "box",
                    });
                }
                if left >= right || top >= bottom {
                    return Err(BoxIssue {
                        reason: "coordinate_edge_order",
                        field: "box",
                    });
                }
                Ok(ProviderBox::Canonical(ImageTextBox {
                    x: left,
                    y: top,
                    width: right - left,
                    height: bottom - top,
                }))
            } else {
                let x = coordinate("x")?;
                let y = coordinate("y")?;
                let width = coordinate("width")?;
                let height = coordinate("height")?;
                if !(0.0..=1.0).contains(&x) {
                    return Err(BoxIssue {
                        reason: "coordinate_range",
                        field: "x",
                    });
                }
                if !(0.0..=1.0).contains(&y) {
                    return Err(BoxIssue {
                        reason: "coordinate_range",
                        field: "y",
                    });
                }
                if !(0.0..=1.0).contains(&width) || width <= 0.0 {
                    return Err(BoxIssue {
                        reason: "coordinate_range",
                        field: "width",
                    });
                }
                if !(0.0..=1.0).contains(&height) || height <= 0.0 {
                    return Err(BoxIssue {
                        reason: "coordinate_range",
                        field: "height",
                    });
                }
                Ok(ProviderBox::Legacy {
                    x,
                    y,
                    width,
                    height,
                })
            }
        })();
        let box_ = match box_ {
            Ok(box_) => box_,
            Err(issue) => {
                log_skipped_image_text_item(issue.reason, output_text, index, issue.field);
                continue;
            }
        };
        parsed.push(ProviderItem {
            source_index: index,
            text: text.to_string(),
            box_,
        });
    }

    let legacy_has_overflow = parsed.iter().any(|item| match &item.box_ {
        ProviderBox::Legacy {
            x,
            y,
            width,
            height,
        } => *x + *width > 1.0 || *y + *height > 1.0,
        ProviderBox::Canonical(_) => false,
    });
    let legacy_can_be_endpoints = parsed.iter().all(|item| match &item.box_ {
        ProviderBox::Legacy {
            x,
            y,
            width,
            height,
        } => x < width && y < height,
        ProviderBox::Canonical(_) => true,
    });
    let legacy_endpoint_mode = legacy_has_overflow && legacy_can_be_endpoints;

    let mut normalized = Vec::with_capacity(parsed.len());
    for item in parsed {
        let box_ = match item.box_ {
            ProviderBox::Canonical(box_) => box_,
            ProviderBox::Legacy {
                x,
                y,
                width,
                height,
            } if legacy_endpoint_mode => ImageTextBox {
                x,
                y,
                width: width - x,
                height: height - y,
            },
            ProviderBox::Legacy {
                x,
                y,
                width,
                height,
            } if x + width <= 1.0 && y + height <= 1.0 => ImageTextBox {
                x,
                y,
                width,
                height,
            },
            ProviderBox::Legacy { .. } => {
                log_skipped_image_text_item(
                    "legacy_box_ambiguous",
                    output_text,
                    item.source_index,
                    "box",
                );
                continue;
            }
        };
        normalized.push(RecognizedImageTextItem {
            id: format!("line-{:03}", normalized.len() + 1),
            text: item.text,
            box_,
        });
    }
    Ok(ImageTextRecognitionResult { items: normalized })
}

fn log_skipped_image_text_item(
    reason: &'static str,
    output_text: &str,
    item_index: usize,
    field: &'static str,
) {
    let diagnostic = json!({
        "event": "item_skipped",
        "reason": reason,
        "itemIndex": item_index,
        "field": field,
        "outputCharCount": output_text.chars().count(),
        "startsWithFence": output_text.trim_start().starts_with("```"),
    });
    eprintln!("[image-text-recognition-diagnostic] {diagnostic}");
}

fn parse_image_text_recognition_json(output_text: &str) -> Result<Value, &'static str> {
    let trimmed = output_text.trim();
    if let Ok(value) = serde_json::from_str(trimmed) {
        return Ok(value);
    }
    let fenced = strip_complete_json_markdown_fence(trimmed).ok_or("json_syntax")?;
    serde_json::from_str(fenced).map_err(|_| "json_syntax")
}

fn strip_complete_json_markdown_fence(value: &str) -> Option<&str> {
    let fenced = value.strip_prefix("```")?;
    let line_break = fenced.find('\n')?;
    let language = fenced[..line_break].trim();
    if !language.is_empty() && !language.eq_ignore_ascii_case("json") {
        return None;
    }
    fenced[line_break + 1..].strip_suffix("```").map(str::trim)
}

fn invalid_image_text_recognition_output(
    reason: &'static str,
    output_text: &str,
    item_index: Option<usize>,
    field: Option<&'static str>,
) -> ImageTextRecognitionError {
    let mut diagnostic = json!({
        "event": "output_validation_error",
        "reason": reason,
        "outputCharCount": output_text.chars().count(),
        "startsWithFence": output_text.trim_start().starts_with("```"),
    });
    if let Some(item_index) = item_index {
        diagnostic["itemIndex"] = json!(item_index);
    }
    if let Some(field) = field {
        diagnostic["field"] = json!(field);
    }
    eprintln!("[image-text-recognition-diagnostic] {diagnostic}");
    ImageTextRecognitionError::new(
        "IMAGE_TEXT_RECOGNITION_OUTPUT_INVALID",
        "文字识别结果格式无效，请重试。",
        true,
    )
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
