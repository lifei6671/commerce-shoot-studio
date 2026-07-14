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
                | "clothing-base-model-generation"
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
                    "reasoning": "适配上班族日常穿搭和平台详情页转化需求。",
                    "designFocus": "突出版型、质感、场景和人群标签。",
                    "globalStyleNote": "柔和侧光，均匀漫射，低饱和氛围，细腻呈现商品质感",
                    "fontStyleDescription": "常规字重无衬线体，规整端正，沉稳商务感",
                    "colors": ["#111827", "#F8FAFC"],
                    "colorDescription": "深黑色（产品主体），浅灰白（大面积背景）",
                    "iconStyle": "细线性简约商务风格"
                },
                {
                    "id": "style-2",
                    "title": "街头潮酷风",
                    "subtitle": "街头点击记忆",
                    "reasoning": "适配年轻用户的社媒种草和高点击视觉需求。",
                    "designFocus": "突出图案、态度表达和社媒种草氛围。",
                    "globalStyleNote": "高对比侧逆光，深色背景，局部高光突出轮廓和视觉冲击",
                    "fontStyleDescription": "稍粗字重无衬线体，利落紧凑，街头潮流感",
                    "colors": ["#0F172A", "#EF4444"],
                    "colorDescription": "深蓝黑（背景和主体压暗），红色（卖点强调）",
                    "iconStyle": "粗线条街头图形风格"
                },
                {
                    "id": "style-3",
                    "title": "简约百搭风",
                    "subtitle": "简约百搭卖点",
                    "reasoning": "适配重视基础款价值和搭配效率的人群。",
                    "designFocus": "突出基础款价值、搭配效率和清爽层级。",
                    "globalStyleNote": "柔化顶侧光，低对比光影，干净留白，克制高级氛围",
                    "fontStyleDescription": "中等字重无衬线体，间距宽松，简约高级感",
                    "colors": ["#111111", "#FFFFFF"],
                    "colorDescription": "黑色（产品主体），白色（大面积背景）",
                    "iconStyle": "极细线性极简风格"
                },
                {
                    "id": "style-4",
                    "title": "细节品质风",
                    "subtitle": "细节品质信任",
                    "reasoning": "适配需要通过细节图提升购买信任的详情页表达。",
                    "designFocus": "突出局部细节、质感纹理和参数化表达。",
                    "globalStyleNote": "微距柔光，局部高光控制，突出纹理、结构和工艺细节",
                    "fontStyleDescription": "常规字重无衬线体，规整清晰，专业说明感",
                    "colors": ["#27272A", "#F4F4F5", "#71717A"],
                    "colorDescription": "炭黑色（主体细节），浅灰白（背景），中性灰（信息强调）",
                    "iconStyle": "细线性参数说明风格"
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

    if capability_id == "clothing-scene-planning" {
        return deterministic_clothing_scene_plan_output().to_string();
    }

    if capability_id == "prompt-plan" {
        return deterministic_prompt_plan_output(input).to_string();
    }

    format!("mock output for {capability_id}")
}

fn deterministic_clothing_scene_plan_output() -> serde_json::Value {
    let scenes = [
        (
            "都市街头",
            "城市核心商圈人行道，午后暖调阳光洒落，背景是轻奢门店招牌，地面为浅灰色水磨石材质",
            "街头时尚摄影，自然光充足照明，色彩还原准确，对焦清晰锐利，8K高清商业电商质感",
        ),
        (
            "通勤咖啡馆",
            "临街咖啡馆外摆座位，早晨柔和侧光，背景有玻璃窗反光与木质桌椅",
            "都市通勤服饰摄影，柔和自然侧光，背景轻微虚化，商业成片质感",
        ),
        (
            "公园步道",
            "城市公园浅色石板步道，初秋绿植和低饱和背景，空气通透明亮",
            "户外生活方式摄影，自然光均匀，服装色彩准确，画面清爽真实",
        ),
        (
            "极简影棚",
            "浅灰无缝背景纸，柔和棚拍布光，地面干净无反光，突出服装轮廓",
            "极简电商棚拍，柔和均匀布光，轮廓清晰，对焦锐利，真实商业质感",
        ),
    ];

    serde_json::json!({
        "scenes": scenes
            .iter()
            .enumerate()
            .map(|(scene_index, (scene, anchor, segment))| {
                serde_json::json!({
                    "scene": scene,
                    "sceneVisualAnchor": anchor,
                    "scenePromptSegment": segment,
                    "recommendedPoses": [
                        {
                            "cameraSetup": {
                                "framing": "全身",
                                "perspective": "正面",
                                "shootingPosition": "平视机位"
                            },
                            "poseAction": format!("站立于{}，双手自然垂在身侧，抬头直视镜头，展示服装正面版型", scene)
                        },
                        {
                            "cameraSetup": {
                                "framing": "四分之三",
                                "perspective": "3/4侧",
                                "shootingPosition": "平视机位"
                            },
                            "poseAction": format!("身体微侧对镜头，一只手插裤袋，另一只手自然放松，展示服装侧面轮廓和垂坠感，动作编号 {}", scene_index + 1)
                        },
                        {
                            "cameraSetup": {
                                "framing": "全身",
                                "perspective": "3/4侧",
                                "shootingPosition": "低机位轻仰拍"
                            },
                            "poseAction": format!("呈自然行走步姿，双臂随步伐轻微摆动，目光看向斜前方，展示服装动态穿着效果")
                        },
                        {
                            "cameraSetup": {
                                "framing": "四分之三",
                                "perspective": "正面",
                                "shootingPosition": "平视近中景"
                            },
                            "poseAction": format!("抬手轻整理衣领或袖口，身体放松站立，表情自然，突出服装领口、肩线和面料细节")
                        }
                    ]
                })
            })
            .collect::<Vec<_>>()
    })
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
    let language = context
        .get("language")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("中文");
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
            language,
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
                    language,
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
    language: &str,
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
            let image_type = format!("{module_title}: {description}");
            let copy_requirements = format!(
                "主标题: \"{module_title}\"\n主标题排版: 位置=画面下方居中；字号=画面高度的 7%-10%；字体=中等偏粗无衬线体；字重=加粗；颜色=与背景强对比；对齐=居中；安全边距=距离边缘至少 8%；最大行数=1 行。\n副标题: \"{description}\"\n副标题排版: 位置=主标题下方；字号=画面高度的 3%-4.5%；字体=常规无衬线体；字重=常规；颜色=弱于主标题；对齐=居中；与主标题间距=主标题高度的 15%-25%；最大行数=1 行。\n结构化信息: 不使用。\n标注标签: 按当前模块策略使用；没有可见锚点时不使用。\n文字生成要求: 主标题、副标题、结构化信息和已启用标注必须作为画面内清晰可读文字生成；禁止乱码、伪文字、额外促销词、虚假参数或虚假认证。\n目标语言: {language}"
            );
            serde_json::json!({
                "index": index + 1,
                "moduleId": module_id,
                "moduleTitle": module_title,
                "targetLanguage": language,
                "image_type": image_type,
                "sceneTitle": description,
                "image_prompt": format!("适配 {ratio} 比例的电商详情页画面，围绕{product_summary}，采用{style_title}表达，用于{module_title}。画面内文字必须严格按照 copy_requirements 生成，主标题、副标题、结构化信息和已启用标注文字必须清晰可读；当前模块目标语言：{language}；禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标。"),
                "copy_requirements": copy_requirements,
                "textOverlay": {
                    "headline": module_title,
                    "subheadline": "",
                    "tags": [],
                },
                "visualConsistency": {
                    "productAnchor": product_summary,
                    "backgroundAnchor": "干净电商摄影棚背景",
                    "lightingAnchor": "柔和自然光",
                    "compositionAnchor": "主体清晰并保留信息区",
                    "textAreaAnchor": "按照 copy_requirements 生成清晰可读画面文字"
                },
                "constraints": [
                    "不得编造商品参数",
                    "不得新增未提供的品牌 Logo",
                    "不得生成价格、销量、认证标识",
                    "图片中文字必须严格按照 copy_requirements 生成",
                    "image_prompt 必须与 copy_requirements 保持一致"
                ],
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "styleId": style_id,
        "styleTitle": style_title,
        "colors": ["#111827", "#F8FAFC"],
        "design_spec": format!("产品与卖点\n产品：{product_summary}。\n卖点：核心卖点 / 使用场景 / 视觉质感\n顾虑：效果不直观 / 质感不稳定 / 信息不可信\n视觉重心：商品主体作为画面第一视觉中心，直观展示核心卖点并降低购买顾虑\n\n视觉定调\n风格：{style_title}，保持清晰电商详情页视觉\n色彩：中性色背景基调，产品保持原色，重点信息使用高对比强调\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：自然柔光，突出商品轮廓与材质"),
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
