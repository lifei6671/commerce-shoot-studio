use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
};

const TRANSPARENT_PNG_DATA_URL: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

#[derive(Debug, Clone, Copy, Default)]
pub struct DeterministicModelGatewayAdapter;

impl ModelGatewayAdapter for DeterministicModelGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        let images = if matches!(
            request.capability_id,
            "scene-image-generation"
                | "product-detail-generation"
                | "clothing-tryon-generation"
                | "image-edit"
        ) {
            let image_count = request
                .input
                .get("mockImageCount")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(1)
                .max(1);
            serde_json::Value::Array(
                (0..image_count)
                    .map(|_| {
                        serde_json::json!({
                        "mimeType": "image/png",
                        "dataUrl": TRANSPARENT_PNG_DATA_URL
                            })
                    })
                    .collect(),
            )
        } else {
            serde_json::json!([])
        };

        Ok(ModelGatewayAdapterResult {
            output_text: Some(deterministic_output_text(
                request.capability_id,
                request.input,
            )),
            output_json: serde_json::json!({
                "mock": true,
                "capabilityId": request.capability_id,
                "inputSummary": request.input_summary,
                "images": images,
            }),
            usage_json: Some(serde_json::json!({
                "mock": true,
                "inputSummary": request.input_summary,
                "outputText": true,
            })),
        })
    }
}

fn deterministic_output_text(capability_id: &str, input: &serde_json::Value) -> String {
    if capability_id == "product-selling-points" {
        return [
            "1、产品名称：黑色休闲翻领长袖衬衫",
            "",
            "2、核心卖点：",
            "* 卖点 1：黑色翻领长袖版型，整体简洁利落，适合日常穿搭。",
            "* 卖点 2：后背可见图案装饰，增加视觉层次和设计感。",
            "* 卖点 3：偏休闲风格，适合通勤、街头出行和朋友聚会等场景。",
            "",
            "3、适用人群：",
            "日常通勤人群、喜欢休闲穿搭的人群、偏好简约黑色单品的人群。",
            "",
            "4、使用场景：",
            "日常通勤、街头出行、朋友聚会、休闲穿搭。",
            "",
            "5、规格参数：",
            "* 颜色：黑色",
            "* 款式：翻领长袖上衣",
            "* 图案：后背可见图案装饰",
            "* 外观结构：前襟翻领，长袖版型",
        ]
        .join("\n");
    }

    if capability_id == "viral-style-analysis" {
        return serde_json::json!({
            "platform": "淘宝天猫",
            "items": [
                {
                    "id": "style-1",
                    "title": "通勤质感风",
                    "subtitle": "通勤质感心智",
                    "designFocus": "突出版型、质感、场景和人群标签。",
                    "colors": ["#111827", "#F8FAFC"]
                },
                {
                    "id": "style-2",
                    "title": "街头潮酷风",
                    "subtitle": "街头点击记忆",
                    "designFocus": "突出图案、态度表达和社媒种草氛围。",
                    "colors": ["#0F172A", "#EF4444"]
                },
                {
                    "id": "style-3",
                    "title": "简约百搭风",
                    "subtitle": "简约百搭卖点",
                    "designFocus": "突出基础款价值、搭配效率和清爽层级。",
                    "colors": ["#111111", "#FFFFFF"]
                },
                {
                    "id": "style-4",
                    "title": "细节品质风",
                    "subtitle": "细节品质信任",
                    "designFocus": "突出局部细节、质感纹理和参数化表达。",
                    "colors": ["#27272A", "#F4F4F5", "#71717A"]
                }
            ]
        })
        .to_string();
    }

    if capability_id == "listing-copy" {
        return serde_json::json!({
            "platform": "taobao",
            "title": "藏青运动风字母印花圆领短袖T恤",
            "sellingPoints": ["运动风印花", "圆领短袖版型"],
            "promotionBenefits": ["清爽休闲", "日常好搭"],
            "detailCopy": "适合日常通勤与户外休闲穿搭。",
            "searchKeywords": ["藏青T恤", "运动风T恤"],
            "attributeWords": ["藏青色", "圆领", "短袖"],
            "mainImageGuidance": ["首图突出上身效果", "细节图放大胸口印花"]
        })
        .to_string();
    }

    if capability_id == "prompt-plan" {
        return deterministic_prompt_plan_output(input).to_string();
    }

    format!("mock output for {capability_id}")
}

fn deterministic_prompt_plan_output(input: &serde_json::Value) -> serde_json::Value {
    let context = input
        .get("context")
        .and_then(serde_json::Value::as_object)
        .cloned()
        .unwrap_or_default();
    let product_summary = context
        .get("productSellingPoints")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("已上传商品图");
    let ratio = context
        .get("ratio")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("1:1");
    let modules = context
        .get("modules")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let viral_styles = context
        .get("viralStyles")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let groups = if viral_styles.is_empty() {
        vec![deterministic_prompt_plan_group(
            "default-style",
            "默认电商风格",
            ratio,
            product_summary,
            &modules,
        )]
    } else {
        viral_styles
            .iter()
            .enumerate()
            .map(|(index, style)| {
                let style_id = style
                    .get("styleId")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("style-{}", index + 1));
                let style_title = style
                    .get("styleTitle")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("爆款风格方向");
                deterministic_prompt_plan_group(
                    &style_id,
                    style_title,
                    ratio,
                    product_summary,
                    &modules,
                )
            })
            .collect()
    };

    serde_json::json!({
        "version": "v1",
        "productSummary": format!("模型整理后的产品与卖点：{product_summary}"),
        "groups": groups,
    })
}

fn deterministic_prompt_plan_group(
    style_id: &str,
    style_title: &str,
    ratio: &str,
    product_summary: &str,
    modules: &[serde_json::Value],
) -> serde_json::Value {
    let items = modules
        .iter()
        .enumerate()
        .map(|(index, module)| {
            let module_id = module
                .get("moduleId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("module-{}", index + 1));
            let module_title = module
                .get("moduleTitle")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("商品详情图");
            let description = module
                .get("description")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("展示商品卖点");
            serde_json::json!({
                "moduleId": module_id,
                "moduleTitle": module_title,
                "sceneTitle": format!("{style_title}{module_title}"),
                "sceneDescription": format!("画面围绕{product_summary}，采用{style_title}表达，用于{module_title}，{description}。"),
                "imagePrompt": format!("适配 {ratio} 比例的电商详情页画面，围绕{product_summary}，采用{style_title}表达，用于{module_title}；禁止生成品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标。"),
                "textOverlay": {
                    "headline": module_title,
                    "subheadline": style_title,
                },
                "constraints": [
                    "不得编造商品参数",
                    "不得生成品牌 Logo",
                    "不得生成价格、销量、认证标识",
                    "图片中只预留文字安全区，不直接生成可读文字",
                    "imagePrompt 必须与 sceneDescription 保持一致"
                ],
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "styleId": style_id,
        "styleTitle": style_title,
        "colors": ["#111827", "#F8FAFC"],
        "visualConsistency": {
            "productAnchor": product_summary,
            "backgroundAnchor": "干净电商摄影棚背景",
            "lightingAnchor": "柔和自然光",
            "compositionAnchor": "主体清晰并保留信息区",
            "textAreaAnchor": "干净留白构图"
        },
        "items": items,
    })
}
