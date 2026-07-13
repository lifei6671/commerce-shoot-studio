import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ImageTextRecognitionError } from "../types/ai-assist";
import type {
  AiAssistPort,
  AiAssistResult,
  ImageTextRecognitionResult,
  ProductSellingPointsAssistInput,
  ProductSellingPointsStreamHandlers,
  RecognizeImageTextInput,
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
  async recognizeImageText(input: RecognizeImageTextInput) {
    try {
      return await invoke<ImageTextRecognitionResult>("ai_assist_recognize_image_text", { input });
    } catch (error) {
      throw normalizeImageTextRecognitionError(error);
    }
  },
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

function normalizeImageTextRecognitionError(error: unknown) {
  if (error instanceof ImageTextRecognitionError) {
    return error;
  }
  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : undefined;
    const message = typeof error.message === "string" ? error.message : undefined;
    const retryable = typeof error.retryable === "boolean" ? error.retryable : undefined;
    if (code && message && retryable !== undefined) {
      return new ImageTextRecognitionError({ code, message, retryable });
    }
  }
  return new ImageTextRecognitionError({
    code: "IMAGE_TEXT_RECOGNITION_FAILED",
    message: "文字识别失败，请重试。",
    retryable: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createAiWritingRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ai-writing-${crypto.randomUUID()}`;
  }
  return `ai-writing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
