import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AiAssistPort,
  AiAssistResult,
  ProductSellingPointsAssistInput,
  ProductSellingPointsStreamHandlers,
  ViralStyleAnalysisInput,
} from "../index";

type AiAssistStreamPayload = {
  requestId?: string;
  eventType?: "delta" | "done" | "error";
  delta?: string;
  text?: string;
  message?: string;
};

export const localAiAssistPort: AiAssistPort = {
  generateProductSellingPoints(input: ProductSellingPointsAssistInput) {
    return invoke<AiAssistResult>("ai_assist_product_selling_points", { input });
  },
  async streamProductSellingPoints(
    input: ProductSellingPointsAssistInput,
    handlers: ProductSellingPointsStreamHandlers,
  ) {
    const requestId = createAiWritingRequestId();
    const eventName = `ai-assist-product-selling-points-${requestId}`;
    let streamedText = "";
    let streamError: Error | undefined;
    const unlisten = await listen<AiAssistStreamPayload>(eventName, (event) => {
      const payload = event.payload;
      if (payload.eventType === "delta" && payload.delta) {
        streamedText += payload.delta;
        handlers.onDelta?.(payload.delta);
      }
      if (payload.eventType === "done" && payload.text) {
        streamedText = payload.text;
      }
      if (payload.eventType === "error" && payload.message) {
        streamError = new Error(payload.message);
      }
    });

    try {
      const result = await invoke<AiAssistResult>("ai_assist_product_selling_points_stream", {
        input: {
          ...input,
          requestId,
        },
      });
      if (streamError) {
        throw streamError;
      }
      return {
        ...result,
        text: result.text?.trim() ? result.text : streamedText,
      };
    } finally {
      unlisten();
    }
  },
  generateListingCopy() {
    return Promise.reject(new Error("generateListingCopy 尚未接入本地 runtime。"));
  },
  analyzeViralStyle(input: ViralStyleAnalysisInput) {
    return invoke<AiAssistResult>("ai_assist_viral_style_analysis", { input });
  },
};

function createAiWritingRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ai-writing-${crypto.randomUUID()}`;
  }
  return `ai-writing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
