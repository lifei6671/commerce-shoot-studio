import { Activity, Check, ChevronDown, Eye, EyeOff, FileText, HelpCircle, Image, Images, MessageSquareText, RotateCcw, Save } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { localModelConfigPort } from "../../../runtime/local/model-config";
import { localSecretPort } from "../../../runtime/local/secrets";
import type {
  LocalModelConfigView,
  ModelCapability,
  ModelConfigPort,
  ProviderProfileView,
  SecretPort,
} from "../../../runtime";
import { Button } from "../../../shared/ui/button";
import { cn } from "../../../shared/lib/cn";
import { SelectPill } from "../../../shared/ui/select-pill";
import { useToast } from "../../../shared/ui/toast";

type ModelCategoryId = "image-to-image" | "image-to-text" | "text-to-image" | "text-to-text";
type ModelCatalogCategory = "imageToImage" | "imageToText" | "textToImage" | "textToText";
type ModelProviderId = "deepseek" | "mock-local" | "openai" | "volcengine";

type ModelConfig = {
  apiKey: string;
  apiKeyConfigured?: boolean;
  apiKeyDirty?: boolean;
  apiKeyRevealed?: boolean;
  baseUrl: string;
  configIds?: Partial<Record<ModelCapability["id"], string>>;
  connectionStatus?: LocalModelConfigView["connectionStatus"] | "testing";
  description: string;
  endpointPath?: string;
  iconTone: "blue" | "cyan" | "orange" | "violet";
  id: ModelCategoryId;
  index: number;
  model: string;
  provider: ModelProviderId;
  title: string;
};

type ModelCategoryDescriptor = Pick<ModelConfig, "description" | "iconTone" | "id" | "index" | "title">;

export const modelCatalog = {
  "mock-local": {
    textToText: ["mock-listing-copy-v1", "mock-prompt-plan-v1"],
    imageToText: ["mock-viral-style-v1"],
    textToImage: ["mock-scene-image-v1", "mock-product-detail-v1"],
    imageToImage: ["mock-clothing-tryon-v1", "mock-image-edit-v1"],
  },
  openai: {
    textToText: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano"],
    imageToText: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano"],
    textToImage: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
    imageToImage: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
  },
  volcengine: {
    textToText: [
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-1-turbo-260628",
      "doubao-seed-2-0-lite-260428",
      "doubao-seed-2-0-mini-260428",
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-0-lite-260215",
    ],
    imageToText: [
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-0-lite-260428",
      "doubao-seed-2-0-mini-260428",
      "doubao-seed-1-8-251228",
    ],
    textToImage: [
      "doubao-seedream-5-0-260128",
      "doubao-seedream-5-0-lite-260128",
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-0-250828",
    ],
    imageToImage: [
      "doubao-seedream-5-0-260128",
      "doubao-seedream-5-0-lite-260128",
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-0-250828",
    ],
  },
  deepseek: {
    textToText: ["deepseek-v4-flash", "deepseek-v4-pro"],
    imageToText: [],
    textToImage: [],
    imageToImage: [],
  },
} satisfies Record<ModelProviderId, Record<ModelCatalogCategory, string[]>>;

const providerOptions = [
  { label: "Mock Local", value: "mock-local" },
  { label: "OpenAI", value: "openai" },
  { label: "火山引擎", value: "volcengine" },
  { label: "DeepSeek", value: "deepseek" },
] satisfies Array<{ label: string; value: ModelProviderId }>;

const categoryCatalogKeys = {
  "image-to-image": "imageToImage",
  "image-to-text": "imageToText",
  "text-to-image": "textToImage",
  "text-to-text": "textToText",
} satisfies Record<ModelCategoryId, ModelCatalogCategory>;

const categoryCapabilityIds = {
  "image-to-image": ["clothing-tryon-generation", "image-edit"],
  "image-to-text": ["viral-style-analysis"],
  "text-to-image": ["scene-image-generation", "product-detail-generation"],
  "text-to-text": ["listing-copy", "prompt-plan"],
} satisfies Record<ModelCategoryId, ModelCapability["id"][]>;

const modelCategoryDescriptors: ModelCategoryDescriptor[] = [
  {
    description: "用于提示词优化与文案生成，提升商品文案质量。",
    iconTone: "violet",
    id: "text-to-text",
    index: 1,
    title: "文生文",
  },
  {
    description: "用于生成主图/场景图，支持高质量商品图生成。",
    iconTone: "orange",
    id: "text-to-image",
    index: 2,
    title: "文生图",
  },
  {
    description: "用于编辑、扩图、重绘，支持精修与风格转换。",
    iconTone: "blue",
    id: "image-to-image",
    index: 3,
    title: "图生图",
  },
  {
    description: "用于图片理解与反推，提取要点与生成描述。",
    iconTone: "cyan",
    id: "image-to-text",
    index: 4,
    title: "图生文",
  },
];

const categoryIcons = {
  "image-to-image": Image,
  "image-to-text": FileText,
  "text-to-image": Images,
  "text-to-text": MessageSquareText,
} satisfies Record<ModelCategoryId, typeof MessageSquareText>;

const iconToneClasses = {
  blue: "bg-blue-50 text-blue-600",
  cyan: "bg-cyan-50 text-cyan-600",
  orange: "bg-orange-50 text-orange-500",
  violet: "bg-violet-50 text-violet-600",
};

type ModelConfigPageProps = {
  modelConfigPort?: ModelConfigPort;
  secretPort?: SecretPort;
};

export function ModelConfigPage({
  modelConfigPort = localModelConfigPort,
  secretPort = localSecretPort,
}: ModelConfigPageProps = {}) {
  const { showToast } = useToast();
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [providerProfiles, setProviderProfiles] = useState<Record<string, ProviderProfileView>>({});
  const [savingConfigs, setSavingConfigs] = useState(false);
  const [testMessages, setTestMessages] = useState<Partial<Record<ModelCategoryId, string>>>({});
  const savingConfigsRef = useRef(false);
  const [testingConfigIds, setTestingConfigIds] = useState<Set<ModelCategoryId>>(() => new Set());
  const testingConfigIdsRef = useRef<Set<ModelCategoryId>>(new Set());
  const [visibleApiKeyIds, setVisibleApiKeyIds] = useState<Set<ModelCategoryId>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    void reloadRuntimeConfigs({
      onLoaded: () => {
        if (!cancelled) {
          setConfigsLoaded(true);
        }
      },
      shouldApply: () => !cancelled,
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [modelConfigPort]);

  function updateConfig(id: ModelCategoryId, patch: Partial<ModelConfig>) {
    if (patch.provider) {
      setVisibleApiKeyIds((currentIds) => {
        const nextIds = new Set(currentIds);
        if (patch.provider === "mock-local") {
          nextIds.delete(id);
        } else if (patch.apiKeyConfigured === false && !patch.apiKey) {
          nextIds.add(id);
        }
        return nextIds;
      });
    }

    setConfigs((currentConfigs) =>
      currentConfigs.map((config) => (config.id === id ? { ...config, ...patch } : config)),
    );
  }

  async function toggleApiKeyVisibility(id: ModelCategoryId) {
    const nextVisible = !visibleApiKeyIds.has(id);
    const config = configs.find((item) => item.id === id);

    if (nextVisible && config?.apiKeyConfigured && !config.apiKey && config.provider !== "mock-local") {
      try {
        const value = await secretPort.revealSecret({
          providerProfileId: config.provider,
          capabilityId: categoryCapabilityIds[id][0],
        });
        updateConfig(id, { apiKey: value, apiKeyRevealed: true });
      } catch {
        // 明文读取失败时仍展开输入框，用户可以直接重新输入。
      }
    }

    setVisibleApiKeyIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (!nextVisible) {
        nextIds.delete(id);
      } else {
        nextIds.add(id);
      }
      return nextIds;
    });
  }

  async function persistConfig(config: ModelConfig) {
    const savedConfigs: LocalModelConfigView[] = [];

    for (const capabilityId of categoryCapabilityIds[config.id]) {
      const savedConfig = await modelConfigPort.saveConfig({
        id: config.configIds?.[capabilityId],
        capabilityId,
        providerProfileId: config.provider,
        displayName: `${config.title} 默认配置`,
        executionMode: "auto",
        model: config.model,
        endpointPath: config.endpointPath || providerProfiles[config.provider]?.defaultEndpointPath,
        enabled: true,
      });

      if (config.provider !== "mock-local" && config.apiKeyDirty) {
        const scope = {
          providerProfileId: config.provider,
          capabilityId,
        };

        if (isPlainApiKey(config.apiKey)) {
          await secretPort.saveSecret(scope, config.apiKey.trim());
        } else if (config.apiKey.trim().length === 0) {
          await secretPort.deleteSecret(scope);
        }
      }

      savedConfigs.push(await modelConfigPort.setDefaultConfig({ capabilityId, configId: savedConfig.id }));
    }

    return savedConfigs;
  }

  async function reloadRuntimeConfigs(options?: { onLoaded?: () => void; shouldApply?: () => boolean }) {
    try {
      const [profiles, runtimeConfigs] = await Promise.all([
        modelConfigPort.listProviderProfiles(),
        modelConfigPort.listConfigs(),
      ]);

      if (options?.shouldApply && !options.shouldApply()) {
        return;
      }

      setProviderProfiles(indexProfiles(profiles));
      setConfigs(mergeRuntimeConfigs(modelCategoryDescriptors, runtimeConfigs, profiles));
      setVisibleApiKeyIds(new Set());
      options?.onLoaded?.();
    } catch (error) {
      if (!options?.shouldApply || options.shouldApply()) {
        setConfigs([]);
        options?.onLoaded?.();
        showToast({ message: "模型配置加载失败", variant: "error" });
      }

      throw error;
    }
  }

  async function saveAllConfigs() {
    if (savingConfigsRef.current) {
      return;
    }

    savingConfigsRef.current = true;
    setSavingConfigs(true);

    try {
      for (const config of configs) {
        await persistConfig(config);
      }

      await reloadRuntimeConfigs();
      showToast({ message: "配置已保存", variant: "success" });
    } catch {
      showToast({ message: "保存失败，请重试", variant: "error" });
    } finally {
      savingConfigsRef.current = false;
      setSavingConfigs(false);
    }
  }

  async function cancelLocalChanges() {
    try {
      await reloadRuntimeConfigs();
      showToast({ message: "已恢复到已保存配置", variant: "success" });
    } catch {
      showToast({ message: "重新加载配置失败", variant: "error" });
    }
  }

  function restoreMockDefaults() {
    setConfigs(createMockDefaultConfigs(providerProfiles));
    setVisibleApiKeyIds(new Set());
    showToast({ message: "已恢复为 Mock 默认配置，保存后生效", variant: "warning" });
  }

  async function testConfigConnection(id: ModelCategoryId) {
    if (testingConfigIdsRef.current.has(id)) {
      return;
    }

    const config = configs.find((item) => item.id === id);
    if (!config) {
      return;
    }

    testingConfigIdsRef.current.add(id);
    setTestingConfigIds((currentIds) => new Set(currentIds).add(id));
    updateConfig(id, { connectionStatus: "testing" });

    try {
      await waitForNextPaint();
      const savedConfigs = await persistConfig(config);
      const savedConfig = savedConfigs[0];
      if (!savedConfig) {
        throw new Error("模型配置保存失败，无法测试连接。");
      }
      const result = await modelConfigPort.testConfig(savedConfig.id);
      setTestMessages((currentMessages) => ({
        ...currentMessages,
        [id]: result.message ?? (result.ok ? "Provider 连接可用。" : "Provider 连接不可用。"),
      }));
      if (!result.ok) {
        showToast({
          message: result.message ?? "Provider 连接不可用。",
          variant: "error",
        });
      }
      await reloadRuntimeConfigs();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider 连接测试失败。";
      updateConfig(id, { connectionStatus: "unavailable" });
      setTestMessages((currentMessages) => ({
        ...currentMessages,
        [id]: message,
      }));
      showToast({ message, variant: "error" });
    } finally {
      testingConfigIdsRef.current.delete(id);
      setTestingConfigIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(id);
        return nextIds;
      });
    }
  }

  return (
    <main
      aria-label="AI 模型配置"
      className="relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_52%_0%,rgba(255,255,255,0.98),rgba(247,250,255,0.9)_46%,rgba(240,244,250,0.82))]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-7 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
          <header>
            <h1 className="text-[24px] font-semibold tracking-normal text-slate-950">AI 模型配置</h1>
            <p className="mt-2 text-[13px] text-slate-500">
              为不同创作环节配置默认模型与 Provider，统一管理调用参数与可用状态。
            </p>
          </header>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_300px] gap-5">
            <div className="grid min-w-0 grid-cols-2 gap-4">
              {configs.length > 0 ? (
                configs.map((config) => (
                  <ModelConfigCard
                    config={config}
                    key={config.id}
                    apiKeyVisible={visibleApiKeyIds.has(config.id)}
                    isTesting={testingConfigIds.has(config.id)}
                    onUpdate={(patch) => updateConfig(config.id, patch)}
                    onTestConnection={() => void testConfigConnection(config.id)}
                    onToggleApiKeyVisibility={() => void toggleApiKeyVisibility(config.id)}
                    providerProfiles={providerProfiles}
                    testMessage={testMessages[config.id]}
                  />
                ))
              ) : (
                <ModelConfigEmptyState loaded={configsLoaded} />
              )}
            </div>

            <aside className="space-y-4">
              {configs.length > 0 ? (
                <>
                  <ModelSummaryPanel configs={configs} providerProfiles={providerProfiles} />
                  <ModelCategoryGuide configs={configs} />
                </>
              ) : null}
            </aside>
          </div>
        </div>

        <footer className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-t border-slate-200/70 bg-white/76 px-8 py-4 backdrop-blur-2xl">
          <Button
            className="justify-center"
            disabled={savingConfigs || testingConfigIds.size > 0 || configs.length === 0}
            onClick={restoreMockDefaults}
            size="md"
            variant="soft"
          >
            <RotateCcw className="size-3.5" />
            恢复默认
          </Button>
          <div />
          <Button
            className="min-w-28 justify-center"
            disabled={savingConfigs || testingConfigIds.size > 0 || configs.length === 0}
            onClick={() => void cancelLocalChanges()}
            size="md"
            variant="soft"
          >
            取消
          </Button>
          <Button
            aria-busy={savingConfigs}
            className="min-w-44 justify-center border-blue-600 bg-app-blue text-white hover:bg-blue-600"
            disabled={savingConfigs || testingConfigIds.size > 0 || configs.length === 0}
            onClick={() => void saveAllConfigs()}
            size="md"
          >
            <Save className={cn("size-3.5", savingConfigs && "animate-pulse")} />
            {savingConfigs ? "保存中" : "保存配置"}
          </Button>
        </footer>
      </div>
    </main>
  );
}

function ModelConfigCard({
  apiKeyVisible,
  config,
  isTesting,
  onTestConnection,
  onToggleApiKeyVisibility,
  onUpdate,
  providerProfiles,
  testMessage,
}: {
  apiKeyVisible: boolean;
  config: ModelConfig;
  isTesting: boolean;
  onTestConnection: () => void;
  onToggleApiKeyVisibility: () => void;
  onUpdate: (patch: Partial<ModelConfig>) => void;
  providerProfiles: Record<string, ProviderProfileView>;
  testMessage?: string;
}) {
  const Icon = categoryIcons[config.id];
  const modelOptions = modelCatalog[config.provider][categoryCatalogKeys[config.id]];
  const apiKeyValue = apiKeyVisible ? config.apiKey : maskApiKey(config);

  return (
    <section className="rounded-[16px] border border-slate-200/70 bg-white/72 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]",
              iconToneClasses[config.iconTone],
            )}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-slate-950">
              {config.index} {config.title}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">{config.description}</p>
          </div>
        </div>
        <ModelStatusBadge status={isTesting ? "testing" : config.connectionStatus} />
      </div>

      <div className="space-y-2.5">
        <ModelField label="Provider">
          <SelectPill
            ariaLabel={`${config.title} Provider`}
            disabled={isTesting}
            onChange={(provider) => {
              const nextProvider = provider as ModelProviderId;
              const nextModelOptions = modelCatalog[nextProvider][categoryCatalogKeys[config.id]];

              onUpdate({
                apiKeyConfigured: false,
                apiKeyDirty: false,
                apiKeyRevealed: false,
                apiKey: "",
                baseUrl: getProviderBaseUrl(nextProvider, providerProfiles, config.id),
                connectionStatus: "unavailable",
                endpointPath: undefined,
                model: nextModelOptions[0],
                provider: nextProvider,
              });
            }}
            options={getProviderOptionsForCategory(config.id, providerProfiles)}
            value={config.provider}
          />
        </ModelField>
        <ModelField label="模型">
          <ModelNameCombobox
            ariaLabel={`${config.title} 模型`}
            disabled={isTesting}
            onChange={(model) => onUpdate({ connectionStatus: "unavailable", model })}
            options={modelOptions}
            value={config.model}
          />
        </ModelField>
        <ModelField label="Base URL">
          <input
            aria-label={`${config.title} Base URL`}
            className="h-9 w-full rounded-[11px] border border-slate-200/90 bg-white/70 px-3 text-[13px] text-slate-500 outline-none shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]"
            disabled={isTesting}
            readOnly
            value={config.baseUrl}
          />
        </ModelField>
        <ModelField label="API Key">
          <div className="grid grid-cols-[minmax(0,1fr)_26px] items-center gap-2 rounded-[11px] border border-slate-200/90 bg-white/82 px-3 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]">
            <input
              aria-label={`${config.title} API Key`}
              className="h-9 min-w-0 bg-transparent text-[13px] text-slate-700 outline-none"
              disabled={isTesting}
              onChange={(event) => {
                if (apiKeyVisible) {
                  onUpdate({
                    apiKey: event.target.value,
                    apiKeyConfigured: false,
                    apiKeyDirty: true,
                    apiKeyRevealed: false,
                    connectionStatus: "unavailable",
                  });
                }
              }}
              readOnly={!apiKeyVisible}
              value={apiKeyValue}
            />
            <button
              aria-label={`${apiKeyVisible ? "隐藏" : "显示"}${config.title} API Key`}
              className="grid size-6 place-items-center rounded-[7px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              disabled={isTesting}
              onClick={onToggleApiKeyVisibility}
              type="button"
            >
              {apiKeyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </ModelField>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button
          aria-busy={isTesting}
          className="justify-center"
          disabled={isTesting}
          onClick={onTestConnection}
          size="sm"
          title={testMessage}
          variant="soft"
        >
          <Activity className={cn("size-3.5 text-app-blue", isTesting && "animate-spin")} />
          {isTesting ? "测试中" : "测试连接"}
        </Button>
      </div>
    </section>
  );
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
}

function ModelNameCombobox({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function selectModel(model: string) {
    onChange(model);
    setOpen(false);
  }

  return (
    <div className="relative" ref={rootRef}>
      <div
        className={cn(
          "grid h-8 grid-cols-[minmax(0,1fr)_30px] overflow-hidden rounded-control border border-white/60 bg-slate-100/70 text-[12px] font-medium text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-all duration-200 ease-out",
          open && "border-blue-200 bg-white shadow-control ring-2 ring-blue-100/70",
        )}
      >
        <input
          aria-label={ariaLabel}
          className="min-w-0 bg-transparent px-3 text-[12px] font-medium text-slate-800 outline-none placeholder:text-slate-400"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`展开${ariaLabel}选项`}
          className="grid place-items-center text-app-muted transition-colors hover:bg-white/70 hover:text-slate-800"
          disabled={disabled}
          onClick={() => setOpen((currentOpen) => !currentOpen)}
          type="button"
        >
          <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180 text-slate-800")} />
        </button>
      </div>

      {open ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-56 overflow-y-auto rounded-panel border border-white/80 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl [scrollbar-width:thin]"
          role="listbox"
        >
          {options.map((model) => {
            const selected = model === value;

            return (
              <button
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[12px] font-semibold text-slate-800 transition-all duration-150 ease-out hover:bg-slate-100 active:scale-[0.99]",
                  selected && "text-slate-950",
                )}
                key={model}
                onClick={() => selectModel(model)}
                type="button"
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border border-slate-300 bg-white transition-all duration-150",
                    selected && "border-app-blue bg-app-blue text-white shadow-[0_2px_6px_rgba(59,130,246,0.22)]",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{model}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ModelStatusBadge({ status = "available" }: { status?: ModelConfig["connectionStatus"] }) {
  const available = status === "available";
  const testing = status === "testing";
  const untested = status === "untested";

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]",
        available && "border-emerald-200/80 bg-emerald-50/95 text-emerald-700",
        testing && "border-blue-200/80 bg-blue-50/95 text-blue-700",
        untested && "border-amber-200/80 bg-amber-50/95 text-amber-700",
        !available && !testing && !untested && "border-slate-200/90 bg-slate-50/95 text-slate-500",
      )}
      data-testid="model-status-badge"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          available && "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]",
          testing && "animate-pulse bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]",
          untested && "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.12)]",
          !available && !testing && !untested && "bg-slate-400 shadow-[0_0_0_3px_rgba(100,116,139,0.12)]",
        )}
      />
      {testing ? "测试中" : available ? "可用" : untested ? "未测试" : "不可用"}
    </span>
  );
}

function ModelField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
      <span className="text-[12px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ModelConfigEmptyState({ loaded }: { loaded: boolean }) {
  return (
    <section
      className="col-span-2 rounded-[16px] border border-slate-200/70 bg-white/72 p-5 text-[13px] text-slate-500 shadow-[0_12px_32px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
    >
      {loaded ? "模型配置加载失败，请检查 Runtime 状态后重试。" : "模型配置加载中..."}
    </section>
  );
}

function getProviderLabel(provider: ModelProviderId, profiles?: Record<string, ProviderProfileView>) {
  return profiles?.[provider]?.providerLabel ?? providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

function getProviderOptionsForCategory(categoryId: ModelCategoryId, profiles: Record<string, ProviderProfileView>) {
  const catalogKey = categoryCatalogKeys[categoryId];
  const runtimeOptions: Array<{ label: string; value: ModelProviderId }> = [];

  for (const profile of Object.values(profiles)) {
    if (!isKnownProvider(profile.id)) {
      continue;
    }

    if (!profile.supportedCategories.includes(categoryId) || modelCatalog[profile.id][catalogKey].length === 0) {
      continue;
    }

    runtimeOptions.push({
      label: profile.providerLabel,
      value: profile.id,
    });
  }

  if (runtimeOptions.length > 0) {
    return runtimeOptions;
  }

  return providerOptions.filter((option) => modelCatalog[option.value][catalogKey].length > 0);
}

function getProviderBaseUrl(
  provider: ModelProviderId,
  profiles: Record<string, ProviderProfileView>,
  categoryId: ModelCategoryId,
) {
  const runtimeBaseUrl = profiles[provider]?.baseUrl;
  if (runtimeBaseUrl) {
    return runtimeBaseUrl;
  }

  if (provider === "mock-local") {
    return "mock://local";
  }

  if (provider === "openai") {
    return categoryId === "text-to-image" || categoryId === "image-to-image"
      ? "https://api.openai.com/v1/images"
      : "https://api.openai.com/v1";
  }

  if (provider === "deepseek") {
    return "https://api.deepseek.com/v1";
  }

  return "https://ark.cn-beijing.volces.com/api/v3";
}

function maskApiKey(config: ModelConfig) {
  if (!config.apiKey && config.apiKeyConfigured) {
    return `${config.provider === "volcengine" ? "ak" : "sk"}-••••••••••••••••••••••••已配置`;
  }

  if (!config.apiKey) {
    return "";
  }

  const apiKey = config.apiKey;
  const suffix = apiKey.slice(-4);
  const prefix = apiKey.startsWith("ak-") ? "ak" : "sk";

  return `${prefix}-••••••••••••••••••••••••${suffix}`;
}

function indexProfiles(profiles: ProviderProfileView[]) {
  return Object.fromEntries(profiles.map((profile) => [profile.id, profile]));
}

function mergeRuntimeConfigs(
  descriptors: ModelCategoryDescriptor[],
  runtimeConfigs: LocalModelConfigView[],
  profiles: ProviderProfileView[],
): ModelConfig[] {
  const profilesById = indexProfiles(profiles);
  const runtimeConfigsByCapability = new Map(
    runtimeConfigs
      .filter((config) => config.isDefault)
      .map((config) => [config.capabilityId, config]),
  );

  return descriptors.map((descriptor) => {
    const capabilityIds = categoryCapabilityIds[descriptor.id];
    const defaultRuntimeConfig = capabilityIds
      .map((capabilityId) => runtimeConfigsByCapability.get(capabilityId))
      .find(Boolean);
    const configIds = Object.fromEntries(
      capabilityIds
        .map((capabilityId) => runtimeConfigsByCapability.get(capabilityId))
        .filter((runtimeConfig): runtimeConfig is LocalModelConfigView => Boolean(runtimeConfig))
        .map((runtimeConfig) => [runtimeConfig.capabilityId, runtimeConfig.id]),
    );

    if (!defaultRuntimeConfig || !isKnownProvider(defaultRuntimeConfig.providerProfileId)) {
      return {
        ...descriptor,
        apiKey: "",
        apiKeyConfigured: false,
        baseUrl: "",
        configIds,
        connectionStatus: "unavailable",
        model: "",
        provider: "mock-local",
      };
    }

    const connectionStatus = resolveCategoryConnectionStatus(capabilityIds, runtimeConfigsByCapability);

    return {
      ...descriptor,
      apiKey: "",
      apiKeyConfigured: defaultRuntimeConfig.secretStatus.configured,
      apiKeyDirty: false,
      apiKeyRevealed: false,
      baseUrl: defaultRuntimeConfig.baseUrl,
      configIds,
      connectionStatus,
      endpointPath: defaultRuntimeConfig.endpointPath ?? profilesById[defaultRuntimeConfig.providerProfileId]?.defaultEndpointPath,
      model: defaultRuntimeConfig.model,
      provider: defaultRuntimeConfig.providerProfileId,
    };
  });
}

function createMockDefaultConfigs(profiles: Record<string, ProviderProfileView>): ModelConfig[] {
  return modelCategoryDescriptors.map((descriptor) => {
    const catalogKey = categoryCatalogKeys[descriptor.id];

    return {
      ...descriptor,
      apiKey: "",
      apiKeyConfigured: true,
      apiKeyDirty: false,
      apiKeyRevealed: false,
      baseUrl: getProviderBaseUrl("mock-local", profiles, descriptor.id),
      connectionStatus: "untested",
      endpointPath: profiles["mock-local"]?.defaultEndpointPath,
      model: modelCatalog["mock-local"][catalogKey][0] ?? "",
      provider: "mock-local",
    };
  });
}

function isKnownProvider(value: string): value is ModelProviderId {
  return value === "mock-local" || value === "openai" || value === "volcengine" || value === "deepseek";
}

function resolveCategoryConnectionStatus(
  capabilityIds: ModelCapability["id"][],
  runtimeConfigsByCapability: Map<ModelCapability["id"], LocalModelConfigView>,
): LocalModelConfigView["connectionStatus"] {
  const statuses = capabilityIds
    .map((capabilityId) => runtimeConfigsByCapability.get(capabilityId)?.connectionStatus)
    .filter((status): status is LocalModelConfigView["connectionStatus"] => Boolean(status));

  if (statuses.length === 0) {
    return "unavailable";
  }

  if (statuses.every((status) => status === "available")) {
    return "available";
  }

  if (statuses.some((status) => status === "unavailable")) {
    return "unavailable";
  }

  return "untested";
}

function isPlainApiKey(value: string) {
  return value.trim().length > 0 && !value.includes("••••");
}

function ModelSummaryPanel({
  configs,
  providerProfiles,
}: {
  configs: ModelConfig[];
  providerProfiles: Record<string, ProviderProfileView>;
}) {
  return (
    <section className="rounded-[16px] border border-slate-200/70 bg-white/72 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-slate-950">当前默认配置</h2>
      </div>
      <div className="space-y-3">
        {configs.map((config) => {
          const Icon = categoryIcons[config.id];

          return (
            <div className="flex items-center justify-between gap-3" key={config.id}>
              <div className="flex min-w-0 items-center gap-3">
                <div className={cn("grid size-9 shrink-0 place-items-center rounded-[12px]", iconToneClasses[config.iconTone])}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-slate-950">{config.title}</div>
                  <div className="truncate text-[12px] text-slate-500">
                    {getProviderLabel(config.provider, providerProfiles)} / {config.model || "未配置"}
                  </div>
                </div>
              </div>
              <ModelStatusBadge status={config.connectionStatus} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModelCategoryGuide({ configs }: { configs: ModelConfig[] }) {
  return (
    <section className="rounded-[16px] border border-slate-200/70 bg-white/72 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-slate-950">模型类别说明</h2>
        <HelpCircle className="size-4 text-slate-400" />
      </div>
      <div className="space-y-3">
        {configs.map((config) => {
          const Icon = categoryIcons[config.id];

          return (
            <div className="flex gap-3" key={config.id}>
              <div className={cn("grid size-8 shrink-0 place-items-center rounded-[11px]", iconToneClasses[config.iconTone])}>
                <Icon className="size-4" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-slate-950">{config.title}</div>
                <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{config.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
