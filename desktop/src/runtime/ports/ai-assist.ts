import type { AiAssistResult, ListingCopyAssistInput, ViralStyleAnalysisInput } from "../types";

export interface AiAssistPort {
  generateListingCopy(input: ListingCopyAssistInput): Promise<AiAssistResult>;
  analyzeViralStyle(input: ViralStyleAnalysisInput): Promise<AiAssistResult>;
}
