import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { pictureDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  Box,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Filter,
  FolderOpen,
  Grid3X3,
  Hand,
  ImageIcon,
  Import,
  KeyRound,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
  Wrench,
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
  ModelConfig,
  ModelDefinition,
  ProviderCredentialStatus,
  SaveModelConfigRequest,
} from "../../model-config/model/modelTypes";
import {
  getModelConfig,
  getProviderApiKey,
  getProviderCredentialStatus,
  listModelDefinitions,
  saveModelConfig,
  setProviderApiKey,
} from "../../model-config/services/modelService";
import type {
  PromptBindingSection,
  PromptMode,
  PromptPreset,
  PromptPresetScenario,
  PromptTemplate,
  PromptTemplateType,
  PromptTemplateVariable,
  SavePromptBindingRequest,
  SavePromptPresetRequest,
  SavePromptPresetScenarioRequest,
  SavePromptTemplateRequest,
} from "../../prompt/model/promptTypes";
import {
  deletePromptTemplate,
  getPromptBinding,
  listPromptPresetScenarios,
  listPromptPresets,
  listPromptTemplates,
  restoreDefaultPromptTemplates,
  savePromptBinding,
  savePromptPreset,
  savePromptPresetScenario,
  savePromptTemplate,
} from "../../prompt/services/promptService";
import type {
  GenerationTaskDetail,
  GenerationTaskHistoryPage,
  GenerationTaskHistoryStats,
  GenerationTaskStatus,
  GenerationTaskResultAsset,
} from "../../generation-task/model/taskTypes";
import {
  buildTaskHistoryDateRange,
  buildTaskHistoryModelOptions,
  buildTaskHistoryProviderOptions,
  canRetryTaskHistoryItem,
  type TaskHistoryDatePreset,
} from "../../generation-task/model/taskHistoryFilters";
import { listenGenerationTaskUpdates } from "../../generation-task/services/taskEventService";
import {
  getGenerationTaskDetail,
  getLatestGenerationTaskByCombination,
  listGenerationTaskHistory,
  listRecentGenerationTasks,
  listRunningGenerationTasks,
  openGenerationResult,
  rerunGenerationFromCurrentCombination,
  retryGenerationTask,
  startGeneration,
} from "../../generation-task/services/taskService";
import { useGenerationTaskStore } from "../../generation-task/store/taskStore";
import type {
  CacheStats,
  ClearCacheResult,
  ProxyMode,
  ProxyProtocol,
  SystemSettings,
  SystemSettingsView,
} from "../../system-settings/model/systemSettingsTypes";
import {
  clearWorkspaceCache,
  getCacheStats,
  getSystemSettings,
  openCurrentWorkspaceDirectory,
  saveSystemSettings,
  testProxyConnection,
} from "../../system-settings/services/systemSettingsService";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import { Card } from "../../../shared/ui/card";
import { Checkbox } from "../../../shared/ui/checkbox";
import { Input } from "../../../shared/ui/input";
import { RadioGroup, RadioGroupItem } from "../../../shared/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { Switch } from "../../../shared/ui/switch";
import { Textarea } from "../../../shared/ui/textarea";
import {
  WORKFLOW_NODE_MIN_SIZE,
  applyWorkflowNodeSizeChanges,
  applyWorkflowNodePositionChanges,
  buildWorkflowEdges,
  cloneInitialWorkflowNodePositions,
  cloneInitialWorkflowNodeSizes,
  isFlowNodeId,
  WORKFLOW_NODE_ORDER,
  type FlowNodeId,
  type FlowNodePosition,
  type FlowNodeSize,
} from "./workflowFlowGraph";
import {
  buildNewCombinationPersonAssetIdsAfterImport,
  buildNewCombinationForm,
  filterNewCombinationPickerAssets,
  type NewCombinationForm,
} from "./newCombinationForm";
import {
  buildActiveGarmentAssetIdsForCombination,
  buildActivePersonAssetIdForCombination,
  buildCombinationAssetIdsAfterReorder,
  buildCombinationGarmentAssetIdsAfterImport,
  buildCombinationPersonAssetIdsAfterImport,
  buildCurrentCombinationAssetView,
  buildDeselectedAssetIdsFromActiveIds,
  buildPersonAssetSelectionAfterRemove,
  buildSelectedAssetIdsAfterCombinationReorder,
  normalizeCombinationPersonAssetIds,
  toggleDeselectedAssetId,
} from "./currentCombinationAssets";
import { buildFlowNodeRenderQualityStyle } from "./flowNodeRenderQuality";
import {
  getInspectorPanelModes,
  normalizeInspectorPanelMode,
  type SidePanelMode,
} from "./inspectorPanelModes";
import {
  buildWorkbenchAutoSavePlan,
  buildWorkbenchAutoSaveSignature,
  type WorkbenchAutoSaveInput,
} from "./workbenchAutoSave";
import {
  applyStoredAssetOrder,
  assetIds,
  isAssetDropTarget,
  moveAssetById,
  readAssetLibraryOrder,
  saveAssetLibraryOrder,
  type SortableAssetType,
} from "./assetLibraryOrder";
import {
  getDefaultCombinationSummary,
  sortCombinationSummaries,
  upsertCombinationSummary,
} from "./combinationSummaries";
import { buildAssetImageSources } from "./assetImageSource";
import {
  buildTaskHistoryDetailPreviews,
  collectTaskHistoryInputAssetIds,
  getTaskHistoryCoverImageSrc,
  type TaskHistoryAssetLookup,
} from "./taskHistoryPreviewSources";
import {
  DEFAULT_PROMPT_WORKBENCH_STATE,
  buildOutputPlanPreviewClipboardText,
  buildPromptBindingFromWorkbench,
  buildPromptBindingSaveRequest,
  buildPromptWorkbenchDefaultsForPreset,
  buildPromptPresetOptions,
  buildPromptWorkbenchFromBinding,
  findPromptPresetOption,
  normalizePromptWorkbenchOutputCount,
  renderPromptSectionPreview,
  renderPromptTemplatePreview,
  type AdvancedPromptSections,
  type PromptPresetOption,
  type PromptWorkbenchState,
  type PromptWorkbenchVariables,
} from "./promptPresetBinding";
import { buildPromptPresetVariablesForSections } from "./promptPresetVariables";
import {
  buildPromptVariablePreviewValue,
  extractPromptVariableNames,
  normalizePromptTemplateVariable,
  syncPromptTemplateVariablesFromBody,
} from "./promptTemplateVariables";

const DEFAULT_MODEL_ID = "gpt-image-2";
const DEFAULT_PROVIDER = "openai";
const MODEL_SIZES = [
  "auto",
  "1024x1024",
  "1672x941",
  "941x1672",
  "1443x1090",
  "1090x1443",
  "1536x1024",
  "1024x1536",
  "1408x1120",
  "1120x1408",
  "1920x832",
  "832x1920",
  "896x1792",
  "1792x896",
] as const;
const MODEL_SIZE_LABELS: Record<(typeof MODEL_SIZES)[number], string> = {
  auto: "自动",
  "1024x1024": "1:1 · 1024x1024",
  "1672x941": "16:9 · 1672x941",
  "941x1672": "9:16 · 941x1672",
  "1443x1090": "4:3 · 1443x1090",
  "1090x1443": "3:4 · 1090x1443",
  "1536x1024": "3:2 · 1536x1024",
  "1024x1536": "2:3 · 1024x1536",
  "1408x1120": "5:4 · 1408x1120",
  "1120x1408": "4:5 · 1120x1408",
  "1920x832": "21:9 · 1920x832",
  "832x1920": "9:21 · 832x1920",
  "896x1792": "1:2 · 896x1792",
  "1792x896": "2:1 · 1792x896",
};

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

type CanvasTool = "hand" | "select";
type CanvasPanelCollapseState = {
  assetLibrary: boolean;
  inspector: boolean;
};
type StoredCombinationSelectionState = {
  deselectedPersonAssetIds: string[];
  deselectedGarmentAssetIds: string[];
};
type WorkbenchContextMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};
type WorkbenchContextMenuState = {
  x: number;
  y: number;
  items: WorkbenchContextMenuItem[];
} | null;
type PromptWorkbenchData = {
  templates: PromptTemplate[];
  presets: PromptPreset[];
  scenarios: PromptPresetScenario[];
  presetOptions: PromptPresetOption[];
};
type WorkflowNodeData = Record<string, unknown> & {
  accent: "green" | "blue" | "purple" | "orange" | "gray";
  body: ReactNode;
  canResize: boolean;
  nodeId: FlowNodeId;
  selected: boolean;
  size: FlowNodeSize;
  status: "done" | "pending" | "required";
  subtitle: string;
  title: string;
};
type WorkflowReactFlowNode = Node<WorkflowNodeData, "workflowNode">;
type WorkflowReactFlowEdge = Edge<Record<string, never>, "default">;

const CANVAS_MIN_ZOOM = 33;
const CANVAS_MAX_ZOOM = 300;
const CANVAS_ZOOM_LEVELS = [33, 50, 75, 100, 125, 150, 200, 300] as const;
const ACTION_MESSAGE_AUTO_DISMISS_MS = 2400;
const REACT_FLOW_DEFAULT_VIEWPORT: Viewport = { x: 40, y: 158, zoom: 1 };
const MODEL_CONFIG_STORAGE_KEY = "commerce-shoot-studio:selected-model-config-id";
const COMBINATION_SELECTION_STATE_STORAGE_KEY =
  "commerce-shoot-studio:combination-selection-state";
const OPEN_WORKBENCH_EVENT = "commerce-shoot-studio://open-workbench";
const OPEN_SYSTEM_SETTINGS_EVENT = "commerce-shoot-studio://open-system-settings";
const OPEN_MODEL_SETTINGS_EVENT = "commerce-shoot-studio://open-model-settings";
const OPEN_PROMPT_PRESET_CENTER_EVENT = "commerce-shoot-studio://open-prompt-preset-center";
const GOOGLE_PROVIDER = "google";
const CUSTOM_PROVIDER = "custom";
const DEFAULT_CUSTOM_MODEL_ID = "custom-image-model";
const DEFAULT_IMAGE_FORMAT = "PNG";
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_SEED = -1;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_AUTO_SAVE_RESULT = true;
const WORKBENCH_AUTO_SAVE_DELAY_MS = 800;
const PROMPT_TEMPLATE_TYPES: PromptTemplateType[] = ["system", "user", "negative"];
const PROMPT_TEMPLATE_LIMIT = 4000;
const EMPTY_TASK_HISTORY_STATS: GenerationTaskHistoryStats = {
  total: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};
const DEFAULT_PROMPT_TEMPLATE_VARIABLES: PromptTemplateVariable[] = [
  {
    name: "style",
    displayName: "风格",
    description: "服装风格",
    exampleValue: "休闲、商务、复古",
    required: true,
    defaultValue: "法式优雅",
    controlType: "combobox",
    options: ["法式优雅", "休闲", "商务", "复古"],
  },
  {
    name: "background",
    displayName: "背景",
    description: "背景场景",
    exampleValue: "纯色背景、室内场景、自然光棚",
    required: true,
    defaultValue: "纯色背景",
    controlType: "combobox",
    options: ["纯色背景", "室内场景", "自然光棚"],
  },
  {
    name: "aspectRatio",
    displayName: "画面比例",
    description: "画面比例",
    exampleValue: "1:1、3:4、4:5、9:16、16:9",
    required: true,
    defaultValue: "3:4",
    controlType: "combobox",
    options: ["1:1", "3:4", "4:5", "9:16", "16:9"],
  },
  {
    name: "garmentCategory",
    displayName: "服装类别",
    description: "服装品类",
    exampleValue: "连衣裙、上衣、外套、裤子",
    required: true,
    defaultValue: "连衣裙",
    controlType: "combobox",
    options: ["连衣裙", "上衣", "外套", "裤子"],
  },
  {
    name: "outputCount",
    displayName: "生成数量",
    description: "生成数量",
    exampleValue: "1、2、3、4",
    required: true,
    defaultValue: "3",
    controlType: "combobox",
    options: ["1", "2", "3", "4"],
  },
];
const EMPTY_CACHE_STATS: CacheStats = {
  totalBytes: 0,
  thumbnailCacheBytes: 0,
  temporaryFilesBytes: 0,
  modelResponseCacheBytes: 0,
  otherCacheBytes: 0,
};
const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  launchAtLogin: false,
  closeToTray: true,
  notifyOnTaskSuccess: true,
  notifyOnTaskFailure: true,
  notificationDurationSeconds: 5,
  workspaceRoot: "",
  defaultSaveLocation: "workspace",
  autoBackupEnabled: true,
  backupFrequency: "daily",
  backupRetentionCount: 7,
  autoCacheCleanupEnabled: true,
  cacheCleanupThresholdGb: 10,
  proxy: {
    mode: "none",
    protocol: "http",
    host: "",
    port: null,
    username: "",
    password: "",
  },
  uiLanguage: "follow_system",
  themeMode: "follow_system",
  logLevel: "info",
};
const PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI", icon: <OpenAIProviderIcon />, enabled: true },
  { id: GOOGLE_PROVIDER, label: "Google", icon: <GoogleProviderIcon />, enabled: false },
  { id: CUSTOM_PROVIDER, label: "Custom", icon: <Code2 size={18} strokeWidth={2.4} />, enabled: false },
  { id: "replicate", label: "Replicate", icon: "▰", enabled: false },
  { id: "fal", label: "Fal", icon: "△", enabled: false },
  { id: "stability", label: "Stability", icon: "S", enabled: false },
] as const;
const DEFAULT_VISIBLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((provider) => provider.enabled);
type ProviderId = (typeof PROVIDER_OPTIONS)[number]["id"];
type SettingsPage = "model" | "prompt" | "system";
type TaskHistoryFilterKey = "provider" | "model" | "date";
type PromptTemplateDraft = SavePromptTemplateRequest;
type PromptPresetDraft = SavePromptPresetRequest;
type PromptTemplatePreviewValues = Record<string, string>;
type PromptPresetSourceMode = "blank" | "copy";
function OpenAIProviderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="provider-brand-icon provider-brand-icon--openai"
      viewBox="0 0 24 24"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      >
        <path d="M11.98 3.2 16.48 5.8v5.2l-4.5 2.6-4.5-2.6V5.8l4.5-2.6Z" />
        <path d="m16.48 5.8 3.02 1.74v5.2l-4.5 2.6-3.02-1.74" />
        <path d="m19.5 12.74v3.48l-4.5 2.6-4.5-2.6v-3.48" />
        <path d="m10.5 16.22-3.02 1.74-4.5-2.6v-5.2l4.5-2.6" />
        <path d="M2.98 10.16V6.68l4.5-2.6 4.5 2.6" />
        <path d="m7.48 4.08 3.02-1.74 4.5 2.6v3.48" />
      </g>
    </svg>
  );
}

function GoogleProviderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="provider-brand-icon provider-brand-icon--google"
      viewBox="0 0 24 24"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
        fill="#4285f4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34a853"
      />
      <path
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.12-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.94l3.66-2.84Z"
        fill="#fbbc05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
        fill="#ea4335"
      />
    </svg>
  );
}

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
  const [currentPersonAssetIds, setCurrentPersonAssetIds] = useState<string[]>([]);
  const [currentGarmentAssetIds, setCurrentGarmentAssetIds] = useState<string[]>([]);
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<string[]>([]);
  const [deselectedAssetLibraryPersonIds, setDeselectedAssetLibraryPersonIds] = useState<
    string[]
  >([]);
  const [deselectedAssetLibraryGarmentIds, setDeselectedAssetLibraryGarmentIds] = useState<
    string[]
  >([]);
  const [promptWorkbench, setPromptWorkbench] = useState<PromptWorkbenchState>(
    DEFAULT_PROMPT_WORKBENCH_STATE,
  );
  const [workbenchPromptTemplates, setWorkbenchPromptTemplates] = useState<PromptTemplate[]>(() =>
    buildFallbackPromptTemplates(),
  );
  const [workbenchPromptPresets, setWorkbenchPromptPresets] = useState<PromptPreset[]>(() =>
    buildFallbackPromptPresets(),
  );
  const [workbenchPromptPresetScenarios, setWorkbenchPromptPresetScenarios] = useState<
    PromptPresetScenario[]
  >(() => buildFallbackPromptPresetScenarios());
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_MODEL_ID);
  const [customModelId, setCustomModelId] = useState(DEFAULT_CUSTOM_MODEL_ID);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customProviderName, setCustomProviderName] = useState("");
  const [isCustomEndpointEnabled, setIsCustomEndpointEnabled] = useState(false);
  const [modelSize, setModelSize] = useState<(typeof MODEL_SIZES)[number]>("auto");
  const [outputCount, setOutputCount] = useState(1);
  const [imageFormat, setImageFormat] = useState(DEFAULT_IMAGE_FORMAT);
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_TIMEOUT_SECONDS);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY);
  const [autoSaveResult, setAutoSaveResult] = useState(DEFAULT_AUTO_SAVE_RESULT);
  const [storedModelConfigId, setStoredModelConfigId] = useState<string | null>(() =>
    readStoredModelConfigId(),
  );
  const [draftCombinationName, setDraftCombinationName] = useState<string | null>(null);
  const [modelDefinitions, setModelDefinitions] = useState<ModelDefinition[]>([]);
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
  const [isSavingModelSettings, setIsSavingModelSettings] = useState(false);
  const [isTestingProviderConnection, setIsTestingProviderConnection] = useState(false);
  const [validationResult, setValidationResult] =
    useState<ValidateCombinationResponse | null>(null);
  const [isSettingsCenterOpen, setIsSettingsCenterOpen] = useState(false);
  const [settingsCenterInitialPage, setSettingsCenterInitialPage] =
    useState<SettingsPage>("model");
  const [isTaskHistoryOpen, setIsTaskHistoryOpen] = useState(false);
  const [isPromptPresetCenterOpen, setIsPromptPresetCenterOpen] = useState(false);
  const [systemSettingsView, setSystemSettingsView] = useState<SystemSettingsView>(() => ({
    settings: DEFAULT_SYSTEM_SETTINGS,
    currentWorkspaceRoot: DEFAULT_SYSTEM_SETTINGS.workspaceRoot,
    systemProxyDetected: false,
    workspaceChangeRequiresRestart: false,
  }));
  const [cacheStats, setCacheStats] = useState<CacheStats>(EMPTY_CACHE_STATS);
  const [isSystemSettingsLoading, setIsSystemSettingsLoading] = useState(false);
  const [isSavingSystemSettings, setIsSavingSystemSettings] = useState(false);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestSettings, setProxyTestSettings] = useState<SystemSettings | null>(null);
  const [proxyTestDomainDraft, setProxyTestDomainDraft] = useState("google.com");
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>("details");
  const [selectedFlowNode, setSelectedFlowNode] = useState<FlowNodeId>("person");
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("select");
  const [zoom, setZoom] = useState(100);
  const [canvasResetRevision, setCanvasResetRevision] = useState(0);
  const [isAssetLibraryCollapsed, setIsAssetLibraryCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isCanvasMaximized, setIsCanvasMaximized] = useState(false);
  const canvasPanelRestoreStateRef = useRef<CanvasPanelCollapseState | null>(null);
  const workbenchAutoSaveSignatureRef = useRef<string | null>(null);
  const [newCombinationForm, setNewCombinationForm] =
    useState<NewCombinationForm>(() => buildNewCombinationForm());
  const [isNewCombinationModalOpen, setIsNewCombinationModalOpen] = useState(false);
  const [newCombinationError, setNewCombinationError] = useState<string | null>(null);
  const [isPromptPresetModalOpen, setIsPromptPresetModalOpen] = useState(false);
  const [newPromptPresetDraft, setNewPromptPresetDraft] = useState<PromptPresetDraft>(() =>
    buildEmptyPromptPresetDraft(),
  );
  const [newPromptPresetSourceMode, setNewPromptPresetSourceMode] =
    useState<PromptPresetSourceMode>("blank");
  const [newPromptPresetCopyId, setNewPromptPresetCopyId] = useState(
    DEFAULT_PROMPT_WORKBENCH_STATE.presetId,
  );
  const [shouldApplyNewPromptPreset, setShouldApplyNewPromptPreset] = useState(true);
  const [newPromptPresetError, setNewPromptPresetError] = useState<string | null>(null);
  const [selectedPromptPresetCenterId, setSelectedPromptPresetCenterId] = useState(
    DEFAULT_PROMPT_WORKBENCH_STATE.presetId,
  );
  const [promptPresetCenterDraft, setPromptPresetCenterDraft] = useState<PromptPresetDraft>(() =>
    buildEmptyPromptPresetDraft(),
  );
  const [promptPresetCenterError, setPromptPresetCenterError] = useState<string | null>(null);
  const [isSavingPromptPreset, setIsSavingPromptPreset] = useState(false);
  const [isPromptPresetScenarioModalOpen, setIsPromptPresetScenarioModalOpen] = useState(false);
  const [isSavingPromptPresetScenario, setIsSavingPromptPresetScenario] = useState(false);
  const latestTask = useGenerationTaskStore((state) => state.latestTask);
  const setLatestTask = useGenerationTaskStore((state) => state.setLatestTask);
  const setRunningTasks = useGenerationTaskStore((state) => state.setRunningTasks);
  const setRecentTasks = useGenerationTaskStore((state) => state.setRecentTasks);

  const modelConfig = useMemo<SaveModelConfigRequest>(
    () => {
      const isCustomProvider = selectedProvider === CUSTOM_PROVIDER;
      return {
        provider: selectedProvider,
        modelId: isCustomProvider
          ? customModelId.trim() || DEFAULT_CUSTOM_MODEL_ID
          : selectedModelId,
        paramsJson: {
          autoSaveResult,
          concurrency,
          format: imageFormat,
          outputCount,
          providerName: isCustomProvider ? customProviderName.trim() || undefined : undefined,
          providerBaseUrl: isCustomProvider || isCustomEndpointEnabled ? customBaseUrl.trim() : undefined,
          seed,
          size: modelSize,
          timeoutSeconds,
        },
      };
    },
    [
      autoSaveResult,
      concurrency,
      customBaseUrl,
      customModelId,
      customProviderName,
      imageFormat,
      isCustomEndpointEnabled,
      modelSize,
      outputCount,
      seed,
      selectedProvider,
      selectedModelId,
      timeoutSeconds,
    ],
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
  const resultAssets =
    currentCombination?.id && latestTask?.task.combinationId === currentCombination.id
      ? latestTask.results
      : [];
  const currentCombinationAssetView = useMemo(
    () =>
      buildCurrentCombinationAssetView({
        people,
        garments,
        results: resultAssets,
        personAssetId: selectedPersonId,
        personAssetIds: currentPersonAssetIds,
        garmentAssetIds: currentGarmentAssetIds,
      }),
    [currentGarmentAssetIds, currentPersonAssetIds, garments, people, resultAssets, selectedPersonId],
  );
  const canRun = validationResult?.executable === true && !isStarting && !isSaving;
  const combinationName = currentCombination?.name ?? draftCombinationName ?? "未保存组合";
  const effectiveModelId =
    selectedProvider === CUSTOM_PROVIDER
      ? customModelId.trim() || DEFAULT_CUSTOM_MODEL_ID
      : selectedModelId;
  const promptPresetOptions = useMemo(
    () => buildPromptPresetOptions(workbenchPromptPresets),
    [workbenchPromptPresets],
  );
  const selectedPromptPreset = useMemo(
    () => findPromptPresetOption(promptPresetOptions, promptWorkbench.presetId),
    [promptPresetOptions, promptWorkbench.presetId],
  );
  const promptBindingDraft = useMemo(
    () =>
      buildPromptBindingFromWorkbench({
        combinationId: currentCombination?.id ?? "draft",
        preset: selectedPromptPreset,
        variables: promptWorkbench.variables,
        additionalInstructions: promptWorkbench.additionalInstructions,
        advanced: promptWorkbench.advanced,
      }),
    [
      currentCombination?.id,
      promptWorkbench.additionalInstructions,
      promptWorkbench.advanced,
      promptWorkbench.variables,
      selectedPromptPreset,
    ],
  );
  const promptSummaryText =
    selectedPromptPreset?.name ?? promptWorkbench.additionalInstructions.trim() ?? "";
  const workbenchAutoSaveInput = useMemo<WorkbenchAutoSaveInput>(
    () => ({
      combinationId: currentCombination?.id ?? null,
      combinationName: currentCombination?.name ?? draftCombinationName ?? buildCombinationName(),
      personAssetId: selectedPersonId,
      personAssetIds: normalizeCombinationPersonAssetIds({
        currentPersonAssetId: selectedPersonId,
        currentPersonAssetIds: currentPersonAssetIds,
      }),
      garmentAssetIds: currentGarmentAssetIds,
      promptBinding:
        currentCombination?.id && selectedPromptPreset
          ? {
              ...promptBindingDraft,
              combinationId: currentCombination.id,
            }
          : null,
      modelConfig: {
        ...modelConfig,
        id: storedModelConfigId,
      },
    }),
    [
      currentCombination?.id,
      currentCombination?.name,
      draftCombinationName,
      modelConfig,
      promptBindingDraft,
      currentGarmentAssetIds,
      currentPersonAssetIds,
      selectedPersonId,
      selectedPromptPreset,
      storedModelConfigId,
    ],
  );

  async function refreshTaskLists() {
    const [runningTasks, recentTasks] = await Promise.all([
      listRunningGenerationTasks(),
      listRecentGenerationTasks(),
    ]);
    setRunningTasks(runningTasks);
    setRecentTasks(recentTasks);
  }

  async function refreshSystemSettings() {
    if (!isTauriRuntime()) {
      return;
    }
    setIsSystemSettingsLoading(true);
    try {
      const [settingsView, stats] = await Promise.all([
        getSystemSettings(),
        getCacheStats(),
      ]);
      setSystemSettingsView(settingsView);
      setCacheStats(stats);
    } catch (error) {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "加载系统设置失败");
    } finally {
      setIsSystemSettingsLoading(false);
    }
  }

  async function handleSaveSystemSettings(settings: SystemSettings) {
    setIsSavingSystemSettings(true);
    try {
      const settingsView = isTauriRuntime()
        ? await saveSystemSettings(settings)
        : {
            settings,
            currentWorkspaceRoot: settings.workspaceRoot,
            systemProxyDetected: false,
            workspaceChangeRequiresRestart: false,
          };
      setSystemSettingsView(settingsView);
      setActionError(null);
      setActionMessage(
        settingsView.workspaceChangeRequiresRestart
          ? "系统设置已保存，工作区路径将在重启后生效"
          : "系统设置已保存",
      );
    } catch (error) {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "保存系统设置失败");
    } finally {
      setIsSavingSystemSettings(false);
    }
  }

  async function handleTestProxy(settings: SystemSettings, testDomain: string) {
    const normalizedDomain = testDomain.trim();
    if (!normalizedDomain) {
      setActionMessage(null);
      setActionError("请输入代理测试域名");
      return;
    }
    setIsTestingProxy(true);
    try {
      const result = isTauriRuntime()
        ? await testProxyConnection(settings, normalizedDomain)
        : { testUrl: `https://${normalizedDomain}`, statusCode: 200, elapsedMs: 0 };
      setActionError(null);
      setActionMessage(
        `代理测试通过：${result.testUrl}，状态 ${result.statusCode}，耗时 ${result.elapsedMs}ms`,
      );
      setProxyTestSettings(null);
    } catch (error) {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "代理测试失败");
    } finally {
      setIsTestingProxy(false);
    }
  }

  function openProxyTestDialog(settings: SystemSettings) {
    setActionError(null);
    setProxyTestDomainDraft("google.com");
    setProxyTestSettings(settings);
  }

  async function handleClearCache() {
    if (!isTauriRuntime()) {
      return;
    }
    setIsClearingCache(true);
    try {
      const result: ClearCacheResult = await clearWorkspaceCache();
      setCacheStats(result.stats);
      setActionError(null);
      setActionMessage(`已清理 ${formatStorageSize(result.removedBytes)} 缓存`);
    } catch (error) {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "清理缓存失败");
    } finally {
      setIsClearingCache(false);
    }
  }

  async function handleOpenWorkspaceDirectory() {
    if (!isTauriRuntime()) {
      setActionMessage(null);
      setActionError("仅桌面端支持打开工作区目录");
      return;
    }
    try {
      await openCurrentWorkspaceDirectory();
      setActionError(null);
      setActionMessage("已打开工作区目录");
    } catch (error) {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "打开工作区失败");
    }
  }

  function markWorkbenchAutoSaveSnapshot(input: WorkbenchAutoSaveInput) {
    workbenchAutoSaveSignatureRef.current = buildWorkbenchAutoSaveSignature(input);
  }

  async function flushWorkbenchAutoSave(input: WorkbenchAutoSaveInput = workbenchAutoSaveInput) {
    const plan = buildWorkbenchAutoSavePlan(input);
    if (!plan) {
      return;
    }
    const signature = buildWorkbenchAutoSaveSignature(input);
    if (signature === workbenchAutoSaveSignatureRef.current) {
      return;
    }

    const [savedCombination, _savedPromptBinding, savedModelConfig] = await Promise.all([
      saveImageCombination(plan.combination),
      savePromptBinding(plan.promptBinding),
      saveModelConfig(plan.modelConfig),
    ]);
    setCurrentCombination(savedCombination);
    applyCombinationAssetSelection(savedCombination);
    setCombinationSummaries((summaries) =>
      upsertCombinationSummary(summaries, savedCombination),
    );
    setDraftCombinationName(null);
    storeModelConfigId(savedModelConfig.id);
    setStoredModelConfigId(savedModelConfig.id);
    markWorkbenchAutoSaveSnapshot({
      ...input,
      combinationId: savedCombination.id,
      combinationName: savedCombination.name,
      modelConfig: {
        ...plan.modelConfig,
        id: savedModelConfig.id,
      },
    });
  }

  function applyPromptWorkbenchState(nextWorkbench: PromptWorkbenchState) {
    const normalized = normalizePromptWorkbenchOutputCount(nextWorkbench, outputCount);
    setPromptWorkbench(normalized.workbench);
    setOutputCount(normalized.outputCount);
  }

  function buildAutoSaveInputForCombination(
    combination: ImageCombination,
    promptBinding?: SavePromptBindingRequest | null,
  ): WorkbenchAutoSaveInput {
    return {
      combinationId: combination.id,
      combinationName: combination.name,
      personAssetId: combination.personAssetId,
      personAssetIds: combination.personAssetIds,
      garmentAssetIds: combination.garmentAssetIds,
      promptBinding:
        promptBinding !== undefined
          ? promptBinding
          : selectedPromptPreset
            ? buildPromptBindingFromWorkbench({
                combinationId: combination.id,
                preset: selectedPromptPreset,
                variables: promptWorkbench.variables,
                additionalInstructions: promptWorkbench.additionalInstructions,
                advanced: promptWorkbench.advanced,
              })
            : null,
      modelConfig: {
        ...modelConfig,
        id: storedModelConfigId,
      },
    };
  }

  function applyCombinationAssetSelection(combination: ImageCombination) {
    const storedSelectionState = readStoredCombinationSelectionState(combination.id);
    const nextCurrentPersonAssetIds = normalizeCombinationPersonAssetIds({
      currentPersonAssetId: combination.personAssetId,
      currentPersonAssetIds: combination.personAssetIds,
    });
    const nextDeselectedPersonAssetIds =
      storedSelectionState.deselectedPersonAssetIds.filter((id) =>
        nextCurrentPersonAssetIds.includes(id),
      );
    const nextDeselectedGarmentAssetIds =
      storedSelectionState.deselectedGarmentAssetIds.filter((id) =>
        combination.garmentAssetIds.includes(id),
      );

    setSelectedPersonId(
      buildActivePersonAssetIdForCombination({
        currentPersonAssetId: combination.personAssetId,
        currentPersonAssetIds: nextCurrentPersonAssetIds,
        deselectedPersonAssetIds: nextDeselectedPersonAssetIds,
      }),
    );
    setCurrentPersonAssetIds(nextCurrentPersonAssetIds);
    setDeselectedAssetLibraryPersonIds(nextDeselectedPersonAssetIds);
    setCurrentGarmentAssetIds(combination.garmentAssetIds);
    setDeselectedAssetLibraryGarmentIds(nextDeselectedGarmentAssetIds);
    setSelectedGarmentIds(
      buildActiveGarmentAssetIdsForCombination({
        currentGarmentAssetIds: combination.garmentAssetIds,
        deselectedGarmentAssetIds: nextDeselectedGarmentAssetIds,
      }),
    );
    storeCombinationSelectionState(combination.id, {
      deselectedPersonAssetIds: nextDeselectedPersonAssetIds,
      deselectedGarmentAssetIds: nextDeselectedGarmentAssetIds,
    });
  }

  function buildPromptBindingForWorkbenchState(
    combinationId: string,
    workbench: PromptWorkbenchState,
    presetOptions: PromptPresetOption[],
  ): SavePromptBindingRequest | null {
    const preset = findPromptPresetOption(presetOptions, workbench.presetId);
    if (!preset) {
      return null;
    }
    return buildPromptBindingFromWorkbench({
      combinationId,
      preset,
      variables: workbench.variables,
      additionalInstructions: workbench.additionalInstructions,
      advanced: workbench.advanced,
    });
  }

  async function refreshPromptTemplatesForWorkbench(): Promise<PromptWorkbenchData> {
    if (!isTauriRuntime()) {
      const templates = buildFallbackPromptTemplates();
      const presets = buildFallbackPromptPresets();
      const scenarios = buildFallbackPromptPresetScenarios();
      setWorkbenchPromptTemplates(templates);
      setWorkbenchPromptPresets(presets);
      setWorkbenchPromptPresetScenarios(scenarios);
      return {
        templates,
        presets,
        scenarios,
        presetOptions: buildPromptPresetOptions(presets),
      };
    }
    const [templates, presets, scenarios] = await Promise.all([
      listPromptTemplates(),
      listPromptPresets(),
      listPromptPresetScenarios(),
    ]);
    setWorkbenchPromptTemplates(templates);
    setWorkbenchPromptPresets(presets);
    setWorkbenchPromptPresetScenarios(scenarios);
    return {
      templates,
      presets,
      scenarios,
      presetOptions: buildPromptPresetOptions(presets),
    };
  }

  async function refreshAssets() {
    const [personAssets, garmentAssets] = await Promise.all([
      listAssets("person"),
      listAssets("garment"),
    ]);
    setPeople(applySavedAssetOrder("person", personAssets));
    setGarments(applySavedAssetOrder("garment", garmentAssets));
  }

  async function refreshCredentialStatus(provider = selectedProvider) {
    const status = await getProviderCredentialStatus(provider);
    setCredentialStatus(status);
  }

  async function refreshModelSettings() {
    const definitions = await listModelDefinitions(false);
    setModelDefinitions(definitions);

    const savedConfigId = readStoredModelConfigId();
    if (!savedConfigId) {
      await refreshCredentialStatus(selectedProvider);
      return;
    }

    const savedConfig = await getModelConfig(savedConfigId);
    if (savedConfig) {
      applyModelConfigState(savedConfig);
      await refreshCredentialStatus(normalizeProviderId(savedConfig.provider));
      return;
    }

    await refreshCredentialStatus(selectedProvider);
  }

  function applyModelConfigState(config: ModelConfig) {
    const provider = normalizeProviderId(config.provider);
    setSelectedProvider(provider);
    if (provider === CUSTOM_PROVIDER) {
      setCustomModelId(config.modelId || DEFAULT_CUSTOM_MODEL_ID);
    } else {
      setSelectedModelId(config.modelId);
    }
    setCustomProviderName(
      provider === CUSTOM_PROVIDER ? normalizeStringParam(config.paramsJson.providerName, "") : "",
    );
    setCustomBaseUrl(normalizeStringParam(config.paramsJson.providerBaseUrl, ""));
    setIsCustomEndpointEnabled(
      provider === CUSTOM_PROVIDER || Boolean(normalizeStringParam(config.paramsJson.providerBaseUrl, "")),
    );
    setModelSize(normalizeModelSize(config.paramsJson.size));
    setOutputCount(normalizeIntegerParam(config.paramsJson.outputCount, 1, 4, 1));
    setImageFormat(normalizeStringParam(config.paramsJson.format, DEFAULT_IMAGE_FORMAT));
    setTimeoutSeconds(
      normalizeIntegerParam(config.paramsJson.timeoutSeconds, 30, 600, DEFAULT_TIMEOUT_SECONDS),
    );
    setSeed(normalizeIntegerParam(config.paramsJson.seed, -1, 999999, DEFAULT_SEED));
    setConcurrency(normalizeIntegerParam(config.paramsJson.concurrency, 1, 5, DEFAULT_CONCURRENCY));
    setAutoSaveResult(
      typeof config.paramsJson.autoSaveResult === "boolean"
        ? config.paramsJson.autoSaveResult
        : DEFAULT_AUTO_SAVE_RESULT,
    );
  }

  async function refreshWorkbenchData() {
    const [personAssets, garmentAssets, combinations, , , promptData] = await Promise.all([
      listAssets("person"),
      listAssets("garment"),
      listImageCombinations(),
      refreshTaskLists(),
      refreshModelSettings(),
      refreshPromptTemplatesForWorkbench(),
    ]);
    setPeople(applySavedAssetOrder("person", personAssets));
    setGarments(applySavedAssetOrder("garment", garmentAssets));
    setCombinationSummaries(sortCombinationSummaries(combinations));

    const latest = getDefaultCombinationSummary(combinations);
    if (!latest) {
      setCurrentCombination(null);
      setSelectedPersonId(null);
      setCurrentPersonAssetIds([]);
      setCurrentGarmentAssetIds([]);
      setSelectedGarmentIds([]);
      setDeselectedAssetLibraryPersonIds([]);
      setDeselectedAssetLibraryGarmentIds([]);
      setLatestTask(null);
      return;
    }

    const combination = await getImageCombination(latest.id);
    setCurrentCombination(combination);
    if (combination) {
      applyCombinationAssetSelection(combination);
    } else {
      setSelectedPersonId(null);
      setCurrentPersonAssetIds([]);
      setCurrentGarmentAssetIds([]);
      setSelectedGarmentIds([]);
      setDeselectedAssetLibraryPersonIds([]);
      setDeselectedAssetLibraryGarmentIds([]);
    }

    if (combination) {
      const promptBinding = await getPromptBinding(combination.id);
      const nextPromptWorkbench = buildPromptWorkbenchFromBinding(
        promptBinding,
        promptData.presetOptions,
      );
      const nextPromptBinding =
        promptBinding
          ? buildPromptBindingSaveRequest(promptBinding)
          : buildPromptBindingForWorkbenchState(
              combination.id,
              nextPromptWorkbench,
              promptData.presetOptions,
            );
      setPromptWorkbench(nextPromptWorkbench);
      markWorkbenchAutoSaveSnapshot(
        buildAutoSaveInputForCombination(combination, nextPromptBinding),
      );
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
      await flushWorkbenchAutoSave();
      const [combination, personAssets, garmentAssets, promptBinding] = await Promise.all([
        getImageCombination(combinationId),
        listAssets("person"),
        listAssets("garment"),
        getPromptBinding(combinationId),
      ]);
      if (!combination) {
        throw new Error("未找到选择的组合");
      }
      const nextPromptWorkbench = buildPromptWorkbenchFromBinding(promptBinding, promptPresetOptions);
      const nextPromptBinding =
        promptBinding
          ? buildPromptBindingSaveRequest(promptBinding)
          : buildPromptBindingForWorkbenchState(
              combination.id,
              nextPromptWorkbench,
              promptPresetOptions,
            );
      setPeople(applySavedAssetOrder("person", personAssets));
      setGarments(applySavedAssetOrder("garment", garmentAssets));
      setCurrentCombination(combination);
      setDraftCombinationName(null);
      applyCombinationAssetSelection(combination);
      setPromptWorkbench(nextPromptWorkbench);
      markWorkbenchAutoSaveSnapshot(
        buildAutoSaveInputForCombination(combination, nextPromptBinding),
      );
      setLatestTask(null);
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
    if (!actionError) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setActionError((currentError) =>
        currentError === actionError ? null : currentError,
      );
    }, ACTION_MESSAGE_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [actionError]);

  useEffect(() => {
    if (!loadingError) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setLoadingError((currentError) =>
        currentError === loadingError ? null : currentError,
      );
    }, ACTION_MESSAGE_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadingError]);

  useEffect(() => {
    const selectedDefinition = modelDefinitions.find(
      (definition) =>
        definition.provider === selectedProvider && definition.modelId === selectedModelId,
    );
    if (!selectedDefinition) {
      return;
    }
    setOutputCount((currentOutputCount) =>
      normalizeIntegerParam(
        currentOutputCount,
        selectedDefinition.output.minCount,
        selectedDefinition.output.maxCount,
        selectedDefinition.output.minCount,
      ),
    );
  }, [modelDefinitions, selectedModelId, selectedProvider]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let canceled = false;
    setLoadingError(null);
    refreshSystemSettings().catch(() => undefined);
    refreshTaskLists().catch(() => undefined);
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
      draftPromptBinding: promptBindingDraft,
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
          console.warn("validate combination failed", error);
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
    promptBindingDraft,
    selectedGarmentIds,
    selectedPersonId,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }

    const plan = buildWorkbenchAutoSavePlan(workbenchAutoSaveInput);
    if (!plan) {
      return undefined;
    }

    const signature = buildWorkbenchAutoSaveSignature(workbenchAutoSaveInput);
    if (signature === workbenchAutoSaveSignatureRef.current) {
      return undefined;
    }

    let canceled = false;
    const timeoutId = window.setTimeout(() => {
      Promise.all([
        saveImageCombination(plan.combination),
        savePromptBinding(plan.promptBinding),
        saveModelConfig(plan.modelConfig),
      ])
        .then(([savedCombination, _savedPromptBinding, savedModelConfig]) => {
          if (canceled) {
            return;
          }
          setCurrentCombination(savedCombination);
          setCombinationSummaries((summaries) =>
            upsertCombinationSummary(summaries, savedCombination),
          );
          setDraftCombinationName(null);
          storeModelConfigId(savedModelConfig.id);
          setStoredModelConfigId(savedModelConfig.id);
          markWorkbenchAutoSaveSnapshot({
            ...workbenchAutoSaveInput,
            combinationId: savedCombination.id,
            combinationName: savedCombination.name,
            modelConfig: {
              ...plan.modelConfig,
              id: savedModelConfig.id,
            },
          });
        })
        .catch((error) => {
          if (!canceled) {
            setActionError(error instanceof Error ? error.message : "自动保存工作台失败");
          }
        });
    }, WORKBENCH_AUTO_SAVE_DELAY_MS);

    return () => {
      canceled = true;
      window.clearTimeout(timeoutId);
    };
  }, [workbenchAutoSaveInput]);

  useEffect(() => {
    if (!promptPresetOptions.length) {
      return;
    }
    if (promptPresetOptions.some((option) => option.id === promptWorkbench.presetId)) {
      return;
    }
    const fallbackPreset = promptPresetOptions[0];
    setPromptWorkbench((current) => ({
      ...current,
      presetId: fallbackPreset.id,
      variables: fallbackPreset.variables,
      advanced: null,
    }));
  }, [promptPresetOptions, promptWorkbench.presetId]);

  useEffect(() => {
    setPromptWorkbench((current) => {
      const nextOutputCount = String(outputCount);
      if (current.variables.outputCount === nextOutputCount) {
        return current;
      }
      return {
        ...current,
        variables: {
          ...current.variables,
          outputCount: nextOutputCount,
        },
      };
    });
  }, [outputCount]);

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
    const selected = await openImagePicker(assetType);

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
        const nextCurrentPersonAssetIds = buildCombinationPersonAssetIdsAfterImport({
          currentPersonAssetId: selectedPersonId,
          currentPersonAssetIds,
          importedPeople: views,
        });
        const nextDeselectedPersonAssetIds = deselectedAssetLibraryPersonIds.filter(
          (id) => nextCurrentPersonAssetIds.includes(id),
        );
        setPeople((items) => saveOrderedAssets("person", upsertAssets(items, views)));
        setCurrentPersonAssetIds(nextCurrentPersonAssetIds);
        setDeselectedAssetLibraryPersonIds(nextDeselectedPersonAssetIds);
        storeCombinationSelectionState(currentCombination?.id, {
          deselectedPersonAssetIds: nextDeselectedPersonAssetIds,
          deselectedGarmentAssetIds: deselectedAssetLibraryGarmentIds,
        });
      } else {
        const nextCurrentGarmentAssetIds = buildCombinationGarmentAssetIdsAfterImport({
          currentGarmentAssetIds,
          importedGarments: views,
        });
        const nextDeselectedGarmentAssetIds = buildDeselectedAssetIdsFromActiveIds({
          currentAssetIds: nextCurrentGarmentAssetIds,
          activeAssetIds: selectedGarmentIds,
        });
        setGarments((items) => saveOrderedAssets("garment", upsertAssets(items, views)));
        setCurrentGarmentAssetIds(nextCurrentGarmentAssetIds);
        setDeselectedAssetLibraryGarmentIds(nextDeselectedGarmentAssetIds);
        storeCombinationSelectionState(currentCombination?.id, {
          deselectedPersonAssetIds: deselectedAssetLibraryPersonIds,
          deselectedGarmentAssetIds: nextDeselectedGarmentAssetIds,
        });
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
    const selected = await openImagePicker(assetType);

    const selectedPaths = normalizeSelectedImagePaths(selected);
    if (!selectedPaths.length) {
      return;
    }

    setImportingType(assetType);
    setNewCombinationError(null);
    try {
      const { views, duplicateCount } = await importSelectedImages(selectedPaths, assetType);

      if (assetType === "person") {
        const importedIds = views.map((view) => view.asset.id);
        setPeople((items) => saveOrderedAssets("person", upsertAssets(items, views)));
        setNewCombinationForm((form) => ({
          ...form,
          personAssetId: form.personAssetId ?? importedIds[0] ?? null,
          personAssetIds: buildNewCombinationPersonAssetIdsAfterImport({
            currentPersonAssetId: form.personAssetId,
            currentPersonAssetIds: form.personAssetIds,
            importedPersonAssetIds: importedIds,
          }),
        }));
      } else {
        const importedIds = views.map((view) => view.asset.id);
        setGarments((items) => saveOrderedAssets("garment", upsertAssets(items, views)));
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
      const promptBinding = buildPromptBindingFromWorkbench({
        combinationId: saved.id,
        preset: selectedPromptPreset,
        variables: promptWorkbench.variables,
        additionalInstructions: promptWorkbench.additionalInstructions,
        advanced: promptWorkbench.advanced,
      });
      await savePromptBinding(promptBinding);
      const task = await startGeneration({
        combinationId: saved.id,
        draftPromptBinding: promptBinding,
        draftModelConfig: modelConfig,
        draftGarmentAssetIds: selectedGarmentIds,
      });
      const detail = await getGenerationTaskDetail(task.id);
      setLatestTask(detail ?? { task, results: [], executionLogs: [] });
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
      await setProviderApiKey(selectedProvider, apiKeyDraft);
      await refreshCredentialStatus();
      setApiKeyDraft("");
      setActionMessage("API Key 已保存到系统密钥库");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存 API Key 失败");
    } finally {
      setIsSavingApiKey(false);
    }
  }

  async function handleSaveModelSettings() {
    setIsSavingModelSettings(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (apiKeyDraft.trim()) {
        await setProviderApiKey(selectedProvider, apiKeyDraft);
        setApiKeyDraft("");
      }
      const savedConfig = await saveModelConfig({
        ...modelConfig,
        id: readStoredModelConfigId(),
      });
      storeModelConfigId(savedConfig.id);
      setStoredModelConfigId(savedConfig.id);
      applyModelConfigState(savedConfig);
      await refreshCredentialStatus();
      setActionMessage(getProviderStatusLabel(normalizeProviderId(savedConfig.provider)));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存模型设置失败");
    } finally {
      setIsSavingModelSettings(false);
    }
  }

  async function handleTestProviderConnection() {
    setIsTestingProviderConnection(true);
    setActionError(null);
    setActionMessage(null);
    try {
      if (apiKeyDraft.trim()) {
        await setProviderApiKey(selectedProvider, apiKeyDraft);
        setApiKeyDraft("");
      }
      const savedConfig = await saveModelConfig({
        ...modelConfig,
        id: readStoredModelConfigId(),
      });
      storeModelConfigId(savedConfig.id);
      setStoredModelConfigId(savedConfig.id);
      applyModelConfigState(savedConfig);
      const status = await getProviderCredentialStatus(selectedProvider);
      setCredentialStatus(status);
      if (!status.configured) {
        throw new Error(`请先保存 ${getProviderLabel(selectedProvider)} API Key`);
      }
      setActionMessage("连接检查通过");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "测试连接失败");
    } finally {
      setIsTestingProviderConnection(false);
    }
  }

  function handleResetModelSettings() {
    setSelectedProvider(DEFAULT_PROVIDER);
    setSelectedModelId(DEFAULT_MODEL_ID);
    setCustomModelId(DEFAULT_CUSTOM_MODEL_ID);
    setCustomBaseUrl("");
    setIsCustomEndpointEnabled(false);
    setModelSize("1024x1024");
    setOutputCount(1);
    setImageFormat(DEFAULT_IMAGE_FORMAT);
    setTimeoutSeconds(DEFAULT_TIMEOUT_SECONDS);
    setSeed(DEFAULT_SEED);
    setConcurrency(DEFAULT_CONCURRENCY);
    setAutoSaveResult(DEFAULT_AUTO_SAVE_RESULT);
    setApiKeyDraft("");
    setActionMessage("已恢复默认模型参数，保存后生效");
  }

  function handleSelectProvider(provider: ProviderId) {
    const option = PROVIDER_OPTIONS.find((item) => item.id === provider);
    if (!option?.enabled) {
      return;
    }
    setSelectedProvider(provider);
    setApiKeyDraft("");
    setIsCustomEndpointEnabled(provider === CUSTOM_PROVIDER);
    setActionError(null);
    setActionMessage(null);

    const firstModel = modelDefinitions.find((definition) => definition.provider === provider);
    if (provider === CUSTOM_PROVIDER) {
      setSelectedModelId(DEFAULT_CUSTOM_MODEL_ID);
      setOutputCount((currentOutputCount) =>
        normalizeIntegerParam(currentOutputCount, 1, 8, 1),
      );
    } else if (firstModel) {
      setSelectedModelId(firstModel.modelId);
      setOutputCount((currentOutputCount) =>
        normalizeIntegerParam(
          currentOutputCount,
          firstModel.output.minCount,
          firstModel.output.maxCount,
          firstModel.output.minCount,
        ),
      );
    }

    if (isTauriRuntime()) {
      getProviderCredentialStatus(provider)
        .then(setCredentialStatus)
        .catch((error) =>
          setActionError(error instanceof Error ? error.message : "读取 API Key 状态失败"),
        );
    } else {
      setCredentialStatus({ provider, configured: false, maskedKey: null });
    }
  }

  async function persistCurrentCombination() {
    if (!selectedPersonId) {
      throw new Error("请先选择人物图片");
    }
    if (!selectedGarmentIds.length) {
      throw new Error("请至少选择一张服装图片");
    }
    if (!selectedPromptPreset) {
      throw new Error("请选择输出方案");
    }

    const saved = await saveImageCombination({
      id: currentCombination?.id,
      name: currentCombination?.name ?? draftCombinationName ?? buildCombinationName(),
      personAssetId: selectedPersonId,
      personAssetIds: normalizeCombinationPersonAssetIds({
        currentPersonAssetId: selectedPersonId,
        currentPersonAssetIds,
      }),
      garmentAssetIds: currentGarmentAssetIds,
    });
    setCurrentCombination(saved);
    setCombinationSummaries((summaries) => upsertCombinationSummary(summaries, saved));
    setDraftCombinationName(null);
    const promptBinding = buildPromptBindingFromWorkbench({
      combinationId: saved.id,
      preset: selectedPromptPreset,
      variables: promptWorkbench.variables,
      additionalInstructions: promptWorkbench.additionalInstructions,
      advanced: promptWorkbench.advanced,
    });
    const savedModelConfig = await saveModelConfig({
      ...modelConfig,
      id: storedModelConfigId,
    });
    storeModelConfigId(savedModelConfig.id);
    setStoredModelConfigId(savedModelConfig.id);
    await savePromptBinding(promptBinding);
    markWorkbenchAutoSaveSnapshot({
      combinationId: saved.id,
      combinationName: saved.name,
      personAssetId: saved.personAssetId,
      personAssetIds: saved.personAssetIds,
      garmentAssetIds: currentGarmentAssetIds,
      promptBinding,
      modelConfig: {
        ...modelConfig,
        id: savedModelConfig.id,
      },
    });
    await refreshTaskLists();
    return saved;
  }

  function openNewCombinationModal() {
    setNewCombinationForm(buildNewCombinationForm());
    setNewCombinationError(null);
    setIsNewCombinationModalOpen(true);
  }

  function openPromptPresetModal() {
    const fallbackPreset = selectedPromptPreset ?? promptPresetOptions[0] ?? null;
    const draft = buildEmptyPromptPresetDraft(fallbackPreset);
    setNewPromptPresetDraft(draft);
    setNewPromptPresetSourceMode("blank");
    setNewPromptPresetCopyId(fallbackPreset?.id ?? "");
    setShouldApplyNewPromptPreset(true);
    setNewPromptPresetError(null);
    setIsPromptPresetModalOpen(true);
  }

  function openPromptPresetCenter() {
    const preset = selectedPromptPreset ?? promptPresetOptions[0] ?? null;
    if (preset) {
      setSelectedPromptPresetCenterId(preset.id);
      setPromptPresetCenterDraft(buildPromptPresetDraftFromOption(preset));
    }
    setPromptPresetCenterError(null);
    setIsSettingsCenterOpen(false);
    setIsTaskHistoryOpen(false);
    setIsPromptPresetCenterOpen(true);
  }

  function openWorkbench() {
    setIsTaskHistoryOpen(false);
    setIsPromptPresetCenterOpen(false);
    setIsSettingsCenterOpen(false);
  }

  function openSettingsCenter(page: SettingsPage = "model") {
    setSettingsCenterInitialPage(page);
    setIsTaskHistoryOpen(false);
    setIsPromptPresetCenterOpen(false);
    setIsSettingsCenterOpen(true);
  }

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    let unlisteners: Array<() => void> = [];

    Promise.all([
      listen(OPEN_WORKBENCH_EVENT, () => {
        openWorkbench();
      }),
      listen(OPEN_SYSTEM_SETTINGS_EVENT, () => {
        openSettingsCenter("system");
      }),
      listen(OPEN_MODEL_SETTINGS_EVENT, () => {
        openSettingsCenter("model");
      }),
      listen(OPEN_PROMPT_PRESET_CENTER_EVENT, () => {
        openPromptPresetCenter();
      }),
    ])
      .then((handlers) => {
        if (disposed) {
          handlers.forEach((handler) => handler());
          return;
        }
        unlisteners = handlers;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisteners.forEach((handler) => handler());
    };
  }, [promptPresetOptions, selectedPromptPreset]);

  function openTaskHistory() {
    setIsSettingsCenterOpen(false);
    setIsPromptPresetCenterOpen(false);
    setIsTaskHistoryOpen(true);
  }

  function handleSelectPromptPresetForCenter(presetId: string) {
    const preset = findPromptPresetOption(promptPresetOptions, presetId);
    if (!preset) {
      return;
    }
    setSelectedPromptPresetCenterId(preset.id);
    setPromptPresetCenterDraft(buildPromptPresetDraftFromOption(preset));
    setPromptPresetCenterError(null);
  }

  function applyPromptPresetToWorkbench() {
    const preset = findPromptPresetOption(promptPresetOptions, selectedPromptPresetCenterId);
    if (!preset) {
      return;
    }
    applyPromptWorkbenchState({
      presetId: preset.id,
      variables: preset.variables,
      additionalInstructions: "",
      advanced: null,
    });
    setPromptPresetCenterError(null);
    setActionError(null);
    setActionMessage("已应用到当前组合");
  }

  async function handleCreatePromptPreset() {
    if (!newPromptPresetDraft.name.trim()) {
      setNewPromptPresetError("请填写方案名称");
      return;
    }
    if (!newPromptPresetDraft.scenario.trim()) {
      setNewPromptPresetError("请选择或填写适用场景");
      return;
    }
    if (!newPromptPresetDraft.user.baseTemplateId) {
      setNewPromptPresetError("请选择细节描述模板");
      return;
    }

    setIsSavingPromptPreset(true);
    setNewPromptPresetError(null);
    try {
      const draftToSave = syncPromptPresetDraftVariables(
        { ...newPromptPresetDraft, id: null },
        workbenchPromptTemplates,
      );
      const saved = isTauriRuntime()
        ? await savePromptPreset(draftToSave)
        : buildLocalPromptPreset(draftToSave);
      setWorkbenchPromptPresets((presets) => upsertPromptPreset(presets, saved));
      setSelectedPromptPresetCenterId(saved.id);
      const nextOption = buildPromptPresetOptions([saved])[0];
      if (nextOption) {
        setPromptPresetCenterDraft(buildPromptPresetDraftFromOption(nextOption));
      }
      if (shouldApplyNewPromptPreset) {
        applyPromptWorkbenchState({
          presetId: saved.id,
          variables: nextOption?.variables ?? DEFAULT_PROMPT_WORKBENCH_STATE.variables,
          additionalInstructions: "",
          advanced: null,
        });
      }
      setIsPromptPresetModalOpen(false);
      setActionMessage("组合方案已创建");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "创建组合方案失败");
    } finally {
      setIsSavingPromptPreset(false);
    }
  }

  async function handleSavePromptPresetCenterDraft() {
    const selectedPreset = findPromptPresetOption(promptPresetOptions, selectedPromptPresetCenterId);
    if (
      !selectedPreset ||
      arePromptPresetDraftsEqual(
        promptPresetCenterDraft,
        buildPromptPresetDraftFromOption(selectedPreset),
        workbenchPromptTemplates,
      )
    ) {
      return;
    }
    if (promptPresetCenterDraft.locked || promptPresetCenterDraft.id?.startsWith("builtin_")) {
      setPromptPresetCenterError("内置方案不能修改，请复制或新建自定义方案");
      return;
    }
    if (!promptPresetCenterDraft.name.trim()) {
      setPromptPresetCenterError("请填写方案名称");
      return;
    }
    if (!promptPresetCenterDraft.scenario.trim()) {
      setPromptPresetCenterError("请选择或填写适用场景");
      return;
    }
    if (!promptPresetCenterDraft.user.baseTemplateId) {
      setPromptPresetCenterError("请选择细节描述模板");
      return;
    }

    setIsSavingPromptPreset(true);
    setPromptPresetCenterError(null);
    try {
      const draftToSave = syncPromptPresetDraftVariables(
        promptPresetCenterDraft,
        workbenchPromptTemplates,
      );
      const saved = isTauriRuntime()
        ? await savePromptPreset(draftToSave)
        : buildLocalPromptPreset(draftToSave);
      setWorkbenchPromptPresets((presets) => upsertPromptPreset(presets, saved));
      setSelectedPromptPresetCenterId(saved.id);
      const nextOption = buildPromptPresetOptions([saved])[0];
      if (nextOption) {
        setPromptPresetCenterDraft(buildPromptPresetDraftFromOption(nextOption));
      }
      setActionMessage("组合方案已保存");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存组合方案失败");
    } finally {
      setIsSavingPromptPreset(false);
    }
  }

  async function handleSavePromptPresetScenario(request: SavePromptPresetScenarioRequest) {
    const name = request.name.trim();
    if (!name) {
      throw new Error("请填写场景名称");
    }
    setIsSavingPromptPresetScenario(true);
    setActionError(null);
    try {
      const previousScenario = request.id
        ? workbenchPromptPresetScenarios.find((scenario) => scenario.id === request.id) ?? null
        : null;
      const saved = isTauriRuntime()
        ? await savePromptPresetScenario({ ...request, name })
        : buildLocalPromptPresetScenario(request, workbenchPromptPresetScenarios);
      setWorkbenchPromptPresetScenarios((scenarios) => upsertPromptPresetScenario(scenarios, saved));

      if (previousScenario && previousScenario.name !== saved.name) {
        setWorkbenchPromptPresets((presets) =>
          presets.map((preset) =>
            preset.scenario === previousScenario.name
              ? { ...preset, scenario: saved.name, updatedAt: new Date().toISOString() }
              : preset,
          ),
        );
        setPromptPresetCenterDraft((draft) =>
          draft.scenario === previousScenario.name ? { ...draft, scenario: saved.name } : draft,
        );
        setNewPromptPresetDraft((draft) =>
          draft.scenario === previousScenario.name ? { ...draft, scenario: saved.name } : draft,
        );
      }

      setActionMessage(request.id ? "场景已更新" : "场景已添加");
      return saved;
    } catch (error) {
      setActionMessage(null);
      setActionError(error instanceof Error ? error.message : "保存场景失败");
      throw error;
    } finally {
      setIsSavingPromptPresetScenario(false);
    }
  }

  async function handleCreateCombination() {
    const name = newCombinationForm.name.trim();
    if (!name) {
      setNewCombinationError("请填写组合名称");
      return;
    }

    const nextGarmentIds = newCombinationForm.garmentAssetIds.slice(0, 4);
    const nextPersonIds = buildNewCombinationPersonAssetIdsAfterImport({
      currentPersonAssetId: newCombinationForm.personAssetId,
      currentPersonAssetIds: newCombinationForm.personAssetIds,
      importedPersonAssetIds: [],
    });
    const nextPersonAssetId = newCombinationForm.personAssetId ?? nextPersonIds[0] ?? null;
    if (!nextPersonAssetId) {
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
    const defaultPromptPreset = findPromptPresetOption(
      promptPresetOptions,
      DEFAULT_PROMPT_WORKBENCH_STATE.presetId,
    );
    const nextPromptWorkbench: PromptWorkbenchState = {
      presetId: defaultPromptPreset?.id ?? DEFAULT_PROMPT_WORKBENCH_STATE.presetId,
      variables: defaultPromptPreset?.variables ?? DEFAULT_PROMPT_WORKBENCH_STATE.variables,
      additionalInstructions: "",
      advanced: null,
    };
    setPromptWorkbench(nextPromptWorkbench);
    setSelectedPersonId(nextPersonAssetId);
    setCurrentPersonAssetIds(nextPersonIds);
    setCurrentGarmentAssetIds(nextGarmentIds);
    setSelectedGarmentIds(nextGarmentIds);

    setIsSaving(true);
    try {
      const saved = await saveImageCombination({
        name,
        personAssetId: nextPersonAssetId,
        personAssetIds: nextPersonIds,
        garmentAssetIds: nextGarmentIds,
      });
      setCurrentCombination(saved);
      applyCombinationAssetSelection(saved);
      setCombinationSummaries((summaries) => upsertCombinationSummary(summaries, saved));
      setDraftCombinationName(null);
      await savePromptBinding(
        buildPromptBindingFromWorkbench({
          combinationId: saved.id,
          preset: defaultPromptPreset,
          variables: nextPromptWorkbench.variables,
          additionalInstructions: nextPromptWorkbench.additionalInstructions,
          advanced: nextPromptWorkbench.advanced,
        }),
      );
      setLatestTask(null);
      await refreshTaskLists();
      setIsNewCombinationModalOpen(false);
      setSelectedFlowNode("person");
      setSidePanelMode("details");
      setActionMessage("组合已创建");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "创建组合失败");
    } finally {
      setIsSaving(false);
    }
  }

  function toggleGarmentAssetSelection(assetId: string) {
    const nextCurrentGarmentAssetIds = currentGarmentAssetIds.includes(assetId)
      ? currentGarmentAssetIds
      : [assetId, ...currentGarmentAssetIds];
    const nextSelectedGarmentIds = selectedGarmentIds.includes(assetId)
      ? selectedGarmentIds.filter((id) => id !== assetId)
      : [assetId, ...selectedGarmentIds.filter((id) => id !== assetId)].slice(0, 4);
    const nextDeselectedGarmentAssetIds = buildDeselectedAssetIdsFromActiveIds({
      currentAssetIds: nextCurrentGarmentAssetIds,
      activeAssetIds: nextSelectedGarmentIds,
    });

    setCurrentGarmentAssetIds(nextCurrentGarmentAssetIds);
    setSelectedGarmentIds(nextSelectedGarmentIds);
    setDeselectedAssetLibraryGarmentIds(nextDeselectedGarmentAssetIds);
    storeCombinationSelectionState(currentCombination?.id, {
      deselectedPersonAssetIds: deselectedAssetLibraryPersonIds,
      deselectedGarmentAssetIds: nextDeselectedGarmentAssetIds,
    });
  }

  function removeGarmentFromCurrentCombination(assetId: string) {
    const nextCurrentGarmentAssetIds = currentGarmentAssetIds.filter((id) => id !== assetId);
    const nextSelectedGarmentIds = selectedGarmentIds.filter((id) => id !== assetId);
    const nextDeselectedGarmentAssetIds = deselectedAssetLibraryGarmentIds.filter(
      (id) => id !== assetId && nextCurrentGarmentAssetIds.includes(id),
    );
    setCurrentGarmentAssetIds(nextCurrentGarmentAssetIds);
    setSelectedGarmentIds(nextSelectedGarmentIds);
    setDeselectedAssetLibraryGarmentIds(nextDeselectedGarmentAssetIds);
    storeCombinationSelectionState(currentCombination?.id, {
      deselectedPersonAssetIds: deselectedAssetLibraryPersonIds,
      deselectedGarmentAssetIds: nextDeselectedGarmentAssetIds,
    });
  }

  function selectPersonForCurrentCombination(assetId: string) {
    setSelectedPersonId(assetId);
    setCurrentPersonAssetIds((personAssetIds) => {
      return normalizeCombinationPersonAssetIds({
        currentPersonAssetId: assetId,
        currentPersonAssetIds: personAssetIds,
      });
    });
  }

  function togglePersonAssetSelection(assetId: string) {
    if (selectedPersonId === assetId) {
      const nextDeselectedPersonAssetIds = toggleDeselectedAssetId({
        assetId,
        isSelected: true,
        deselectedAssetIds: deselectedAssetLibraryPersonIds,
      });
      setSelectedPersonId(null);
      setDeselectedAssetLibraryPersonIds(nextDeselectedPersonAssetIds);
      storeCombinationSelectionState(currentCombination?.id, {
        deselectedPersonAssetIds: nextDeselectedPersonAssetIds,
        deselectedGarmentAssetIds: deselectedAssetLibraryGarmentIds,
      });
      return;
    }
    const nextDeselectedPersonAssetIds = toggleDeselectedAssetId({
      assetId,
      isSelected: false,
      deselectedAssetIds: deselectedAssetLibraryPersonIds,
    });
    setDeselectedAssetLibraryPersonIds(nextDeselectedPersonAssetIds);
    setSelectedPersonId(assetId);
    setCurrentPersonAssetIds((personAssetIds) =>
      normalizeCombinationPersonAssetIds({
        currentPersonAssetId: assetId,
        currentPersonAssetIds: personAssetIds,
      }),
    );
    storeCombinationSelectionState(currentCombination?.id, {
      deselectedPersonAssetIds: nextDeselectedPersonAssetIds,
      deselectedGarmentAssetIds: deselectedAssetLibraryGarmentIds,
    });
  }

  function removePersonFromCurrentCombination(assetId: string) {
    const nextSelection = buildPersonAssetSelectionAfterRemove({
      removedAssetId: assetId,
      selectedPersonAssetId: selectedPersonId,
      currentPersonAssetIds,
      deselectedPersonAssetIds: deselectedAssetLibraryPersonIds,
    });
    setCurrentPersonAssetIds(nextSelection.personAssetIds);
    setDeselectedAssetLibraryPersonIds(nextSelection.deselectedPersonAssetIds);
    setSelectedPersonId(nextSelection.selectedPersonAssetId);
    storeCombinationSelectionState(currentCombination?.id, {
      deselectedPersonAssetIds: nextSelection.deselectedPersonAssetIds,
      deselectedGarmentAssetIds: deselectedAssetLibraryGarmentIds,
    });
  }

  function reorderAssetLibraryItems(
    assetType: SortableAssetType,
    activeId: string,
    overId: string,
  ) {
    if (assetType === "person") {
      setCurrentPersonAssetIds((assetIds) =>
        buildCombinationAssetIdsAfterReorder({
          currentAssetIds: assetIds,
          activeId,
          overId,
        }),
      );
    } else {
      setCurrentGarmentAssetIds((assetIds) => {
        const nextAssetIds = buildCombinationAssetIdsAfterReorder({
          currentAssetIds: assetIds,
          activeId,
          overId,
        });
        setSelectedGarmentIds((selectedIds) =>
          buildSelectedAssetIdsAfterCombinationReorder({
            currentAssetIds: nextAssetIds,
            selectedAssetIds: selectedIds,
          }),
        );
        return nextAssetIds;
      });
    }
    const updateAssets = assetType === "person" ? setPeople : setGarments;
    updateAssets((items) => {
      const nextItems = moveAssetById(items, activeId, overId);
      if (nextItems === items) {
        return items;
      }
      saveAssetLibraryOrder(getAssetOrderStorage(), assetType, assetIds(nextItems));
      return nextItems;
    });
  }

  function handleRefreshAll() {
    setActionError(null);
    setActionMessage(null);
    Promise.all([
      refreshAssets(),
      refreshTaskLists(),
      refreshCredentialStatus(),
      refreshSystemSettings(),
    ])
      .then(() => setActionMessage("工作台已刷新"))
      .catch((error) =>
        setActionError(error instanceof Error ? error.message : "刷新工作台失败"),
      );
  }

  function handleToggleCanvasMaximize() {
    if (!isCanvasMaximized) {
      canvasPanelRestoreStateRef.current = {
        assetLibrary: isAssetLibraryCollapsed,
        inspector: isInspectorCollapsed,
      };
      setIsAssetLibraryCollapsed(true);
      setIsInspectorCollapsed(true);
      setIsCanvasMaximized(true);
      return;
    }

    const restoreState = canvasPanelRestoreStateRef.current ?? {
      assetLibrary: false,
      inspector: false,
    };
    setIsAssetLibraryCollapsed(restoreState.assetLibrary);
    setIsInspectorCollapsed(restoreState.inspector);
    setIsCanvasMaximized(false);
    canvasPanelRestoreStateRef.current = null;
  }

  useEffect(() => {
    if (isCanvasMaximized && (!isAssetLibraryCollapsed || !isInspectorCollapsed)) {
      setIsCanvasMaximized(false);
      canvasPanelRestoreStateRef.current = null;
    }
  }, [isAssetLibraryCollapsed, isCanvasMaximized, isInspectorCollapsed]);

  const showWindowChrome = isWindowsPlatform();
  const workbenchBodyClassName = "workbench__body workbench__body--app";

  return (
    <div className={`desktop-frame${showWindowChrome ? "" : " desktop-frame--native-titlebar"}`}>
      {showWindowChrome ? <WindowChrome /> : null}
      <div className="workbench">
        {isSettingsCenterOpen ? (
          <ModelSettingsCenter
            actionError={actionError}
            apiKeyDraft={apiKeyDraft}
            autoSaveResult={autoSaveResult}
            concurrency={concurrency}
            credentialStatus={credentialStatus}
            customBaseUrl={customBaseUrl}
            customModelId={customModelId}
            imageFormat={imageFormat}
            isCustomEndpointEnabled={isCustomEndpointEnabled}
            isSaving={isSavingModelSettings}
            isTesting={isTestingProviderConnection}
            isTestingProxy={isTestingProxy}
            initialPage={settingsCenterInitialPage}
            modelDefinitions={modelDefinitions}
            modelSize={modelSize}
            outputCount={outputCount}
            seed={seed}
            selectedModelId={selectedModelId}
            selectedProvider={selectedProvider}
            systemSettingsView={systemSettingsView}
            cacheStats={cacheStats}
            timeoutSeconds={timeoutSeconds}
            isClearingCache={isClearingCache}
            isSavingSystemSettings={isSavingSystemSettings}
            isSystemSettingsLoading={isSystemSettingsLoading}
            onApiKeyDraftChange={setApiKeyDraft}
            onAutoSaveResultChange={setAutoSaveResult}
            onBack={() => setIsSettingsCenterOpen(false)}
            onClearCache={() => {
              void handleClearCache();
            }}
            onConcurrencyChange={setConcurrency}
            onCustomBaseUrlChange={setCustomBaseUrl}
            onCustomModelIdChange={setCustomModelId}
            onImageFormatChange={setImageFormat}
            onCustomEndpointEnabledChange={setIsCustomEndpointEnabled}
            onModelSizeChange={setModelSize}
            onOutputCountChange={setOutputCount}
            onPromptTemplatesChange={setWorkbenchPromptTemplates}
            onProviderChange={handleSelectProvider}
            onNotifyError={(message) => {
              setActionMessage(null);
              setActionError(message);
            }}
            onNotifyMessage={(message) => {
              setActionError(null);
              setActionMessage(message);
            }}
            onReset={handleResetModelSettings}
            onSave={() => {
              void handleSaveModelSettings();
            }}
            onRefreshSystemSettings={() => {
              void refreshSystemSettings();
            }}
            onSaveSystemSettings={(settings) => {
              void handleSaveSystemSettings(settings);
            }}
            onSeedChange={setSeed}
            onSelectedModelIdChange={setSelectedModelId}
            onTest={() => {
              void handleTestProviderConnection();
            }}
            onTestProxy={(settings) => {
              openProxyTestDialog(settings);
            }}
            onTimeoutSecondsChange={setTimeoutSeconds}
          />
        ) : isTaskHistoryOpen ? (
          <section className="settings-center task-history-center">
            <header className="settings-center__header">
              <Button
                className="settings-back-button"
                onClick={() => setIsTaskHistoryOpen(false)}
                type="button"
                variant="default"
              >
                <ChevronLeft size={16} />
                返回工作台
              </Button>
              <div className="task-history-title">
                <h1>任务历史</h1>
                <p>追踪生成任务、执行日志与结果文件</p>
              </div>
            </header>
            <div className="settings-center__body">
              <TaskHistorySettingsPage
                currentCombinationId={currentCombination?.id ?? null}
                modelConfig={modelConfig}
                modelDefinitions={modelDefinitions}
                workspaceRoot={systemSettingsView.currentWorkspaceRoot}
                onNotifyError={(message) => {
                  setActionMessage(null);
                  setActionError(message);
                }}
                onNotifyMessage={(message) => {
                  setActionError(null);
                  setActionMessage(message);
                }}
              />
            </div>
          </section>
        ) : isPromptPresetCenterOpen ? (
          <PromptPresetCenterPage
            draft={promptPresetCenterDraft}
            error={promptPresetCenterError}
            isSaving={isSavingPromptPreset}
            presets={promptPresetOptions}
            promptPresetScenarios={workbenchPromptPresetScenarios}
            selectedPresetId={selectedPromptPresetCenterId}
            templates={workbenchPromptTemplates}
            onBack={() => setIsPromptPresetCenterOpen(false)}
            onDraftChange={setPromptPresetCenterDraft}
            onManageScenarios={() => setIsPromptPresetScenarioModalOpen(true)}
            onNew={openPromptPresetModal}
            onApply={() => applyPromptPresetToWorkbench()}
            onReset={() => {
              const preset = findPromptPresetOption(promptPresetOptions, selectedPromptPresetCenterId);
              if (preset) {
                setPromptPresetCenterDraft(buildPromptPresetDraftFromOption(preset));
                setPromptPresetCenterError(null);
              }
            }}
            onSave={() => {
              void handleSavePromptPresetCenterDraft();
            }}
            onSelectPreset={handleSelectPromptPresetForCenter}
            onCopyPreviewError={(message) => {
              setActionMessage(null);
              setActionError(message);
            }}
            onCopyPreviewSuccess={() => {
              setActionError(null);
              setActionMessage("已复制最终输出");
            }}
          />
        ) : (
          <>
            <TopToolbar
              combinationName={combinationName}
              combinationSummaries={combinationSummaries}
              currentCombinationId={currentCombination?.id ?? ""}
              canRun={canRun}
              isSaving={isSaving}
              isStarting={isStarting}
              onHistory={openTaskHistory}
              onPromptPresetCenter={openPromptPresetCenter}
              onModelSettings={() => openSettingsCenter("model")}
              onNew={openNewCombinationModal}
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
            <div className={`${workbenchBodyClassName} workbench-floating-stage`}>
              <div
                className={`floating-panel-slot floating-panel-slot--left${isAssetLibraryCollapsed ? " is-collapsed" : ""}`}
              >
                <AssetLibrary
                  people={currentCombinationAssetView.people}
                  garments={currentCombinationAssetView.garments}
                  results={currentCombinationAssetView.results}
                  currentPersonAssetIds={currentPersonAssetIds}
                  currentGarmentAssetIds={currentGarmentAssetIds}
                  deselectedPersonAssetIds={deselectedAssetLibraryPersonIds}
                  selectedPersonId={selectedPersonId}
                  selectedGarmentIds={selectedGarmentIds}
                  importingType={importingType}
                  onCollapse={() => setIsAssetLibraryCollapsed(true)}
                  onImport={(assetType) => {
                    void handleImport(assetType);
                  }}
                  onRemoveGarment={removeGarmentFromCurrentCombination}
                  onRemovePerson={removePersonFromCurrentCombination}
                  onRefresh={handleRefreshAll}
                  onSelectPerson={togglePersonAssetSelection}
                  onToggleGarment={toggleGarmentAssetSelection}
                  onReorder={reorderAssetLibraryItems}
                />
                <PanelRestoreButton
                  label="展开资源库"
                  side="left"
                  onClick={() => setIsAssetLibraryCollapsed(false)}
                />
              </div>
              <main className="canvas-column">
                <FlowWorkbench
                  canRun={canRun}
                  canvasTool={canvasTool}
                  credentialStatus={credentialStatus}
                  currentCombination={currentCombination}
                  isCanvasMaximized={isCanvasMaximized}
                  latestTask={latestTask}
                  modelId={effectiveModelId}
                  modelSize={modelSize}
                  outputCount={outputCount}
                  promptSummaryText={promptSummaryText}
                  results={resultAssets}
                  selectedFlowNode={selectedFlowNode}
                  selectedGarments={selectedGarments}
                  selectedPerson={selectedPerson}
                  validationResult={validationResult}
                  resetRevision={canvasResetRevision}
                  zoom={zoom}
                  onCanvasToolChange={setCanvasTool}
                  onCanvasMaximizeToggle={handleToggleCanvasMaximize}
                  onNodeSelect={(nodeId) => {
                    setSelectedFlowNode(nodeId);
                    setSidePanelMode("details");
                  }}
                  onRun={() => {
                    void handleStartGeneration();
                  }}
                  onZoomChange={setZoom}
                />
              </main>
              <div
                className={`floating-panel-slot floating-panel-slot--right${isInspectorCollapsed ? " is-collapsed" : ""}`}
              >
                <InspectorPanel
                  apiKeyDraft={apiKeyDraft}
                  credentialStatus={credentialStatus}
                  currentCombination={currentCombination}
                  latestTask={latestTask}
                  mode={sidePanelMode}
                  modelId={effectiveModelId}
                  modelProvider={selectedProvider}
                  modelSize={modelSize}
                  outputCount={outputCount}
                  promptPresetOptions={promptPresetOptions}
                  promptSummaryText={promptSummaryText}
                  promptTemplates={workbenchPromptTemplates}
                  promptWorkbench={promptWorkbench}
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
                  onPromptWorkbenchChange={(nextPromptWorkbench) => {
                    applyPromptWorkbenchState(nextPromptWorkbench);
                  }}
                  onOpenResultError={(message) => setActionError(message)}
                  onSaveApiKey={() => {
                    void handleSaveApiKey();
                  }}
                />
                <PanelRestoreButton
                  label="展开属性面板"
                  side="right"
                  onClick={() => setIsInspectorCollapsed(false)}
                />
              </div>
            </div>
          </>
        )}
      </div>
      <WorkbenchToasts
        loadingError={loadingError}
        actionError={actionError}
        actionMessage={actionMessage}
      />
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
      {isPromptPresetModalOpen ? (
        <PromptPresetModal
          copyPresetId={newPromptPresetCopyId}
          draft={newPromptPresetDraft}
          error={newPromptPresetError}
          isSaving={isSavingPromptPreset}
          presets={promptPresetOptions}
          promptPresetScenarios={workbenchPromptPresetScenarios}
          shouldApplyAfterCreate={shouldApplyNewPromptPreset}
          sourceMode={newPromptPresetSourceMode}
          templates={workbenchPromptTemplates}
          onApplyAfterCreateChange={setShouldApplyNewPromptPreset}
          onCancel={() => {
            setIsPromptPresetModalOpen(false);
            setNewPromptPresetError(null);
          }}
          onCopyPresetIdChange={(presetId) => {
            setNewPromptPresetCopyId(presetId);
            setNewPromptPresetDraft(
              buildEmptyPromptPresetDraft(findPromptPresetOption(promptPresetOptions, presetId)),
            );
          }}
          onCreate={() => {
            void handleCreatePromptPreset();
          }}
          onDraftChange={setNewPromptPresetDraft}
          onSourceModeChange={(mode) => {
            setNewPromptPresetSourceMode(mode);
            const preset =
              mode === "copy"
                ? findPromptPresetOption(promptPresetOptions, newPromptPresetCopyId)
                : selectedPromptPreset;
            setNewPromptPresetDraft(buildEmptyPromptPresetDraft(preset));
          }}
        />
      ) : null}
      {isPromptPresetScenarioModalOpen ? (
        <PromptPresetScenarioModal
          isSaving={isSavingPromptPresetScenario}
          promptPresetScenarios={workbenchPromptPresetScenarios}
          onCancel={() => setIsPromptPresetScenarioModalOpen(false)}
          onSave={(request) => handleSavePromptPresetScenario(request)}
        />
      ) : null}
      {proxyTestSettings ? (
        <ProxyTestDomainDialog
          domain={proxyTestDomainDraft}
          isTesting={isTestingProxy}
          onCancel={() => {
            if (!isTestingProxy) {
              setProxyTestSettings(null);
            }
          }}
          onChange={setProxyTestDomainDraft}
          onConfirm={() => {
            void handleTestProxy(proxyTestSettings, proxyTestDomainDraft);
          }}
        />
      ) : null}
      <StatusBar
        workspaceRoot={systemSettingsView.currentWorkspaceRoot}
        onOpenWorkspace={() => {
          void handleOpenWorkspaceDirectory();
        }}
      />
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

function normalizeSelectedImagePaths(selected: string | string[] | null): string[] {
  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}

async function getDefaultImageDialogPath() {
  try {
    return await pictureDir();
  } catch {
    return undefined;
  }
}

async function openImagePicker(
  assetType: Extract<AssetType, "person" | "garment">,
  options: { multiple?: boolean } = {},
) {
  const defaultPath = await getDefaultImageDialogPath();
  return open({
    defaultPath,
    multiple: options.multiple ?? true,
    title: getImageDialogTitle(assetType),
    filters: [
      {
        name: "图片文件",
        extensions: ["png", "jpg", "jpeg"],
      },
    ],
  });
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

function upsertAsset(items: AssetFileView[], asset: AssetFileView) {
  return [asset, ...items.filter((item) => item.asset.id !== asset.asset.id)];
}

function upsertAssets(items: AssetFileView[], assets: AssetFileView[]) {
  return assets.reduceRight((nextItems, asset) => upsertAsset(nextItems, asset), items);
}

function getAssetOrderStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readStoredModelConfigId() {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(MODEL_CONFIG_STORAGE_KEY);
  return value?.trim() || null;
}

function storeModelConfigId(id: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MODEL_CONFIG_STORAGE_KEY, id);
  }
}

function normalizeStoredAssetIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function emptyStoredCombinationSelectionState(): StoredCombinationSelectionState {
  return {
    deselectedPersonAssetIds: [],
    deselectedGarmentAssetIds: [],
  };
}

function readStoredCombinationSelectionStates(): Record<string, StoredCombinationSelectionState> {
  if (typeof window === "undefined") {
    return {};
  }
  const rawValue = window.localStorage.getItem(COMBINATION_SELECTION_STATE_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([combinationId, value]) => {
        const state = value && typeof value === "object" ? value : {};
        return [
          combinationId,
          {
            deselectedPersonAssetIds: normalizeStoredAssetIds(
              (state as Partial<StoredCombinationSelectionState>).deselectedPersonAssetIds,
            ),
            deselectedGarmentAssetIds: normalizeStoredAssetIds(
              (state as Partial<StoredCombinationSelectionState>).deselectedGarmentAssetIds,
            ),
          },
        ];
      }),
    );
  } catch {
    return {};
  }
}

function readStoredCombinationSelectionState(combinationId?: string | null) {
  if (!combinationId) {
    return emptyStoredCombinationSelectionState();
  }
  return (
    readStoredCombinationSelectionStates()[combinationId] ??
    emptyStoredCombinationSelectionState()
  );
}

function storeCombinationSelectionState(
  combinationId: string | null | undefined,
  state: StoredCombinationSelectionState,
) {
  if (typeof window === "undefined" || !combinationId) {
    return;
  }
  const states = readStoredCombinationSelectionStates();
  const hasDeselectedAssets =
    state.deselectedPersonAssetIds.length > 0 || state.deselectedGarmentAssetIds.length > 0;
  if (hasDeselectedAssets) {
    states[combinationId] = state;
  } else {
    delete states[combinationId];
  }
  window.localStorage.setItem(COMBINATION_SELECTION_STATE_STORAGE_KEY, JSON.stringify(states));
}

function normalizeModelSize(value: unknown): (typeof MODEL_SIZES)[number] {
  return MODEL_SIZES.includes(value as (typeof MODEL_SIZES)[number])
    ? (value as (typeof MODEL_SIZES)[number])
    : "auto";
}

function formatModelSizeLabel(size: (typeof MODEL_SIZES)[number]) {
  return MODEL_SIZE_LABELS[size];
}

function normalizeIntegerParam(value: unknown, min: number, max: number, fallback: number) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numericValue)));
}

function normalizeStringParam(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function applySavedAssetOrder(assetType: SortableAssetType, items: AssetFileView[]) {
  return applyStoredAssetOrder(items, readAssetLibraryOrder(getAssetOrderStorage(), assetType));
}

function saveOrderedAssets(assetType: SortableAssetType, items: AssetFileView[]) {
  saveAssetLibraryOrder(getAssetOrderStorage(), assetType, assetIds(items));
  return items;
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
  return buildAssetImageSources(asset, convertFileSrc).thumbSrc;
}

function assetCanvasSources(asset: AssetFileView) {
  return buildAssetImageSources(asset, convertFileSrc);
}

function AssetCanvasImage({
  alt,
  asset,
  className,
}: {
  alt: string;
  asset: AssetFileView;
  className?: string;
}) {
  const sources = useMemo(
    () => assetCanvasSources(asset),
    [asset.filePath, asset.thumbDataUrl, asset.thumbFilePath],
  );
  const [src, setSrc] = useState(sources.canvasPrimarySrc);

  useEffect(() => {
    setSrc(sources.canvasPrimarySrc);
  }, [sources.canvasPrimarySrc]);

  return (
    <img
      alt={alt}
      className={className}
      src={src}
      onError={() => {
        if (sources.canvasFallbackSrc && src !== sources.canvasFallbackSrc) {
          setSrc(sources.canvasFallbackSrc);
        }
      }}
    />
  );
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
  onPromptPresetCenter,
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
  onPromptPresetCenter: () => void;
  onSelectCombination: (combinationId: string) => void;
  onSave: () => void;
  onRun: () => void;
}) {
  return (
    <nav className="top-toolbar" aria-label="工作台工具栏">
      <label className="combo-select">
        <span>当前组合：</span>
        <Select
          disabled={combinationSummaries.length === 0}
          value={currentCombinationId}
          onValueChange={onSelectCombination}
        >
          <SelectTrigger aria-label="切换组合" className="combo-select__trigger">
            <SelectValue placeholder={combinationName} />
          </SelectTrigger>
          <SelectContent>
            {combinationSummaries.map((combination) => (
              <SelectItem key={combination.id} value={combination.id}>
                {combination.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="toolbar-actions">
        <Button className="primary-action" onClick={onNew} type="button">
          <Plus size={18} />
          新建组合
        </Button>
        <ToolbarButton
          icon={<Save size={16} />}
          label={isSaving ? "保存中" : "保存"}
          onClick={onSave}
          disabled={isSaving}
        />
        <ToolbarButton icon={<FolderOpen size={16} />} label="打开历史" onClick={onHistory} />
      </div>
      <div className="toolbar-spacer" />
      <Button
        className="toolbar-button toolbar-button--compact"
        onClick={onPromptPresetCenter}
        type="button"
      >
        <SlidersHorizontal size={16} />
        方案中心
      </Button>
      <Button className="run-button" disabled={!canRun} onClick={onRun} type="button">
        <Play size={17} fill="currentColor" />
        {isStarting ? "提交中" : "执行生成"}
      </Button>
      <Button
        className="settings-entry-button"
        onClick={onModelSettings}
        title="设置"
        type="button"
        aria-label="设置"
      >
        <Settings size={18} />
      </Button>
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
    <Button className="toolbar-button" disabled={disabled} onClick={onClick} variant="default">
      {icon}
      {label}
    </Button>
  );
}

function ModelSettingsCenter({
  actionError,
  apiKeyDraft,
  autoSaveResult,
  concurrency,
  credentialStatus,
  customBaseUrl,
  customModelId,
  imageFormat,
  isCustomEndpointEnabled,
  isSaving,
  isTesting,
  isTestingProxy,
  initialPage,
  modelDefinitions,
  modelSize,
  outputCount,
  seed,
  selectedModelId,
  selectedProvider,
  systemSettingsView,
  cacheStats,
  timeoutSeconds,
  isClearingCache,
  isSavingSystemSettings,
  isSystemSettingsLoading,
  onApiKeyDraftChange,
  onAutoSaveResultChange,
  onBack,
  onClearCache,
  onConcurrencyChange,
  onCustomBaseUrlChange,
  onCustomEndpointEnabledChange,
  onCustomModelIdChange,
  onImageFormatChange,
  onModelSizeChange,
  onNotifyError,
  onNotifyMessage,
  onOutputCountChange,
  onPromptTemplatesChange,
  onProviderChange,
  onRefreshSystemSettings,
  onReset,
  onSave,
  onSaveSystemSettings,
  onSeedChange,
  onSelectedModelIdChange,
  onTest,
  onTestProxy,
  onTimeoutSecondsChange,
}: {
  actionError: string | null;
  apiKeyDraft: string;
  autoSaveResult: boolean;
  concurrency: number;
  credentialStatus: ProviderCredentialStatus | null;
  customBaseUrl: string;
  customModelId: string;
  imageFormat: string;
  isCustomEndpointEnabled: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isTestingProxy: boolean;
  initialPage: SettingsPage;
  modelDefinitions: ModelDefinition[];
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  seed: number;
  selectedModelId: string;
  selectedProvider: ProviderId;
  systemSettingsView: SystemSettingsView;
  cacheStats: CacheStats;
  timeoutSeconds: number;
  isClearingCache: boolean;
  isSavingSystemSettings: boolean;
  isSystemSettingsLoading: boolean;
  onApiKeyDraftChange: (value: string) => void;
  onAutoSaveResultChange: (value: boolean) => void;
  onBack: () => void;
  onClearCache: () => void;
  onConcurrencyChange: (value: number) => void;
  onCustomBaseUrlChange: (value: string) => void;
  onCustomEndpointEnabledChange: (value: boolean) => void;
  onCustomModelIdChange: (value: string) => void;
  onImageFormatChange: (value: string) => void;
  onModelSizeChange: (value: (typeof MODEL_SIZES)[number]) => void;
  onNotifyError: (message: string) => void;
  onNotifyMessage: (message: string) => void;
  onOutputCountChange: (value: number) => void;
  onPromptTemplatesChange: (templates: PromptTemplate[]) => void;
  onProviderChange: (provider: ProviderId) => void;
  onRefreshSystemSettings: () => void;
  onReset: () => void;
  onSave: () => void;
  onSaveSystemSettings: (settings: SystemSettings) => void;
  onSeedChange: (value: number) => void;
  onSelectedModelIdChange: (value: string) => void;
  onTest: () => void;
  onTestProxy: (settings: SystemSettings) => void;
  onTimeoutSecondsChange: (value: number) => void;
}) {
  const selectedProviderOption =
    PROVIDER_OPTIONS.find((provider) => provider.id === selectedProvider) ?? PROVIDER_OPTIONS[0];
  const providerDefinitions = modelDefinitions.filter(
    (definition) => definition.provider === selectedProvider,
  );
  const modelRows =
    selectedProvider === CUSTOM_PROVIDER
      ? [buildCustomModelDefinition(customModelId, customBaseUrl)]
      : providerDefinitions.length
        ? providerDefinitions
        : [buildFallbackModelDefinition(selectedProvider)];
  const selectedDefinition =
    modelRows.find((definition) =>
      selectedProvider === CUSTOM_PROVIDER
        ? definition.modelId === (customModelId.trim() || DEFAULT_CUSTOM_MODEL_ID)
        : definition.modelId === selectedModelId,
    ) ?? modelRows[0];
  const effectiveModelId =
    selectedProvider === CUSTOM_PROVIDER
      ? customModelId.trim() || DEFAULT_CUSTOM_MODEL_ID
      : selectedModelId;
  const endpointCustomizationSupported = selectedProvider === DEFAULT_PROVIDER || selectedProvider === CUSTOM_PROVIDER;
  const endpointInputEnabled = selectedProvider === CUSTOM_PROVIDER || isCustomEndpointEnabled;
  const endpointLabel =
    endpointInputEnabled
      ? customBaseUrl.trim() || "待填写自定义接入点"
      : selectedDefinition.providerBaseUrl ?? getDefaultProviderBaseUrl(selectedProvider);
  const outputMin = selectedDefinition.output.minCount;
  const outputMax = selectedDefinition.output.maxCount;
  const configured = credentialStatus?.configured === true;
  const lastTestSuccess = !actionError && credentialStatus?.configured === true;
  const [activeSettingsPage, setActiveSettingsPage] = useState<SettingsPage>(initialPage);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [promptTemplateType, setPromptTemplateType] = useState<PromptTemplateType>("system");
  const [promptSearch, setPromptSearch] = useState("");
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<string | null>(null);
  const [revealedApiKey, setRevealedApiKey] = useState<string | null>(null);
  const [isRevealingApiKey, setIsRevealingApiKey] = useState(false);
  const [promptDraft, setPromptDraft] = useState<PromptTemplateDraft>(() =>
    buildEmptyPromptTemplateDraft("system"),
  );
  const [newPromptDraft, setNewPromptDraft] = useState<PromptTemplateDraft>(() =>
    buildEmptyPromptTemplateDraft("system"),
  );
  const [systemSettingsDraft, setSystemSettingsDraft] = useState<SystemSettings>(
    systemSettingsView.settings,
  );
  const [isNewPromptModalOpen, setIsNewPromptModalOpen] = useState(false);
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptTemplateError, setPromptTemplateError] = useState<string | null>(null);
  const selectedPromptTemplate =
    promptTemplates.find((template) => template.id === selectedPromptTemplateId) ?? null;
  const isPromptTemplateReadOnly =
    selectedPromptTemplate?.source === "built_in" || selectedPromptTemplate?.locked === true;
  const filteredPromptTemplates = useMemo(
    () =>
      promptTemplates.filter((template) => {
        const matchesType = template.templateType === promptTemplateType;
        const query = promptSearch.trim().toLowerCase();
        const matchesSearch =
          !query ||
          getPromptTemplateDisplayName(template).toLowerCase().includes(query) ||
          template.description.toLowerCase().includes(query);
        return matchesType && matchesSearch;
      }),
    [promptSearch, promptTemplateType, promptTemplates],
  );

  useEffect(() => {
    setActiveSettingsPage(initialPage);
  }, [initialPage]);
  const promptPreview = useMemo(
    () =>
      renderPromptTemplatePreview(
        promptDraft.body,
        buildPreviewValues(syncPromptTemplateDraftVariables(promptDraft).variables),
      ),
    [promptDraft],
  );
  const promptValidation = useMemo(
    () => validatePromptTemplateDraft(syncPromptTemplateDraftVariables(promptDraft)),
    [promptDraft],
  );
  const isPromptTemplateDirty = useMemo(() => {
    if (!selectedPromptTemplate) {
      return false;
    }
    return !arePromptTemplateDraftsEqual(
      promptDraft,
      buildPromptTemplateDraft(selectedPromptTemplate),
    );
  }, [promptDraft, selectedPromptTemplate]);
  const canSavePromptTemplate =
    !isPromptLoading &&
    !isPromptTemplateReadOnly &&
    Boolean(selectedPromptTemplate) &&
    isPromptTemplateDirty;
  const apiKeyVisible = revealedApiKey !== null;
  const apiKeyInputValue = apiKeyDraft || revealedApiKey || "";
  const apiKeyRevealDisabled =
    isRevealingApiKey || (!apiKeyDraft.trim() && credentialStatus?.configured !== true);

  useEffect(() => {
    setSystemSettingsDraft(systemSettingsView.settings);
  }, [systemSettingsView.settings]);

  useEffect(() => {
    setRevealedApiKey(null);
  }, [credentialStatus?.maskedKey, selectedProvider]);

  useEffect(() => {
    if (activeSettingsPage !== "prompt" || promptTemplates.length > 0) {
      return;
    }
    void loadPromptTemplates();
  }, [activeSettingsPage, promptTemplates.length]);

  function applyPromptTemplates(nextTemplates: PromptTemplate[], preferredId?: string | null) {
    const normalizedTemplates = (nextTemplates.length ? nextTemplates : buildFallbackPromptTemplates()).map(
      syncPromptTemplateVariablesForTemplate,
    );
    setPromptTemplates(normalizedTemplates);
    onPromptTemplatesChange(normalizedTemplates);
    const preferred = preferredId
      ? normalizedTemplates.find((template) => template.id === preferredId)
      : null;
    const nextSelected =
      preferred ??
      normalizedTemplates.find((template) => template.templateType === promptTemplateType) ??
      normalizedTemplates[0];
    if (nextSelected) {
      selectPromptTemplate(nextSelected, false);
    }
  }

  async function loadPromptTemplates() {
    setIsPromptLoading(true);
    setPromptTemplateError(null);
    try {
      const templates = isTauriRuntime()
        ? await listPromptTemplates()
        : buildFallbackPromptTemplates();
      applyPromptTemplates(templates, selectedPromptTemplateId);
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "加载 Prompt 模板失败");
      applyPromptTemplates(buildFallbackPromptTemplates(), selectedPromptTemplateId);
    } finally {
      setIsPromptLoading(false);
    }
  }

  function selectPromptTemplate(template: PromptTemplate, syncType = true) {
    setSelectedPromptTemplateId(template.id);
    setPromptTemplateError(null);
    if (syncType) {
      setPromptTemplateType(template.templateType);
    }
    const draft = buildPromptTemplateDraft(template);
    setPromptDraft(draft);
  }

  function changePromptTemplateType(type: PromptTemplateType) {
    setPromptTemplateType(type);
    const nextSelected = promptTemplates.find((template) => template.templateType === type);
    if (nextSelected) {
      selectPromptTemplate(nextSelected, false);
    } else {
      setPromptDraft(buildEmptyPromptTemplateDraft(type));
      setSelectedPromptTemplateId(null);
    }
  }

  async function handleSavePromptTemplate() {
    if (!canSavePromptTemplate) {
      return;
    }
    if (selectedPromptTemplate?.source === "built_in" || selectedPromptTemplate?.locked) {
      setPromptTemplateError("内置或锁定模板不能编辑，请新建自定义模板");
      return;
    }
    const nextDraft = syncPromptTemplateDraftVariables(promptDraft);
    const error = validatePromptTemplateDraft(nextDraft);
    if (error) {
      setPromptTemplateError(error);
      return;
    }
    setIsPromptLoading(true);
    setPromptTemplateError(null);
    try {
      const saved = isTauriRuntime()
        ? await savePromptTemplate(nextDraft)
        : buildLocalPromptTemplate(nextDraft);
      const nextTemplates = upsertPromptTemplate(promptTemplates, saved);
      setPromptTemplates(nextTemplates);
      onPromptTemplatesChange(nextTemplates);
      selectPromptTemplate(saved);
      onNotifyMessage("Prompt 模板已保存");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "保存 Prompt 模板失败");
    } finally {
      setIsPromptLoading(false);
    }
  }

  async function handleCreatePromptTemplate() {
    const nextDraft = syncPromptTemplateDraftVariables(newPromptDraft);
    const error = validatePromptTemplateCreateDraft(nextDraft);
    if (error) {
      setPromptTemplateError(error);
      return;
    }
    setIsPromptLoading(true);
    setPromptTemplateError(null);
    try {
      const saved = isTauriRuntime()
        ? await savePromptTemplate({ ...nextDraft, id: null })
        : buildLocalPromptTemplate({ ...nextDraft, id: null });
      const nextTemplates = upsertPromptTemplate(promptTemplates, saved);
      setPromptTemplates(nextTemplates);
      onPromptTemplatesChange(nextTemplates);
      setIsNewPromptModalOpen(false);
      selectPromptTemplate(saved);
      onNotifyMessage("Prompt 模板已新建");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "新建 Prompt 模板失败");
    } finally {
      setIsPromptLoading(false);
    }
  }

  async function handleRestorePromptTemplates() {
    setIsPromptLoading(true);
    setPromptTemplateError(null);
    try {
      const templates = isTauriRuntime()
        ? await restoreDefaultPromptTemplates()
        : buildFallbackPromptTemplates();
      applyPromptTemplates(templates, selectedPromptTemplateId);
      onNotifyMessage("默认 Prompt 模板已恢复");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "恢复默认模板失败");
    } finally {
      setIsPromptLoading(false);
    }
  }

  async function handleDeletePromptTemplate(template: PromptTemplate) {
    if (template.source === "built_in" || template.locked) {
      setPromptTemplateError("内置或锁定模板不能删除");
      return;
    }
    setIsPromptLoading(true);
    setPromptTemplateError(null);
    try {
      if (isTauriRuntime()) {
        await deletePromptTemplate(template.id);
      }
      const nextTemplates = promptTemplates.filter((item) => item.id !== template.id);
      applyPromptTemplates(nextTemplates, null);
      onNotifyMessage("Prompt 模板已删除");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "删除 Prompt 模板失败");
    } finally {
      setIsPromptLoading(false);
    }
  }

  function openNewPromptTemplateModal() {
    setPromptTemplateError(null);
    setNewPromptDraft(buildEmptyPromptTemplateDraft(promptTemplateType));
    setIsNewPromptModalOpen(true);
  }

  function selectModel(modelId: string) {
    const nextDefinition =
      modelRows.find((definition) => definition.modelId === modelId) ?? selectedDefinition;
    onSelectedModelIdChange(modelId);
    onOutputCountChange(
      normalizeIntegerParam(
        outputCount,
        nextDefinition.output.minCount,
        nextDefinition.output.maxCount,
        nextDefinition.output.minCount,
      ),
    );
  }

  function handleApiKeyInputChange(value: string) {
    if (apiKeyVisible) {
      setRevealedApiKey(null);
    }
    onApiKeyDraftChange(value);
  }

  async function handleToggleApiKeyReveal() {
    if (apiKeyVisible) {
      setRevealedApiKey(null);
      return;
    }

    if (apiKeyDraft.trim()) {
      setRevealedApiKey(apiKeyDraft);
      return;
    }

    if (credentialStatus?.configured !== true) {
      onNotifyError(`请先保存 ${selectedProviderOption.label} API Key`);
      return;
    }

    setIsRevealingApiKey(true);
    try {
      const apiKey = isTauriRuntime() ? await getProviderApiKey(selectedProvider) : "";
      setRevealedApiKey(apiKey);
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "读取 API Key 失败");
    } finally {
      setIsRevealingApiKey(false);
    }
  }

  return (
    <section className="settings-center">
      <header className="settings-center__header">
        <Button className="settings-back-button" onClick={onBack} type="button" variant="default">
          <ChevronLeft size={16} />
          返回工作台
        </Button>
        <div className="settings-header-actions">
          {activeSettingsPage === "system" ? null : activeSettingsPage === "prompt" ? (
            <>
              <Button
                className="settings-header-action settings-header-action--create"
                onClick={openNewPromptTemplateModal}
                type="button"
              >
                <Plus size={16} />
                新建模板
              </Button>
              <Button
                className={`settings-header-action settings-header-action--save${
                  isPromptTemplateDirty ? " is-dirty" : ""
                }`}
                disabled={!canSavePromptTemplate}
                onClick={() => void handleSavePromptTemplate()}
                title={canSavePromptTemplate ? "保存当前模板修改" : "当前模板无可保存修改"}
                type="button"
              >
                <Save size={16} />
                {isPromptLoading ? "保存中" : "保存模板"}
              </Button>
              <Button
                className="settings-header-action settings-header-action--restore"
                disabled={isPromptLoading}
                onClick={() => void handleRestorePromptTemplates()}
                type="button"
              >
                <RotateCcw size={16} />
                恢复默认
              </Button>
            </>
          ) : (
            <>
              <Button disabled={isSaving} onClick={onSave} type="button">
                <Save size={16} />
                {isSaving ? "保存中" : "保存设置"}
              </Button>
              <Button disabled={isTesting} onClick={onTest} type="button">
                <Wrench size={16} />
                {isTesting ? "检查中" : "测试连接"}
              </Button>
              <Button onClick={onReset} type="button">
                <RotateCcw size={16} />
                恢复默认
              </Button>
            </>
          )}
        </div>
      </header>
      <div className="settings-center__body">
        <aside className="settings-sidebar">
          <h2>设置中心</h2>
          <Button
            className={activeSettingsPage === "model" ? "is-active" : ""}
            onClick={() => setActiveSettingsPage("model")}
            type="button"
          >
            <KeyRound size={16} />
            模型与 API Key
          </Button>
          <Button
            className={activeSettingsPage === "prompt" ? "is-active" : ""}
            onClick={() => setActiveSettingsPage("prompt")}
            type="button"
          >
            <FileText size={16} />
            Prompt 模板配置
          </Button>
          <Button
            className={activeSettingsPage === "system" ? "is-active" : ""}
            onClick={() => setActiveSettingsPage("system")}
            type="button"
          >
            <Settings size={16} />
            系统设置
          </Button>
        </aside>
        {activeSettingsPage === "system" ? (
          <SystemSettingsPage
            cacheStats={cacheStats}
            currentWorkspaceRoot={systemSettingsView.currentWorkspaceRoot}
            draft={systemSettingsDraft}
            isClearingCache={isClearingCache}
            isLoading={isSystemSettingsLoading}
            isSaving={isSavingSystemSettings}
            isTestingProxy={isTestingProxy}
            systemProxyDetected={systemSettingsView.systemProxyDetected}
            workspaceChangeRequiresRestart={systemSettingsView.workspaceChangeRequiresRestart}
            onChange={setSystemSettingsDraft}
            onClearCache={onClearCache}
            onRefresh={onRefreshSystemSettings}
            onSave={() => onSaveSystemSettings(systemSettingsDraft)}
            onTestProxy={() => onTestProxy(systemSettingsDraft)}
          />
        ) : activeSettingsPage === "prompt" ? (
          <PromptTemplateSettingsPage
            draft={promptDraft}
            error={promptTemplateError}
            filteredTemplates={filteredPromptTemplates}
            isLoading={isPromptLoading}
            isReadOnly={isPromptTemplateReadOnly}
            preview={promptPreview}
            search={promptSearch}
            selectedTemplate={selectedPromptTemplate}
            selectedType={promptTemplateType}
            validation={promptValidation}
            onChangeDraft={setPromptDraft}
            onChangeSearch={setPromptSearch}
            onChangeType={changePromptTemplateType}
            onDeleteTemplate={(template) => void handleDeletePromptTemplate(template)}
            onSelectTemplate={selectPromptTemplate}
          />
        ) : (
          <>
            <main className="settings-main">
          <div className="settings-top-grid">
            <section className="settings-card provider-card">
              <h3>A. Provider 列表</h3>
              <div className="provider-list">
                {DEFAULT_VISIBLE_PROVIDER_OPTIONS.map((provider) => (
                  <Button
                    className={provider.id === selectedProvider ? "is-active" : ""}
                    disabled={!provider.enabled}
                    key={provider.id}
                    title={provider.enabled ? provider.label : "后端暂未接入该 Provider"}
                    onClick={() => onProviderChange(provider.id)}
                    type="button"
                  >
                    <span>{provider.icon}</span>
                    {provider.label}
                    {provider.id === selectedProvider ? <CircleCheck size={16} /> : null}
                  </Button>
                ))}
              </div>
            </section>
            <section className="settings-card api-status-card">
              <div className="settings-card__title-row">
                <h3>B. API Key 状态</h3>
                <span className="local-secret-note">
                  <ShieldCheck size={15} />
                  密钥仅存储在本地设备
                </span>
              </div>
              <div className="api-status-line">
                <span className={`settings-status-badge ${configured ? "is-enabled" : ""}`}>
                  {configured ? "已启用" : "未启用"}
                </span>
                <strong>{selectedProviderOption.label} API Key {configured ? "已生效" : "待配置"}</strong>
              </div>
              <div className="settings-api-input">
                <Input
                  value={apiKeyInputValue}
                  onChange={(event) => handleApiKeyInputChange(event.target.value)}
                  placeholder={credentialStatus?.maskedKey ?? `输入 ${selectedProviderOption.label} API Key`}
                  type="text"
                />
                <Button
                  aria-label={apiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                  disabled={apiKeyRevealDisabled}
                  onClick={() => void handleToggleApiKeyReveal()}
                  title={apiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
                  type="button"
                >
                  {apiKeyVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                </Button>
              </div>
              <p>输入您的 {selectedProviderOption.label} API Key，启用后可保存并校验该 Provider 的模型配置。</p>
              <div className="endpoint-box">
                <label>
                  API 接入点
                  {endpointInputEnabled ? (
                    <Input
                      value={customBaseUrl}
                      onChange={(event) => onCustomBaseUrlChange(event.target.value)}
                      placeholder="https://your-provider.example/v1"
                    />
                  ) : (
                    <Select value="official" disabled>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="official">官方默认（{endpointLabel}）</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </label>
                <Button
                  disabled={!endpointCustomizationSupported}
                  onClick={() =>
                    onCustomEndpointEnabledChange(
                      selectedProvider === CUSTOM_PROVIDER ? true : !isCustomEndpointEnabled,
                    )
                  }
                  title={
                    selectedProvider === CUSTOM_PROVIDER
                      ? "配置自定义接入点"
                      : endpointCustomizationSupported
                        ? "OpenAI 支持自定义 API 接入点"
                        : "当前 Provider 暂不支持自定义接入点"
                  }
                  type="button"
                >
                  {endpointInputEnabled && selectedProvider !== CUSTOM_PROVIDER
                    ? "使用官方默认"
                    : "自定义接入点"}
                  <ChevronRight size={14} />
                </Button>
                <small>
                  {endpointInputEnabled
                    ? "请手动输入 API 接入点，保存后会写入当前模型配置。"
                    : endpointCustomizationSupported
                      ? `${selectedProviderOption.label} 支持自定义 API 接入点，默认使用：${endpointLabel}`
                    : `${selectedProviderOption.label} 使用默认接入点：${endpointLabel}`}
                </small>
              </div>
              <div className="settings-card-actions">
                <Button className="settings-primary-button" disabled={isSaving} onClick={onSave} type="button">
                  <Save size={16} />
                  保存
                </Button>
                <Button disabled={isTesting} onClick={onTest} type="button">
                  <Wrench size={16} />
                  测试连接
                </Button>
              </div>
            </section>
          </div>
          <div className="settings-bottom-grid">
            <section className="settings-card model-list-card">
              <h3>C. 模型列表（{selectedProviderOption.label}）</h3>
              <div className="model-table">
                <div className="model-table__head">
                  <span>模型名称</span>
                  <span>能力</span>
                  <span>状态</span>
                  <span>默认模型</span>
                </div>
                {modelRows.map((definition) => (
                  <Button
                    className={definition.modelId === effectiveModelId ? "is-active" : ""}
                    key={definition.modelId}
                    onClick={() => selectModel(definition.modelId)}
                    type="button"
                  >
                    <span>
                      <strong>{definition.modelId}</strong>
                      {definition.modelId === DEFAULT_MODEL_ID ? <em>推荐</em> : null}
                      {definition.advanced ? <em className="is-experimental">高级</em> : null}
                    </span>
                    <span>{getModelCapabilityText(definition)}</span>
                    <span className="model-available">
                      <CircleCheck size={13} />
                      可用
                    </span>
                    <span className="model-radio">
                      <i />
                    </span>
                  </Button>
                ))}
              </div>
              <p className="settings-tip">
                <CircleAlert size={15} />
                不同模型的服装数量与生成数量上限不同，保存前会按后端模型定义校验。
              </p>
            </section>
            <div className="settings-right-stack">
              <section className="settings-card default-model-card">
                <h3>D. 默认模型</h3>
                <label>
                  当前默认模型
                  {selectedProvider === CUSTOM_PROVIDER ? (
                    <Input
                      value={customModelId}
                      onChange={(event) => onCustomModelIdChange(event.target.value)}
                      placeholder={DEFAULT_CUSTOM_MODEL_ID}
                    />
                  ) : (
                    <Select
                      value={selectedModelId}
                      onValueChange={selectModel}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {modelRows.map((definition) => (
                          <SelectItem key={definition.modelId} value={definition.modelId}>
                            {definition.modelId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </label>
                <p>作为工作区中生成任务的默认使用模型，保存后写入本地模型配置。</p>
              </section>
              <section className="settings-card param-card">
                <h3>E. 参数预设</h3>
                <div className="param-grid">
                  <label>
                    画布尺寸
                    <Select
                      value={modelSize}
                      onValueChange={(value) =>
                        onModelSizeChange(value as (typeof MODEL_SIZES)[number])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_SIZES.map((size) => (
                          <SelectItem key={size} value={size}>
                            {formatModelSizeLabel(size)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label>
                    图片格式
                    <Select
                      value={imageFormat}
                      onValueChange={onImageFormatChange}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PNG">PNG</SelectItem>
                        <SelectItem value="JPEG">JPEG</SelectItem>
                        <SelectItem value="WEBP">WEBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label>
                    生成数量
                    <span className="number-stepper">
                      <Button
                        disabled={outputCount <= outputMin}
                        onClick={() => onOutputCountChange(Math.max(outputMin, outputCount - 1))}
                        type="button"
                      >
                        <Minus size={14} />
                      </Button>
                      <Input
                        max={outputMax}
                        min={outputMin}
                        type="number"
                        value={outputCount}
                        onChange={(event) =>
                          onOutputCountChange(
                            normalizeIntegerParam(
                              event.target.value,
                              outputMin,
                              outputMax,
                              outputMin,
                            ),
                          )
                        }
                      />
                      <Button
                        disabled={outputCount >= outputMax}
                        onClick={() => onOutputCountChange(Math.min(outputMax, outputCount + 1))}
                        type="button"
                      >
                        <Plus size={14} />
                      </Button>
                    </span>
                  </label>
                  <label>
                    超时时间（秒）
                    <Input
                      min={30}
                      max={600}
                      type="number"
                      value={timeoutSeconds}
                      onChange={(event) =>
                        onTimeoutSecondsChange(
                          normalizeIntegerParam(event.target.value, 30, 600, DEFAULT_TIMEOUT_SECONDS),
                        )
                      }
                    />
                  </label>
                  <label>
                    Seed（-1 随机）
                    <Input
                      min={-1}
                      max={999999}
                      type="number"
                      value={seed}
                      onChange={(event) =>
                        onSeedChange(normalizeIntegerParam(event.target.value, -1, 999999, DEFAULT_SEED))
                      }
                    />
                  </label>
                  <label>
                    并发请求数
                    <Input
                      min={1}
                      max={5}
                      type="number"
                      value={concurrency}
                      onChange={(event) =>
                        onConcurrencyChange(
                          normalizeIntegerParam(event.target.value, 1, 5, DEFAULT_CONCURRENCY),
                        )
                      }
                    />
                    <small>1-5，数值越大越快</small>
                  </label>
                </div>
                <label className="settings-switch">
                  <Switch
                    checked={autoSaveResult}
                    onCheckedChange={(checked) => onAutoSaveResultChange(checked === true)}
                  />
                  生成完成后自动保存到结果库
                </label>
              </section>
            </div>
          </div>
        </main>
        <aside className="settings-summary">
          <h2>当前配置摘要</h2>
          <div className="summary-block">
            <span>Provider</span>
            <strong>
              <span className="summary-provider-icon">{selectedProviderOption.icon}</span>
              {selectedProviderOption.label}
            </strong>
          </div>
          <div className="summary-block">
            <span>默认模型</span>
            <strong>
              {effectiveModelId}
              {effectiveModelId === DEFAULT_MODEL_ID ? <em>默认</em> : null}
            </strong>
          </div>
          <div className="summary-block">
            <span>接入点</span>
            <strong>
              <CircleCheck size={15} />
              {endpointInputEnabled ? "自定义" : "官方默认"}
            </strong>
            <small>{endpointLabel}</small>
          </div>
          <div className="summary-block">
            <span>API Key 状态</span>
            <strong>
              <span className={`settings-status-badge ${configured ? "is-enabled" : ""}`}>
                {configured ? "已启用" : "未启用"}
              </span>
            </strong>
          </div>
          <div className="summary-block">
            <span>最后测试结果</span>
            <strong>
              {lastTestSuccess ? <CircleCheck size={15} /> : <Clock3 size={15} />}
              {lastTestSuccess ? "连接成功" : "--"}
            </strong>
          </div>
          <div className="summary-block">
            <span>区域/端点</span>
            <strong>{endpointLabel}</strong>
          </div>
          <div className="summary-block">
            <span>备注</span>
            <strong>--</strong>
          </div>
          <Button onClick={onTest} disabled={isTesting} type="button">
            <RefreshCw size={16} />
            刷新摘要
          </Button>
            </aside>
          </>
        )}
        {isNewPromptModalOpen ? (
          <PromptTemplateCreateModal
            draft={newPromptDraft}
            isSaving={isPromptLoading}
            onCancel={() => setIsNewPromptModalOpen(false)}
            onChange={setNewPromptDraft}
            onSave={() => void handleCreatePromptTemplate()}
          />
        ) : null}
      </div>
    </section>
  );
}

function SystemSettingsPage({
  cacheStats,
  currentWorkspaceRoot,
  draft,
  isClearingCache,
  isLoading,
  isSaving,
  isTestingProxy,
  systemProxyDetected,
  workspaceChangeRequiresRestart,
  onChange,
  onClearCache,
  onRefresh,
  onSave,
  onTestProxy,
}: {
  cacheStats: CacheStats;
  currentWorkspaceRoot: string;
  draft: SystemSettings;
  isClearingCache: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isTestingProxy: boolean;
  systemProxyDetected: boolean;
  workspaceChangeRequiresRestart: boolean;
  onChange: (settings: SystemSettings) => void;
  onClearCache: () => void;
  onRefresh: () => void;
  onSave: () => void;
  onTestProxy: () => void;
}) {
  function update(patch: Partial<SystemSettings>) {
    onChange({ ...draft, ...patch });
  }

  function updateProxy(patch: Partial<SystemSettings["proxy"]>) {
    update({ proxy: { ...draft.proxy, ...patch } });
  }

  async function chooseWorkspaceRoot() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择本地工作区",
    });
    if (typeof selected !== "string") {
      return;
    }
    update({ workspaceRoot: selected });
  }

  const manualProxyIncomplete =
    draft.proxy.mode === "manual" &&
    (draft.proxy.host.trim() === "" || draft.proxy.port == null || draft.proxy.port <= 0);
  const proxyModeNotSelected = draft.proxy.mode === "none";
  const systemProxyUnavailable =
    draft.proxy.mode === "system" && !systemProxyDetected;
  const proxyTestDisabled =
    isSaving ||
    isTestingProxy ||
    proxyModeNotSelected ||
    manualProxyIncomplete ||
    systemProxyUnavailable;

  return (
    <main className="settings-main system-settings-main">
      <div className="system-settings-header">
        <div>
          <h2>系统设置</h2>
          <p>保存后立即应用通知、托盘、代理和缓存策略；工作区路径重启后生效。</p>
        </div>
        <div className="system-settings-header-actions">
          <Button disabled={isSaving} onClick={onSave} type="button">
            <Save size={15} />
            {isSaving ? "保存中" : "保存设置"}
          </Button>
        </div>
      </div>
      <section className="system-settings-grid">
        <SystemSettingsCard title="启动与通知">
          <SystemToggleRow
            checked={draft.launchAtLogin}
            description="系统启动时自动运行应用"
            label="开机自启"
            onChange={(checked) => update({ launchAtLogin: checked })}
          />
          <SystemToggleRow
            checked={draft.closeToTray}
            description="点击关闭按钮时，最小化到系统托盘"
            label="关闭最小化到托盘"
            onChange={(checked) => update({ closeToTray: checked })}
          />
          <div className="system-settings-divider" />
          <SystemToggleRow
            checked={draft.notifyOnTaskSuccess}
            description="任务完成时显示系统通知"
            label="任务成功通知"
            onChange={(checked) => update({ notifyOnTaskSuccess: checked })}
          />
          <SystemToggleRow
            checked={draft.notifyOnTaskFailure}
            description="任务失败时显示系统通知"
            label="任务失败通知"
            onChange={(checked) => update({ notifyOnTaskFailure: checked })}
          />
          <SystemSelectField
            label="通知显示时长"
            value={String(draft.notificationDurationSeconds)}
            onChange={(value) =>
              update({ notificationDurationSeconds: Number.parseInt(value, 10) })
            }
            options={[
              ["3", "3 秒"],
              ["5", "5 秒"],
              ["10", "10 秒"],
              ["30", "30 秒"],
            ]}
          />
        </SystemSettingsCard>

        <SystemSettingsCard title="工作区设置">
          <label className="system-field">
            <span>工作区路径</span>
            <div className="system-inline-field">
              <Input
                className="system-path-input"
                value={draft.workspaceRoot}
                onChange={(event) => update({ workspaceRoot: event.target.value })}
              />
              <Button
                className="system-change-button"
                onClick={() => void chooseWorkspaceRoot()}
                type="button"
              >
                更改
              </Button>
            </div>
          </label>
          <p className="system-settings-note">
            当前运行工作区：{currentWorkspaceRoot || "未加载"}
          </p>
          {workspaceChangeRequiresRestart ? (
            <p className="system-settings-warning">工作区路径将在重启应用后生效。</p>
          ) : null}
          <SystemSelectField
            label="默认保存目录"
            value={draft.defaultSaveLocation}
            onChange={(value) =>
              update({ defaultSaveLocation: value as SystemSettings["defaultSaveLocation"] })
            }
            options={[
              ["workspace", "工作区内（推荐）"],
            ]}
          />
          <SystemToggleRow
            checked={draft.autoBackupEnabled}
            description="定期备份数据库（workspace.db）"
            label="自动备份"
            onChange={(checked) => update({ autoBackupEnabled: checked })}
          />
          <div className="system-two-fields">
            <SystemSelectField
              label="备份频率"
              value={draft.backupFrequency}
              onChange={(value) => update({ backupFrequency: value as SystemSettings["backupFrequency"] })}
              options={[
                ["daily", "每天"],
                ["weekly", "每周"],
              ]}
            />
            <label className="system-field">
              <span>保留备份数量</span>
              <Input
                min={1}
                max={30}
                type="number"
                value={draft.backupRetentionCount}
                onChange={(event) =>
                  update({ backupRetentionCount: Number.parseInt(event.target.value, 10) || 1 })
                }
              />
            </label>
          </div>
        </SystemSettingsCard>

        <SystemSettingsCard className="system-settings-card--cache" title="缓存管理">
          <div className="cache-summary">
            <div className="cache-ring" style={buildCacheRingStyle(cacheStats)} />
            <div>
              <strong>{formatStorageSize(cacheStats.totalBytes)}</strong>
              <span>总缓存大小</span>
            </div>
          </div>
          <dl className="cache-breakdown">
            <div><dt>缩略图缓存</dt><dd>{formatStorageSize(cacheStats.thumbnailCacheBytes)}</dd></div>
            <div><dt>临时文件</dt><dd>{formatStorageSize(cacheStats.temporaryFilesBytes)}</dd></div>
            <div><dt>模型响应缓存</dt><dd>{formatStorageSize(cacheStats.modelResponseCacheBytes)}</dd></div>
            <div><dt>其它缓存</dt><dd>{formatStorageSize(cacheStats.otherCacheBytes)}</dd></div>
          </dl>
          <div className="system-card-actions">
            <Button disabled={isLoading} onClick={onRefresh} type="button">
              <RefreshCw size={15} />
              刷新
            </Button>
            <Button
              className="danger-button"
              disabled={isClearingCache}
              onClick={onClearCache}
              type="button"
            >
              <Trash2 size={15} />
              {isClearingCache ? "清理中" : "清理缓存"}
            </Button>
          </div>
          <div className="system-settings-divider" />
          <SystemToggleRow
            checked={draft.autoCacheCleanupEnabled}
            description={`当缓存超过 ${draft.cacheCleanupThresholdGb} GB 时自动清理可安全移除的缓存`}
            label="自动清理"
            onChange={(checked) => update({ autoCacheCleanupEnabled: checked })}
          />
          <label className="system-field">
            <span>缓存大小超过</span>
            <div className="system-number-suffix">
              <Input
                min={1}
                type="number"
                value={draft.cacheCleanupThresholdGb}
                onChange={(event) =>
                  update({ cacheCleanupThresholdGb: Number.parseInt(event.target.value, 10) || 1 })
                }
              />
              <span>GB</span>
            </div>
          </label>
        </SystemSettingsCard>

        <SystemSettingsCard className="system-settings-card--wide system-settings-card--proxy" title="代理设置">
          <RadioGroup
            className="proxy-mode-row"
            value={draft.proxy.mode}
            onValueChange={(value) => updateProxy({ mode: value as ProxyMode })}
          >
            <label><RadioGroupItem value="none" /> 不使用代理</label>
            <label><RadioGroupItem value="system" /> 使用系统代理</label>
            <label><RadioGroupItem value="manual" /> 手动设置代理</label>
          </RadioGroup>
          <div className="proxy-grid">
            <SystemSelectField
              label="协议"
              value={draft.proxy.protocol}
              onChange={(value) => updateProxy({ protocol: value as ProxyProtocol })}
              options={[
                ["http", "HTTP"],
                ["https", "HTTPS"],
              ]}
            />
            <label className="system-field">
              <span>主机</span>
              <Input
                className="system-proxy-input"
                disabled={draft.proxy.mode !== "manual"}
                placeholder="例如：127.0.0.1"
                value={draft.proxy.host}
                onChange={(event) => updateProxy({ host: event.target.value })}
              />
            </label>
            <label className="system-field">
              <span>端口</span>
              <Input
                className="system-proxy-input"
                disabled={draft.proxy.mode !== "manual"}
                placeholder="例如：7890"
                type="number"
                value={draft.proxy.port ?? ""}
                onChange={(event) =>
                  updateProxy({
                    port: event.target.value ? Number.parseInt(event.target.value, 10) : null,
                  })
                }
              />
            </label>
            <label className="system-field">
              <span>用户名（可选）</span>
              <Input
                className="system-proxy-input"
                disabled={draft.proxy.mode !== "manual"}
                value={draft.proxy.username}
                onChange={(event) => updateProxy({ username: event.target.value })}
              />
            </label>
            <label className="system-field">
              <span>密码（可选）</span>
              <Input
                className="system-proxy-input"
                disabled={draft.proxy.mode !== "manual"}
                type="password"
                value={draft.proxy.password}
                onChange={(event) => updateProxy({ password: event.target.value })}
              />
            </label>
          </div>
          <div className="system-card-actions system-card-actions--end">
            <Button
              className="system-secondary-action"
              disabled={proxyTestDisabled}
              onClick={onTestProxy}
              type="button"
            >
              <RefreshCw size={15} />
              {isTestingProxy ? "测试中" : "测试代理"}
            </Button>
          </div>
        </SystemSettingsCard>

      </section>
    </main>
  );
}

function SystemSettingsCard({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={`settings-card system-settings-card ${className}`}>
      <div className="settings-card__title-row">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function ProxyTestDomainDialog({
  domain,
  isTesting,
  onCancel,
  onChange,
  onConfirm,
}: {
  domain: string;
  isTesting: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const normalizedDomain = domain.trim();

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="proxy-test-modal" aria-modal="true" role="dialog">
        <header className="modal-header">
          <div>
            <h2>测试代理</h2>
            <p>选择一个域名，用当前代理设置发起连通性测试。</p>
          </div>
          <Button disabled={isTesting} onClick={onCancel} type="button">
            <X size={16} />
          </Button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <label className="modal-field-block">
            测试域名
            <div className="modal-input-wrap">
              <Input
                autoFocus
                disabled={isTesting}
                placeholder="google.com"
                value={domain}
                onChange={(event) => onChange(event.target.value)}
              />
              <small>默认使用 google.com，也可以输入完整 URL。</small>
            </div>
          </label>
          <footer className="modal-footer proxy-test-modal__footer">
            <div>
              <Button disabled={isTesting} onClick={onCancel} type="button" variant="default">
                取消
              </Button>
              <Button disabled={isTesting || !normalizedDomain} type="submit">
                <RefreshCw size={15} />
                {isTesting ? "测试中" : "开始测试"}
              </Button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SystemToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="system-toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Switch className="system-switch" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SystemSelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className="system-field">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="system-select-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="system-select-content">
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem className="system-select-item" key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function TaskHistorySettingsPage({
  currentCombinationId,
  modelConfig,
  modelDefinitions,
  workspaceRoot,
  onNotifyError,
  onNotifyMessage,
}: {
  currentCombinationId: string | null;
  modelConfig: SaveModelConfigRequest;
  modelDefinitions: ModelDefinition[];
  workspaceRoot: string;
  onNotifyError: (message: string) => void;
  onNotifyMessage: (message: string) => void;
}) {
  const PAGE_SIZE = 20;
  const EXPORT_PAGE_SIZE = 100;
  const [historyPage, setHistoryPage] = useState<GenerationTaskHistoryPage | null>(null);
  const [allHistoryStats, setAllHistoryStats] =
    useState<GenerationTaskHistoryStats>(EMPTY_TASK_HISTORY_STATS);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [status, setStatus] = useState<GenerationTaskStatus | "all">("all");
  const [provider, setProvider] = useState("all");
  const [modelId, setModelId] = useState("all");
  const [datePreset, setDatePreset] = useState<TaskHistoryDatePreset>("all");
  const [openFilterMenu, setOpenFilterMenu] = useState<TaskHistoryFilterKey | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [historyAssetViews, setHistoryAssetViews] = useState<TaskHistoryAssetLookup>({});
  const [isRerunning, setIsRerunning] = useState(false);
  const selectedDetail =
    historyPage?.items.find((detail) => detail.task.id === selectedTaskId) ??
    historyPage?.items[0] ??
    null;
  const selectedLog = selectedDetail?.executionLogs[0] ?? null;
  const providerOptions = useMemo(() => {
    return buildTaskHistoryProviderOptions(
      historyPage?.providers ?? [],
      DEFAULT_VISIBLE_PROVIDER_OPTIONS.map((providerOption) => providerOption.id),
    );
  }, [historyPage]);
  const modelOptions = useMemo(() => {
    return buildTaskHistoryModelOptions(
      historyPage?.modelIds ?? [],
      modelDefinitions.map((definition) => definition.modelId),
    );
  }, [historyPage, modelDefinitions]);
  const pageCount = Math.max(1, Math.ceil((historyPage?.total ?? 0) / PAGE_SIZE));
  const canRetrySelected = selectedDetail
    ? canRetryTaskHistoryItem(selectedDetail.task)
    : false;

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const dateRange = buildTaskHistoryDateRange(datePreset);
      if (!isTauriRuntime()) {
        setHistoryPage({
          items: [],
          total: 0,
          limit: PAGE_SIZE,
          offset: pageIndex * PAGE_SIZE,
          stats: {
            total: 0,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
          },
          providers: [],
          modelIds: [],
        });
        setSelectedTaskId(null);
        return;
      }
      const page = await listGenerationTaskHistory({
        search,
        status: status === "all" ? null : status,
        provider: provider === "all" ? null : provider,
        modelId: modelId === "all" ? null : modelId,
        createdFrom: dateRange.createdFrom,
        createdTo: dateRange.createdTo,
        limit: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
      });
      setHistoryPage(page);
      setSelectedTaskId((current) => {
        if (current && page.items.some((detail) => detail.task.id === current)) {
          return current;
        }
        return page.items[0]?.task.id ?? null;
      });
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "加载任务历史失败");
    } finally {
      setIsLoading(false);
    }
  }, [datePreset, modelId, onNotifyError, pageIndex, provider, search, status]);

  const loadAllHistoryStats = useCallback(async () => {
    if (!isTauriRuntime()) {
      setAllHistoryStats(EMPTY_TASK_HISTORY_STATS);
      return;
    }
    try {
      const allStatsPage = await listGenerationTaskHistory({
        limit: 1,
        offset: 0,
      });
      setAllHistoryStats(allStatsPage.stats);
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "加载任务历史统计失败");
    }
  }, [onNotifyError]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadAllHistoryStats();
  }, [loadAllHistoryStats]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setHistoryAssetViews({});
      return;
    }
    const assetIds = Array.from(
      new Set((historyPage?.items ?? []).flatMap(collectTaskHistoryInputAssetIds)),
    );
    if (!assetIds.length) {
      setHistoryAssetViews({});
      return;
    }
    let alive = true;
    Promise.all(assetIds.map(async (assetId) => [assetId, await getAsset(assetId)] as const))
      .then((entries) => {
        if (!alive) {
          return;
        }
        setHistoryAssetViews(
          Object.fromEntries(
            entries.filter((entry): entry is readonly [string, AssetFileView] => Boolean(entry[1])),
          ),
        );
      })
      .catch(() => {
        if (alive) {
          setHistoryAssetViews({});
        }
      });
    return () => {
      alive = false;
    };
  }, [historyPage?.items]);

  function runTaskHistorySearch() {
    setOpenFilterMenu(null);
    if (pageIndex !== 0) {
      setSearch(searchDraft);
      setPageIndex(0);
      return;
    }
    if (search !== searchDraft) {
      setSearch(searchDraft);
      return;
    }
    void loadHistory();
  }

  async function exportExecutionLogs() {
    try {
      const exportDateRange = buildTaskHistoryDateRange(datePreset);
      const exportItems: GenerationTaskDetail[] = [];
      let exportTotal = historyPage?.total ?? 0;
      do {
        const exportPage = await listGenerationTaskHistory({
          search,
          status: status === "all" ? null : status,
          provider: provider === "all" ? null : provider,
          modelId: modelId === "all" ? null : modelId,
          createdFrom: exportDateRange.createdFrom,
          createdTo: exportDateRange.createdTo,
          limit: EXPORT_PAGE_SIZE,
          offset: exportItems.length,
        });
        exportItems.push(...exportPage.items);
        exportTotal = exportPage.total;
        if (!exportPage.items.length) {
          break;
        }
      } while (exportItems.length < exportTotal);
      const payload = exportItems.map((detail) => ({
        task: detail.task,
        executionLogs: detail.executionLogs,
        results: detail.results,
      }));
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `generation-task-execution-logs-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      onNotifyMessage("执行日志已导出");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "导出执行日志失败");
    }
  }

  async function retrySelectedTask() {
    if (!selectedDetail || !canRetrySelected) {
      return;
    }
    try {
      await retryGenerationTask(selectedDetail.task.id);
      onNotifyMessage("任务已重新提交");
      void loadHistory();
      void loadAllHistoryStats();
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "重试任务失败");
    }
  }

  async function rerunCurrentCombination() {
    if (!currentCombinationId || isRerunning) {
      return;
    }
    setIsRerunning(true);
    try {
      await rerunGenerationFromCurrentCombination(currentCombinationId, modelConfig);
      onNotifyMessage("已按当前配置重新提交任务");
      void loadHistory();
      void loadAllHistoryStats();
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "按当前配置重跑失败");
    } finally {
      setIsRerunning(false);
    }
  }

  async function copyErrorResponse() {
    const value =
      selectedLog?.errorResponseJson ??
      (selectedDetail?.task.errorMessage ? { message: selectedDetail.task.errorMessage } : null);
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      onNotifyMessage("错误返回已复制");
    } catch (error) {
      onNotifyError(error instanceof Error ? error.message : "复制错误返回失败");
    }
  }

  return (
    <main className="settings-main task-history-main">
      <div className="task-history-layout">
        <section className="task-history-board">
          <div className="task-history-stats">
            <TaskHistoryStat label="总任务" tone="total" value={allHistoryStats.total} />
            <TaskHistoryStat label="成功" tone="succeeded" value={allHistoryStats.succeeded} />
            <TaskHistoryStat label="失败" tone="failed" value={allHistoryStats.failed} />
            <TaskHistoryStat label="已取消" tone="cancelled" value={allHistoryStats.cancelled} />
          </div>
          <div className="task-history-toolbar">
            <div className="task-history-tabs">
              {(["all", "succeeded", "failed", "cancelled"] as const).map((item) => (
                <Button
                  className={status === item ? "is-active" : ""}
                  key={item}
                  onClick={() => {
                    setStatus(item);
                    setPageIndex(0);
                    setOpenFilterMenu(null);
                  }}
                  type="button"
                >
                  {item === "all" ? "全部" : getGenerationTaskStatusLabel(item)}
                </Button>
              ))}
            </div>
            <TaskHistoryFilterMenu
              isOpen={openFilterMenu === "provider"}
              label={provider === "all" ? "全部 Provider" : provider}
              options={[
                { value: "all", label: "全部 Provider" },
                ...providerOptions.map((value) => ({ value, label: value })),
              ]}
              value={provider}
              onOpenChange={(nextOpen) =>
                setOpenFilterMenu(nextOpen ? "provider" : null)
              }
              onChange={(value) => {
                setProvider(value);
                setPageIndex(0);
                setOpenFilterMenu(null);
              }}
            />
            <TaskHistoryFilterMenu
              isOpen={openFilterMenu === "model"}
              label={modelId === "all" ? "全部模型" : modelId}
              options={[
                { value: "all", label: "全部模型" },
                ...modelOptions.map((value) => ({ value, label: value })),
              ]}
              value={modelId}
              onOpenChange={(nextOpen) =>
                setOpenFilterMenu(nextOpen ? "model" : null)
              }
              onChange={(value) => {
                setModelId(value);
                setPageIndex(0);
                setOpenFilterMenu(null);
              }}
            />
            <TaskHistoryFilterMenu
              isOpen={openFilterMenu === "date"}
              label={getTaskHistoryDatePresetLabel(datePreset)}
              options={[
                { value: "all", label: "全部日期" },
                { value: "today", label: "今天" },
                { value: "7d", label: "近 7 天" },
                { value: "30d", label: "近 30 天" },
              ]}
              value={datePreset}
              onOpenChange={(nextOpen) =>
                setOpenFilterMenu(nextOpen ? "date" : null)
              }
              onChange={(value) => {
                setDatePreset(value as TaskHistoryDatePreset);
                setPageIndex(0);
                setOpenFilterMenu(null);
              }}
            />
            <label className="task-history-search">
              <Search size={14} />
              <input
                className="task-history-search-input"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    runTaskHistorySearch();
                  }
                }}
                placeholder="搜索组合名称 / 任务 ID / Prompt"
              />
            </label>
            <Button
              className="task-history-search-button"
              disabled={isLoading}
              onClick={runTaskHistorySearch}
              type="button"
            >
              <Search size={14} />
              搜索
            </Button>
            <Button
              className="task-history-refresh-button"
              disabled={isLoading}
              onClick={() => {
                setOpenFilterMenu(null);
                void loadHistory();
                void loadAllHistoryStats();
              }}
              type="button"
            >
              <RefreshCw size={14} />
              刷新
            </Button>
            <Button
              disabled={!historyPage?.items.length}
              onClick={() => {
                setOpenFilterMenu(null);
                void exportExecutionLogs();
              }}
              type="button"
            >
              <Archive size={14} />
              导出日志
            </Button>
          </div>
          <div className="task-history-table">
            <div className="task-history-row task-history-row--head">
              <span>缩略图</span>
              <span>组合名称</span>
              <span>模型</span>
              <span>状态</span>
              <span>耗时</span>
              <span>错误原因</span>
              <span>创建时间</span>
              <span>操作</span>
            </div>
            {(historyPage?.items ?? []).map((detail) => {
              const coverSrc = getTaskHistoryCoverImageSrc(
                detail,
                historyAssetViews,
                convertFileSrc,
                workspaceRoot,
              );
              return (
                <button
                  className={`task-history-row${selectedDetail?.task.id === detail.task.id ? " is-selected" : ""}`}
                  key={detail.task.id}
                  onClick={() => setSelectedTaskId(detail.task.id)}
                  type="button"
                >
                  <span className="task-history-thumb-strip">
                    {coverSrc ? (
                      <img
                        alt={detail.results.length ? "任务结果缩略图" : "任务输入缩略图"}
                        src={coverSrc}
                      />
                    ) : (
                      <i>
                        <ImageIcon size={15} />
                      </i>
                    )}
                  </span>
                  <span>{getTaskCombinationName(detail)}</span>
                  <span>{detail.task.provider} / {detail.task.modelId}</span>
                  <span>
                    <Badge className={`task-status-badge is-${detail.task.status}`}>
                      {getGenerationTaskStatusLabel(detail.task.status)}
                    </Badge>
                  </span>
                  <span>{formatTaskDuration(detail.task.startedAt, detail.task.finishedAt)}</span>
                  <span>{detail.task.errorCode ?? detail.task.errorMessage ?? "--"}</span>
                  <span>{formatTaskTime(detail.task.createdAt)}</span>
                  <span className="task-history-actions">
                    {detail.task.status === "succeeded" ? "查看结果" : "查看详情"}
                  </span>
                </button>
              );
            })}
            {!historyPage?.items.length ? (
              <div className="task-history-empty">{isLoading ? "加载中" : "暂无任务历史"}</div>
            ) : null}
          </div>
          <footer className="task-history-pagination">
            <span>共 {historyPage?.total ?? 0} 条</span>
            <Button
              disabled={pageIndex <= 0 || isLoading}
              onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
              type="button"
            >
              <ChevronLeft size={15} />
            </Button>
            <strong>{pageIndex + 1} / {pageCount}</strong>
            <Button
              disabled={pageIndex + 1 >= pageCount || isLoading}
              onClick={() => setPageIndex((value) => value + 1)}
              type="button"
            >
              <ChevronRight size={15} />
            </Button>
          </footer>
        </section>
        <aside className="task-history-detail">
          <div className="task-history-detail__header">
            <h3>任务详情</h3>
            <Badge className={`task-status-badge is-${selectedDetail?.task.status ?? "queued"}`}>
              {getGenerationTaskStatusLabel(selectedDetail?.task.status)}
            </Badge>
          </div>
          {selectedDetail ? (
            <>
              <dl className="task-history-meta">
                <div><dt>任务 ID</dt><dd>{selectedDetail.task.id}</dd></div>
                <div><dt>组合名称</dt><dd>{getTaskCombinationName(selectedDetail)}</dd></div>
                <div><dt>Provider</dt><dd>{selectedDetail.task.provider}</dd></div>
                <div><dt>模型</dt><dd>{selectedDetail.task.modelId}</dd></div>
                <div><dt>开始时间</dt><dd>{formatTaskTime(selectedDetail.task.startedAt ?? undefined)}</dd></div>
                <div><dt>结束时间</dt><dd>{formatTaskTime(selectedDetail.task.finishedAt ?? undefined)}</dd></div>
                <div><dt>输出数量</dt><dd>{selectedDetail.results.length} / {selectedDetail.task.outputCount}</dd></div>
              </dl>
              <h4>预览</h4>
              <div className="task-history-preview-grid">
                {buildTaskHistoryDetailPreviews(
                  selectedDetail,
                  historyAssetViews,
                  convertFileSrc,
                  workspaceRoot,
                ).map((preview, index) => (
                  <TaskHistoryPreview
                    key={`${preview.role}-${preview.assetId}-${index}`}
                    label={preview.label}
                    src={preview.src}
                  />
                ))}
              </div>
              <h4>输入快照</h4>
              <pre className="task-history-json">{formatJsonForDisplay(selectedDetail.task.assetSnapshotJson)}</pre>
              <h4>最终 Prompt</h4>
              <pre className="task-history-json">{formatJsonForDisplay(selectedDetail.task.finalPromptSnapshotJson)}</pre>
              <h4>模型参数</h4>
              <pre className="task-history-json">{formatJsonForDisplay(selectedDetail.task.modelConfigSnapshotJson)}</pre>
              <h4>{selectedLog?.errorResponseJson ? "错误返回" : "成功返回"}</h4>
              <pre className="task-history-json">
                {formatJsonForDisplay(selectedLog?.errorResponseJson ?? selectedLog?.successResponseJson)}
              </pre>
              <div className="task-history-detail-actions">
                <Button disabled={!canRetrySelected} onClick={() => void retrySelectedTask()} type="button">
                  <RefreshCw size={16} />
                  重试任务
                </Button>
                <Button
                  disabled={!currentCombinationId || isRerunning}
                  onClick={() => void rerunCurrentCombination()}
                  type="button"
                >
                  <Play size={16} />
                  按当前配置重跑
                </Button>
                <Button disabled={!selectedLog?.errorResponseJson && !selectedDetail.task.errorMessage} onClick={() => void copyErrorResponse()} type="button">
                  <Copy size={16} />
                  复制错误
                </Button>
                <Button
                  disabled={!selectedDetail.results[0]}
                  onClick={() => {
                    const first = selectedDetail.results[0];
                    if (first) {
                      void openGenerationResult(first.assetId).catch((error) => {
                        onNotifyError(error instanceof Error ? error.message : "打开结果文件失败");
                      });
                    }
                  }}
                  type="button"
                >
                  <FolderOpen size={16} />
                  打开文件
                </Button>
              </div>
            </>
          ) : (
            <div className="task-history-empty">选择任务查看详情</div>
          )}
        </aside>
      </div>
    </main>
  );
}

function TaskHistoryStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "total" | "succeeded" | "failed" | "cancelled";
  value: number;
}) {
  return (
    <div className={`task-history-stat is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskHistoryFilterMenu({
  isOpen,
  label,
  options,
  value,
  onChange,
  onOpenChange,
}: {
  isOpen: boolean;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof globalThis.Node && !rootRef.current?.contains(target)) {
        onOpenChange(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <div
      className={`task-history-filter-menu${isOpen ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="task-history-filter-trigger"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen ? (
        <div className="task-history-filter-list" role="menu">
          {options.map((option) => (
            <button
              aria-checked={option.value === value}
              className={option.value === value ? "is-active" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
              role="menuitemradio"
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? <CircleCheck size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TaskHistoryPreview({ label, src }: { label: string; src?: string }) {
  return (
    <figure className="task-history-preview">
      {src ? <img alt={label} src={src} /> : <ImageIcon size={28} />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function PromptTemplateSettingsPage({
  draft,
  error,
  filteredTemplates,
  isLoading,
  isReadOnly,
  preview,
  search,
  selectedTemplate,
  selectedType,
  validation,
  onChangeDraft,
  onChangeSearch,
  onChangeType,
  onDeleteTemplate,
  onSelectTemplate,
}: {
  draft: PromptTemplateDraft;
  error: string | null;
  filteredTemplates: PromptTemplate[];
  isLoading: boolean;
  isReadOnly: boolean;
  preview: string;
  search: string;
  selectedTemplate: PromptTemplate | null;
  selectedType: PromptTemplateType;
  validation: string | null;
  onChangeDraft: (draft: PromptTemplateDraft) => void;
  onChangeSearch: (value: string) => void;
  onChangeType: (type: PromptTemplateType) => void;
  onDeleteTemplate: (template: PromptTemplate) => void;
  onSelectTemplate: (template: PromptTemplate) => void;
}) {
  const syncedDraft = syncPromptTemplateDraftVariables(draft);

  return (
    <main className="settings-main prompt-template-main">
      <div className="prompt-template-layout">
        <section className="settings-card prompt-template-list-card">
          <h3>模板列表</h3>
          <div className="prompt-type-tabs">
            {PROMPT_TEMPLATE_TYPES.map((type) => (
              <Button
                className={selectedType === type ? "is-active" : ""}
                key={type}
                onClick={() => onChangeType(type)}
                type="button"
              >
                {getPromptTemplateTypeLabel(type)}
              </Button>
            ))}
          </div>
          <div className="prompt-search-row">
            <label>
              <Search size={15} />
              <Input
                className="prompt-search-input"
                value={search}
                onChange={(event) => onChangeSearch(event.target.value)}
                placeholder="搜索模板名称"
              />
            </label>
            <Button className="prompt-search-filter-button" disabled title="筛选暂未开放" type="button">
              <Filter size={16} />
            </Button>
          </div>
          <div className="prompt-template-table">
            <div className="prompt-template-table__head">
              <span />
              <span>模板名称</span>
              <span>类型</span>
              <span>来源</span>
            </div>
            {filteredTemplates.map((template) => (
              <Button
                className={template.id === selectedTemplate?.id ? "is-active" : ""}
                key={template.id}
                onClick={() => onSelectTemplate(template)}
                type="button"
              >
                <span className="prompt-template-radio">
                  <i />
                </span>
                <strong>{getPromptTemplateDisplayName(template)}</strong>
                <span>{getPromptTemplateTypeLabel(template.templateType)}</span>
                <span>{getPromptTemplateSourceLabel(template.source)}</span>
              </Button>
            ))}
            {filteredTemplates.length === 0 ? (
              <div className="prompt-template-empty">暂无匹配模板</div>
            ) : null}
          </div>
          <div className="prompt-template-count">共 {filteredTemplates.length} 条</div>
        </section>
        <div className="prompt-template-editor-stack">
          <section className="settings-card prompt-template-editor-card">
            <div className="settings-card__title-row">
              <h3>模板编辑</h3>
              {isLoading ? <span className="settings-status-badge">处理中</span> : null}
            </div>
            {error ? <p className="prompt-template-error">{error}</p> : null}
            <div className="prompt-editor-form-grid">
              <label>
                模板名称
                <Input
                  disabled={isReadOnly}
                  maxLength={50}
                  value={draft.name}
                  onChange={(event) => onChangeDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                模板类型
                <Select
                  disabled={isReadOnly}
                  value={draft.templateType}
                  onValueChange={(value) =>
                    onChangeDraft({
                      ...draft,
                      templateType: value as PromptTemplateType,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMPT_TEMPLATE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {getPromptTemplateTypeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="prompt-body-field">
              <span>模板内容</span>
              <Textarea
                disabled={isReadOnly}
                value={syncedDraft.body}
                onChange={(event) =>
                  onChangeDraft(
                    syncPromptTemplateDraftVariables({
                      ...syncedDraft,
                      body: event.target.value,
                    }),
                  )
                }
                placeholder="输入 {{变量名}} 引用变量"
              />
            </label>
            <div className="prompt-editor-meta">
              <span>
                字符数 {syncedDraft.body.length} / 模型限制 {PROMPT_TEMPLATE_LIMIT}
              </span>
              <span>
                变量数量 {syncedDraft.variables.length}
                {validation ? <strong className="is-error">{validation}</strong> : <strong>可保存</strong>}
              </span>
            </div>
          </section>
          <PromptVariableConfigEditor
            draft={syncedDraft}
            isReadOnly={isReadOnly}
            onChange={onChangeDraft}
          />
          <section className="settings-card prompt-preview-card">
            <div className="settings-card__title-row">
              <h3>预览</h3>
              <span className="prompt-preview-status">
                <CircleCheck size={14} />
                变量已渲染
              </span>
            </div>
            <div className="prompt-preview-stack">
              <PromptPreviewBlock title={`最终${getPromptTemplateTypeLabel(draft.templateType)}`} text={preview} tone={draft.templateType} />
            </div>
          </section>
          {selectedTemplate && selectedTemplate.source === "custom" ? (
            <Button
              className="prompt-delete-button"
              onClick={() => onDeleteTemplate(selectedTemplate)}
              type="button"
            >
              <Trash2 size={16} />
              删除模板
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function PromptVariableConfigEditor({
  draft,
  isReadOnly,
  onChange,
}: {
  draft: PromptTemplateDraft;
  isReadOnly: boolean;
  onChange: (draft: PromptTemplateDraft) => void;
}) {
  const variables = syncPromptTemplateVariablesFromBody({
    body: draft.body,
    variables: draft.variables,
  });

  function updateVariable(name: string, nextVariable: PromptTemplateVariable) {
    const nextVariables = variables.map((variable) =>
      variable.name === name ? normalizePromptTemplateVariable(nextVariable) : variable,
    );
    onChange({ ...draft, variables: nextVariables });
  }

  return (
    <section className="settings-card prompt-variable-card prompt-variable-config-card">
      <div className="settings-card__title-row">
        <h3>参数编辑</h3>
        <span className="prompt-variable-detect-status">
          已识别 {variables.length} 个参数
        </span>
      </div>
      <PromptVariableEditor
        isReadOnly={isReadOnly}
        variables={variables}
        onUpdateVariable={updateVariable}
      />
    </section>
  );
}

function PromptPreviewBlock({
  title,
  text,
  tone,
}: {
  title: string;
  text: string;
  tone: PromptTemplateType;
}) {
  return (
    <article className={`prompt-preview-block prompt-preview-block--${tone}`}>
      <strong>{title}</strong>
      <p>{text || "填写模板内容和示例值后可查看效果"}</p>
      <span>{text ? "已渲染" : "未修改"}</span>
    </article>
  );
}

function PromptTemplateCreateModal({
  draft,
  isSaving,
  onCancel,
  onChange,
  onSave,
}: {
  draft: PromptTemplateDraft;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (draft: PromptTemplateDraft) => void;
  onSave: () => void;
}) {
  const validation = validatePromptTemplateCreateDraft(draft);

  return (
    <div className="prompt-modal-backdrop">
      <section className="prompt-modal prompt-template-create-modal">
        <header>
          <div>
            <h2>新建 Prompt 模板</h2>
            <p>先填写模板名称和类型，创建后在右侧编辑区继续完善内容和参数</p>
          </div>
          <Button onClick={onCancel} type="button" aria-label="关闭">
            <X size={18} />
          </Button>
        </header>
        <main>
          <section className="settings-card prompt-create-basic">
            <h3>1. 基本信息</h3>
            <div className="prompt-create-type-tabs">
              {PROMPT_TEMPLATE_TYPES.map((type) => (
                <Button
                  className={draft.templateType === type ? "is-active" : ""}
                  key={type}
                  onClick={() => onChange({ ...draft, templateType: type })}
                  type="button"
                >
                  {getPromptTemplateTypeLabel(type)}
                </Button>
              ))}
            </div>
            <label>
              模板名称 *
              <Input
                maxLength={50}
                value={draft.name}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
                placeholder="请输入模板名称"
              />
              <span>{draft.name.length}/50</span>
            </label>
          </section>
        </main>
        <footer>
          <div>
            <Button onClick={onCancel} type="button">取消</Button>
            <Button disabled={isSaving || Boolean(validation)} onClick={onSave} type="button">
              {isSaving ? "创建中" : "创建模板"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function PromptVariableEditor({
  isReadOnly = false,
  variables,
  onUpdateVariable,
}: {
  isReadOnly?: boolean;
  variables: PromptTemplateVariable[];
  onUpdateVariable: (name: string, variable: PromptTemplateVariable) => void;
}) {
  function updateOptions(variable: PromptTemplateVariable, options: string[]) {
    onUpdateVariable(variable.name, {
      ...variable,
      options,
      defaultValue:
        variable.controlType === "select" && !options.includes(variable.defaultValue ?? "")
          ? options[0] ?? ""
          : variable.defaultValue,
      exampleValue: options.join("、"),
    });
  }

  return (
    <div className="prompt-variable-editor">
      <div>
        <span>参数</span>
        <span>显示名称</span>
        <span>控件类型</span>
        <span>默认值</span>
        <span>选项值</span>
      </div>
      {variables.length === 0 ? (
        <div className="prompt-variable-editor__empty">
          模板内容中使用 {`{{参数名}}`} 后会自动生成配置项
        </div>
      ) : null}
      {variables.map((variable) => (
        <div key={variable.name}>
          <code>{`{{${variable.name}}}`}</code>
          <Input
            disabled={isReadOnly}
            value={variable.displayName ?? variable.description ?? variable.name}
            onChange={(event) =>
              onUpdateVariable(variable.name, {
                ...variable,
                displayName: event.target.value,
              })
            }
            placeholder="例如：画面比例"
          />
          <Select
            disabled={isReadOnly}
            value={variable.controlType ?? "input"}
            onValueChange={(value) =>
              onUpdateVariable(variable.name, {
                ...variable,
                controlType:
                  value === "select" || value === "combobox" ? value : "input",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="input">输入框</SelectItem>
              <SelectItem value="select">下拉选项</SelectItem>
              <SelectItem value="combobox">可选可输入</SelectItem>
            </SelectContent>
          </Select>
          {variable.controlType === "select" ? (
            <Select
              disabled={isReadOnly || !variable.options?.length}
              value={variable.defaultValue ?? ""}
              onValueChange={(value) =>
                onUpdateVariable(variable.name, {
                  ...variable,
                  defaultValue: value,
                  exampleValue: value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择默认值" />
              </SelectTrigger>
              <SelectContent>
                {(variable.options ?? []).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            variable.controlType === "combobox" ? (
              <PromptVariableComboboxInput
                disabled={isReadOnly}
                options={variable.options ?? []}
                value={variable.defaultValue ?? ""}
                onChange={(value) =>
                  onUpdateVariable(variable.name, {
                    ...variable,
                    defaultValue: value,
                    exampleValue: value,
                  })
                }
                placeholder="输入默认值"
              />
            ) : (
              <Input
                disabled={isReadOnly}
                value={variable.defaultValue ?? ""}
                onChange={(event) =>
                  onUpdateVariable(variable.name, {
                    ...variable,
                    defaultValue: event.target.value,
                    exampleValue: event.target.value,
                  })
                }
                placeholder="输入默认值"
              />
            )
          )}
          <PromptVariableOptionsEditor
            disabled={isReadOnly || variable.controlType === "input"}
            options={variable.options ?? []}
            onChange={(options) => updateOptions(variable, options)}
          />
        </div>
      ))}
    </div>
  );
}

function PromptVariableComboboxInput({
  disabled,
  options,
  value,
  onChange,
  placeholder,
}: {
  disabled?: boolean;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>();
    return options.filter((option) => {
      const value = option.trim();
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }, [options]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof globalThis.Node) || !rootRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function selectOption(option: string) {
    onChange(option);
    setIsOpen(false);
  }

  return (
    <span
      className={`prompt-variable-combobox${isOpen ? " is-open" : ""}`}
      onBlur={(event) => {
        const nextFocusedElement = event.relatedTarget;
        if (
          !nextFocusedElement ||
          !rootRef.current?.contains(nextFocusedElement)
        ) {
          setIsOpen(false);
        }
      }}
      ref={rootRef}
    >
      <Input
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
      />
      <Button
        aria-label="展开候选值"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
        size="icon"
        variant="ghost"
      >
        <ChevronDown size={15} />
      </Button>
      {isOpen ? (
        <div className="prompt-variable-combobox__menu" role="listbox">
          {uniqueOptions.length ? (
            uniqueOptions.map((option) => (
              <button
                aria-selected={option === value}
                className={option === value ? "is-selected" : undefined}
                key={option}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                type="button"
                role="option"
              >
                <span>{option}</span>
                {option === value ? <CircleCheck size={14} /> : null}
              </button>
            ))
          ) : (
            <small>暂无候选值</small>
          )}
        </div>
      ) : null}
    </span>
  );
}

function PromptVariableOptionsEditor({
  disabled,
  options,
  onChange,
}: {
  disabled: boolean;
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const [draftOptions, setDraftOptions] = useState(options);
  const [draftOption, setDraftOption] = useState("");
  const optionsKey = options.join("\u0000");
  const nextOption = draftOption.trim();
  const canAdd =
    !disabled && Boolean(nextOption) && !normalizeOptions(draftOptions).includes(nextOption);

  useEffect(() => {
    setDraftOptions(options);
  }, [optionsKey]);

  function normalizeOptions(values: string[]) {
    const seen = new Set<string>();
    const normalized: string[] = [];
    values.forEach((value) => {
      const option = value.trim();
      if (!option || seen.has(option)) {
        return;
      }
      seen.add(option);
      normalized.push(option);
    });
    return normalized;
  }

  function commitOptions(values = draftOptions) {
    const normalized = normalizeOptions(values);
    setDraftOptions(normalized);
    onChange(normalized);
  }

  function addOption() {
    if (!canAdd) {
      return;
    }
    const normalized = normalizeOptions([...draftOptions, nextOption]);
    setDraftOptions(normalized);
    onChange(normalized);
    setDraftOption("");
  }

  function updateDraftOption(index: number, value: string) {
    setDraftOptions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item)),
    );
  }

  function removeOption(index: number) {
    const nextOptions = draftOptions.filter((_, itemIndex) => itemIndex !== index);
    const normalized = normalizeOptions(nextOptions);
    setDraftOptions(normalized);
    onChange(normalized);
  }

  return (
    <div className={`prompt-variable-options-editor${disabled ? " is-disabled" : ""}`}>
      {draftOptions.map((option, index) => (
        <div className="prompt-variable-options-editor__row" key={`${option}-${index}`}>
          <Input
            disabled={disabled}
            value={option}
            onBlur={() => commitOptions()}
            onChange={(event) => updateDraftOption(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitOptions();
              }
            }}
            placeholder="输入选项值"
          />
          <Button
            aria-label={`删除选项 ${option || index + 1}`}
            disabled={disabled}
            onClick={() => removeOption(index)}
            type="button"
            size="icon"
            variant="ghost"
          >
            <X size={14} />
          </Button>
        </div>
      ))}
      <div className="prompt-variable-options-editor__row prompt-variable-options-editor__row--add">
        <Input
          disabled={disabled}
          value={draftOption}
          onChange={(event) => setDraftOption(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addOption();
            }
          }}
          placeholder={disabled ? "输入框无需选项" : "输入选项值"}
        />
        <Button
          aria-label="添加选项值"
          disabled={!canAdd}
          onClick={addOption}
          type="button"
          size="icon"
          variant="default"
        >
          <Plus size={14} />
        </Button>
      </div>
    </div>
  );
}

function buildFallbackModelDefinition(provider: ProviderId = DEFAULT_PROVIDER): ModelDefinition {
  if (provider === GOOGLE_PROVIDER) {
    return {
      provider: GOOGLE_PROVIDER,
      modelId: "nano-banana",
      displayName: "Nano Banana",
      advanced: false,
      inputLimits: {
        minGarments: 1,
        maxGarments: 4,
      },
      paramsSchema: [],
      output: {
        countParamKey: "outputCount",
        minCount: 1,
        maxCount: 4,
      },
      providerBaseUrl: getDefaultProviderBaseUrl(GOOGLE_PROVIDER),
    };
  }

  return {
    provider: DEFAULT_PROVIDER,
    modelId: DEFAULT_MODEL_ID,
    displayName: "GPT Image 2",
    advanced: false,
    inputLimits: {
      minGarments: 1,
      maxGarments: 4,
    },
    paramsSchema: [],
    output: {
      countParamKey: "outputCount",
      minCount: 1,
      maxCount: 4,
    },
    providerBaseUrl: null,
  };
}

function buildCustomModelDefinition(modelId: string, providerBaseUrl: string): ModelDefinition {
  const effectiveModelId = modelId.trim() || DEFAULT_CUSTOM_MODEL_ID;
  return {
    provider: CUSTOM_PROVIDER,
    modelId: effectiveModelId,
    displayName: effectiveModelId,
    advanced: false,
    inputLimits: {
      minGarments: 1,
      maxGarments: 8,
    },
    paramsSchema: [],
    output: {
      countParamKey: "outputCount",
      minCount: 1,
      maxCount: 8,
    },
    providerBaseUrl: providerBaseUrl.trim() || null,
  };
}

function getModelCapabilityText(definition: ModelDefinition) {
  const maxCount = definition.output.maxCount;
  const maxGarments = definition.inputLimits.maxGarments;
  if (definition.provider === GOOGLE_PROVIDER) {
    return `Google 图片生成 · 最多 ${maxGarments} 张服装 · ${maxCount} 张输出`;
  }
  if (definition.provider === CUSTOM_PROVIDER) {
    return `自定义接入点 · 最多 ${maxGarments} 张服装 · ${maxCount} 张输出`;
  }
  if (definition.modelId.includes("fast")) {
    return `快速生成 · 最多 ${maxGarments} 张服装 · ${maxCount} 张输出`;
  }
  if (definition.advanced) {
    return `高级细节 · 最多 ${maxGarments} 张服装 · ${maxCount} 张输出`;
  }
  return `高质量生成 · 最多 ${maxGarments} 张服装 · ${maxCount} 张输出`;
}

function normalizeProviderId(provider: string): ProviderId {
  const option = PROVIDER_OPTIONS.find((item) => item.id === provider);
  if (option?.enabled) {
    return option.id;
  }
  return DEFAULT_PROVIDER;
}

function getProviderLabel(provider: ProviderId) {
  return PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? provider;
}

function getDefaultProviderBaseUrl(provider: ProviderId) {
  if (provider === GOOGLE_PROVIDER) {
    return "https://generativelanguage.googleapis.com/v1beta";
  }
  if (provider === CUSTOM_PROVIDER) {
    return "";
  }
  return "https://api.openai.com/v1";
}

function getProviderStatusLabel(provider: ProviderId) {
  if (provider === CUSTOM_PROVIDER) {
    return "自定义模型配置已保存；执行调用需要对应 Provider adapter。";
  }
  if (provider === GOOGLE_PROVIDER) {
    return "Google nano banana 模型配置已保存；执行调用需要 Google provider adapter。";
  }
  return "OpenAI 模型配置已保存，可继续执行生成。";
}

function buildPromptTemplateDraft(template: PromptTemplate): PromptTemplateDraft {
  return syncPromptTemplateDraftVariables({
    id: template.id,
    name: template.name,
    templateType: template.templateType,
    body: template.body,
    variables: template.variables.map((variable) => normalizePromptTemplateVariable({ ...variable })),
    description: template.description,
    tags: [...template.tags],
    isDefault: template.isDefault,
    locked: template.locked,
  });
}

function arePromptTemplateDraftsEqual(
  left: PromptTemplateDraft,
  right: PromptTemplateDraft,
) {
  return (
    JSON.stringify(buildPromptTemplateDraftSnapshot(left)) ===
    JSON.stringify(buildPromptTemplateDraftSnapshot(right))
  );
}

function buildPromptTemplateDraftSnapshot(draft: PromptTemplateDraft) {
  const syncedDraft = syncPromptTemplateDraftVariables(draft);
  return {
    id: syncedDraft.id ?? null,
    name: syncedDraft.name,
    templateType: syncedDraft.templateType,
    body: syncedDraft.body,
    description: syncedDraft.description,
    tags: syncedDraft.tags,
    isDefault: syncedDraft.isDefault,
    locked: syncedDraft.locked,
    variables: syncedDraft.variables.map((variable) =>
      normalizePromptTemplateVariable({ ...variable }),
    ),
  };
}

function buildEmptyPromptTemplateDraft(type: PromptTemplateType): PromptTemplateDraft {
  return {
    id: null,
    name: "",
    templateType: type,
    body: "",
    variables: [],
    description: "",
    tags: [],
    isDefault: false,
    locked: false,
  };
}

function buildEmptyPromptPresetDraft(sourcePreset?: PromptPresetOption | null): PromptPresetDraft {
  const variables = promptWorkbenchVariablesToTemplateVariables(
    sourcePreset?.variables ?? DEFAULT_PROMPT_WORKBENCH_STATE.variables,
  );
  return {
    id: null,
    name: "",
    scenario: sourcePreset?.scenario ?? "白底主图",
    description: sourcePreset?.description ?? "",
    system: sourcePreset?.system ?? buildPromptBindingSection("builtin_system_commerce_display"),
    user: sourcePreset?.user ?? buildPromptBindingSection("builtin_user_tryon_general"),
    negative:
      sourcePreset?.negative ?? buildPromptBindingSection("builtin_negative_clean_background"),
    variables,
    isDefault: false,
    locked: false,
  };
}

function buildPromptPresetDraftFromOption(preset: PromptPresetOption): PromptPresetDraft {
  return {
    id: preset.id,
    name: preset.name,
    scenario: preset.scenario,
    description: preset.description,
    system: preset.system,
    user: preset.user,
    negative: preset.negative,
    variables: promptWorkbenchVariablesToTemplateVariables(preset.variables),
    isDefault: preset.isDefault,
    locked: preset.locked,
  };
}

function syncPromptPresetDraftVariables(
  draft: PromptPresetDraft,
  templates: PromptTemplate[],
): PromptPresetDraft {
  return {
    ...draft,
    variables: buildPromptPresetVariablesForSections({
      sections: [draft.system, draft.user, draft.negative],
      templates,
      existingVariables: draft.variables,
    }),
  };
}

function arePromptPresetDraftsEqual(
  left: PromptPresetDraft,
  right: PromptPresetDraft,
  templates: PromptTemplate[],
) {
  return (
    JSON.stringify(buildPromptPresetDraftSnapshot(left, templates)) ===
    JSON.stringify(buildPromptPresetDraftSnapshot(right, templates))
  );
}

function buildPromptPresetDraftSnapshot(draft: PromptPresetDraft, templates: PromptTemplate[]) {
  const syncedDraft = syncPromptPresetDraftVariables(draft, templates);
  return {
    id: syncedDraft.id ?? null,
    name: syncedDraft.name,
    scenario: syncedDraft.scenario,
    description: syncedDraft.description,
    system: syncedDraft.system,
    user: syncedDraft.user,
    negative: syncedDraft.negative,
    isDefault: syncedDraft.isDefault,
    locked: syncedDraft.locked,
    variables: syncedDraft.variables.map((variable) =>
      normalizePromptTemplateVariable({ ...variable }),
    ),
  };
}

function promptWorkbenchVariablesToTemplateVariables(
  variables: PromptWorkbenchVariables,
): PromptTemplateVariable[] {
  const knownVariables: PromptTemplateVariable[] = [
    {
      name: "style",
      displayName: "风格",
      description: "风格",
      exampleValue: "休闲、商务、复古",
      required: true,
      defaultValue: variables.style,
    },
    {
      name: "background",
      displayName: "背景",
      description: "背景",
      exampleValue: "纯白背景、室内场景、自然光棚",
      required: true,
      defaultValue: variables.background,
    },
    {
      name: "aspectRatio",
      displayName: "画面比例",
      description: "画面比例",
      exampleValue: "1:1、3:4、4:5、9:16",
      required: true,
      defaultValue: variables.aspectRatio,
    },
    {
      name: "garmentCategory",
      displayName: "服装类别",
      description: "服装类别",
      exampleValue: "连衣裙、上衣、外套、裤子",
      required: true,
      defaultValue: variables.garmentCategory,
    },
    {
      name: "outputCount",
      displayName: "生成数量",
      description: "生成数量",
      exampleValue: "1、2、3、4",
      required: true,
      defaultValue: variables.outputCount,
    },
  ];
  const knownNames = new Set(knownVariables.map((variable) => variable.name));
  const customVariables = Object.entries(variables)
    .filter(([name]) => !knownNames.has(name))
    .map(([name, value]) => ({
      name,
      displayName: name,
      description: name,
      exampleValue: value,
      required: true,
      defaultValue: value,
      controlType: "input" as const,
      options: [],
    }));
  return [...knownVariables, ...customVariables];
}

function buildPromptBindingSection(baseTemplateId: string | null): PromptBindingSection {
  return {
    mode: "default",
    baseTemplateId,
    appendText: "",
    overrideText: "",
  };
}

function buildPreviewValues(variables: PromptTemplateVariable[]): PromptTemplatePreviewValues {
  return Object.fromEntries(
    variables.map((variable) => [
      variable.name,
      buildPromptVariablePreviewValue(variable) || variable.name,
    ]),
  );
}

function validatePromptTemplateCreateDraft(draft: PromptTemplateDraft): string | null {
  if (!draft.name.trim()) {
    return "请填写模板名称";
  }
  if (draft.name.length > 50) {
    return "模板名称不能超过 50 字";
  }
  return null;
}

function validatePromptTemplateDraft(draft: PromptTemplateDraft): string | null {
  const syncedDraft = syncPromptTemplateDraftVariables(draft);
  if (!draft.name.trim()) {
    return "请填写模板名称";
  }
  if (!syncedDraft.body.trim()) {
    return "请填写模板内容";
  }
  if (syncedDraft.body.length > PROMPT_TEMPLATE_LIMIT) {
    return "模板内容超过 4000 字符";
  }
  const variableNames = new Set<string>();
  for (const variable of syncedDraft.variables) {
    const name = variable.name.trim();
    if (!name) {
      return "变量名不能为空";
    }
    if (name.startsWith("__")) {
      return "变量名不能以 __ 开头";
    }
    if (variableNames.has(name)) {
      return `变量 ${name} 重复`;
    }
    variableNames.add(name);
    if (variable.controlType === "select") {
      const options = variable.options ?? [];
      if (options.length === 0) {
        return `参数 ${name} 需要配置选项值`;
      }
      if (variable.defaultValue && !options.includes(variable.defaultValue)) {
        return `参数 ${name} 的默认值必须来自选项值`;
      }
    }
  }
  for (const placeholder of extractPromptVariableNames(syncedDraft.body)) {
    if (!variableNames.has(placeholder)) {
      return `变量 ${placeholder} 未声明`;
    }
  }
  return null;
}

function syncPromptTemplateDraftVariables(draft: PromptTemplateDraft): PromptTemplateDraft {
  return {
    ...draft,
    variables: syncPromptTemplateVariablesFromBody({
      body: draft.body,
      variables: draft.variables,
    }),
  };
}

function syncPromptTemplateVariablesForTemplate(template: PromptTemplate): PromptTemplate {
  const syncedDraft = syncPromptTemplateDraftVariables(template);
  return {
    ...template,
    variables: syncedDraft.variables,
  };
}

function buildFallbackPromptTemplates(): PromptTemplate[] {
  const now = new Date().toISOString();
  const baseTemplates: PromptTemplateDraft[] = [
    {
      id: "builtin_system_commerce_display",
      name: "电商服装展示系统规则",
      templateType: "system",
      body: "你是专业的服装摄影与电商视觉生成助手。\n请基于以下参数生成高质量、真实感的服装展示图，适用于电商平台。\n风格：{{style}}。\n背景：{{background}}。\n画幅比例：{{aspectRatio}}。\n服装品类：{{garmentCategory}}。\n生成数量：{{outputCount}} 张。\n要求：光线自然、细节清晰、色彩真实、构图简洁，突出服装主体。",
      variables: DEFAULT_PROMPT_TEMPLATE_VARIABLES.map((item) => ({ ...item })),
      description: "服装展示图的系统指令模板",
      tags: ["commerce", "system"],
      isDefault: true,
      locked: false,
    },
    {
      id: "builtin_user_tryon_general",
      name: "通用试穿细节描述",
      templateType: "user",
      body: "画幅比例：{{aspectRatio}}。\n服装品类：{{garmentCategory}}。\n生成数量：{{outputCount}} 张。\n要求：光线自然、细节清晰、色彩真实、构图简洁，突出服装主体。",
      variables: DEFAULT_PROMPT_TEMPLATE_VARIABLES.map((item) => ({ ...item })),
      description: "通用服装试穿用户提示词",
      tags: ["tryon", "user"],
      isDefault: true,
      locked: false,
    },
    {
      id: "builtin_negative_clean_background",
      name: "纯色背景避坑描述",
      templateType: "negative",
      body: "模糊、低清晰度、噪点、畸形、拉伸、变形、过曝、过暗、色偏、文字、水印、logo、边框。",
      variables: [],
      description: "常用负面提示词",
      tags: ["negative"],
      isDefault: true,
      locked: false,
    },
    {
      id: "builtin_user_luxury_detail",
      name: "高级质感增强细节描述",
      templateType: "user",
      body: "强化面料质感与剪裁细节，保持真实比例。\n风格：{{style}}。\n背景：{{background}}。\n输出 {{outputCount}} 张高质量结果。",
      variables: DEFAULT_PROMPT_TEMPLATE_VARIABLES.map((item) => ({ ...item })),
      description: "强调质感与细节的用户提示词",
      tags: ["detail"],
      isDefault: false,
      locked: false,
    },
    {
      id: "builtin_system_extreme_style",
      name: "极简风格系统规则",
      templateType: "system",
      body: "生成极简、干净、商业摄影风格的服装展示图。\n背景保持{{background}}，画面比例为{{aspectRatio}}。",
      variables: DEFAULT_PROMPT_TEMPLATE_VARIABLES.map((item) => ({ ...item })),
      description: "极简商业摄影系统提示词",
      tags: ["minimal"],
      isDefault: false,
      locked: false,
    },
    {
      id: "builtin_negative_detail_clean",
      name: "细节优化避坑描述",
      templateType: "negative",
      body: "手部错误、面部扭曲、服装纹理错乱、布料断裂、不自然阴影、低质感、错误反射。",
      variables: [],
      description: "细节修正负面提示词",
      tags: ["negative", "detail"],
      isDefault: false,
      locked: false,
    },
  ];

  return baseTemplates.map((template) => ({
    ...syncPromptTemplateDraftVariables(template),
    id: template.id ?? `prompt_template_${Date.now()}`,
    source: "built_in",
    createdAt: now,
    updatedAt: now,
  }));
}

function buildFallbackPromptPresets(): PromptPreset[] {
  const now = new Date().toISOString();
  const builtInPresets: Array<{
    id: string;
    name: string;
    scenario: string;
    description: string;
    userTemplateId: string;
    variables: PromptWorkbenchVariables;
    isDefault: boolean;
  }> = [
    {
      id: "builtin_ecommerce_white_background",
      name: "电商白底主图",
      scenario: "白底主图",
      description: "用于电商平台白底主图，突出服装主体。",
      userTemplateId: "builtin_user_tryon_general",
      variables: DEFAULT_PROMPT_WORKBENCH_STATE.variables,
      isDefault: true,
    },
    {
      id: "builtin_model_display",
      name: "模特展示图",
      scenario: "模特展示",
      description: "保留人物自然状态，呈现完整服装上身效果。",
      userTemplateId: "builtin_user_tryon_general",
      variables: {
        style: "自然写实",
        background: "室内场景",
        aspectRatio: "3:4",
        garmentCategory: "连衣裙",
        outputCount: "1",
      },
      isDefault: false,
    },
    {
      id: "builtin_detail_display",
      name: "细节展示图",
      scenario: "细节展示",
      description: "强调面料、剪裁与局部细节质感。",
      userTemplateId: "builtin_user_luxury_detail",
      variables: {
        style: "高级质感",
        background: "纯色背景",
        aspectRatio: "4:5",
        garmentCategory: "外套",
        outputCount: "1",
      },
      isDefault: false,
    },
    {
      id: "builtin_social_style",
      name: "社媒风格图",
      scenario: "社媒风格",
      description: "适合社媒内容流的自然场景展示。",
      userTemplateId: "builtin_user_luxury_detail",
      variables: {
        style: "社媒自然风",
        background: "自然光棚",
        aspectRatio: "9:16",
        garmentCategory: "套装",
        outputCount: "1",
      },
      isDefault: false,
    },
  ];

  return builtInPresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    scenario: preset.scenario,
    description: preset.description,
    source: "built_in",
    system: buildPromptBindingSection("builtin_system_commerce_display"),
    user: buildPromptBindingSection(preset.userTemplateId),
    negative: buildPromptBindingSection("builtin_negative_clean_background"),
    variables: promptWorkbenchVariablesToTemplateVariables(preset.variables),
    isDefault: preset.isDefault,
    locked: true,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildFallbackPromptPresetScenarios(): PromptPresetScenario[] {
  const now = new Date().toISOString();
  return [
    ["builtin_scenario_white_background", "白底主图"],
    ["builtin_scenario_model_display", "模特展示"],
    ["builtin_scenario_detail_display", "细节展示"],
    ["builtin_scenario_social_style", "社媒风格"],
  ].map(([id, name], index) => ({
    id,
    name,
    source: "built_in",
    sortOrder: (index + 1) * 10,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildLocalPromptTemplate(draft: PromptTemplateDraft): PromptTemplate {
  const now = new Date().toISOString();
  const syncedDraft = syncPromptTemplateDraftVariables(draft);
  return {
    ...syncedDraft,
    id: syncedDraft.id || `prompt_template_local_${Date.now()}`,
    source: syncedDraft.id?.startsWith("builtin_") ? "built_in" : "custom",
    createdAt: now,
    updatedAt: now,
  };
}

function buildLocalPromptPreset(draft: PromptPresetDraft): PromptPreset {
  const now = new Date().toISOString();
  return {
    ...draft,
    id: draft.id || `prompt_preset_local_${Date.now()}`,
    source: draft.id?.startsWith("builtin_") ? "built_in" : "custom",
    createdAt: now,
    updatedAt: now,
  };
}

function buildLocalPromptPresetScenario(
  request: SavePromptPresetScenarioRequest,
  scenarios: PromptPresetScenario[],
): PromptPresetScenario {
  const now = new Date().toISOString();
  const existing = request.id
    ? scenarios.find((scenario) => scenario.id === request.id) ?? null
    : null;
  return {
    id: existing?.id ?? `prompt_preset_scenario_${Date.now()}`,
    name: request.name.trim(),
    source: existing?.source ?? "custom",
    sortOrder:
      existing?.sortOrder ??
      scenarios.reduce((max, scenario) => Math.max(max, scenario.sortOrder), 0) + 10,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function upsertPromptPreset(presets: PromptPreset[], preset: PromptPreset): PromptPreset[] {
  const exists = presets.some((item) => item.id === preset.id);
  return exists
    ? presets.map((item) => (item.id === preset.id ? preset : item))
    : [preset, ...presets];
}

function upsertPromptPresetScenario(
  scenarios: PromptPresetScenario[],
  scenario: PromptPresetScenario,
): PromptPresetScenario[] {
  const exists = scenarios.some((item) => item.id === scenario.id);
  const next = exists
    ? scenarios.map((item) => (item.id === scenario.id ? scenario : item))
    : [...scenarios, scenario];
  return next.sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt),
  );
}

function upsertPromptTemplate(
  templates: PromptTemplate[],
  template: PromptTemplate,
): PromptTemplate[] {
  const exists = templates.some((item) => item.id === template.id);
  return exists
    ? templates.map((item) => (item.id === template.id ? template : item))
    : [template, ...templates];
}

function getPromptTemplateTypeLabel(type: PromptTemplateType) {
  if (type === "system") {
    return "系统规则";
  }
  if (type === "negative") {
    return "避坑描述";
  }
  return "细节描述";
}

function getPromptTemplateDisplayName(template: PromptTemplate) {
  return template.name
    .replace(/\s*System\b/g, "系统规则")
    .replace(/\s*User\b/g, "细节描述")
    .replace(/\s*Negative\b/g, "避坑描述")
    .replace(/\bPrompt\b/g, "输出方案");
}

function getPromptTemplateSourceLabel(source: PromptTemplate["source"]) {
  return source === "built_in" ? "内置" : "自定义";
}

function getPromptVariableDisplayLabel(variable: PromptTemplateVariable) {
  if (variable.displayName?.trim()) {
    return variable.displayName.trim();
  }
  if (variable.description?.trim()) {
    return variable.description.trim();
  }
  const labels: Record<string, string> = {
    aspectRatio: "画面比例",
    background: "背景",
    garmentCategory: "服装类别",
    outputCount: "生成数量",
    style: "风格",
  };
  return labels[variable.name] ?? variable.name;
}

function formatShortDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}

function compareDateDesc(left?: string | null, right?: string | null) {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;
  const hasLeftTime = Number.isFinite(leftTime);
  const hasRightTime = Number.isFinite(rightTime);
  if (hasLeftTime && hasRightTime) {
    return rightTime - leftTime;
  }
  if (hasLeftTime) {
    return -1;
  }
  if (hasRightTime) {
    return 1;
  }
  return 0;
}

function copyTextWithFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const isCopied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!isCopied) {
    throw new Error("复制最终输出失败");
  }
}

function PromptPresetCenterPage({
  draft,
  error,
  isSaving,
  presets,
  promptPresetScenarios,
  selectedPresetId,
  templates,
  onBack,
  onDraftChange,
  onManageScenarios,
  onNew,
  onApply,
  onReset,
  onSave,
  onSelectPreset,
  onCopyPreviewError,
  onCopyPreviewSuccess,
}: {
  draft: PromptPresetDraft;
  error: string | null;
  isSaving: boolean;
  presets: PromptPresetOption[];
  promptPresetScenarios: PromptPresetScenario[];
  selectedPresetId: string;
  templates: PromptTemplate[];
  onBack: () => void;
  onDraftChange: (draft: PromptPresetDraft) => void;
  onManageScenarios: () => void;
  onNew: () => void;
  onApply: () => void;
  onReset: () => void;
  onSave: () => void;
  onSelectPreset: (presetId: string) => void;
  onCopyPreviewError: (message: string) => void;
  onCopyPreviewSuccess: () => void;
}) {
  const [searchText, setSearchText] = useState("");
  const selectedPreset = findPromptPresetOption(presets, selectedPresetId);
  const isBuiltIn = draft.locked || selectedPreset?.source === "built_in";
  const isDirty = selectedPreset
    ? !arePromptPresetDraftsEqual(
        draft,
        buildPromptPresetDraftFromOption(selectedPreset),
        templates,
      )
    : false;
  const canSave = !isSaving && !isBuiltIn && isDirty;
  const filteredPresets = [...presets]
    .sort((left, right) => compareDateDesc(left.updatedAt, right.updatedAt))
    .filter((preset) => {
      const keyword = searchText.trim().toLowerCase();
      return (
        !keyword ||
        preset.name.toLowerCase().includes(keyword) ||
        preset.scenario.toLowerCase().includes(keyword)
      );
    });
  const activeVariables = buildPromptPresetVariablesForSections({
    sections: [draft.system, draft.user, draft.negative],
    templates,
    existingVariables: draft.variables,
  });
  const previewValues = buildPreviewValues(activeVariables);
  const systemPreview = renderPromptSectionPreview(
    draft.system,
    templates,
    previewValues as PromptWorkbenchVariables,
  );
  const userPreview = renderPromptSectionPreview(
    draft.user,
    templates,
    previewValues as PromptWorkbenchVariables,
  );
  const negativePreview = draft.negative
    ? renderPromptSectionPreview(draft.negative, templates, previewValues as PromptWorkbenchVariables)
    : "未配置";

  function updateDraft(patch: Partial<PromptPresetDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function updateSection(
    key: "system" | "user" | "negative",
    patch: Partial<PromptBindingSection>,
  ) {
    const currentSection = key === "negative" ? draft.negative : draft[key];
    const nextDraft = {
      ...draft,
      [key]: {
        mode: currentSection?.mode ?? "default",
        baseTemplateId: currentSection?.baseTemplateId ?? null,
        appendText: currentSection?.appendText ?? "",
        overrideText: currentSection?.overrideText ?? "",
        ...patch,
      },
    } as PromptPresetDraft;
    onDraftChange(syncPromptPresetDraftVariables(nextDraft, templates));
  }

  function updateVariableDefault(name: string, defaultValue: string) {
    updateDraft({
      variables: activeVariables.map((variable) =>
        variable.name === name ? { ...variable, defaultValue } : variable,
      ),
    });
  }

  function renderVariableDefaultControl(variable: PromptTemplateVariable) {
    const currentValue = variable.defaultValue ?? "";
    if (variable.controlType === "select") {
      return (
        <Select
          disabled={isBuiltIn || !variable.options?.length}
          value={currentValue}
          onValueChange={(value) => updateVariableDefault(variable.name, value)}
        >
          <SelectTrigger className="prompt-preset-center-select-trigger">
            <SelectValue placeholder="选择默认值" />
          </SelectTrigger>
          <SelectContent>
            {(variable.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (variable.controlType === "combobox") {
      return (
        <PromptVariableComboboxInput
          disabled={isBuiltIn}
          options={variable.options ?? []}
          value={currentValue}
          onChange={(value) => updateVariableDefault(variable.name, value)}
          placeholder="输入或选择默认值"
        />
      );
    }
    return (
      <Input
        disabled={isBuiltIn}
        value={currentValue}
        onChange={(event) => updateVariableDefault(variable.name, event.target.value)}
      />
    );
  }

  async function copyPreview() {
    const text = buildOutputPlanPreviewClipboardText({
      system: systemPreview,
      user: userPreview,
      negative: negativePreview,
    });
    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          copyTextWithFallback(text);
        }
      } else {
        copyTextWithFallback(text);
      }
      onCopyPreviewSuccess();
    } catch (error) {
      onCopyPreviewError(error instanceof Error ? error.message : "复制最终输出失败");
    }
  }

  return (
    <section className="prompt-preset-center" aria-label="方案中心">
      <header className="prompt-preset-center__header">
        <Button className="settings-back-button" onClick={onBack} type="button">
          <ChevronLeft size={16} />
          返回工作台
        </Button>
        <div className="prompt-preset-center__title">
          <h1>方案中心</h1>
          <p>管理和编辑输出方案，统一管理模板与变量默认值</p>
        </div>
        <div className="settings-header-actions">
          <Button
            className="settings-header-action settings-header-action--scenarios"
            onClick={onManageScenarios}
            type="button"
            variant="default"
          >
            <SlidersHorizontal size={16} />
            场景设置
          </Button>
          <Button
            className="settings-header-action settings-header-action--create"
            onClick={onNew}
            type="button"
            variant="default"
          >
            <Plus size={16} />
            新建方案
          </Button>
          <Button
            className="settings-header-action settings-header-action--apply"
            onClick={onApply}
            type="button"
            variant="primary"
          >
            <Play size={16} />
            应用到当前组合
          </Button>
          <Button
            className={`settings-header-action settings-header-action--save${
              isDirty ? " is-dirty" : ""
            }`}
            disabled={!canSave}
            onClick={onSave}
            title={
              isBuiltIn
                ? "内置方案不能修改"
                : canSave
                  ? "保存当前方案修改"
                  : "当前方案无可保存修改"
            }
            type="button"
            variant="primary"
          >
            <Save size={16} />
            {isSaving ? "保存中" : "保存方案"}
          </Button>
          <Button
            className="settings-header-action settings-header-action--restore"
            disabled={isSaving || !isDirty}
            onClick={onReset}
            title={isDirty ? "恢复为当前方案已保存状态" : "当前方案无可恢复修改"}
            type="button"
            variant="default"
          >
            <RotateCcw size={16} />
            恢复默认
          </Button>
          <Button
            aria-label="更多"
            className="icon-button"
            disabled
            size="icon"
            title="更多操作暂未开放"
            type="button"
            variant="default"
          >
            <MoreHorizontal size={17} />
          </Button>
        </div>
      </header>

      <div className="prompt-preset-center__body">
        <aside className="prompt-preset-list-panel">
          <h2>方案列表</h2>
          <label className="prompt-preset-search">
            <Search size={15} />
            <Input
              placeholder="搜索方案名称或场景..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <div className="prompt-preset-list">
            {filteredPresets.map((preset) => (
              <Button
                className={`prompt-preset-list-item${preset.id === selectedPresetId ? " is-active" : ""}`}
                key={preset.id}
                onClick={() => onSelectPreset(preset.id)}
                type="button"
                variant="ghost"
              >
                <span className="prompt-preset-list-item__radio">
                  {preset.id === selectedPresetId ? <CircleCheck size={14} /> : null}
                </span>
                <span className="prompt-preset-list-item__thumb">{preset.name.slice(0, 1)}</span>
                <span className="prompt-preset-list-item__main">
                  <strong>{preset.name}</strong>
                  <small>系统规则 + 细节描述 + 避坑描述</small>
                  <small>更新于 {formatShortDateTime(preset.updatedAt)}</small>
                </span>
                <span className="prompt-preset-list-item__meta">
                  <Badge variant="default">{preset.scenario}</Badge>
                  <Badge variant={preset.source === "built_in" ? "success" : "secondary"}>
                    {preset.source === "built_in" ? "内置" : "自定义"}
                  </Badge>
                </span>
              </Button>
            ))}
          </div>
          <footer className="prompt-preset-list-footer">共 {filteredPresets.length} 个方案</footer>
        </aside>

        <main className="prompt-preset-edit-panel">
          <h2>方案编辑</h2>
          {error ? (
            <div className="modal-error prompt-preset-center-error">
              <CircleAlert size={15} />
              {error}
            </div>
          ) : null}
          {isBuiltIn ? (
            <div className="prompt-preset-readonly-note">
              <ShieldCheck size={15} />
              当前为内置方案，仅可查看和应用，不能直接修改。
            </div>
          ) : null}
          <Card className="prompt-preset-edit-card">
            <h3>
              <span>1</span>
              基本信息
            </h3>
            <div className="prompt-preset-basic-grid">
              <label>
                <span>方案名称</span>
                <Input
                  disabled={isBuiltIn}
                  maxLength={50}
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
              </label>
              <label>
                <span>适用场景</span>
                <Select
                  value={draft.scenario}
                  onValueChange={(value) => updateDraft({ scenario: value })}
                  disabled={isBuiltIn}
                >
                  <SelectTrigger className="prompt-preset-center-select-trigger">
                    <SelectValue placeholder="选择适用场景" />
                  </SelectTrigger>
	                  <SelectContent>
	                    {promptPresetScenarios.map((scenario) => (
	                      <SelectItem key={scenario.id} value={scenario.name}>
	                        {scenario.name}
	                      </SelectItem>
	                    ))}
	                  </SelectContent>
                </Select>
              </label>
              <label className="prompt-preset-basic-grid__full">
                <span>方案描述</span>
                <Textarea
                  disabled={isBuiltIn}
                  maxLength={200}
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                />
              </label>
            </div>
          </Card>

          <Card className="prompt-preset-edit-card">
            <h3>
              <span>2</span>
              绑定输出方案模板
            </h3>
            <PromptPresetCenterTemplateRow
              disabled={isBuiltIn}
              label="系统规则模板"
              section={draft.system}
              templates={templates.filter((template) => template.templateType === "system")}
              onChange={(patch) => updateSection("system", patch)}
            />
            <PromptPresetCenterTemplateRow
              disabled={isBuiltIn}
              label="细节描述模板"
              section={draft.user}
              templates={templates.filter((template) => template.templateType === "user")}
              onChange={(patch) => updateSection("user", patch)}
            />
            <PromptPresetCenterTemplateRow
              disabled={isBuiltIn}
              label="避坑描述模板"
              optional
              section={draft.negative}
              templates={templates.filter((template) => template.templateType === "negative")}
              onChange={(patch) => updateSection("negative", patch)}
            />
          </Card>

          <Card className="prompt-preset-edit-card">
            <h3>
              <span>3</span>
              变量默认值
              <small>已配置 {activeVariables.length}</small>
            </h3>
            <div className="prompt-preset-center-variable-list">
              {activeVariables.map((variable) => (
                <div className="prompt-preset-center-variable-row" key={variable.name}>
                  <code>{`{{${variable.name}}}`}</code>
                  <div className="prompt-preset-center-variable-value">
                    {renderVariableDefaultControl(variable)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="prompt-preset-edit-card">
            <h3>
              <span>4</span>
              追加描述
              <small>可选</small>
            </h3>
            <Textarea
              className="prompt-preset-extra-textarea"
              disabled={isBuiltIn}
              maxLength={300}
              placeholder="请输入要追加到细节描述中的内容，例如：保持面料质感、自然光效、避免过曝等..."
              value={draft.user.appendText}
              onChange={(event) =>
                updateSection("user", { mode: "append", appendText: event.target.value })
              }
            />
          </Card>
        </main>

        <aside className="prompt-preset-preview-panel">
          <Card className="prompt-preset-preview-card">
            <h2>方案预览 / 当前摘要</h2>
            <dl className="prompt-preset-preview-summary">
              <dt>方案名称</dt>
              <dd>{draft.name || "--"}</dd>
              <dt>适用场景</dt>
              <dd>{draft.scenario || "--"}</dd>
              <dt>变量状态</dt>
              <dd>已配置 {activeVariables.length}</dd>
              <dt>来源</dt>
              <dd>{isBuiltIn ? "内置方案" : "自定义方案"}</dd>
              <dt>适配模型</dt>
              <dd>支持系统规则 / 支持避坑描述 / 多图输入</dd>
            </dl>
          </Card>
          <Card className="prompt-preset-preview-card">
            <div className="prompt-preset-preview-title">
            <h2>最终输出预览</h2>
              <Button onClick={() => void copyPreview()} type="button" size="sm" variant="default">
                <Copy size={15} />
                复制全部
              </Button>
            </div>
            <div className="prompt-preview-stack">
              <PromptPreviewBlock title="系统规则" text={systemPreview} tone="system" />
              <PromptPreviewBlock title="细节描述" text={userPreview} tone="user" />
              <PromptPreviewBlock
                title="避坑描述"
                text={negativePreview}
                tone="negative"
              />
            </div>
          </Card>
        </aside>
      </div>
    </section>
  );
}

function PromptPresetScenarioModal({
  isSaving,
  promptPresetScenarios,
  onCancel,
  onSave,
}: {
  isSaving: boolean;
  promptPresetScenarios: PromptPresetScenario[];
  onCancel: () => void;
  onSave: (request: SavePromptPresetScenarioRequest) => Promise<PromptPresetScenario>;
}) {
  const [scenarioDrafts, setScenarioDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(promptPresetScenarios.map((scenario) => [scenario.id, scenario.name])),
  );
  const [newScenarioName, setNewScenarioName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    setScenarioDrafts(
      Object.fromEntries(promptPresetScenarios.map((scenario) => [scenario.id, scenario.name])),
    );
  }, [promptPresetScenarios]);

  async function saveExistingScenario(scenario: PromptPresetScenario) {
    const name = (scenarioDrafts[scenario.id] ?? "").trim();
    if (!name) {
      setFieldError("请填写场景名称");
      return;
    }
    setFieldError(null);
    try {
      await onSave({ id: scenario.id, name });
    } catch {
      // 全局 toast 已显示保存失败信息。
    }
  }

  async function addScenario() {
    const name = newScenarioName.trim();
    if (!name) {
      setFieldError("请填写新场景名称");
      return;
    }
    setFieldError(null);
    try {
      await onSave({ id: null, name });
      setNewScenarioName("");
    } catch {
      // 全局 toast 已显示保存失败信息。
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="prompt-preset-scenario-modal" aria-modal="true" role="dialog">
        <header className="modal-header">
          <div>
            <h2>场景设置</h2>
            <p>维护输出方案可选择的适用场景，修改名称会同步已有方案。</p>
          </div>
          <Button onClick={onCancel} type="button" aria-label="关闭">
            <X size={18} />
          </Button>
        </header>
        <div className="prompt-preset-scenario-modal__body">
          {fieldError ? (
            <div className="modal-error">
              <CircleAlert size={15} />
              {fieldError}
            </div>
          ) : null}
          <div className="prompt-preset-scenario-list">
            {promptPresetScenarios.map((scenario) => {
              const draftName = scenarioDrafts[scenario.id] ?? "";
              const isDirty = draftName.trim() !== scenario.name;
              const isBuiltInScenario = scenario.source === "built_in";
              return (
                <div className="prompt-preset-scenario-row" key={scenario.id}>
                  <Input
                    disabled={isBuiltInScenario}
                    value={draftName}
                    maxLength={30}
                    onChange={(event) =>
                      setScenarioDrafts((drafts) => ({
                        ...drafts,
                        [scenario.id]: event.target.value,
                      }))
                    }
                  />
                  <Badge variant={scenario.source === "built_in" ? "success" : "secondary"}>
                    {scenario.source === "built_in" ? "内置" : "自定义"}
                  </Badge>
                  <Button
                    disabled={isSaving || isBuiltInScenario || !isDirty}
                    onClick={() => {
                      void saveExistingScenario(scenario);
                    }}
                    type="button"
                    variant="default"
                  >
                    <Save size={15} />
                    保存
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="prompt-preset-scenario-add">
            <Input
              value={newScenarioName}
              maxLength={30}
              placeholder="输入新场景名称"
              onChange={(event) => setNewScenarioName(event.target.value)}
            />
            <Button
              disabled={isSaving || !newScenarioName.trim()}
              onClick={() => {
                void addScenario();
              }}
              type="button"
              variant="primary"
            >
              <Plus size={15} />
              添加场景
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PromptPresetCenterTemplateRow({
  disabled,
  label,
  optional = false,
  section,
  templates,
  onChange,
}: {
  disabled: boolean;
  label: string;
  optional?: boolean;
  section: PromptBindingSection | null | undefined;
  templates: PromptTemplate[];
  onChange: (patch: Partial<PromptBindingSection>) => void;
}) {
  const templateValue = section?.baseTemplateId ?? (optional ? "__none" : templates[0]?.id ?? "");
  return (
    <div className="prompt-preset-center-template-row">
      <div className="prompt-preset-center-template-label">
        <FileText size={14} />
        <span>{label}</span>
      </div>
      <Select
        value={templateValue}
        onValueChange={(value) =>
          onChange({ baseTemplateId: value === "__none" ? null : value })
        }
        disabled={disabled}
      >
        <SelectTrigger className="prompt-preset-center-select-trigger">
          <SelectValue placeholder={optional ? "不使用" : "选择模板"} />
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value="__none">不使用</SelectItem> : null}
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {getPromptTemplateDisplayName(template)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
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
  const selectedPersonIds = buildNewCombinationPersonAssetIdsAfterImport({
    currentPersonAssetId: form.personAssetId,
    currentPersonAssetIds: form.personAssetIds,
    importedPersonAssetIds: [],
  });
  const selectedPeople = selectedPersonIds
    .map((assetId) => people.find((asset) => asset.asset.id === assetId))
    .filter((asset): asset is AssetFileView => Boolean(asset));
  const selectedGarments = form.garmentAssetIds
    .map((assetId) => garments.find((asset) => asset.asset.id === assetId))
    .filter((asset): asset is AssetFileView => Boolean(asset));
  const visiblePersonAssets = filterNewCombinationPickerAssets(
    people,
    selectedPersonIds,
    (asset) => asset.asset.id,
  );
  const visibleGarmentAssets = filterNewCombinationPickerAssets(
    garments,
    form.garmentAssetIds,
    (asset) => asset.asset.id,
  );

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
          <Button onClick={onCancel} type="button" aria-label="关闭">
            <X size={18} />
          </Button>
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
                    <Input
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
                    <Input
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
                  <Textarea
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
                  assets={visiblePersonAssets}
                  emptyText="暂无人物图"
                  importLabel={importingType === "person" ? "导入中" : "导入人物图"}
                  isImporting={importingType === "person"}
                  label="人物图片"
                  selectedIds={selectedPersonIds}
                  helperText="创建时不会自动带入素材库图片，请从本地导入人物图"
                  onImport={() => onImport("person")}
                  onSelect={(assetId) => updateForm({ personAssetId: assetId })}
                />
                <ModalAssetPreview
                  emptyIcon={<ImageIcon size={34} />}
                  emptyText="尚未选择人物图片"
                  images={selectedPeople}
                  label="预览"
                />
                <ModalAssetPicker
                  assets={visibleGarmentAssets}
                  emptyText="暂无服装图"
                  importLabel={importingType === "garment" ? "导入中" : "导入服装图"}
                  isImporting={importingType === "garment"}
                  label="服装图片（至少 1 张建议多角度）"
                  selectedIds={form.garmentAssetIds}
                  helperText="创建时不会自动带入素材库图片，请从本地导入服装图"
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
          </div>
          <footer className="modal-footer">
            <div>
              <Button className="toolbar-button" onClick={onCancel} type="button">
                取消
              </Button>
              <Button className="primary-action" disabled={isSaving || !form.name.trim()} type="submit">
                {isSaving ? "创建中" : "创建组合"}
              </Button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PromptPresetModal({
  copyPresetId,
  draft,
  error,
  isSaving,
  presets,
  promptPresetScenarios,
  shouldApplyAfterCreate,
  sourceMode,
  templates,
  onApplyAfterCreateChange,
  onCancel,
  onCopyPresetIdChange,
  onCreate,
  onDraftChange,
  onSourceModeChange,
}: {
  copyPresetId: string;
  draft: PromptPresetDraft;
  error: string | null;
  isSaving: boolean;
  presets: PromptPresetOption[];
  promptPresetScenarios: PromptPresetScenario[];
  shouldApplyAfterCreate: boolean;
  sourceMode: PromptPresetSourceMode;
  templates: PromptTemplate[];
  onApplyAfterCreateChange: (value: boolean) => void;
  onCancel: () => void;
  onCopyPresetIdChange: (presetId: string) => void;
  onCreate: () => void;
  onDraftChange: (draft: PromptPresetDraft) => void;
  onSourceModeChange: (mode: PromptPresetSourceMode) => void;
}) {
  const systemTemplates = templates.filter((template) => template.templateType === "system");
  const userTemplates = templates.filter((template) => template.templateType === "user");
  const negativeTemplates = templates.filter((template) => template.templateType === "negative");
  const activeVariables = buildPromptPresetVariablesForSections({
    sections: [draft.system, draft.user, draft.negative],
    templates,
    existingVariables: draft.variables,
  });
  const previewValues = buildPreviewValues(activeVariables);

  function updateDraft(patch: Partial<PromptPresetDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function updateSection(
    key: "system" | "user" | "negative",
    patch: Partial<PromptBindingSection>,
  ) {
    const currentSection = key === "negative" ? draft.negative : draft[key];
    const nextSection: PromptBindingSection = {
      mode: currentSection?.mode ?? "default",
      baseTemplateId: currentSection?.baseTemplateId ?? null,
      appendText: currentSection?.appendText ?? "",
      overrideText: currentSection?.overrideText ?? "",
      ...patch,
    };
    const nextDraft = { ...draft, [key]: nextSection } as PromptPresetDraft;
    onDraftChange(syncPromptPresetDraftVariables(nextDraft, templates));
  }

  function updateVariableDefault(name: string, defaultValue: string) {
    updateDraft({
      variables: activeVariables.map((variable) =>
        variable.name === name ? { ...variable, defaultValue } : variable,
      ),
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="prompt-preset-modal" aria-modal="true" role="dialog">
        <header className="modal-header">
          <div>
            <h2>新建组合方案</h2>
            <p>创建一个可复用的输出方案，统一绑定模板与默认变量值</p>
          </div>
          <Button onClick={onCancel} type="button" aria-label="关闭">
            <X size={18} />
          </Button>
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
          <div className="prompt-preset-grid">
            <section className="settings-card prompt-preset-card">
              <h3>1. 基本信息</h3>
              <label>
                <span>方案名称</span>
                <Input
                  maxLength={50}
                  placeholder="请输入方案名称"
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
              </label>
              <label>
                <span>适用场景</span>
                <Select
                  value={draft.scenario}
                  onValueChange={(value) => updateDraft({ scenario: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {promptPresetScenarios.map((scenario) => (
                      <SelectItem key={scenario.id} value={scenario.name}>
                        {scenario.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label>
                <span>方案描述</span>
                <Textarea
                  maxLength={200}
                  placeholder="请输入方案描述（选填）"
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                />
              </label>
              <div className="prompt-preset-source">
                <strong>来源方式</strong>
                <RadioGroup
                  value={sourceMode}
                  onValueChange={(value) => onSourceModeChange(value as PromptPresetSourceMode)}
                >
                  <label>
                    <RadioGroupItem value="blank" />
                    空白创建
                  </label>
                  <label>
                    <RadioGroupItem value="copy" />
                    从现有方案复制
                  </label>
                </RadioGroup>
                <Select
                  disabled={sourceMode !== "copy"}
                  value={copyPresetId}
                  onValueChange={onCopyPresetIdChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择已有方案" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>
            <section className="settings-card prompt-preset-card">
              <h3>2. 绑定输出方案模板</h3>
              <PromptPresetTemplateRow
                label="系统规则模板"
                section={draft.system}
                templates={systemTemplates}
                onChange={(patch) => updateSection("system", patch)}
              />
              <PromptPresetTemplateRow
                label="细节描述模板"
                section={draft.user}
                templates={userTemplates}
                onChange={(patch) => updateSection("user", patch)}
              />
              <PromptPresetTemplateRow
                label="避坑描述模板"
                section={draft.negative}
                templates={negativeTemplates}
                optional
                onChange={(patch) => updateSection("negative", patch)}
              />
              <p className="panel-note">系统会自动组合三段输出内容，工作台默认以方案方式使用。</p>
            </section>
            <section className="settings-card prompt-preset-card">
              <h3>3. 默认变量值</h3>
              <div className="prompt-preset-variable-table">
                <div className="prompt-preset-variable-table__head">
                  <span>变量</span>
                  <span>含义</span>
                  <span>默认值</span>
                </div>
                {activeVariables.map((variable) => (
                  <div className="prompt-preset-variable-row" key={variable.name}>
                    <code>{`{{${variable.name}}}`}</code>
                    <span>{getPromptVariableDisplayLabel(variable)}</span>
                    <Input
                      value={variable.defaultValue ?? ""}
                      onChange={(event) => updateVariableDefault(variable.name, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </section>
            <section className="settings-card prompt-preset-card">
              <h3>4. 预览摘要</h3>
              <dl className="plain-dl prompt-preset-summary">
                <dt>方案名称</dt>
                <dd>{draft.name || "--"}</dd>
                <dt>适用场景</dt>
                <dd>{draft.scenario || "--"}</dd>
                <dt>绑定模板</dt>
                <dd>细节描述 / 避坑描述</dd>
                <dt>变量状态</dt>
                <dd>已配置 {activeVariables.length}</dd>
              </dl>
              <div className="prompt-preview-stack">
                <PromptPreviewBlock
                  title="系统规则"
                  text={renderPromptSectionPreview(draft.system, templates, previewValues as PromptWorkbenchVariables)}
                  tone="system"
                />
                <PromptPreviewBlock
                  title="细节描述"
                  text={renderPromptSectionPreview(draft.user, templates, previewValues as PromptWorkbenchVariables)}
                  tone="user"
                />
                {draft.negative ? (
                  <PromptPreviewBlock
                    title="避坑描述"
                    text={renderPromptSectionPreview(draft.negative, templates, previewValues as PromptWorkbenchVariables)}
                    tone="negative"
                  />
                ) : null}
              </div>
            </section>
          </div>
          <footer className="modal-footer prompt-preset-footer">
            <label>
              <Checkbox
                checked={shouldApplyAfterCreate}
                onCheckedChange={(checked) => onApplyAfterCreateChange(checked === true)}
              />
              创建后立即应用到当前方案
            </label>
            <div>
              <Button className="toolbar-button" onClick={onCancel} type="button">
                取消
              </Button>
              <Button className="primary-action" disabled={isSaving || !draft.name.trim()} type="submit">
                {isSaving ? "创建中" : "创建方案"}
              </Button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PromptPresetTemplateRow({
  disabled = false,
  label,
  optional = false,
  section,
  templates,
  onChange,
}: {
  disabled?: boolean;
  label: string;
  optional?: boolean;
  section: PromptBindingSection | null | undefined;
  templates: PromptTemplate[];
  onChange: (patch: Partial<PromptBindingSection>) => void;
}) {
  const templateValue = section?.baseTemplateId ?? (optional ? "__none" : templates[0]?.id ?? "");

  return (
    <div className="prompt-preset-template-row">
      <label>
        <span>{label}</span>
        <Select
          disabled={disabled}
          value={templateValue}
          onValueChange={(value) => onChange({ baseTemplateId: value === "__none" ? null : value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择模板" />
          </SelectTrigger>
          <SelectContent>
            {optional ? <SelectItem value="__none">不使用</SelectItem> : null}
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {getPromptTemplateDisplayName(template)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
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
        <Button disabled={isImporting} onClick={onImport} type="button">
          <Import size={13} />
          {importLabel}
        </Button>
      </div>
      {assets.length ? (
        <div className="modal-dropzone has-assets">
          <div className="modal-resource-grid">
            {assets.slice(0, 8).map((asset) => (
              <Button
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
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <Button
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
        </Button>
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
  currentPersonAssetIds,
  currentGarmentAssetIds,
  deselectedPersonAssetIds,
  selectedPersonId,
  selectedGarmentIds,
  importingType,
  onCollapse,
  onImport,
  onRemoveGarment,
  onRemovePerson,
  onRefresh,
  onSelectPerson,
  onToggleGarment,
  onReorder,
}: {
  people: AssetFileView[];
  garments: AssetFileView[];
  results: GenerationTaskResultAsset[];
  currentPersonAssetIds: string[];
  currentGarmentAssetIds: string[];
  deselectedPersonAssetIds: string[];
  selectedPersonId: string | null;
  selectedGarmentIds: string[];
  importingType: Extract<AssetType, "person" | "garment"> | null;
  onCollapse: () => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onRemoveGarment: (assetId: string) => void;
  onRemovePerson: (assetId: string) => void;
  onRefresh: () => void;
  onSelectPerson: (assetId: string) => void;
  onToggleGarment: (assetId: string) => void;
  onReorder: (assetType: SortableAssetType, activeId: string, overId: string) => void;
}) {
  return (
    <aside className="asset-library">
      <div className="panel-title">
        <h2>资源库</h2>
        <Button
          className="panel-collapse-button"
          onClick={onCollapse}
          title="折叠资源库"
          type="button"
          aria-label="折叠资源库"
        >
          <Menu size={18} />
        </Button>
      </div>
      <AssetSection
        title="人物图片"
        count={people.length}
        assets={people.map((asset) =>
          toSelectableAsset(
            asset,
            asset.asset.id === selectedPersonId &&
              currentPersonAssetIds.includes(asset.asset.id) &&
              !deselectedPersonAssetIds.includes(asset.asset.id),
          ),
        )}
        accent="green"
        action="导入"
        isImporting={importingType === "person"}
        onAction={() => onImport("person")}
        onRemove={onRemovePerson}
        onSelect={onSelectPerson}
        onReorder={(activeId, overId) => onReorder("person", activeId, overId)}
      />
      <AssetSection
        title="服装图片"
        count={garments.length}
        assets={garments.map((asset) =>
          toSelectableAsset(
            asset,
            currentGarmentAssetIds.includes(asset.asset.id) &&
              selectedGarmentIds.includes(asset.asset.id),
          ),
        )}
        accent="green"
        action="导入"
        isImporting={importingType === "garment"}
        onAction={() => onImport("garment")}
        onRemove={onRemoveGarment}
        onSelect={onToggleGarment}
        onReorder={(activeId, overId) => onReorder("garment", activeId, overId)}
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
  onRemove,
  onSelect,
  onReorder,
}: {
  title: string;
  count: number;
  assets: SelectableAsset[];
  accent: "green" | "blue";
  action: "导入" | "刷新";
  isImporting?: boolean;
  onAction: () => void;
  onRemove?: (assetId: string) => void;
  onSelect?: (assetId: string) => void;
  onReorder?: (activeId: string, overId: string) => void;
}) {
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [overAssetId, setOverAssetId] = useState<string | null>(null);
  const suppressNextClick = useRef(false);
  const canReorder = Boolean(onReorder);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleSelect(assetId: string) {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    onSelect?.(assetId);
  }

  function handleDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    setActiveAssetId(activeId);
    setOverAssetId(null);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverAssetId(event.over ? String(event.over.id) : null);
  }

  function resetDragState() {
    setActiveAssetId(null);
    setOverAssetId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    resetDragState();
    if (!onReorder || !overId || activeId === overId) {
      return;
    }
    suppressNextClick.current = true;
    onReorder(activeId, overId);
  }

  const assetThumbs = assets.map((asset) => (
    <SortableAssetThumb
      asset={asset}
      canReorder={canReorder}
      key={asset.id}
      onRemove={onRemove}
      onSelect={handleSelect}
      isDropTarget={isAssetDropTarget({
        activeId: activeAssetId,
        assetId: asset.id,
        overId: overAssetId,
      })}
    />
  ));

  return (
    <section className="asset-section">
      <div className="asset-section__header">
        <div>
          <span className={`section-dot section-dot--${accent}`} />
          <strong>
            {title} <span>({count})</span>
          </strong>
        </div>
        <Button disabled={isImporting} onClick={onAction} type="button">
          {action === "导入" ? <Import size={14} /> : <RefreshCw size={14} />}
          {isImporting ? "导入中" : action}
        </Button>
      </div>
      <div className="asset-grid">
        {assets.length ? (
          canReorder ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragCancel={resetDragState}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragStart={handleDragStart}
              sensors={sensors}
            >
              <SortableContext items={assets.map((asset) => asset.id)} strategy={rectSortingStrategy}>
                {assetThumbs}
              </SortableContext>
            </DndContext>
          ) : (
            assetThumbs
          )
        ) : (
          <div className="asset-empty">
            <ImageIcon size={18} />
            暂无素材
          </div>
        )}
        {action === "导入" ? (
          <Button
            className="asset-thumb asset-thumb--add"
            onClick={onAction}
            type="button"
            aria-label={`添加${title}`}
          >
            <Plus size={22} />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function SortableAssetThumb({
  asset,
  canReorder,
  onRemove,
  onSelect,
  isDropTarget,
}: {
  asset: SelectableAsset;
  canReorder: boolean;
  onRemove?: (assetId: string) => void;
  onSelect: (assetId: string) => void;
  isDropTarget: boolean;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    disabled: !canReorder,
    id: asset.id,
  });
  const [contextMenu, setContextMenu] = useState<WorkbenchContextMenuState>(null);
  const style = {
    transform: DndCSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  } satisfies CSSProperties;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onSelect(asset.id);
  }

  function openAssetContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: asset.selected ? "取消选中图片" : "选中图片",
          onSelect: () => onSelect(asset.id),
        },
        ...(onRemove
          ? [
              {
                label: "从当前组合移除",
                onSelect: () => onRemove(asset.id),
              },
            ]
          : []),
      ],
    });
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={asset.label}
      className={[
        "asset-thumb",
        asset.selected ? "is-selected" : "",
        canReorder ? "is-sortable" : "",
        isDragging ? "is-dragging" : "",
        isDropTarget ? "is-drag-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(asset.id)}
      onContextMenu={openAssetContextMenu}
      onKeyDown={handleKeyDown}
      role="button"
      style={style}
      tabIndex={0}
      title={canReorder ? "拖动调整顺序" : undefined}
    >
      <AssetImage asset={asset} />
      {onRemove ? (
        <button
          aria-label={`移除${asset.label}`}
          className="asset-thumb__remove"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove(asset.id);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          title="移除图片"
          type="button"
        >
          <X size={12} />
        </button>
      ) : null}
      {asset.selected ? (
        <span className="asset-thumb__check" aria-hidden="true">
          <span className="asset-thumb__check-dot" />
        </span>
      ) : null}
      <WorkbenchContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}

function WorkbenchContextMenu({
  state,
  onClose,
}: {
  state: WorkbenchContextMenuState;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!state) {
      return undefined;
    }

    function closeMenu() {
      onClose();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [onClose, state]);

  if (!state) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  const menuWidth = 164;
  const menuHeight = Math.max(40, state.items.length * 32 + 10);
  const viewportWidth = window.innerWidth || menuWidth;
  const viewportHeight = window.innerHeight || menuHeight;
  const left = Math.min(Math.max(8, state.x), Math.max(8, viewportWidth - menuWidth - 8));
  const top = Math.min(Math.max(8, state.y), Math.max(8, viewportHeight - menuHeight - 8));

  return createPortal(
    <div
      className="workbench-context-menu"
      role="menu"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {state.items.map((item) => (
        <button
          disabled={item.disabled}
          key={item.label}
          onClick={(event) => {
            event.stopPropagation();
            if (item.disabled) {
              return;
            }
            item.onSelect();
            onClose();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function FlowWorkbench({
  canRun,
  canvasTool,
  credentialStatus,
  currentCombination,
  isCanvasMaximized,
  latestTask,
  modelId,
  modelSize,
  outputCount,
  promptSummaryText,
  results,
  selectedFlowNode,
  selectedGarments,
  selectedPerson,
  validationResult,
  resetRevision,
  zoom,
  onCanvasToolChange,
  onCanvasMaximizeToggle,
  onNodeSelect,
  onRun,
  onZoomChange,
}: {
  canRun: boolean;
  canvasTool: CanvasTool;
  credentialStatus: ProviderCredentialStatus | null;
  currentCombination: ImageCombination | null;
  isCanvasMaximized: boolean;
  latestTask: GenerationTaskDetail | null;
  modelId: string;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptSummaryText: string;
  results: GenerationTaskResultAsset[];
  selectedFlowNode: FlowNodeId;
  selectedGarments: AssetFileView[];
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
  resetRevision: number;
  zoom: number;
  onCanvasToolChange: (tool: CanvasTool) => void;
  onCanvasMaximizeToggle: () => void;
  onNodeSelect: (nodeId: FlowNodeId) => void;
  onRun: () => void;
  onZoomChange: (zoom: number) => void;
}) {
  const [nodePositions, setNodePositions] = useState<Record<FlowNodeId, FlowNodePosition>>(
    cloneInitialWorkflowNodePositions,
  );
  const [nodeSizes, setNodeSizes] = useState<Record<FlowNodeId, FlowNodeSize>>(
    cloneInitialWorkflowNodeSizes,
  );
  const [viewport, setViewport] = useState<Viewport>(REACT_FLOW_DEFAULT_VIEWPORT);
  const [flowInstanceRevision, setFlowInstanceRevision] = useState(0);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isGridVisible, setIsGridVisible] = useState(true);
  const [contextMenu, setContextMenu] = useState<WorkbenchContextMenuState>(null);
  const canvasShellRef = useRef<HTMLElement | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<WorkflowReactFlowNode, WorkflowReactFlowEdge> | null>(
    null,
  );
  const taskStatus = getGenerationTaskStatusLabel(latestTask?.task.status);
  const modelReady = credentialStatus?.configured === true;
  const isCanvasPanMode = canvasTool === "hand" || isSpacePanning;
  const nodeEditEnabled = canvasTool === "select" && !isSpacePanning;
  const nodeMoveEnabled = !isSpacePanning;
  const nodeResizeEnabled = nodeEditEnabled;
  const nodeSelectionEnabled = nodeEditEnabled;
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
  const flowNodeRenderQualityStyle = useMemo(
    () => buildFlowNodeRenderQualityStyle(zoom) as CSSProperties,
    [zoom],
  );

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
    setNodeSizes(cloneInitialWorkflowNodeSizes());
    setViewport(REACT_FLOW_DEFAULT_VIEWPORT);
    setFlowInstanceRevision((revision) => revision + 1);
  }, [resetRevision]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || isEditableKeyTarget(event.target)) {
        return;
      }
      event.preventDefault();
      setIsSpacePanning(true);
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        setIsSpacePanning(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const canvasShell = canvasShellRef.current;
    if (!canvasShell) {
      return undefined;
    }
    const observedCanvasShell = canvasShell;

    function updateCanvasReadiness() {
      const rect = observedCanvasShell.getBoundingClientRect();
      setIsCanvasReady(rect.width > 0 && rect.height > 0);
    }

    updateCanvasReadiness();
    const resizeObserver = new ResizeObserver(updateCanvasReadiness);
    resizeObserver.observe(observedCanvasShell);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const baseFlowNodes = useMemo<WorkflowReactFlowNode[]>(
    () => [
      createWorkflowNode({
        accent: "green",
        body: selectedPerson ? (
          <>
            <AssetCanvasImage
              asset={selectedPerson}
              className="flow-node__hero-image"
              alt={selectedPerson.asset.originalName}
            />
            <small>{selectedPerson.asset.originalName}</small>
            <strong>{formatDimensions(selectedPerson.asset.width, selectedPerson.asset.height)}</strong>
          </>
        ) : (
          <NodeEmpty icon={<UserRound size={24} />} text="导入人物图" />
        ),
        canResize: nodeResizeEnabled,
        nodeId: "person",
        position: nodePositions.person,
        selected: selectedFlowNode === "person",
        size: nodeSizes.person,
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
                <AssetCanvasImage
                  asset={asset}
                  alt={asset.asset.originalName}
                  key={asset.asset.id}
                />
              ))}
            </div>
            <span className="flow-node__count">{selectedGarments.length} 张</span>
          </>
        ) : (
          <NodeEmpty icon={<BriefcaseBusiness size={24} />} text="导入服装图" />
        ),
        canResize: nodeResizeEnabled,
        nodeId: "garments",
        position: nodePositions.garments,
        selected: selectedFlowNode === "garments",
        size: nodeSizes.garments,
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
            <span>输出方案</span>
            </div>
            <strong>{promptSummaryText || "未选择方案"}</strong>
          </>
        ),
        canResize: nodeResizeEnabled,
        nodeId: "prompt",
        position: nodePositions.prompt,
        selected: selectedFlowNode === "prompt",
        size: nodeSizes.prompt,
        status: promptSummaryText ? "done" : "required",
        subtitle: promptSummaryText ? "已配置" : "未配置",
        title: "输出方案",
      }),
      createWorkflowNode({
        accent: "orange",
        body: (
          <>
            <div className="flow-node__model">
              <Box size={44} />
            </div>
            <strong>{modelId}</strong>
            <small>
              {modelSize} / {outputCount} 张
            </small>
          </>
        ),
        canResize: nodeResizeEnabled,
        nodeId: "model",
        position: nodePositions.model,
        selected: selectedFlowNode === "model",
        size: nodeSizes.model,
        status: modelReady ? "done" : "pending",
        subtitle: modelReady ? "已选择" : "待配置",
        title: "模型",
      }),
      createWorkflowNode({
        accent: "blue",
        body: (
          <>
            <Button
              className="flow-node__play nodrag nopan"
              disabled={!canRun}
              onClick={(event) => {
                event.stopPropagation();
                onRun();
              }}
              type="button"
            >
              <Play size={30} fill="currentColor" />
            </Button>
            <small>{canRun ? "点击执行生成" : "输入未完整"}</small>
          </>
        ),
        canResize: nodeResizeEnabled,
        nodeId: "execute",
        position: nodePositions.execute,
        selected: selectedFlowNode === "execute",
        size: nodeSizes.execute,
        status: validationResult?.executable ? "done" : "required",
        subtitle: canRun ? "就绪" : "待补齐",
        title: "执行",
      }),
      createWorkflowNode({
        accent: "gray",
        body: results.length ? (
          <div className="flow-node__image-grid flow-node__image-grid--results">
            {results.slice(0, 4).map((result) => (
              <img alt="生成结果" key={result.id} src={convertFileSrc(result.filePath)} />
            ))}
          </div>
        ) : (
          <NodeEmpty icon={<ImageIcon size={28} />} text={`将生成 ${outputCount} 张图片`} />
        ),
        canResize: nodeResizeEnabled,
        nodeId: "result",
        position: nodePositions.result,
        selected: selectedFlowNode === "result",
        size: nodeSizes.result,
        status: results.length ? "done" : "pending",
        subtitle: taskStatus,
        title: "结果",
      }),
    ],
    [
      canRun,
      nodeResizeEnabled,
      modelId,
      modelReady,
      modelSize,
      nodePositions,
      nodeSizes,
      onRun,
      outputCount,
      promptSummaryText,
      results,
      selectedFlowNode,
      selectedGarments,
      selectedPerson,
      taskStatus,
      validationResult?.executable,
    ],
  );
  const [flowNodes, setFlowNodes] = useState<WorkflowReactFlowNode[]>(baseFlowNodes);

  useEffect(() => {
    setFlowNodes((currentNodes) => mergeWorkflowNodes(currentNodes, baseFlowNodes));
  }, [baseFlowNodes]);

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowReactFlowNode>[]) => {
    const allowedChanges = changes.filter((change) => {
      if (change.type === "position") {
        return nodeMoveEnabled;
      }
      if (change.type === "dimensions") {
        return nodeResizeEnabled;
      }
      return true;
    });

    setFlowNodes((currentNodes) => applyNodeChanges(allowedChanges, currentNodes));
    setNodePositions((currentPositions) =>
      applyWorkflowNodePositionChanges(currentPositions, changes, {
        allowPositionChange: nodeMoveEnabled,
      }),
    );
    setNodeSizes((currentSizes) =>
      applyWorkflowNodeSizeChanges(currentSizes, changes, {
        allowSizeChange: nodeResizeEnabled,
      }),
    );
  }, [nodeMoveEnabled, nodeResizeEnabled]);

  const handleNodeClick = useCallback<NodeMouseHandler<WorkflowReactFlowNode>>(
    (_event, node) => {
      if (!nodeSelectionEnabled) {
        return;
      }
      if (isFlowNodeId(node.id)) {
        onNodeSelect(node.id);
      }
    },
    [nodeSelectionEnabled, onNodeSelect],
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

  function resetCanvasViewport() {
    setViewport(REACT_FLOW_DEFAULT_VIEWPORT);
    onZoomChange(REACT_FLOW_DEFAULT_VIEWPORT.zoom * 100);
  }

  function fitCanvasViewport() {
    reactFlowRef.current?.fitView({ padding: 0.16, duration: 120 });
  }

  function openCanvasContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "适配画布", onSelect: fitCanvasViewport },
        { label: "重置视图", onSelect: resetCanvasViewport },
        {
          label: isGridVisible ? "隐藏网格" : "显示网格",
          onSelect: () => setIsGridVisible((visible) => !visible),
        },
      ],
    });
  }

  return (
    <section
      ref={canvasShellRef}
      className={`canvas-shell canvas-shell--${isCanvasPanMode ? "hand" : "select"}${
        isGridVisible ? " is-grid-visible" : ""
      }`}
      style={flowNodeRenderQualityStyle}
    >
      <CanvasToolbar
        canvasTool={canvasTool}
        combinationName={currentCombination?.name ?? "未保存组合"}
        isFlowReady={validationResult?.executable === true}
        isCanvasMaximized={isCanvasMaximized}
        isGridVisible={isGridVisible}
        zoom={zoom}
        onCanvasToolChange={onCanvasToolChange}
        onCanvasMaximizeToggle={onCanvasMaximizeToggle}
        onGridVisibilityChange={setIsGridVisible}
        onZoomChange={onZoomChange}
      />
      {isCanvasReady ? (
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
            elementsSelectable={nodeSelectionEnabled}
            nodesDraggable={nodeMoveEnabled}
            nodesFocusable={nodeSelectionEnabled}
            panOnDrag={isCanvasPanMode}
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
            onContextMenu={openCanvasContextMenu}
            onMoveEnd={handleMoveEnd}
            onViewportChange={handleViewportChange}
          >
            <Background gap={18} size={1.4} color="#cbd5e1" />
            <MiniMap className="flow-minimap" pannable zoomable />
          </ReactFlow>
        </ReactFlowProvider>
      ) : (
        <div className="flow-canvas flow-canvas--pending" aria-hidden="true" />
      )}
      <WorkbenchContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
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
  combinationName,
  isFlowReady,
  isCanvasMaximized,
  isGridVisible,
  zoom,
  onCanvasMaximizeToggle,
  onCanvasToolChange,
  onGridVisibilityChange,
  onZoomChange,
}: {
  canvasTool: CanvasTool;
  combinationName: string;
  isFlowReady: boolean;
  isCanvasMaximized: boolean;
  isGridVisible: boolean;
  zoom: number;
  onCanvasMaximizeToggle: () => void;
  onCanvasToolChange: (tool: CanvasTool) => void;
  onGridVisibilityChange: (isVisible: boolean) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const zoomLabel = Math.round(zoom);
  const canvasMaximizeLabel = isCanvasMaximized ? "恢复画布布局" : "最大化画布";
  const [isFlowHelpOpen, setIsFlowHelpOpen] = useState(false);
  const flowHelpRef = useRef<HTMLDivElement>(null);
  const tools: Array<{ id: CanvasTool; icon: ReactNode; label: string }> = [
    { id: "select", icon: <MousePointer2 size={17} />, label: "选择节点" },
    { id: "hand", icon: <Hand size={17} />, label: "拖动画布" },
  ];

  useEffect(() => {
    if (!isFlowHelpOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && flowHelpRef.current?.contains(target)) {
        return;
      }
      setIsFlowHelpOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFlowHelpOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isFlowHelpOpen]);

  function updateZoom(nextZoom: number) {
    onZoomChange(clampZoom(nextZoom));
  }

  return (
    <div className="canvas-toolbar">
      <div className="tool-segment" role="group" aria-label="画布工具">
        {tools.map((tool) => (
          <Button
            aria-label={tool.label}
            className={canvasTool === tool.id ? "is-active" : ""}
            key={tool.id}
            onClick={() => onCanvasToolChange(tool.id)}
            title={tool.label}
            type="button"
          >
            {tool.icon}
          </Button>
        ))}
      </div>
      <div className="zoom-control" role="group" aria-label="缩放">
        <Button onClick={() => updateZoom(getPreviousZoomLevel(zoom))} type="button" aria-label="缩小">
          <Minus size={16} />
        </Button>
        <span>{zoomLabel}%</span>
        <Button onClick={() => updateZoom(getNextZoomLevel(zoom))} type="button" aria-label="放大">
          <Plus size={16} />
        </Button>
      </div>
      <Button
        aria-pressed={isCanvasMaximized}
        className={`canvas-icon${isCanvasMaximized ? " is-active" : ""}`}
        onClick={onCanvasMaximizeToggle}
        title={canvasMaximizeLabel}
        type="button"
        aria-label={canvasMaximizeLabel}
      >
        {isCanvasMaximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
      </Button>
      <Button
        aria-pressed={isGridVisible}
        aria-label={isGridVisible ? "隐藏网格" : "显示网格"}
        className={`canvas-icon${isGridVisible ? " is-active" : ""}`}
        onClick={() => onGridVisibilityChange(!isGridVisible)}
        title={isGridVisible ? "隐藏网格" : "显示网格"}
        type="button"
      >
        <Grid3X3 size={17} />
      </Button>
      <div className="flow-context" aria-label="当前流程状态">
        <span>{combinationName}</span>
        <strong>{isFlowReady ? "流程已就绪" : "待补充输入"}</strong>
      </div>
      <div className="flow-help-wrap" ref={flowHelpRef}>
        <Button
          aria-expanded={isFlowHelpOpen}
          className={`flow-help${isFlowHelpOpen ? " is-open" : ""}`}
          onClick={() => setIsFlowHelpOpen((value) => !value)}
          type="button"
        >
          <CircleAlert size={16} />
          流程说明
          <ChevronDown size={15} />
        </Button>
        {isFlowHelpOpen ? (
          <div className="flow-help-popover" role="dialog" aria-label="当前流程使用说明">
            <header>
              <strong>当前流程使用说明</strong>
              <span>固定 6 个节点 / 5 条连线</span>
            </header>
            <ol>
              <li>
                <b>人物图</b>
                <span>选择一张人物图片，作为试穿主体。</span>
              </li>
              <li>
                <b>服装图组</b>
                <span>至少选择一张服装图，可按资源库顺序调整多角度素材。</span>
              </li>
              <li>
                <b>输出方案</b>
                <span>选择输出方案，填写风格、背景、比例和追加描述。</span>
              </li>
              <li>
                <b>模型</b>
                <span>在设置中配置 Provider、模型、尺寸和生成数量。</span>
              </li>
              <li>
                <b>执行</b>
                <span>校验通过后点击执行生成，任务状态会在底部面板更新。</span>
              </li>
              <li>
                <b>结果</b>
                <span>生成完成后可在结果库预览、替换或复用图片。</span>
              </li>
            </ol>
            <p>选择工具用于选中、拖动和缩放节点；拖动画布工具用于平移画布。</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function createWorkflowNode({
  accent,
  body,
  canResize,
  nodeId,
  position,
  selected,
  size,
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
    style: {
      width: size.width,
      height: size.height,
    },
    data: {
      accent,
      body,
      canResize,
      nodeId,
      selected,
      size,
      status,
      subtitle,
      title,
    },
  };
}

function mergeWorkflowNodes(
  currentNodes: WorkflowReactFlowNode[],
  baseNodes: WorkflowReactFlowNode[],
) {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return baseNodes.map((baseNode) => {
    const currentNode = currentById.get(baseNode.id);
    return currentNode
      ? {
          ...currentNode,
          ...baseNode,
        }
      : baseNode;
  });
}

function FlowNode({ data, selected }: NodeProps<WorkflowReactFlowNode>) {
  const isSelected = selected || data.selected;

  return (
    <>
      <NodeResizer
        color="var(--node-border)"
        handleClassName="flow-node__resize-handle nodrag nopan"
        lineClassName="flow-node__resize-line nodrag nopan"
        isVisible={data.canResize}
        minWidth={WORKFLOW_NODE_MIN_SIZE.width}
        minHeight={WORKFLOW_NODE_MIN_SIZE.height}
      />
      <div
        className={`flow-node flow-node--${data.accent} ${isSelected ? "is-selected" : ""}`}
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
        <div className="flow-node__content">
          <div className="flow-node__header">
            <div>
              <strong>{data.title}</strong>
              <span>{data.subtitle}</span>
            </div>
            <StatusMark status={data.status} />
          </div>
          <div className="flow-node__body">{data.body}</div>
        </div>
      </div>
    </>
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

function isEditableKeyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
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
        <h1>配置图片、输出方案和模型后直接提交生成</h1>
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
        <Button className="upload-dropzone" onClick={onImport} type="button">
          <ImageIcon size={28} />
          <strong>选择本地图片</strong>
          <span>支持 PNG/JPG/JPEG，导入后会复制到工作区并生成缩略图。</span>
        </Button>
      )}
      <Button className="ghost-wide" disabled={isImporting} onClick={onImport} type="button">
        <Import size={15} />
        {isImporting ? "导入中" : actionLabel}
      </Button>
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
              <Button onClick={() => onRemove(asset.asset.id)} type="button" aria-label="移除服装">
                <X size={13} />
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <Button className="upload-dropzone" onClick={onImport} type="button">
          <BriefcaseBusiness size={28} />
          <strong>导入服装图</strong>
          <span>至少一张服装图才能保存组合并执行生成。</span>
        </Button>
      )}
      <Button className="ghost-wide" disabled={isImporting} onClick={onImport} type="button">
        <Import size={15} />
        {isImporting ? "导入中" : "添加服装图"}
      </Button>
    </section>
  );
}

function ModelSettingsCard({
  apiKeyDraft,
  credentialStatus,
  isSavingApiKey,
  modelId,
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
  modelId: string;
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
          <Input value={DEFAULT_PROVIDER} readOnly />
        </label>
        <label>
          模型
          <Input value={modelId} readOnly />
        </label>
        <label>
          尺寸
          <Select
            value={modelSize}
            onValueChange={(value) =>
              onModelSizeChange(value as (typeof MODEL_SIZES)[number])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_SIZES.map((size) => (
                <SelectItem key={size} value={size}>
                  {formatModelSizeLabel(size)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          生成数量
          <Input
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
        <Input
          value={apiKeyDraft}
          onChange={(event) => onApiKeyDraftChange(event.target.value)}
          placeholder="粘贴 OpenAI API Key"
          type="text"
        />
        <Button disabled={!apiKeyDraft.trim() || isSavingApiKey} onClick={onSaveApiKey} type="button">
          {isSavingApiKey ? "保存中" : "保存"}
        </Button>
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
          <p>保存组合后会创建输出方案绑定，并用当前模型参数提交任务。</p>
        )}
      </div>
    </div>
  );
}

function WorkbenchToasts({
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
    <div className={`workbench-toast ${actionError || loadingError ? "is-error" : "is-success"}`}>
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
      <Button
        className="panel-restore__button"
        onClick={onClick}
        title={label}
        type="button"
        aria-label={label}
      >
        {side === "left" ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        <span>{label.replace("展开", "")}</span>
      </Button>
    </aside>
  );
}

function InspectorPanel({
  apiKeyDraft,
  credentialStatus,
  currentCombination,
  latestTask,
  mode,
  modelId,
  modelProvider,
  modelSize,
  outputCount,
  promptPresetOptions,
  promptSummaryText,
  promptTemplates,
  promptWorkbench,
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
  onOpenResultError,
  onPromptWorkbenchChange,
  onSaveApiKey,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
  mode: SidePanelMode;
  modelId: string;
  modelProvider: string;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptPresetOptions: PromptPresetOption[];
  promptSummaryText: string;
  promptTemplates: PromptTemplate[];
  promptWorkbench: PromptWorkbenchState;
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
  onOpenResultError: (message: string) => void;
  onPromptWorkbenchChange: (value: PromptWorkbenchState) => void;
  onSaveApiKey: () => void;
}) {
  const nodeLabel = getFlowNodeLabel(selectedFlowNode);
  const panelModes = getInspectorPanelModes(selectedFlowNode);
  const activeMode = normalizeInspectorPanelMode(selectedFlowNode, mode);
  return (
    <aside className="property-panel">
      <div className="property-panel__header">
        <div>
          <h2>属性面板</h2>
          <p>
            当前选择： <strong>{nodeLabel}</strong>
          </p>
        </div>
        <Button
          className="panel-collapse-button"
          onClick={onCollapse}
          title="折叠属性面板"
          type="button"
          aria-label="折叠属性面板"
        >
          <ChevronLeft size={18} />
        </Button>
      </div>
      <div className="tabs">
        {panelModes.map((panelMode) => (
          <Button
            className={activeMode === panelMode ? "is-active" : ""}
            key={panelMode}
            onClick={() => onModeChange(panelMode)}
            type="button"
          >
            {panelMode === "details" ? "详情" : "编辑"}
          </Button>
        ))}
      </div>
      {activeMode === "details" ? (
        <NodeDetails
          currentCombination={currentCombination}
          latestTask={latestTask}
          modelId={modelId}
          modelProvider={modelProvider}
          modelSize={modelSize}
          outputCount={outputCount}
          promptSummaryText={promptSummaryText}
          promptWorkbench={promptWorkbench}
          results={results}
          selectedFlowNode={selectedFlowNode}
          selectedGarments={selectedGarments}
          selectedPerson={selectedPerson}
          validationResult={validationResult}
          onImport={onImport}
          onOpenResultError={onOpenResultError}
        />
      ) : null}
      {activeMode === "edit" ? (
        <NodeEditor
          apiKeyDraft={apiKeyDraft}
          credentialStatus={credentialStatus}
          modelId={modelId}
          modelSize={modelSize}
          outputCount={outputCount}
          promptPresetOptions={promptPresetOptions}
          promptTemplates={promptTemplates}
          promptWorkbench={promptWorkbench}
          selectedFlowNode={selectedFlowNode}
          onApiKeyDraftChange={onApiKeyDraftChange}
          onImport={onImport}
          onModelSizeChange={onModelSizeChange}
          onOutputCountChange={onOutputCountChange}
          onPromptWorkbenchChange={onPromptWorkbenchChange}
          onSaveApiKey={onSaveApiKey}
        />
      ) : null}
    </aside>
  );
}

function NodeDetails({
  currentCombination,
  latestTask,
  modelId,
  modelProvider,
  modelSize,
  outputCount,
  promptSummaryText,
  promptWorkbench,
  results,
  selectedFlowNode,
  selectedGarments,
  selectedPerson,
  validationResult,
  onImport,
  onOpenResultError,
}: {
  currentCombination: ImageCombination | null;
  latestTask: GenerationTaskDetail | null;
  modelId: string;
  modelProvider: string;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptSummaryText: string;
  promptWorkbench: PromptWorkbenchState;
  results: GenerationTaskResultAsset[];
  selectedFlowNode: FlowNodeId;
  selectedGarments: AssetFileView[];
  selectedPerson: AssetFileView | null;
  validationResult: ValidateCombinationResponse | null;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onOpenResultError: (message: string) => void;
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
        <h3>输出方案摘要</h3>
        <dl className="plain-dl">
          <dt>输出方案</dt>
          <dd>{promptSummaryText || "未选择方案"}</dd>
          <dt>生成风格</dt>
          <dd>{promptWorkbench.variables.style}</dd>
          <dt>背景</dt>
          <dd>{promptWorkbench.variables.background}</dd>
          <dt>画面比例</dt>
          <dd>{promptWorkbench.variables.aspectRatio}</dd>
          <dt>服装类别</dt>
          <dd>{promptWorkbench.variables.garmentCategory}</dd>
          <dt>状态</dt>
          <dd>{promptSummaryText ? "已配置" : "未配置"}</dd>
        </dl>
      </section>
    );
  }

  if (selectedFlowNode === "model") {
    return (
      <section className="detail-block">
        <h3>模型配置</h3>
        <dl className="plain-dl">
          <dt>Provider</dt>
          <dd>{modelProvider}</dd>
          <dt>模型</dt>
          <dd>{modelId}</dd>
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
            <Button
              key={result.id}
              onClick={() => {
                openGenerationResult(result.assetId).catch((error) => {
                  onOpenResultError(error instanceof Error ? error.message : "打开结果失败");
                });
              }}
              type="button"
            >
              <img alt="生成结果" src={convertFileSrc(result.thumbFilePath)} />
            </Button>
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
  modelId,
  modelSize,
  outputCount,
  promptPresetOptions,
  promptTemplates,
  promptWorkbench,
  selectedFlowNode,
  onApiKeyDraftChange,
  onImport,
  onModelSizeChange,
  onOutputCountChange,
  onPromptWorkbenchChange,
  onSaveApiKey,
}: {
  apiKeyDraft: string;
  credentialStatus: ProviderCredentialStatus | null;
  modelId: string;
  modelSize: (typeof MODEL_SIZES)[number];
  outputCount: number;
  promptPresetOptions: PromptPresetOption[];
  promptTemplates: PromptTemplate[];
  promptWorkbench: PromptWorkbenchState;
  selectedFlowNode: FlowNodeId;
  onApiKeyDraftChange: (value: string) => void;
  onImport: (assetType: Extract<AssetType, "person" | "garment">) => void;
  onModelSizeChange: (value: (typeof MODEL_SIZES)[number]) => void;
  onOutputCountChange: (value: number) => void;
  onPromptWorkbenchChange: (value: PromptWorkbenchState) => void;
  onSaveApiKey: () => void;
}) {
  if (selectedFlowNode === "person" || selectedFlowNode === "garments") {
    const assetType = selectedFlowNode === "person" ? "person" : "garment";
    return (
      <section className="detail-block">
        <h3>{selectedFlowNode === "person" ? "人物图片" : "服装图片"}</h3>
        <Button className="ghost-wide" onClick={() => onImport(assetType)} type="button">
          <Import size={15} />
          {selectedFlowNode === "person" ? "替换人物图" : "添加服装图"}
        </Button>
      </section>
    );
  }

  if (selectedFlowNode === "prompt") {
    return (
      <PromptWorkbenchEditor
        presetOptions={promptPresetOptions}
        templates={promptTemplates}
        value={promptWorkbench}
        onChange={onPromptWorkbenchChange}
      />
    );
  }

  if (selectedFlowNode === "model") {
    return (
      <>
        <section className="detail-block">
          <h3>模型参数</h3>
          <label>
            模型
            <Input value={modelId} readOnly />
          </label>
          <label>
            尺寸
            <Select
              value={modelSize}
              onValueChange={(value) =>
                onModelSizeChange(value as (typeof MODEL_SIZES)[number])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {formatModelSizeLabel(size)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            生成数量
            <Input
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

function PromptWorkbenchEditor({
  presetOptions,
  templates,
  value,
  onChange,
}: {
  presetOptions: PromptPresetOption[];
  templates: PromptTemplate[];
  value: PromptWorkbenchState;
  onChange: (value: PromptWorkbenchState) => void;
}) {
  const selectedPreset = findPromptPresetOption(presetOptions, value.presetId);
  const binding = buildPromptBindingFromWorkbench({
    combinationId: "draft",
    preset: selectedPreset,
    variables: value.variables,
    additionalInstructions: value.additionalInstructions,
    advanced: value.advanced,
  });
  const advanced = value.advanced ?? {
    system: binding.system,
    user: binding.user,
    negative: binding.negative ?? null,
  };
  const userTemplates = templates.filter((template) => template.templateType === "user");
  const negativeTemplates = templates.filter((template) => template.templateType === "negative");
  const activeVariables = buildPromptPresetVariablesForSections({
    fallbackVariables: selectedPreset?.variableDefinitions ?? [],
    sections: [advanced.system, advanced.user, advanced.negative],
    templates,
    existingVariables: promptWorkbenchVariablesToTemplateVariables(value.variables),
  });

  function updateVariable(key: string, nextValue: string) {
    onChange({
      ...value,
      variables: {
        ...value.variables,
        [key]: nextValue,
      } as PromptWorkbenchVariables,
    });
  }

  function renderVariableControl(variable: PromptTemplateVariable) {
    const currentValue =
      value.variables[variable.name] ??
      buildPromptVariablePreviewValue(variable) ??
      "";
    if (variable.controlType === "select") {
      return (
        <Select
          disabled={!variable.options?.length}
          value={currentValue}
          onValueChange={(nextValue) => updateVariable(variable.name, nextValue)}
        >
          <SelectTrigger className="prompt-workbench-variable-control">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(variable.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (variable.controlType === "combobox") {
      return (
        <PromptVariableComboboxInput
          options={variable.options ?? []}
          value={currentValue}
          onChange={(nextValue) => updateVariable(variable.name, nextValue)}
          placeholder={`输入${getPromptVariableDisplayLabel(variable)}`}
        />
      );
    }
    return (
      <Input
        value={currentValue}
        onChange={(event) => updateVariable(variable.name, event.target.value)}
        placeholder={`输入${getPromptVariableDisplayLabel(variable)}`}
      />
    );
  }

  function updateAdvancedSection(
    key: keyof AdvancedPromptSections,
    section: AdvancedPromptSections[keyof AdvancedPromptSections],
  ) {
    onChange({
      ...value,
      advanced: {
        ...advanced,
        [key]: section,
      },
    });
  }

  function buildTemplateOptions(templateOptions: PromptTemplate[]) {
    return templateOptions.map((template) => (
      <SelectItem key={template.id} value={template.id}>
        {getPromptTemplateDisplayName(template)}
        {template.source === "custom" ? "（自定义）" : ""}
      </SelectItem>
    ));
  }

  return (
    <section className="detail-block prompt-workbench-editor">
      <h3>输出方案配置</h3>
      <label>
        输出方案
        <Select
          value={selectedPreset?.id ?? ""}
          onValueChange={(nextPresetId) => {
            const nextPreset = findPromptPresetOption(presetOptions, nextPresetId);
            onChange({
              ...value,
              presetId: nextPresetId,
              variables: nextPreset?.variables ?? value.variables,
              advanced: null,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择输出方案" />
          </SelectTrigger>
          <SelectContent>
            {presetOptions.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
                {preset.source === "custom" ? "（自定义）" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="prompt-workbench-grid">
        {activeVariables.map((variable) => (
          <label key={variable.name}>
            {getPromptVariableDisplayLabel(variable)}
            {renderVariableControl(variable)}
          </label>
        ))}
      </div>
      <div className="prompt-workbench-actions">
        <Button
          className="ghost-wide"
          onClick={() => onChange(buildPromptWorkbenchDefaultsForPreset(selectedPreset))}
          type="button"
        >
          <RefreshCw size={15} />
          恢复默认
        </Button>
      </div>
      <details className="prompt-workbench-fold">
        <summary>追加描述</summary>
        <PromptAdvancedSectionEditor
          label="细节描述"
          section={advanced.user}
          templates={userTemplates}
          onChange={(section) => updateAdvancedSection("user", section)}
        >
          {buildTemplateOptions(userTemplates)}
        </PromptAdvancedSectionEditor>
        <PromptAdvancedSectionEditor
          label="避坑描述"
          section={advanced.negative}
          templates={negativeTemplates}
          onChange={(section) => updateAdvancedSection("negative", section)}
        >
          <SelectItem value="__none">不使用避坑描述</SelectItem>
          {buildTemplateOptions(negativeTemplates)}
        </PromptAdvancedSectionEditor>
      </details>
      <details className="prompt-workbench-fold">
        <summary>最终输出预览</summary>
        <div className="prompt-preview-stack">
          <PromptPreviewBlock
            title="系统规则"
            text={renderPromptSectionPreview(binding.system, templates, value.variables)}
            tone="system"
          />
          <PromptPreviewBlock
            title="细节描述"
            text={renderPromptSectionPreview(binding.user, templates, value.variables)}
            tone="user"
          />
          {binding.negative ? (
            <PromptPreviewBlock
              title="避坑描述"
              text={renderPromptSectionPreview(binding.negative, templates, value.variables)}
              tone="negative"
            />
          ) : null}
        </div>
      </details>
    </section>
  );
}

function PromptAdvancedSectionEditor({
  children,
  label,
  section,
  templates,
  onChange,
}: {
  children: ReactNode;
  label: string;
  section: PromptBindingSection | null;
  templates: PromptTemplate[];
  onChange: (section: PromptBindingSection | null) => void;
}) {
  const nextSection = section ?? {
    mode: "default" as PromptMode,
    baseTemplateId: templates[0]?.id ?? null,
    appendText: "",
    overrideText: "",
  };
  const isNegativeSection = label === "避坑描述";
  const templateValue = section?.baseTemplateId ?? (isNegativeSection ? "__none" : templates[0]?.id ?? "");
  const isCustomTextVisible = nextSection.mode === "append" || nextSection.mode === "override";
  const customTextValue =
    nextSection.mode === "override" ? nextSection.overrideText : nextSection.appendText;
  const customTextPlaceholder =
    nextSection.mode === "override"
      ? `输入${label}的替换内容`
      : `输入要追加到${label}中的内容`;

  return (
    <div className="prompt-advanced-row">
      <strong>{label}</strong>
      <div className="prompt-advanced-row__controls">
        <Select
          value={templateValue}
          onValueChange={(value) => {
            if (value === "__none") {
              onChange(null);
              return;
            }
            onChange({
              ...nextSection,
              baseTemplateId: value,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择模板" />
          </SelectTrigger>
          <SelectContent>{children}</SelectContent>
        </Select>
        <Select
          value={nextSection.mode}
          onValueChange={(value) =>
            onChange({
              ...nextSection,
              mode: value as PromptMode,
            })
          }
          disabled={!section && isNegativeSection}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">默认</SelectItem>
            <SelectItem value="append">追加</SelectItem>
            <SelectItem value="override">替换</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isCustomTextVisible ? (
        <Textarea
          rows={3}
          value={customTextValue}
          onChange={(event) =>
            onChange({
              ...nextSection,
              appendText: nextSection.mode === "append" ? event.target.value : nextSection.appendText,
              overrideText:
                nextSection.mode === "override" ? event.target.value : nextSection.overrideText,
            })
          }
          placeholder={customTextPlaceholder}
        />
      ) : null}
    </div>
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
      <Button className="ghost-wide" onClick={onImport} type="button">
        <RefreshCw size={15} />
        {asset ? "替换图片" : "导入图片"}
      </Button>
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
      <Button className="ghost-wide" onClick={onImport} type="button">
        <Import size={15} />
        导入服装图片
      </Button>
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
        <p className="panel-note">校验通过后，执行会先保存组合和输出方案，再提交生成任务。</p>
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
        <Input
          value={apiKeyDraft}
          onChange={(event) => onApiKeyDraftChange(event.target.value)}
          placeholder="OpenAI API Key"
          type="text"
        />
        <Button disabled={!apiKeyDraft.trim()} onClick={onSaveApiKey} type="button">
          保存 API Key
        </Button>
      </div>
    </section>
  );
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

function getTaskCombinationName(detail: GenerationTaskDetail) {
  const value = detail.task.inputSnapshotJson.combinationName;
  return typeof value === "string" && value.trim() ? value : "未命名组合";
}

function getTaskHistoryDatePresetLabel(preset: TaskHistoryDatePreset) {
  switch (preset) {
    case "today":
      return "今天";
    case "7d":
      return "近 7 天";
    case "30d":
      return "近 30 天";
    default:
      return "全部日期";
  }
}

function formatTaskDuration(startedAt: string | null | undefined, finishedAt: string | null | undefined) {
  if (!startedAt || !finishedAt) {
    return "--";
  }
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(finish) || finish < start) {
    return "--";
  }
  const seconds = Math.round((finish - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatJsonForDisplay(value: unknown) {
  if (!value) {
    return "--";
  }
  return JSON.stringify(value, null, 2);
}

function formatStorageSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[unitIndex]}`;
}

function buildCacheRingStyle(stats: CacheStats) {
  const total = Math.max(1, stats.totalBytes);
  const thumbnail = Math.round((stats.thumbnailCacheBytes / total) * 100);
  const temporary = Math.round((stats.temporaryFilesBytes / total) * 100);
  const model = Math.round((stats.modelResponseCacheBytes / total) * 100);
  return {
    "--cache-thumb": `${thumbnail}%`,
    "--cache-temp": `${thumbnail + temporary}%`,
    "--cache-model": `${thumbnail + temporary + model}%`,
  } as CSSProperties;
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
      return "输出方案节点";
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

function StatusBar({
  workspaceRoot,
  onOpenWorkspace,
}: {
  workspaceRoot: string;
  onOpenWorkspace: () => void;
}) {
  return (
    <footer className="status-bar">
      <span className="status-bar__workspace">
        工作区：{workspaceRoot || "本地 Commerce Shoot Studio 工作区"}
        <button
          aria-label="打开工作区目录"
          className="status-bar__folder-button"
          onClick={onOpenWorkspace}
          title="打开工作区目录"
          type="button"
        >
          <FolderOpen size={15} />
        </button>
      </span>
      <div className="status-bar__right">
        <span className="service-dot" />
        本地服务运行中
        <b>v1.0.0</b>
      </div>
    </footer>
  );
}
