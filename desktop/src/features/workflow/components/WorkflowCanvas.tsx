import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Node,
  Position,
  ReactFlow,
  getBezierPath,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  Box,
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
  Hand,
  ImageIcon,
  Import,
  LayoutGrid,
  Menu,
  Minus,
  MousePointer2,
  PanelRightClose,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AssetFileView, AssetType } from "../../assets/model/assetTypes";
import type {
  ImageCombination,
  ValidateCombinationResponse,
} from "../../assets/model/combinationTypes";
import {
  getAsset,
  importImage,
  listAssets,
} from "../../assets/services/assetService";
import {
  getImageCombination,
  listImageCombinations,
  saveImageCombination,
  validateCombination,
} from "../../assets/services/combinationService";
import type { SaveModelConfigRequest } from "../../model-config/model/modelTypes";
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
import { useWorkbenchStore } from "../store/workflowStore";
import type { Asset, WorkflowNodeData } from "../model/workflowTypes";
import "@xyflow/react/dist/style.css";

const DEFAULT_MODEL_CONFIG: SaveModelConfigRequest = {
  provider: "openai",
  modelId: "gpt-image-1",
  paramsJson: {
    outputCount: 1,
    size: "1024x1024",
  },
};

const DEFAULT_PROMPT_TEXT =
  "Create a clean commercial fashion try-on image. Preserve the person's identity and pose, apply the selected garments naturally, keep realistic fabric texture, studio lighting, and ecommerce-ready composition.";

const baseNodes: Node<WorkflowNodeData>[] = [
  {
    id: "person",
    type: "workflow",
    position: { x: 28, y: 146 },
    data: {
      title: "人物图",
      subtitle: "未选择",
      tone: "person",
      status: "pending",
    },
  },
  {
    id: "garments",
    type: "workflow",
    position: { x: 214, y: 146 },
    data: {
      title: "服装图组",
      subtitle: "未选择",
      tone: "garment",
      status: "pending",
    },
  },
  {
    id: "prompt",
    type: "workflow",
    position: { x: 400, y: 146 },
    data: {
      title: "Prompt",
      subtitle: "已准备",
      tone: "prompt",
      status: "done",
    },
  },
  {
    id: "model",
    type: "workflow",
    position: { x: 586, y: 146 },
    data: {
      title: "模型",
      subtitle: "GPT Image 1",
      tone: "model",
      status: "done",
    },
  },
  {
    id: "execute",
    type: "workflow",
    position: { x: 772, y: 146 },
    data: {
      title: "执行",
      subtitle: "待校验",
      tone: "execute",
      status: "pending",
    },
  },
  {
    id: "result",
    type: "workflow",
    position: { x: 958, y: 146 },
    data: {
      title: "结果",
      subtitle: "待生成",
      tone: "result",
      status: "pending",
    },
  },
];

const edges = [
  { id: "person-garments", source: "person", target: "garments", type: "flow" },
  { id: "garments-prompt", source: "garments", target: "prompt", type: "flow" },
  { id: "prompt-model", source: "prompt", target: "model", type: "flow" },
  { id: "model-execute", source: "model", target: "execute", type: "flow" },
  { id: "execute-result", source: "execute", target: "result", type: "flow" },
];

function FlowEdge(props: EdgeProps) {
  const [edgePath] = getBezierPath(props);

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={props.markerEnd} className="flow-edge" />
      <EdgeLabelRenderer>
        <span
          className="flow-edge__arrow"
          style={{
            transform: `translate(-50%, -50%) translate(${props.targetX - 16}px, ${props.targetY}px)`,
          }}
        >
          <ChevronRight size={16} />
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

export function WorkflowNode({ data, selected }: NodeProps<Node<WorkflowNodeData>>) {
  const setSelectedNode = useWorkbenchStore((state) => state.setSelectedNode);

  return (
    <button
      className={`workflow-node workflow-node--${data.tone} ${selected ? "is-selected" : ""}`}
      onClick={() => setSelectedNode(data.tone === "garment" ? "garments" : data.tone)}
      type="button"
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <span className="workflow-node__status">
        {data.status === "pending" ? (
          <Clock3 size={13} />
        ) : data.status === "ready" ? (
          <Play size={13} fill="currentColor" />
        ) : (
          <CircleCheck size={14} fill="currentColor" />
        )}
      </span>
      <span className="workflow-node__title">{data.title}</span>
      <span className="workflow-node__subtitle">{data.subtitle}</span>
      <WorkflowNodeBody data={data} />
      <Handle type="source" position={Position.Right} className="node-handle" />
    </button>
  );
}

function WorkflowNodeBody({ data }: { data: WorkflowNodeData }) {
  const assets = data.assets ?? [];
  if (data.tone === "person") {
    const asset = assets[0];
    return (
      <div className="workflow-node__image-card">
        {asset ? <AssetImage asset={asset} /> : <NodeEmpty icon={<UserRound size={38} />} label="导入人物图" />}
        {asset ? (
          <>
            <span>{asset.label}</span>
            <strong>{formatDimensions(asset.width, asset.height)}</strong>
          </>
        ) : null}
      </div>
    );
  }

  if (data.tone === "garment") {
    return (
      <div className="workflow-node__garments">
        {assets.slice(0, 4).map((asset) => (
          <AssetImage asset={asset} key={asset.id} />
        ))}
        {!assets.length ? <NodeEmpty icon={<BriefcaseBusiness size={30} />} label="导入服装图" /> : null}
        <span>{assets.length} 张</span>
      </div>
    );
  }

  if (data.tone === "prompt") {
    return (
      <div className="workflow-node__prompt">
        <FileText size={58} strokeWidth={1.25} />
        <span>{data.details?.[0] ?? "用户 Prompt"}</span>
        <strong>{data.details?.[1] ?? "0 字符"}</strong>
      </div>
    );
  }

  if (data.tone === "model") {
    return (
      <div className="workflow-node__model">
        <Box size={56} strokeWidth={1.6} />
        <span>{data.details?.[0] ?? DEFAULT_MODEL_CONFIG.modelId}</span>
        <strong>{data.details?.[1] ?? "1024 x 1024"}</strong>
        <strong>{data.details?.[2] ?? "生成数量：1"}</strong>
      </div>
    );
  }

  if (data.tone === "execute") {
    return (
      <div className="workflow-node__execute">
        <span className="workflow-node__play">
          <Play size={34} fill="currentColor" />
        </span>
        <strong>{data.actionLabel ?? "等待输入"}</strong>
        <span>{data.details?.[0] ?? "完成校验后可执行"}</span>
      </div>
    );
  }

  if (data.results?.length) {
    return (
      <div className="workflow-node__result">
        <div className="workflow-node__result-thumbs">
          {data.results.slice(0, 3).map((result) => (
            <img
              alt="生成结果"
              key={result.assetId}
              src={convertFileSrc(result.thumbFilePath)}
            />
          ))}
        </div>
        <span>{data.results.length} 张结果</span>
      </div>
    );
  }

  return (
    <div className="workflow-node__result">
      <ImageIcon size={54} />
      <span>等待生成结果</span>
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };
const edgeTypes = { flow: FlowEdge };

export function WorkflowCanvas() {
  const [currentCombination, setCurrentCombination] = useState<ImageCombination | null>(null);
  const [people, setPeople] = useState<AssetFileView[]>([]);
  const [garments, setGarments] = useState<AssetFileView[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([]);
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT_TEXT);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [importingType, setImportingType] = useState<Extract<AssetType, "person" | "garment"> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const validationResult = useWorkbenchStore((state) => state.validationResult);
  const nextValidationRevision = useWorkbenchStore((state) => state.nextValidationRevision);
  const acceptValidationResult = useWorkbenchStore((state) => state.acceptValidationResult);
  const latestTask = useGenerationTaskStore((state) => state.latestTask);
  const recentTasks = useGenerationTaskStore((state) => state.recentTasks);
  const setLatestTask = useGenerationTaskStore((state) => state.setLatestTask);
  const setRunningTasks = useGenerationTaskStore((state) => state.setRunningTasks);
  const setRecentTasks = useGenerationTaskStore((state) => state.setRecentTasks);

  const selectedPerson = useMemo(
    () => people.find((asset) => asset.asset.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  );
  const selectedGarments = useMemo(
    () => selectedGarmentIds
      .map((id) => garments.find((asset) => asset.asset.id === id))
      .filter((asset): asset is AssetFileView => Boolean(asset)),
    [garments, selectedGarmentIds],
  );
  const resultAssets = latestTask?.results ?? [];

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

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let canceled = false;

    async function loadWorkbench() {
      setLoadingError(null);
      const [personAssets, garmentAssets, combinations] = await Promise.all([
        listAssets("person"),
        listAssets("garment"),
        listImageCombinations(),
        refreshTaskLists(),
      ]);

      if (canceled) {
        return;
      }
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
      if (canceled) {
        return;
      }
      setCurrentCombination(combination);
      setSelectedPersonId(combination?.personAssetId ?? null);
      setSelectedGarmentIds(combination?.garmentAssetIds ?? []);

      if (combination) {
        const task = await getLatestGenerationTaskByCombination(combination.id);
        if (!canceled) {
          setLatestTask(task);
        }
      }
    }

    loadWorkbench().catch((error) => {
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
    const revision = nextValidationRevision();
    validateCombination({
      revision,
      draftCombination: {
        id: currentCombination?.id,
        name: currentCombination?.name ?? buildCombinationName(),
        personAssetId: selectedPersonId,
        garmentAssetIds: selectedGarmentIds,
      },
      draftPromptBinding: buildPromptBinding(currentCombination?.id ?? "draft", promptText),
      draftModelConfig: DEFAULT_MODEL_CONFIG,
    })
      .then((result) => {
        if (!canceled) {
          acceptValidationResult(result);
        }
      })
      .catch((error) => {
        if (!canceled) {
          setActionError(error instanceof Error ? error.message : "校验组合失败");
        }
      });

    return () => {
      canceled = true;
    };
  }, [
    acceptValidationResult,
    currentCombination?.id,
    currentCombination?.name,
    nextValidationRevision,
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
        setSelectedGarmentIds((ids) => [view.asset.id, ...ids.filter((id) => id !== view.asset.id)].slice(0, 4));
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
      const saved = await persistCurrentCombination();
      if (saved) {
        setActionMessage("组合已保存");
      }
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
      if (!saved) {
        return;
      }
      const promptBinding = buildPromptBinding(saved.id, promptText);
      await savePromptBinding(promptBinding);
      const task = await startGeneration({
        combinationId: saved.id,
        draftPromptBinding: promptBinding,
        draftModelConfig: DEFAULT_MODEL_CONFIG,
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

  async function persistCurrentCombination() {
    if (!selectedPersonId) {
      throw new Error("请先选择人物图片");
    }
    if (!selectedGarmentIds.length) {
      throw new Error("请至少选择一张服装图片");
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

  const flowNodes = buildWorkflowNodes({
    selectedPerson,
    selectedGarments,
    promptText,
    validationResult,
    latestTask,
  });
  const canRun = validationResult?.executable === true && !isStarting && !isSaving;
  const combinationName = currentCombination?.name ?? "未保存组合";

  return (
    <div className="desktop-frame">
      <WindowChrome />
      <div className="workbench">
        <TopToolbar
          combinationName={combinationName}
          canRun={canRun}
          isSaving={isSaving}
          isStarting={isStarting}
          onNew={handleNewCombination}
          onSave={() => {
            void handleSaveCombination();
          }}
          onRun={() => {
            void handleStartGeneration();
          }}
        />
        <div className="workbench__body">
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
            onRefresh={() => {
              void Promise.all([refreshAssets(), refreshTaskLists()]);
            }}
            onSelectPerson={setSelectedPersonId}
            onToggleGarment={toggleGarment}
          />
          <div className="canvas-column">
            <main className="canvas-shell">
              <CanvasToolbar validationResult={validationResult} />
              <ReactFlow
                nodes={flowNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.16 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={16}
                  size={1}
                  color="#d5dbe6"
                />
              </ReactFlow>
              <MinimapMock />
            </main>
            <WorkbenchMessages loadingError={loadingError} actionError={actionError} actionMessage={actionMessage} />
            <BottomDashboard currentCombination={currentCombination} latestTask={latestTask} />
          </div>
          <PropertyPanel
            currentCombination={currentCombination}
            selectedPerson={selectedPerson}
            selectedGarments={selectedGarments}
            promptText={promptText}
            validationResult={validationResult}
            recentTasks={recentTasks}
            onPromptChange={setPromptText}
            onImport={(assetType) => {
              void handleImport(assetType);
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

function buildWorkflowNodes({
  selectedPerson,
  selectedGarments,
  promptText,
  validationResult,
  latestTask,
}: {
  selectedPerson: AssetFileView | null;
  selectedGarments: AssetFileView[];
  promptText: string;
  validationResult: ValidateCombinationResponse | null;
  latestTask: GenerationTaskDetail | null;
}): Node<WorkflowNodeData>[] {
  return baseNodes.map((node) => {
    if (node.id === "person") {
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: selectedPerson ? "已选择 1 张" : "未选择",
          status: selectedPerson ? "done" : "pending",
          assets: selectedPerson ? [toWorkflowAsset(selectedPerson, true)] : [],
        },
      };
    }

    if (node.id === "garments") {
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: selectedGarments.length ? `${selectedGarments.length} 张` : "未选择",
          status: selectedGarments.length ? "done" : "pending",
          assets: selectedGarments.map((asset) => toWorkflowAsset(asset, true)),
        },
      };
    }

    if (node.id === "prompt") {
      const promptLength = promptText.trim().length;
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: promptLength ? "已配置" : "未配置",
          status: promptLength ? "done" : "pending",
          details: ["用户 Prompt", `${promptLength} 字符`],
        },
      };
    }

    if (node.id === "model") {
      return {
        ...node,
        data: {
          ...node.data,
          details: [
            DEFAULT_MODEL_CONFIG.modelId,
            String(DEFAULT_MODEL_CONFIG.paramsJson.size).replace("x", " x "),
            `生成数量：${DEFAULT_MODEL_CONFIG.paramsJson.outputCount}`,
          ],
        },
      };
    }

    if (node.id === "execute") {
      const executable = validationResult?.executable === true;
      const firstReason = validationResult?.reasons[0]?.message;
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: executable ? "就绪" : "待处理",
          status: executable ? "ready" : "pending",
          actionLabel: executable ? "可以执行生成" : "输入未完整",
          details: [executable ? "将保存组合并提交任务" : firstReason ?? "等待校验"],
        },
      };
    }

    if (node.id === "result") {
      const results = latestTask?.results.map((result) => ({
        assetId: result.assetId,
        thumbFilePath: result.thumbFilePath,
        width: result.width,
        height: result.height,
      }));
      const hasResults = Boolean(results?.length);
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: hasResults ? `${results?.length ?? 0} 张` : "待生成",
          status: hasResults ? "done" : "pending",
          results,
        },
      };
    }

    return node;
  });
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

function toWorkflowAsset(view: AssetFileView, selected: boolean): Asset {
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
  onNew,
  onSave,
  onRun,
}: {
  combinationName: string;
  canRun: boolean;
  isSaving: boolean;
  isStarting: boolean;
  onNew: () => void;
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
        <ToolbarButton icon={<FolderOpen size={16} />} label="打开历史" disabled />
        <ToolbarButton icon={<Settings size={16} />} label="模型设置" disabled />
        <ToolbarButton icon={<Copy size={16} />} label="Prompt 模板" disabled />
        <ToolbarButton icon={<SlidersHorizontal size={16} />} label="工作区设置" disabled />
      </div>
      <div className="toolbar-spacer" />
      <button className="icon-button is-muted" disabled type="button" aria-label="撤销">
        <RotateCcw size={18} />
      </button>
      <button className="icon-button is-muted" disabled type="button" aria-label="重做">
        <RotateCcw size={18} className="flip-x" />
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
        assets={people.map((asset) => toWorkflowAsset(asset, asset.asset.id === selectedPersonId))}
        accent="green"
        action="导入"
        isImporting={importingType === "person"}
        onAction={() => onImport("person")}
        onSelect={onSelectPerson}
      />
      <AssetSection
        title="服装图片"
        count={garments.length}
        assets={garments.map((asset) => toWorkflowAsset(asset, selectedGarmentIds.includes(asset.asset.id)))}
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
      <button className="all-assets" disabled type="button">
        <Archive size={16} />
        全部资源
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
  assets: Asset[];
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
          <button className="asset-thumb asset-thumb--add" onClick={onAction} type="button" aria-label={`添加${title}`}>
            <Plus size={22} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CanvasToolbar({ validationResult }: { validationResult: ValidateCombinationResponse | null }) {
  const executable = validationResult?.executable === true;
  return (
    <div className="canvas-toolbar">
      <div className="tool-segment">
        <button className="is-active" type="button" aria-label="平移">
          <Hand size={17} />
        </button>
        <button disabled type="button" aria-label="选择">
          <MousePointer2 size={17} />
        </button>
        <button disabled type="button" aria-label="框选">
          <LayoutGrid size={17} />
        </button>
      </div>
      <div className="zoom-control">
        <button disabled type="button" aria-label="缩小">
          <ZoomOut size={16} />
        </button>
        <span>100%</span>
        <button disabled type="button" aria-label="放大">
          <ZoomIn size={16} />
        </button>
      </div>
      <button className="canvas-icon" disabled type="button" aria-label="适配视图">
        <PanelRightClose size={17} />
      </button>
      <button className={`flow-help ${executable ? "is-ready" : ""}`} type="button">
        {executable ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
        {executable ? "校验通过" : "待补充输入"}
        <ChevronDown size={14} />
      </button>
    </div>
  );
}

function MinimapMock() {
  return (
    <div className="minimap">
      <div className="minimap__track">
        <span />
        <span />
        <span />
        <span />
        <span />
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

function PropertyPanel({
  currentCombination,
  selectedPerson,
  selectedGarments,
  promptText,
  validationResult,
  recentTasks,
  onPromptChange,
  onImport,
  onTaskChanged,
}: {
  currentCombination: ImageCombination | null;
  selectedPerson: AssetFileView | null;
  selectedGarments: AssetFileView[];
  promptText: string;
  validationResult: ValidateCombinationResponse | null;
  recentTasks: GenerationTaskDetail[];
  onPromptChange: (value: string) => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onTaskChanged: (detail: GenerationTaskDetail | null) => void;
}) {
  const selectedNode = useWorkbenchStore((state) => state.selectedNode);
  const selectedTitle = getSelectedNodeTitle(selectedNode);

  return (
    <aside className="property-panel">
      <div className="property-panel__header">
        <div>
          <h2>属性面板</h2>
          <p>
            当前选择： <strong>{selectedTitle}</strong>
          </p>
        </div>
        <ChevronLeft size={18} />
      </div>
      <div className="tabs">
        <button className="is-active" type="button">
          详情
        </button>
        <button disabled type="button">编辑</button>
        <button disabled type="button">关联</button>
        <button disabled type="button">历史</button>
      </div>
      {selectedNode === "person" ? (
        <AssetDetailBlock
          title="人物图片"
          asset={selectedPerson}
          emptyText="还没有选择人物图"
          onImport={() => onImport("person")}
        />
      ) : null}
      {selectedNode === "garments" ? (
        <GarmentDetailBlock garments={selectedGarments} onImport={() => onImport("garment")} />
      ) : null}
      {selectedNode === "prompt" ? (
        <PromptDetailBlock promptText={promptText} onPromptChange={onPromptChange} />
      ) : null}
      {selectedNode === "model" ? <ModelDetailBlock /> : null}
      {selectedNode === "execute" ? (
        <ValidationDetailBlock
          combinationName={currentCombination?.name ?? "未保存组合"}
          validationResult={validationResult}
        />
      ) : null}
      {selectedNode === "result" ? <ResultDetailBlock tasks={recentTasks} /> : null}
      <TaskHistory tasks={recentTasks} onTaskChanged={onTaskChanged} />
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
            <img alt={asset.asset.originalName} key={asset.asset.id} src={convertFileSrc(asset.thumbFilePath)} />
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

function PromptDetailBlock({
  promptText,
  onPromptChange,
}: {
  promptText: string;
  onPromptChange: (value: string) => void;
}) {
  return (
    <section className="detail-block">
      <h3>Prompt</h3>
      <label>
        用户提示词
        <textarea
          value={promptText}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={7}
        />
      </label>
      <p className="panel-note">{promptText.trim().length} 字符，会随组合保存。</p>
    </section>
  );
}

function ModelDetailBlock() {
  return (
    <section className="detail-block">
      <h3>模型配置</h3>
      <dl className="plain-dl">
        <dt>Provider</dt>
        <dd>{DEFAULT_MODEL_CONFIG.provider}</dd>
        <dt>模型</dt>
        <dd>{DEFAULT_MODEL_CONFIG.modelId}</dd>
        <dt>尺寸</dt>
        <dd>{String(DEFAULT_MODEL_CONFIG.paramsJson.size)}</dd>
        <dt>生成数量</dt>
        <dd>{String(DEFAULT_MODEL_CONFIG.paramsJson.outputCount)}</dd>
      </dl>
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

function ResultDetailBlock({ tasks }: { tasks: GenerationTaskDetail[] }) {
  const resultCount = tasks.reduce((sum, task) => sum + task.results.length, 0);
  return (
    <section className="detail-block">
      <h3>生成结果</h3>
      <p className="panel-note">最近任务共 {resultCount} 张结果。</p>
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
        <button disabled type="button">查看全部</button>
      </div>
      {tasks.length ? (
        tasks.slice(0, 5).map((item) => (
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
      <button className="ghost-wide" disabled type="button">
        打开历史页面
      </button>
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
    <section className="bottom-dashboard">
      <div className="task-status">
        <h2>
          任务状态 <ChevronDown size={15} />
        </h2>
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
          <button className="toolbar-button" disabled type="button">
            <Eye size={15} />
            最小化面板
          </button>
        </div>
        {cancellationNotice ? (
          <p className="task-cancel-notice">{cancellationNotice}</p>
        ) : null}
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
          <dd>{task?.id ?? (hasTask ? "--" : "暂无任务")}</dd>
        </dl>
        <button className="ghost-wide" disabled type="button">
          查看详情日志
        </button>
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

function getSelectedNodeTitle(nodeId: string) {
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
      return "未选择";
  }
}

function AssetImage({ asset }: { asset: Asset }) {
  if (!asset.imageSrc) {
    return (
      <span className="node-empty">
        <ImageIcon size={22} />
      </span>
    );
  }
  return <img alt={asset.label ?? "素材缩略图"} src={asset.imageSrc} />;
}

function NodeEmpty({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="node-empty">
      {icon}
      <small>{label}</small>
    </span>
  );
}

function ResultPreview({ results }: { results: GenerationTaskResultAsset[] }) {
  if (!results.length) {
    return (
      <div className="result-preview">
        <h2>结果预览 <span>等待生成</span></h2>
        <div className="preview-results">
          {[1, 2, 3].map((item) => (
            <div className="generating-card" key={item}>
              <span className="loader-ring" />
              <strong>暂无结果</strong>
              <small>--</small>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="result-preview">
      <h2>结果预览 <span>{results.length} 张</span></h2>
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
    </div>
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
