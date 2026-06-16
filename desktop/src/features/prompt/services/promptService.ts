import { invoke } from "@tauri-apps/api/core";

import type {
  PreviewResolvedPromptRequest,
  PromptBinding,
  PromptPreset,
  PromptPresetScenario,
  PromptTemplate,
  ResolvedPrompt,
  SavePromptBindingRequest,
  SavePromptPresetRequest,
  SavePromptPresetScenarioRequest,
  SavePromptTemplateRequest,
} from "../model/promptTypes";

export async function savePromptBinding(
  binding: SavePromptBindingRequest,
): Promise<PromptBinding> {
  return invoke<PromptBinding>("save_prompt_binding", { binding });
}

export async function getPromptBinding(
  combinationId: string,
): Promise<PromptBinding | null> {
  return invoke<PromptBinding | null>("get_prompt_binding", { combinationId });
}

export async function previewResolvedPrompt(
  request: PreviewResolvedPromptRequest,
): Promise<ResolvedPrompt> {
  return invoke<ResolvedPrompt>("preview_resolved_prompt", request);
}

export async function listPromptTemplates(): Promise<PromptTemplate[]> {
  return invoke<PromptTemplate[]>("list_prompt_templates");
}

export async function listPromptPresets(): Promise<PromptPreset[]> {
  return invoke<PromptPreset[]>("list_prompt_presets");
}

export async function savePromptPreset(
  preset: SavePromptPresetRequest,
): Promise<PromptPreset> {
  return invoke<PromptPreset>("save_prompt_preset", { preset });
}

export async function listPromptPresetScenarios(): Promise<PromptPresetScenario[]> {
  return invoke<PromptPresetScenario[]>("list_prompt_preset_scenarios");
}

export async function savePromptPresetScenario(
  scenario: SavePromptPresetScenarioRequest,
): Promise<PromptPresetScenario> {
  return invoke<PromptPresetScenario>("save_prompt_preset_scenario", { scenario });
}

export async function savePromptTemplate(
  template: SavePromptTemplateRequest,
): Promise<PromptTemplate> {
  return invoke<PromptTemplate>("save_prompt_template", { template });
}

export async function deletePromptTemplate(id: string): Promise<void> {
  return invoke<void>("delete_prompt_template", { id });
}

export async function restoreDefaultPromptTemplates(): Promise<PromptTemplate[]> {
  return invoke<PromptTemplate[]>("restore_default_prompt_templates");
}
