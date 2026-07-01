import type {
  AiAssistPort,
  AssetPort,
  CapabilityPort,
  GenerationPort,
  ModelConfigPort,
  PromptPlanPort,
  RuntimeInfoPort,
  SecretPort,
  SettingsPort,
  ShellPort,
  WorkspacePort,
} from "./ports";

// RuntimeClient 是前端唯一入口。页面只能依赖这些 public ports，
// 不能直接依赖 Tauri、SQLite、Provider SDK 或未来 SaaS HTTP 细节。
export type RuntimeClient = {
  workspace: WorkspacePort;
  settings: SettingsPort;
  shell: ShellPort;
  runtimeInfo: RuntimeInfoPort;
  assets: AssetPort;
  generation: GenerationPort;
  promptPlans: PromptPlanPort;
  capabilities: CapabilityPort;
  modelConfig: ModelConfigPort;
  secrets: SecretPort;
  aiAssist: AiAssistPort;
};
