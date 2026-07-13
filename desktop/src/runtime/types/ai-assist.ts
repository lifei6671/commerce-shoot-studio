export type ListingCopyAssistInput = {
  productSummary: string;
  styleHints?: string[];
};

export type ViralStyleAnalysisInput = {
  platform: string;
  productSellingPoints: string;
};

export type ProductSellingPointsAssistInput = {
  imagePaths: string[];
  images?: ProductSellingPointsAssistImageInput[];
};

export type ProductSellingPointsAssistImageInput = {
  originalName?: string;
  mimeType?: string;
  dataUrl?: string;
  path?: string;
};

export type ProductSellingPointsStreamHandlers = {
  onDelta?: (delta: string) => void;
};

export type AiAssistResult = {
  capabilityId?: string;
  promptId?: string;
  promptVersion?: string;
  text?: string;
  data?: unknown;
};

export type RecognizeImageTextInput = {
  assetId: string;
};

export type ImageTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RecognizedImageTextItem = {
  id: string;
  text: string;
  box: ImageTextBox;
};

export type ImageTextRecognitionResult = {
  items: RecognizedImageTextItem[];
};

export type ImageTextRecognitionErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
};

export class ImageTextRecognitionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(payload: ImageTextRecognitionErrorPayload) {
    super(payload.message);
    this.name = "ImageTextRecognitionError";
    this.code = payload.code;
    this.retryable = payload.retryable;
  }
}
