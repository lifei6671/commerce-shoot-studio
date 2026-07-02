export type ListingCopyAssistInput = {
  productSummary: string;
  styleHints?: string[];
};

export type ViralStyleAnalysisInput = {
  assetIds: string[];
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
