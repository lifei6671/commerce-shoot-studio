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
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  Box,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import type { AssetType } from "../../assets/model/assetTypes";
import type {
  ImageCombination,
  ValidateCombinationResponse,
} from "../../assets/model/combinationTypes";
import { importImage } from "../../assets/services/assetService";
import {
  getImageCombination,
  listImageCombinations,
} from "../../assets/services/combinationService";
import type {
  GenerationTaskDetail,
  GenerationTaskResultAsset,
} from "../../generation-task/model/taskTypes";
import {
  getLatestGenerationTaskByCombination,
  openGenerationResult,
} from "../../generation-task/services/taskService";
import { useWorkbenchStore } from "../store/workflowStore";
import type { Asset, WorkflowNodeData } from "../model/workflowTypes";
import "@xyflow/react/dist/style.css";

const personAssets: Asset[] = [
  { id: "person-01", visual: "person-a", selected: true },
  { id: "person-02", visual: "person-b" },
  { id: "person-03", visual: "person-c" },
  { id: "person-04", visual: "person-d" },
  { id: "person-05", visual: "person-e" },
];

const garmentAssets: Asset[] = [
  { id: "garment-01", visual: "garment-a", selected: true },
  { id: "garment-02", visual: "garment-b" },
  { id: "garment-03", visual: "garment-c" },
  { id: "garment-04", visual: "garment-d" },
  { id: "garment-05", visual: "garment-e" },
];

const resultAssets: Asset[] = [
  { id: "result-01", visual: "result-a" },
  { id: "result-02", visual: "result-b" },
  { id: "result-03", visual: "result-c" },
];

const baseNodes: Node<WorkflowNodeData>[] = [
  {
    id: "person",
    type: "workflow",
    position: { x: 28, y: 146 },
    data: {
      title: "人物图",
      subtitle: "必选",
      tone: "person",
      status: "done",
    },
  },
  {
    id: "garments",
    type: "workflow",
    position: { x: 214, y: 146 },
    data: {
      title: "服装图组",
      subtitle: "至少 2 张",
      tone: "garment",
      status: "done",
    },
  },
  {
    id: "prompt",
    type: "workflow",
    position: { x: 400, y: 146 },
    data: {
      title: "Prompt",
      subtitle: "已配置",
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
      subtitle: "已选择",
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
      subtitle: "就绪",
      tone: "execute",
      status: "done",
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
  const tone = data.tone;
  if (tone === "person") {
    return (
      <div className="workflow-node__image-card">
        <MockVisual kind="person-a" label="已选择人物图" />
        <span>IMG_20240521_01.jpg</span>
        <strong>1024 x 1536</strong>
      </div>
    );
  }

  if (tone === "garment") {
    return (
      <div className="workflow-node__garments">
        {garmentAssets.slice(0, 4).map((asset) => (
          <MockVisual key={asset.id} kind={asset.visual} label="服装缩略图" />
        ))}
        <span>8 张</span>
      </div>
    );
  }

  if (tone === "prompt") {
    return (
      <div className="workflow-node__prompt">
        <FileText size={58} strokeWidth={1.25} />
        <span>系统 / 用户 / 负面</span>
        <strong>总计 856 字符</strong>
      </div>
    );
  }

  if (tone === "model") {
    return (
      <div className="workflow-node__model">
        <Box size={56} strokeWidth={1.6} />
        <span>FLUX.1 dev</span>
        <strong>1024 x 1365</strong>
        <strong>生成数量：3</strong>
      </div>
    );
  }

  if (tone === "execute") {
    return (
      <div className="workflow-node__execute">
        <span className="workflow-node__play">
          <Play size={34} fill="currentColor" />
        </span>
        <strong>点击执行生成</strong>
        <span>预计耗时：1-2 分钟</span>
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
  const [latestTask, setLatestTask] = useState<GenerationTaskDetail | null>(null);
  const validationResult = useWorkbenchStore((state) => state.validationResult);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let canceled = false;

    async function loadLatestCombination() {
      const combinations = await listImageCombinations();
      const latest = combinations[0];

      if (!latest) {
        return;
      }

      const combination = await getImageCombination(latest.id);
      if (!canceled) {
        setCurrentCombination(combination);
      }

      if (combination) {
        const task = await getLatestGenerationTaskByCombination(combination.id);
        if (!canceled) {
          setLatestTask(task);
        }
      }
    }

    loadLatestCombination().catch(() => {
      if (!canceled) {
        setCurrentCombination(null);
        setLatestTask(null);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  const flowNodes = buildWorkflowNodes(currentCombination, validationResult, latestTask);

  return (
    <div className="desktop-frame">
      <WindowChrome />
      <div className="workbench">
        <TopToolbar combinationName={currentCombination?.name ?? "夏日连衣裙展示"} />
        <div className="workbench__body">
          <AssetLibrary />
          <div className="canvas-column">
            <main className="canvas-shell">
              <CanvasToolbar />
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
            <BottomDashboard currentCombination={currentCombination} latestTask={latestTask} />
          </div>
          <PropertyPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

function buildWorkflowNodes(
  currentCombination: ImageCombination | null,
  validationResult: ValidateCombinationResponse | null,
  latestTask: GenerationTaskDetail | null,
): Node<WorkflowNodeData>[] {
  return baseNodes.map((node) => {
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

    if (node.id === "execute") {
      const executable = validationResult?.executable === true;
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: executable ? "就绪" : "待校验",
          status: executable ? "ready" : "pending",
        },
      };
    }

    if (node.id === "person" && currentCombination) {
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: "已选 1 张",
          status: "done",
        },
      };
    }

    if (node.id === "garments" && currentCombination) {
      return {
        ...node,
        data: {
          ...node.data,
          subtitle: `${currentCombination.garmentAssetIds.length} 张`,
          status: "done",
        },
      };
    }

    return node;
  });
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
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

function TopToolbar({ combinationName }: { combinationName: string }) {
  return (
    <nav className="top-toolbar" aria-label="工作台工具栏">
      <div className="combo-select">
        <span>当前组合：</span>
        <strong>{combinationName}</strong>
        <ChevronDown size={16} />
      </div>
      <div className="toolbar-actions">
        <button className="primary-action" type="button">
          <Plus size={18} />
          新建组合
        </button>
        <ToolbarButton icon={<Save size={16} />} label="保存" />
        <ToolbarButton icon={<FolderOpen size={16} />} label="打开历史" />
        <ToolbarButton icon={<Settings size={16} />} label="模型设置" />
        <ToolbarButton icon={<Copy size={16} />} label="Prompt 模板" />
        <ToolbarButton icon={<SlidersHorizontal size={16} />} label="工作区设置" />
      </div>
      <div className="toolbar-spacer" />
      <button className="icon-button" type="button" aria-label="撤销">
        <RotateCcw size={18} />
      </button>
      <button className="icon-button is-muted" type="button" aria-label="重做">
        <RotateCcw size={18} className="flip-x" />
      </button>
      <button className="run-button" type="button">
        <Play size={17} fill="currentColor" />
        执行生成
      </button>
      <span className="avatar" aria-label="当前用户">
        <UserRound size={18} />
      </span>
    </nav>
  );
}

function ToolbarButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button className="toolbar-button" type="button">
      {icon}
      {label}
    </button>
  );
}

function AssetLibrary() {
  const [people, setPeople] = useState(personAssets);
  const [garments, setGarments] = useState(garmentAssets);
  const [importingType, setImportingType] = useState<AssetType | null>(null);

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
    try {
      const response = await importImage(selected, assetType);
      const importedAsset: Asset = {
        id: response.asset.id,
        visual: assetType === "person" ? "person-a" : "garment-a",
        imageSrc: convertFileSrc(response.thumbFilePath),
        label: response.asset.originalName,
      };
      const appendImported = (assets: Asset[]) => [
        importedAsset,
        ...assets.filter((asset) => asset.id !== importedAsset.id),
      ];

      if (assetType === "person") {
        setPeople(appendImported);
      } else {
        setGarments(appendImported);
      }
    } finally {
      setImportingType(null);
    }
  }

  return (
    <aside className="asset-library">
      <div className="panel-title">
        <h2>资源库</h2>
        <Menu size={18} />
      </div>
      <AssetSection
        title="人物图片"
        count={people.length}
        assets={people}
        accent="green"
        action="导入"
        isImporting={importingType === "person"}
        onImport={() => handleImport("person")}
      />
      <AssetSection
        title="服装图片"
        count={garments.length}
        assets={garments}
        accent="green"
        action="导入"
        isImporting={importingType === "garment"}
        onImport={() => handleImport("garment")}
      />
      <AssetSection title="结果图片" count={12} assets={resultAssets} accent="blue" action="刷新" />
      <button className="all-assets" type="button">
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
  onImport,
}: {
  title: string;
  count: number;
  assets: Asset[];
  accent: "green" | "blue";
  action: "导入" | "刷新";
  isImporting?: boolean;
  onImport?: () => void;
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
        <button disabled={isImporting} onClick={onImport} type="button">
          {action === "导入" ? <Import size={14} /> : <RefreshCw size={14} />}
          {isImporting ? "导入中" : action}
        </button>
      </div>
      <div className="asset-grid">
        {assets.map((asset) => (
          <button
            key={asset.id}
            className={`asset-thumb ${asset.selected ? "is-selected" : ""}`}
            type="button"
          >
            {asset.imageSrc ? (
              <img
                alt={asset.label ?? `${title}素材`}
                className="asset-thumb__image"
                src={asset.imageSrc}
              />
            ) : (
              <MockVisual kind={asset.visual} label={asset.label ?? `${title}素材`} />
            )}
            {asset.selected ? (
              <span className="asset-thumb__check">
                <CircleCheck size={13} fill="currentColor" />
              </span>
            ) : null}
          </button>
        ))}
        <button className="asset-thumb asset-thumb--add" type="button" aria-label={`添加${title}`}>
          <Plus size={22} />
        </button>
      </div>
    </section>
  );
}

function CanvasToolbar() {
  return (
    <div className="canvas-toolbar">
      <div className="tool-segment">
        <button className="is-active" type="button" aria-label="平移">
          <Hand size={17} />
        </button>
        <button type="button" aria-label="选择">
          <MousePointer2 size={17} />
        </button>
        <button type="button" aria-label="框选">
          <LayoutGrid size={17} />
        </button>
      </div>
      <div className="zoom-control">
        <button type="button" aria-label="缩小">
          <ZoomOut size={16} />
        </button>
        <span>100%</span>
        <button type="button" aria-label="放大">
          <ZoomIn size={16} />
        </button>
      </div>
      <button className="canvas-icon" type="button" aria-label="适配视图">
        <PanelRightClose size={17} />
      </button>
      <button className="flow-help" type="button">
        <CircleCheck size={15} />
        流程说明
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

function PropertyPanel() {
  return (
    <aside className="property-panel">
      <div className="property-panel__header">
        <div>
          <h2>属性面板</h2>
          <p>
            当前选择： <strong>人物图节点</strong>
          </p>
        </div>
        <ChevronLeft size={18} />
      </div>
      <div className="tabs">
        <button className="is-active" type="button">
          详情
        </button>
        <button type="button">编辑</button>
        <button type="button">关联</button>
        <button type="button">历史</button>
      </div>
      <section className="detail-block">
        <h3>图片预览</h3>
        <div className="preview-card">
          <MockVisual kind="person-a" label="人物预览" />
          <dl>
            <dt>文件名</dt>
            <dd>IMG_20240521_01.jpg</dd>
            <dt>尺寸</dt>
            <dd>1024 × 1536</dd>
            <dt>类型</dt>
            <dd>image/jpeg</dd>
            <dt>大小</dt>
            <dd>1.23 MB</dd>
            <dt>导入时间</dt>
            <dd>2024-05-21 14:32</dd>
          </dl>
        </div>
        <button className="ghost-wide" type="button">
          <RefreshCw size={15} />
          替换图片
        </button>
      </section>
      <section className="detail-block">
        <h3>人物信息 <span>（可选）</span></h3>
        <label>
          名称
          <input placeholder="如：模特 A" />
        </label>
        <label>
          描述
          <input placeholder="输入对人物的描述，帮助生成更好的效果" />
        </label>
        <button className="more-info" type="button">
          <ChevronDown size={14} />
          更多信息
        </button>
      </section>
      <TaskHistory />
    </aside>
  );
}

function TaskHistory() {
  const history = [
    {
      title: "夏日连衣裙展示",
      model: "FLUX.1 dev",
      count: "3 张",
      status: "成功",
      tone: "success",
      time: "2024-05-21 14:28",
      visual: "person-a",
    },
    {
      title: "通勤西装展示",
      model: "FLUX.1 dev",
      count: "2 张",
      status: "失败",
      tone: "danger",
      time: "2024-05-21 13:54",
      visual: "result-b",
    },
    {
      title: "牛仔外套展示",
      model: "SD3 Medium",
      count: "4 张",
      status: "成功",
      tone: "success",
      time: "2024-05-21 12:31",
      visual: "result-c",
    },
  ];

  return (
    <section className="history-block">
      <div className="history-block__header">
        <h3>历史任务</h3>
        <button type="button">查看全部</button>
      </div>
      {history.map((item) => (
        <article className="history-item" key={item.title}>
          <MockVisual kind={item.visual} label={item.title} />
          <div>
            <strong>{item.title}</strong>
            <span>
              {item.model} <i /> {item.count}
            </span>
          </div>
          <div className="history-item__meta">
            <b className={`status-${item.tone}`}>{item.status}</b>
            <time>{item.time}</time>
          </div>
        </article>
      ))}
      <button className="ghost-wide" type="button">
        打开历史页面
      </button>
    </section>
  );
}

function MockVisual({ kind, label }: { kind: string; label: string }) {
  return (
    <span className={`mock-visual mock-visual--${kind}`} role="img" aria-label={label}>
      {kind.startsWith("person") || kind.startsWith("result") ? (
        <>
          <span className="mock-person__head" />
          <span className="mock-person__hair" />
          <span className="mock-person__body" />
          <span className="mock-person__dress" />
          <span className="mock-person__leg mock-person__leg--left" />
          <span className="mock-person__leg mock-person__leg--right" />
        </>
      ) : (
        <>
          <span className="mock-garment__neck" />
          <span className="mock-garment__body" />
          <span className="mock-garment__fold mock-garment__fold--left" />
          <span className="mock-garment__fold mock-garment__fold--right" />
        </>
      )}
    </span>
  );
}

function BottomDashboard({
  currentCombination,
  latestTask,
}: {
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
}) {
  const task = latestTask?.task ?? null;
  const results = latestTask?.results ?? [];
  const progress = Math.max(0, Math.min(100, task?.progress ?? 0));
  const ringStyle = {
    "--progress-offset": 302 - (302 * progress) / 100,
  } as CSSProperties;
  const taskStatus = getGenerationTaskStatusLabel(task?.status);
  const taskSteps = buildTaskProgressSteps(task?.status);
  const hasTask = Boolean(task);

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
          <button className="danger-button" disabled type="button">
            <CircleX size={15} />
            取消任务
          </button>
          <button className="toolbar-button" disabled type="button">
            <Eye size={15} />
            最小化面板
          </button>
        </div>
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

function formatResultSize(results: GenerationTaskResultAsset[]) {
  const first = results[0];
  return first ? `${first.width} × ${first.height}` : "--";
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
      <span>工作区：D:\AI-Tryon-Workspace</span>
      <FolderOpen size={15} />
      <div className="status-bar__right">
        <span className="service-dot" />
        本地服务运行中
        <b>v1.0.0</b>
      </div>
    </footer>
  );
}
