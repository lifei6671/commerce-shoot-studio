import type {
  AiAssistResult,
  ListingCopyAssistInput,
  ProductSellingPointsAssistInput,
  ProductSellingPointsStreamHandlers,
  ViralStyleAnalysisInput,
} from "../types";

export interface AiAssistPort {
  generateProductSellingPoints(input: ProductSellingPointsAssistInput): Promise<AiAssistResult>;
  streamProductSellingPoints?(
    input: ProductSellingPointsAssistInput,
    handlers: ProductSellingPointsStreamHandlers,
  ): Promise<AiAssistResult>;
  generateListingCopy(input: ListingCopyAssistInput): Promise<AiAssistResult>;
  analyzeViralStyle(input: ViralStyleAnalysisInput): Promise<AiAssistResult>;
}
