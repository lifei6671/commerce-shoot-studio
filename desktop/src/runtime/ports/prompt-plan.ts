import type { CreatePromptPlanInput, PromptPlan, UpdatePromptPlanInput } from "../types";

export interface PromptPlanPort {
  createPlan(input: CreatePromptPlanInput): Promise<PromptPlan>;
  getPlan(planId: string): Promise<PromptPlan>;
  updatePlan(input: UpdatePromptPlanInput): Promise<PromptPlan>;
  confirmPlan(planId: string): Promise<PromptPlan>;
}
