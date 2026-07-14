import type {
  AiAssistResult,
  ImageTextRecognitionResult,
  ListingCopyAssistInput,
  ProductSellingPointsAssistInput,
  ProductSellingPointsStreamHandlers,
  RecognizeImageTextInput,
  ViralStyleAnalysisInput,
} from "../types";

export interface AiAssistPort {
  recognizeImageText(input: RecognizeImageTextInput): Promise<ImageTextRecognitionResult>;
  generateProductSellingPoints(input: ProductSellingPointsAssistInput): Promise<AiAssistResult>;
  streamProductSellingPoints?(
    input: ProductSellingPointsAssistInput,
    handlers: ProductSellingPointsStreamHandlers,
  ): Promise<AiAssistResult>;
  generateListingCopy(input: ListingCopyAssistInput): Promise<AiAssistResult>;
  analyzeViralStyle(input: ViralStyleAnalysisInput): Promise<AiAssistResult>;
}
