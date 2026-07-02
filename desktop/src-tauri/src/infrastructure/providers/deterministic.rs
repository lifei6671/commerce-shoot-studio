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
            serde_json::json!([
                {
                    "mimeType": "image/png",
                    "dataUrl": TRANSPARENT_PNG_DATA_URL
                }
            ])
        } else {
            serde_json::json!([])
        };

        Ok(ModelGatewayAdapterResult {
            output_text: Some(deterministic_output_text(request.capability_id)),
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

fn deterministic_output_text(capability_id: &str) -> String {
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

    format!("mock output for {capability_id}")
}
