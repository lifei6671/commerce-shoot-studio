import { invoke } from "@tauri-apps/api/core";
import type { CreatePromptPlanInput, PromptPlan, PromptPlanPort } from "../index";

export const localPromptPlanPort: PromptPlanPort = {
  createPlan(input: CreatePromptPlanInput) {
    return invoke<PromptPlan>("prompt_plan_create", { input });
  },
};
