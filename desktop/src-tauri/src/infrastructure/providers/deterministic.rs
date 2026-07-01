use crate::services::model_gateway::{
    ModelGatewayAdapter, ModelGatewayAdapterRequest, ModelGatewayAdapterResult, ModelGatewayError,
};

#[derive(Debug, Clone, Copy, Default)]
pub struct DeterministicModelGatewayAdapter;

impl ModelGatewayAdapter for DeterministicModelGatewayAdapter {
    fn invoke(
        &self,
        request: ModelGatewayAdapterRequest<'_>,
    ) -> Result<ModelGatewayAdapterResult, ModelGatewayError> {
        Ok(ModelGatewayAdapterResult {
            output_text: Some(format!("mock output for {}", request.capability_id)),
            output_json: serde_json::json!({
                "mock": true,
                "capabilityId": request.capability_id,
                "inputSummary": request.input_summary,
            }),
            usage_json: Some(serde_json::json!({
                "mock": true,
                "inputSummary": request.input_summary,
                "outputText": true,
            })),
        })
    }
}
