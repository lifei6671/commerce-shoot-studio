import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  ImageIcon,
  Import,
  KeyRound,
  Menu,
  Minus,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import type { AssetFileView, AssetType } from "../../assets/model/assetTypes";
import type {
  ImageCombination,
  ValidateCombinationResponse,
} from "../../assets/model/combinationTypes";
import { getAsset, importImage, listAssets } from "../../assets/services/assetService";
import {
  getImageCombination,
  listImageCombinations,
  saveImageCombination,
  validateCombination,
} from "../../assets/services/combinationService";
import type {
  ProviderCredentialStatus,
  SaveModelConfigRequest,
} from "../../model-config/model/modelTypes";
import {
  getProviderCredentialStatus,
  setProviderApiKey,
} from "../../model-config/services/modelService";
import type { SavePromptBindingRequest } from "../../prompt/model/promptTypes";
import { savePromptBinding } from "../../prompt/services/promptService";
import type {
  GenerationTaskDetail,
  GenerationTaskResultAsset,
} from "../../generation-task/model/taskTypes";
import { listenGenerationTaskUpdates } from "../../generation-task/services/taskEventService";
import {
  cancelGenerationTask,
  getGenerationTaskDetail,
  getLatestGenerationTaskByCombination,
  listRecentGenerationTasks,
  listRunningGenerationTasks,
  openGenerationResult,
  retryGenerationTask,
  startGeneration,
} from "../../generation-task/services/taskService";
import { useGenerationTaskStore } from "../../generation-task/store/taskStore";

const DEFAULT_PROMPT_TEXT =
  "Create a clean commercial fashion try-on image. Preserve the person's identity and pose, apply the selected garments naturally, keep realistic fabric texture, studio lighting, and ecommerce-ready composition.";

const DEFAULT_MODEL_ID = "gpt-image-1";
const DEFAULT_PROVIDER = "openai";
const MODEL_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;

type SelectableAsset = {
  id: string;
  imageSrc?: string;
  label: string;
  selected?: boolean;
  width?: number;
  height?: number;
  mimeType?: string;
  createdAt?: string;
};

type SidePanelMode = "summary" | "settings" | "history";

// Backwards-compatible export for the node wrapper files.
export function WorkflowNode() {
  return null;
}

export function WorkflowCanvas() {
  const [currentCombination, setCurrentCombination] = useState<ImageCombination | null>(null);
  const [people, setPeople] = useState<AssetFileView[]>([]);
  const [garments, setGarments] = useState<AssetFileView[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([]);
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT_TEXT);
  const [modelSize, setModelSize] = useState<(typeof MODEL_SIZES)[number]>("1024x1024");
  const [outputCount, setOutputCount] = useState(1);
  const [credentialStatus, setCredentialStatus] =
    useState<ProviderCredentialStatus | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [importingType, setImportingType] =
    useState<Extract<AssetType, "person" | "garment"> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [validationResult, setValidationResult] =
    useState<ValidateCombinationResponse | null>(null);
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>("summary");
  const latestTask = useGenerationTaskStore((state) => state.latestTask);
  const recentTasks = useGenerationTaskStore((state) => state.recentTasks);
  const setLatestTask = useGenerationTaskStore((state) => state.setLatestTask);
  const setRunningTasks = useGenerationTaskStore((state) => state.setRunningTasks);
  const setRecentTasks = useGenerationTaskStore((state) => state.setRecentTasks);

  const modelConfig = useMemo<SaveModelConfigRequest>(
    () => ({
      provider: DEFAULT_PROVIDER,
      modelId: DEFAULT_MODEL_ID,
      paramsJson: {
        outputCount,
        size: modelSize,
      },
    }),
    [modelSize, outputCount],
  );

  const selectedPerson = useMemo(
    () => people.find((asset) => asset.asset.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  );
  const selectedGarments = useMemo(
    () =>
      selectedGarmentIds
        .map((id) => garments.find((asset) => asset.asset.id === id))
        .filter((asset): asset is AssetFileView => Boolean(asset)),
    [garments, selectedGarmentIds],
  );
  const resultAssets = latestTask?.results ?? [];
  const canRun = validationResult?.executable === true && !isStarting && !isSaving;
  const combinationName = currentCombination?.name ?? "未保存组合";

  async function refreshTaskLists() {
    const [runningTasks, recentTasks] = await Promise.all([
      listRunningGenerationTasks(),
      listRecentGenerationTasks(),
    ]);
    setRunningTasks(runningTasks);
    setRecentTasks(recentTasks);
  }

  async function refreshAssets() {
    const [personAssets, garmentAssets] = await Promise.all([
      listAssets("person"),
      listAssets("garment"),
    ]);
    setPeople(personAssets);
    setGarments(garmentAssets);
  }

  async function refreshCredentialStatus() {
    const status = await getProviderCredentialStatus(DEFAULT_PROVIDER);
    setCredentialStatus(status);
  }

  async function refreshWorkbenchData() {
    const [personAssets, garmentAssets, combinations] = await Promise.all([
      listAssets("person"),
      listAssets("garment"),
      listImageCombinations(),
      refreshTaskLists(),
      refreshCredentialStatus(),
    ]);
    setPeople(personAssets);
    setGarments(garmentAssets);

    const latest = combinations[0];
    if (!latest) {
      setCurrentCombination(null);
      setSelectedPersonId(null);
      setSelectedGarmentIds([]);
      setLatestTask(null);
      return;
    }

    const combination = await getImageCombination(latest.id);
    setCurrentCombination(combination);
    setSelectedPersonId(combination?.personAssetId ?? null);
    setSelectedGarmentIds(combination?.garmentAssetIds ?? []);

    if (combination) {
      setLatestTask(await getLatestGenerationTaskByCombination(combination.id));
    }
  }

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let canceled = false;
    setLoadingError(null);
    refreshWorkbenchData().catch((error) => {
      if (!canceled) {
        setLoadingError(error instanceof Error ? error.message : "加载工作台失败");
        setCurrentCombination(null);
        setLatestTask(null);
      }
    });

    return () => {
      canceled = true;
    };
  }, [setLatestTask, setRecentTasks, setRunningTasks]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let canceled = false;
    validateCombination({
      revision: Date.now(),
      draftCombination: {
        id: currentCombination?.id,
        name: currentCombination?.name ?? buildCombinationName(),
        personAssetId: selectedPersonId,
        garmentAssetIds: selectedGarmentIds,
      },
      draftPromptBinding: buildPromptBinding(currentCombination?.id ?? "draft", promptText),
      draftModelConfig: modelConfig,
    })
      .then((result) => {
        if (!canceled) {
          setValidationResult(result);
        }
      })
      .catch((error) => {
        if (!canceled) {
          setValidationResult(null);
          setActionError(error instanceof Error ? error.message : "校验组合失败");
        }
      });

    return () => {
      canceled = true;
    };
  }, [
    currentCombination?.id,
    currentCombination?.name,
    modelConfig,
    promptText,
    selectedGarmentIds,
    selectedPersonId,
  ]);

  useEffect(() => {
    if (!isTauriRuntime() || !currentCombination) {
      return;
    }

    let canceled = false;
    let unlisten: (() => void) | undefined;

    listenGenerationTaskUpdates((task) => {
      if (task.combinationId !== currentCombination.id) {
        return;
      }
      getGenerationTaskDetail(task.id)
        .then((detail) => {
          if (!canceled) {
            setLatestTask(detail);
          }
        })
        .catch(() => undefined);
      refreshTaskLists().catch(() => undefined);
    })
      .then((cleanup) => {
        if (canceled) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => {
      canceled = true;
      unlisten?.();
    };
  }, [currentCombination, setLatestTask, setRecentTasks, setRunningTasks]);

  async function handleImport(assetType: Extract<AssetType, "person" | "garment">) {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg"],
        },
      ],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setImportingType(assetType);
    setActionError(null);
    setActionMessage(null);
    try {
      const response = await importImage(selected, assetType);
      const view = await getAsset(response.asset.id);
      if (!view) {
        throw new Error("导入后未找到资产记录");
      }
      if (assetType === "person") {
        setPeople((items) => upsertAsset(items, view));
        setSelectedPersonId(view.asset.id);
      } else {
        setGarments((items) => upsertAsset(items, view));
        setSelectedGarmentIds((ids) =>
          [view.asset.id, ...ids.filter((id) => id !== view.asset.id)].slice(0, 4),
        );
      }
      setActionMessage(response.duplicate ? "已选择已存在的相同图片" : "图片导入成功");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "导入图片失败");
    } finally {
      setImportingType(null);
    }
  }

  async function handleSaveCombination() {
    setIsSaving(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await persistCurrentCombination();
      setActionMessage("组合已保存");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存组合失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStartGeneration() {
    setIsStarting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const saved = await persistCurrentCombination();
      const promptBinding = buildPromptBinding(saved.id, promptText);
      await savePromptBinding(promptBinding);
      const task = await startGeneration({
        combinationId: saved.id,
        draftPromptBinding: promptBinding,
        draftModelConfig: modelConfig,
      });
      const detail = await getGenerationTaskDetail(task.id);
      setLatestTask(detail ?? { task, results: [] });
      await refreshTaskLists();
      setActionMessage("生成任务已提交");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "启动生成失败");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleSaveApiKey() {
    setIsSavingApiKey(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await setProviderApiKey(DEFAULT_PROVIDER, apiKeyDraft);
      await refreshCredentialStatus();
      setApiKeyDraft("");
      setActionMessage("API Key 已保存到系统密钥库");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存 API Key 失败");
    } finally {
      setIsSavingApiKey(false);
    }
  }

  async function persistCurrentCombination() {
    if (!selectedPersonId) {
      throw new Error("请先选择人物图片");
    }
    if (!selectedGarmentIds.length) {
      throw new Error("请至少选择一张服装图片");
    }
    if (!promptText.trim()) {
      throw new Error("请填写 Prompt");
    }

    const saved = await saveImageCombination({
      id: currentCombination?.id,
      name: currentCombination?.name ?? buildCombinationName(),
      personAssetId: selectedPersonId,
      garmentAssetIds: selectedGarmentIds,
    });
    setCurrentCombination(saved);
    await savePromptBinding(buildPromptBinding(saved.id, promptText));
    await refreshTaskLists();
    return saved;
  }

  function handleNewCombination() {
    setCurrentCombination(null);
    setSelectedPersonId(null);
    setSelectedGarmentIds([]);
    setLatestTask(null);
    setActionError(null);
    setActionMessage("已新建空白组合");
  }

  function toggleGarment(assetId: string) {
    setSelectedGarmentIds((ids) => {
      if (ids.includes(assetId)) {
        return ids.filter((id) => id !== assetId);
      }
      return [assetId, ...ids].slice(0, 4);
    });
  }

  function handleRefreshAll() {
    setActionError(null);
    setActionMessage(null);
    Promise.all([refreshAssets(), refreshTaskLists(), refreshCredentialStatus()])
      .then(() => setActionMessage("工作台已刷新"))
      .catch((error) =>
        setActionError(error instanceof Error ? error.message : "刷新工作台失败"),
      );
  }

  return (
    <div className="desktop-frame">
      <WindowChrome />
      <div className="workbench">
        <TopToolbar
          combinationName={combinationName}
          canRun={canRun}
          isSaving={isSaving}
          isStarting={isStarting}
          onHistory={() => setSidePanelMode("history")}
          onModelSettings={() => setSidePanelMode("settings")}
          onNew={handleNewCombination}
          onPromptTemplate={() => setPromptText(DEFAULT_PROMPT_TEXT)}
          onRefresh={handleRefreshAll}
          onSave={() => {
            void handleSaveCombination();
          }}
          onRun={() => {
            void handleStartGeneration();
          }}
        />
        <div className="workbench__body workbench__body--app">
          <AssetLibrary
            people={people}
            garments={garments}
            results={resultAssets}
            selectedPersonId={selectedPersonId}
            selectedGarmentIds={selectedGarmentIds}
            importingType={importingType}
            onImport={(assetType) => {
              void handleImport(assetType);
            }}
            onRefresh={handleRefreshAll}
            onSelectPerson={setSelectedPersonId}
            onToggleGarment={toggleGarment}
          />
          <main className="generation-workbench">
            <WorkbenchMessages
              loadingError={loadingError}
              actionError={actionError}
              actionMessage={actionMessage}
            />
            <ComposerHeader
              credentialStatus={credentialStatus}
              latestTask={latestTask}
              selectedGarmentCount={selectedGarments.length}
              selectedPerson={selectedPerson}
              validationResult={validationResult}
            />
            <section className="composer-grid">
              <AssetInputCard
                asset={selectedPerson}
                icon={<UserRound size={28} />}
                isImporting={importingType === "person"}
                title="人物图片"
                description="选择一张主体人物图，后续生成会保持人物身份和姿态。"
                actionLabel={selectedPerson ? "替换人物图" : "导入人物图"}
                onImport={() => {
                  void handleImport("person");
                }}
              />
              <GarmentInputCard
                garments={selectedGarments}
                isImporting={importingType === "garment"}
                onImport={() => {
                  void handleImport("garment");
                }}
                onRemove={(assetId) => toggleGarment(assetId)}
              />
              <PromptEditorCard promptText={promptText} onPromptChange={setPromptText} />
              <ModelSettingsCard
                apiKeyDraft={apiKeyDraft}
                credentialStatus={credentialStatus}
                isSavingApiKey={isSavingApiKey}
                modelSize={modelSize}
                outputCount={outputCount}
                onApiKeyDraftChange={setApiKeyDraft}
                onModelSizeChange={setModelSize}
                onOutputCountChange={setOutputCount}
                onSaveApiKey={() => {
                  void handleSaveApiKey();
                }}
              />
            </section>
            <section className="execution-strip">
              <ValidationSummary validationResult={validationResult} />
              <div className="execution-actions">
                <button
                  className="toolbar-button"
                  disabled={isSaving}
                  onClick={() => {
                    void handleSaveCombination();
                  }}
                  type="button"
                >
                  <Save size={16} />
                  {isSaving ? "保存中" : "保存组合"}
                </button>
                <button
                  className="run-button"
                  disabled={!canRun}
                  onClick={() => {
                    void handleStartGeneration();
                  }}
                  type="button"
                >
                  <Play size={17} fill="currentColor" />
                  {isStarting ? "提交中" : "执行生成"}
                </button>
              </div>
            </section>
            <section className="result-workspace">
              <BottomDashboard currentCombination={currentCombination} latestTask={latestTask} />
              <ResultPreview results={resultAssets} />
            </section>
          </main>
          <InspectorPanel
            apiKeyDraft={apiKeyDraft}
            credentialStatus={credentialStatus}
            currentCombination={currentCombination}
            mode={sidePanelMode}
            recentTasks={recentTasks}
            selectedGarments={selectedGarments}
            selectedPerson={selectedPerson}
            validationResult={validationResult}
            onApiKeyDraftChange={setApiKeyDraft}
            onImport={(assetType) => {
              void handleImport(assetType);
            }}
            onModeChange={setSidePanelMode}
            onSaveApiKey={() => {
              void handleSaveApiKey();
            }}
            onTaskChanged={(detail) => {
              setLatestTask(detail);
              void refreshTaskLists();
            }}
          />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function buildCombinationName() {
  return `试穿组合 ${new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

function buildPromptBinding(
  combinationId: string,
  promptText: string,
): SavePromptBindingRequest {
  return {
    id: null,
    combinationId,
    system: {
      mode: "default",
      baseTemplateId: null,
      appendText: "",
      overrideText: "",
    },
    user: {
      mode: "override",
      baseTemplateId: null,
      appendText: "",
      overrideText: promptText,
    },
    negative: {
      mode: "override",
      baseTemplateId: null,
      appendText: "",
      overrideText: "low quality, distorted body, warped garment, extra limbs, unreadable text",
    },
    variablesJson: {},
  };
}

function upsertAsset(items: AssetFileView[], asset: AssetFileView) {
  return [asset, ...items.filter((item) => item.asset.id !== asset.asset.id)];
}

function toSelectableAsset(view: AssetFileView, selected: boolean): SelectableAsset {
  return {
    id: view.asset.id,
    imageSrc: convertFileSrc(view.thumbFilePath),
    label: view.asset.originalName,
    selected,
    width: view.asset.width,
    height: view.asset.height,
    mimeType: view.asset.mimeType,
    createdAt: view.asset.createdAt,
  };
}

function WindowChrome() {
  return (
    <header className="window-chrome">
      <div className="window-chrome__brand">
        <span className="app-mark">
          <BriefcaseBusiness size={18} />
        </span>
        <strong>AI 服装展示图生成器</strong>
        <span className="version-pill">Beta v1.0.0</span>
      </div>
      <div className="window-chrome__controls" aria-hidden="true">
        <Menu size={18} />
        <Minus size={18} />
        <span className="chrome-square" />
        <X size={18} />
      </div>
    </header>
  );
}

function TopToolbar({
  combinationName,
  canRun,
  isSaving,
  isStarting,
  onHistory,
  onModelSettings,
  onNew,
  onPromptTemplate,
  onRefresh,
  onSave,
  onRun,
}: {
  combinationName: string;
  canRun: boolean;
  isSaving: boolean;
  isStarting: boolean;
  onHistory: () => void;
  onModelSettings: () => void;
  onNew: () => void;
  onPromptTemplate: () => void;
  onRefresh: () => void;
  onSave: () => void;
  onRun: () => void;
}) {
  return (
    <nav className="top-toolbar" aria-label="工作台工具栏">
      <div className="combo-select">
        <span>当前组合：</span>
        <strong>{combinationName}</strong>
        <ChevronDown size={16} />
      </div>
      <div className="toolbar-actions">
        <button className="primary-action" onClick={onNew} type="button">
          <Plus size={18} />
          新建组合
        </button>
        <ToolbarButton
          icon={<Save size={16} />}
          label={isSaving ? "保存中" : "保存"}
          onClick={onSave}
          disabled={isSaving}
        />
        <ToolbarButton icon={<FolderOpen size={16} />} label="打开历史" onClick={onHistory} />
        <ToolbarButton icon={<Settings size={16} />} label="模型设置" onClick={onModelSettings} />
        <ToolbarButton icon={<Copy size={16} />} label="应用默认 Prompt" onClick={onPromptTemplate} />
        <ToolbarButton icon={<SlidersHorizontal size={16} />} label="刷新工作区" onClick={onRefresh} />
      </div>
      <div className="toolbar-spacer" />
      <button className="icon-button is-muted" disabled type="button" aria-label="撤销">
        <RotateCcw size={18} />
      </button>
      <button className="icon-button" onClick={onRefresh} type="button" aria-label="刷新">
        <RefreshCw size={18} />
      </button>
      <button className="run-button" disabled={!canRun} onClick={onRun} type="button">
        <Play size={17} fill="currentColor" />
        {isStarting ? "提交中" : "执行生成"}
      </button>
      <span className="avatar" aria-label="当前用户">
        <UserRound size={18} />
      </span>
    </nav>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className="toolbar-button" disabled={disabled} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}

function AssetLibrary({
  people,
  garments,
  results,
  selectedPersonId,
  selectedGarmentIds,
  importingType,
  onImport,
  onRefresh,
  onSelectPerson,
  onToggleGarment,
}: {
  people: AssetFileView[];
  garments: AssetFileView[];
  results: GenerationTaskResultAsset[];
  selectedPersonId: string | null;
  selectedGarmentIds: string[];
  importingType: Extract<AssetType, "person" | "garment"> | null;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onRefresh: () => void;
  onSelectPerson: (assetId: string) => void;
  onToggleGarment: (assetId: string) => void;
}) {
  return (
    <aside className="asset-library">
      <div className="panel-title">
        <h2>资源库</h2>
        <Menu size={18} />
      </div>
      <AssetSection
        title="人物图片"
        count={people.length}
        assets={people.map((asset) => toSelectableAsset(asset, asset.asset.id === selectedPersonId))}
        accent="green"
        action="导入"
        isImporting={importingType === "person"}
        onAction={() => onImport("person")}
        onSelect={onSelectPerson}
      />
      <AssetSection
        title="服装图片"
        count={garments.length}
        assets={garments.map((asset) =>
          toSelectableAsset(asset, selectedGarmentIds.includes(asset.asset.id)),
        )}
        accent="green"
        action="导入"
        isImporting={importingType === "garment"}
        onAction={() => onImport("garment")}
        onSelect={onToggleGarment}
      />
      <AssetSection
        title="结果图片"
        count={results.length}
        assets={results.map((result) => ({
          id: result.assetId,
          imageSrc: convertFileSrc(result.thumbFilePath),
          label: `${result.width} x ${result.height}`,
          width: result.width,
          height: result.height,
        }))}
        accent="blue"
        action="刷新"
        onAction={onRefresh}
      />
      <button className="all-assets" onClick={onRefresh} type="button">
        <Archive size={16} />
        刷新全部资源
        <ChevronRight size={16} />
      </button>
    </aside>
  );
}

function AssetSection({
  title,
  count,
  assets,
  accent,
  action,
  isImporting = false,
  onAction,
  onSelect,
}: {
  title: string;
  count: number;
  assets: SelectableAsset[];
  accent: "green" | "blue";
  action: "导入" | "刷新";
  isImporting?: boolean;
  onAction: () => void;
  onSelect?: (assetId: string) => void;
}) {
  return (
    <section className="asset-section">
      <div className="asset-section__header">
        <div>
          <span className={`section-dot section-dot--${accent}`} />
          <strong>
            {title} <span>({count})</span>
          </strong>
        </div>
        <button disabled={isImporting} onClick={onAction} type="button">
          {action === "导入" ? <Import size={14} /> : <RefreshCw size={14} />}
          {isImporting ? "导入中" : action}
        </button>
      </div>
      <div className="asset-grid">
        {assets.length ? (
          assets.map((asset) => (
            <button
              key={asset.id}
              className={`asset-thumb ${asset.selected ? "is-selected" : ""}`}
              onClick={() => onSelect?.(asset.id)}
              type="button"
            >
              <AssetImage asset={asset} />
              {asset.selected ? (
                <span className="asset-thumb__check">
                  <CircleCheck size={13} fill="currentColor" />
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <div className="asset-empty">
            <ImageIcon size={18} />
            暂无素材
          </div>
        )}
        {action === "导入" ? (
          <button
            className="asset-thumb asset-thumb--add"
            onClick={onAction}
            type="button"
            aria-label={`添加${title}`}
          >
            <Plus size={22} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ComposerHeader({
  credentialStatus,
  latestTask,
  selectedGarmentCount,
  selectedPerson,
  validationResult,
}: {
  credentialStatus: ProviderCredentialStatus | null;
  latestTask: GenerationTaskDetail | null;
  selectedGarmentCount: number;
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
}) {
  return (
    <section className="composer-header">
      <div>
        <p>生成工作台</p>
        <h1>配置图片、Prompt 和模型后直接提交生成</h1>
      </div>
      <div className="composer-status-row">
        <StatusPill active={Boolean(selectedPerson)} label="人物图" />
        <StatusPill active={selectedGarmentCount > 0} label={`${selectedGarmentCount} 件服装`} />
        <StatusPill active={credentialStatus?.configured === true} label="API Key" />
        <StatusPill
          active={validationResult?.executable === true}
          label={validationResult?.executable ? "可执行" : "待补齐"}
        />
        <StatusPill
          active={latestTask?.task.status === "succeeded"}
          label={latestTask ? getGenerationTaskStatusLabel(latestTask.task.status) : "暂无任务"}
        />
      </div>
    </section>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`status-pill ${active ? "is-active" : ""}`}>
      {active ? <CircleCheck size={13} /> : <Clock3 size={13} />}
      {label}
    </span>
  );
}

function AssetInputCard({
  asset,
  icon,
  isImporting,
  title,
  description,
  actionLabel,
  onImport,
}: {
  asset: AssetFileView | null;
  icon: ReactNode;
  isImporting: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onImport: () => void;
}) {
  return (
    <section className="composer-card asset-input-card">
      <div className="composer-card__header">
        <span>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {asset ? (
        <div className="selected-asset-preview">
          <img alt={asset.asset.originalName} src={convertFileSrc(asset.thumbFilePath)} />
          <dl>
            <dt>文件名</dt>
            <dd>{asset.asset.originalName}</dd>
            <dt>尺寸</dt>
            <dd>{formatDimensions(asset.asset.width, asset.asset.height)}</dd>
            <dt>类型</dt>
            <dd>{asset.asset.mimeType}</dd>
          </dl>
        </div>
      ) : (
        <button className="upload-dropzone" onClick={onImport} type="button">
          <ImageIcon size={28} />
          <strong>选择本地图片</strong>
          <span>支持 PNG/JPG/JPEG，导入后会复制到工作区并生成缩略图。</span>
        </button>
      )}
      <button className="ghost-wide" disabled={isImporting} onClick={onImport} type="button">
        <Import size={15} />
        {isImporting ? "导入中" : actionLabel}
      </button>
    </section>
  );
}

function GarmentInputCard({
  garments,
  isImporting,
  onImport,
  onRemove,
}: {
  garments: AssetFileView[];
  isImporting: boolean;
  onImport: () => void;
  onRemove: (assetId: string) => void;
}) {
  return (
    <section className="composer-card garment-input-card">
      <div className="composer-card__header">
        <span>
          <BriefcaseBusiness size={28} />
        </span>
        <div>
          <h2>服装图片</h2>
          <p>可选择 1-4 张服装图，任务快照会按当前顺序保存。</p>
        </div>
      </div>
      {garments.length ? (
        <div className="selected-garment-grid">
          {garments.map((asset) => (
            <article key={asset.asset.id}>
              <img alt={asset.asset.originalName} src={convertFileSrc(asset.thumbFilePath)} />
              <button onClick={() => onRemove(asset.asset.id)} type="button" aria-label="移除服装">
                <X size={13} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <button className="upload-dropzone" onClick={onImport} type="button">
          <BriefcaseBusiness size={28} />
          <strong>导入服装图</strong>
          <span>至少一张服装图才能保存组合并执行生成。</span>
        </button>
      )}
      <button className="ghost-wide" disabled={isImporting} onClick={onImport} type="button">
        <Import size={15} />
        {isImporting ? "导入中" : "添加服装图"}
      </button>
    </section>
  );
}

function PromptEditorCard({
  promptText,
  onPromptChange,
}: {
  promptText: string;
  onPromptChange: (value: string) => void;
}) {
  return (
    <section className="composer-card prompt-editor-card">
      <div className="composer-card__header">
        <span>
          <FileText size={28} />
        </span>
        <div>
          <h2>Prompt</h2>
          <p>这里的文本会写入 prompt binding，并进入生成任务快照。</p>
        </div>
      </div>
      <textarea
        value={promptText}
        onChange={(event) => onPromptChange(event.target.value)}
        rows={9}
      />
      <div className="field-meta">
        <span>{promptText.trim().length} 字符</span>
        <button onClick={() => onPromptChange(DEFAULT_PROMPT_TEXT)} type="button">
          恢复默认
        </button>
      </div>
    </section>
  );
}

function ModelSettingsCard({
  apiKeyDraft,
  credentialStatus,
  isSavingApiKey,
  modelSize,
  outputCount,
  onApiKeyDraftChange,
  onModelSizeChange,
  onOutputCountChange,
  onSaveApiKey,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  isSavingApiKey: boolean;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  onApiKeyDraftChange: (value: string) => void;
  onModelSizeChange: (value: (typeof MODEL_SIZES)[number]) => void;
  onOutputCountChange: (value: number) => void;
  onSaveApiKey: () => void;
}) {
  return (
    <section className="composer-card model-settings-card">
      <div className="composer-card__header">
        <span>
          <Settings size={28} />
        </span>
        <div>
          <h2>模型参数</h2>
          <p>当前 MVP 使用固定 OpenAI Provider，不暴露自定义 Base URL。</p>
        </div>
      </div>
      <div className="settings-form-grid">
        <label>
          Provider
          <input value={DEFAULT_PROVIDER} readOnly />
        </label>
        <label>
          模型
          <input value={DEFAULT_MODEL_ID} readOnly />
        </label>
        <label>
          尺寸
          <select
            value={modelSize}
            onChange={(event) =>
              onModelSizeChange(event.target.value as (typeof MODEL_SIZES)[number])
            }
          >
            {MODEL_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <label>
          生成数量
          <input
            min={1}
            max={4}
            type="number"
            value={outputCount}
            onChange={(event) =>
              onOutputCountChange(Math.max(1, Math.min(4, Number(event.target.value) || 1)))
            }
          />
        </label>
      </div>
      <div className="credential-row">
        <div>
          <strong>{credentialStatus?.configured ? "API Key 已配置" : "API Key 未配置"}</strong>
          <span>{credentialStatus?.maskedKey ?? "执行生成前需要保存 OpenAI API Key"}</span>
        </div>
        <KeyRound size={18} />
      </div>
      <div className="api-key-row">
        <input
          value={apiKeyDraft}
          onChange={(event) => onApiKeyDraftChange(event.target.value)}
          placeholder="粘贴 OpenAI API Key"
          type="password"
        />
        <button disabled={!apiKeyDraft.trim() || isSavingApiKey} onClick={onSaveApiKey} type="button">
          {isSavingApiKey ? "保存中" : "保存"}
        </button>
      </div>
    </section>
  );
}

function ValidationSummary({
  validationResult,
}: {
  validationResult: ValidateCombinationResponse | null;
}) {
  const executable = validationResult?.executable === true;
  return (
    <div className={`validation-summary ${executable ? "is-ready" : ""}`}>
      <span>{executable ? <CircleCheck size={18} /> : <CircleAlert size={18} />}</span>
      <div>
        <strong>{executable ? "当前组合可以执行" : "还不能执行生成"}</strong>
        {validationResult?.reasons.length ? (
          <ul>
            {validationResult.reasons.slice(0, 3).map((reason) => (
              <li key={`${reason.code}-${reason.field ?? reason.message}`}>{reason.message}</li>
            ))}
          </ul>
        ) : (
          <p>保存组合后会创建 prompt binding，并用当前模型参数提交任务。</p>
        )}
      </div>
    </div>
  );
}

function WorkbenchMessages({
  loadingError,
  actionError,
  actionMessage,
}: {
  loadingError: string | null;
  actionError: string | null;
  actionMessage: string | null;
}) {
  const message = actionError ?? loadingError ?? actionMessage;
  if (!message) {
    return null;
  }
  return (
    <div className={`workbench-message ${actionError || loadingError ? "is-error" : "is-success"}`}>
      {actionError || loadingError ? <CircleAlert size={15} /> : <CircleCheck size={15} />}
      {message}
    </div>
  );
}

function InspectorPanel({
  apiKeyDraft,
  credentialStatus,
  currentCombination,
  mode,
  recentTasks,
  selectedGarments,
  selectedPerson,
  validationResult,
  onApiKeyDraftChange,
  onImport,
  onModeChange,
  onSaveApiKey,
  onTaskChanged,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  currentCombination: ImageCombination | null;
  mode: SidePanelMode;
  recentTasks: GenerationTaskDetail[];
  selectedGarments: AssetFileView[];
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
  onApiKeyDraftChange: (value: string) => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onModeChange: (mode: SidePanelMode) => void;
  onSaveApiKey: () => void;
  onTaskChanged: (detail: GenerationTaskDetail | null) => void;
}) {
  return (
    <aside className="property-panel inspector-panel">
      <div className="property-panel__header">
        <div>
          <h2>检查器</h2>
          <p>
            当前组合： <strong>{currentCombination?.name ?? "未保存组合"}</strong>
          </p>
        </div>
        <ChevronLeft size={18} />
      </div>
      <div className="tabs">
        <button
          className={mode === "summary" ? "is-active" : ""}
          onClick={() => onModeChange("summary")}
          type="button"
        >
          摘要
        </button>
        <button
          className={mode === "settings" ? "is-active" : ""}
          onClick={() => onModeChange("settings")}
          type="button"
        >
          设置
        </button>
        <button
          className={mode === "history" ? "is-active" : ""}
          onClick={() => onModeChange("history")}
          type="button"
        >
          历史
        </button>
      </div>
      {mode === "summary" ? (
        <>
          <AssetDetailBlock
            title="人物图片"
            asset={selectedPerson}
            emptyText="还没有选择人物图"
            onImport={() => onImport("person")}
          />
          <GarmentDetailBlock garments={selectedGarments} onImport={() => onImport("garment")} />
          <ValidationDetailBlock
            combinationName={currentCombination?.name ?? "未保存组合"}
            validationResult={validationResult}
          />
        </>
      ) : null}
      {mode === "settings" ? (
        <ApiKeyDetailBlock
          apiKeyDraft={apiKeyDraft}
          credentialStatus={credentialStatus}
          onApiKeyDraftChange={onApiKeyDraftChange}
          onSaveApiKey={onSaveApiKey}
        />
      ) : null}
      {mode === "history" ? <TaskHistory tasks={recentTasks} onTaskChanged={onTaskChanged} /> : null}
      {mode !== "history" ? <TaskHistory tasks={recentTasks} onTaskChanged={onTaskChanged} /> : null}
    </aside>
  );
}

function AssetDetailBlock({
  title,
  asset,
  emptyText,
  onImport,
}: {
  title: string;
  asset: AssetFileView | null;
  emptyText: string;
  onImport: () => void;
}) {
  return (
    <section className="detail-block">
      <h3>{title}</h3>
      {asset ? (
        <div className="preview-card">
          <img alt={asset.asset.originalName} src={convertFileSrc(asset.thumbFilePath)} />
          <dl>
            <dt>文件名</dt>
            <dd>{asset.asset.originalName}</dd>
            <dt>尺寸</dt>
            <dd>{formatDimensions(asset.asset.width, asset.asset.height)}</dd>
            <dt>类型</dt>
            <dd>{asset.asset.mimeType}</dd>
            <dt>资产 ID</dt>
            <dd>{asset.asset.id}</dd>
            <dt>导入时间</dt>
            <dd>{formatTaskTime(asset.asset.createdAt)}</dd>
          </dl>
        </div>
      ) : (
        <div className="panel-empty">
          <ImageIcon size={24} />
          {emptyText}
        </div>
      )}
      <button className="ghost-wide" onClick={onImport} type="button">
        <RefreshCw size={15} />
        {asset ? "替换图片" : "导入图片"}
      </button>
    </section>
  );
}

function GarmentDetailBlock({
  garments,
  onImport,
}: {
  garments: AssetFileView[];
  onImport: () => void;
}) {
  return (
    <section className="detail-block">
      <h3>服装图片 <span>（最多 4 张）</span></h3>
      {garments.length ? (
        <div className="garment-detail-grid">
          {garments.map((asset) => (
            <img
              alt={asset.asset.originalName}
              key={asset.asset.id}
              src={convertFileSrc(asset.thumbFilePath)}
            />
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          <BriefcaseBusiness size={24} />
          还没有选择服装图
        </div>
      )}
      <button className="ghost-wide" onClick={onImport} type="button">
        <Import size={15} />
        导入服装图片
      </button>
    </section>
  );
}

function ValidationDetailBlock({
  combinationName,
  validationResult,
}: {
  combinationName: string;
  validationResult: ValidateCombinationResponse | null;
}) {
  return (
    <section className="detail-block">
      <h3>执行校验</h3>
      <dl className="plain-dl">
        <dt>组合</dt>
        <dd>{combinationName}</dd>
        <dt>状态</dt>
        <dd>{validationResult?.executable ? "可执行" : "不可执行"}</dd>
      </dl>
      {validationResult?.reasons.length ? (
        <ul className="validation-list">
          {validationResult.reasons.map((reason) => (
            <li key={`${reason.code}-${reason.field ?? reason.message}`}>{reason.message}</li>
          ))}
        </ul>
      ) : (
        <p className="panel-note">校验通过后，执行会先保存组合和 Prompt，再提交生成任务。</p>
      )}
    </section>
  );
}

function ApiKeyDetailBlock({
  apiKeyDraft,
  credentialStatus,
  onApiKeyDraftChange,
  onSaveApiKey,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  onApiKeyDraftChange: (value: string) => void;
  onSaveApiKey: () => void;
}) {
  return (
    <section className="detail-block">
      <h3>API Key</h3>
      <div className="credential-row">
        <div>
          <strong>{credentialStatus?.configured ? "已配置" : "未配置"}</strong>
          <span>{credentialStatus?.maskedKey ?? "保存后用于调用 OpenAI 图片模型"}</span>
        </div>
        <KeyRound size={18} />
      </div>
      <div className="api-key-row api-key-row--stacked">
        <input
          value={apiKeyDraft}
          onChange={(event) => onApiKeyDraftChange(event.target.value)}
          placeholder="OpenAI API Key"
          type="password"
        />
        <button disabled={!apiKeyDraft.trim()} onClick={onSaveApiKey} type="button">
          保存 API Key
        </button>
      </div>
    </section>
  );
}

function TaskHistory({
  tasks,
  onTaskChanged,
}: {
  tasks: GenerationTaskDetail[];
  onTaskChanged: (detail: GenerationTaskDetail | null) => void;
}) {
  async function handleRetry(taskId: string) {
    const task = await retryGenerationTask(taskId);
    const detail = await getGenerationTaskDetail(task.id);
    onTaskChanged(detail ?? { task, results: [] });
  }

  return (
    <section className="history-block">
      <div className="history-block__header">
        <h3>历史任务</h3>
        <span>{tasks.length} 条</span>
      </div>
      {tasks.length ? (
        tasks.slice(0, 6).map((item) => (
          <article className="history-item" key={item.task.id}>
            {item.results[0] ? (
              <img alt="任务结果" src={convertFileSrc(item.results[0].thumbFilePath)} />
            ) : (
              <span className="history-item__placeholder">
                <ImageIcon size={16} />
              </span>
            )}
            <div>
              <strong>{item.task.modelId}</strong>
              <span>
                {item.task.provider} <i /> {item.task.outputCount} 张
              </span>
            </div>
            <div className="history-item__meta">
              <b className={`status-${item.task.status === "failed" ? "danger" : "success"}`}>
                {getGenerationTaskStatusLabel(item.task.status)}
              </b>
              <time>{formatTaskTime(item.task.createdAt)}</time>
              {item.task.status === "failed" || item.task.status === "cancelled" ? (
                <button
                  onClick={() => {
                    void handleRetry(item.task.id);
                  }}
                  type="button"
                >
                  重试
                </button>
              ) : null}
            </div>
          </article>
        ))
      ) : (
        <div className="panel-empty">
          <Clock3 size={22} />
          暂无历史任务
        </div>
      )}
    </section>
  );
}

function BottomDashboard({
  currentCombination,
  latestTask,
}: {
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
}) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const setLatestTask = useGenerationTaskStore((state) => state.setLatestTask);
  const setRunningTasks = useGenerationTaskStore((state) => state.setRunningTasks);
  const setRecentTasks = useGenerationTaskStore((state) => state.setRecentTasks);
  const task = latestTask?.task ?? null;
  const results = latestTask?.results ?? [];
  const progress = Math.max(0, Math.min(100, task?.progress ?? 0));
  const ringStyle = {
    "--progress-offset": 302 - (302 * progress) / 100,
  } as CSSProperties;
  const taskStatus = getGenerationTaskStatusLabel(task?.status);
  const taskSteps = buildTaskProgressSteps(task?.status);
  const hasTask = Boolean(task);
  const canCancel = Boolean(task && isRunningTaskStatus(task.status) && !isCancelling);
  const cancellationNotice =
    cancelError ?? getCancellationNotice(task?.status, task?.cancelMode);

  async function handleCancelTask() {
    if (!task || !canCancel) {
      return;
    }
    setIsCancelling(true);
    setCancelError(null);
    try {
      const cancelledTask = await cancelGenerationTask(task.id);
      setLatestTask(latestTask ? { ...latestTask, task: cancelledTask } : null);
      const [runningTasks, recentTasks] = await Promise.all([
        listRunningGenerationTasks(),
        listRecentGenerationTasks(),
      ]);
      setRunningTasks(runningTasks);
      setRecentTasks(recentTasks);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "取消任务失败");
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <section className="task-dashboard-card">
      <div className="task-dashboard-card__header">
        <h2>任务状态</h2>
        <span>{taskStatus}</span>
      </div>
      <div className="progress-layout">
        <div className="progress-ring">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="48" />
            <circle
              cx="60"
              cy="60"
              r="48"
              className="progress-ring__value"
              style={ringStyle}
            />
          </svg>
          <strong>{progress}%</strong>
          <span>{taskStatus}</span>
        </div>
        <div className="progress-steps">
          {taskSteps.map((step) => (
            <div
              className={`progress-step ${step.state === "active" ? "is-active" : ""} ${step.state === "done" ? "is-done" : ""}`}
              key={step.label}
            >
              <span />
              <strong>{step.state === "active" ? "当前阶段：" : ""}{step.label}</strong>
              <time>{step.state === "done" ? "完成" : "--"}</time>
              {step.state === "done" ? (
                <CircleCheck size={14} fill="currentColor" />
              ) : (
                <Clock3 size={14} />
              )}
            </div>
          ))}
        </div>
      </div>
      <dl className="task-summary-list">
        <dt>组合名称</dt>
        <dd>{currentCombination?.name ?? "未选择组合"}</dd>
        <dt>模型</dt>
        <dd>{task?.modelId ?? "--"}</dd>
        <dt>尺寸</dt>
        <dd>{formatResultSize(results)}</dd>
        <dt>生成数量</dt>
        <dd>{task?.outputCount ?? "--"}</dd>
      </dl>
      <div className="task-actions">
        <button
          className="danger-button"
          disabled={!canCancel}
          onClick={() => {
            void handleCancelTask();
          }}
          type="button"
        >
          <CircleX size={15} />
          {isCancelling ? "取消中" : "取消任务"}
        </button>
        <button className="toolbar-button" disabled={!hasTask} type="button">
          <Eye size={15} />
          查看日志
        </button>
      </div>
      {cancellationNotice ? <p className="task-cancel-notice">{cancellationNotice}</p> : null}
    </section>
  );
}

type ProgressStepState = "done" | "active" | "pending";

const taskProgressStages: Array<{ status: string; label: string }> = [
  { status: "queued", label: "创建任务" },
  { status: "preparing", label: "准备请求" },
  { status: "calling_model", label: "调用模型" },
  { status: "waiting_result", label: "等待结果" },
  { status: "saving_result", label: "保存结果" },
];

function buildTaskProgressSteps(status: string | undefined) {
  const activeIndex = taskProgressStages.findIndex((step) => step.status === status);
  return taskProgressStages.map((step, index) => {
    let state: ProgressStepState = "pending";
    if (status === "succeeded") {
      state = "done";
    } else if (activeIndex >= 0 && index < activeIndex) {
      state = "done";
    } else if (activeIndex === index) {
      state = "active";
    }
    return { ...step, state };
  });
}

function getGenerationTaskStatusLabel(status: string | undefined) {
  switch (status) {
    case "queued":
      return "排队中";
    case "preparing":
      return "准备中";
    case "calling_model":
      return "调用中";
    case "waiting_result":
      return "等待结果";
    case "saving_result":
      return "保存中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "暂无任务";
  }
}

function isRunningTaskStatus(status: string) {
  return [
    "queued",
    "preparing",
    "calling_model",
    "waiting_result",
    "saving_result",
  ].includes(status);
}

function getCancellationNotice(status: string | undefined, cancelMode: string | null | undefined) {
  if (status && isRunningTaskStatus(status)) {
    return "取消会停止本地等待；如 Provider 不支持远端取消，可能仍继续处理或计费。";
  }
  if (cancelMode === "remote_not_supported") {
    return "已停止本地等待；Provider 不支持远端取消，可能仍继续处理或计费。";
  }
  if (cancelMode === "remote_failed") {
    return "已停止本地等待；远端取消失败，Provider 可能仍继续处理或计费。";
  }
  if (cancelMode === "remote_confirmed") {
    return "远端取消已确认。";
  }
  return null;
}

function formatResultSize(results: GenerationTaskResultAsset[]) {
  const first = results[0];
  return first ? `${first.width} × ${first.height}` : "--";
}

function formatDimensions(width: number | undefined, height: number | undefined) {
  return width && height ? `${width} × ${height}` : "--";
}

function formatTaskTime(value: string | undefined) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function AssetImage({ asset }: { asset: SelectableAsset }) {
  if (!asset.imageSrc) {
    return (
      <span className="node-empty">
        <ImageIcon size={22} />
      </span>
    );
  }
  return <img alt={asset.label} src={asset.imageSrc} />;
}

function ResultPreview({ results }: { results: GenerationTaskResultAsset[] }) {
  if (!results.length) {
    return (
      <section className="result-preview-card">
        <div className="task-dashboard-card__header">
          <h2>结果预览</h2>
          <span>等待生成</span>
        </div>
        <div className="result-empty-state">
          <ImageIcon size={34} />
          <strong>暂无生成结果</strong>
          <span>任务成功后会在这里显示缩略图，点击可打开大图。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="result-preview-card">
      <div className="task-dashboard-card__header">
        <h2>结果预览</h2>
        <span>{results.length} 张</span>
      </div>
      <div className="preview-results">
        {results.slice(0, 6).map((result) => (
          <button
            className="result-card"
            key={result.id}
            onClick={() => {
              openGenerationResult(result.assetId).catch(() => undefined);
            }}
            type="button"
          >
            <img alt="生成结果" src={convertFileSrc(result.thumbFilePath)} />
            <strong>{result.width} × {result.height}</strong>
            <small>打开大图</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function StatusBar() {
  return (
    <footer className="status-bar">
      <span>工作区：本地 Commerce Shoot Studio 工作区</span>
      <FolderOpen size={15} />
      <div className="status-bar__right">
        <span className="service-dot" />
        本地服务运行中
        <b>v1.0.0</b>
      </div>
    </footer>
  );
}
