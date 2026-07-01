export type ListingCopyAssistInput = {
  productSummary: string;
  styleHints?: string[];
};

export type ViralStyleAnalysisInput = {
  assetIds: string[];
};

export type AiAssistResult = {
  text?: string;
  data?: unknown;
};
