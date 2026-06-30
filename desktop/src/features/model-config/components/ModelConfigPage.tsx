import { Activity, Check, ChevronDown, Eye, EyeOff, FileText, HelpCircle, Image, Images, MessageSquareText, RotateCcw, Save } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/button";
import { cn } from "../../../shared/lib/cn";
import { SelectPill } from "../../../shared/ui/select-pill";

type ModelCategoryId = "image-to-image" | "image-to-text" | "text-to-image" | "text-to-text";
type ModelCatalogCategory = "imageToImage" | "imageToText" | "textToImage" | "textToText";
type ModelProviderId = "deepseek" | "openai" | "volcengine";

type ModelConfig = {
  apiKey: string;
  baseUrl: string;
  description: string;
  iconTone: "blue" | "cyan" | "orange" | "violet";
  id: ModelCategoryId;
  index: number;
  model: string;
  provider: ModelProviderId;
  title: string;
};

export const modelCatalog = {
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

const initialModelConfigs: ModelConfig[] = [
  {
    apiKey: "sk-demo-text-1234",
    baseUrl: "https://api.openai.com/v1",
    description: "用于提示词优化与文案生成，提升商品文案质量。",
    iconTone: "violet",
    id: "text-to-text",
    index: 1,
    model: "gpt-5.5",
    provider: "openai",
    title: "文生文",
  },
  {
    apiKey: "sk-demo-image-5678",
    baseUrl: "https://api.openai.com/v1/images",
    description: "用于生成主图/场景图，支持高质量商品图生成。",
    iconTone: "orange",
    id: "text-to-image",
    index: 2,
    model: "gpt-image-2",
    provider: "openai",
    title: "文生图",
  },
  {
    apiKey: "ak-demo-edit-90ab",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    description: "用于编辑、扩图、重绘，支持精修与风格转换。",
    iconTone: "blue",
    id: "image-to-image",
    index: 3,
    model: "doubao-seedream-5-0-260128",
    provider: "volcengine",
    title: "图生图",
  },
  {
    apiKey: "ak-demo-vision-de34",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    description: "用于图片理解与反推，提取要点与生成描述。",
    iconTone: "cyan",
    id: "image-to-text",
    index: 4,
    model: "doubao-seed-2-1-pro-260628",
    provider: "volcengine",
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

export function ModelConfigPage() {
  const [configs, setConfigs] = useState(initialModelConfigs);
  const [visibleApiKeyIds, setVisibleApiKeyIds] = useState<Set<ModelCategoryId>>(() => new Set());

  function updateConfig(id: ModelCategoryId, patch: Partial<ModelConfig>) {
    setConfigs((currentConfigs) =>
      currentConfigs.map((config) => (config.id === id ? { ...config, ...patch } : config)),
    );
  }

  function toggleApiKeyVisibility(id: ModelCategoryId) {
    setVisibleApiKeyIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(id)) {
        nextIds.delete(id);
      } else {
        nextIds.add(id);
      }
      return nextIds;
    });
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
              {configs.map((config) => (
                <ModelConfigCard
                  config={config}
                  key={config.id}
                  apiKeyVisible={visibleApiKeyIds.has(config.id)}
                  onUpdate={(patch) => updateConfig(config.id, patch)}
                  onToggleApiKeyVisibility={() => toggleApiKeyVisibility(config.id)}
                />
              ))}
            </div>

            <aside className="space-y-4">
              <ModelSummaryPanel configs={configs} />
              <ModelCategoryGuide configs={configs} />
            </aside>
          </div>
        </div>

        <footer className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-t border-slate-200/70 bg-white/76 px-8 py-4 backdrop-blur-2xl">
          <Button className="justify-center" size="md" variant="soft">
            <RotateCcw className="size-3.5" />
            恢复默认
          </Button>
          <div />
          <Button className="min-w-28 justify-center" size="md" variant="soft">
            取消
          </Button>
          <Button className="min-w-44 justify-center border-blue-600 bg-app-blue text-white hover:bg-blue-600" size="md">
            <Save className="size-3.5" />
            保存配置
          </Button>
        </footer>
      </div>
    </main>
  );
}

function ModelConfigCard({
  apiKeyVisible,
  config,
  onToggleApiKeyVisibility,
  onUpdate,
}: {
  apiKeyVisible: boolean;
  config: ModelConfig;
  onToggleApiKeyVisibility: () => void;
  onUpdate: (patch: Partial<ModelConfig>) => void;
}) {
  const Icon = categoryIcons[config.id];
  const modelOptions = modelCatalog[config.provider][categoryCatalogKeys[config.id]];
  const apiKeyValue = apiKeyVisible ? config.apiKey : maskApiKey(config.apiKey);

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
        <ModelStatusBadge />
      </div>

      <div className="space-y-2.5">
        <ModelField label="Provider">
          <SelectPill
            ariaLabel={`${config.title} Provider`}
            onChange={(provider) => {
              const nextProvider = provider as ModelProviderId;
              const nextModelOptions = modelCatalog[nextProvider][categoryCatalogKeys[config.id]];

              onUpdate({
                baseUrl: getProviderBaseUrl(nextProvider, config.id),
                model: nextModelOptions[0],
                provider: nextProvider,
              });
            }}
            options={getProviderOptionsForCategory(config.id)}
            value={config.provider}
          />
        </ModelField>
        <ModelField label="模型">
          <ModelNameCombobox
            ariaLabel={`${config.title} 模型`}
            onChange={(model) => onUpdate({ model })}
            options={modelOptions}
            value={config.model}
          />
        </ModelField>
        <ModelField label="Base URL">
          <input
            aria-label={`${config.title} Base URL`}
            className="h-9 w-full rounded-[11px] border border-slate-200/90 bg-white/70 px-3 text-[13px] text-slate-500 outline-none shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]"
            onChange={(event) => onUpdate({ baseUrl: event.target.value })}
            value={config.baseUrl}
          />
        </ModelField>
        <ModelField label="API Key">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_26px] items-center gap-2 rounded-[11px] border border-slate-200/90 bg-white/82 px-3 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]">
            <span className="size-2 rounded-full bg-emerald-500" />
            <input
              aria-label={`${config.title} API Key`}
              className="h-9 min-w-0 bg-transparent text-[13px] text-slate-700 outline-none"
              onChange={(event) => {
                if (apiKeyVisible) {
                  onUpdate({ apiKey: event.target.value });
                }
              }}
              readOnly={!apiKeyVisible}
              value={apiKeyValue}
            />
            <button
              aria-label={`${apiKeyVisible ? "隐藏" : "显示"}${config.title} API Key`}
              className="grid size-6 place-items-center rounded-[7px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              onClick={onToggleApiKeyVisibility}
              type="button"
            >
              {apiKeyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </ModelField>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button className="justify-center" size="sm" variant="soft">
          <Activity className="size-3.5 text-app-blue" />
          测试连接
        </Button>
      </div>
    </section>
  );
}

function ModelNameCombobox({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
        <button
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`展开${ariaLabel}选项`}
          className="grid place-items-center text-app-muted transition-colors hover:bg-white/70 hover:text-slate-800"
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

function ModelStatusBadge() {
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200/80 bg-emerald-50/95 px-2.5 text-[11px] font-semibold text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]"
      data-testid="model-status-badge"
    >
      <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
      可用
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

function getProviderLabel(provider: ModelProviderId) {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

function getProviderOptionsForCategory(categoryId: ModelCategoryId) {
  const catalogKey = categoryCatalogKeys[categoryId];

  return providerOptions.filter((option) => modelCatalog[option.value][catalogKey].length > 0);
}

function getProviderBaseUrl(provider: ModelProviderId, categoryId: ModelCategoryId) {
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

function maskApiKey(apiKey: string) {
  const suffix = apiKey.slice(-4);
  const prefix = apiKey.startsWith("ak-") ? "ak" : "sk";

  return `${prefix}-••••••••••••••••••••••••${suffix}`;
}

function ModelSummaryPanel({ configs }: { configs: ModelConfig[] }) {
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
                    {getProviderLabel(config.provider)} / {config.model}
                  </div>
                </div>
              </div>
              <ModelStatusBadge />
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
