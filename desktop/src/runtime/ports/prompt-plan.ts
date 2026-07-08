import type { CreatePromptPlanInput, PromptPlan } from "../types";

export interface PromptPlanPort {
  createPlan(input: CreatePromptPlanInput): Promise<PromptPlan>;
}
