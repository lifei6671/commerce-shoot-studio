import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    "product-selling-points",
    "clothing-scene-planning",
    "viral-style-analysis",
    "scene-image-generation",
    "product-detail-generation",
    "clothing-base-model-generation",
    "clothing-tryon-generation",
    "image-edit",
  ],
  supportedCategories: ["text-to-text", "image-to-text", "text-to-image", "image-to-image"],
};

const openaiProfile: ProviderProfileView = {
  id: "openai",
  baseUrl: "https://api.openai.com",
  customEnabled: false,
  defaultEndpointPath: "/v1/responses",
  displayName: "OpenAI",
  protocol: "openai",
  providerLabel: "OpenAI",
  supportedCapabilities: [
    "listing-copy",
    "prompt-plan",
    "product-selling-points",
    "clothing-scene-planning",
    "viral-style-analysis",
    "scene-image-generation",
    "product-detail-generation",
    "clothing-base-model-generation",
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

function providerSwitchModelConfigPort(): ModelConfigPort {
  return {
    deleteConfig: vi.fn(),
    getConfig: vi.fn(),
    listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
    listProviderProfiles: vi.fn(() =>
      Promise.resolve([deepseekProfile, openaiProfile, mockLocalProfile]),
    ),
    saveConfig: vi.fn(),
    setDefaultConfig: vi.fn(),
    testConfig: vi.fn(),
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

    await waitFor(() => expect(screen.getByText("模型配置加载失败")).toBeInTheDocument());

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

  it("saves image-to-text configuration for clothing scene planning as well", async () => {
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
      listConfigs: vi.fn(() => Promise.resolve([])),
      listProviderProfiles: vi.fn(() => Promise.resolve([mockLocalProfile, openaiProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(savedConfigFromInput(input))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(savedConfigFromInput({
        capabilityId: input.capabilityId,
        displayName: "图生文 默认配置",
        enabled: true,
        executionMode: "auto",
        model: "gpt-5.1",
        providerProfileId: "openai",
      }))),
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

    await user.click(await screen.findByRole("button", { name: "图生文 Provider Mock Local" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.clear(screen.getByRole("textbox", { name: "图生文 模型" }));
    await user.type(screen.getByRole("textbox", { name: "图生文 模型" }), "gpt-5.1");
    await user.type(screen.getByRole("textbox", { name: "图生文 API Key" }), "sk-real-secret");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(screen.getByText("配置已保存")).toBeInTheDocument());
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "product-selling-points",
      providerProfileId: "openai",
    }));
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "clothing-scene-planning",
      providerProfileId: "openai",
    }));
    expect(secretPort.saveSecret).toHaveBeenCalledWith(
      {
        capabilityId: "clothing-scene-planning",
        providerProfileId: "openai",
      },
      "sk-real-secret",
    );
  });

  it("saves text-to-image configuration for clothing base model generation as well", async () => {
    const user = userEvent.setup();
    const textToImageOpenaiProfile: ProviderProfileView = {
      ...openaiProfile,
      supportedCapabilities: ["clothing-base-model-generation"],
      supportedCategories: ["text-to-image"],
    };
    const savedConfigFromInput = (input: SaveLocalModelConfigInput): LocalModelConfigView => ({
      ...deepseekConfig(input.capabilityId),
      id: input.id ?? `cfg_saved_${input.capabilityId}`,
      displayName: input.displayName,
      enabled: input.enabled,
      executionMode: input.executionMode,
      model: input.model,
      providerProfileId: input.providerProfileId,
    });
    const mockTextToImageConfig = (
      capabilityId: "scene-image-generation" | "product-detail-generation",
    ): LocalModelConfigView => ({
      ...deepseekConfig(capabilityId, "available"),
      baseUrl: "mock://local",
      displayName: "Mock 文生图",
      id: `cfg_${capabilityId}`,
      model: "mock-image-v1",
      protocol: "openai-compatible",
      providerLabel: "Mock Local",
      providerProfileId: "mock-local",
      secretStatus: { configured: true, storage: "sqlite-local" },
    });
    const savedOpenaiBaseModelConfig: LocalModelConfigView = {
      ...deepseekConfig("clothing-base-model-generation", "available"),
      baseUrl: textToImageOpenaiProfile.baseUrl,
      displayName: "文生图 默认配置",
      endpointPath: "/v1/images/generations",
      id: "cfg_saved_clothing-base-model-generation",
      model: "gpt-image-1",
      protocol: "openai",
      providerLabel: "OpenAI",
      providerProfileId: "openai",
      secretStatus: { configured: true, storage: "sqlite-local" },
    };
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([
          mockTextToImageConfig("scene-image-generation"),
          mockTextToImageConfig("product-detail-generation"),
          savedOpenaiBaseModelConfig,
        ]),
      listProviderProfiles: vi.fn(() => Promise.resolve([mockLocalProfile, textToImageOpenaiProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(savedConfigFromInput(input))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(savedConfigFromInput({
        capabilityId: input.capabilityId,
        displayName: "文生图 默认配置",
        enabled: true,
        executionMode: "auto",
        model: "gpt-image-1",
        providerProfileId: "openai",
      }))),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(() =>
        Promise.resolve({ configured: false, storage: "sqlite-local" as const }),
      ),
      revealSecret: vi.fn(() => Promise.resolve("sk-saved-openai-secret")),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "文生图 Provider Mock Local" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.clear(screen.getByRole("textbox", { name: "文生图 模型" }));
    await user.type(screen.getByRole("textbox", { name: "文生图 模型" }), "gpt-image-1");
    await user.type(screen.getByRole("textbox", { name: "文生图 API Key" }), "sk-real-secret");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(screen.getByText("配置已保存")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "文生图 Provider OpenAI" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "文生图 模型" })).toHaveValue("gpt-image-1");
    expect(secretPort.getSecretStatus).toHaveBeenCalledWith({
      capabilityId: "clothing-base-model-generation",
      providerProfileId: "openai",
    });
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "clothing-base-model-generation",
      providerProfileId: "openai",
    }));
    expect(modelConfigPort.saveConfig).not.toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "scene-image-generation",
      providerProfileId: "openai",
    }));
    expect(modelConfigPort.saveConfig).not.toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "product-detail-generation",
      providerProfileId: "openai",
    }));
    expect(secretPort.saveSecret).toHaveBeenCalledWith(
      {
        capabilityId: "clothing-base-model-generation",
        providerProfileId: "openai",
      },
      "sk-real-secret",
    );
    await user.click(screen.getByRole("button", { name: "显示文生图 API Key" }));
    expect(await screen.findByDisplayValue("sk-saved-openai-secret")).toBeInTheDocument();
    expect(secretPort.revealSecret).toHaveBeenCalledWith({
      capabilityId: "clothing-base-model-generation",
      providerProfileId: "openai",
    });
  });

  it("exposes OpenAI for image-to-image and saves both runtime capabilities", async () => {
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
      listConfigs: vi.fn(() => Promise.resolve([])),
      listProviderProfiles: vi.fn(() => Promise.resolve([mockLocalProfile, openaiProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(savedConfigFromInput(input))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(savedConfigFromInput({
        capabilityId: input.capabilityId,
        displayName: "默认配置",
        enabled: true,
        executionMode: "auto",
        model: "gpt-image-1.5",
        providerProfileId: "openai",
      }))),
      testConfig: vi.fn(),
    };
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(() => Promise.resolve({ configured: false, storage: "sqlite-local" as const })),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
      </ToastProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "图生图 Provider Mock Local" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(screen.getByText("配置已保存")).toBeInTheDocument());
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "clothing-tryon-generation",
      providerProfileId: "openai",
    }));
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "image-edit",
      providerProfileId: "openai",
    }));
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

  it("restores persisted API key status after switching away and back", async () => {
    const user = userEvent.setup();
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn((scope) =>
        Promise.resolve({
          configured: scope.providerProfileId === "deepseek",
          storage: "sqlite-local" as const,
        }),
      ),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await waitFor(() =>
      expect(secretPort.getSecretStatus).toHaveBeenCalledWith({
        capabilityId: "listing-copy",
        providerProfileId: "openai",
      }),
    );
    expect(apiKeyInput).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "文生文 Provider OpenAI" }));
    await user.click(screen.getByRole("button", { name: "DeepSeek" }));

    await waitFor(() => expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置"));
    expect(secretPort.getSecretStatus).toHaveBeenCalledWith({
      capabilityId: "listing-copy",
      providerProfileId: "deepseek",
    });
    expect(secretPort.revealSecret).not.toHaveBeenCalled();
    expect(secretPort.saveSecret).not.toHaveBeenCalled();
    expect(secretPort.deleteSecret).not.toHaveBeenCalled();
  });

  it("ignores a stale secret status after switching back", async () => {
    const user = userEvent.setup();
    let resolveOpenAiStatus:
      | ((status: { configured: boolean; storage: "sqlite-local" }) => void)
      | undefined;
    const openAiStatus = new Promise<{ configured: boolean; storage: "sqlite-local" }>((resolve) => {
      resolveOpenAiStatus = resolve;
    });
    const getSecretStatus = vi.fn((scope: SecretScope) =>
      scope.providerProfileId === "openai"
        ? openAiStatus
        : Promise.resolve({ configured: true, storage: "sqlite-local" as const }),
    );
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus,
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "文生文 Provider OpenAI" }));
    await user.click(screen.getByRole("button", { name: "DeepSeek" }));

    await waitFor(() => expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置"));
    resolveOpenAiStatus?.({ configured: false, storage: "sqlite-local" });
    await waitFor(() => expect(getSecretStatus).toHaveBeenCalledTimes(2));
    expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置");
  });

  it("keeps a newly entered API key when provider status returns later", async () => {
    const user = userEvent.setup();
    let resolveOpenAiStatus:
      | ((status: { configured: boolean; storage: "sqlite-local" }) => void)
      | undefined;
    const openAiStatus = new Promise<{ configured: boolean; storage: "sqlite-local" }>((resolve) => {
      resolveOpenAiStatus = resolve;
    });
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(() => openAiStatus),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.type(apiKeyInput, "sk-new-provider-key");

    await act(async () => {
      resolveOpenAiStatus?.({ configured: true, storage: "sqlite-local" });
    });

    expect(apiKeyInput).toHaveValue("sk-new-provider-key");
    expect(screen.getByRole("button", { name: "隐藏文生文 API Key" })).toBeInTheDocument();
  });

  it("keeps provider status loading after hiding the API key input", async () => {
    const user = userEvent.setup();
    let resolveOpenAiStatus:
      | ((status: { configured: boolean; storage: "sqlite-local" }) => void)
      | undefined;
    const openAiStatus = new Promise<{ configured: boolean; storage: "sqlite-local" }>((resolve) => {
      resolveOpenAiStatus = resolve;
    });
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(() => openAiStatus),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "隐藏文生文 API Key" }));
    await act(async () => {
      resolveOpenAiStatus?.({ configured: true, storage: "sqlite-local" });
    });

    expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置");
    expect(screen.getByRole("button", { name: "显示文生文 API Key" })).toBeInTheDocument();
  });

  it("ignores a stale revealed secret after switching provider", async () => {
    const user = userEvent.setup();
    let resolveReveal: ((value: string) => void) | undefined;
    const revealSecret = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveReveal = resolve;
        }),
    );
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(() =>
        Promise.resolve({ configured: false, storage: "sqlite-local" as const }),
      ),
      revealSecret,
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "显示文生文 API Key" }));
    await waitFor(() => expect(revealSecret).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await act(async () => {
      resolveReveal?.("sk-old-provider-secret");
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "文生文 API Key" })).not.toHaveValue(
        "sk-old-provider-secret",
      ),
    );
    expect(screen.getByRole("button", { name: "文生文 Provider OpenAI" })).toBeInTheDocument();
  });

  it("ignores a pending revealed secret after restoring mock defaults", async () => {
    const user = userEvent.setup();
    let resolveReveal: ((value: string) => void) | undefined;
    const revealSecret = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveReveal = resolve;
        }),
    );
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(),
      revealSecret,
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "显示文生文 API Key" }));
    await waitFor(() => expect(revealSecret).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    await act(async () => {
      resolveReveal?.("sk-old-provider-secret");
    });

    expect(screen.getByRole("button", { name: "文生文 Provider Mock Local" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "文生文 API Key" })).not.toHaveValue(
      "sk-old-provider-secret",
    );
  });

  it("ignores a pending provider status after canceling local changes", async () => {
    const user = userEvent.setup();
    let resolveOpenAiStatus:
      | ((status: { configured: boolean; storage: "sqlite-local" }) => void)
      | undefined;
    const openAiStatus = new Promise<{ configured: boolean; storage: "sqlite-local" }>((resolve) => {
      resolveOpenAiStatus = resolve;
    });
    const secretPort: SecretPort = {
      deleteSecret: vi.fn(),
      getSecretStatus: vi.fn(() => openAiStatus),
      revealSecret: vi.fn(),
      saveSecret: vi.fn(),
      testProviderConnection: vi.fn(),
    };

    render(
      <ToastProvider>
        <ModelConfigPage modelConfigPort={providerSwitchModelConfigPort()} secretPort={secretPort} />
      </ToastProvider>,
    );

    const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
    await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
    await user.click(screen.getByRole("button", { name: "OpenAI" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置"));
    await act(async () => {
      resolveOpenAiStatus?.({ configured: false, storage: "sqlite-local" });
    });

    expect(screen.getByRole("button", { name: "文生文 Provider DeepSeek" })).toBeInTheDocument();
    expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置");
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

    await waitFor(() => expect(screen.getByText("配置已保存")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
  });

  it("edits and persists the base URL for every capability in the category", async () => {
    const user = userEvent.setup();
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() => Promise.resolve([deepseekConfig("listing-copy"), deepseekConfig("prompt-plan")])),
      listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile])),
      saveConfig: vi.fn((input) => Promise.resolve(deepseekConfig(input.capabilityId))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(deepseekConfig(input.capabilityId))),
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
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://gateway.example/v1");
    await user.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(screen.getByText("配置已保存")).toBeInTheDocument());
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://gateway.example/v1",
      capabilityId: "listing-copy",
    }));
    expect(modelConfigPort.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://gateway.example/v1",
      capabilityId: "prompt-plan",
    }));
  });

  it("keeps Mock Local base URLs read-only", async () => {
    const mockTextConfig = (
      capabilityId: "listing-copy" | "prompt-plan",
    ): LocalModelConfigView => ({
      ...deepseekConfig(capabilityId, "available"),
      baseUrl: "mock://local",
      model: "mock-text-v1",
      providerLabel: "Mock Local",
      providerProfileId: "mock-local",
      secretStatus: { configured: true, storage: "sqlite-local" },
    });
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() =>
        Promise.resolve([
          mockTextConfig("listing-copy"),
          mockTextConfig("prompt-plan"),
        ]),
      ),
      listProviderProfiles: vi.fn(() => Promise.resolve([mockLocalProfile])),
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

    expect(baseUrlInput).toHaveValue("mock://local");
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

  it("tests only one representative image-to-text config after clicking the image-to-text card", async () => {
    const user = userEvent.setup();
    let resolveProviderTest: ((value: { elapsedMs: number; message: string; ok: boolean }) => void) | undefined;
    const providerTest = new Promise<{ elapsedMs: number; message: string; ok: boolean }>((resolve) => {
      resolveProviderTest = resolve;
    });
    const imageToTextConfig = (
      capabilityId: LocalModelConfigView["capabilityId"],
      connectionStatus: LocalModelConfigView["connectionStatus"] = "untested",
    ): LocalModelConfigView => ({
      ...deepseekConfig(capabilityId, connectionStatus),
      baseUrl: openaiProfile.baseUrl,
      displayName: "图生文 默认配置",
      id: `cfg_saved_${capabilityId}`,
      model: "gpt-5.1",
      protocol: "openai",
      providerLabel: "OpenAI",
      providerProfileId: "openai",
    });
    const modelConfigPort: ModelConfigPort = {
      deleteConfig: vi.fn(),
      getConfig: vi.fn(),
      listConfigs: vi.fn(() =>
        Promise.resolve([
          imageToTextConfig("product-selling-points"),
          imageToTextConfig("clothing-scene-planning"),
        ]),
      ),
      listProviderProfiles: vi.fn(() => Promise.resolve([openaiProfile])),
      saveConfig: vi.fn((input: SaveLocalModelConfigInput) => Promise.resolve(imageToTextConfig(input.capabilityId))),
      setDefaultConfig: vi.fn((input) => Promise.resolve(imageToTextConfig(input.capabilityId))),
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

    const imageToTextTitle = await screen.findByRole("heading", { name: "4 图生文" });
    const imageToTextCard = imageToTextTitle.closest("section");
    expect(imageToTextCard).not.toBeNull();

    await user.click(within(imageToTextCard as HTMLElement).getByRole("button", { name: "测试连接" }));

    const testingButton = await within(imageToTextCard as HTMLElement).findByRole("button", { name: "测试中" });
    expect(testingButton).toBeDisabled();
    expect(testingButton).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(modelConfigPort.testConfig).toHaveBeenCalledTimes(1));
    expect(modelConfigPort.testConfig).toHaveBeenCalledWith("cfg_saved_product-selling-points");
    expect(modelConfigPort.testConfig).not.toHaveBeenCalledWith("cfg_saved_clothing-scene-planning");

    resolveProviderTest?.({
      elapsedMs: 12,
      message: "Provider 连接可用。",
      ok: true,
    });

    await waitFor(() => expect(within(imageToTextCard as HTMLElement).getByRole("button", { name: "测试连接" })).toBeEnabled());
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

    await waitFor(() => expect(screen.getByText("API Key 无效或无权限。")).toBeInTheDocument());
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
    expect(screen.getByText("已恢复为 Mock 默认配置，保存后生效")).toBeInTheDocument();
  });
});
