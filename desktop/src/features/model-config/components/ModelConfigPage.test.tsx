import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  LocalModelConfigView,
  ModelConfigPort,
  ProviderProfileView,
  SaveLocalModelConfigInput,
  SecretPort,
  SecretScope,
} from "../../../runtime";
import { ToastProvider } from "../../../shared/ui/toast";
import { ModelConfigPage } from "./ModelConfigPage";

const deepseekProfile: ProviderProfileView = {
  id: "deepseek",
  baseUrl: "https://api.deepseek.com",
  customEnabled: false,
  defaultEndpointPath: "/chat/completions",
  displayName: "DeepSeek",
  protocol: "openai-compatible",
  providerLabel: "DeepSeek",
  supportedCapabilities: ["listing-copy", "prompt-plan"],
  supportedCategories: ["text-to-text"],
};

const mockLocalProfile: ProviderProfileView = {
  id: "mock-local",
  baseUrl: "mock://local",
  customEnabled: false,
  defaultEndpointPath: undefined,
  displayName: "Mock Local",
  protocol: "openai-compatible",
  providerLabel: "Mock Local",
  supportedCapabilities: [
    "listing-copy",
    "prompt-plan",
    "viral-style-analysis",
    "scene-image-generation",
    "product-detail-generation",
    "clothing-tryon-generation",
    "image-edit",
  ],
  supportedCategories: ["text-to-text", "image-to-text", "text-to-image", "image-to-image"],
};

const openaiProfile: ProviderProfileView = {
  id: "openai",
  baseUrl: "https://api.openai.com/v1",
  customEnabled: false,
  defaultEndpointPath: "/responses",
  displayName: "OpenAI",
  protocol: "openai",
  providerLabel: "OpenAI",
  supportedCapabilities: [
    "listing-copy",
    "prompt-plan",
    "viral-style-analysis",
    "scene-image-generation",
    "product-detail-generation",
    "clothing-tryon-generation",
    "image-edit",
  ],
  supportedCategories: ["text-to-text", "image-to-text", "text-to-image", "image-to-image"],
};

function deepseekConfig(
  capabilityId: LocalModelConfigView["capabilityId"],
  connectionStatus: LocalModelConfigView["connectionStatus"] = "unavailable",
): LocalModelConfigView {
  return {
    id: `cfg_${capabilityId}`,
    baseUrl: "https://api.deepseek.com",
    capabilityId,
    connectionStatus,
    displayName: "DeepSeek 文案",
    enabled: true,
    executionMode: "auto",
    isDefault: true,
    model: "deepseek-v4-pro",
    protocol: "openai-compatible",
    providerLabel: "DeepSeek",
    providerProfileId: "deepseek",
    secretStatus: {
      configured: true,
      storage: "sqlite-local",
    },
  };
}

describe("ModelConfigPage", () => {
  it("does not show static demo configs when runtime config loading fails", async () => {
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.reject(new Error("runtime unavailable"))),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile, openaiProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("模型配置加载失败"));

    expect(screen.queryByDisplayValue("sk-demo-text-1234")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("sk-demo-image-5678")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("ak-demo-edit-90ab")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("ak-demo-vision-de34")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存配置" })).toBeDisabled();
  });

  it("reveals saved API key on demand and removes the leading status dot", async () => {
    const user = userEvent.setup();
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile, openaiProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn((_scope: SecretScope) => Promise.resolve("sk-real-secret")),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await waitFor(() => expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置"));

    const apiKeyContainer = apiKeyInput.parentElement;
    expect(apiKeyContainer).not.toBeNull();
    expect(apiKeyContainer?.querySelector("span")).toBeNull();

    await user.click(screen.getByRole("button", { name: "显示文生文 API Key" }));

    expect(await screen.findByDisplayValue("sk-real-secret")).toBeInTheDocument();
    expect(secretPort.revealSecret).toHaveBeenCalledWith({
      capabilityId: "listing-copy",
      providerProfileId: "deepseek",
    });
    expect(within(apiKeyContainer as HTMLElement).queryByText("sk-••••••••••••••••••••••••已配置")).not.toBeInTheDocument();
  });

  it("deletes stored API keys when a configured key is intentionally cleared", async () => {
    const user = userEvent.setup();
    const savedConfigFromInput = (input: SaveLocalModelConfigInput): LocalModelConfigView => ({
      ...deepseekConfig(input.capabilityId),
      id: input.id ?? `cfg_saved_${input.capabilityId}`,
      displayName: input.displayName,
      enabled: input.enabled,
      executionMode: input.executionMode,
      model: input.model,
      providerProfileId: input.providerProfileId,
    });
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(savedConfigFromInput(input))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(deepseekConfig(input.capabilityId))),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(() => Promise.resolve()),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    vi.mocked(secretPort.revealSecret).mockResolvedValue("sk-real-secret");
    await user.click(screen.getByRole("button", { name: "显示文生文 API Key" }));
    await user.clear(apiKeyInput);
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() =>
      expect(secretPort.deleteSecret).toHaveBeenCalledWith({
        capabilityId: "listing-copy",
        providerProfileId: "deepseek",
      }),
    );
    expect(secretPort.deleteSecret).toHaveBeenCalledWith({
      capabilityId: "prompt-plan",
      providerProfileId: "deepseek",
    });
    expect(secretPort.saveSecret).not.toHaveBeenCalled();
  });

  it("opens API key input for editing after switching to an unconfigured provider", async () => {
    const user = userEvent.setup();
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile, openaiProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await waitFor(() => expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置"));

    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));

    expect(screen.getByRole("button", { name: "隐藏文生文 API Key" })).toBeInTheDocument();
    expect(apiKeyInput).not.toHaveAttribute("readonly");

    await user.type(apiKeyInput, "sk-new-provider-key");

    expect(apiKeyInput).toHaveValue("sk-new-provider-key");
  });

  it("shows saving transition and toast when saving configs", async () => {
    const user = userEvent.setup();
    let resolveFirstSave: ((value: LocalModelConfigView) => void) | undefined;
    let firstSavePending = true;
    const firstSave = new Promise<LocalModelConfigView>((resolve) => {
      resolveFirstSave = resolve;
    });
    const savedConfigFromInput = (input: SaveLocalModelConfigInput): LocalModelConfigView => ({
      ...deepseekConfig(input.capabilityId),
      id: input.id ?? `cfg_saved_${input.capabilityId}`,
      displayName: input.displayName,
      enabled: input.enabled,
      executionMode: input.executionMode,
      model: input.model,
      providerProfileId: input.providerProfileId,
    });
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => {
        const savedConfig = savedConfigFromInput(input);
        if (firstSavePending) {
          firstSavePending = false;
          return firstSave.then(() => savedConfig);
        }
        return Promise.resolve(savedConfig);
      }),
      setDefaultConfig: vi.fn((_input) => Promise.resolve(deepseekConfig("listing-copy"))),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );
    const saveButton = screen.getByRole("button", { name: "保存配置" });

    await user.click(saveButton);

    expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存中" })).toHaveAttribute("aria-busy", "true");

    resolveFirstSave?.(deepseekConfig("listing-copy"));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("配置已保存"));
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
  });

  it("keeps provider base URL read-only because the runtime contract owns provider endpoints", async () => {
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    const baseUrlInput = await screen.findByRole("textbox", { name: "文生文 Base URL" });

    expect(baseUrlInput).toHaveValue("https://api.deepseek.com");
    expect(baseUrlInput).toHaveAttribute("readonly");
  });

  it("preserves untested connection status instead of showing it as unavailable", async () => {
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy", "untested"), deepseekConfig("prompt-plan", "untested")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    await waitFor(() => expect(screen.getAllByTestId("model-status-badge")[0]).toHaveTextContent("未测试"));
  });

  it("shows connection testing transition before invoking provider test and prevents duplicate clicks", async () => {
    const user = userEvent.setup();
    let resolveProviderTest: ((value: { elapsedMs: number; message: string; ok: boolean }) => void) | undefined;
    const providerTest = new Promise<{ elapsedMs: number; message: string; ok: boolean }>((resolve) => {
      resolveProviderTest = resolve;
    });
    const savedConfigFromInput = (input: SaveLocalModelConfigInput): LocalModelConfigView => ({
      ...deepseekConfig(input.capabilityId),
      id: input.id ?? `cfg_saved_${input.capabilityId}`,
      displayName: input.displayName,
      enabled: input.enabled,
      executionMode: input.executionMode,
      model: input.model,
      providerProfileId: input.providerProfileId,
    });
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(savedConfigFromInput(input))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(deepseekConfig(input.capabilityId))),
      testConfig: vi.fn(() => providerTest),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    const testButton = (await screen.findAllByRole("button", { name: "测试连接" }))[0];
    await user.click(testButton);

    const testingButton = await screen.findByRole("button", { name: "测试中" });
    expect(testingButton).toBeDisabled();
    expect(testingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "文生文 Provider DeepSeek" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "文生文 模型" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "展开文生文 模型选项" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "文生文 Base URL" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "文生文 API Key" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "显示文生文 API Key" })).toBeDisabled();
    await waitFor(() => expect(modelConfigPort.testConfig).toHaveBeenCalledTimes(1));

    await user.click(testingButton);
    expect(modelConfigPort.testConfig).toHaveBeenCalledTimes(1);

    resolveProviderTest?.({
      elapsedMs: 12,
      message: "Provider 连接可用。",
      ok: true,
    });

    await waitFor(() => expect(screen.getAllByRole("button", { name: "测试连接" })[0]).toBeEnabled());
    expect(modelConfigPort.testConfig).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast when provider test fails", async () => {
    const user = userEvent.setup();
    const savedConfigFromInput = (input: SaveLocalModelConfigInput): LocalModelConfigView => ({
      ...deepseekConfig(input.capabilityId),
      id: input.id ?? `cfg_saved_${input.capabilityId}`,
      displayName: input.displayName,
      enabled: input.enabled,
      executionMode: input.executionMode,
      model: input.model,
      providerProfileId: input.providerProfileId,
    });
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(savedConfigFromInput(input))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(deepseekConfig(input.capabilityId))),
      testConfig: vi.fn(() =>
        Promise.resolve({
          elapsedMs: 10,
          message: "API Key 无效或无权限。",
          ok: false,
        }),
      ),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    const testButton = (await screen.findAllByRole("button", { name: "测试连接" }))[0];
    await user.click(testButton);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("API Key 无效或无权限。"));
  });

  it("reloads saved runtime configs when canceling local edits", async () => {
    const user = userEvent.setup();
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile, mockLocalProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    await screen.findByDisplayValue("deepseek-v4-pro");
    await user.clear(screen.getByRole("textbox", { name: "文生文 模型" }));
    await user.type(screen.getByRole("textbox", { name: "文生文 模型" }), "local-edit");

    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.getByDisplayValue("deepseek-v4-pro")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("local-edit")).not.toBeInTheDocument();
    expect(modelConfigPort.saveConfig).not.toHaveBeenCalled();
  });

  it("restores editable cards to mock local defaults without saving immediately", async () => {
    const user = userEvent.setup();
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile, mockLocalProfile])),
      saveConfig: vi.fn(),
      setDefaultConfig: vi.fn(),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    await screen.findByDisplayValue("deepseek-v4-pro");
    await user.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(screen.getByRole("button", { name: "文生文 Provider Mock Local" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("mock-listing-copy-v1")).toBeInTheDocument();
    expect(modelConfigPort.saveConfig).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("已恢复为 Mock 默认配置，保存后生效");
  });
});
