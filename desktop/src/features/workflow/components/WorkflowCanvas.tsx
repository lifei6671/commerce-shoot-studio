import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type OnMove,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Archive,
  Box,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  Grid3X3,
  Hand,
  ImageIcon,
  Import,
  KeyRound,
  Maximize2,
  Menu,
  Minus,
  MousePointer2,
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
  ImageCombinationSummary,
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
import {
  buildWorkflowEdges,
  cloneInitialWorkflowNodePositions,
  isFlowNodeId,
  WORKFLOW_NODE_ORDER,
  type FlowNodeId,
  type FlowNodePosition,
} from "./workflowFlowGraph";

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

type SidePanelMode = "details" | "edit" | "links" | "history";
type CanvasTool = "hand" | "select" | "grid";
type WorkflowNodeData = Record<string, unknown> & {
  accent: "green" | "blue" | "purple" | "orange" | "gray";
  body: ReactNode;
  nodeId: FlowNodeId;
  selected: boolean;
  status: "done" | "pending" | "required";
  subtitle: string;
  title: string;
};
type WorkflowReactFlowNode = Node<WorkflowNodeData, "workflowNode">;
type WorkflowReactFlowEdge = Edge<Record<string, never>, "straight">;

const CANVAS_MIN_ZOOM = 33;
const CANVAS_MAX_ZOOM = 300;
const CANVAS_ZOOM_LEVELS = [33, 50, 75, 100, 125, 150, 200, 300] as const;
const ACTION_MESSAGE_AUTO_DISMISS_MS = 2400;
const REACT_FLOW_DEFAULT_VIEWPORT: Viewport = { x: 40, y: 158, zoom: 1 };

type NewCombinationForm = {
  name: string;
  code: string;
  description: string;
  personAssetId: string | null;
  garmentAssetIds: string[];
  promptTemplate: string;
  modelId: string;
  size: (typeof MODEL_SIZES)[number];
  outputCount: number;
  openAfterCreate: boolean;
};

// Backwards-compatible export for the node wrapper files.
export function WorkflowNode() {
  return null;
}

export function WorkflowCanvas() {
  const [currentCombination, setCurrentCombination] = useState<ImageCombination | null>(null);
  const [combinationSummaries, setCombinationSummaries] = useState<ImageCombinationSummary[]>([]);
  const [people, setPeople] = useState<AssetFileView[]>([]);
  const [garments, setGarments] = useState<AssetFileView[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([]);
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT_TEXT);
  const [modelSize, setModelSize] = useState<(typeof MODEL_SIZES)[number]>("1024x1024");
  const [outputCount, setOutputCount] = useState(1);
  const [draftCombinationName, setDraftCombinationName] = useState<string | null>(null);
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
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>("details");
  const [selectedFlowNode, setSelectedFlowNode] = useState<FlowNodeId>("person");
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("hand");
  const [zoom, setZoom] = useState(100);
  const [canvasResetRevision, setCanvasResetRevision] = useState(0);
  const [isAssetLibraryCollapsed, setIsAssetLibraryCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isBottomDashboardCollapsed, setIsBottomDashboardCollapsed] = useState(false);
  const [newCombinationForm, setNewCombinationForm] =
    useState<NewCombinationForm>(() => buildNewCombinationForm());
  const [isNewCombinationModalOpen, setIsNewCombinationModalOpen] = useState(false);
  const [newCombinationError, setNewCombinationError] = useState<string | null>(null);
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
  const combinationName = currentCombination?.name ?? draftCombinationName ?? "未保存组合";

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
    setCombinationSummaries(combinations);

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

  async function handleSelectCombination(combinationId: string) {
    if (!combinationId || combinationId === currentCombination?.id) {
      return;
    }

    setActionError(null);
    setActionMessage(null);
    try {
      const combination = await getImageCombination(combinationId);
      if (!combination) {
        throw new Error("未找到选择的组合");
      }
      setCurrentCombination(combination);
      setDraftCombinationName(null);
      setSelectedPersonId(combination.personAssetId);
      setSelectedGarmentIds(combination.garmentAssetIds);
      setLatestTask(await getLatestGenerationTaskByCombination(combination.id));
      setSelectedFlowNode("person");
      setSidePanelMode("details");
      setActionMessage("组合已切换");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "切换组合失败");
    }
  }

  useEffect(() => {
    if (!actionMessage) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setActionMessage((currentMessage) =>
        currentMessage === actionMessage ? null : currentMessage,
      );
    }, ACTION_MESSAGE_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [actionMessage]);

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
        name: currentCombination?.name ?? draftCombinationName ?? buildCombinationName(),
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
    draftCombinationName,
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
      multiple: true,
      title: getImageDialogTitle(assetType),
      filters: [
        {
          name: "图片文件",
          extensions: ["png", "jpg", "jpeg"],
        },
      ],
    });

    const selectedPaths = normalizeSelectedImagePaths(selected);
    if (!selectedPaths.length) {
      return;
    }

    setImportingType(assetType);
    setActionError(null);
    setActionMessage(null);
    try {
      const { views, duplicateCount } = await importSelectedImages(selectedPaths, assetType);
      if (assetType === "person") {
        setPeople((items) => upsertAssets(items, views));
        setSelectedPersonId(views[0].asset.id);
      } else {
        const importedIds = views.map((view) => view.asset.id);
        setGarments((items) => upsertAssets(items, views));
        setSelectedGarmentIds((ids) =>
          [...importedIds, ...ids.filter((id) => !importedIds.includes(id))].slice(0, 4),
        );
      }
      setActionMessage(buildImportSuccessMessage(views.length, duplicateCount));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "导入图片失败");
    } finally {
      setImportingType(null);
    }
  }

  async function handleImportForNewCombination(
    assetType: Extract<AssetType, "person" | "garment">,
  ) {
    const selected = await open({
      multiple: true,
      title: getImageDialogTitle(assetType),
      filters: [
        {
          name: "图片文件",
          extensions: ["png", "jpg", "jpeg"],
        },
      ],
    });

    const selectedPaths = normalizeSelectedImagePaths(selected);
    if (!selectedPaths.length) {
      return;
    }

    setImportingType(assetType);
    setNewCombinationError(null);
    try {
      const { views, duplicateCount } = await importSelectedImages(selectedPaths, assetType);

      if (assetType === "person") {
        setPeople((items) => upsertAssets(items, views));
        setNewCombinationForm((form) => ({
          ...form,
          personAssetId: views[0].asset.id,
        }));
      } else {
        const importedIds = views.map((view) => view.asset.id);
        setGarments((items) => upsertAssets(items, views));
        setNewCombinationForm((form) => ({
          ...form,
          garmentAssetIds: [
            ...importedIds,
            ...form.garmentAssetIds.filter((id) => !importedIds.includes(id)),
          ].slice(0, 4),
        }));
      }

      setActionMessage(buildImportSuccessMessage(views.length, duplicateCount));
    } catch (error) {
      setNewCombinationError(error instanceof Error ? error.message : "导入图片失败");
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
      name: currentCombination?.name ?? draftCombinationName ?? buildCombinationName(),
      personAssetId: selectedPersonId,
      garmentAssetIds: selectedGarmentIds,
    });
    setCurrentCombination(saved);
    setCombinationSummaries((summaries) => upsertCombinationSummary(summaries, saved));
    setDraftCombinationName(null);
    await savePromptBinding(buildPromptBinding(saved.id, promptText));
    await refreshTaskLists();
    return saved;
  }

  function openNewCombinationModal() {
    setNewCombinationForm(buildNewCombinationForm());
    setNewCombinationError(null);
    setIsNewCombinationModalOpen(true);
  }

  async function handleCreateCombination() {
    const name = newCombinationForm.name.trim();
    if (!name) {
      setNewCombinationError("请填写组合名称");
      return;
    }

    const nextGarmentIds = newCombinationForm.garmentAssetIds.slice(0, 4);
    if (!newCombinationForm.personAssetId) {
      setNewCombinationError("请选择或导入一张人物图片");
      return;
    }
    if (!nextGarmentIds.length) {
      setNewCombinationError("请选择或导入至少一张服装图片");
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setNewCombinationError(null);
    setPromptText(DEFAULT_PROMPT_TEXT);
    setModelSize(newCombinationForm.size);
    setOutputCount(newCombinationForm.outputCount);
    setSelectedPersonId(newCombinationForm.personAssetId);
    setSelectedGarmentIds(nextGarmentIds);

    setIsSaving(true);
    try {
      const saved = await saveImageCombination({
        name,
        personAssetId: newCombinationForm.personAssetId,
        garmentAssetIds: nextGarmentIds,
      });
      setCurrentCombination(saved);
      setCombinationSummaries((summaries) => upsertCombinationSummary(summaries, saved));
      setDraftCombinationName(null);
      await savePromptBinding(buildPromptBinding(saved.id, DEFAULT_PROMPT_TEXT));
      setLatestTask(null);
      await refreshTaskLists();
      setIsNewCombinationModalOpen(false);
      setSelectedFlowNode(newCombinationForm.openAfterCreate ? "person" : selectedFlowNode);
      setSidePanelMode("details");
      setActionMessage("组合已创建");
    } catch (error) {
      setNewCombinationError(error instanceof Error ? error.message : "创建组合失败");
    } finally {
      setIsSaving(false);
    }
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

  function handleRefreshWorkspace() {
    setZoom(100);
    setCanvasResetRevision((revision) => revision + 1);
    handleRefreshAll();
  }

  const showWindowChrome = isWindowsPlatform();
  const workbenchBodyClassName = [
    "workbench__body",
    "workbench__body--app",
    isAssetLibraryCollapsed ? "workbench__body--left-collapsed" : "",
    isInspectorCollapsed ? "workbench__body--right-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`desktop-frame${showWindowChrome ? "" : " desktop-frame--native-titlebar"}`}>
      {showWindowChrome ? <WindowChrome /> : null}
      <div className="workbench">
        <TopToolbar
          combinationName={combinationName}
          combinationSummaries={combinationSummaries}
          currentCombinationId={currentCombination?.id ?? ""}
          canRun={canRun}
          isSaving={isSaving}
          isStarting={isStarting}
          onHistory={() => {
            setSelectedFlowNode("result");
            setSidePanelMode("history");
          }}
          onModelSettings={() => {
            setSelectedFlowNode("model");
            setSidePanelMode("edit");
          }}
          onNew={openNewCombinationModal}
          onPromptTemplate={() => setPromptText(DEFAULT_PROMPT_TEXT)}
          onRefresh={handleRefreshWorkspace}
          onSelectCombination={(combinationId) => {
            void handleSelectCombination(combinationId);
          }}
          onSave={() => {
            void handleSaveCombination();
          }}
          onRun={() => {
            void handleStartGeneration();
          }}
        />
        <div className={workbenchBodyClassName}>
          {isAssetLibraryCollapsed ? (
            <PanelRestoreButton
              label="展开资源库"
              side="left"
              onClick={() => setIsAssetLibraryCollapsed(false)}
            />
          ) : (
            <AssetLibrary
              people={people}
              garments={garments}
              results={resultAssets}
              selectedPersonId={selectedPersonId}
              selectedGarmentIds={selectedGarmentIds}
              importingType={importingType}
              onCollapse={() => setIsAssetLibraryCollapsed(true)}
              onImport={(assetType) => {
                void handleImport(assetType);
              }}
              onRefresh={handleRefreshAll}
              onSelectPerson={setSelectedPersonId}
              onToggleGarment={toggleGarment}
            />
          )}
          <main className={`canvas-column${isBottomDashboardCollapsed ? " canvas-column--bottom-collapsed" : ""}`}>
            <WorkbenchMessages
              loadingError={loadingError}
              actionError={actionError}
              actionMessage={actionMessage}
            />
            <FlowWorkbench
              canRun={canRun}
              canvasTool={canvasTool}
              credentialStatus={credentialStatus}
              currentCombination={currentCombination}
              latestTask={latestTask}
              modelSize={modelSize}
              outputCount={outputCount}
              promptText={promptText}
              results={resultAssets}
              selectedFlowNode={selectedFlowNode}
              selectedGarments={selectedGarments}
              selectedPerson={selectedPerson}
              validationResult={validationResult}
              resetRevision={canvasResetRevision}
              zoom={zoom}
              onCanvasToolChange={setCanvasTool}
              onNodeSelect={(nodeId) => {
                setSelectedFlowNode(nodeId);
                setSidePanelMode("details");
              }}
              onRun={() => {
                void handleStartGeneration();
              }}
              onZoomChange={setZoom}
            />
            {isBottomDashboardCollapsed ? (
              <button
                className="bottom-panel-restore"
                onClick={() => setIsBottomDashboardCollapsed(false)}
                type="button"
                aria-label="展开任务面板"
              >
                <ChevronUp size={15} />
                <span>任务面板</span>
              </button>
            ) : (
              <BottomDashboard
                currentCombination={currentCombination}
                latestTask={latestTask}
                onCollapse={() => setIsBottomDashboardCollapsed(true)}
              />
            )}
          </main>
          {isInspectorCollapsed ? (
            <PanelRestoreButton
              label="展开属性面板"
              side="right"
              onClick={() => setIsInspectorCollapsed(false)}
            />
          ) : (
            <InspectorPanel
              apiKeyDraft={apiKeyDraft}
              credentialStatus={credentialStatus}
              currentCombination={currentCombination}
              latestTask={latestTask}
              mode={sidePanelMode}
              modelSize={modelSize}
              outputCount={outputCount}
              promptText={promptText}
              recentTasks={recentTasks}
              results={resultAssets}
              selectedFlowNode={selectedFlowNode}
              selectedGarments={selectedGarments}
              selectedPerson={selectedPerson}
              validationResult={validationResult}
              onApiKeyDraftChange={setApiKeyDraft}
              onCollapse={() => setIsInspectorCollapsed(true)}
              onImport={(assetType) => {
                void handleImport(assetType);
              }}
              onModelSizeChange={setModelSize}
              onModeChange={setSidePanelMode}
              onOutputCountChange={setOutputCount}
              onPromptChange={setPromptText}
              onSaveApiKey={() => {
                void handleSaveApiKey();
              }}
              onSelectNode={setSelectedFlowNode}
              onTaskChanged={(detail) => {
                setLatestTask(detail);
                void refreshTaskLists();
              }}
            />
          )}
        </div>
      </div>
      {isNewCombinationModalOpen ? (
        <NewCombinationModal
          error={newCombinationError}
          form={newCombinationForm}
          garments={garments}
          isSaving={isSaving}
          importingType={importingType}
          people={people}
          onCancel={() => {
            setIsNewCombinationModalOpen(false);
            setNewCombinationError(null);
          }}
          onCreate={() => {
            void handleCreateCombination();
          }}
          onFormChange={setNewCombinationForm}
          onImport={(assetType) => {
            void handleImportForNewCombination(assetType);
          }}
        />
      ) : null}
      <StatusBar />
    </div>
  );
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function isWindowsPlatform() {
  const userAgentNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const userAgentPlatform = userAgentNavigator.userAgentData?.platform;
  const platform = userAgentPlatform || navigator.platform || "";
  return platform.toLowerCase().includes("win");
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

function buildNewCombinationForm(
  override: Partial<NewCombinationForm> = {},
): NewCombinationForm {
  return {
    name: "",
    code: "",
    description: "",
    personAssetId: null,
    garmentAssetIds: [],
    promptTemplate: "默认模板（通用）",
    modelId: "FLUX.1 dev",
    size: "1024x1536",
    outputCount: 3,
    openAfterCreate: true,
    ...override,
  };
}

function normalizeSelectedImagePaths(selected: string | string[] | null): string[] {
  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}

async function importSelectedImages(
  selectedPaths: string[],
  assetType: Extract<AssetType, "person" | "garment">,
) {
  const views: AssetFileView[] = [];
  let duplicateCount = 0;
  for (const path of selectedPaths) {
    const response = await importImage(path, assetType);
    if (response.duplicate) {
      duplicateCount += 1;
    }
    const view = await getAsset(response.asset.id);
    if (!view) {
      throw new Error("导入后未找到资产记录");
    }
    views.push(view);
  }
  return { views, duplicateCount };
}

function buildImportSuccessMessage(totalCount: number, duplicateCount: number) {
  if (totalCount === duplicateCount) {
    return totalCount > 1 ? `已选择 ${totalCount} 张已存在的相同图片` : "已选择已存在的相同图片";
  }
  if (duplicateCount > 0) {
    return `图片导入成功，${duplicateCount} 张已存在`;
  }
  return totalCount > 1 ? `已导入 ${totalCount} 张图片` : "图片导入成功";
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

function upsertAssets(items: AssetFileView[], assets: AssetFileView[]) {
  return assets.reduceRight((nextItems, asset) => upsertAsset(nextItems, asset), items);
}

function upsertCombinationSummary(
  summaries: ImageCombinationSummary[],
  combination: ImageCombination,
) {
  const summary: ImageCombinationSummary = {
    id: combination.id,
    name: combination.name,
    personAssetId: combination.personAssetId,
    garmentCount: combination.garmentAssetIds.length,
    createdAt: combination.createdAt,
    updatedAt: combination.updatedAt,
  };
  return [summary, ...summaries.filter((item) => item.id !== combination.id)];
}

function toSelectableAsset(view: AssetFileView, selected: boolean): SelectableAsset {
  return {
    id: view.asset.id,
    imageSrc: assetThumbSrc(view),
    label: view.asset.originalName,
    selected,
    width: view.asset.width,
    height: view.asset.height,
    mimeType: view.asset.mimeType,
    createdAt: view.asset.createdAt,
  };
}

function assetThumbSrc(asset: AssetFileView) {
  return asset.thumbDataUrl || convertFileSrc(asset.thumbFilePath);
}

function getImageDialogTitle(assetType: Extract<AssetType, "person" | "garment">) {
  return assetType === "person" ? "选择人物图片" : "选择服装图片";
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
  combinationSummaries,
  currentCombinationId,
  canRun,
  isSaving,
  isStarting,
  onHistory,
  onModelSettings,
  onNew,
  onPromptTemplate,
  onRefresh,
  onSelectCombination,
  onSave,
  onRun,
}: {
  combinationName: string;
  combinationSummaries: ImageCombinationSummary[];
  currentCombinationId: string;
  canRun: boolean;
  isSaving: boolean;
  isStarting: boolean;
  onHistory: () => void;
  onModelSettings: () => void;
  onNew: () => void;
  onPromptTemplate: () => void;
  onRefresh: () => void;
  onSelectCombination: (combinationId: string) => void;
  onSave: () => void;
  onRun: () => void;
}) {
  return (
    <nav className="top-toolbar" aria-label="工作台工具栏">
      <label className="combo-select">
        <span>当前组合：</span>
        <select
          aria-label="切换组合"
          disabled={combinationSummaries.length === 0}
          value={currentCombinationId}
          onChange={(event) => onSelectCombination(event.target.value)}
        >
          {currentCombinationId ? null : <option value="">{combinationName}</option>}
          {combinationSummaries.map((combination) => (
            <option key={combination.id} value={combination.id}>
              {combination.name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </label>
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

function NewCombinationModal({
  error,
  form,
  garments,
  importingType,
  isSaving,
  people,
  onCancel,
  onCreate,
  onFormChange,
  onImport,
}: {
  error: string | null;
  form: NewCombinationForm;
  garments: AssetFileView[];
  importingType: Extract<AssetType, "person" | "garment"> | null;
  isSaving: boolean;
  people: AssetFileView[];
  onCancel: () => void;
  onCreate: () => void;
  onFormChange: (form: NewCombinationForm) => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
}) {
  const selectedPerson = people.find((asset) => asset.asset.id === form.personAssetId) ?? null;
  const selectedGarments = form.garmentAssetIds
    .map((assetId) => garments.find((asset) => asset.asset.id === assetId))
    .filter((asset): asset is AssetFileView => Boolean(asset));

  function updateForm(patch: Partial<NewCombinationForm>) {
    onFormChange({ ...form, ...patch });
  }

  function toggleGarmentForDraft(assetId: string) {
    const nextIds = form.garmentAssetIds.includes(assetId)
      ? form.garmentAssetIds.filter((id) => id !== assetId)
      : [assetId, ...form.garmentAssetIds].slice(0, 4);
    updateForm({ garmentAssetIds: nextIds });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="new-combination-modal" aria-modal="true" role="dialog">
        <header className="modal-header">
          <div>
            <h2>新建组合</h2>
            <p>创建一个新的图片组合，开始你的生图流程</p>
          </div>
          <button onClick={onCancel} type="button" aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        {error ? (
          <div className="modal-error">
            <CircleAlert size={15} />
            {error}
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <div className="modal-form-scroll">
            <section className="modal-section">
              <h3>1. 基本信息</h3>
              <div className="modal-field-grid">
                <label>
                  <span>
                    <b>*</b> 组合名称
                  </span>
                  <div className="modal-input-wrap">
                    <input
                      maxLength={50}
                      value={form.name}
                      onChange={(event) => updateForm({ name: event.target.value })}
                    />
                    <small>{form.name.length}/50</small>
                  </div>
                </label>
                <label>
                  <span>组合编码（可选）</span>
                  <div className="modal-input-wrap">
                    <input
                      maxLength={50}
                      value={form.code}
                      onChange={(event) => updateForm({ code: event.target.value })}
                    />
                    <small>{form.code.length}/50</small>
                  </div>
                </label>
              </div>
              <label className="modal-field-block">
                <span>描述（可选）</span>
                <div className="modal-input-wrap modal-input-wrap--textarea">
                  <textarea
                    maxLength={200}
                    rows={3}
                    placeholder="输入组合的描述，帮助你更好地管理和识别"
                    value={form.description}
                    onChange={(event) => updateForm({ description: event.target.value })}
                  />
                  <small>{form.description.length}/200</small>
                </div>
              </label>
            </section>
            <section className="modal-section">
              <h3>2. 选择初始素材 <span>（创建入库前必须选择人物图和服装图）</span></h3>
              <div className="modal-asset-layout">
                <ModalAssetPicker
                  assets={people}
                  emptyText="暂无人物图"
                  importLabel={importingType === "person" ? "导入中" : "导入人物图"}
                  isImporting={importingType === "person"}
                  label="人物图片"
                  selectedIds={form.personAssetId ? [form.personAssetId] : []}
                  helperText="点击缩略图选择，或从本地导入新人物图"
                  onImport={() => onImport("person")}
                  onSelect={(assetId) => updateForm({ personAssetId: assetId })}
                />
                <ModalAssetPreview
                  emptyIcon={<ImageIcon size={34} />}
                  emptyText="尚未选择人物图片"
                  images={selectedPerson ? [selectedPerson] : []}
                  label="预览"
                />
                <ModalAssetPicker
                  assets={garments}
                  emptyText="暂无服装图"
                  importLabel={importingType === "garment" ? "导入中" : "导入服装图"}
                  isImporting={importingType === "garment"}
                  label="服装图片（至少 1 张建议多角度）"
                  selectedIds={form.garmentAssetIds}
                  helperText="可选择多张，最多 4 张，顺序按选择时间排列"
                  onImport={() => onImport("garment")}
                  onSelect={toggleGarmentForDraft}
                />
                <ModalAssetPreview
                  emptyIcon={<Grid3X3 size={34} />}
                  emptyText="尚未选择服装图片"
                  images={selectedGarments}
                  label="预览"
                />
              </div>
            </section>
            <section className="modal-section">
              <h3>3. 默认设置</h3>
              <div className="modal-setting-grid">
                <label>
                  默认 Prompt 模板
                  <select
                    value={form.promptTemplate}
                    onChange={(event) => updateForm({ promptTemplate: event.target.value })}
                  >
                    <option>默认模板（通用）</option>
                  </select>
                </label>
                <label>
                  默认模型
                  <select
                    value={form.modelId}
                    onChange={(event) => updateForm({ modelId: event.target.value })}
                  >
                    <option>FLUX.1 dev</option>
                    <option>{DEFAULT_MODEL_ID}</option>
                  </select>
                </label>
                <label>
                  默认尺寸
                  <select
                    value={form.size}
                    onChange={(event) =>
                      updateForm({ size: event.target.value as (typeof MODEL_SIZES)[number] })
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
                  默认生成数量
                  <span className="modal-stepper">
                    <button
                      onClick={() => updateForm({ outputCount: Math.max(1, form.outputCount - 1) })}
                      type="button"
                      aria-label="减少生成数量"
                    >
                      <Minus size={15} />
                    </button>
                    <input value={form.outputCount} readOnly />
                    <button
                      onClick={() => updateForm({ outputCount: Math.min(4, form.outputCount + 1) })}
                      type="button"
                      aria-label="增加生成数量"
                    >
                      <Plus size={15} />
                    </button>
                  </span>
                </label>
              </div>
            </section>
          </div>
          <footer className="modal-footer">
            <label className="modal-checkbox">
              <input
                checked={form.openAfterCreate}
                onChange={(event) => updateForm({ openAfterCreate: event.target.checked })}
                type="checkbox"
              />
              创建后立即打开并进入编辑
            </label>
            <div>
              <button className="toolbar-button" onClick={onCancel} type="button">
                取消
              </button>
              <button className="primary-action" disabled={isSaving || !form.name.trim()} type="submit">
                {isSaving ? "创建中" : "创建组合"}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ModalAssetPicker({
  assets,
  emptyText,
  helperText,
  importLabel,
  isImporting,
  label,
  selectedIds,
  onImport,
  onSelect,
}: {
  assets: AssetFileView[];
  emptyText: string;
  helperText: string;
  importLabel: string;
  isImporting: boolean;
  label: string;
  selectedIds: string[];
  onImport: () => void;
  onSelect: (assetId: string) => void;
}) {
  return (
    <div className="modal-asset-picker">
      <div className="modal-asset-picker__header">
        <strong>{label}</strong>
        <button disabled={isImporting} onClick={onImport} type="button">
          <Import size={13} />
          {importLabel}
        </button>
      </div>
      {assets.length ? (
        <div className="modal-dropzone has-assets">
          <div className="modal-resource-grid">
            {assets.slice(0, 8).map((asset) => (
              <button
                className={selectedIds.includes(asset.asset.id) ? "is-selected" : ""}
                key={asset.asset.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(asset.asset.id);
                }}
                type="button"
              >
                <img alt={asset.asset.originalName} src={assetThumbSrc(asset)} />
                {selectedIds.includes(asset.asset.id) ? (
                  <i>
                    <CircleCheck size={13} fill="currentColor" />
                  </i>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          className="modal-dropzone modal-dropzone--empty"
          disabled={isImporting}
          onClick={onImport}
          type="button"
        >
          <>
            <Import size={30} />
            <span>{emptyText}</span>
            <small>点击这里从本地选择图片</small>
          </>
        </button>
      )}
      <small className="modal-picker-hint">{helperText}</small>
    </div>
  );
}

function ModalAssetPreview({
  emptyIcon,
  emptyText,
  images,
  label,
}: {
  emptyIcon: ReactNode;
  emptyText: string;
  images: AssetFileView[];
  label: string;
}) {
  return (
    <div className="modal-asset-preview">
      <strong>{label}</strong>
      <div className={images.length > 1 ? "modal-preview-grid" : "modal-preview-single"}>
        {images.length ? (
          images.slice(0, 4).map((asset) => (
            <img
              alt={asset.asset.originalName}
              key={asset.asset.id}
              src={assetThumbSrc(asset)}
            />
          ))
        ) : (
          <div>
            {emptyIcon}
            <span>{emptyText}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetLibrary({
  people,
  garments,
  results,
  selectedPersonId,
  selectedGarmentIds,
  importingType,
  onCollapse,
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
  onCollapse: () => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onRefresh: () => void;
  onSelectPerson: (assetId: string) => void;
  onToggleGarment: (assetId: string) => void;
}) {
  return (
    <aside className="asset-library">
      <div className="panel-title">
        <h2>资源库</h2>
        <button
          className="panel-collapse-button"
          onClick={onCollapse}
          title="折叠资源库"
          type="button"
          aria-label="折叠资源库"
        >
          <Menu size={18} />
        </button>
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

function FlowWorkbench({
  canRun,
  canvasTool,
  credentialStatus,
  currentCombination,
  latestTask,
  modelSize,
  outputCount,
  promptText,
  results,
  selectedFlowNode,
  selectedGarments,
  selectedPerson,
  validationResult,
  resetRevision,
  zoom,
  onCanvasToolChange,
  onNodeSelect,
  onRun,
  onZoomChange,
}: {
  canRun: boolean;
  canvasTool: CanvasTool;
  credentialStatus: ProviderCredentialStatus | null;
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptText: string;
  results: GenerationTaskResultAsset[];
  selectedFlowNode: FlowNodeId;
  selectedGarments: AssetFileView[];
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
  resetRevision: number;
  zoom: number;
  onCanvasToolChange: (tool: CanvasTool) => void;
  onNodeSelect: (nodeId: FlowNodeId) => void;
  onRun: () => void;
  onZoomChange: (zoom: number) => void;
}) {
  const [nodePositions, setNodePositions] = useState<Record<FlowNodeId, FlowNodePosition>>(
    cloneInitialWorkflowNodePositions,
  );
  const [viewport, setViewport] = useState<Viewport>(REACT_FLOW_DEFAULT_VIEWPORT);
  const [flowInstanceRevision, setFlowInstanceRevision] = useState(0);
  const reactFlowRef = useRef<ReactFlowInstance<WorkflowReactFlowNode, WorkflowReactFlowEdge> | null>(
    null,
  );
  const taskStatus = getGenerationTaskStatusLabel(latestTask?.task.status);
  const modelReady = credentialStatus?.configured === true;
  const taskInProgress = latestTask
    ? ["queued", "preparing", "calling_model", "waiting_result", "saving_result"].includes(
        latestTask.task.status,
      )
    : false;
  const workflowEdges = useMemo<WorkflowReactFlowEdge[]>(
    () =>
      buildWorkflowEdges().map((edge) => ({
        ...edge,
        animated: taskInProgress && edge.target === "result",
        className: "flow-edge",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#111827",
          width: 18,
          height: 18,
        },
        style: {
          stroke: "#111827",
          strokeWidth: 1.7,
        },
      })),
    [taskInProgress],
  );
  const nodeTypes = useMemo(() => ({ workflowNode: FlowNode }), []);

  useEffect(() => {
    const nextZoom = clampZoom(zoom) / 100;
    setViewport((currentViewport) => {
      if (Math.abs(currentViewport.zoom - nextZoom) < 0.001) {
        return currentViewport;
      }
      return { ...currentViewport, zoom: nextZoom };
    });
  }, [zoom]);

  useEffect(() => {
    setNodePositions(cloneInitialWorkflowNodePositions());
    setViewport(REACT_FLOW_DEFAULT_VIEWPORT);
    setFlowInstanceRevision((revision) => revision + 1);
  }, [resetRevision]);

  const flowNodes = useMemo<WorkflowReactFlowNode[]>(
    () => [
      createWorkflowNode({
        accent: "green",
        body: selectedPerson ? (
          <>
            <img
              className="flow-node__hero-image"
              alt={selectedPerson.asset.originalName}
              src={assetThumbSrc(selectedPerson)}
            />
            <small>{selectedPerson.asset.originalName}</small>
            <strong>{formatDimensions(selectedPerson.asset.width, selectedPerson.asset.height)}</strong>
          </>
        ) : (
          <NodeEmpty icon={<UserRound size={24} />} text="导入人物图" />
        ),
        nodeId: "person",
        position: nodePositions.person,
        selected: selectedFlowNode === "person",
        status: selectedPerson ? "done" : "required",
        subtitle: selectedPerson ? "必选" : "未选择",
        title: "人物图",
      }),
      createWorkflowNode({
        accent: "blue",
        body: selectedGarments.length ? (
          <>
            <div className="flow-node__image-grid">
              {selectedGarments.slice(0, 4).map((asset) => (
                <img alt={asset.asset.originalName} key={asset.asset.id} src={assetThumbSrc(asset)} />
              ))}
            </div>
            <span className="flow-node__count">{selectedGarments.length} 张</span>
          </>
        ) : (
          <NodeEmpty icon={<BriefcaseBusiness size={24} />} text="导入服装图" />
        ),
        nodeId: "garments",
        position: nodePositions.garments,
        selected: selectedFlowNode === "garments",
        status: selectedGarments.length ? "done" : "required",
        subtitle: "至少 1 张",
        title: "服装图组",
      }),
      createWorkflowNode({
        accent: "purple",
        body: (
          <>
            <div className="flow-node__document">
              <FileText size={42} />
              <span>用户 Prompt</span>
            </div>
            <strong>{promptText.trim().length} 字符</strong>
          </>
        ),
        nodeId: "prompt",
        position: nodePositions.prompt,
        selected: selectedFlowNode === "prompt",
        status: promptText.trim() ? "done" : "required",
        subtitle: promptText.trim() ? "已配置" : "未配置",
        title: "Prompt",
      }),
      createWorkflowNode({
        accent: "orange",
        body: (
          <>
            <div className="flow-node__model">
              <Box size={44} />
            </div>
            <strong>{DEFAULT_MODEL_ID}</strong>
            <small>
              {modelSize} / {outputCount} 张
            </small>
          </>
        ),
        nodeId: "model",
        position: nodePositions.model,
        selected: selectedFlowNode === "model",
        status: modelReady ? "done" : "pending",
        subtitle: modelReady ? "已选择" : "待配置",
        title: "模型",
      }),
      createWorkflowNode({
        accent: "blue",
        body: (
          <>
            <button
              className="flow-node__play nodrag nopan"
              disabled={!canRun}
              onClick={(event) => {
                event.stopPropagation();
                onRun();
              }}
              type="button"
            >
              <Play size={30} fill="currentColor" />
            </button>
            <small>{canRun ? "点击执行生成" : "输入未完整"}</small>
          </>
        ),
        nodeId: "execute",
        position: nodePositions.execute,
        selected: selectedFlowNode === "execute",
        status: validationResult?.executable ? "done" : "required",
        subtitle: canRun ? "就绪" : "待补齐",
        title: "执行",
      }),
      createWorkflowNode({
        accent: "gray",
        body: results.length ? (
          <div className="flow-node__image-grid flow-node__image-grid--results">
            {results.slice(0, 4).map((result) => (
              <img alt="生成结果" key={result.id} src={convertFileSrc(result.thumbFilePath)} />
            ))}
          </div>
        ) : (
          <NodeEmpty icon={<ImageIcon size={28} />} text={`将生成 ${outputCount} 张图片`} />
        ),
        nodeId: "result",
        position: nodePositions.result,
        selected: selectedFlowNode === "result",
        status: results.length ? "done" : "pending",
        subtitle: taskStatus,
        title: "结果",
      }),
    ],
    [
      canRun,
      modelReady,
      modelSize,
      nodePositions,
      onRun,
      outputCount,
      promptText,
      results,
      selectedFlowNode,
      selectedGarments,
      selectedPerson,
      taskStatus,
      validationResult?.executable,
    ],
  );

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowReactFlowNode>[]) => {
    setNodePositions((currentPositions) => {
      let nextPositions = currentPositions;
      for (const change of changes) {
        if (change.type !== "position" || !change.position || !isFlowNodeId(change.id)) {
          continue;
        }
        if (nextPositions === currentPositions) {
          nextPositions = { ...currentPositions };
        }
        nextPositions[change.id] = change.position;
      }
      return nextPositions;
    });
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler<WorkflowReactFlowNode>>(
    (_event, node) => {
      if (isFlowNodeId(node.id)) {
        onNodeSelect(node.id);
      }
    },
    [onNodeSelect],
  );

  const handleViewportChange = useCallback(
    (nextViewport: Viewport) => {
      setViewport(nextViewport);
      onZoomChange(clampZoom(nextViewport.zoom * 100));
    },
    [onZoomChange],
  );

  const handleMoveEnd = useCallback<OnMove>(
    (_event, nextViewport) => {
      handleViewportChange(nextViewport);
    },
    [handleViewportChange],
  );

  function handleFitCanvas() {
    const instance = reactFlowRef.current;
    if (instance) {
      void instance.fitView({ duration: 160, maxZoom: 1, minZoom: 1, padding: 0.18 });
    } else {
      setViewport(REACT_FLOW_DEFAULT_VIEWPORT);
    }
    onZoomChange(100);
  }

  return (
    <section className={`canvas-shell canvas-shell--${canvasTool}`}>
      <CanvasToolbar
        canvasTool={canvasTool}
        zoom={zoom}
        onCanvasToolChange={onCanvasToolChange}
        onZoomChange={onZoomChange}
        onFitCanvas={handleFitCanvas}
      />
      <ReactFlowProvider key={flowInstanceRevision}>
        <FlowInternalsUpdater
          revision={[
            flowInstanceRevision,
            selectedPerson?.asset.id ?? "",
            selectedGarments.map((asset) => asset.asset.id).join("|"),
            results.map((result) => result.id).join("|"),
          ].join(":")}
        />
        <ReactFlow<WorkflowReactFlowNode, WorkflowReactFlowEdge>
          className="flow-canvas"
          nodes={flowNodes}
          edges={workflowEdges}
          nodeTypes={nodeTypes}
          viewport={viewport}
          minZoom={CANVAS_MIN_ZOOM / 100}
          maxZoom={CANVAS_MAX_ZOOM / 100}
          nodesConnectable={false}
          edgesReconnectable={false}
          connectOnClick={false}
          deleteKeyCode={null}
          edgesFocusable={false}
          nodesDraggable
          panOnDrag
          panOnScroll
          panOnScrollSpeed={1}
          zoomOnPinch
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          preventScrolling
          selectNodesOnDrag={false}
          onlyRenderVisibleElements={false}
          proOptions={{ hideAttribution: true }}
          onInit={(instance) => {
            reactFlowRef.current = instance;
          }}
          onNodesChange={handleNodesChange}
          onNodeClick={handleNodeClick}
          onMoveEnd={handleMoveEnd}
          onViewportChange={handleViewportChange}
        >
          <Background gap={18} size={1.4} color="#cbd5e1" />
          <MiniMap className="flow-minimap" pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
      <div className="flow-context">
        <span>{currentCombination?.name ?? "未保存组合"}</span>
        <strong>{validationResult?.executable ? "流程已就绪" : "待补充输入"}</strong>
      </div>
    </section>
  );
}

function FlowInternalsUpdater({ revision }: { revision: string }) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      for (const nodeId of WORKFLOW_NODE_ORDER) {
        updateNodeInternals(nodeId);
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [revision, updateNodeInternals]);

  return null;
}

function CanvasToolbar({
  canvasTool,
  zoom,
  onCanvasToolChange,
  onFitCanvas,
  onZoomChange,
}: {
  canvasTool: CanvasTool;
  zoom: number;
  onCanvasToolChange: (tool: CanvasTool) => void;
  onFitCanvas: () => void;
  onZoomChange: (zoom: number) => void;
}) {
  const zoomLabel = Math.round(zoom);
  const tools: Array<{ id: CanvasTool; icon: ReactNode; label: string }> = [
    { id: "hand", icon: <Hand size={17} />, label: "拖拽画布" },
    { id: "select", icon: <MousePointer2 size={17} />, label: "选择节点" },
    { id: "grid", icon: <Grid3X3 size={17} />, label: "网格视图" },
  ];

  function updateZoom(nextZoom: number) {
    onZoomChange(clampZoom(nextZoom));
  }

  return (
    <div className="canvas-toolbar">
      <div className="tool-segment" role="group" aria-label="画布工具">
        {tools.map((tool) => (
          <button
            aria-label={tool.label}
            className={canvasTool === tool.id ? "is-active" : ""}
            key={tool.id}
            onClick={() => onCanvasToolChange(tool.id)}
            title={tool.label}
            type="button"
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <div className="zoom-control" role="group" aria-label="缩放">
        <button onClick={() => updateZoom(getPreviousZoomLevel(zoom))} type="button" aria-label="缩小">
          <Minus size={16} />
        </button>
        <span>{zoomLabel}%</span>
        <button onClick={() => updateZoom(getNextZoomLevel(zoom))} type="button" aria-label="放大">
          <Plus size={16} />
        </button>
      </div>
      <button
        className="canvas-icon"
        onClick={onFitCanvas}
        title="适配画布"
        type="button"
        aria-label="适配画布"
      >
        <Maximize2 size={17} />
      </button>
      <button className="flow-help" type="button">
        <CircleAlert size={16} />
        流程说明
        <ChevronDown size={15} />
      </button>
    </div>
  );
}

function createWorkflowNode({
  accent,
  body,
  nodeId,
  position,
  selected,
  status,
  subtitle,
  title,
}: WorkflowNodeData & { position: FlowNodePosition }): WorkflowReactFlowNode {
  return {
    id: nodeId,
    type: "workflowNode",
    position,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected,
    data: {
      accent,
      body,
      nodeId,
      selected,
      status,
      subtitle,
      title,
    },
  };
}

function FlowNode({ data, selected }: NodeProps<WorkflowReactFlowNode>) {
  return (
    <div
      className={`flow-node flow-node--${data.accent} ${selected || data.selected ? "is-selected" : ""}`}
      data-node-id={data.nodeId}
    >
      <Handle
        className="flow-node__handle flow-node__handle--target"
        id="target"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />
      <Handle
        className="flow-node__handle flow-node__handle--source"
        id="source"
        isConnectable={false}
        position={Position.Right}
        type="source"
      />
      <div className="flow-node__header">
        <div>
          <strong>{data.title}</strong>
          <span>{data.subtitle}</span>
        </div>
        <StatusMark status={data.status} />
      </div>
      <div className="flow-node__body">{data.body}</div>
    </div>
  );
}

function StatusMark({ status }: { status: "done" | "pending" | "required" }) {
  if (status === "done") {
    return (
      <span className="flow-node__status is-done">
        <CircleCheck size={14} fill="currentColor" />
      </span>
    );
  }
  if (status === "required") {
    return (
      <span className="flow-node__status is-required">
        <CircleAlert size={14} />
      </span>
    );
  }
  return (
    <span className="flow-node__status">
      <Clock3 size={14} />
    </span>
  );
}

function NodeEmpty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flow-node__empty">
      {icon}
      <small>{text}</small>
    </div>
  );
}

function clampZoom(zoom: number) {
  return Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom));
}

function getPreviousZoomLevel(zoom: number) {
  for (let index = CANVAS_ZOOM_LEVELS.length - 1; index >= 0; index -= 1) {
    const zoomLevel = CANVAS_ZOOM_LEVELS[index];
    if (zoom > zoomLevel + 0.5) {
      return zoomLevel;
    }
  }
  return CANVAS_MIN_ZOOM;
}

function getNextZoomLevel(zoom: number) {
  for (const zoomLevel of CANVAS_ZOOM_LEVELS) {
    if (zoom < zoomLevel - 0.5) {
      return zoomLevel;
    }
  }
  return CANVAS_MAX_ZOOM;
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
          <img alt={asset.asset.originalName} src={assetThumbSrc(asset)} />
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
              <img alt={asset.asset.originalName} src={assetThumbSrc(asset)} />
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

function PanelRestoreButton({
  label,
  side,
  onClick,
}: {
  label: string;
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <aside className={`panel-restore panel-restore--${side}`}>
      <button onClick={onClick} title={label} type="button" aria-label={label}>
        {side === "left" ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        <span>{label.replace("展开", "")}</span>
      </button>
    </aside>
  );
}

function InspectorPanel({
  apiKeyDraft,
  credentialStatus,
  currentCombination,
  latestTask,
  mode,
  modelSize,
  outputCount,
  promptText,
  recentTasks,
  results,
  selectedFlowNode,
  selectedGarments,
  selectedPerson,
  validationResult,
  onApiKeyDraftChange,
  onCollapse,
  onImport,
  onModelSizeChange,
  onModeChange,
  onOutputCountChange,
  onPromptChange,
  onSaveApiKey,
  onSelectNode,
  onTaskChanged,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
  mode: SidePanelMode;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptText: string;
  recentTasks: GenerationTaskDetail[];
  results: GenerationTaskResultAsset[];
  selectedFlowNode: FlowNodeId;
  selectedGarments: AssetFileView[];
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
  onApiKeyDraftChange: (value: string) => void;
  onCollapse: () => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onModelSizeChange: (value: (typeof MODEL_SIZES)[number]) => void;
  onModeChange: (mode: SidePanelMode) => void;
  onOutputCountChange: (value: number) => void;
  onPromptChange: (value: string) => void;
  onSaveApiKey: () => void;
  onSelectNode: (nodeId: FlowNodeId) => void;
  onTaskChanged: (detail: GenerationTaskDetail | null) => void;
}) {
  const nodeLabel = getFlowNodeLabel(selectedFlowNode);
  return (
    <aside className="property-panel">
      <div className="property-panel__header">
        <div>
          <h2>属性面板</h2>
          <p>
            当前选择： <strong>{nodeLabel}</strong>
          </p>
        </div>
        <button
          className="panel-collapse-button"
          onClick={onCollapse}
          title="折叠属性面板"
          type="button"
          aria-label="折叠属性面板"
        >
          <ChevronLeft size={18} />
        </button>
      </div>
      <div className="tabs">
        <button
          className={mode === "details" ? "is-active" : ""}
          onClick={() => onModeChange("details")}
          type="button"
        >
          详情
        </button>
        <button
          className={mode === "edit" ? "is-active" : ""}
          onClick={() => onModeChange("edit")}
          type="button"
        >
          编辑
        </button>
        <button
          className={mode === "links" ? "is-active" : ""}
          onClick={() => onModeChange("links")}
          type="button"
        >
          关联
        </button>
        <button
          className={mode === "history" ? "is-active" : ""}
          onClick={() => onModeChange("history")}
          type="button"
        >
          历史
        </button>
      </div>
      {mode === "details" ? (
        <NodeDetails
          currentCombination={currentCombination}
          latestTask={latestTask}
          modelSize={modelSize}
          outputCount={outputCount}
          promptText={promptText}
          results={results}
          selectedFlowNode={selectedFlowNode}
          selectedGarments={selectedGarments}
          selectedPerson={selectedPerson}
          validationResult={validationResult}
          onImport={onImport}
        />
      ) : null}
      {mode === "edit" ? (
        <NodeEditor
          apiKeyDraft={apiKeyDraft}
          credentialStatus={credentialStatus}
          modelSize={modelSize}
          outputCount={outputCount}
          promptText={promptText}
          selectedFlowNode={selectedFlowNode}
          onApiKeyDraftChange={onApiKeyDraftChange}
          onImport={onImport}
          onModelSizeChange={onModelSizeChange}
          onOutputCountChange={onOutputCountChange}
          onPromptChange={onPromptChange}
          onSaveApiKey={onSaveApiKey}
        />
      ) : null}
      {mode === "links" ? (
        <NodeLinks
          selectedFlowNode={selectedFlowNode}
          onSelectNode={(nodeId) => {
            onSelectNode(nodeId);
            onModeChange("details");
          }}
        />
      ) : null}
      {mode === "history" ? <TaskHistory tasks={recentTasks} onTaskChanged={onTaskChanged} /> : null}
      {mode !== "history" ? <TaskHistory tasks={recentTasks.slice(0, 3)} onTaskChanged={onTaskChanged} /> : null}
    </aside>
  );
}

function NodeDetails({
  currentCombination,
  latestTask,
  modelSize,
  outputCount,
  promptText,
  results,
  selectedFlowNode,
  selectedGarments,
  selectedPerson,
  validationResult,
  onImport,
}: {
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptText: string;
  results: GenerationTaskResultAsset[];
  selectedFlowNode: FlowNodeId;
  selectedGarments: AssetFileView[];
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
}) {
  if (selectedFlowNode === "person") {
    return (
      <AssetDetailBlock
        title="图片预览"
        asset={selectedPerson}
        emptyText="还没有选择人物图"
        onImport={() => onImport("person")}
      />
    );
  }

  if (selectedFlowNode === "garments") {
    return <GarmentDetailBlock garments={selectedGarments} onImport={() => onImport("garment")} />;
  }

  if (selectedFlowNode === "prompt") {
    return (
      <section className="detail-block">
        <h3>Prompt 摘要</h3>
        <dl className="plain-dl">
          <dt>来源</dt>
          <dd>当前组合内置 Prompt</dd>
          <dt>字符数</dt>
          <dd>{promptText.trim().length}</dd>
          <dt>状态</dt>
          <dd>{promptText.trim() ? "已配置" : "未配置"}</dd>
        </dl>
        <p className="panel-note">{promptText || "还没有填写 Prompt。"}</p>
      </section>
    );
  }

  if (selectedFlowNode === "model") {
    return (
      <section className="detail-block">
        <h3>模型配置</h3>
        <dl className="plain-dl">
          <dt>Provider</dt>
          <dd>{DEFAULT_PROVIDER}</dd>
          <dt>模型</dt>
          <dd>{DEFAULT_MODEL_ID}</dd>
          <dt>尺寸</dt>
          <dd>{modelSize}</dd>
          <dt>生成数量</dt>
          <dd>{outputCount}</dd>
        </dl>
      </section>
    );
  }

  if (selectedFlowNode === "execute") {
    return (
      <ValidationDetailBlock
        combinationName={currentCombination?.name ?? "未保存组合"}
        validationResult={validationResult}
      />
    );
  }

  return (
    <section className="detail-block">
      <h3>结果预览</h3>
      {results.length ? (
        <div className="garment-detail-grid">
          {results.slice(0, 6).map((result) => (
            <button
              key={result.id}
              onClick={() => {
                openGenerationResult(result.assetId).catch(() => undefined);
              }}
              type="button"
            >
              <img alt="生成结果" src={convertFileSrc(result.thumbFilePath)} />
            </button>
          ))}
        </div>
      ) : (
        <div className="panel-empty">
          <ImageIcon size={24} />
          还没有生成结果
        </div>
      )}
      <dl className="plain-dl panel-dl-space">
        <dt>任务状态</dt>
        <dd>{getGenerationTaskStatusLabel(latestTask?.task.status)}</dd>
        <dt>任务 ID</dt>
        <dd>{latestTask?.task.id ?? "--"}</dd>
      </dl>
    </section>
  );
}

function NodeEditor({
  apiKeyDraft,
  credentialStatus,
  modelSize,
  outputCount,
  promptText,
  selectedFlowNode,
  onApiKeyDraftChange,
  onImport,
  onModelSizeChange,
  onOutputCountChange,
  onPromptChange,
  onSaveApiKey,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptText: string;
  selectedFlowNode: FlowNodeId;
  onApiKeyDraftChange: (value: string) => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onModelSizeChange: (value: (typeof MODEL_SIZES)[number]) => void;
  onOutputCountChange: (value: number) => void;
  onPromptChange: (value: string) => void;
  onSaveApiKey: () => void;
}) {
  if (selectedFlowNode === "person" || selectedFlowNode === "garments") {
    const assetType = selectedFlowNode === "person" ? "person" : "garment";
    return (
      <section className="detail-block">
        <h3>{selectedFlowNode === "person" ? "人物图片" : "服装图片"}</h3>
        <button className="ghost-wide" onClick={() => onImport(assetType)} type="button">
          <Import size={15} />
          {selectedFlowNode === "person" ? "替换人物图" : "添加服装图"}
        </button>
      </section>
    );
  }

  if (selectedFlowNode === "prompt") {
    return (
      <section className="detail-block">
        <h3>Prompt 编辑</h3>
        <textarea
          rows={10}
          value={promptText}
          onChange={(event) => onPromptChange(event.target.value)}
        />
        <button className="ghost-wide" onClick={() => onPromptChange(DEFAULT_PROMPT_TEXT)} type="button">
          <RefreshCw size={15} />
          恢复默认 Prompt
        </button>
      </section>
    );
  }

  if (selectedFlowNode === "model") {
    return (
      <>
        <section className="detail-block">
          <h3>模型参数</h3>
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
        </section>
        <ApiKeyDetailBlock
          apiKeyDraft={apiKeyDraft}
          credentialStatus={credentialStatus}
          onApiKeyDraftChange={onApiKeyDraftChange}
          onSaveApiKey={onSaveApiKey}
        />
      </>
    );
  }

  return (
    <section className="detail-block">
      <h3>{getFlowNodeLabel(selectedFlowNode)}</h3>
      <p className="panel-note">该节点由当前组合、任务状态和生成结果自动驱动。</p>
    </section>
  );
}

function NodeLinks({
  selectedFlowNode,
  onSelectNode,
}: {
  selectedFlowNode: FlowNodeId;
  onSelectNode: (nodeId: FlowNodeId) => void;
}) {
  const nodeOrder: FlowNodeId[] = ["person", "garments", "prompt", "model", "execute", "result"];
  const selectedIndex = nodeOrder.indexOf(selectedFlowNode);
  const related = nodeOrder.filter(
    (nodeId, index) => Math.abs(index - selectedIndex) === 1 || nodeId === selectedFlowNode,
  );
  return (
    <section className="detail-block">
      <h3>节点关联</h3>
      <div className="node-link-list">
        {related.map((nodeId) => (
          <button
            className={nodeId === selectedFlowNode ? "is-active" : ""}
            key={nodeId}
            onClick={() => onSelectNode(nodeId)}
            type="button"
          >
            {getFlowNodeLabel(nodeId)}
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
    </section>
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
          <img alt={asset.asset.originalName} src={assetThumbSrc(asset)} />
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
              src={assetThumbSrc(asset)}
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
  onCollapse,
}: {
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
  onCollapse: () => void;
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
    <section className="bottom-dashboard">
      <div className="task-status">
        <button
          className="bottom-panel-collapse-button"
          onClick={onCollapse}
          title="折叠任务面板"
          type="button"
          aria-label="折叠任务面板"
        >
          <span>任务状态</span>
          <ChevronDown size={15} />
        </button>
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
          <button className="toolbar-button" onClick={onCollapse} type="button">
            <Eye size={15} />
            最小化面板
          </button>
        </div>
        {cancellationNotice ? <p className="task-cancel-notice">{cancellationNotice}</p> : null}
      </div>
      <ResultPreview results={results} />
      <div className="task-info">
        <h2>任务信息</h2>
        <dl>
          <dt>组合名称</dt>
          <dd>{currentCombination?.name ?? "未选择组合"}</dd>
          <dt>模型</dt>
          <dd>{task?.modelId ?? "--"}</dd>
          <dt>尺寸</dt>
          <dd>{formatResultSize(results)}</dd>
          <dt>生成数量</dt>
          <dd>{task?.outputCount ?? "--"}</dd>
          <dt>创建时间</dt>
          <dd>{formatTaskTime(task?.createdAt)}</dd>
          <dt>任务 ID</dt>
          <dd>{task?.id ?? "暂无任务"}</dd>
        </dl>
      </div>
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

function getFlowNodeLabel(nodeId: FlowNodeId) {
  switch (nodeId) {
    case "person":
      return "人物图节点";
    case "garments":
      return "服装图组节点";
    case "prompt":
      return "Prompt 节点";
    case "model":
      return "模型节点";
    case "execute":
      return "执行节点";
    case "result":
      return "结果节点";
    default:
      return "流程节点";
  }
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
      <section className="result-preview">
        <h2>
          结果预览
          <span>等待生成</span>
        </h2>
        <div className="preview-results">
          {[0, 1, 2].map((item) => (
            <div className="generating-card" key={item}>
              <span className="loader-ring" />
              <strong>暂无结果</strong>
              <small>--</small>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="result-preview">
      <h2>
        结果预览
        <span>{results.length} 张</span>
      </h2>
      <div className="preview-results">
        {results.slice(0, 3).map((result) => (
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
