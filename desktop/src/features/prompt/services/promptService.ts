import { invoke } from "@tauri-apps/api/core";

import type {
  PreviewResolvedPromptRequest,
  PromptBinding,
  ResolvedPrompt,
  SavePromptBindingRequest,
} from "../model/promptTypes";

export async function savePromptBinding(
  binding: SavePromptBindingRequest,
): Promise<PromptBinding> {
  return invoke<PromptBinding>("save_prompt_binding", { binding });
}

export async function previewResolvedPrompt(
  request: PreviewResolvedPromptRequest,
): Promise<ResolvedPrompt> {
  return invoke<ResolvedPrompt>("preview_resolved_prompt", request);
}
