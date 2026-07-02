use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::ai_assist::{
    AiAssistResult, AiAssistService, ProductSellingPointsImageInput, ProductSellingPointsInput,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn ai_assist_product_selling_points(
    input: ProductSellingPointsInput,
) -> Result<AiAssistResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        AiAssistService::new()
            .generate_product_selling_points(&default_workspace_directory(), input)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("AI 帮写任务执行失败：{error}"))?
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSellingPointsStreamInput {
    #[serde(default)]
    pub image_paths: Vec<String>,
    #[serde(default)]
    pub images: Vec<ProductSellingPointsImageInput>,
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiAssistStreamPayload {
    request_id: String,
    event_type: String,
    delta: Option<String>,
    text: Option<String>,
    message: Option<String>,
}

#[tauri::command]
pub async fn ai_assist_product_selling_points_stream(
    app: AppHandle,
    input: ProductSellingPointsStreamInput,
) -> Result<AiAssistResult, String> {
    let request_id = input.request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("AI 帮写流式请求缺少 requestId。".to_string());
    }
    let event_name = ai_assist_stream_event_name(&request_id);
    let callback_event_name = event_name.clone();
    let callback_request_id = request_id.clone();
    let image_paths = input.image_paths;
    let images = input.images;
    let stream_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        AiAssistService::new().generate_product_selling_points_stream(
            &default_workspace_directory(),
            ProductSellingPointsInput {
                image_paths,
                images,
            },
            |delta| {
                stream_app
                    .emit(
                        &callback_event_name,
                        AiAssistStreamPayload {
                            request_id: callback_request_id.clone(),
                            event_type: "delta".to_string(),
                            delta: Some(delta.to_string()),
                            text: None,
                            message: None,
                        },
                    )
                    .map_err(|error| {
                        crate::services::ai_assist::AiAssistError::Model(format!(
                            "AI 帮写流式事件发送失败：{error}"
                        ))
                    })
            },
        )
    })
    .await
    .map_err(|error| format!("AI 帮写流式任务执行失败：{error}"))?
    .map_err(|error| error.to_string());

    match result {
        Ok(result) => {
            app.emit(
                &event_name,
                AiAssistStreamPayload {
                    request_id,
                    event_type: "done".to_string(),
                    delta: None,
                    text: Some(result.text.clone()),
                    message: None,
                },
            )
            .map_err(|error| format!("AI 帮写流式事件发送失败：{error}"))?;
            Ok(result)
        }
        Err(message) => {
            let _ = app.emit(
                &event_name,
                AiAssistStreamPayload {
                    request_id,
                    event_type: "error".to_string(),
                    delta: None,
                    text: None,
                    message: Some(message.clone()),
                },
            );
            Err(message)
        }
    }
}

pub fn ai_assist_stream_event_name(request_id: &str) -> String {
    format!("ai-assist-product-selling-points-{request_id}")
}
