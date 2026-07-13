import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { App, createSceneRetryTaskInput } from "./App";
import { selectProductImages } from "../features/generation/lib/productImagePicker";
import { PreviewCanvas } from "../features/generation/components/PreviewCanvas";
import { GenerationHistoryPopover } from "../features/history/components/GenerationHistoryPopover";
import { sceneTemplates } from "../features/scenes/lib/sceneImagePlan";
import { ToastProvider } from "../shared/ui/toast";
import type { ModelImageSizeOptions } from "../runtime";

type TauriEventHandler = (event: { payload: unknown }) => void;

it("keeps task polling alive beyond the longest provider timeout", async () => {
  const appModule = await import("./App");
  const pollingWindow = (appModule as unknown as Record<string, unknown>)[
    "productGenerationMaxUnchangedDurationMs"
  ];

  expect(pollingWindow).toBe(360_000);
  expect(pollingWindow).toBeGreaterThan(300_000);
});

it("inherits the complete frozen scene contract for a single-image retry", () => {
  const input = createSceneRetryTaskInput(
    {
      campaignStyleLock: "统一暖白色板",
      conversionDriver: "pain-point",
      generationPromptVersion: "v7",
      outputMode: "detail-pack",
      planningPromptVersion: "v10",
      ratio: "9:16",
      templateCatalogVersion: "v5",
    },
    { imageId: "scene-d3", imageNo: 3, prompt: "机制解释", sortOrder: 2 },
    { imageNo: 3, parentTaskId: "task-parent", retrySequence: 2, targetImageId: "scene-d3" },
  );

  expect(input).toMatchObject({
    conversionDriver: "pain-point",
    generationPromptVersion: "v7",
    outputMode: "detail-pack",
    planningPromptVersion: "v10",
    ratio: "9:16",
    templateCatalogVersion: "v5",
  });
  expect(input.items).toEqual([
    expect.objectContaining({ imageId: "scene-d3", imageNo: 3, sortOrder: 0 }),
  ]);
});

const tauriEventMock = vi.hoisted(() => {
  const listeners = new Map<string, TauriEventHandler>();
  return {
    listeners,
    listen: vi.fn(async (eventName: string, handler: TauriEventHandler) => {
      listeners.set(eventName, handler);
      return vi.fn(() => listeners.delete(eventName));
    }),
  };
});

vi.mock("../features/generation/lib/productImagePicker", () => ({
  selectProductImages: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriEventMock.listen,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const selectProductImagesMock = vi.mocked(selectProductImages);
const invokeMock = vi.mocked(invoke);
const saveMock = vi.mocked(save);
const aiWritingSuggestionPattern = /产品名称：黑色休闲翻领长袖衬衫/;
const aiWritingDisclaimerAcceptedStorageKey = "commerce-shoot-studio.ai-writing-disclaimer.accepted.v1";

const sceneVisualFullPackFixture = [
  ["H1", "hero-image", "首屏主视觉", "一眼可懂的视觉主张"],
  ["H2", "flat-lay", "核心功能或质感特写", "核心功能或质感特写"],
  ["H3", "storefront", "典型使用场景", "典型使用场景匹配"],
  ["H4", "before-after", "可观察对比", "普通方案与升级方案的可观察对比"],
  ["H5", "seasonal-campaign", "行动引导", "仅使用已有证据的优惠、保障或行动引导"],
  ["D1", "poster-banner", "详情页首屏", "承接主图卖点并说明适用对象与核心问题"],
  ["D2", "ugc-style", "痛点放大", "放大用户当前的不便、损失或风险"],
  ["D3", "exploded-view", "机制解释", "用可视结构解释产品如何发挥作用"],
  ["D4", "infographic", "核心利益", "把二至四个可证实的核心利益做成易扫读内容"],
  ["D5", "size-spec", "使用步骤", "用三至四步降低使用或测量理解成本"],
  ["D6", "lifestyle-scene", "场景覆盖", "覆盖典型使用场景、适用对象或状态"],
  ["D7", "multi-angle-grid", "对比选择", "对比普通方案与本产品的可观察差异"],
  ["D8", "detail-macro", "信任背书", "用材料、工艺、包装或保障等已有证据建立信任"],
  ["D9", "social-media", "FAQ / 风险逆转 / CTA", "回答残留疑虑并给出风险逆转或行动引导"],
] as const;

const appTestProviderProfiles = [
  {
    baseUrl: "mock://local",
    customEnabled: false,
    displayName: "Mock Local",
    providerLabel: "Mock Local",
    id: "mock-local",
    protocol: "openai-compatible",
    supportedCapabilities: [
      "listing-copy",
      "prompt-plan",
      "product-selling-points",
      "clothing-scene-planning",
      "scene-prompt-planning",
      "viral-style-analysis",
      "scene-image-generation",
      "product-detail-generation",
      "clothing-base-model-generation",
      "clothing-tryon-generation",
      "image-edit",
    ],
    supportedCategories: ["text-to-text", "image-to-text", "text-to-image", "image-to-image"],
  },
  {
    baseUrl: "https://api.openai.com/v1",
    customEnabled: false,
    defaultEndpointPath: "/responses",
    displayName: "OpenAI",
    providerLabel: "OpenAI",
    id: "openai",
    protocol: "openai",
    supportedCapabilities: [
      "listing-copy",
      "prompt-plan",
      "product-selling-points",
      "clothing-scene-planning",
      "scene-prompt-planning",
      "viral-style-analysis",
      "scene-image-generation",
      "product-detail-generation",
      "clothing-base-model-generation",
      "clothing-tryon-generation",
      "image-edit",
    ],
    supportedCategories: ["text-to-text", "image-to-text", "text-to-image", "image-to-image"],
  },
  {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    customEnabled: false,
    defaultEndpointPath: "/responses",
    displayName: "火山引擎",
    providerLabel: "火山引擎",
    id: "volcengine",
    protocol: "openai-compatible",
    supportedCapabilities: [
      "listing-copy",
      "prompt-plan",
      "product-selling-points",
      "clothing-scene-planning",
      "scene-prompt-planning",
      "viral-style-analysis",
      "scene-image-generation",
      "product-detail-generation",
      "clothing-base-model-generation",
      "clothing-tryon-generation",
      "image-edit",
    ],
    supportedCategories: ["text-to-text", "image-to-text", "text-to-image", "image-to-image"],
  },
  {
    baseUrl: "https://api.deepseek.com/v1",
    customEnabled: false,
    defaultEndpointPath: "/chat/completions",
    displayName: "DeepSeek",
    providerLabel: "DeepSeek",
    id: "deepseek",
    protocol: "openai-compatible",
    supportedCapabilities: ["listing-copy", "prompt-plan", "viral-style-analysis"],
    supportedCategories: ["text-to-text"],
  },
];

function appTestModelConfig(
  capabilityId: string,
  displayName: string,
  model: string,
  baseUrl: string,
  endpointPath?: string,
) {
  return {
    baseUrl,
    capabilityId,
    connectionStatus: "available",
    displayName,
    enabled: true,
    endpointPath,
    executionMode: "auto",
    id: `cfg_${capabilityId}`,
    isDefault: true,
    model,
    protocol: "openai",
    providerLabel: "OpenAI",
    providerProfileId: "openai",
    secretStatus: {
      configured: true,
      storage: "sqlite-local",
    },
  };
}

const appTestModelConfigs = [
  appTestModelConfig("listing-copy", "OpenAI 文生文", "gpt-5.5", "https://api.openai.com/v1", "/responses"),
  appTestModelConfig("prompt-plan", "OpenAI 场景描述", "gpt-5.5", "https://api.openai.com/v1", "/responses"),
  appTestModelConfig("product-selling-points", "OpenAI 商品卖点提取", "gpt-5.5", "https://api.openai.com/v1", "/responses"),
  appTestModelConfig("clothing-scene-planning", "OpenAI 服饰场景规划", "gpt-5.5", "https://api.openai.com/v1", "/responses"),
  appTestModelConfig("scene-prompt-planning", "OpenAI 场景图片规划", "gpt-5.5", "https://api.openai.com/v1", "/responses"),
  appTestModelConfig("scene-image-generation", "OpenAI 文生图", "gpt-image-2", "https://api.openai.com/v1/images"),
  appTestModelConfig("clothing-base-model-generation", "OpenAI 服饰基准模特", "gpt-image-2", "https://api.openai.com/v1/images"),
  appTestModelConfig("clothing-tryon-generation", "OpenAI 图生图", "gpt-image-2", "https://api.openai.com/v1/images"),
  appTestModelConfig("image-edit", "OpenAI 图片编辑", "gpt-image-1", "https://api.openai.com/v1/images"),
  appTestModelConfig("viral-style-analysis", "OpenAI 文生文", "gpt-5.5", "https://api.openai.com/v1", "/responses"),
];

const audioContextInstances: MockAudioContext[] = [];
const audioSources: string[] = [];
const audioPlayMock = vi.fn(() => Promise.resolve());

function renderApp() {
  return render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

function installBuiltinClothingModelMock() {
  const defaultInvoke = invokeMock.getMockImplementation();
  invokeMock.mockImplementation((command, args) => {
    if (command === "asset_list_builtin_models") {
      return Promise.resolve([
        {
          fileName: "model-01.png",
          id: "model-01",
          label: "内置模特 01",
          path: "/app/resources/builtin-models/model-01.png",
          thumbnailPath: "/app/resources/builtin-model-thumbnails/model-01.png",
        },
      ]);
    }
    return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
  });
}

function createClothingPlanningTaskDetail(taskId: string, scene: string) {
  return {
    events: [],
    inputAssets: [],
    output: {
      modelFeatures: {
        ageRange: "青年",
        body: "匀称修长",
        ethnicityAppearance: "东亚面孔",
        face: "清晰的五官轮廓",
        gender: "女性化气质",
        hair: "自然长发",
        identityAnchor: ["脸部轮廓", "自然长发", "匀称身形"],
        overallStyle: "简约时尚",
        skinTone: "自然暖肤色",
      },
      scenes: [
        {
          recommendedPoses: [
            {
              cameraSetup: { framing: "全身", perspective: "正面", shootingPosition: "平视机位" },
              poseAction: `${scene}站姿`,
            },
          ],
          scene,
          scenePromptSegment: `${scene}商业服饰摄影`,
          sceneVisualAnchor: `${scene}视觉锚点`,
        },
      ],
    },
    outputAssets: [],
    task: {
      id: taskId,
      kind: "image-generation",
      stage: "completed",
      status: "succeeded",
    },
  };
}

function createRestoredClothingTaskDetail(taskId: string, title: string) {
  return {
    events: [],
    input: {
      items: [
        {
          id: `${taskId}-item-1`,
          poseAction: "自然站立展示服装版型",
          ratio: "3:4",
          scene: "都市街头",
        },
      ],
      kind: "clothing-tryon-generation",
      ratio: "3:4",
    },
    inputAssets: [],
    outputAssets: [
      {
        asset: {
          id: `${taskId}-output-1`,
          localPath: `/workspace/current/assets/generated/${taskId}.png`,
          relativePath: `assets/generated/${taskId}.png`,
        },
        role: "output",
        sortOrder: 0,
      },
    ],
    task: {
      completedAt: "2026-07-02T10:50:00.000Z",
      createdAt: "2026-07-02T10:49:00.000Z",
      id: taskId,
      kind: "image-generation",
      stage: "completed",
      status: "succeeded",
      title,
      updatedAt: "2026-07-02T10:50:00.000Z",
      workspace: "clothing",
    },
  };
}

class MockAudioParam {
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class MockAudioNode {
  connect = vi.fn(() => this);
}

class MockOscillatorNode extends MockAudioNode {
  frequency = new MockAudioParam();
  type: OscillatorType = "sine";
  start = vi.fn();
  stop = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockAudioContext {
  currentTime = 0;
  destination = new MockAudioNode();
  state: AudioContextState = "running";
  close = vi.fn();
  createGain = vi.fn(() => new MockGainNode());
  createOscillator = vi.fn(() => new MockOscillatorNode());
  resume = vi.fn(() => Promise.resolve());

  constructor() {
    audioContextInstances.push(this);
  }
}

class MockAudio {
  volume = 1;

  constructor(source: string) {
    audioSources.push(source);
  }

  play = audioPlayMock;
}

describe("App shell", () => {
  beforeEach(() => {
    ensureTestLocalStorage().removeItem(aiWritingDisclaimerAcceptedStorageKey);
    selectProductImagesMock.mockReset();
    invokeMock.mockReset();
    tauriEventMock.listeners.clear();
    tauriEventMock.listen.mockClear();
    invokeMock.mockImplementation((command, args) => {
      if (command === "runtime_info") {
        return Promise.resolve({
          features: {
            mode: "local",
            supportsDirectoryPicker: true,
            supportsLocalFileReveal: true,
            supportsLocalModelConfig: true,
            supportsSecretManagement: true,
            supportsSystemNotification: false,
            supportsWorkspaceSwitch: false,
          },
          mode: "local",
          version: "0.1.0-test",
        });
      }
      if (command === "model_config_list_provider_profiles") {
        return Promise.resolve(appTestProviderProfiles);
      }
      if (command === "model_config_list_configs") {
        return Promise.resolve(appTestModelConfigs);
      }
      if (command === "model_config_list_image_size_options") {
        return Promise.resolve({
          capabilityId: "image-edit",
          configId: "cfg_image-edit",
          model: "gpt-image-1",
          options: [
            {
              height: 1024,
              id: "1024x1024",
              label: "方图 1:1 · 1024×1024",
              providerValue: "1024x1024",
              ratio: "1:1",
              width: 1024,
            },
            {
              height: 1536,
              id: "1024x1536",
              label: "竖图 2:3 · 1024×1536",
              providerValue: "1024x1536",
              ratio: "2:3",
              width: 1024,
            },
          ],
          providerProfileId: "openai",
        });
      }
      if (command === "secret_reveal") {
        return Promise.resolve("sk-demo-text-1234");
      }
      if (command === "settings_get") {
        return Promise.resolve({
          autoCreateDateFolders: true,
          launchAtLogin: false,
          minimizeToTrayOnClose: false,
          notificationSound: "clear",
          outputDirectory: "/workspace/exports",
          restoreWorkspaceOnLaunch: true,
          retainGenerationHistory: true,
          showFailureNotifications: false,
          showSystemNotifications: false,
          showTaskDoneNotifications: false,
          workspaceDirectory: "/workspace/current",
        });
      }
      if (command === "settings_save") {
        const input = (args as { input?: Record<string, unknown> } | undefined)?.input ?? {};
        return Promise.resolve({
          autoCreateDateFolders: input.autoCreateDateFolders ?? true,
          launchAtLogin: input.launchAtLogin ?? false,
          minimizeToTrayOnClose: input.minimizeToTrayOnClose ?? false,
          notificationSound: input.notificationSound ?? "clear",
          outputDirectory: input.outputDirectory ?? "/workspace/exports",
          restoreWorkspaceOnLaunch: input.restoreWorkspaceOnLaunch ?? true,
          retainGenerationHistory: input.retainGenerationHistory ?? true,
          showFailureNotifications: input.showFailureNotifications ?? false,
          showSystemNotifications: input.showSystemNotifications ?? false,
          showTaskDoneNotifications: input.showTaskDoneNotifications ?? false,
          workspaceDirectory: input.workspaceDirectory ?? "/workspace/current",
        });
      }
      if (command === "workspace_get_storage_usage") {
        return Promise.resolve({
          assetBytes: 0,
          cacheBytes: 0,
          exportBytes: 0,
          logBytes: 0,
          totalBytes: 0,
        });
      }
      if (command === "workspace_run_garbage_collection") {
        return Promise.resolve({ deletedFiles: 0, reclaimedBytes: 0 });
      }
      if (command === "asset_list_builtin_models") {
        return Promise.resolve([]);
      }
      if (command === "asset_list") {
        return Promise.resolve({
          items: [],
          page: 1,
          pageSize: 100,
          total: 0,
        });
      }
      if (command === "asset_import_images") {
        const input = (args as { input?: { paths?: string[]; kind?: string } } | undefined)?.input;
        const paths = input?.paths ?? [];
        const kind = input?.kind ?? "source";
        return Promise.resolve(
          paths.map((path, index) => ({
            id: `asset_imported_${index + 1}`,
            kind,
            name: path.split(/[\\/]/).pop() ?? `source-${index + 1}.png`,
            originalName: path.split(/[\\/]/).pop() ?? `source-${index + 1}.png`,
            mimeType: "image/png",
            relativePath: `assets/${kind}/asset_imported_${index + 1}.png`,
            localPath: `/workspace/current/assets/${kind}/asset_imported_${index + 1}.png`,
            sha256: `sha256-${index + 1}`,
            sizeBytes: 128,
            lifecycle: "active",
            createdAt: "2026-07-02T00:00:00.000Z",
            updatedAt: "2026-07-02T00:00:00.000Z",
          })),
        );
      }
      if (command === "workspace_get_status") {
        return Promise.resolve({
          initialized: true,
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspaceDirectory: "/workspace/current",
        });
      }
      if (command === "generation_create_task") {
        const input = (args as { input?: { idempotencyKey?: string; input?: { kind?: string }; kind?: string; workspace?: string } } | undefined)?.input;
        const taskInputKind = input?.input?.kind;
        const taskIdKind =
          taskInputKind === "clothing-scene-planning" ||
          taskInputKind === "clothing-tryon-generation" ||
          taskInputKind === "scene-prompt-planning" ||
          taskInputKind === "scene-image-generation"
            ? taskInputKind
            : input?.kind;
        const id = input?.idempotencyKey?.includes("listing-copy")
          ? `task_listing_${input.idempotencyKey}`
          : `task_${taskIdKind ?? "generation"}`;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id,
          kind: input?.kind ?? "image-generation",
          stage: "queued",
          status: "queued",
          title: "测试任务",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: input?.workspace ?? "product",
        });
      }
      if (command === "generation_run_next_task") {
        return Promise.resolve({ invocationId: "inv_app_test", taskId: "task_image-generation" });
      }
      if (command === "generation_replace_result_image" || command === "generation_delete_result_image") {
        return Promise.resolve();
      }
      if (command === "generation_run_task") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "task_image-generation";
        return Promise.resolve({ invocationId: `inv_${taskId}`, taskId });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId.includes("scene-prompt-planning")) {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            output: {
              campaignStyleLock: "固定暖白色板、中性棚拍光与统一无衬线字体。",
              conversionDriver: "visual",
              items: sceneVisualFullPackFixture.map(([code, templateId, title, purpose], index) => ({
                code,
                imageId: `scene-${code.toLowerCase()}`,
                imageNo: index + 1,
                negativeConstraints: "禁止新增或篡改 Logo，禁止虚构参数。",
                prompt: `${code} ${title}，陶瓷保温杯，固定色板。`,
                promptSummary: `${title}，陶瓷保温杯置于画面核心区域。`,
                purpose,
                ratio: "1:1",
                sortOrder: index,
                templateId,
                title,
                variantId: "minimal",
              })),
              templateCatalogVersion: "v5",
            },
            outputAssets: [],
            task: {
              id: taskId,
              kind: "prompt-plan",
              stage: "completed",
              status: "succeeded",
            },
          });
        }
        if (taskId.includes("clothing-scene-planning")) {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            output: {
              scenes: [
                {
                  scene: "都市街头",
                  sceneVisualAnchor: "城市核心商圈人行道，午后暖调阳光洒落",
                  scenePromptSegment: "街头时尚摄影，自然光充足照明，8K高清商业电商质感",
                  recommendedPoses: [
                    {
                      cameraSetup: { framing: "全身", perspective: "正面", shootingPosition: "平视机位" },
                      poseAction: "自然站立，双手插裤兜，肩膀微抬，直视镜头，清晰展示背心正面印花",
                    },
                    {
                      cameraSetup: { framing: "四分之三", perspective: "3/4 侧", shootingPosition: "平视机位" },
                      poseAction: "侧身迈步向前走，一只手自然搭在裤边，转头看向前方，展示背心侧部剪裁",
                    },
                    {
                      cameraSetup: { framing: "半身", perspective: "侧面", shootingPosition: "平视机位" },
                      poseAction: "侧身靠在路牌上，一只手随意抬至脑后，展示背心肩线与手臂线条",
                    },
                    {
                      cameraSetup: { framing: "全身", perspective: "正面", shootingPosition: "平视机位" },
                      checked: false,
                      poseAction: "身体微向前倾，双手自然垂在身侧，下颌微抬，展示背心整体版型",
                    },
                  ],
                },
                {
                  scene: "街角咖啡",
                  sceneVisualAnchor: "临街咖啡馆外摆座位，背景为玻璃窗和木质桌椅",
                  scenePromptSegment: "都市通勤服饰摄影，柔和自然侧光，商业成片质感",
                  recommendedPoses: [
                    {
                      cameraSetup: { framing: "全身", perspective: "正面", shootingPosition: "平视机位" },
                      poseAction: "坐在户外木椅上，身体放松靠向椅背，双手搭在桌沿，清晰展示背心正面",
                    },
                    {
                      cameraSetup: { framing: "四分之三", perspective: "3/4 侧", shootingPosition: "平视机位" },
                      poseAction: "站在咖啡店旁，一只手拿着冰咖啡，转头看向侧边，展示背心胸部轮廓",
                    },
                    {
                      cameraSetup: { framing: "半身", perspective: "侧面", shootingPosition: "平视机位" },
                      poseAction: "侧身倚靠在咖啡店门框远方，展示背心肩线，姿态放松自然",
                    },
                  ],
                },
              ],
            },
            outputAssets: [],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
            },
          });
        }
        if (taskId.includes("listing")) {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            output: {
              attributeWords: ["圆领短袖", "运动风"],
              detailCopy: "适合日常通勤与户外运动的清爽短袖T恤。",
              mainImageGuidance: ["主图展示正面上身效果", "细节图突出胸口印花"],
              platform: "淘宝天猫",
              promotionBenefits: ["多场景好搭配"],
              searchKeywords: ["运动T恤", "藏青短袖"],
              sellingPoints: ["藏青色底搭配运动风字母印花"],
              title: "藏青运动风字母印花圆领短袖T恤",
            },
            outputAssets: [],
            task: {
              id: taskId,
              kind: "listing-copy",
              stage: "completed",
              status: "succeeded",
            },
          });
        }
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: Array.from({ length: 24 }, (_, index) => ({
            asset: {
              id: `asset_generated_${index + 1}`,
              localPath: `/workspace/current/assets/generated/generated-${index + 1}.png`,
              relativePath: `assets/generated/generated-${index + 1}.png`,
              url: `asset://localhost/workspace/current/assets/generated/generated-${index + 1}.png`,
            },
            role: "output",
            sortOrder: index,
          })),
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "completed",
            status: "succeeded",
          },
        });
      }
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
        });
      }
      if (command === "ai_assist_product_selling_points") {
        return Promise.resolve({
          capabilityId: "product-selling-points",
          promptId: "product-selling-points",
          text: "1、产品名称：黑色休闲翻领长袖衬衫\n\n2、核心卖点：\n* 卖点 1：黑色翻领长袖版型，简洁百搭。\n* 卖点 2：后背可见图案装饰，增加视觉层次。\n* 卖点 3：偏休闲穿搭，适合日常通勤和街头出行。\n* 卖点 4：需补充。",
        });
      }
      if (command === "ai_assist_product_selling_points_stream") {
        return Promise.resolve({
          capabilityId: "product-selling-points",
          promptId: "product-selling-points",
          text: "1、产品名称：黑色休闲翻领长袖衬衫\n\n2、核心卖点：\n* 卖点 1：黑色翻领长袖版型，简洁百搭。\n* 卖点 2：后背可见图案装饰，增加视觉层次。\n* 卖点 3：偏休闲穿搭，适合日常通勤和街头出行。\n* 卖点 4：需补充。",
        });
      }
      if (command === "ai_assist_viral_style_analysis") {
        return Promise.resolve({
          capabilityId: "viral-style-analysis",
          data: {
            platform: "淘宝天猫",
            items: [
              {
                id: "style-1",
                title: "街头潮酷风",
                subtitle: "放大商品视觉记忆点，适合社媒种草。",
                colors: ["#0F172A", "#22C55E"],
              },
              {
                id: "style-2",
                title: "通勤质感风",
                subtitle: "突出简洁通勤气质，适合详情页表达。",
                colors: ["#111827", "#F8FAFC", "#2563EB"],
              },
              {
                id: "style-3",
                title: "简约百搭风",
                subtitle: "强化搭配效率和基础款价值。",
                colors: ["#111111", "#FFFFFF"],
              },
              {
                id: "style-4",
                title: "细节品质风",
                subtitle: "用细节与工艺感增强信任。",
                colors: ["#27272A", "#F4F4F5", "#71717A"],
              },
            ],
          },
          promptId: "viral-style-analysis",
          text: "",
        });
      }
      if (command === "prompt_plan_create") {
        const intent = (args as { input?: { intent?: Record<string, unknown> } } | undefined)?.input?.intent ?? {};
        const modules = Array.isArray(intent.modules)
          ? (intent.modules as Array<Record<string, unknown>>)
          : [];
        const styles = Array.isArray(intent.viralStyles) && intent.viralStyles.length > 0
          ? (intent.viralStyles as Array<Record<string, unknown>>)
          : [{ styleId: "default", styleTitle: "中性电商风格", colors: [] }];
        const now = "2026-07-02T00:00:00.000Z";
        return Promise.resolve({
          createdAt: now,
          id: "prompt_plan_app_test",
          items: styles.flatMap((style, styleIndex) =>
            modules.map((module, moduleIndex) => {
              const moduleId = String(module.moduleId ?? `module-${moduleIndex + 1}`);
              const moduleTitle = String(module.moduleTitle ?? "模块");
              const styleId = String(style.styleId ?? `style-${styleIndex + 1}`);
              const styleTitle = String(style.styleTitle ?? "中性电商风格");
              const sceneDescription = `画面以${intent.productSellingPoints || "商品"}为主体，采用${styleTitle}的统一背景、光影和构图，右侧预留信息区，用于${moduleTitle}模块，不添加品牌、价格或认证。`;
              const imagePrompt = `模型生成 imagePrompt：${sceneDescription} 禁止新增未提供的品牌 Logo、价格、销量、认证标识。`;
              return {
                createdAt: now,
                displaySummary: sceneDescription,
                editable: true,
                id: `${styleId}-${moduleId}`,
                intent: {
                  imagePrompt,
                  moduleId,
                  moduleTitle,
                  sceneDescription,
                  styleId,
                  styleTitle,
                },
                required: true,
                sortOrder: styleIndex * modules.length + moduleIndex,
                title: `${styleTitle} · ${moduleTitle}`,
                type: "scene",
                updatedAt: now,
              };
            }),
          ),
          resolverVersion: "product-detail-scene-description-v1",
          status: "draft",
          templateVersion: "v1",
          updatedAt: now,
          userEditableSummary: `模型整理后的产品与卖点：${intent.productSellingPoints || "商品"}`,
          workspace: "product",
        });
      }
      if (command === "generation_create_task") {
        const input = (args as { input?: { kind?: string } } | undefined)?.input;
        return Promise.resolve({
          id: `task_${input?.kind ?? "generation"}`,
          kind: input?.kind ?? "image-generation",
          stage: "queued",
          status: "queued",
        });
      }
      if (command === "generation_run_next_task") {
        return Promise.resolve({ invocationId: "inv_waits_for_model", taskId: "task_image-generation" });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                id: "asset_waits_for_model",
                relativePath: "assets/generated/generated-1.png",
                url: "asset://localhost/workspace/current/assets/generated/generated-1.png",
              },
              role: "output",
              sortOrder: 0,
            },
          ],
          task: {
            id: "task_image-generation",
            status: "succeeded",
          },
        });
      }
      if (command === "workspace_get_status") {
        return Promise.resolve({
          initialized: true,
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspaceDirectory: "/workspace/current",
        });
      }
      return Promise.resolve(undefined);
    });
    saveMock.mockReset();
    audioContextInstances.length = 0;
    audioSources.length = 0;
    audioPlayMock.mockClear();
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: MockAudio,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.resolve(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["app-test-image"], { type: "image/png" }))),
    );
    vi.spyOn(Math, "random").mockReturnValue(0.99);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a native-feeling workspace with reusable layout regions", () => {
    renderApp();

    expect(screen.getByRole("banner", { name: "应用工具栏" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "主导航" });

    expect(navigation).toBeInTheDocument();
    expect(within(navigation).getAllByRole("button", { name: /商品/ })).toHaveLength(1);
    expect(within(navigation).getByRole("button", { name: /商品/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(navigation).getByRole("button", { name: /场景/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /模型/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /设置/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /详情/ })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "生成配置" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "生成预览画布" })).toBeInTheDocument();
    expect(screen.getByTestId("generation-config-scroll")).toHaveClass("overscroll-none");
    expect(screen.getByTestId("studio-side-divider")).toHaveClass(
      "absolute",
      "inset-y-0",
      "left-[var(--studio-side-width)]",
    );
  });

  it("opens model configuration workspace with model cards and default summary", async () => {
    const user = userEvent.setup();

    renderApp();

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    await user.click(within(navigation).getByRole("button", { name: /模型/ }));
    const toolbar = screen.getByRole("banner", { name: "应用工具栏" });

    expect(screen.getByRole("main", { name: "AI 模型配置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI 模型配置" })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /模型/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(toolbar).queryByRole("button", { name: "新建任务" })).not.toBeInTheDocument();
    expect(screen.getByText("1 文生文")).toBeInTheDocument();
    expect(screen.getByText("2 文生图")).toBeInTheDocument();
    expect(screen.getByText("3 图生图")).toBeInTheDocument();
    expect(screen.getByText("4 图生文")).toBeInTheDocument();
    expect(screen.getAllByText("可用").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("combobox", { name: "文生文 Provider" })).not.toBeInTheDocument();
    const providerTrigger = screen.getByRole("button", { name: /文生文 Provider.*OpenAI/ });
    expect(providerTrigger).toHaveClass(
      "inline-flex",
      "h-8",
      "rounded-control",
      "bg-slate-100/70",
      "border-white/60",
      "text-[12px]",
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]",
    );
    const modelInput = screen.getByRole("textbox", { name: "文生文 模型" });
    expect(modelInput).toHaveValue("gpt-5.5");
    const modelTrigger = screen.getByRole("button", { name: "展开文生文 模型选项" });
    await user.click(modelTrigger);
    expect(modelTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "gpt-5.5-pro" })).toHaveClass(
      "flex",
      "h-9",
      "rounded-[10px]",
      "text-[12px]",
    );
    expect(screen.getAllByTestId("model-status-badge")[0]).toHaveClass("whitespace-nowrap", "rounded-full");
    expect(screen.getByText("当前默认配置")).toBeInTheDocument();
    expect(screen.getByText("模型类别说明")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑默认" })).not.toBeInTheDocument();
    expect(screen.queryByText("设为默认")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看接入文档" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeInTheDocument();
  });

  it("restores local product generation history from persisted tasks on startup", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              completedAt: "2026-07-02T10:30:00.000Z",
              createdAt: "2026-07-02T10:29:00.000Z",
              id: "task_persisted_product_detail",
              kind: "image-generation",
              promptPlanId: "local-task_persisted_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品详情图",
              updatedAt: "2026-07-02T10:30:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T10:40:00.000Z",
              createdAt: "2026-07-02T10:39:00.000Z",
              id: "task_retry_single_image",
              kind: "image-generation",
              promptPlanId: "retry-task_persisted_product_detail-1",
              stage: "completed",
              status: "succeeded",
              title: "重新生成 核心卖点图",
              updatedAt: "2026-07-02T10:40:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T10:31:00.000Z",
              createdAt: "2026-07-02T10:30:30.000Z",
              id: "task_persisted_listing_copy",
              kind: "listing-copy",
              promptPlanId: "local-task_persisted_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品上架文案",
              updatedAt: "2026-07-02T10:31:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T10:42:00.000Z",
              createdAt: "2026-07-02T10:41:30.000Z",
              id: "task_persisted_listing_copy_retry",
              kind: "listing-copy",
              promptPlanId: "local-task_persisted_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品上架文案",
              updatedAt: "2026-07-02T10:42:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T10:50:00.000Z",
              createdAt: "2026-07-02T10:49:00.000Z",
              id: "task_persisted_clothing_scene",
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              title: "服饰场景图",
              updatedAt: "2026-07-02T10:50:00.000Z",
              workspace: "clothing",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 5,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_persisted_clothing_scene") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "clothing-tryon-generation",
              ratio: "3:4",
              items: [
                {
                  id: "scene-1-pose-1",
                  scene: "都市街头",
                  sceneVisualAnchor: "城市核心商圈人行道，午后暖调阳光洒落",
                  scenePromptSegment: "街头时尚摄影，自然光充足照明",
                  poseAction: "站立于街头，双手自然垂在身侧，展示T恤版型",
                  cameraSetup: {
                    framing: "全身",
                    perspective: "正面",
                    shootingPosition: "平视机位",
                  },
                },
                {
                  id: "scene-1-pose-2",
                  scene: "都市街头",
                  sceneVisualAnchor: "城市核心商圈人行道，午后暖调阳光洒落",
                  scenePromptSegment: "街头时尚摄影，自然光充足照明",
                  poseAction: "呈行走步姿，展示T恤动态穿着效果",
                  cameraSetup: {
                    framing: "四分之三",
                    perspective: "3/4 侧",
                    shootingPosition: "平视机位",
                  },
                },
              ],
            },
            inputAssets: [
              {
                asset: {
                  id: "asset_clothing_source",
                  localPath: "/workspace/current/assets/source/tshirt.png",
                  name: "tshirt.png",
                  originalName: "tshirt.png",
                  relativePath: "assets/source/tshirt.png",
                  url: "asset://localhost/workspace/current/assets/source/tshirt.png",
                },
                role: "source",
                sortOrder: 0,
              },
              {
                asset: {
                  id: "asset_clothing_model",
                  localPath: "/workspace/current/assets/model/model.png",
                  name: "model.png",
                  originalName: "model.png",
                  relativePath: "assets/model/model.png",
                  url: "asset://localhost/workspace/current/assets/model/model.png",
                },
                role: "model",
                sortOrder: 1,
              },
            ],
            outputAssets: [
              {
                asset: {
                  id: "asset_clothing_output_1",
                  localPath: "/workspace/current/assets/generated/clothing-1.jpeg",
                  relativePath: "assets/generated/clothing-1.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/clothing-1.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
              {
                asset: {
                  id: "asset_clothing_output_2",
                  localPath: "/workspace/current/assets/generated/clothing-2.jpeg",
                  relativePath: "assets/generated/clothing-2.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/clothing-2.jpeg",
                },
                role: "output",
                sortOrder: 1,
              },
            ],
            task: {
              createdAt: "2026-07-02T10:49:00.000Z",
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              title: "服饰场景图",
              updatedAt: "2026-07-02T10:50:00.000Z",
              workspace: "clothing",
            },
          });
        }
        if (taskId === "task_persisted_product_detail") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              platform: "淘宝天猫",
              market: "中国",
              language: "中文",
              productSellingPoints: "藏青运动风字母印花圆领短袖T恤",
              sourceImageNames: ["tshirt.png"],
              userImages: [
                {
                  dataUrl: "data:image/png;base64,product-source",
                  mimeType: "image/png",
                  originalName: "tshirt.png",
                },
              ],
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_persisted_1",
                  localPath: "/workspace/current/assets/generated/persisted-1.jpeg",
                  relativePath: "assets/generated/persisted-1.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/persisted-1.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
              {
                asset: {
                  id: "asset_persisted_2",
                  relativePath: "assets/generated/persisted-2.jpeg",
                },
                role: "output",
                sortOrder: 1,
              },
              {
                asset: {
                  id: "asset_persisted_3",
                  localPath: "/workspace/current/assets/generated/persisted-3.jpeg",
                  relativePath: "assets/generated/persisted-3.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/persisted-3.jpeg",
                },
                role: "output",
                sortOrder: 2,
              },
              {
                asset: {
                  id: "asset_persisted_4",
                  localPath: "/workspace/current/assets/generated/persisted-4.jpeg",
                  relativePath: "assets/generated/persisted-4.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/persisted-4.jpeg",
                },
                role: "output",
                sortOrder: 3,
              },
            ],
            promptPlanSnapshot: {
              planId: "local-task_persisted_product_detail",
              items: [
                {
                  id: "style-minimal-hero",
                  intent: {
                    groupId: "style-minimal",
                    groupTitle: "极简质感风",
                    imagePrompt: "极简质感风首屏主视觉 prompt",
                    sceneDescription: "极简质感风首屏主视觉场景",
                  },
                  title: "首屏主视觉",
                },
                {
                  id: "style-minimal-detail",
                  intent: {
                    groupId: "style-minimal",
                    groupTitle: "极简质感风",
                    imagePrompt: "极简质感风商品细节图 prompt",
                    sceneDescription: "极简质感风商品细节图场景",
                  },
                  title: "商品细节图",
                },
                {
                  id: "style-daily-hero",
                  intent: {
                    groupId: "style-daily",
                    groupTitle: "日常场景风",
                    imagePrompt: "日常场景风首屏主视觉 prompt",
                    sceneDescription: "日常场景风首屏主视觉场景",
                  },
                  title: "首屏主视觉",
                },
                {
                  id: "style-daily-detail",
                  intent: {
                    groupId: "style-daily",
                    groupTitle: "日常场景风",
                    imagePrompt: "日常场景风商品细节图 prompt",
                    sceneDescription: "日常场景风商品细节图场景",
                  },
                  title: "商品细节图",
                },
              ],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "local-task_persisted_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品详情图",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_retry_single_image") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              platform: "淘宝天猫",
              market: "中国",
              language: "中文",
              productSellingPoints: "藏青运动风字母印花圆领短袖T恤",
              items: [
                {
                  imageId: "task_persisted_product_detail-1",
                  imageNo: 2,
                  title: "商品细节图",
                },
              ],
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_retry_single",
                  localPath: "/workspace/current/assets/generated/retry-single.jpeg",
                  relativePath: "assets/generated/retry-single.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/retry-single.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              planId: "retry-task_persisted_product_detail-1",
              items: [
                {
                  id: "task_persisted_product_detail-1",
                  title: "商品细节图",
                },
              ],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "retry-task_persisted_product_detail-1",
              stage: "completed",
              status: "succeeded",
              title: "重新生成 核心卖点图",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_persisted_listing_copy") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-listing-copy",
              groupId: "style-minimal",
              groupTitle: "极简质感风",
              platform: "淘宝天猫",
            },
            inputAssets: [],
            output: {
              title: "藏青运动风短袖T恤男",
              sellingPoints: ["运动风印花", "日常好搭"],
              promotionBenefits: ["适合通勤与户外"],
              detailCopy: "藏青色短袖T恤，胸口印花清爽有活力。",
              searchKeywords: ["短袖T恤", "运动风"],
              attributeWords: ["藏青色", "圆领"],
              mainImageGuidance: ["主图展示正面上身效果"],
              platform: "淘宝天猫",
            },
            outputAssets: [],
            promptPlanSnapshot: {
              planId: "local-task_persisted_product_detail",
            },
            task: {
              createdAt: "2026-07-02T10:30:30.000Z",
              id: taskId,
              kind: "listing-copy",
              promptPlanId: "local-task_persisted_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品上架文案",
              updatedAt: "2026-07-02T10:31:00.000Z",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_persisted_listing_copy_retry") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-listing-copy",
              groupId: "style-minimal",
              groupTitle: "极简质感风",
              platform: "淘宝天猫",
            },
            inputAssets: [],
            output: {
              title: "藏青运动风短袖T恤重试版",
              sellingPoints: ["重试后的运动风印花", "日常好搭"],
              promotionBenefits: ["适合通勤与户外"],
              detailCopy: "重试后的藏青色短袖T恤文案。",
              searchKeywords: ["短袖T恤", "运动风"],
              attributeWords: ["藏青色", "圆领"],
              mainImageGuidance: ["主图展示正面上身效果"],
              platform: "淘宝天猫",
            },
            outputAssets: [],
            promptPlanSnapshot: {
              planId: "local-task_persisted_product_detail",
            },
            task: {
              id: taskId,
              kind: "listing-copy",
              promptPlanId: "local-task_persisted_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品上架文案",
              updatedAt: "2026-07-02T10:42:00.000Z",
              workspace: "product",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));

    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    expect(screen.getByText("2 条本地记录")).toBeInTheDocument();
    expect(screen.getByText("商品详情图")).toBeInTheDocument();
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));
    expect(screen.getByText("服饰场景图")).toBeInTheDocument();
    expect(screen.queryByTestId("generation-history-empty-state")).not.toBeInTheDocument();
    expect(screen.getByText(/都市街头 · 3:4 · 2 张/)).toBeInTheDocument();
    await user.click(within(historyDialog).getByRole("button", { name: "商品" }));
    expect(screen.queryByText("重新生成 核心卖点图")).not.toBeInTheDocument();
    expect(screen.getByText(/淘宝天猫 · 中国 · 中文/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开" }));

    expect(screen.getAllByTestId("generated-result-group")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "选择 极简质感风 分组" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 日常场景风 分组" })).toBeInTheDocument();
    expect(screen.getAllByTestId("generated-detail-image-card")).toHaveLength(4);
    expect(screen.getAllByRole("img", { name: "商品细节图" })[0]).toHaveAttribute(
      "src",
      expect.stringContaining("retry-single.jpeg"),
    );
    expect(screen.queryByText("AI 生成中")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("listing-copy-result-card")).toHaveLength(1);
    expect(screen.getByTestId("listing-copy-result-card")).toHaveTextContent("藏青运动风短袖T恤重试版");
    for (const resultGroup of screen.getAllByTestId("generated-result-group")) {
      const sourceCard = within(resultGroup).getByTestId("generated-source-image-card");
      expect(within(resultGroup).getAllByRole("article")[0]).toBe(sourceCard);
      expect(within(sourceCard).getByRole("img", { name: "tshirt.png" })).toHaveAttribute(
        "src",
        "data:image/png;base64,product-source",
      );
    }
    expect(screen.getAllByRole("img", { name: "首屏主视觉" })[0]).toHaveAttribute(
      "src",
      expect.stringContaining("persisted-1.jpeg"),
    );

    const restoredRetryCard = screen
      .getAllByTestId("generated-detail-image-card")
      .find((card) => card.textContent?.includes("商品细节图")) as HTMLElement;
    await user.hover(restoredRetryCard);
    await user.click(within(restoredRetryCard).getByRole("button", { name: "AI改图 商品细节图" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "输入微调方向" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "输入调整要求" }), {
      target: { value: "把背景换成浅灰色" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新生成 15" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            inputAssets: [
              {
                assetId: "asset_retry_single",
                role: "reference",
                sortOrder: 0,
              },
            ],
            kind: "image-edit",
            title: "微调 商品细节图",
            workspace: "product",
          }),
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "删除记录 商品详情图" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: "task_persisted_product_detail",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
      taskId: "task_persisted_listing_copy",
    });
    expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
      taskId: "task_persisted_listing_copy_retry",
    });
  });

  it("restores scene reference images as the first result card without changing the generated count", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              completedAt: "2026-07-02T11:00:00.000Z",
              createdAt: "2026-07-02T10:59:00.000Z",
              id: "task_persisted_scene",
              kind: "image-generation",
              promptPlanId: "task_persisted_scene_plan",
              stage: "completed",
              status: "succeeded",
              title: "场景图片",
              updatedAt: "2026-07-02T11:00:00.000Z",
              workspace: "scene",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_persisted_scene") {
          return Promise.resolve({
            events: [],
            input: {
              items: [
                {
                  code: "S1",
                  imageId: "scene-s1",
                  imageNo: 1,
                  prompt: "Magazine editorial portrait",
                  purpose: "杂志人物大片",
                  ratio: "3:4",
                  sortOrder: 0,
                  title: "杂志人物大片",
                },
              ],
              kind: "scene-image-generation",
              outputMode: "single",
              ratio: "3:4",
            },
            inputAssets: [
              {
                asset: {
                  id: "asset_scene_reference",
                  localPath: "/workspace/current/assets/source/person.png",
                  originalName: "person.png",
                  relativePath: "assets/source/person.png",
                  url: "asset://localhost/workspace/current/assets/source/person.png",
                },
                role: "reference",
                sortOrder: 0,
              },
            ],
            outputAssets: [
              {
                asset: {
                  id: "asset_scene_output",
                  localPath: "/workspace/current/assets/generated/scene-s1.jpeg",
                  relativePath: "assets/generated/scene-s1.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/scene-s1.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              createdAt: "2026-07-02T10:59:00.000Z",
              id: taskId,
              kind: "image-generation",
              promptPlanId: "task_persisted_scene_plan",
              stage: "completed",
              status: "succeeded",
              title: "场景图片",
              updatedAt: "2026-07-02T11:00:00.000Z",
              workspace: "scene",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    expect(within(historyDialog).getByText("1 张")).toBeInTheDocument();
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));

    const resultGrid = screen.getByTestId("generated-result-grid");
    const resultCards = within(resultGrid).getAllByRole("article");
    const sourceCard = within(resultGrid).getByTestId("generated-source-image-card");
    expect(resultCards[0]).toBe(sourceCard);
    expect(within(sourceCard).getByRole("img", { name: "person.png" })).toHaveAttribute(
      "src",
      expect.stringContaining("/workspace/current/assets/source/person.png"),
    );
    expect(screen.getAllByTestId("generated-detail-image-card")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "S1 杂志人物大片" })).toHaveAttribute(
      "src",
      expect.stringContaining("/workspace/current/assets/generated/scene-s1.jpeg"),
    );

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "删除记录 场景图片" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: "task_persisted_scene_plan",
      }),
    );
  });

  it.each([
    { initialStage: "calling-provider", initialStatus: "running", shouldStart: false },
    { initialStage: "queued", initialStatus: "queued", shouldStart: true },
  ] as const)("continues polling a restored $initialStatus scene parent task", async ({
    initialStage,
    initialStatus,
    shouldStart,
  }) => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const taskId = `task_scene_${initialStatus}_restore`;
    const now = new Date().toISOString();
    let detailCalls = 0;
    const task = {
      attemptNo: 1,
      createdAt: now,
      id: taskId,
      kind: "image-generation",
      stage: initialStage,
      status: initialStatus,
      title: "恢复中的场景图片",
      updatedAt: now,
      workspace: "scene",
    };
    const input = {
      items: [
        {
          code: "S1",
          imageId: "scene-running-s1",
          imageNo: 1,
          prompt: "运行中的场景 prompt",
          purpose: "运行中的场景",
          ratio: "3:4",
          sortOrder: 0,
          title: "运行中的场景",
        },
      ],
      kind: "scene-image-generation",
      outputMode: "single",
      ratio: "3:4",
    };
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const requestedTaskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail" && requestedTaskId === taskId) {
        detailCalls += 1;
        const completed = detailCalls >= (shouldStart ? 3 : 2);
        return Promise.resolve({
          events: [],
          input,
          inputAssets: [],
          outputAssets: completed
            ? [
                {
                  asset: {
                    id: "asset_scene_running_restored",
                    localPath: "/workspace/current/assets/generated/scene-running-restored.png",
                    relativePath: "assets/generated/scene-running-restored.png",
                  },
                  role: "output",
                  sortOrder: 0,
                },
              ]
            : [],
          task: completed
            ? { ...task, completedAt: now, stage: "completed", status: "succeeded", updatedAt: now }
            : task,
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    await waitFor(() => expect(within(historyDialog).getByText("已完成")).toBeInTheDocument(), { timeout: 2_000 });
    if (shouldStart) {
      expect(invokeMock).toHaveBeenCalledWith("generation_run_task", { taskId });
      expect(
        invokeMock.mock.calls.filter(
          ([command, args]) => command === "generation_run_task" && (args as { taskId?: string })?.taskId === taskId,
        ),
      ).toHaveLength(1);
    } else {
      expect(invokeMock).not.toHaveBeenCalledWith("generation_run_task", { taskId });
    }
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
    expect(screen.getByRole("img", { name: "S1 运行中的场景" })).toHaveAttribute(
      "src",
      expect.stringContaining("scene-running-restored.png"),
    );
  });

  it("keeps a restored scene parent polling after a new scene planning request starts", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const taskId = "task_scene_restore_survives_new_plan";
    const now = new Date().toISOString();
    let detailCalls = 0;
    let resolveRestoredPoll: ((detail: Record<string, unknown>) => void) | undefined;
    const task = {
      attemptNo: 1,
      createdAt: now,
      id: taskId,
      kind: "image-generation",
      stage: "calling-provider",
      status: "running",
      title: "独立恢复的场景图片",
      updatedAt: now,
      workspace: "scene",
    };
    const input = {
      items: [
        {
          code: "S1",
          imageId: "scene-independent-s1",
          imageNo: 1,
          prompt: "独立恢复 prompt",
          purpose: "独立恢复场景",
          ratio: "3:4",
          sortOrder: 0,
          title: "独立恢复场景",
        },
      ],
      kind: "scene-image-generation",
      outputMode: "single",
      ratio: "3:4",
    };
    const runningDetail = { events: [], input, inputAssets: [], outputAssets: [], task };
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const requestedTaskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail" && requestedTaskId === taskId) {
        detailCalls += 1;
        if (detailCalls === 1) {
          return Promise.resolve(runningDetail);
        }
        return new Promise((resolve) => {
          resolveRestoredPoll = resolve;
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/new-plan.png",
        name: "new-plan.png",
        path: "/Users/demo/Pictures/new-plan.png",
        src: "asset://new-plan.png",
      },
    ]);

    renderApp();

    await waitFor(() => expect(resolveRestoredPoll).toBeDefined());
    await user.click(screen.getByRole("button", { name: "场景" }));
    await user.click(screen.getByRole("button", { name: "上传参考图" }));
    await user.click(screen.getByRole("button", { name: "完整图片包（14 张）" }));
    await user.type(screen.getByRole("textbox", { name: "补充信息" }), "新场景规划");
    await user.click(screen.getByRole("button", { name: "生成图片方案" }));
    await waitFor(() => expect(screen.getAllByTestId("scene-prompt-card")).toHaveLength(14));

    await act(async () => {
      resolveRestoredPoll?.({
        ...runningDetail,
        outputAssets: [
          {
            asset: {
              id: "asset_scene_independent_complete",
              localPath: "/workspace/current/assets/generated/scene-independent-complete.png",
              relativePath: "assets/generated/scene-independent-complete.png",
            },
            role: "output",
            sortOrder: 0,
          },
        ],
        task: { ...task, completedAt: now, stage: "completed", status: "succeeded", updatedAt: now },
      });
    });

    expect(screen.queryByRole("img", { name: "S1 独立恢复场景" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("scene-prompt-card")).toHaveLength(14);
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    await waitFor(() => expect(within(historyDialog).getByText("已完成")).toBeInTheDocument());
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
    expect(screen.getByRole("img", { name: "S1 独立恢复场景" })).toHaveAttribute(
      "src",
      expect.stringContaining("scene-independent-complete.png"),
    );
  });

  it("continues a restored running scene retry and merges its result into the parent slot", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const parentTaskId = "task_scene_running_retry_parent";
    const retryTaskId = "task_scene_running_retry_child";
    const now = new Date().toISOString();
    let retryDetailCalls = 0;
    let replaced = false;
    const parentTask = {
      attemptNo: 1,
      completedAt: now,
      createdAt: now,
      id: parentTaskId,
      kind: "image-generation",
      promptPlanId: "task_scene_running_retry_plan",
      stage: "completed",
      status: "succeeded",
      title: "重试恢复父任务",
      updatedAt: now,
      workspace: "scene",
    };
    const retryTask = {
      attemptNo: 1,
      createdAt: now,
      id: retryTaskId,
      kind: "image-generation",
      promptPlanId: "task_scene_running_retry_plan",
      stage: "calling-provider",
      status: "running",
      title: "重新生成 S1 重试恢复图",
      updatedAt: now,
      workspace: "scene",
    };
    const parentInput = {
      items: [
        {
          code: "S1",
          imageId: "scene-running-retry-s1",
          imageNo: 1,
          prompt: "父任务 prompt",
          purpose: "父任务场景",
          ratio: "3:4",
          sortOrder: 0,
          title: "重试恢复图",
        },
      ],
      kind: "scene-image-generation",
      outputMode: "single",
      ratio: "3:4",
    };
    const retryInput = {
      ...parentInput,
      items: [{ ...parentInput.items[0], sortOrder: 0 }],
      parentTaskId,
      retrySequence: 1_783_861_000_000,
      singleImageRetry: true,
      targetImageId: "scene-running-retry-s1",
    };
    const outputAsset = (id: string, filename: string) => ({
      asset: {
        id,
        localPath: `/workspace/current/assets/generated/${filename}`,
        relativePath: `assets/generated/${filename}`,
      },
      role: "output",
      sortOrder: 0,
    });
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [retryTask, parentTask] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail" && taskId === parentTaskId) {
        return Promise.resolve({
          events: [],
          input: parentInput,
          inputAssets: [],
          outputAssets: [
            replaced
              ? outputAsset("asset_scene_running_retry_new", "scene-running-retry-new.png")
              : outputAsset("asset_scene_running_retry_old", "scene-running-retry-old.png"),
          ],
          task: parentTask,
        });
      }
      if (command === "generation_get_task_detail" && taskId === retryTaskId) {
        retryDetailCalls += 1;
        const completed = retryDetailCalls >= 2;
        return Promise.resolve({
          events: [],
          input: retryInput,
          inputAssets: [],
          outputAssets: completed
            ? [outputAsset("asset_scene_running_retry_new", "scene-running-retry-new.png")]
            : [],
          task: completed
            ? { ...retryTask, completedAt: now, stage: "completed", status: "succeeded", updatedAt: now }
            : retryTask,
        });
      }
      if (command === "generation_replace_result_image") {
        replaced = true;
        return Promise.resolve({ replaced: true });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    await waitFor(() => expect(within(historyDialog).getByText("已完成")).toBeInTheDocument());
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_task", { taskId: retryTaskId });
    expect(invokeMock).toHaveBeenCalledWith(
      "generation_replace_result_image",
      expect.objectContaining({
        input: expect.objectContaining({
          replacementTaskId: retryTaskId,
          taskId: parentTaskId,
        }),
      }),
    );
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
    expect(screen.getByRole("img", { name: "S1 重试恢复图" })).toHaveAttribute(
      "src",
      expect.stringContaining("scene-running-retry-new.png"),
    );
  });

  it("restores a succeeded scene single-image retry under its parent record", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const parentTaskId = "task_scene_retry_restore_parent";
    const retryTaskId = "task_scene_retry_restore_child";
    const promptPlanTaskId = "task_scene_retry_restore_plan";
    const parentTask = {
      completedAt: "2026-07-12T11:00:10.000Z",
      createdAt: "2026-07-12T11:00:00.000Z",
      error: { code: "IMAGE_GENERATION_FAILED", message: "生成失败", retryable: true },
      id: parentTaskId,
      kind: "image-generation",
      promptPlanId: promptPlanTaskId,
      stage: "failed",
      status: "failed",
      title: "历史场景图片",
      updatedAt: "2026-07-12T11:00:10.000Z",
      workspace: "scene",
    };
    const retryTask = {
      completedAt: "2026-07-12T12:00:10.000Z",
      createdAt: "2026-07-12T12:00:00.000Z",
      id: retryTaskId,
      kind: "image-generation",
      promptPlanId: promptPlanTaskId,
      stage: "completed",
      status: "succeeded",
      title: "重新生成 S1 重试后场景标题",
      updatedAt: "2026-07-12T12:00:10.000Z",
      workspace: "scene",
    };
    const parentDetail = {
      events: [],
      input: {
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            prompt: "父任务旧 prompt",
            purpose: "父任务旧 purpose",
            ratio: "3:4",
            sortOrder: 0,
            title: "父任务旧标题",
          },
        ],
        kind: "scene-image-generation",
        outputMode: "single",
        ratio: "3:4",
      },
      inputAssets: [],
      outputAssets: [],
      task: parentTask,
    };
    const retryDetail = {
      events: [],
      input: {
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            prompt: "重试成功后的 Scene prompt",
            purpose: "重试成功后的 Scene purpose",
            ratio: "3:4",
            sortOrder: 0,
            title: "重试后场景标题",
          },
        ],
        kind: "scene-image-generation",
        parentTaskId,
        retrySequence: 1_783_860_000_000,
        singleImageRetry: true,
        targetImageId: "scene-s1",
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_scene_retry_restored",
            localPath: "/workspace/current/assets/generated/scene-retry-restored.png",
            relativePath: "assets/generated/scene-retry-restored.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: retryTask,
    };
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [retryTask, parentTask] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(taskId === retryTaskId ? retryDetail : parentDetail);
      }
      if (command === "generation_delete_task") {
        return Promise.resolve({ deleted: true });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    expect(screen.getByText("1 条本地记录")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));

    const restoredCard = screen.getByTestId("generated-detail-image-card");
    expect(within(restoredCard).getByRole("img", { name: "S1 重试后场景标题" })).toHaveAttribute(
      "src",
      expect.stringContaining("scene-retry-restored.png"),
    );
    expect(restoredCard).toHaveAttribute("data-prompt", "重试成功后的 Scene prompt");

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "删除记录 历史场景图片" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: retryTaskId,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: parentTaskId });
    expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: promptPlanTaskId });
  });

  it.each([
    { retryStage: "failed", retryStatus: "failed", statusLabel: "已完成" },
    { retryStage: "running", retryStatus: "running", statusLabel: "生成中" },
  ] as const)("restores a $retryStatus scene retry over a completed parent image", async ({
    retryStage,
    retryStatus,
    statusLabel,
  }) => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const retryTimestamp = new Date().toISOString();
    const parentTaskId = "task_scene_failed_retry_restore_parent";
    const retryTaskId = "task_scene_failed_retry_restore_child";
    const parentTask = {
      completedAt: "2026-07-12T11:00:10.000Z",
      createdAt: "2026-07-12T11:00:00.000Z",
      id: parentTaskId,
      kind: "image-generation",
      stage: "completed",
      status: "succeeded",
      title: "已有成功图的场景任务",
      updatedAt: "2026-07-12T11:00:10.000Z",
      workspace: "scene",
    };
    const retryTask = {
      ...(retryStatus === "failed"
        ? {
            completedAt: retryTimestamp,
            error: { code: "IMAGE_GENERATION_FAILED", message: "重新生成失败", retryable: true },
          }
        : {}),
      createdAt: retryTimestamp,
      id: retryTaskId,
      kind: "image-generation",
      stage: retryStage,
      status: retryStatus,
      title: "重新生成 S1 已有成功图",
      updatedAt: retryTimestamp,
      workspace: "scene",
    };
    const parentDetail = {
      events: [],
      input: {
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            prompt: "父任务成功 prompt",
            purpose: "父任务成功 purpose",
            ratio: "3:4",
            sortOrder: 0,
            title: "已有成功图",
          },
        ],
        kind: "scene-image-generation",
        outputMode: "single",
        ratio: "3:4",
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_scene_parent_complete",
            localPath: "/workspace/current/assets/generated/scene-parent-complete.png",
            relativePath: "assets/generated/scene-parent-complete.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: parentTask,
    };
    const retryDetail = {
      events: [],
      input: {
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            prompt: "失败重试 prompt",
            purpose: "失败重试 purpose",
            ratio: "3:4",
            sortOrder: 0,
            title: "已有成功图",
          },
        ],
        kind: "scene-image-generation",
        parentTaskId,
        retrySequence: 1_783_860_100_000,
        singleImageRetry: true,
        targetImageId: "scene-s1",
      },
      inputAssets: [],
      outputAssets: [],
      task: retryTask,
    };
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [retryTask, parentTask] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(taskId === retryTaskId ? retryDetail : parentDetail);
      }
      if (command === "generation_delete_task") {
        return Promise.resolve({ deleted: true });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    expect(screen.getByText(statusLabel)).toBeInTheDocument();
    if (retryStatus === "failed") {
      await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
      expect(screen.getByRole("img", { name: "S1 已有成功图" })).toHaveAttribute(
        "src",
        expect.stringContaining("scene-parent-complete.png"),
      );
      await user.click(screen.getByRole("button", { name: /生成记录/ }));
    } else {
      expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "删除记录 已有成功图的场景任务" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: retryTaskId,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: parentTaskId });
  });

  it("scopes scene image deletion to the history record currently being viewed", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const createSceneDetail = (taskId: string, title: string, assetId: string) => ({
      events: [],
      input: {
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            prompt: `${title} prompt`,
            purpose: title,
            ratio: "3:4",
            sortOrder: 0,
            title,
          },
        ],
        kind: "scene-image-generation",
        outputMode: "single",
        ratio: "3:4",
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: assetId,
            localPath: `/workspace/current/assets/generated/${taskId}.png`,
            relativePath: `assets/generated/${taskId}.png`,
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: {
        completedAt: taskId.includes("new") ? "2026-07-12T12:00:10.000Z" : "2026-07-12T11:00:10.000Z",
        createdAt: taskId.includes("new") ? "2026-07-12T12:00:00.000Z" : "2026-07-12T11:00:00.000Z",
        id: taskId,
        kind: "image-generation",
        promptPlanId: `${taskId}-plan`,
        stage: "completed",
        status: "succeeded",
        title,
        updatedAt: taskId.includes("new") ? "2026-07-12T12:00:10.000Z" : "2026-07-12T11:00:10.000Z",
        workspace: "scene",
      },
    });
    const newest = createSceneDetail("task_scene_new", "新场景图片", "asset_scene_new");
    const older = createSceneDetail("task_scene_old", "旧场景图片", "asset_scene_old");
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "scene" ? [newest.task, older.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(
          (args as { taskId?: string } | undefined)?.taskId === older.task.id ? older : newest,
        );
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("2"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByText("旧场景图片").closest("button") as HTMLButtonElement);
    const restoredCard = screen.getByTestId("generated-detail-image-card");
    await user.hover(restoredCard);
    await user.click(within(restoredCard).getByRole("button", { name: "删除 S1 旧场景图片" }));
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_delete_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            assetId: "asset_scene_old",
            imageId: "scene-s1",
            taskId: "task_scene_old",
          }),
        }),
      ),
    );
  });

  it("tracks scene retry tasks with a restart-safe sequence so workspace reset cancels them", async () => {
    const user = userEvent.setup();
    vi.spyOn(Date, "now").mockReturnValue(1_783_860_000_000);
    const baseInvoke = invokeMock.getMockImplementation();
    const parentDetail = {
      events: [],
      input: {
        campaignStyleLock: "",
        conversionDriver: "visual",
        generationPromptVersion: "v7",
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            negativeConstraints: "禁止虚构信息",
            prompt: "历史失败场景 prompt",
            promptSummary: "历史失败场景摘要",
            purpose: "历史失败场景",
            ratio: "3:4",
            sortOrder: 0,
            templateId: "hero-image",
            title: "历史失败场景",
            variantId: "base",
          },
        ],
        kind: "scene-image-generation",
        outputMode: "single",
        planningPromptVersion: "v10",
        ratio: "3:4",
        templateCatalogVersion: "v5",
      },
      inputAssets: [
        {
          asset: {
            id: "asset_scene_reference",
            localPath: "/workspace/current/assets/source/cup.png",
            relativePath: "assets/source/cup.png",
          },
          role: "reference",
          sortOrder: 0,
        },
      ],
      outputAssets: [],
      task: {
        completedAt: "2026-07-12T11:00:10.000Z",
        createdAt: "2026-07-12T11:00:00.000Z",
        error: { code: "IMAGE_GENERATION_FAILED", message: "生成失败", retryable: true },
        id: "task_scene_retry_parent",
        kind: "image-generation",
        promptPlanId: "task_scene_retry_plan",
        stage: "failed",
        status: "failed",
        title: "历史失败场景图片",
        updatedAt: "2026-07-12T11:00:10.000Z",
        workspace: "scene",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      const taskInput = (args as { input?: { input?: Record<string, unknown> } } | undefined)?.input?.input;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [parentDetail.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail" && taskId === parentDetail.task.id) {
        return Promise.resolve(parentDetail);
      }
      if (command === "generation_create_task" && taskInput?.singleImageRetry === true) {
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-12T12:00:00.000Z",
          id: "task_scene_retry_child",
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "重新生成 S1 历史失败场景",
          updatedAt: "2026-07-12T12:00:00.000Z",
          workspace: "scene",
        });
      }
      if (command === "generation_run_task" && taskId === "task_scene_retry_child") {
        return new Promise(() => undefined);
      }
      if (command === "generation_cancel_task") {
        return Promise.resolve({ cancelled: true });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "生成记录" }))
        .getByText("历史失败场景图片")
        .closest("button") as HTMLButtonElement,
    );
    const failedCard = screen.getByTestId("failed-result-card");
    await user.hover(failedCard);
    await user.click(within(failedCard).getByRole("button", { name: "重试 S1 历史失败场景" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            idempotencyKey: "task_scene_retry_parent:scene-s1:scene-retry:1783860000000",
            input: expect.objectContaining({ retrySequence: 1_783_860_000_000 }),
          }),
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "新建任务" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", {
        taskId: "task_scene_retry_child",
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const cancelledRetryRow = within(screen.getByRole("dialog", { name: "生成记录" }))
      .getByText("历史失败场景图片")
      .closest(".group") as HTMLElement;
    expect(within(cancelledRetryRow).getByText("失败")).toBeInTheDocument();
    expect(within(cancelledRetryRow).queryByText("生成中")).not.toBeInTheDocument();
  });

  it("does not replace a scene result after reset while resolving the persisted parent asset", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let parentDetailReads = 0;
    let resolvePersistedLookup: ((detail: Record<string, unknown>) => void) | undefined;
    const parentDetail = {
      events: [],
      input: {
        campaignStyleLock: "",
        conversionDriver: "visual",
        generationPromptVersion: "v7",
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            negativeConstraints: "禁止虚构信息",
            prompt: "等待父槽位场景 prompt",
            promptSummary: "等待父槽位场景摘要",
            purpose: "等待父槽位场景",
            ratio: "3:4",
            sortOrder: 0,
            templateId: "hero-image",
            title: "等待父槽位场景",
            variantId: "base",
          },
        ],
        kind: "scene-image-generation",
        outputMode: "single",
        planningPromptVersion: "v10",
        ratio: "3:4",
        templateCatalogVersion: "v5",
      },
      inputAssets: [
        {
          asset: {
            id: "asset_scene_reference",
            localPath: "/workspace/current/assets/source/cup.png",
            relativePath: "assets/source/cup.png",
          },
          role: "reference",
          sortOrder: 0,
        },
      ],
      outputAssets: [],
      task: {
        completedAt: "2026-07-12T11:00:10.000Z",
        createdAt: "2026-07-12T11:00:00.000Z",
        error: { code: "IMAGE_GENERATION_FAILED", message: "生成失败", retryable: true },
        id: "task_scene_replace_parent",
        kind: "image-generation",
        promptPlanId: "task_scene_replace_plan",
        stage: "failed",
        status: "failed",
        title: "等待父槽位场景图片",
        updatedAt: "2026-07-12T11:00:10.000Z",
        workspace: "scene",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      const taskInput = (args as { input?: { input?: Record<string, unknown> } } | undefined)?.input?.input;
      if (command === "generation_list_tasks") {
        const items = workspace === "scene" ? [parentDetail.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail" && taskId === parentDetail.task.id) {
        parentDetailReads += 1;
        if (parentDetailReads >= 3) {
          return new Promise((resolve) => {
            resolvePersistedLookup = resolve;
          });
        }
        return Promise.resolve(parentDetail);
      }
      if (command === "generation_create_task" && taskInput?.singleImageRetry === true) {
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-12T12:00:00.000Z",
          id: "task_scene_replace_child",
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "重新生成 S1 等待父槽位场景",
          updatedAt: "2026-07-12T12:00:00.000Z",
          workspace: "scene",
        });
      }
      if (command === "generation_run_task" && taskId === "task_scene_replace_child") {
        return Promise.resolve({ invocationId: "inv_scene_replace_child", taskId });
      }
      if (command === "generation_get_task_detail" && taskId === "task_scene_replace_child") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                id: "asset_scene_replacement",
                localPath: "/workspace/current/assets/generated/scene-replacement.png",
                relativePath: "assets/generated/scene-replacement.png",
              },
              role: "output",
              sortOrder: 0,
            },
          ],
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "completed",
            status: "succeeded",
            workspace: "scene",
          },
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "生成记录" }))
        .getByText("等待父槽位场景图片")
        .closest("button") as HTMLButtonElement,
    );
    const failedCard = screen.getByTestId("failed-result-card");
    await user.hover(failedCard);
    await user.click(within(failedCard).getByRole("button", { name: "重试 S1 等待父槽位场景" }));
    await waitFor(() => expect(resolvePersistedLookup).toBeDefined());

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    await act(async () => {
      resolvePersistedLookup?.(parentDetail);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).not.toHaveBeenCalledWith("generation_replace_result_image", expect.any(Object));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const resetParentRow = within(screen.getByRole("dialog", { name: "生成记录" }))
      .getByText("等待父槽位场景图片")
      .closest(".group") as HTMLElement;
    expect(within(resetParentRow).getByText("失败")).toBeInTheDocument();
    expect(within(resetParentRow).queryByText("生成中")).not.toBeInTheDocument();
  });

  it("loads later clothing history pages when auxiliary tasks fill the first page", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const auxiliaryTasks = Array.from({ length: 20 }, (_, index) => ({
      attemptNo: 1,
      completedAt: "2026-07-02T10:50:00.000Z",
      createdAt: `2026-07-02T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
      id: `task_clothing_auxiliary_${index + 1}`,
      kind: "image-generation",
      stage: "completed",
      status: "succeeded",
      title: "生成基准模特",
      updatedAt: "2026-07-02T10:50:00.000Z",
      workspace: "clothing",
    }));
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const query = (args as { query?: { page?: number; workspace?: string } } | undefined)?.query;
        if (query?.workspace === "product") {
          return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
        }
        if (query?.workspace === "clothing" && query.page === 1) {
          return Promise.resolve({ items: auxiliaryTasks, page: 1, pageSize: 20, total: 21 });
        }
        if (query?.workspace === "clothing" && query.page === 2) {
          return Promise.resolve({
            items: [
              {
                attemptNo: 1,
                completedAt: "2026-07-02T09:00:00.000Z",
                createdAt: "2026-07-02T08:59:00.000Z",
                id: "task_clothing_result_page_2",
                kind: "image-generation",
                stage: "completed",
                status: "succeeded",
                title: "服饰场景图",
                updatedAt: "2026-07-02T09:00:00.000Z",
                workspace: "clothing",
              },
            ],
            page: 2,
            pageSize: 20,
            total: 21,
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId.startsWith("task_clothing_auxiliary_")) {
          return Promise.resolve({
            events: [],
            input: { kind: "clothing-base-model-generation" },
            inputAssets: [],
            outputAssets: [],
            task: auxiliaryTasks.find((task) => task.id === taskId),
          });
        }
        if (taskId === "task_clothing_result_page_2") {
          return Promise.resolve({
            events: [],
            input: {
              items: [{ id: "scene-1", poseAction: "自然站立", ratio: "3:4", scene: "都市街头" }],
              kind: "clothing-tryon-generation",
              ratio: "3:4",
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_clothing_page_2",
                  localPath: "/workspace/current/assets/generated/clothing-page-2.png",
                  relativePath: "assets/generated/clothing-page-2.png",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              createdAt: "2026-07-02T08:59:00.000Z",
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              title: "服饰场景图",
              updatedAt: "2026-07-02T09:00:00.000Z",
              workspace: "clothing",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", {
        query: { page: 2, pageSize: 20, workspace: "clothing" },
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));

    expect(screen.getByText("服饰场景图")).toBeInTheDocument();
    expect(screen.getByText(/都市街头 · 3:4 · 1 张/)).toBeInTheDocument();
  });

  it("loads the sixth clothing history page instead of truncating restored records", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const laterTask = createRestoredClothingTaskDetail(
      "task_clothing_result_page_6",
      "第六页服饰场景图",
    );
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const query = (args as { query?: { page?: number; workspace?: string } } | undefined)?.query;
        if (query?.workspace === "product") {
          return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
        }
        if (query?.workspace === "clothing" && query.page && query.page <= 5) {
          return Promise.resolve({
            items: Array.from({ length: 20 }, (_, index) => ({
              id: `task_clothing_planning_${query.page}_${index + 1}`,
              kind: "prompt-plan",
              stage: "completed",
              status: "succeeded",
              workspace: "clothing",
            })),
            page: query.page,
            pageSize: 20,
            total: 101,
          });
        }
        if (query?.workspace === "clothing" && query.page === 6) {
          return Promise.resolve({
            items: [laterTask.task],
            page: 6,
            pageSize: 20,
            total: 101,
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === laterTask.task.id) {
          return Promise.resolve(laterTask);
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", {
        query: { page: 6, pageSize: 20, workspace: "clothing" },
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(within(screen.getByRole("dialog", { name: "生成记录" })).getByRole("button", { name: "服饰" }));

    expect(screen.getByText("第六页服饰场景图")).toBeInTheDocument();
  });

  it("restores clothing history when listing product tasks fails", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clothingTask = createRestoredClothingTaskDetail(
      "task_clothing_after_product_list_failure",
      "商品历史读取失败后保留的服饰图",
    );
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        if (workspace === "product") {
          return Promise.reject(new Error("product task list failed"));
        }
        if (workspace === "clothing") {
          return Promise.resolve({ items: [clothingTask.task], page: 1, pageSize: 20, total: 1 });
        }
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(clothingTask);
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_get_task_detail", {
        taskId: clothingTask.task.id,
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));

    expect(screen.getByText(clothingTask.task.title)).toBeInTheDocument();
    expect(screen.getByText("1 条本地记录")).toBeInTheDocument();
    expect(warnMock).toHaveBeenCalledWith("restore product generation task list failed", expect.any(Error));
  });

  it("derives clothing history status from retried image slots", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const completedAfterRetries = createRestoredClothingTaskDetail(
      "task_clothing_failed_then_retried",
      "全部重试成功的服饰图",
    );
    completedAfterRetries.task.status = "failed";
    const partiallyRetried = createRestoredClothingTaskDetail(
      "task_clothing_partially_retried",
      "部分重试成功的服饰图",
    );
    partiallyRetried.task.status = "failed";
    partiallyRetried.input.items.push({
      id: "task_clothing_partially_retried-item-2",
      poseAction: "侧身展示服装轮廓",
      ratio: "3:4",
      scene: "街角咖啡",
    });
    const allFailed = createRestoredClothingTaskDetail(
      "task_clothing_all_failed",
      "全部生成失败的服饰图",
    );
    allFailed.task.status = "failed";
    allFailed.outputAssets = [];

    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "clothing"
          ? [completedAfterRetries.task, partiallyRetried.task, allFailed.task]
          : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        return Promise.resolve(
          taskId === completedAfterRetries.task.id
            ? completedAfterRetries
            : taskId === partiallyRetried.task.id
              ? partiallyRetried
              : allFailed,
        );
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("3"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));

    const completedRow = screen.getByText("全部重试成功的服饰图").closest(".group");
    const partialRow = screen.getByText("部分重试成功的服饰图").closest(".group");
    const failedRow = screen.getByText("全部生成失败的服饰图").closest(".group");
    expect(completedRow).not.toBeNull();
    expect(partialRow).not.toBeNull();
    expect(failedRow).not.toBeNull();
    expect(within(completedRow as HTMLElement).getByText("已完成")).toBeInTheDocument();
    expect(within(partialRow as HTMLElement).getByText("部分失败")).toBeInTheDocument();
    expect(within(failedRow as HTMLElement).getByText("失败")).toBeInTheDocument();
  });

  it("restores the newest clothing retry when retries share the same persisted second", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const parentTask = createRestoredClothingTaskDetail("task_clothing_retry_parent", "服饰场景图");
    const retryTask = {
      events: [],
      input: {
        items: [
          {
            id: "task_clothing_retry_parent-item-1",
            imageId: "live-clothing-image-id",
            imageNo: 1,
            poseAction: "自然站立展示服装版型",
            ratio: "3:4",
            scene: "都市街头",
          },
        ],
        kind: "clothing-tryon-generation",
        parentTaskId: parentTask.task.id,
        ratio: "3:4",
        retrySequence: 2,
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_clothing_retry_restored",
            localPath: "/workspace/current/assets/generated/clothing-retry-restored.png",
            relativePath: "assets/generated/clothing-retry-restored.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: {
        completedAt: "2026-07-02T11:00:00.000Z",
        createdAt: "2026-07-02T10:59:00.000Z",
        id: "task_clothing_retry_restored",
        kind: "image-generation",
        stage: "completed",
        status: "succeeded",
        title: "重新生成 都市街头",
        updatedAt: "2026-07-02T11:00:00.000Z",
        workspace: "clothing",
      },
    };
    const olderRetryTask = {
      ...retryTask,
      input: {
        ...retryTask.input,
        retrySequence: 1,
      },
      outputAssets: [
        {
          asset: {
            id: "asset_clothing_retry_older",
            localPath: "/workspace/current/assets/generated/clothing-retry-older.png",
            relativePath: "assets/generated/clothing-retry-older.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: {
        ...retryTask.task,
        completedAt: "2026-07-02T11:00:00.000Z",
        createdAt: "2026-07-02T10:59:00.000Z",
        id: "task_clothing_retry_older",
        updatedAt: "2026-07-02T11:00:00.000Z",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "clothing" ? [retryTask.task, olderRetryTask.task, parentTask.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === retryTask.task.id) {
          return Promise.resolve(retryTask);
        }
        return Promise.resolve(taskId === olderRetryTask.task.id ? olderRetryTask : parentTask);
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_get_task_detail", {
        taskId: retryTask.task.id,
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));

    expect(screen.getByText("1 条本地记录")).toBeInTheDocument();
    expect(screen.queryByText("重新生成 都市街头")).not.toBeInTheDocument();
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
    expect(screen.getByRole("img", { name: "都市街头" })).toHaveAttribute(
      "src",
      expect.stringContaining("clothing-retry-restored.png"),
    );
  });

  it("keeps the persisted clothing imageId after restoring a pending retry merge", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const parentTaskId = "task_clothing_stable_image_parent";
    const stableImageId = "stable-clothing-image-id";
    const parentTaskBase = createRestoredClothingTaskDetail(parentTaskId, "服饰场景图");
    const parentTask = {
      ...parentTaskBase,
      input: {
        ...parentTaskBase.input,
        items: [{ ...parentTaskBase.input.items[0], imageId: stableImageId }],
      },
    };
    const retryTask = {
      events: [],
      input: {
        items: [
          {
            id: `${parentTaskId}-item-1`,
            imageId: stableImageId,
            imageNo: 1,
            poseAction: "自然站立展示服装版型",
            ratio: "3:4",
            scene: "都市街头",
          },
        ],
        kind: "clothing-tryon-generation",
        parentTaskId,
        ratio: "3:4",
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_clothing_stable_retry",
            localPath: "/workspace/current/assets/generated/clothing-stable-retry.png",
            relativePath: "assets/generated/clothing-stable-retry.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: {
        completedAt: "2026-07-11T08:01:00.000Z",
        createdAt: "2026-07-11T08:00:30.000Z",
        id: "task_clothing_stable_image_retry",
        kind: "image-generation",
        stage: "completed",
        status: "succeeded",
        title: "重新生成 都市街头",
        updatedAt: "2026-07-11T08:01:00.000Z",
        workspace: "clothing",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "clothing" ? [retryTask.task, parentTask.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(
          (args as { taskId?: string } | undefined)?.taskId === retryTask.task.id ? retryTask : parentTask,
        );
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
    expect(screen.getByRole("img", { name: "都市街头" })).toHaveAttribute(
      "src",
      expect.stringContaining("clothing-stable-retry.png"),
    );

    const restoredCard = screen.getByTestId("generated-detail-image-card");
    await user.hover(restoredCard);
    await user.click(within(restoredCard).getByRole("button", { name: "删除 都市街头" }));
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_delete_result_image",
        expect.objectContaining({
          input: expect.objectContaining({ imageId: stableImageId, imageNo: 1, taskId: parentTaskId }),
        }),
      ),
    );
  });

  it.each([
    { stage: "failed", status: "failed", statusLabel: "失败" },
    { stage: "running", status: "running", statusLabel: "生成中" },
  ] as const)("restores a $status clothing retry under its parent record", async ({ stage, status, statusLabel }) => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const now = new Date().toISOString();
    const parentTask = createRestoredClothingTaskDetail(`task_clothing_${status}_retry_parent`, "服饰场景图");
    const retryTask = {
      events: [],
      input: {
        items: [
          {
            id: `${parentTask.task.id}-item-1`,
            imageId: `${parentTask.task.id}-item-1`,
            imageNo: 1,
            poseAction: "自然站立展示服装版型",
            ratio: "3:4",
            scene: "都市街头",
          },
        ],
        kind: "clothing-tryon-generation",
        parentTaskId: parentTask.task.id,
        ratio: "3:4",
      },
      inputAssets: [],
      outputAssets: [],
      task: {
        ...(status === "failed" ? { error: { code: "PROVIDER_TIMEOUT", message: "Provider 连接超时。", retryable: true } } : {}),
        createdAt: now,
        id: `task_clothing_${status}_retry_child`,
        kind: "image-generation",
        stage,
        status,
        title: "重新生成 都市街头",
        updatedAt: now,
        workspace: "clothing",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "clothing" ? [retryTask.task, parentTask.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        return Promise.resolve(taskId === retryTask.task.id ? retryTask : parentTask);
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_get_task_detail", {
        taskId: retryTask.task.id,
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));

    expect(screen.getByText("1 条本地记录")).toBeInTheDocument();
    expect(screen.getByText(statusLabel)).toBeInTheDocument();
    await user.click(within(historyDialog).getByRole("button", { name: "删除记录 服饰场景图" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: retryTask.task.id,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: parentTask.task.id });
  });

  it("deletes a clothing single-image retry created after its parent record was removed", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const parentTask = {
      ...createRestoredClothingTaskDetail("task_clothing_retry_delete_parent", "服饰场景图"),
      inputAssets: [
        { asset: { id: "source_retry_delete", relativePath: "assets/source/retry-delete.png" }, role: "source", sortOrder: 0 },
        { asset: { id: "model_retry_delete", relativePath: "assets/model/retry-delete.png" }, role: "model", sortOrder: 1 },
      ],
      outputAssets: [],
      task: {
        ...createRestoredClothingTaskDetail("task_clothing_retry_delete_parent", "服饰场景图").task,
        error: { code: "PROVIDER_TIMEOUT", message: "Provider 连接超时。", retryable: true },
        stage: "failed",
        status: "failed",
      },
    };
    let resolveRetryTask: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "clothing" ? [parentTask.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(parentTask);
      }
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-tryon-generation") {
          return new Promise((resolve) => {
            resolveRetryTask = resolve;
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_get_task_detail", {
        taskId: parentTask.task.id,
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "服饰" }));
    await user.click(within(historyDialog).getByRole("button", { name: "打开" }));
    await user.click(within(await screen.findByTestId("failed-result-card")).getByRole("button", { name: "重试 都市街头" }));
    await waitFor(() => expect(resolveRetryTask).toBeDefined());

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "删除记录 服饰场景图" }));
    await act(async () => {
      resolveRetryTask?.({
        attemptNo: 1,
        createdAt: "2026-07-02T11:00:00.000Z",
        id: "task_clothing_retry_deleted_parent",
        kind: "image-generation",
        stage: "queued",
        status: "queued",
        title: "重新生成 都市街头",
        updatedAt: "2026-07-02T11:00:00.000Z",
        workspace: "clothing",
      });
    });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: "task_clothing_retry_deleted_parent",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_task", { taskId: "task_clothing_retry_deleted_parent" });
  });

  it("restores healthy history records when another task detail fails", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failedTaskId = "task_clothing_detail_failure";
    const healthyTask = createRestoredClothingTaskDetail(
      "task_clothing_after_detail_failure",
      "单条详情失败后保留的服饰图",
    );
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        if (workspace === "product") {
          return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
        }
        if (workspace === "clothing") {
          return Promise.resolve({
            items: [
              {
                ...healthyTask.task,
                id: failedTaskId,
                title: "损坏的服饰任务",
              },
              healthyTask.task,
            ],
            page: 1,
            pageSize: 20,
            total: 2,
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === failedTaskId) {
          return Promise.reject(new Error("task detail failed"));
        }
        if (taskId === healthyTask.task.id) {
          return Promise.resolve(healthyTask);
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_get_task_detail", {
        taskId: healthyTask.task.id,
      }),
    );
    await user.click(screen.getByRole("button", { name: /生成记录/ }));

    expect(screen.getByText(healthyTask.task.title)).toBeInTheDocument();
    expect(screen.getByText("1 条本地记录")).toBeInTheDocument();
    expect(warnMock).toHaveBeenCalledWith(
      `restore generation task detail failed: ${failedTaskId}`,
      expect.any(Error),
    );
  });

  it("limits concurrent task detail requests while restoring history", async () => {
    const baseInvoke = invokeMock.getMockImplementation();
    const clothingTasks = Array.from({ length: 20 }, (_, index) => ({
      attemptNo: 1,
      completedAt: "2026-07-02T10:50:00.000Z",
      createdAt: `2026-07-02T10:${String(59 - index).padStart(2, "0")}:00.000Z`,
      id: `task_clothing_restore_${index + 1}`,
      kind: "image-generation",
      stage: "completed",
      status: "succeeded",
      title: "服饰场景图",
      updatedAt: "2026-07-02T10:50:00.000Z",
      workspace: "clothing",
    }));
    let detailRequestCount = 0;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const query = (args as { query?: { workspace?: string } } | undefined)?.query;
        if (query?.workspace === "product") {
          return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
        }
        if (query?.workspace === "clothing") {
          return Promise.resolve({ items: clothingTasks, page: 1, pageSize: 20, total: 20 });
        }
      }
      if (command === "generation_get_task_detail") {
        detailRequestCount += 1;
        return new Promise(() => {});
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(detailRequestCount).toBeGreaterThan(0));
    expect(detailRequestCount).toBeLessThanOrEqual(4);
  });

  it("keeps the config panel visible when opening a running history record", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              createdAt: "2026-07-02T10:29:00.000Z",
              id: "task_running_product_detail",
              kind: "image-generation",
              promptPlanId: "local-task_running_product_detail",
              stage: "calling-provider",
              status: "running",
              title: "商品详情图",
              updatedAt: new Date().toISOString(),
              workspace: "product",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_running_product_detail") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              language: "中文",
              market: "中国",
              platform: "淘宝天猫",
              productSellingPoints: "藏青运动风字母印花圆领短袖T恤",
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_running_1",
                  localPath: "/workspace/current/assets/generated/running-1.jpeg",
                  relativePath: "assets/generated/running-1.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/running-1.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              planId: "local-task_running_product_detail",
              items: [
                {
                  id: "running-hero",
                  intent: {
                    imagePrompt: "running prompt",
                    sceneDescription: "running scene",
                  },
                  title: "首屏主视觉",
                },
              ],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "local-task_running_product_detail",
              stage: "calling-provider",
              status: "running",
              title: "商品详情图",
              updatedAt: new Date().toISOString(),
              workspace: "product",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "打开" }));

    expect(screen.getByRole("complementary", { name: "生成配置" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
      "src",
      expect.stringContaining("running-1.jpeg"),
    );
  });

  it("does not let a background product poll replace the currently opened history record", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let currentTaskDetailCalls = 0;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              completedAt: "2026-07-02T10:30:00.000Z",
              createdAt: "2026-07-02T10:29:00.000Z",
              id: "task_old_product_detail",
              kind: "image-generation",
              promptPlanId: "local-task_old_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "历史商品详情图",
              updatedAt: "2026-07-02T10:30:00.000Z",
              workspace: "product",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_old_product_detail") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              language: "中文",
              market: "中国",
              platform: "淘宝天猫",
              productSellingPoints: "历史商品",
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_old_1",
                  localPath: "/workspace/current/assets/generated/old-history.jpeg",
                  relativePath: "assets/generated/old-history.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/old-history.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              planId: "local-task_old_product_detail",
              items: [
                {
                  id: "old-hero",
                  intent: {
                    imagePrompt: "old prompt",
                    sceneDescription: "old scene",
                  },
                  title: "历史首屏图",
                },
              ],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "local-task_old_product_detail",
              stage: "completed",
              status: "succeeded",
              title: "历史商品详情图",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_image-generation") {
          currentTaskDetailCalls += 1;
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets:
              currentTaskDetailCalls > 1
                ? [
                    {
                      asset: {
                        id: "asset_current_1",
                        localPath: "/workspace/current/assets/generated/current-task.jpeg",
                        relativePath: "assets/generated/current-task.jpeg",
                        url: "asset://localhost/workspace/current/assets/generated/current-task.jpeg",
                      },
                      role: "output",
                      sortOrder: 0,
                    },
                  ]
                : [],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: currentTaskDetailCalls > 1 ? "completed" : "calling-provider",
              status: currentTaskDetailCalls > 1 ? "succeeded" : "running",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/current.png",
        name: "current.png",
        path: "/Users/demo/Pictures/current.png",
        src: "asset://current.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "当前商品");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: /生成详情图/ }));
    await waitFor(() => expect(currentTaskDetailCalls).toBe(1));

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const openButtons = screen.getAllByRole("button", { name: "打开" });
    await user.click(openButtons[openButtons.length - 1]);
    expect(screen.getByRole("img", { name: "历史首屏图" })).toHaveAttribute(
      "src",
      expect.stringContaining("old-history.jpeg"),
    );

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    vi.useRealTimers();

    expect(screen.getByRole("img", { name: "历史首屏图" })).toHaveAttribute(
      "src",
      expect.stringContaining("old-history.jpeg"),
    );
    expect(screen.queryByRole("img", { name: "首屏主视觉" })).not.toBeInTheDocument();
  });

  it("keeps restored single-image retries scoped to their original product task", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              completedAt: "2026-07-02T11:10:00.000Z",
              createdAt: "2026-07-02T11:09:00.000Z",
              id: "task_perfume_detail",
              kind: "image-generation",
              promptPlanId: "local-task_perfume_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品详情图",
              updatedAt: "2026-07-02T11:10:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T11:00:00.000Z",
              createdAt: "2026-07-02T10:59:00.000Z",
              id: "task_tshirt_detail",
              kind: "image-generation",
              promptPlanId: "local-task_tshirt_detail",
              stage: "completed",
              status: "succeeded",
              title: "商品详情图",
              updatedAt: "2026-07-02T11:00:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T11:01:00.000Z",
              createdAt: "2026-07-02T11:00:30.000Z",
              id: "task_tshirt_retry_second",
              kind: "image-generation",
              promptPlanId: "retry-task_tshirt_detail-1",
              stage: "completed",
              status: "succeeded",
              title: "重新生成 使用场景图",
              updatedAt: "2026-07-02T11:01:00.000Z",
              workspace: "product",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 3,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_perfume_detail" || taskId === "task_tshirt_detail") {
          const isPerfume = taskId === "task_perfume_detail";
          const productName = isPerfume ? "玻璃滴管精华瓶" : "藏青运动风短袖T恤";
          const filePrefix = isPerfume ? "perfume" : "tshirt";
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              platform: "淘宝天猫",
              market: "中国",
              language: "中文",
              productSellingPoints: productName,
              sourceImageNames: [`${filePrefix}.png`],
              userImages: [
                {
                  dataUrl: `data:image/png;base64,${filePrefix}-source`,
                  mimeType: "image/png",
                  originalName: `${filePrefix}.png`,
                },
              ],
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: `asset_${filePrefix}_hero`,
                  relativePath: `assets/generated/${filePrefix}-hero.jpeg`,
                },
                role: "output",
                sortOrder: 0,
              },
              {
                asset: {
                  id: `asset_${filePrefix}_scenario`,
                  relativePath: `assets/generated/${filePrefix}-scenario.jpeg`,
                },
                role: "output",
                sortOrder: 1,
              },
            ],
            promptPlanSnapshot: {
              planId: `local-${taskId}`,
              items: [
                {
                  id: `${filePrefix}-hero-image`,
                  intent: {
                    groupId: `${filePrefix}-style`,
                    groupTitle: isPerfume ? "极简高级风" : "日常场景风",
                    imageNo: 1,
                    imagePrompt: `${productName} 首屏 prompt`,
                    sceneDescription: `${productName} 首屏场景`,
                  },
                  title: "首屏主视觉",
                },
                {
                  id: `${filePrefix}-scenario-image`,
                  intent: {
                    groupId: `${filePrefix}-style`,
                    groupTitle: isPerfume ? "极简高级风" : "日常场景风",
                    imageNo: 2,
                    imagePrompt: `${productName} 使用场景 prompt`,
                    sceneDescription: `${productName} 使用场景`,
                  },
                  title: "使用场景图",
                },
              ],
            },
            task: {
              createdAt: isPerfume ? "2026-07-02T11:09:00.000Z" : "2026-07-02T10:59:00.000Z",
              id: taskId,
              kind: "image-generation",
              promptPlanId: `local-${taskId}`,
              stage: "completed",
              status: "succeeded",
              title: "商品详情图",
              updatedAt: isPerfume ? "2026-07-02T11:10:00.000Z" : "2026-07-02T11:00:00.000Z",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_tshirt_retry_second") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              platform: "淘宝天猫",
              market: "中国",
              language: "中文",
              productSellingPoints: "藏青运动风短袖T恤",
              items: [
                {
                  imageId: "task_tshirt_detail-1",
                  imageNo: 2,
                  title: "使用场景图",
                },
              ],
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_tshirt_retry_second",
                  relativePath: "assets/generated/tshirt-retry-second.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              planId: "retry-task_tshirt_detail-1",
              items: [
                {
                  id: "task_tshirt_detail-1",
                  title: "使用场景图",
                },
              ],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "retry-task_tshirt_detail-1",
              stage: "completed",
              status: "succeeded",
              title: "重新生成 使用场景图",
              workspace: "product",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getAllByRole("button", { name: "打开" })[0]);

    expect(screen.getByRole("checkbox", { name: "选择 极简高级风 分组" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "选择 日常场景风 分组" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "使用场景图" })).toHaveAttribute(
      "src",
      expect.stringContaining("perfume-scenario.jpeg"),
    );
    expect(screen.getByRole("img", { name: "使用场景图" })).not.toHaveAttribute(
      "src",
      expect.stringContaining("tshirt-retry-second.jpeg"),
    );
  });

  it("keeps the persisted product imageId after restoring a pending retry merge", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    const parentTaskId = "task_product_stable_image_parent";
    const stableImageId = "stable-product-image-id";
    const parentTask = {
      events: [],
      input: {
        items: [{ imageId: stableImageId, imageNo: 1, title: "商品细节图" }],
        kind: "product-detail-generation",
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_product_parent",
            localPath: "/workspace/current/assets/generated/product-parent.png",
            relativePath: "assets/generated/product-parent.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      promptPlanSnapshot: {
        items: [{ id: "legacy-plan-item", intent: { imageNo: 1 }, title: "商品细节图" }],
        planId: `local-${parentTaskId}`,
      },
      task: {
        completedAt: "2026-07-11T08:00:00.000Z",
        createdAt: "2026-07-11T07:59:00.000Z",
        id: parentTaskId,
        kind: "image-generation",
        promptPlanId: `local-${parentTaskId}`,
        stage: "completed",
        status: "succeeded",
        title: "商品详情图",
        updatedAt: "2026-07-11T08:00:00.000Z",
        workspace: "product",
      },
    };
    const retryTask = {
      events: [],
      input: {
        items: [{ imageId: stableImageId, imageNo: 1, title: "商品细节图" }],
        kind: "product-detail-generation",
        parentTaskId,
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_product_retry",
            localPath: "/workspace/current/assets/generated/product-retry.png",
            relativePath: "assets/generated/product-retry.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      promptPlanSnapshot: {
        items: [{ id: stableImageId, title: "商品细节图" }],
        planId: `retry-${stableImageId}`,
      },
      task: {
        completedAt: "2026-07-11T08:01:00.000Z",
        createdAt: "2026-07-11T08:00:30.000Z",
        id: "task_product_stable_image_retry",
        kind: "image-generation",
        promptPlanId: `retry-${stableImageId}`,
        stage: "completed",
        status: "succeeded",
        title: "重新生成 商品细节图",
        updatedAt: "2026-07-11T08:01:00.000Z",
        workspace: "product",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "product" ? [retryTask.task, parentTask.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_get_task_detail") {
        return Promise.resolve(
          (args as { taskId?: string } | undefined)?.taskId === retryTask.task.id ? retryTask : parentTask,
        );
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(within(screen.getByRole("dialog", { name: "生成记录" })).getByRole("button", { name: "打开" }));
    expect(screen.getByRole("img", { name: "商品细节图" })).toHaveAttribute(
      "src",
      expect.stringContaining("product-retry.png"),
    );

    const restoredCard = screen.getByTestId("generated-detail-image-card");
    await user.hover(restoredCard);
    await user.click(within(restoredCard).getByRole("button", { name: "删除 商品细节图" }));
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_delete_result_image",
        expect.objectContaining({
          input: expect.objectContaining({ imageId: stableImageId, imageNo: 1, taskId: parentTaskId }),
        }),
      ),
    );
  });

  it("marks stale restored product tasks as interrupted instead of keeping cards loading", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              createdAt: "2000-01-01T00:00:00.000Z",
              id: "task_stale_product_detail",
              kind: "image-generation",
              stage: "calling-provider",
              status: "running",
              title: "商品详情图",
              updatedAt: "2000-01-01T00:01:00.000Z",
              workspace: "product",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_stale_product_detail") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              language: "中文",
              market: "中国",
              platform: "淘宝天猫",
              productSellingPoints: "藏青运动风字母印花圆领短袖T恤",
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_stale_1",
                  localPath: "/workspace/current/assets/generated/stale-1.jpeg",
                  relativePath: "assets/generated/stale-1.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/stale-1.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              items: [
                {
                  id: "hero",
                  title: "首屏主视觉",
                },
                {
                  id: "scenario",
                  title: "使用场景图",
                },
              ],
            },
            task: {
              createdAt: "2000-01-01T00:00:00.000Z",
              id: taskId,
              kind: "image-generation",
              stage: "calling-provider",
              status: "running",
              title: "商品详情图",
              updatedAt: "2000-01-01T00:01:00.000Z",
              workspace: "product",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));

    expect(screen.getByText("部分失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开" }));

    expect(screen.getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
      "src",
      expect.stringContaining("stale-1.jpeg"),
    );
    expect(screen.getByTestId("failed-result-card")).toHaveTextContent("生成中断");
    expect(screen.queryByText("AI 生成中")).not.toBeInTheDocument();

    await user.click(within(screen.getByTestId("failed-result-card")).getByRole("button", { name: "删除 使用场景图" }));
    expect(invokeMock).not.toHaveBeenCalledWith("generation_delete_result_image", expect.any(Object));
    await user.click(
      within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }),
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_delete_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            imageId: "task_stale_product_detail:scenario",
            imageNo: 2,
            taskId: "task_stale_product_detail",
          }),
        }),
      ),
    );
    const deleteCall = invokeMock.mock.calls.find(([command]) => command === "generation_delete_result_image");
    expect((deleteCall?.[1] as { input?: Record<string, unknown> } | undefined)?.input).not.toHaveProperty("assetId");
    expect(screen.queryByTestId("failed-result-card")).not.toBeInTheDocument();
  });

  it.each([
    {
      cleanupFails: false,
      replaceFails: false,
      title: "retries a failed product image through a real generation task with reference images",
    },
    {
      cleanupFails: false,
      replaceFails: true,
      title: "deletes an unmerged succeeded product retry after replacement fails",
    },
    {
      cleanupFails: true,
      replaceFails: true,
      title: "reports when an unmerged succeeded product retry cannot be deleted",
    },
  ])("$title", async ({ cleanupFails, replaceFails }) => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let retryTaskInput: unknown = null;
    let retryTaskStarted = false;
    let resolveReplaceResult!: () => void;
    let rejectReplaceResult!: (error: Error) => void;
    const replaceResultPromise = new Promise<void>((resolve, reject) => {
      resolveReplaceResult = resolve;
      rejectReplaceResult = reject;
    });
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              createdAt: "2000-01-01T00:00:00.000Z",
              id: "task_retry_source",
              kind: "image-generation",
              stage: "calling-provider",
              status: "running",
              title: "商品详情图",
              updatedAt: "2000-01-01T00:01:00.000Z",
              workspace: "product",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (command === "generation_create_task") {
        retryTaskInput = (args as { input?: unknown } | undefined)?.input;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T12:00:00.000Z",
          id: "task_retry_single_image",
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "重新生成 使用场景图",
          updatedAt: "2026-07-02T12:00:00.000Z",
          workspace: "product",
        });
      }
      if (command === "generation_run_next_task") {
        return Promise.resolve({ invocationId: "inv_old_queued", taskId: "task_old_queued" });
      }
      if (command === "generation_run_task") {
        retryTaskStarted = true;
        return Promise.resolve({ invocationId: "inv_retry_single", taskId: "task_retry_single_image" });
      }
      if (command === "generation_replace_result_image") {
        return replaceResultPromise;
      }
      if (command === "generation_delete_task" && cleanupFails) {
        return Promise.reject(new Error("数据库删除失败"));
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_retry_source") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              language: "中文",
              market: "中国",
              platform: "淘宝天猫",
              productSellingPoints: "藏青运动风字母印花圆领短袖T恤",
            },
            inputAssets: [
              {
                asset: {
                  id: "asset_retry_reference",
                  localPath: "/workspace/current/assets/source/reference.jpeg",
                  mimeType: "image/jpeg",
                  name: "reference.jpeg",
                  originalName: "reference.jpeg",
                  relativePath: "assets/source/reference.jpeg",
                  url: "asset://localhost/workspace/current/assets/source/reference.jpeg",
                },
                role: "source",
                sortOrder: 0,
              },
            ],
            outputAssets: [
              {
                asset: {
                  id: "asset_retry_source_1",
                  localPath: "/workspace/current/assets/generated/source-1.jpeg",
                  relativePath: "assets/generated/source-1.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/source-1.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              items: [
                {
                  id: "hero",
                  intent: {
                    imagePrompt: "首屏主视觉 prompt",
                    sceneDescription: "首屏主视觉描述",
                  },
                  title: "首屏主视觉",
                },
                {
                  id: "scenario",
                  intent: {
                    imagePrompt: "使用场景图 prompt",
                    sceneDescription: "使用场景图描述",
                  },
                  title: "使用场景图",
                },
              ],
            },
            task: {
              createdAt: "2000-01-01T00:00:00.000Z",
              id: taskId,
              kind: "image-generation",
              stage: "calling-provider",
              status: "running",
              title: "商品详情图",
              updatedAt: "2000-01-01T00:01:00.000Z",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_retry_single_image") {
          if (!retryTaskStarted) {
            return Promise.resolve({
              events: [],
              inputAssets: [],
              outputAssets: [],
              task: {
                error: {
                  code: "TASK_NOT_STARTED",
                  message: "单图重试任务没有被精确启动。",
                  retryable: true,
                },
                id: taskId,
                kind: "image-generation",
                stage: "failed",
                status: "failed",
                title: "重新生成 使用场景图",
                workspace: "product",
              },
            });
          }
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_retry_result",
                  localPath: "/workspace/current/assets/generated/retry-result.jpeg",
                  relativePath: "assets/generated/retry-result.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/retry-result.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              title: "重新生成 使用场景图",
              workspace: "product",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "打开" }));

    const failedCard = screen.getByTestId("failed-result-card");
    await user.click(within(failedCard).getByRole("button", { name: "重试 使用场景图" }));

    await waitFor(() => expect(retryTaskInput).not.toBeNull());
    expect(retryTaskInput).toEqual(
      expect.objectContaining({
        inputAssets: [
          {
            assetId: "asset_retry_reference",
            role: "reference",
            sortOrder: 0,
          },
        ],
        input: expect.objectContaining({
          kind: "product-detail-generation",
          items: [
            expect.objectContaining({
              imageNo: 2,
              imagePrompt: expect.stringContaining("必须与参考图保持一致"),
              title: "使用场景图",
            }),
          ],
        }),
        kind: "image-generation",
        title: "重新生成 使用场景图",
        workspace: "product",
      }),
    );
    expect(JSON.stringify(retryTaskInput)).not.toContain("data:image/");
    expect(invokeMock).toHaveBeenCalledWith("generation_run_task", {
      taskId: "task_retry_single_image",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_next_task");
    expect(invokeMock).toHaveBeenCalledWith(
      "generation_replace_result_image",
      expect.objectContaining({
        input: expect.objectContaining({
          replacementAssetId: "asset_retry_result",
          replacementTaskId: "task_retry_single_image",
          taskId: "task_retry_source",
        }),
      }),
    );
    expect(screen.queryByRole("img", { name: "使用场景图" })).not.toBeInTheDocument();
    if (replaceFails) {
      rejectReplaceResult(new Error("父任务槽位已变化"));
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: "task_retry_single_image" }),
      );
      expect(screen.getByTestId("failed-result-card")).toBeInTheDocument();
      expect(
        await screen.findByText(cleanupFails ? /未归并重试任务清理失败/ : /父任务槽位已变化/),
      ).toBeInTheDocument();
    } else {
      resolveReplaceResult();
      expect(await screen.findByRole("img", { name: "使用场景图" })).toHaveAttribute(
        "src",
        expect.stringContaining("retry-result.jpeg"),
      );
    }
  });

  it("links model options to provider selection, closes menus after selection, and allows custom model input", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /模型/ }));
    const providerTrigger = screen.getByRole("button", { name: /文生文 Provider.*OpenAI/ });
    await user.click(providerTrigger);
    await user.click(screen.getByRole("button", { name: "火山引擎" }));

    expect(providerTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OpenAI" })).not.toBeInTheDocument();

    const modelInput = screen.getByRole("textbox", { name: "文生文 模型" });
    expect(modelInput).toHaveValue("doubao-seed-2-1-pro-260628");

    await user.click(screen.getByRole("button", { name: "展开文生文 模型选项" }));
    expect(screen.getByRole("button", { name: "doubao-seed-2-1-turbo-260628" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-5.5" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "doubao-seed-2-0-mini-260428" }));

    expect(screen.getByRole("button", { name: "展开文生文 模型选项" })).toHaveAttribute("aria-expanded", "false");
    expect(modelInput).toHaveValue("doubao-seed-2-0-mini-260428");

    await user.clear(modelInput);
    await user.type(modelInput, "custom-doubao-routing-model");

    expect(modelInput).toHaveValue("custom-doubao-routing-model");
    expect(screen.getByText("火山引擎 / custom-doubao-routing-model")).toBeInTheDocument();
  });

  it("supports DeepSeek provider for text-to-text models", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /模型/ }));
    const providerTrigger = screen.getByRole("button", { name: /文生文 Provider.*OpenAI/ });
    await user.click(providerTrigger);
    await user.click(screen.getByRole("button", { name: "DeepSeek" }));

    expect(providerTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const modelInput = screen.getByRole("textbox", { name: "文生文 模型" });
    expect(modelInput).toHaveValue("deepseek-v4-flash");

    await user.click(screen.getByRole("button", { name: "展开文生文 模型选项" }));

    expect(screen.getByRole("button", { name: "deepseek-v4-flash" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "deepseek-v4-pro" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-5.5" })).not.toBeInTheDocument();
    expect(screen.getByText("DeepSeek / deepseek-v4-flash")).toBeInTheDocument();
  });

  it("limits DeepSeek to text-to-text provider choices and closes provider menus after picking", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /模型/ }));
    const textToImageProviderTrigger = screen.getByRole("button", { name: /文生图 Provider.*OpenAI/ });
    await user.click(textToImageProviderTrigger);

    expect(screen.getByRole("button", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "火山引擎" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DeepSeek" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "OpenAI" }));

    expect(textToImageProviderTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("toggles API key visibility in model cards", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /模型/ }));
    const apiKeyInput = screen.getByRole("textbox", { name: "文生文 API Key" });
    expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置");

    await user.click(screen.getByRole("button", { name: "显示文生文 API Key" }));

    expect(apiKeyInput).toHaveValue("sk-demo-text-1234");

    await user.click(screen.getByRole("button", { name: "隐藏文生文 API Key" }));

    expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••1234");
  });

  it("opens settings workspace and previews notification sound with generated audio", async () => {
    const user = userEvent.setup();

    renderApp();

    const toolbar = screen.getByRole("banner", { name: "应用工具栏" });
    await user.click(within(toolbar).getByRole("button", { name: "设置" }));

    expect(screen.getByRole("main", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(within(navigation).getByRole("button", { name: /设置/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(toolbar).queryByRole("button", { name: "新建任务" })).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-side-divider")).toHaveClass(
      "top-[52px]",
      "bottom-0",
      "left-[var(--studio-nav-width)]",
    );
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("inset-y-0");
    expect(screen.getByText("通用设置")).toBeInTheDocument();
    expect(screen.getByText("存储与输出")).toBeInTheDocument();
    expect(screen.getByText("提醒与通知")).toBeInTheDocument();
    expect(screen.getByText("缓存与清理")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("/workspace/exports")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "提示音" })).not.toBeInTheDocument();
    const soundTrigger = screen.getByRole("button", { name: /提示音.*清脆音效/ });
    expect(soundTrigger).toHaveClass(
      "inline-flex",
      "h-8",
      "rounded-control",
      "bg-slate-100/70",
      "border-white/60",
      "text-[12px]",
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]",
    );
    expect(screen.getByTestId("general-settings-restore-row")).toHaveClass("grid-cols-1");

    const launchToggle = screen.getByRole("button", { name: "开机自动启动" });
    const launchToggleThumb = launchToggle.querySelector("span");
    expect(launchToggle).toHaveClass("h-[18px]", "w-[34px]");
    expect(launchToggleThumb).not.toBeNull();
    expect(launchToggleThumb).toHaveClass("left-0.5", "top-1/2", "-translate-y-1/2", "translate-x-0");

    await user.click(soundTrigger);
    expect(screen.getByRole("button", { name: "爆款提示音" })).toBeInTheDocument();
    const successSoundOption = screen.getByRole("button", { name: "完成音效" });
    expect(successSoundOption).toHaveClass("flex", "h-9", "rounded-[10px]", "text-[12px]");
    await user.click(successSoundOption);
    expect(screen.getByRole("button", { name: /提示音.*完成音效/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "试听提示音" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("settings_play_notification_sound", {
        soundId: "success",
      }),
    );
    expect(audioPlayMock).not.toHaveBeenCalled();
    expect(audioSources).toHaveLength(0);
    expect(audioContextInstances).toHaveLength(0);
  });

  it("maps every scene template to the source ecom-details-image template ids", () => {
    expect(sceneTemplates.map((template) => template.sourceTemplateId)).toEqual([
      "hero-image",
      "lifestyle-scene",
      "flat-lay",
      "detail-macro",
      "poster-banner",
      "social-media",
      "ugc-style",
      "model-showcase",
      "before-after",
      "packaging",
      "infographic",
      "creative-concept",
      "size-spec",
      "multi-product",
      "livestream",
      "try-on-virtual",
      "exploded-view",
      "ghost-mannequin",
      "multi-angle-grid",
      "magazine-editorial",
      "seasonal-campaign",
      "luxury-atmospherics",
      "device-mockup",
      "storefront",
      "sports-campaign",
    ]);
  });

  it("keeps the first UI slice free of right inspector and bottom status regions", () => {
    renderApp();

    expect(screen.queryByRole("complementary", { name: "右侧属性区" })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo", { name: "底部状态栏" })).not.toBeInTheDocument();
  });

  it("keeps failed result cards selectable but out of download and preview actions", async () => {
    const user = userEvent.setup();

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            errorMessage: "生成失败",
            id: "failed-image",
            status: "failed",
            title: "商品主图",
          },
          {
            id: "complete-image",
            status: "complete",
            title: "核心卖点图",
          },
          {
            errorMessage: "生成失败",
            id: "failed-copy",
            kind: "listing-copy",
            status: "failed",
            title: "商品上架文案",
          },
        ]}
      />,
    );

    const failedCards = screen.getAllByTestId("failed-result-card");
    expect(failedCards).toHaveLength(1);
    for (const failedCard of failedCards) {
      expect(failedCard).toHaveTextContent("生成失败");
      expect(failedCard).not.toHaveTextContent("美豆不足");
      expect(failedCard).toHaveClass("border-transparent", "hover:border-slate-950/90");
      expect(failedCard).not.toHaveClass("border-slate-950/90");
      const checkbox = within(failedCard).getByRole("checkbox");
      expect(checkbox.parentElement).toHaveClass("opacity-0", "group-hover:opacity-100");
      const retryButton = within(failedCard).getByRole("button", { name: /重试/ });
      expect(retryButton).toHaveTextContent(/^重新生成$/);
      expect(retryButton.parentElement).toHaveClass("opacity-0", "group-hover:opacity-100");
      expect(retryButton).toHaveClass(
        "h-7",
        "rounded-[6px]",
        "bg-[#e4e4e4]",
        "text-slate-700",
        "transition-colors",
        "duration-300",
        "hover:bg-[#3f3f3f]",
        "hover:text-white",
      );
      const deleteButton = within(failedCard).getByRole("button", { name: /删除/ });
      expect(deleteButton).toHaveClass("size-7", "rounded-[7px]", "bg-white/86", "backdrop-blur-md");
      expect(deleteButton.parentElement).toHaveClass("opacity-0", "group-hover:opacity-100");
      expect(deleteButton.querySelector(".lucide-trash2")).toBeInTheDocument();
      expect(deleteButton.querySelector(".lucide-ellipsis")).not.toBeInTheDocument();
    }
    const failedListingCopyCard = screen.getByTestId("listing-copy-result-card");
    expect(failedListingCopyCard).toHaveTextContent("商品上架文案");
    expect(failedListingCopyCard).toHaveTextContent("生成失败");
    expect(within(failedListingCopyCard).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(failedListingCopyCard).getByRole("button", { name: "重新生成商品上架文案" })).toBeInTheDocument();

    await user.click(within(failedCards[0]).getByRole("checkbox"));

    expect(within(failedCards[0]).getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "删除所选图片" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量下载所选图片" })).not.toBeInTheDocument();

    await user.click(failedCards[0]);

    expect(screen.queryByRole("dialog", { name: "图片相册预览" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览长图" }));

    expect(screen.getAllByTestId("long-preview-image-section")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "查看商品上架文案" })).not.toBeInTheDocument();
  });

  it("uses generated image sources inside the lightbox preview", async () => {
    const user = userEvent.setup();

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            id: "hero-image",
            src: "asset://localhost/workspace/current/assets/generated/hero.jpeg",
            status: "complete",
            title: "首屏主视觉",
          },
          {
            id: "scenario-image",
            src: "asset://localhost/workspace/current/assets/generated/scenario.jpeg",
            status: "complete",
            title: "使用场景图",
          },
        ]}
      />,
    );

    await user.click(screen.getAllByTestId("generated-detail-image-card")[0]);

    const lightbox = screen.getByRole("dialog", { name: "图片相册预览" });
    const previewFrame = within(lightbox).getByLabelText("预览 首屏主视觉");
    const previewImage = within(lightbox).getByRole("img", { name: "首屏主视觉" });
    expect(previewFrame).toHaveClass("max-h-[68vh]", "max-w-[70vw]", "bg-transparent");
    expect(previewFrame).not.toHaveClass("h-[68vh]", "w-[min(68vh,70vw)]", "bg-slate-100");
    expect(previewImage).toHaveClass("block", "h-auto", "w-auto", "max-h-[68vh]", "max-w-[70vw]", "object-contain");
    expect(previewFrame.querySelector("[class*='radial-gradient']")).toBeNull();
    expect(previewImage).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/hero.jpeg",
    );
    expect(within(lightbox).getByRole("img", { name: "缩略图 首屏主视觉" })).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/hero.jpeg",
    );
    expect(within(lightbox).getByRole("img", { name: "缩略图 使用场景图" })).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/scenario.jpeg",
    );
  });

  it("loads current model sizes and submits the selected size with the current image", async () => {
    const user = userEvent.setup();
    const loadImageSizeOptions = vi.fn().mockResolvedValue({
      capabilityId: "image-edit",
      configId: "cfg_image-edit",
      model: "gpt-image-1",
      options: [
        {
          height: 1024,
          id: "1024x1024",
          label: "方图 1:1 · 1024×1024",
          providerValue: "1024x1024",
          ratio: "1:1",
          width: 1024,
        },
        {
          height: 1536,
          id: "1024x1536",
          label: "竖图 2:3 · 1024×1536",
          providerValue: "1024x1536",
          ratio: "2:3",
          width: 1024,
        },
      ],
      providerProfileId: "openai",
    });
    const resizeImage = vi.fn().mockResolvedValue(undefined);

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            assetId: "asset-current",
            id: "hero-image",
            prompt: "保持商品与场景一致",
            ratio: "2:3",
            src: "asset://localhost/workspace/current/assets/generated/hero.webp",
            status: "complete",
            title: "首屏主视觉",
          },
        ]}
        onImageResize={resizeImage}
        onLoadImageSizeOptions={loadImageSizeOptions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "修改尺寸 首屏主视觉" }));

    const dialog = await screen.findByRole("dialog", { name: "修改图片尺寸" });
    expect(loadImageSizeOptions).toHaveBeenCalledWith(expect.objectContaining({ id: "hero-image" }));
    expect(within(dialog).getByText("当前模型：gpt-image-1")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "竖图 2:3 · 1024×1536" })).toBeChecked();

    await user.click(within(dialog).getByRole("radio", { name: "方图 1:1 · 1024×1024" }));
    await user.click(within(dialog).getByRole("button", { name: "修改" }));

    await waitFor(() =>
      expect(resizeImage).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: "asset-current", prompt: "保持商品与场景一致" }),
        expect.objectContaining({ providerValue: "1024x1024", ratio: "1:1" }),
      ),
    );
  });

  it("ignores stale image size responses after switching the resize target", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: ModelImageSizeOptions) => void;
    let resolveSecond!: (value: ModelImageSizeOptions) => void;
    const firstRequest = new Promise<ModelImageSizeOptions>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRequest = new Promise<ModelImageSizeOptions>((resolve) => {
      resolveSecond = resolve;
    });
    const options: ModelImageSizeOptions = {
      capabilityId: "image-edit",
      configId: "cfg_image-edit",
      model: "gpt-image-1",
      options: [
        {
          height: 1024,
          id: "1024x1024",
          label: "方图 1:1 · 1024×1024",
          providerValue: "1024x1024",
          ratio: "1:1",
          width: 1024,
        },
        {
          height: 1536,
          id: "1024x1536",
          label: "竖图 2:3 · 1024×1536",
          providerValue: "1024x1536",
          ratio: "2:3",
          width: 1024,
        },
      ],
      providerProfileId: "openai",
    };
    const loadImageSizeOptions = vi.fn().mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          { id: "portrait-image", ratio: "2:3", status: "complete", title: "竖图" },
          { id: "square-image", ratio: "1:1", status: "complete", title: "方图" },
        ]}
        onImageResize={vi.fn()}
        onLoadImageSizeOptions={loadImageSizeOptions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "修改尺寸 竖图" }));
    await user.click(within(screen.getByRole("dialog", { name: "修改图片尺寸" })).getByRole("button", { name: "关闭修改图片尺寸" }));
    await user.click(screen.getByRole("button", { name: "修改尺寸 方图" }));

    await act(async () => {
      resolveFirst(options);
      await firstRequest;
    });

    const secondDialog = screen.getByRole("dialog", { name: "修改图片尺寸" });
    expect(within(secondDialog).getByText("正在读取模型尺寸…")).toBeInTheDocument();
    expect(within(secondDialog).getByRole("button", { name: "修改" })).toBeDisabled();

    await act(async () => {
      resolveSecond(options);
      await secondRequest;
    });

    expect(within(secondDialog).getByRole("radio", { name: "方图 1:1 · 1024×1024" })).toBeChecked();
  });

  it("keeps a resize submission isolated from other image dialogs", async () => {
    const user = userEvent.setup();
    let resolveResize!: () => void;
    const resizePromise = new Promise<void>((resolve) => {
      resolveResize = resolve;
    });
    const options: ModelImageSizeOptions = {
      capabilityId: "image-edit",
      configId: "cfg_image-edit",
      model: "gpt-image-1",
      options: [
        {
          height: 1024,
          id: "1024x1024",
          label: "方图 1:1 · 1024×1024",
          providerValue: "1024x1024",
          ratio: "1:1",
          width: 1024,
        },
      ],
      providerProfileId: "openai",
    };
    const loadImageSizeOptions = vi.fn().mockResolvedValue(options);

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          { id: "first-image", ratio: "2:3", status: "complete", title: "第一张" },
          { id: "second-image", ratio: "1:1", status: "complete", title: "第二张" },
        ]}
        onImageResize={() => resizePromise}
        onLoadImageSizeOptions={loadImageSizeOptions}
      />,
    );

    await user.click(screen.getByRole("button", { name: "修改尺寸 第一张" }));
    const firstDialog = await screen.findByRole("dialog", { name: "修改图片尺寸" });
    await user.click(within(firstDialog).getByRole("radio", { name: "方图 1:1 · 1024×1024" }));
    await user.click(within(firstDialog).getByRole("button", { name: "修改" }));

    await user.click(screen.getByRole("button", { name: "AI改图 第二张" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "输入微调方向" })).getByRole("button", { name: "关闭微调弹窗" }),
    );
    await user.click(screen.getByRole("button", { name: "修改尺寸 第二张" }));

    expect(screen.queryByRole("dialog", { name: "修改图片尺寸" })).not.toBeInTheDocument();
    expect(loadImageSizeOptions).toHaveBeenCalledTimes(1);

    resolveResize();
    await waitFor(() => expect(screen.getByRole("button", { name: "修改尺寸 第一张" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "修改尺寸 第二张" }));

    expect(await screen.findByRole("dialog", { name: "修改图片尺寸" })).toBeInTheDocument();
    expect(loadImageSizeOptions).toHaveBeenCalledTimes(2);
  });

  it("requires confirmation before deleting one generated image", async () => {
    const user = userEvent.setup();
    const deleteImage = vi.fn().mockResolvedValue(undefined);

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            assetId: "asset-current",
            id: "hero-image",
            status: "complete",
            title: "首屏主视觉",
          },
        ]}
        onImageDelete={deleteImage}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除 首屏主视觉" }));

    const dialog = screen.getByRole("dialog", { name: "删除图片" });
    expect(deleteImage).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "删除图片" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 首屏主视觉" }));
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteImage).toHaveBeenCalledWith(expect.objectContaining({ id: "hero-image" })));
  });

  it("persists bulk image deletions and keeps failed items selected and visible", async () => {
    const user = userEvent.setup();
    const deleteImage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("场景图删除失败"));

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            assetId: "asset-hero",
            id: "hero-image",
            status: "complete",
            title: "首屏主视觉",
          },
          {
            assetId: "asset-scene",
            id: "scene-image",
            status: "complete",
            title: "使用场景图",
          },
        ]}
        onImageDelete={deleteImage}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "选择 首屏主视觉" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 使用场景图" }));
    await user.click(screen.getByRole("button", { name: "删除所选图片" }));

    await waitFor(() => expect(deleteImage).toHaveBeenCalledTimes(2));
    expect(deleteImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "hero-image" }));
    expect(deleteImage).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "scene-image" }));
    expect(screen.queryByRole("checkbox", { name: "选择 首屏主视觉" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 使用场景图" })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("场景图删除失败");
  });

  it("requires confirmation for failed-card single deletion and keeps bulk deletion direct", async () => {
    const user = userEvent.setup();
    const deleteImage = vi.fn().mockResolvedValue(undefined);

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          { errorMessage: "生成失败", id: "failed-hero", imageNo: 1, status: "failed", title: "失败主图" },
          { errorMessage: "生成失败", id: "failed-scene", imageNo: 2, status: "failed", title: "失败场景图" },
        ]}
        onImageDelete={deleteImage}
      />,
    );

    const firstFailedCard = screen.getAllByTestId("failed-result-card")[0];
    await user.click(within(firstFailedCard).getByRole("button", { name: "删除 失败主图" }));
    expect(deleteImage).not.toHaveBeenCalled();
    const deleteDialog = screen.getByRole("dialog", { name: "删除图片" });
    await user.click(within(deleteDialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteImage).toHaveBeenCalledWith(expect.objectContaining({ id: "failed-hero" })));

    await user.click(screen.getByRole("checkbox", { name: "选择 失败场景图" }));
    await user.click(screen.getByRole("button", { name: "删除所选图片" }));
    await waitFor(() => expect(deleteImage).toHaveBeenCalledWith(expect.objectContaining({ id: "failed-scene" })));
    expect(deleteImage).toHaveBeenCalledTimes(2);
  });

  it("downloads the original generated asset bytes without canvas re-encoding", async () => {
    const user = userEvent.setup();
    const originalBytes = new TextEncoder().encode("original-webp-bytes");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(originalBytes, {
        headers: { "Content-Type": "image/webp" },
      }),
    );
    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/hero.webp");

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            assetId: "asset-current",
            assetRelativePath: "assets/generated/hero.webp",
            id: "hero-image",
            src: "asset://localhost/workspace/current/assets/generated/hero.webp",
            status: "complete",
            title: "首屏主视觉",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "下载 首屏主视觉" }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: "首屏主视觉.webp",
          filters: [{ extensions: ["webp"], name: "WEBP" }],
        }),
      ),
    );
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", {
      bytes: Array.from(originalBytes),
      path: "/Users/demo/Desktop/hero.webp",
    });
  });

  it("does not restore a generated image removed from one persisted result", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        return Promise.resolve({
          items:
            workspace === "product"
              ? [
                  {
                    attemptNo: 1,
                    completedAt: "2026-07-11T08:00:10.000Z",
                    createdAt: "2026-07-11T08:00:00.000Z",
                    id: "task_deleted_single_result",
                    kind: "image-generation",
                    promptPlanId: "plan_deleted_single_result",
                    stage: "completed",
                    status: "succeeded",
                    title: "商品详情图",
                    updatedAt: "2026-07-11T08:00:10.000Z",
                    workspace: "product",
                  },
                ]
              : [],
          page: 1,
          pageSize: 50,
          total: workspace === "product" ? 1 : 0,
        });
      }
      if (
        command === "generation_get_task_detail" &&
        (args as { taskId?: string } | undefined)?.taskId === "task_deleted_single_result"
      ) {
        return Promise.resolve({
          events: [
            {
              createdAt: "2026-07-11T08:00:20.000Z",
              detail: { assetId: "asset_deleted", imageId: "task_deleted_single_result:hero", imageNo: 1, sortOrder: 0 },
              eventType: "task.result-image-deleted",
              id: "event_deleted_single_result",
            },
          ],
          input: { kind: "product-detail-generation" },
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                height: 1536,
                id: "asset_kept",
                localPath: "/workspace/current/assets/generated/kept.png",
                relativePath: "assets/generated/kept.png",
                width: 1024,
              },
              role: "output",
              sortOrder: 1,
            },
          ],
          promptPlanSnapshot: {
            items: [
              { id: "hero", title: "已删除首屏图", intent: { imageNo: 1, imagePrompt: "首屏" } },
              { id: "detail", title: "保留细节图", intent: { imageNo: 2, imagePrompt: "细节" } },
            ],
            planId: "plan_deleted_single_result",
          },
          task: {
            attemptNo: 1,
            completedAt: "2026-07-11T08:00:10.000Z",
            createdAt: "2026-07-11T08:00:00.000Z",
            id: "task_deleted_single_result",
            kind: "image-generation",
            promptPlanId: "plan_deleted_single_result",
            stage: "completed",
            status: "succeeded",
            title: "商品详情图",
            updatedAt: "2026-07-11T08:00:10.000Z",
            workspace: "product",
          },
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await waitFor(() => expect(screen.getByRole("button", { name: /生成记录/ })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(within(screen.getByRole("dialog", { name: "生成记录" })).getByRole("button", { name: "打开" }));

    expect(screen.getByRole("img", { name: "保留细节图" })).toBeInTheDocument();
    expect(screen.queryByText("已删除首屏图")).not.toBeInTheDocument();
  });

  it("uses generated images as history thumbnails when records have completed assets", () => {
    render(
      <GenerationHistoryPopover
        activeRecordId={null}
        onClearRecords={() => undefined}
        onClose={() => undefined}
        onDeleteRecord={() => undefined}
        onOpenRecord={() => undefined}
        open
        records={[
          {
            createdAt: Date.parse("2026-07-02T08:59:00.000Z"),
            id: "record-with-assets",
            images: [
              {
                id: "record-with-assets-hero",
                src: "asset://localhost/workspace/current/assets/generated/hero.jpeg",
                status: "complete",
                title: "首屏主视觉",
              },
              {
                id: "record-with-assets-detail",
                src: "asset://localhost/workspace/current/assets/generated/detail.jpeg",
                status: "complete",
                title: "商品细节图",
              },
            ],
            inputSummary: "淘宝天猫 · 中国 · 中文",
            kind: "product-detail",
            status: "complete",
            title: "商品详情图",
            workspace: "product",
          },
        ]}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "生成记录" });
    expect(within(dialog).getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/hero.jpeg",
    );
    expect(within(dialog).getByRole("img", { name: "商品细节图" })).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/detail.jpeg",
    );
  });

  it("exposes the primary product workflow modules as reusable option tiles", () => {
    renderApp();

    expect(screen.getByRole("checkbox", { name: "首屏主视觉" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "核心卖点图" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "商品细节图" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).not.toBeChecked();
  });

  it("defaults product generation settings to Tmall China Chinese", () => {
    renderApp();

    expect(screen.getByRole("button", { name: "淘宝天猫" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中国" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it("disables the browser context menu inside the desktop window", () => {
    renderApp();

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it("opens a local generation history popover and restores generated product results", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "生成记录" }));

    const emptyHistoryDialog = screen.getByRole("dialog", { name: "生成记录" });
    expect(emptyHistoryDialog).toBeInTheDocument();
    expect(emptyHistoryDialog).toHaveClass("fixed", "z-[130]", "bg-white");
    expect(emptyHistoryDialog).not.toHaveClass("bg-white/96", "backdrop-blur-2xl");
    expect(screen.getByTestId("generation-history-empty-state")).toHaveClass("bg-slate-50");
    expect(screen.getByTestId("generation-history-empty-state")).not.toHaveClass("bg-slate-50/95");

    await user.click(screen.getByRole("button", { name: "生成记录" }));
    expect(screen.queryByRole("dialog", { name: "生成记录" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成记录" }));
    await user.click(screen.getByRole("button", { name: "关闭生成记录" }));
    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "网面人像印花无袖运动T恤");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const detailGenerateButton = await screen.findByRole("button", { name: /生成详情图/ });
    fireEvent.click(detailGenerateButton);

    fireEvent.click(screen.getByRole("button", { name: /生成记录/ }));

    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    expect(within(historyDialog).getByText("商品详情图")).toBeInTheDocument();
    expect(within(historyDialog).getByText("生成中")).toBeInTheDocument();
    expect(within(historyDialog).getByText(/淘宝天猫 · 中国 · 中文 · 9:16 · 2 张/)).toBeInTheDocument();

    await waitFor(() => expect(within(historyDialog).getByText("已完成")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "关闭生成记录" }));
    await user.click(screen.getByRole("button", { name: "服饰" }));

    expect(screen.getByText("AI服饰穿戴")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const restoredHistoryDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(restoredHistoryDialog).getAllByRole("button", { name: /商品详情图/ })[0]);

    expect(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /商品/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("complementary", { name: "生成配置" })).not.toBeInTheDocument();
    expect(screen.getByTestId("studio-side-divider")).toHaveClass(
      "top-[52px]",
      "bottom-0",
      "left-[var(--studio-nav-width)]",
    );
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("left-[var(--studio-side-width)]");
    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    expect(screen.getAllByTestId("generated-detail-image-card").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("failed-result-card")).not.toBeInTheDocument();
  });

  it("keeps the product operation panel visible after a normal product generation finishes", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/bottle.png",
        name: "bottle.png",
        path: "/Users/demo/Pictures/bottle.png",
        src: "asset://bottle.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "玻璃滴管精华液分装空瓶，透明瓶身。");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "生成详情图（6张）" }));

    await screen.findByRole("img", { name: "首屏主视觉" });

    expect(screen.getByTestId("studio-side-divider")).toHaveClass("left-[var(--studio-side-width)]");
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("left-[var(--studio-nav-width)]");
    expect(screen.getByText("模块策略与设计规范")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成详情图（6张）" })).toBeInTheDocument();
  });

  it("opens product image selection, previews selected images, and removes them", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
      {
        id: "/Users/demo/Pictures/poster.jpg",
        name: "poster.jpg",
        path: "/Users/demo/Pictures/poster.jpg",
        src: "asset://poster.jpg",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));

    expect(selectProductImagesMock).toHaveBeenCalledWith(3);
    expect(await screen.findByAltText("helmet.png")).toBeInTheDocument();
    expect(screen.getByAltText("poster.jpg")).toBeInTheDocument();
    expect(screen.getAllByTestId("product-image-preview-card")[0]).toHaveClass(
      "rounded-[22px]",
      "p-[3px]",
      "ring-1",
      "ring-slate-200/80",
    );
    expect(screen.getByRole("button", { name: "添加商品原图" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 helmet.png" }));

    expect(screen.queryByAltText("helmet.png")).not.toBeInTheDocument();
    expect(screen.getByAltText("poster.jpg")).toBeInTheDocument();
  });

  it("opens product image selection when clicking the upload dropzone body", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([]);

    renderApp();

    const uploadDropzone = screen.getByRole("button", { name: "上传图片" });
    expect(uploadDropzone).toHaveClass(
      "w-full",
      "border-2",
      "border-dashed",
      "hover:border-blue-200",
    );

    await user.click(screen.getByText("同一产品，多角度图片可提升生成稳定性。"));

    expect(selectProductImagesMock).toHaveBeenCalledWith(3);
  });

  it("uploads clothing images, keeps one selected model, and hides scene controls when AI recommends", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();

    selectProductImagesMock
      .mockResolvedValueOnce([
        {
          id: "/Users/demo/Pictures/look-1.png",
          name: "look-1.png",
          path: "/Users/demo/Pictures/look-1.png",
          src: "asset://look-1.png",
        },
        {
          id: "/Users/demo/Pictures/look-2.png",
          name: "look-2.png",
          path: "/Users/demo/Pictures/look-2.png",
          src: "asset://look-2.png",
        },
        {
          id: "/Users/demo/Pictures/look-3.png",
          name: "look-3.png",
          path: "/Users/demo/Pictures/look-3.png",
          src: "asset://look-3.png",
        },
        {
          id: "/Users/demo/Pictures/look-4.png",
          name: "look-4.png",
          path: "/Users/demo/Pictures/look-4.png",
          src: "asset://look-4.png",
        },
        {
          id: "/Users/demo/Pictures/look-5.png",
          name: "look-5.png",
          path: "/Users/demo/Pictures/look-5.png",
          src: "asset://look-5.png",
        },
        {
          id: "/Users/demo/Pictures/look-6.png",
          name: "look-6.png",
          path: "/Users/demo/Pictures/look-6.png",
          src: "asset://look-6.png",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "/Users/demo/Pictures/model-a.png",
          name: "model-a.png",
          path: "/Users/demo/Pictures/model-a.png",
          src: "asset://model-a.png",
        },
      ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));

    expect(selectProductImagesMock).toHaveBeenLastCalledWith(5);
    expect(await screen.findByAltText("look-1.png")).toBeInTheDocument();
    expect(screen.getByAltText("look-5.png")).toBeInTheDocument();
    expect(screen.queryByAltText("look-6.png")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加服装图片" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上传新模特" }));

    expect(selectProductImagesMock).toHaveBeenLastCalledWith(1);
    const uploadedModel = await screen.findByRole("button", { name: "选择模特 model-a.png" });
    expect(uploadedModel).toHaveAttribute("aria-pressed", "true");
    expect(within(uploadedModel).getByLabelText("已选中 model-a.png")).toBeInTheDocument();

    const builtinModel = await screen.findByRole("button", { name: "选择内置模特 内置模特 01" });
    await user.click(builtinModel);

    expect(uploadedModel).toHaveAttribute("aria-pressed", "false");
    expect(builtinModel).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("已选中 model-a.png")).not.toBeInTheDocument();

    const aiRecommendSwitch = screen.getByRole("button", { name: "AI推荐" });
    expect(aiRecommendSwitch).toHaveAttribute("aria-pressed", "false");

    await user.click(aiRecommendSwitch);

    expect(aiRecommendSwitch).toHaveAttribute("aria-pressed", "true");
    expect(within(aiRecommendSwitch).getByTestId("ai-recommend-switch-thumb")).toHaveClass("translate-x-4");
    expect(screen.queryByText("拍摄场景")).not.toBeInTheDocument();
    expect(screen.queryByText("自定义描述场景")).not.toBeInTheDocument();
  });

  it("shows AI model generation controls after switching the clothing model tab", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));

    expect(screen.getByRole("button", { name: "AI 生成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "上传新模特" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "柔光女模" })).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-model-generation-controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "性别 男" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "年龄 青年" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "人群 中国人" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "体型 匀称" })).toBeInTheDocument();

    const genderSelect = screen.getByRole("button", { name: "性别 男" });

    expect(genderSelect).toHaveClass("h-8", "rounded-control", "border", "border-white/60", "text-[12px]");

    await user.click(genderSelect);

    expect(genderSelect).toHaveClass("border-blue-200", "bg-white", "ring-2", "ring-blue-100/70");

    for (const option of ["男", "女"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "女" }));

    expect(screen.getByRole("button", { name: "性别 女" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "年龄 青年" }));

    for (const option of ["婴儿", "儿童", "青少年", "青年", "中年", "老年"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "中年" }));

    expect(screen.getByRole("button", { name: "年龄 中年" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "人群 中国人" }));

    for (const option of ["欧美白人", "中国人", "东亚人", "东南亚人", "非裔", "中东人", "拉丁裔"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "东南亚人" }));

    expect(screen.getByRole("button", { name: "人群 东南亚人" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "体型 匀称" }));

    for (const option of [
      "纤细",
      "苗条",
      "精瘦",
      "匀称",
      "健美",
      "运动型",
      "肌肉型",
      "壮硕",
      "结实",
      "丰满",
      "微胖",
      "大码",
    ]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    expect(screen.queryByRole("option", { name: "肥胖" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "大码" }));

    expect(screen.getByRole("button", { name: "体型 大码" })).toBeInTheDocument();

    const detailInput = screen.getByRole("textbox", { name: "外貌细节" });
    expect(detailInput).toHaveAttribute("placeholder", "例如：小麦色皮肤、齐刘海、眼角有泪痣...");

    await user.type(detailInput, "小麦色皮肤，短发");

    expect(detailInput).toHaveValue("小麦色皮肤，短发");
    expect(screen.getByRole("button", { name: "生成基准模特" })).toBeInTheDocument();
  });

  it("requests text-to-image generation for clothing base model and shows the generated model", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.type(screen.getByRole("textbox", { name: "外貌细节" }), "寸头，肌肉身材");
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    expect(screen.getByText("正在生成基准模特...")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("generation_create_task", {
      input: expect.objectContaining({
        workspace: "clothing",
        kind: "image-generation",
        title: "生成基准模特",
        input: expect.objectContaining({
          kind: "clothing-base-model-generation",
          gender: "男",
          age: "青年",
          ethnicity: "中国人",
          body: "匀称",
          appearance: "寸头，肌肉身材",
        }),
      }),
    });
    expect(invokeMock).toHaveBeenCalledWith("generation_run_task", {
      taskId: "task_image-generation",
    });

    const generatedModel = await screen.findByRole("button", { name: "选择生成模特 基准模特图" });
    expect(within(generatedModel).getByAltText("基准模特图")).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/generated-1.png",
    );
  });

  it("shows a toast when clothing base model generation fails", async () => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_run_task") {
        return Promise.reject(new Error("模型调用失败"));
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    expect(await screen.findByText("基准模特生成失败：模型调用失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成基准模特" })).toBeEnabled();
  });

  it("cancels a nonterminal base model task before retrying after the start request fails", async () => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();
    let baseModelTaskCount = 0;
    invokeMock.mockImplementation((command, args) => {
      const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_create_task" && input?.input?.kind === "clothing-base-model-generation") {
        baseModelTaskCount += 1;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id: `task_base_model_retry_${baseModelTaskCount}`,
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "生成基准模特",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: "clothing",
        });
      }
      if (command === "generation_run_task" && taskId === "task_base_model_retry_1") {
        return Promise.reject(new Error("启动请求响应丢失"));
      }
      if (command === "generation_cancel_task" && taskId === "task_base_model_retry_1") {
        return Promise.resolve({
          id: taskId,
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "生成基准模特",
          workspace: "clothing",
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_base_model_retry_2") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                id: "asset_retried_base_model",
                localPath: "/workspace/current/assets/generated/retried-base-model.png",
                relativePath: "assets/generated/retried-base-model.png",
              },
              role: "output",
              sortOrder: 0,
            },
          ],
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "completed",
            status: "succeeded",
            workspace: "clothing",
          },
        });
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    expect(await screen.findByText("基准模特生成失败：启动请求响应丢失")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", {
        taskId: "task_base_model_retry_1",
      });
    });
    const cancelCallIndex = invokeMock.mock.calls.findIndex(
      ([command, args]) =>
        command === "generation_cancel_task" &&
        (args as { taskId?: string } | undefined)?.taskId === "task_base_model_retry_1",
    );
    const secondCreateCallIndex = invokeMock.mock.calls.findIndex(
      ([command, args], index) =>
        command === "generation_create_task" &&
        (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind ===
          "clothing-base-model-generation" &&
        index > cancelCallIndex,
    );
    expect(cancelCallIndex).toBeGreaterThanOrEqual(0);
    expect(secondCreateCallIndex).toBeGreaterThan(cancelCallIndex);
    expect(await screen.findByRole("button", { name: "选择生成模特 基准模特图" })).toBeInTheDocument();
  });

  it("cancels and ignores a base model task when starting a new clothing task", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let resolveTaskDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_get_task_detail" && taskId === "task_image-generation") {
        return new Promise((resolve) => {
          resolveTaskDetail = resolve;
        });
      }
      if (command === "generation_cancel_task" && taskId === "task_image-generation") {
        return Promise.resolve({
          id: taskId,
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "生成基准模特",
          workspace: "clothing",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    await waitFor(() => expect(resolveTaskDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", { taskId: "task_image-generation" });
    await act(async () => {
      resolveTaskDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: [
          {
            asset: {
              id: "asset_stale_base_model",
              localPath: "/workspace/current/assets/generated/stale-base-model.png",
              relativePath: "assets/generated/stale-base-model.png",
            },
            role: "output",
            sortOrder: 0,
          },
        ],
        task: {
          id: "task_image-generation",
          kind: "image-generation",
          stage: "completed",
          status: "succeeded",
          workspace: "clothing",
        },
      });
      await Promise.resolve();
    });

    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    expect(screen.queryByRole("button", { name: "选择生成模特 基准模特图" })).not.toBeInTheDocument();
    expect(screen.queryByText(/基准模特生成失败/)).not.toBeInTheDocument();
  });

  it("cancels the previous base model task before regenerating after leaving clothing", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let baseModelTaskCount = 0;
    let resolvePreviousTaskDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_create_task" && input?.input?.kind === "clothing-base-model-generation") {
        baseModelTaskCount += 1;
        const id = `task_base_model_${baseModelTaskCount}`;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id,
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "生成基准模特",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: "clothing",
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_base_model_1") {
        return new Promise((resolve) => {
          resolvePreviousTaskDetail = resolve;
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_base_model_2") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                id: "asset_latest_base_model",
                localPath: "/workspace/current/assets/generated/latest-base-model.png",
                relativePath: "assets/generated/latest-base-model.png",
              },
              role: "output",
              sortOrder: 0,
            },
          ],
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "completed",
            status: "succeeded",
            workspace: "clothing",
          },
        });
      }
      if (command === "generation_cancel_task" && taskId === "task_base_model_1") {
        return Promise.resolve({
          id: taskId,
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "生成基准模特",
          workspace: "clothing",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    await waitFor(() => expect(resolvePreviousTaskDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "商品" }));
    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", { taskId: "task_base_model_1" });
    });
    const cancelCallIndex = invokeMock.mock.calls.findIndex(
      ([command, args]) =>
        command === "generation_cancel_task" && (args as { taskId?: string } | undefined)?.taskId === "task_base_model_1",
    );
    const secondCreateCallIndex = invokeMock.mock.calls.map(
      ([command, args]) =>
        command === "generation_create_task" &&
        (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind ===
          "clothing-base-model-generation",
    ).lastIndexOf(true);
    expect(cancelCallIndex).toBeLessThan(secondCreateCallIndex);
    const currentGeneratedModel = await screen.findByRole("button", { name: "选择生成模特 基准模特图" });
    expect(within(currentGeneratedModel).getByAltText("基准模特图")).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/latest-base-model.png",
    );

    await act(async () => {
      resolvePreviousTaskDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: [
          {
            asset: {
              id: "asset_stale_base_model",
              localPath: "/workspace/current/assets/generated/stale-base-model.png",
              relativePath: "assets/generated/stale-base-model.png",
            },
            role: "output",
            sortOrder: 0,
          },
        ],
        task: {
          id: "task_base_model_1",
          kind: "image-generation",
          stage: "completed",
          status: "succeeded",
          workspace: "clothing",
        },
      });
      await Promise.resolve();
    });

    expect(
      within(screen.getByRole("button", { name: "选择生成模特 基准模特图" })).getByAltText("基准模特图"),
    ).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/latest-base-model.png",
    );
  });

  it("shares the pending base model cancellation across consecutive reentries", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let baseModelTaskCount = 0;
    let resolveCancellation: (() => void) | undefined;
    let resolvePreviousTaskDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_create_task" && input?.input?.kind === "clothing-base-model-generation") {
        baseModelTaskCount += 1;
        const id = `task_reentry_base_model_${baseModelTaskCount}`;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id,
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "生成基准模特",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: "clothing",
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_reentry_base_model_1") {
        return new Promise((resolve) => {
          resolvePreviousTaskDetail = resolve;
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_reentry_base_model_2") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                id: "asset_reentry_latest_base_model",
                localPath: "/workspace/current/assets/generated/reentry-latest-base-model.png",
                relativePath: "assets/generated/reentry-latest-base-model.png",
              },
              role: "output",
              sortOrder: 0,
            },
          ],
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "completed",
            status: "succeeded",
            workspace: "clothing",
          },
        });
      }
      if (command === "generation_cancel_task" && taskId === "task_reentry_base_model_1") {
        return new Promise((resolve) => {
          resolveCancellation = () => resolve({
            id: taskId,
            kind: "image-generation",
            stage: "failed",
            status: "cancelled",
            title: "生成基准模特",
            workspace: "clothing",
          });
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    await waitFor(() => expect(resolvePreviousTaskDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "商品" }));
    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    await waitFor(() => expect(resolveCancellation).toBeDefined());

    await user.click(screen.getByRole("button", { name: "商品" }));
    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    expect(baseModelTaskCount).toBe(1);
    expect(
      invokeMock.mock.calls.filter(
        ([command, args]) =>
          command === "generation_cancel_task" &&
          (args as { taskId?: string } | undefined)?.taskId === "task_reentry_base_model_1",
      ),
    ).toHaveLength(1);

    await act(async () => {
      resolveCancellation?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(baseModelTaskCount).toBe(2));
    const generatedModel = await screen.findByRole("button", { name: "选择生成模特 基准模特图" });
    expect(within(generatedModel).getByAltText("基准模特图")).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/reentry-latest-base-model.png",
    );

    await act(async () => {
      resolvePreviousTaskDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: [],
        task: {
          id: "task_reentry_base_model_1",
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          workspace: "clothing",
        },
      });
      await Promise.resolve();
    });
  });

  it.each(["succeeded", "cancelled"] as const)(
    "regenerates after cancel rejects when the previous base model task is already %s",
    async (terminalStatus) => {
      const user = userEvent.setup();
      const baseInvoke = invokeMock.getMockImplementation();
      let baseModelTaskCount = 0;
      let previousTaskDetailCalls = 0;
      let resolveInitialTaskDetail: ((value: unknown) => void) | undefined;
      const previousTaskId = `task_terminal_cancel_${terminalStatus}_1`;
      invokeMock.mockImplementation((command, args) => {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (command === "generation_create_task" && input?.input?.kind === "clothing-base-model-generation") {
          baseModelTaskCount += 1;
          const id = baseModelTaskCount === 1 ? previousTaskId : `task_terminal_cancel_${terminalStatus}_2`;
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id,
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "生成基准模特",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
        if (command === "generation_get_task_detail" && taskId === previousTaskId) {
          previousTaskDetailCalls += 1;
          if (previousTaskDetailCalls === 1) {
            return new Promise((resolve) => {
              resolveInitialTaskDetail = resolve;
            });
          }
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: terminalStatus === "succeeded" ? "completed" : "failed",
              status: terminalStatus,
              workspace: "clothing",
            },
          });
        }
        if (command === "generation_get_task_detail" && taskId === `task_terminal_cancel_${terminalStatus}_2`) {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: `asset_terminal_cancel_${terminalStatus}`,
                  localPath: `/workspace/current/assets/generated/terminal-cancel-${terminalStatus}.png`,
                  relativePath: `assets/generated/terminal-cancel-${terminalStatus}.png`,
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              workspace: "clothing",
            },
          });
        }
        if (command === "generation_cancel_task" && taskId === previousTaskId) {
          return Promise.reject(new Error("task already finished"));
        }
        return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
      });

      renderApp();

      await user.click(screen.getByRole("button", { name: "服饰" }));
      await user.click(screen.getByRole("button", { name: "AI 生成" }));
      await user.click(screen.getByRole("button", { name: "生成基准模特" }));
      await waitFor(() => expect(resolveInitialTaskDetail).toBeDefined());

      await user.click(screen.getByRole("button", { name: "商品" }));
      await user.click(screen.getByRole("button", { name: "服饰" }));
      await user.click(screen.getByRole("button", { name: "AI 生成" }));
      await user.click(screen.getByRole("button", { name: "生成基准模特" }));

      await waitFor(() => expect(baseModelTaskCount).toBe(2));
      const generatedModel = await screen.findByRole("button", { name: "选择生成模特 基准模特图" });
      expect(within(generatedModel).getByAltText("基准模特图")).toHaveAttribute(
        "src",
        `asset://localhost/workspace/current/assets/generated/terminal-cancel-${terminalStatus}.png`,
      );
      expect(
        screen.queryByText("基准模特任务取消失败：后台任务可能仍在继续，请稍后在生成记录中检查。"),
      ).not.toBeInTheDocument();

      await act(async () => {
        resolveInitialTaskDetail?.({
          events: [],
          inputAssets: [],
          outputAssets: [],
          task: {
            id: previousTaskId,
            kind: "image-generation",
            stage: terminalStatus === "succeeded" ? "completed" : "failed",
            status: terminalStatus,
            workspace: "clothing",
          },
        });
        await Promise.resolve();
      });
    },
  );

  it.each(["running", "query-error"] as const)(
    "does not regenerate when base model cancellation confirmation is %s and retries the same task",
    async (confirmation) => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let baseModelTaskCount = 0;
    let cancellationAttempts = 0;
    let previousTaskDetailCalls = 0;
    let resolvePreviousTaskDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_create_task" && input?.input?.kind === "clothing-base-model-generation") {
        baseModelTaskCount += 1;
        const id = `task_retry_cancel_base_model_${baseModelTaskCount}`;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id,
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "生成基准模特",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: "clothing",
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_retry_cancel_base_model_1") {
        previousTaskDetailCalls += 1;
        if (previousTaskDetailCalls > 1) {
          if (confirmation === "query-error") {
            return Promise.reject(new Error("task detail unavailable"));
          }
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "calling-provider",
              status: "running",
              workspace: "clothing",
            },
          });
        }
        return new Promise((resolve) => {
          resolvePreviousTaskDetail = resolve;
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_retry_cancel_base_model_2") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [
            {
              asset: {
                id: "asset_retry_cancel_latest_base_model",
                localPath: "/workspace/current/assets/generated/retry-cancel-latest-base-model.png",
                relativePath: "assets/generated/retry-cancel-latest-base-model.png",
              },
              role: "output",
              sortOrder: 0,
            },
          ],
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "completed",
            status: "succeeded",
            workspace: "clothing",
          },
        });
      }
      if (command === "generation_cancel_task" && taskId === "task_retry_cancel_base_model_1") {
        cancellationAttempts += 1;
        if (cancellationAttempts === 1) {
          return Promise.reject(new Error("cancel failed"));
        }
        return Promise.resolve({
          id: taskId,
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "生成基准模特",
          workspace: "clothing",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    await waitFor(() => expect(resolvePreviousTaskDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "商品" }));
    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    expect(
      await screen.findByText("基准模特任务取消失败：后台任务可能仍在继续，请稍后在生成记录中检查。"),
    ).toBeInTheDocument();
    expect(baseModelTaskCount).toBe(1);

    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    await waitFor(() => expect(cancellationAttempts).toBe(2));
    await waitFor(() => expect(baseModelTaskCount).toBe(2));
    const generatedModel = await screen.findByRole("button", { name: "选择生成模特 基准模特图" });
    expect(within(generatedModel).getByAltText("基准模特图")).toHaveAttribute(
      "src",
      "asset://localhost/workspace/current/assets/generated/retry-cancel-latest-base-model.png",
    );

    await act(async () => {
      resolvePreviousTaskDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: [],
        task: {
          id: "task_retry_cancel_base_model_1",
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          workspace: "clothing",
        },
      });
      await Promise.resolve();
    });
    },
  );

  it("drafts clothing scene selection after uploading clothing images", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));

    expect(selectProductImagesMock).toHaveBeenCalledWith(5);
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));

    const generateButton = screen.getByRole("button", { name: "开始生成" });
    expect(generateButton).toBeEnabled();

    fireEvent.click(generateButton);

    expect(screen.getByRole("complementary", { name: "选择场景" })).toBeInTheDocument();
    expect(screen.getByText("生成中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();

    expect(await screen.findByText("都市街头")).toBeInTheDocument();
    expect(screen.getByText("街角咖啡")).toBeInTheDocument();
    expect(screen.getAllByTestId("clothing-scene-card")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "请先选择场景" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "都市街头" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "街角咖啡" })).not.toBeChecked();
    expect(invokeMock).toHaveBeenCalledWith(
      "generation_create_task",
      expect.objectContaining({
        input: expect.objectContaining({
          input: expect.objectContaining({
            kind: "clothing-scene-planning",
          }),
          workspace: "clothing",
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_run_task", { taskId: "task_clothing-scene-planning" });
  });

  it("freezes model-first assets and planning model features for clothing scene generation", async () => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();
    let importCallCount = 0;
    invokeMock.mockImplementation((command, args) => {
      if (command === "asset_list_builtin_models") {
        return Promise.resolve([
          {
            fileName: "model-01.png",
            id: "model-01",
            label: "内置模特 01",
            path: "/app/resources/builtin-models/model-01.png",
            thumbnailPath: "/app/resources/builtin-model-thumbnails/model-01.png",
          },
        ]);
      }
      if (command === "asset_import_images") {
        importCallCount += 1;
        if (importCallCount > 2) {
          return Promise.reject(new Error("原始图片已不可访问"));
        }
        const input = (args as { input?: { kind?: string; paths?: string[] } } | undefined)?.input;
        const kind = input?.kind ?? "source";
        return Promise.resolve(
          (input?.paths ?? []).map((path, index) => ({
            createdAt: "2026-07-02T00:00:00.000Z",
            id: `${kind}_persisted_${index + 1}`,
            kind,
            lifecycle: "active",
            localPath: `/workspace/current/assets/${kind}/${kind}-persisted-${index + 1}.png`,
            mimeType: "image/png",
            name: `${kind}-persisted-${index + 1}.png`,
            originalName: path.split(/[\\/]/).pop() ?? `${kind}.png`,
            relativePath: `assets/${kind}/${kind}-persisted-${index + 1}.png`,
            sha256: `sha256-${kind}-${index + 1}`,
            sizeBytes: 128,
            updatedAt: "2026-07-02T00:00:00.000Z",
          })),
        );
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_clothing-scene-planning") {
          return Promise.resolve(createClothingPlanningTaskDetail(taskId, "可复用场景"));
        }
        if (taskId === "task_clothing-tryon-generation") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_reused_clothing_result",
                  localPath: "/workspace/current/assets/generated/reused-clothing-result.png",
                  relativePath: "assets/generated/reused-clothing-result.png",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              workspace: "clothing",
            },
          });
        }
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await user.click(await screen.findByRole("checkbox", { name: "可复用场景站姿" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（1张）" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            input: expect.objectContaining({ kind: "clothing-scene-planning" }),
            inputAssets: [
              { assetId: "model_persisted_1", role: "model", sortOrder: 0 },
              { assetId: "source_persisted_1", role: "source", sortOrder: 1 },
            ],
          }),
        }),
      );
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            input: expect.objectContaining({
              kind: "clothing-tryon-generation",
              modelFeatures: {
                ageRange: "青年",
                body: "匀称修长",
                ethnicityAppearance: "东亚面孔",
                face: "清晰的五官轮廓",
                gender: "女性化气质",
                hair: "自然长发",
                identityAnchor: ["脸部轮廓", "自然长发", "匀称身形"],
                overallStyle: "简约时尚",
                skinTone: "自然暖肤色",
              },
            }),
            inputAssets: [
              { assetId: "model_persisted_1", role: "model", sortOrder: 0 },
              { assetId: "source_persisted_1", role: "source", sortOrder: 1 },
            ],
          }),
        }),
      );
    });
    expect(importCallCount).toBe(2);
  });

  it("keeps the original clothing image slot after deleting an earlier result", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const defaultInvoke = invokeMock.getMockImplementation();
    const deletedSortOrders = new Set<number>();

    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_clothing-scene-planning") {
          const detail = createClothingPlanningTaskDetail(taskId, "稳定槽位场景");
          detail.output.scenes[0].recommendedPoses.push({
            cameraSetup: { framing: "全身", perspective: "侧面", shootingPosition: "平视机位" },
            poseAction: "稳定槽位场景行走",
          });
          return Promise.resolve(detail);
        }
        if (taskId === "task_clothing-tryon-generation") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [0, 1]
              .filter((sortOrder) => !deletedSortOrders.has(sortOrder))
              .map((sortOrder) => ({
                asset: {
                  id: `asset_clothing_slot_${sortOrder + 1}`,
                  localPath: `/workspace/current/assets/generated/clothing-slot-${sortOrder + 1}.png`,
                  relativePath: `assets/generated/clothing-slot-${sortOrder + 1}.png`,
                },
                role: "output",
                sortOrder,
              })),
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              workspace: "clothing",
            },
          });
        }
      }
      if (command === "generation_delete_result_image") {
        const input = (args as { input?: { imageNo?: number } } | undefined)?.input;
        if (input?.imageNo) {
          deletedSortOrders.add(input.imageNo - 1);
        }
        return Promise.resolve();
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await user.click(await screen.findByRole("checkbox", { name: "稳定槽位场景站姿" }));
    await user.click(screen.getByRole("checkbox", { name: "稳定槽位场景行走" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（2张）" }));

    const deleteButtons = await screen.findAllByRole("button", { name: "删除 稳定槽位场景" });
    expect(deleteButtons).toHaveLength(2);
    await user.click(deleteButtons[0]);
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_delete_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            assetId: "asset_clothing_slot_1",
            imageNo: 1,
          }),
        }),
      ),
    );

    await user.click(await screen.findByRole("button", { name: "删除 稳定槽位场景" }));
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_delete_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            assetId: "asset_clothing_slot_2",
            imageNo: 2,
          }),
        }),
      ),
    );
  });

  it.each([
    {
      preflightMissingAsset: false,
      replaceFails: false,
      title: "resizes the original second clothing slot after deleting the first result",
    },
    {
      preflightMissingAsset: false,
      replaceFails: true,
      title: "cleans up an unmerged resize task and keeps the original image",
    },
    {
      preflightMissingAsset: true,
      replaceFails: false,
      title: "shows one error when resize preflight asset information is missing",
    },
  ])("$title", async ({ preflightMissingAsset, replaceFails }) => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const defaultInvoke = invokeMock.getMockImplementation();
    const deletedSortOrders = new Set<number>();

    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_clothing-scene-planning") {
          const detail = createClothingPlanningTaskDetail(taskId, "稳定尺寸场景");
          detail.output.scenes[0].recommendedPoses.push({
            cameraSetup: { framing: "全身", perspective: "侧面", shootingPosition: "平视机位" },
            poseAction: "稳定尺寸场景行走",
          });
          return Promise.resolve(detail);
        }
        if (taskId === "task_clothing-tryon-generation") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [0, 1]
              .filter((sortOrder) => !deletedSortOrders.has(sortOrder))
              .map((sortOrder) => ({
                asset: {
                  ...(preflightMissingAsset && sortOrder === 1
                    ? {}
                    : { id: `asset_clothing_resize_slot_${sortOrder + 1}` }),
                  localPath: `/workspace/current/assets/generated/clothing-resize-slot-${sortOrder + 1}.png`,
                  relativePath: `assets/generated/clothing-resize-slot-${sortOrder + 1}.png`,
                },
                role: "output",
                sortOrder,
              })),
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              workspace: "clothing",
            },
          });
        }
        if (taskId === "task_image-edit") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_clothing_resized_slot_2",
                  localPath: "/workspace/current/assets/generated/clothing-resized-slot-2.png",
                  relativePath: "assets/generated/clothing-resized-slot-2.png",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              id: taskId,
              kind: "image-edit",
              stage: "completed",
              status: "succeeded",
              workspace: "clothing",
            },
          });
        }
      }
      if (command === "generation_delete_result_image") {
        const input = (args as { input?: { imageNo?: number } } | undefined)?.input;
        if (input?.imageNo) {
          deletedSortOrders.add(input.imageNo - 1);
        }
        return Promise.resolve();
      }
      if (command === "generation_replace_result_image" && replaceFails) {
        return Promise.reject(new Error("父任务槽位已变化"));
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await user.click(await screen.findByRole("checkbox", { name: "稳定尺寸场景站姿" }));
    await user.click(screen.getByRole("checkbox", { name: "稳定尺寸场景行走" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（2张）" }));

    const deleteButtons = await screen.findAllByRole("button", { name: "删除 稳定尺寸场景" });
    await user.click(deleteButtons[0]);
    await user.click(within(screen.getByRole("dialog", { name: "删除图片" })).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "修改尺寸 稳定尺寸场景" })).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "修改尺寸 稳定尺寸场景" }));
    const resizeDialog = await screen.findByRole("dialog", { name: "修改图片尺寸" });
    await user.click(within(resizeDialog).getByRole("radio", { name: "方图 1:1 · 1024×1024" }));
    await user.click(within(resizeDialog).getByRole("button", { name: "修改" }));

    if (preflightMissingAsset) {
      await waitFor(() =>
        expect(screen.getAllByText("当前图片缺少可替换的任务或资产信息。")).toHaveLength(1),
      );
      expect(
        invokeMock.mock.calls.some(([command, args]) => {
          const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
          return command === "generation_create_task" && input?.input?.kind === "result-image-resize";
        }),
      ).toBe(false);
      return;
    }

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            input: expect.objectContaining({
              imageNo: 2,
              kind: "result-image-resize",
              sourceAssetId: "asset_clothing_resize_slot_2",
            }),
            inputAssets: [{ assetId: "asset_clothing_resize_slot_2", role: "reference", sortOrder: 0 }],
            kind: "image-edit",
            workspace: "clothing",
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_replace_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            currentAssetId: "asset_clothing_resize_slot_2",
            displayedAssetId: "asset_clothing_resize_slot_2",
            replacementAssetId: "asset_clothing_resized_slot_2",
            replacementTaskId: "task_image-edit",
          }),
        }),
      ),
    );
    if (replaceFails) {
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: "task_image-edit" }),
      );
      await waitFor(() => expect(screen.getAllByText("父任务槽位已变化")).toHaveLength(1));
      expect(screen.getByRole("img", { name: "稳定尺寸场景" })).toHaveAttribute(
        "src",
        expect.stringContaining("clothing-resize-slot-2.png"),
      );
    }
  });

  it.each([
    { replaceFails: false, title: "retries a failed clothing result through a real single-item task" },
    { replaceFails: true, title: "deletes an unmerged succeeded clothing retry after replacement fails" },
  ])("$title", async ({ replaceFails }) => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const defaultInvoke = invokeMock.getMockImplementation();
    let tryonCreateCount = 0;
    let initialCreateInput: unknown = null;
    let retryCreateInput: unknown = null;
    let resolveReplaceResult!: () => void;
    let rejectReplaceResult!: (error: Error) => void;
    const replaceResultPromise = new Promise<void>((resolve, reject) => {
      resolveReplaceResult = resolve;
      rejectReplaceResult = reject;
    });

    invokeMock.mockImplementation((command, args) => {
      if (command === "asset_import_images") {
        const input = (args as { input?: { kind?: string; paths?: string[] } } | undefined)?.input;
        const kind = input?.kind ?? "source";
        return Promise.resolve(
          (input?.paths ?? []).map((path, index) => ({
            createdAt: "2026-07-02T00:00:00.000Z",
            id: `${kind}_retry_${index + 1}`,
            kind,
            lifecycle: "active",
            localPath: `/workspace/current/assets/${kind}/${kind}-retry-${index + 1}.png`,
            mimeType: "image/png",
            name: `${kind}-retry-${index + 1}.png`,
            originalName: path.split(/[\\/]/).pop() ?? `${kind}.png`,
            relativePath: `assets/${kind}/${kind}-retry-${index + 1}.png`,
            sha256: `sha256-${kind}-retry-${index + 1}`,
            sizeBytes: 128,
            updatedAt: "2026-07-02T00:00:00.000Z",
          })),
        );
      }
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-tryon-generation") {
          tryonCreateCount += 1;
          if (tryonCreateCount === 1) {
            initialCreateInput = input;
          } else {
            retryCreateInput = input;
          }
          const id = tryonCreateCount === 1 ? "task_clothing_initial_failure" : "task_clothing_retry_item";
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id,
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "服饰场景图",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
      }
      if (command === "generation_run_task") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        return Promise.resolve({ invocationId: `inv_${taskId}`, taskId });
      }
      if (command === "generation_replace_result_image") {
        return replaceResultPromise;
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_clothing-scene-planning") {
          return Promise.resolve(createClothingPlanningTaskDetail(taskId, "可复用场景"));
        }
        if (taskId === "task_clothing_initial_failure") {
          return Promise.resolve({
            events: [],
            input: {
              items: [
                {
                  cameraSetup: {
                    framing: "全身",
                    perspective: "正面",
                    shootingPosition: "平视机位",
                  },
                  id: "retry-scene-item",
                  poseAction: "自然站立展示服装版型",
                  ratio: "3:4",
                  scene: "可复用场景",
                  scenePromptSegment: "商业服饰摄影",
                  sceneVisualAnchor: "街头自然光",
                },
              ],
              kind: "clothing-tryon-generation",
              ratio: "3:4",
            },
            inputAssets: [
              {
                asset: { id: "source_retry_1", mimeType: "image/png", relativePath: "assets/source/source-retry-1.png" },
                role: "source",
                sortOrder: 0,
              },
              {
                asset: { id: "model_retry_1", mimeType: "image/png", relativePath: "assets/model/model-retry-1.png" },
                role: "model",
                sortOrder: 1,
              },
            ],
            outputAssets: [],
            task: {
              error: { code: "PROVIDER_TIMEOUT", message: "Provider 连接超时。", retryable: true },
              id: taskId,
              kind: "image-generation",
              stage: "failed",
              status: "failed",
              title: "服饰场景图",
              workspace: "clothing",
            },
          });
        }
        if (taskId === "task_clothing_retry_item") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_clothing_retry_result",
                  localPath: "/workspace/current/assets/generated/clothing-retry.png",
                  relativePath: "assets/generated/clothing-retry.png",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "completed",
              status: "succeeded",
              title: "重新生成 可复用场景",
              workspace: "clothing",
            },
          });
        }
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/retry-shirt.png",
        name: "retry-shirt.png",
        path: "/Users/demo/Pictures/retry-shirt.png",
        src: "asset://retry-shirt.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await user.click(await screen.findByRole("checkbox", { name: "可复用场景站姿" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（1张）" }));

    const failedCard = await screen.findByTestId("failed-result-card");
    await user.click(within(failedCard).getByRole("button", { name: "重试 可复用场景" }));

    await waitFor(() => expect(retryCreateInput).not.toBeNull());
    const initialImageId = (
      initialCreateInput as { input?: { items?: Array<{ imageId?: string; imageNo?: number }> } }
    ).input?.items?.[0]?.imageId;
    expect(initialImageId).toEqual(expect.any(String));
    expect(
      (initialCreateInput as { input?: { items?: Array<{ imageNo?: number }> } }).input?.items?.[0]?.imageNo,
    ).toBe(1);
    expect(retryCreateInput).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          items: [
            expect.objectContaining({
              id: "retry-scene-item",
              imageId: initialImageId,
              imageNo: 1,
            }),
          ],
          kind: "clothing-tryon-generation",
          parentTaskId: "task_clothing_initial_failure",
          retrySequence: expect.any(Number),
        }),
        inputAssets: [
          { assetId: "source_retry_1", role: "source", sortOrder: 0 },
          { assetId: "model_retry_1", role: "model", sortOrder: 1 },
        ],
        workspace: "clothing",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_run_task", { taskId: "task_clothing_retry_item" });
    expect(invokeMock).toHaveBeenCalledWith(
      "generation_replace_result_image",
      expect.objectContaining({
        input: expect.objectContaining({
          replacementAssetId: "asset_clothing_retry_result",
          replacementTaskId: "task_clothing_retry_item",
          taskId: "task_clothing_initial_failure",
        }),
      }),
    );
    expect(screen.queryByRole("img", { name: "可复用场景" })).not.toBeInTheDocument();
    if (replaceFails) {
      rejectReplaceResult(new Error("父任务槽位已变化"));
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: "task_clothing_retry_item" }),
      );
      expect(screen.getByTestId("failed-result-card")).toBeInTheDocument();
      expect(await screen.findByText(/父任务槽位已变化/)).toBeInTheDocument();
    } else {
      resolveReplaceResult();
      expect(await screen.findByTestId("generated-detail-image-card")).toHaveTextContent("可复用场景");
    }
  });

  it("shows a toast and keeps the clothing image failed when retry preparation fails", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const defaultInvoke = invokeMock.getMockImplementation();
    let initialDetailReadCount = 0;

    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-tryon-generation") {
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id: "task_clothing_retry_preparation_failure",
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "服饰场景图",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_clothing-scene-planning") {
          return Promise.resolve(createClothingPlanningTaskDetail(taskId, "失败重试场景"));
        }
        if (taskId === "task_clothing_retry_preparation_failure") {
          initialDetailReadCount += 1;
          if (initialDetailReadCount > 1) {
            return Promise.reject(new Error("读取原任务失败"));
          }
          return Promise.resolve({
            events: [],
            input: {
              items: [{ id: "failed-scene-item", poseAction: "自然站立", ratio: "3:4", scene: "失败重试场景" }],
              kind: "clothing-tryon-generation",
              ratio: "3:4",
            },
            inputAssets: [],
            outputAssets: [],
            task: {
              error: { code: "PROVIDER_TIMEOUT", message: "Provider 连接超时。", retryable: true },
              id: taskId,
              kind: "image-generation",
              stage: "failed",
              status: "failed",
              title: "服饰场景图",
              workspace: "clothing",
            },
          });
        }
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/retry-failure-shirt.png",
        name: "retry-failure-shirt.png",
        path: "/Users/demo/Pictures/retry-failure-shirt.png",
        src: "asset://retry-failure-shirt.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await user.click(await screen.findByRole("checkbox", { name: "失败重试场景站姿" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（1张）" }));

    const failedCard = await screen.findByTestId("failed-result-card");
    await user.click(within(failedCard).getByRole("button", { name: "重试 失败重试场景" }));

    expect(await screen.findByText("服饰场景图重新生成失败：读取原任务失败")).toBeInTheDocument();
    expect(screen.getByTestId("failed-result-card")).toBeInTheDocument();
  });

  it("does not show fallback mock scenes when clothing scene planning fails", async () => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "asset_list_builtin_models") {
        return Promise.resolve([
          {
            fileName: "model-01.png",
            id: "model-01",
            label: "内置模特 01",
            path: "/app/resources/builtin-models/model-01.png",
            thumbnailPath: "/app/resources/builtin-model-thumbnails/model-01.png",
          },
        ]);
      }
      if (command === "generation_run_task") {
        return Promise.reject(new Error("没有可用模型"));
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));

    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByText("服饰场景规划失败：没有可用模型")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "服饰配置" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "选择场景" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("clothing-scene-card")).not.toBeInTheDocument();
  });

  it("cancels a nonterminal clothing planning task before retrying after the start request fails", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let planningCreateCount = 0;
    invokeMock.mockImplementation((command, args) => {
      const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_create_task" && input?.input?.kind === "clothing-scene-planning") {
        planningCreateCount += 1;
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id: `task_planning_retry_${planningCreateCount}`,
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "服饰场景动作规划",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: "clothing",
        });
      }
      if (command === "generation_run_task" && taskId === "task_planning_retry_1") {
        return Promise.reject(new Error("规划启动响应丢失"));
      }
      if (command === "generation_cancel_task" && taskId === "task_planning_retry_1") {
        return Promise.resolve({
          id: taskId,
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "服饰场景动作规划",
          workspace: "clothing",
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_planning_retry_2") {
        return Promise.resolve(createClothingPlanningTaskDetail(taskId, "重试规划场景"));
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("服饰场景规划失败：规划启动响应丢失")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始生成" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", {
        taskId: "task_planning_retry_1",
      });
    });
    const cancelCallIndex = invokeMock.mock.calls.findIndex(
      ([command, args]) =>
        command === "generation_cancel_task" &&
        (args as { taskId?: string } | undefined)?.taskId === "task_planning_retry_1",
    );
    const secondCreateCallIndex = invokeMock.mock.calls.findIndex(
      ([command, args], index) =>
        command === "generation_create_task" &&
        (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind ===
          "clothing-scene-planning" &&
        index > cancelCallIndex,
    );
    expect(cancelCallIndex).toBeGreaterThanOrEqual(0);
    expect(secondCreateCallIndex).toBeGreaterThan(cancelCallIndex);
    expect(await screen.findByText("重试规划场景")).toBeInTheDocument();
  });

  it("retains a stale clothing planning task when cancellation fails after task creation", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let planningCreateCount = 0;
    let cancellationAttempts = 0;
    let resolveStaleCreate: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_create_task" && input?.input?.kind === "clothing-scene-planning") {
        planningCreateCount += 1;
        const id = planningCreateCount === 1 ? "task_stale_planning_create" : "task_current_planning_create";
        const task = {
          attemptNo: 1,
          createdAt: "2026-07-02T00:00:00.000Z",
          id,
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "服饰场景动作规划",
          updatedAt: "2026-07-02T00:00:00.000Z",
          workspace: "clothing",
        };
        if (planningCreateCount === 1) {
          return new Promise((resolve) => {
            resolveStaleCreate = resolve;
          });
        }
        return Promise.resolve(task);
      }
      if (command === "generation_get_task_detail" && taskId === "task_current_planning_create") {
        return Promise.resolve(createClothingPlanningTaskDetail(taskId, "当前规划场景"));
      }
      if (command === "generation_get_task_detail" && taskId === "task_stale_planning_create") {
        return Promise.resolve({
          events: [],
          inputAssets: [],
          outputAssets: [],
          task: {
            id: taskId,
            kind: "image-generation",
            stage: "calling-provider",
            status: "running",
            workspace: "clothing",
          },
        });
      }
      if (command === "generation_cancel_task" && taskId === "task_stale_planning_create") {
        cancellationAttempts += 1;
        if (cancellationAttempts === 1) {
          return Promise.reject(new Error("首次取消失败"));
        }
        return Promise.resolve({
          id: taskId,
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "服饰场景动作规划",
          workspace: "clothing",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(resolveStaleCreate).toBeDefined());

    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("当前规划场景")).toBeInTheDocument();

    await act(async () => {
      resolveStaleCreate?.({
        attemptNo: 1,
        createdAt: "2026-07-02T00:00:00.000Z",
        id: "task_stale_planning_create",
        kind: "image-generation",
        stage: "queued",
        status: "queued",
        title: "服饰场景动作规划",
        updatedAt: "2026-07-02T00:00:00.000Z",
        workspace: "clothing",
      });
    });
    expect(await screen.findByText(/服饰场景规划取消失败：后台任务可能仍在继续/)).toBeInTheDocument();
    expect(cancellationAttempts).toBe(1);

    await user.click(screen.getByRole("button", { name: "上一步" }));
    await waitFor(() => expect(cancellationAttempts).toBe(2));
  });

  it("keeps the latest clothing scene plan when an earlier request completes later", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let planningCreateCount = 0;
    let resolveOldDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-scene-planning") {
          planningCreateCount += 1;
          const taskId = planningCreateCount === 1 ? "task_plan_old" : "task_plan_new";
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id: taskId,
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "服饰场景动作规划",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_plan_old") {
          return new Promise((resolve) => {
            resolveOldDetail = resolve;
          });
        }
        if (taskId === "task_plan_new") {
          return Promise.resolve(createClothingPlanningTaskDetail(taskId, "新请求场景"));
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(resolveOldDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("新请求场景")).toBeInTheDocument();

    await act(async () => {
      resolveOldDetail?.(createClothingPlanningTaskDetail("task_plan_old", "旧请求场景"));
    });

    expect(screen.getByText("新请求场景")).toBeInTheDocument();
    expect(screen.queryByText("旧请求场景")).not.toBeInTheDocument();
  });

  it("keeps the latest clothing scene plan when an earlier request fails later", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let planningCreateCount = 0;
    let rejectOldDetail: ((reason?: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-scene-planning") {
          planningCreateCount += 1;
          const taskId = planningCreateCount === 1 ? "task_plan_old" : "task_plan_new";
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id: taskId,
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "服饰场景动作规划",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_plan_old") {
          return new Promise((_, reject) => {
            rejectOldDetail = reject;
          });
        }
        if (taskId === "task_plan_new") {
          return Promise.resolve(createClothingPlanningTaskDetail(taskId, "新请求场景"));
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(rejectOldDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("新请求场景")).toBeInTheDocument();

    await act(async () => {
      rejectOldDetail?.(new Error("旧请求失败"));
    });

    expect(screen.getByRole("complementary", { name: "选择场景" })).toBeInTheDocument();
    expect(screen.getByText("新请求场景")).toBeInTheDocument();
    expect(screen.queryByText("服饰场景规划失败：旧请求失败")).not.toBeInTheDocument();
  });

  it("cancels clothing planning and stops its poll after going back", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let resolvePlanningDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-scene-planning") {
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id: "task_plan_cancelled",
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "服饰场景动作规划",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_plan_cancelled") {
          return new Promise((resolve) => {
            resolvePlanningDetail = resolve;
          });
        }
      }
      if (command === "generation_cancel_task") {
        return Promise.resolve({
          attemptNo: 1,
          id: "task_plan_cancelled",
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "服饰场景动作规划",
          workspace: "clothing",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(resolvePlanningDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "上一步" }));

    expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", { taskId: "task_plan_cancelled" });

    await act(async () => {
      resolvePlanningDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: [],
        task: {
          id: "task_plan_cancelled",
          kind: "image-generation",
          stage: "queued",
          status: "queued",
        },
      });
      await Promise.resolve();
    });

    const planningRunCalls = invokeMock.mock.calls.filter(
      ([command, args]) =>
        command === "generation_run_task" &&
        (args as { taskId?: string } | undefined)?.taskId === "task_plan_cancelled",
    );
    expect(planningRunCalls).toHaveLength(1);
  });

  it("cancels and invalidates clothing planning when starting a new task", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let rejectPlanningDetail: ((reason?: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_clothing-scene-planning") {
          return new Promise((_, reject) => {
            rejectPlanningDetail = reject;
          });
        }
      }
      if (command === "generation_cancel_task") {
        return Promise.resolve({
          id: "task_clothing-scene-planning",
          kind: "image-generation",
          stage: "failed",
          status: "cancelled",
          title: "服饰场景动作规划",
          workspace: "clothing",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(rejectPlanningDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", {
      taskId: "task_clothing-scene-planning",
    });
    await act(async () => {
      rejectPlanningDetail?.(new Error("已重置的旧规划失败"));
      await Promise.resolve();
    });
    expect(screen.queryByText("服饰场景规划失败：已重置的旧规划失败")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "服饰配置" })).toBeInTheDocument();
  });

  it("warns when a clothing planning task cannot be cancelled", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let planningDetailCallCount = 0;
    let resolvePlanningDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_clothing-scene-planning") {
          planningDetailCallCount += 1;
          if (planningDetailCallCount > 1) {
            return Promise.resolve({
              events: [],
              inputAssets: [],
              outputAssets: [],
              task: {
                id: taskId,
                kind: "image-generation",
                stage: "calling-provider",
                status: "running",
                workspace: "clothing",
              },
            });
          }
          return new Promise((resolve) => {
            resolvePlanningDetail = resolve;
          });
        }
      }
      if (command === "generation_cancel_task") {
        return Promise.reject(new Error("取消命令失败"));
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => expect(resolvePlanningDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "上一步" }));

    expect(await screen.findByText(/服饰场景规划取消失败：后台任务可能仍在继续/)).toBeInTheDocument();
  });

  it("keeps a newer clothing generation locked when an older task finishes", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    const baseInvoke = invokeMock.getMockImplementation();
    let tryonCreateCount = 0;
    let resolveOldTryonDetail: ((value: unknown) => void) | undefined;
    let resolveNewTryonDetail: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-tryon-generation") {
          tryonCreateCount += 1;
          const taskId = tryonCreateCount === 1 ? "task_tryon_old" : "task_tryon_new";
          return Promise.resolve({
            attemptNo: 1,
            createdAt: "2026-07-02T00:00:00.000Z",
            id: taskId,
            kind: "image-generation",
            stage: "queued",
            status: "queued",
            title: "服饰场景图",
            updatedAt: "2026-07-02T00:00:00.000Z",
            workspace: "clothing",
          });
        }
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId;
        if (taskId === "task_tryon_old") {
          return new Promise((resolve) => {
            resolveOldTryonDetail = resolve;
          });
        }
        if (taskId === "task_tryon_new") {
          return new Promise((resolve) => {
            resolveNewTryonDetail = resolve;
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    async function startClothingGeneration() {
      await user.click(screen.getByRole("button", { name: "服装图片" }));
      expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
      await user.click(screen.getByRole("button", { name: "开始生成" }));
      expect(await screen.findByText("都市街头")).toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "街角咖啡" }));
      await user.click(screen.getByRole("button", { name: "生成场景图片（3张）" }));
    }

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await startClothingGeneration();
    await waitFor(() => expect(resolveOldTryonDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    await startClothingGeneration();
    await waitFor(() => expect(resolveNewTryonDetail).toBeDefined());

    await act(async () => {
      resolveOldTryonDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: Array.from({ length: 3 }, (_, index) => ({
          asset: {
            id: `asset_old_${index + 1}`,
            localPath: `/workspace/current/assets/generated/old-${index + 1}.png`,
            relativePath: `assets/generated/old-${index + 1}.png`,
          },
          role: "output",
          sortOrder: index,
        })),
        task: {
          id: "task_tryon_old",
          kind: "image-generation",
          stage: "completed",
          status: "succeeded",
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "场景图生成中" })).toBeDisabled();
  });

  it("links clothing scene selections, reveals dropdowns only for selected cards, and generates results", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));

    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("都市街头")).toBeInTheDocument();

    const urbanGroupCheckbox = screen.getByRole("checkbox", { name: "都市街头" });
    expect(urbanGroupCheckbox).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "街角咖啡" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "请先选择场景" })).toBeDisabled();

    const uncheckedCard = screen.getByText(/身体微向前倾/).closest("[data-testid='clothing-scene-card']");
    expect(uncheckedCard).not.toBeNull();

    if (!uncheckedCard) {
      throw new Error("missing unchecked clothing scene card");
    }
    const uncheckedSceneCard = uncheckedCard as HTMLElement;

    expect(within(uncheckedSceneCard).queryByRole("button", { name: "画幅 全身" })).not.toBeInTheDocument();
    expect(within(uncheckedSceneCard).queryByRole("button", { name: "角度 正面" })).not.toBeInTheDocument();

    await user.click(within(uncheckedSceneCard).getByRole("checkbox", { name: /身体微向前倾/ }));

    expect(urbanGroupCheckbox).toHaveAttribute("aria-checked", "mixed");

    const framingDropdown = within(uncheckedSceneCard).getByRole("button", { name: "画幅 全身" });
    expect(framingDropdown).toHaveClass("h-8", "rounded-control", "border", "text-[12px]");
    expect(framingDropdown).not.toHaveClass("border-white/60", "bg-slate-100/70");
    expect(framingDropdown).toHaveClass("border-slate-200/80", "bg-white/30");

    await user.click(framingDropdown);

    for (const option of ["全身", "四分之三", "半身", "特写"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "特写" }));

    expect(within(uncheckedSceneCard).getByRole("button", { name: "画幅 特写" })).toBeInTheDocument();

    await user.click(within(uncheckedSceneCard).getByRole("button", { name: "角度 正面" }));

    for (const option of ["正面", "侧面", "3/4 侧", "背面"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "背面" }));

    expect(within(uncheckedSceneCard).getByRole("button", { name: "角度 背面" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "商品" }));
    expect(screen.queryByRole("complementary", { name: "选择场景" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "服饰" }));

    const restoredSceneCard = screen.getByText(/身体微向前倾/).closest("[data-testid='clothing-scene-card']");
    expect(restoredSceneCard).not.toBeNull();
    if (!restoredSceneCard) {
      throw new Error("missing restored clothing scene card");
    }
    const restoredClothingSceneCard = restoredSceneCard as HTMLElement;
    expect(within(restoredClothingSceneCard).getByRole("button", { name: "画幅 特写" })).toBeInTheDocument();
    expect(within(restoredClothingSceneCard).getByRole("button", { name: "角度 背面" })).toBeInTheDocument();

    await user.click(within(restoredClothingSceneCard).getByRole("checkbox", { name: /身体微向前倾/ }));

    expect(screen.getByRole("checkbox", { name: "都市街头" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "请先选择场景" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "街角咖啡" }));

    const generateScenesButton = screen.getByRole("button", { name: "生成场景图片（3张）" });
    expect(generateScenesButton).toBeEnabled();
    expect(generateScenesButton).toHaveClass("border-slate-950/10", "bg-[#1f1f21]", "text-white", "hover:bg-black");

    fireEvent.click(generateScenesButton);

    expect(screen.getByRole("main", { name: "生成预览画布" })).toBeInTheDocument();
    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    expect(screen.getAllByText("AI 生成中")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "上一步" })).toBeDisabled();
    const generatingScenesButton = screen.getByRole("button", { name: "场景图生成中" });
    expect(generatingScenesButton).toBeDisabled();
    expect(generatingScenesButton).toHaveClass("border-slate-200", "bg-slate-200", "text-white", "shadow-none");
    expect(screen.getByRole("checkbox", { name: "街角咖啡" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "画幅 全身" })[0]).toBeDisabled();

    expect(await screen.findByRole("button", { name: "预览长图" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "选择场景" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "街角咖啡" })).toBeChecked();
    expect(screen.getByRole("button", { name: "生成场景图片（3张）" })).toBeEnabled();
    expect(screen.getByTestId("studio-side-divider")).toHaveClass("left-[var(--studio-side-width)]");
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("left-[var(--studio-nav-width)]");
    await waitFor(() => expect(screen.getAllByTestId("generated-detail-image-card")).toHaveLength(3));
    const clothingResultGrid = screen.getByTestId("generated-result-grid");
    const clothingResultCards = within(clothingResultGrid).getAllByRole("article");
    const clothingSourceCard = within(clothingResultGrid).getByTestId("generated-source-image-card");
    expect(clothingResultCards[0]).toBe(clothingSourceCard);
    expect(clothingSourceCard).toHaveTextContent("原图");
    expect(within(clothingSourceCard).getByRole("img", { name: "dress.png" })).toHaveAttribute("src", "asset://dress.png");
    expect(screen.queryByTestId("failed-result-card")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览长图" }));

    const clothingLongPreviewDialog = screen.getByRole("dialog", { name: "长图预览" });
    const clothingLongPreviewSections = within(clothingLongPreviewDialog).getAllByTestId("long-preview-image-section");
    expect(clothingLongPreviewSections).toHaveLength(3);
    expect(within(clothingLongPreviewDialog).queryByText("原图")).not.toBeInTheDocument();
    expect(within(clothingLongPreviewDialog).queryByRole("img", { name: "长图 dress.png" })).not.toBeInTheDocument();
    expect(within(clothingLongPreviewSections[0]).getAllByRole("img", { name: "长图 街角咖啡" })[0]).toHaveClass(
      "block",
      "h-auto",
      "w-full",
      "object-contain",
    );
    expect(within(clothingLongPreviewSections[0]).getAllByRole("img", { name: "长图 街角咖啡" })[0]).not.toHaveClass(
      "absolute",
      "h-full",
      "object-cover",
    );
    await user.click(screen.getByRole("button", { name: "关闭长图预览" }));

    expect(invokeMock).toHaveBeenCalledWith(
      "generation_create_task",
      expect.objectContaining({
        input: expect.objectContaining({
          input: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({
                cameraSetup: expect.objectContaining({
                  framing: expect.any(String),
                  perspective: expect.any(String),
                  shootingPosition: expect.any(String),
                }),
                poseAction: expect.stringContaining("冰咖啡"),
                scene: "街角咖啡",
                scenePromptSegment: expect.stringContaining("都市通勤服饰摄影"),
                sceneVisualAnchor: expect.stringContaining("临街咖啡馆"),
              }),
            ]),
            kind: "clothing-tryon-generation",
            ratio: "3:4",
          }),
          inputAssets: [
            expect.objectContaining({
              role: "model",
              sortOrder: 0,
            }),
            expect.objectContaining({
              role: "source",
              sortOrder: 1,
            }),
          ],
          workspace: "clothing",
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("generation_run_task", { taskId: "task_clothing-tryon-generation" });
  });

  it("guides clothing generation through image, model, and scene requirements", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));

    expect(screen.getByRole("button", { name: "请上传服饰图片" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "请选择模特" })).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));

    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "纯色棚拍" }));
    await user.click(screen.getByRole("button", { name: "都市街头" }));

    expect(screen.getByRole("button", { name: "请选择拍摄场景" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "AI推荐" }));

    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
  });

  it("keeps the product generation call to action disabled until product images are uploaded", () => {
    renderApp();

    const cta = screen.getByRole("button", { name: "请上传产品图" });

    expect(cta).toBeDisabled();
    expect(cta).toHaveClass("bg-slate-300", "cursor-not-allowed", "font-semibold", "text-slate-700");
  });

  it("guides product generation through required inputs and opens the strategy drafting panel", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);
    invokeMock.mockImplementation((command) => {
      if (command === "prompt_plan_create") {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));

    expect(screen.getByRole("button", { name: "请补充商品卖点" })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "防晒透气，适合户外骑行。");

    const readyCta = screen.getByRole("button", { name: "开始生成" });
    expect(readyCta).toBeEnabled();

    await user.click(readyCta);

    expect(screen.getByText("模块策略与设计规范")).toBeInTheDocument();
    expect(screen.getByText("生成中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "请先选择策略" })).toBeDisabled();
  });

  it("renders selected module strategies after drafting and supports delete, drag sort, and rewriting", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "网面人像印花无袖运动T恤");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    await user.click(screen.getByRole("checkbox", { name: "尺寸/容量/尺码图" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    expect(screen.getByText("生成中...")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    await screen.findByText("产品与卖点");
    expect(screen.getByText("产品与卖点")).toBeInTheDocument();
    expect(screen.getByText("模块内容")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-summary-copy")).toHaveClass("line-clamp-5");

    await user.click(screen.getByRole("button", { name: /展开全部/ }));

    expect(screen.getByTestId("strategy-summary-copy")).not.toHaveClass("line-clamp-5");
    expect(screen.getByRole("button", { name: /收起/ })).toBeInTheDocument();
    expect(screen.getByText("首屏主视觉: 传递核心价值")).toBeInTheDocument();
    expect(screen.getByText("使用场景图: 呈现真实使用场景")).toBeInTheDocument();
    expect(screen.getByText("尺寸/容量/尺码图: 展示规格信息")).toBeInTheDocument();
    expect(screen.queryByText("核心卖点图: 突出差异优势")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 首屏主视觉" }));

    expect(screen.queryByText("首屏主视觉: 传递核心价值")).not.toBeInTheDocument();

    const sizeModuleCard = screen
      .getByText("尺寸/容量/尺码图: 展示规格信息")
      .closest("[data-testid='strategy-module-card']");
    const scenarioModuleCard = screen
      .getByText("使用场景图: 呈现真实使用场景")
      .closest("[data-testid='strategy-module-card']");

    expect(sizeModuleCard).not.toBeNull();
    expect(scenarioModuleCard).not.toBeNull();

    const sizeModuleDragHandle = screen.getByLabelText("拖动 尺寸/容量/尺码图");

    const originalElementFromPoint = document.elementFromPoint;
    const elementFromPointMock = vi.fn(() => scenarioModuleCard as Element);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPointMock,
    });
    const scenarioRectSpy = vi.spyOn(scenarioModuleCard!, "getBoundingClientRect").mockReturnValue({
      bottom: 220,
      height: 120,
      left: 0,
      right: 320,
      top: 100,
      width: 320,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    const sizeRectSpy = vi.spyOn(sizeModuleCard!, "getBoundingClientRect").mockReturnValue({
      bottom: 420,
      height: 120,
      left: 20,
      right: 340,
      top: 300,
      width: 320,
      x: 20,
      y: 300,
      toJSON: () => ({}),
    });
    const createPointerEvent = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: 300 });
      Object.defineProperty(event, "clientY", { value: clientY });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };

    fireEvent(sizeModuleDragHandle, createPointerEvent("pointerdown", 300));
    expect(sizeModuleCard).toHaveClass("opacity-35");
    expect(screen.getByTestId("strategy-module-drag-preview")).toHaveStyle({
      height: "120px",
      left: "20px",
      top: "300px",
      width: "320px",
    });

    fireEvent(window, createPointerEvent("pointermove", 120));
    expect(screen.getByTestId("strategy-module-drag-preview")).toHaveStyle({
      left: "20px",
      top: "120px",
    });

    fireEvent(window, createPointerEvent("pointerup", 120));
    expect(screen.queryByTestId("strategy-module-drag-preview")).not.toBeInTheDocument();

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
    scenarioRectSpy.mockRestore();
    sizeRectSpy.mockRestore();

    const moduleCards = screen.getAllByTestId("strategy-module-card");
    expect(moduleCards[0]).toHaveTextContent("尺寸/容量/尺码图: 展示规格信息");

    const scenarioRewrite = screen.getByRole("textbox", { name: "改写 使用场景图" });
    expect(scenarioRewrite).toHaveClass("pr-6", "[scrollbar-gutter:stable]");

    await user.clear(scenarioRewrite);
    await user.type(scenarioRewrite, "主标题: Fit For Every Day，目标语言: 中文");

    expect(scenarioRewrite).toHaveValue("主标题: Fit For Every Day，目标语言: 中文");
    expect(screen.getByRole("button", { name: "生成详情图（2张）" })).toBeEnabled();
  });

  it("keeps drafted product strategies when switching to another workspace and back", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气，适合日常通勤。");
    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    const heroRewrite = await screen.findByRole("textbox", { name: "改写 首屏主视觉" });
    await user.clear(heroRewrite);
    await user.type(heroRewrite, "保留浅灰背景与右侧文字安全区，突出头盔正面轮廓。");

    await user.click(screen.getByRole("button", { name: "模型" }));

    expect(screen.getByRole("main", { name: "AI 模型配置" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "商品" }));

    expect(screen.getByText("模块策略与设计规范")).toBeInTheDocument();
  });

  it("uses the user-edited scene description as the image generation prompt source", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);
    invokeMock.mockImplementation((command, args) => {
      if (command === "prompt_plan_create") {
        const intent = (args as { input?: { intent?: Record<string, unknown> } } | undefined)?.input?.intent ?? {};
        const modules = Array.isArray(intent.modules)
          ? (intent.modules as Array<Record<string, unknown>>)
          : [];
        const now = "2026-07-02T00:00:00.000Z";
        return Promise.resolve({
          createdAt: now,
          id: "prompt_plan_split_prompt_copy",
          items: modules.map((module, moduleIndex) => {
            const moduleId = String(module.moduleId ?? `module-${moduleIndex + 1}`);
            const moduleTitle = String(module.moduleTitle ?? "模块");
            return {
              createdAt: now,
              displaySummary: `主标题: "${moduleTitle}", 排版: 中等偏粗无衬线体, 右侧信息区, 大号\n副标题: "轻量透气", 排版: 常规无衬线体, 主标题下方, 中号\n目标语言: 中文`,
              editable: true,
              id: `style-1-${moduleId}`,
              intent: {
                copyRequirements: `主标题: "${moduleTitle}", 排版: 中等偏粗无衬线体, 右侧信息区, 大号\n副标题: "轻量透气", 排版: 常规无衬线体, 主标题下方, 中号\n目标语言: 中文`,
                designSpec: "产品与卖点\n产品：儿童骑行头盔，轻量透气，适合日常通勤。\n卖点：轻量透气 / 日常通勤 / 佩戴舒适\n顾虑：佩戴闷热 / 安全感不足 / 日常不百搭\n视觉重心：儿童骑行头盔主体作为画面第一视觉中心，直观展示轻量透气与通勤价值\n\n视觉定调\n风格：通勤质感风，突出简洁通勤质感\n色彩：浅灰摄影棚背景作为统一基调，产品保持原色\n字体：中等偏粗无衬线标题体 + 干净无衬线正文\n色温：中性（全套统一）\n光质：柔和左上方光源，突出商品轮廓与材质",
                imagePrompt: `不可见核心 image_prompt：${moduleTitle}，商品主体居中偏左，浅灰摄影棚背景，禁止新增未提供的品牌 Logo、价格、销量、认证标识。`,
                imageType: `${moduleTitle}: 模型返回${moduleTitle}核心卖点`,
                index: moduleIndex + 1,
                moduleId,
                moduleTitle,
                sceneDescription: `主标题: "${moduleTitle}", 排版: 中等偏粗无衬线体, 右侧信息区, 大号\n副标题: "轻量透气", 排版: 常规无衬线体, 主标题下方, 中号\n目标语言: 中文`,
                sceneTitle: moduleTitle,
                styleId: "style-1",
                styleTitle: "通勤质感风",
                targetLanguage: "中文",
                visualConsistency: {
                  backgroundAnchor: "浅灰摄影棚背景",
                  compositionAnchor: "主体居中偏左，右侧信息区",
                  lightingAnchor: "柔和左上方光源",
                  productAnchor: "儿童骑行头盔主体",
                  textAreaAnchor: "右侧信息区生成清晰中文标题",
                },
              },
              required: true,
              sortOrder: moduleIndex,
              title: `通勤质感风 · ${moduleTitle}`,
              type: "scene",
              updatedAt: now,
            };
          }),
          resolverVersion: "product-detail-scene-description-v1",
          status: "draft",
          templateVersion: "v1",
          updatedAt: now,
          userEditableSummary: "模型整理后的产品与卖点：儿童骑行头盔，轻量透气，适合日常通勤。",
          workspace: "product",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气，适合日常通勤。");
    await user.click(screen.getByRole("checkbox", { name: "核心卖点图" }));
    await user.click(screen.getByRole("checkbox", { name: "多角度图" }));
    await user.click(screen.getByRole("checkbox", { name: "场景氛围图" }));
    await user.click(screen.getByRole("checkbox", { name: "商品细节图" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const sceneDescriptionInput = await screen.findByRole("textbox", { name: "改写 使用场景图" });
    expect(screen.getByText("使用场景图: 模型返回使用场景图核心卖点")).toBeInTheDocument();
    expect(screen.queryByText("使用场景图: 呈现真实使用场景")).not.toBeInTheDocument();
    expect((sceneDescriptionInput as HTMLTextAreaElement).value).toContain('主标题: "使用场景图"');
    expect((sceneDescriptionInput as HTMLTextAreaElement).value).not.toContain("不可见核心 image_prompt");
    await user.clear(sceneDescriptionInput);
    await user.type(
      sceneDescriptionInput,
      '主标题: "通勤轻量骑行", 排版: 中等偏粗无衬线体, 右侧信息区, 大号\n副标题: "轻量透气", 排版: 常规无衬线体, 主标题下方, 中号\n目标语言: 中文',
    );

    fireEvent.click(screen.getByRole("button", { name: /生成详情图/ }));

    const sceneResultCard = screen.getAllByTestId("generated-detail-image-card")[1];

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_create_task", expect.any(Object)));
    const imageTaskCreateCall = invokeMock.mock.calls.find(([command, args]) => {
      const input = (args as { input?: { kind?: string } } | undefined)?.input;
      return command === "generation_create_task" && input?.kind === "image-generation";
    });
    expect(imageTaskCreateCall).toBeDefined();
    expect(imageTaskCreateCall?.[1]).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          input: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({
                copyRequirements: expect.stringContaining('主标题: "通勤轻量骑行"'),
                designSpec: expect.stringContaining("风格：通勤质感风，突出简洁通勤质感"),
                imageType: "使用场景图: 模型返回使用场景图核心卖点",
                imagePrompt: expect.stringContaining("不可见核心 image_prompt：使用场景图"),
                sceneDescription: expect.stringContaining('主标题: "通勤轻量骑行"'),
                title: "使用场景图",
                visualConsistency: expect.objectContaining({
                  backgroundAnchor: "浅灰摄影棚背景",
                  textAreaAnchor: "右侧信息区生成清晰中文标题",
                }),
              }),
            ]),
          }),
          kind: "image-generation",
          promptPlanSnapshot: expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({
                intent: expect.objectContaining({
                  copyRequirements: expect.stringContaining('主标题: "通勤轻量骑行"'),
                  designSpec: expect.stringContaining("风格：通勤质感风，突出简洁通勤质感"),
                  imageType: "使用场景图: 模型返回使用场景图核心卖点",
                  imagePrompt: expect.stringContaining("不可见核心 image_prompt：使用场景图"),
                  sceneDescription: expect.stringContaining('主标题: "通勤轻量骑行"'),
                  visualConsistency: expect.objectContaining({
                    productAnchor: "儿童骑行头盔主体",
                  }),
                }),
              }),
            ]),
          }),
          title: "商品详情图",
          workspace: "product",
        }),
      }),
    );
    const imageTaskPayload = JSON.stringify((imageTaskCreateCall?.[1] as { input?: unknown }).input);
    expect(imageTaskPayload).toContain("不可见核心 image_prompt：使用场景图");
    expect(imageTaskPayload).toContain("产品与卖点");
    expect(imageTaskPayload).toContain("视觉定调");
    expect(imageTaskPayload).toContain("风格：");
    expect(imageTaskPayload).toContain("使用场景图:");
    expect(imageTaskPayload).not.toContain("不得出现任何可读文字");
    expect(imageTaskPayload).not.toContain("后期叠字");
    const imageTaskItems =
      ((imageTaskCreateCall?.[1] as { input?: { input?: { items?: unknown[] } } }).input?.input?.items ?? []) as Array<
        Record<string, unknown>
      >;
    expect(imageTaskItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          copyRequirements: expect.stringContaining('主标题: "通勤轻量骑行"'),
          designSpec: expect.stringContaining("风格：通勤质感风，突出简洁通勤质感"),
          imageType: "使用场景图: 模型返回使用场景图核心卖点",
          imagePrompt: expect.stringContaining("不可见核心 image_prompt：使用场景图"),
          visualConsistency: expect.objectContaining({
            lightingAnchor: "柔和左上方光源",
          }),
        }),
      ]),
    );
    expect(sceneResultCard).toHaveAttribute(
      "data-prompt",
      expect.stringContaining('主标题: "通勤轻量骑行"'),
    );
    expect(sceneResultCard).toHaveAttribute("data-prompt", expect.stringContaining("不可见核心 image_prompt：使用场景图"));
    expect(sceneResultCard).toHaveAttribute("data-prompt", expect.stringContaining("禁止新增未提供的品牌 Logo、价格、销量、认证标识"));
  });

  it("prefills editable scene descriptions from the prompt plan text model", async () => {
    const user = userEvent.setup();
    let resolvePromptPlan: ((value: unknown) => void) | undefined;

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);
    invokeMock.mockImplementation((command, args) => {
      if (command === "prompt_plan_create") {
        const intent = (args as { input?: { intent?: Record<string, unknown> } } | undefined)?.input?.intent ?? {};
        const modules = Array.isArray(intent.modules)
          ? (intent.modules as Array<Record<string, unknown>>)
          : [];
        const now = "2026-07-02T00:00:00.000Z";
        return new Promise((resolve) => {
          resolvePromptPlan = () =>
            resolve({
              createdAt: now,
              id: "prompt_plan_waits_for_model",
              items: modules.map((module, moduleIndex) => {
                const moduleId = String(module.moduleId ?? `module-${moduleIndex + 1}`);
                const moduleTitle = String(module.moduleTitle ?? "模块");
                const sceneDescription = `模型返回场景描述：画面以儿童骑行头盔为主体，采用中性电商风格的统一背景、光影和构图，右侧预留信息区，用于${moduleTitle}模块，不添加品牌、价格或认证。`;
                return {
                  createdAt: now,
                  displaySummary: sceneDescription,
                  editable: true,
                  id: `default-${moduleId}`,
                  intent: {
                    imagePrompt: `模型返回 imagePrompt：${sceneDescription} 禁止新增未提供的品牌 Logo、价格、销量、认证标识。`,
                    moduleId,
                    moduleTitle,
                    sceneDescription,
                    styleId: "default",
                    styleTitle: "中性电商风格",
                  },
                  required: true,
                  sortOrder: moduleIndex,
                  title: `中性电商风格 · ${moduleTitle}`,
                  type: "scene",
                  updatedAt: now,
                };
              }),
              resolverVersion: "product-detail-scene-description-v1",
              status: "draft",
              templateVersion: "v1",
              updatedAt: now,
              userEditableSummary: "模型整理后的产品与卖点：儿童骑行头盔，核心卖点为轻量透气，并适合日常通勤表达。",
              workspace: "product",
            });
        });
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气，适合日常通勤。");
    await user.click(screen.getByRole("checkbox", { name: "核心卖点图" }));
    await user.click(screen.getByRole("checkbox", { name: "多角度图" }));
    await user.click(screen.getByRole("checkbox", { name: "场景氛围图" }));
    await user.click(screen.getByRole("checkbox", { name: "商品细节图" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    expect(invokeMock).toHaveBeenCalledWith("prompt_plan_create", {
      input: expect.objectContaining({
        intent: expect.objectContaining({
          modules: expect.arrayContaining([
            expect.objectContaining({
              moduleId: "scenario",
              moduleTitle: "使用场景图",
            }),
          ]),
          platform: "淘宝天猫",
          productSellingPoints: "儿童骑行头盔，轻量透气，适合日常通勤。",
          ratio: "1:1",
        }),
        workspace: "product",
      }),
    });

    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.getByText("生成中...")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "改写 使用场景图" })).not.toBeInTheDocument();

    act(() => {
      resolvePromptPlan?.({});
    });
    vi.useRealTimers();

    const sceneDescriptionInput = await screen.findByRole("textbox", { name: "改写 使用场景图" });
    expect(sceneDescriptionInput).toHaveValue(
      "模型返回场景描述：画面以儿童骑行头盔为主体，采用中性电商风格的统一背景、光影和构图，右侧预留信息区，用于使用场景图模块，不添加品牌、价格或认证。",
    );
    expect((sceneDescriptionInput as HTMLTextAreaElement).value).not.toContain("模型返回 imagePrompt");
    expect(screen.getByTestId("strategy-summary-copy")).toHaveTextContent(
      "模型整理后的产品与卖点：儿童骑行头盔",
    );
  });

  it("rejects prompt plans that omit a selected product module", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);
    invokeMock.mockImplementation((command, args) => {
      if (command === "prompt_plan_create") {
        const intent = (args as { input?: { intent?: Record<string, unknown> } } | undefined)?.input?.intent ?? {};
        const modules = Array.isArray(intent.modules)
          ? (intent.modules as Array<Record<string, unknown>>)
          : [];
        const firstModule = modules[0] ?? {};
        const moduleId = String(firstModule.moduleId ?? "hero");
        const moduleTitle = String(firstModule.moduleTitle ?? "首屏主视觉");
        const sceneDescription = `模型只返回了${moduleTitle}。`;
        const now = "2026-07-02T00:00:00.000Z";
        return Promise.resolve({
          createdAt: now,
          id: "prompt_plan_missing_module",
          items: [
            {
              createdAt: now,
              displaySummary: sceneDescription,
              editable: true,
              id: `default-${moduleId}`,
              intent: {
                imagePrompt: `${sceneDescription} 禁止新增未提供的品牌 Logo、价格、销量、认证标识。`,
                moduleId,
                moduleTitle,
                sceneDescription,
                styleId: "default",
                styleTitle: "中性电商风格",
              },
              required: true,
              sortOrder: 0,
              title: `中性电商风格 · ${moduleTitle}`,
              type: "scene",
              updatedAt: now,
            },
          ],
          resolverVersion: "product-detail-scene-description-v1",
          status: "draft",
          templateVersion: "v1",
          updatedAt: now,
          userEditableSummary: "模型整理后的产品与卖点：儿童骑行头盔",
          workspace: "product",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByText(/场景描述生成缺少已选模块/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "改写 首屏主视觉" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
  });

  it("rejects prompt plans that omit a selected viral style", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);
    invokeMock.mockImplementation((command, args) => {
      if (command === "prompt_plan_create") {
        const intent = (args as { input?: { intent?: Record<string, unknown> } } | undefined)?.input?.intent ?? {};
        const modules = Array.isArray(intent.modules)
          ? (intent.modules as Array<Record<string, unknown>>)
          : [];
        const styles = Array.isArray(intent.viralStyles)
          ? (intent.viralStyles as Array<Record<string, unknown>>)
          : [];
        const firstStyle = styles[0] ?? { styleId: "style-1", styleTitle: "街头潮酷风" };
        const styleId = String(firstStyle.styleId ?? "style-1");
        const styleTitle = String(firstStyle.styleTitle ?? "街头潮酷风");
        const now = "2026-07-02T00:00:00.000Z";
        return Promise.resolve({
          createdAt: now,
          id: "prompt_plan_missing_style",
          items: modules.map((module, moduleIndex) => {
            const moduleId = String(module.moduleId ?? `module-${moduleIndex + 1}`);
            const moduleTitle = String(module.moduleTitle ?? "模块");
            const sceneDescription = `模型只返回了${styleTitle}下的${moduleTitle}。`;
            return {
              createdAt: now,
              displaySummary: sceneDescription,
              editable: true,
              id: `${styleId}-${moduleId}`,
              intent: {
                imagePrompt: `${sceneDescription} 禁止新增未提供的品牌 Logo、价格、销量、认证标识。`,
                moduleId,
                moduleTitle,
                sceneDescription,
                styleId,
                styleTitle,
              },
              required: true,
              sortOrder: moduleIndex,
              title: `${styleTitle} · ${moduleTitle}`,
              type: "scene",
              updatedAt: now,
            };
          }),
          resolverVersion: "product-detail-scene-description-v1",
          status: "draft",
          templateVersion: "v1",
          updatedAt: now,
          userEditableSummary: "模型整理后的产品与卖点：儿童骑行头盔",
          workspace: "product",
        });
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "爆款风格分析" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");
    await user.click(screen.getByRole("button", { name: "开始爆款风格分析" }));
    await screen.findByRole("checkbox", { name: "街头潮酷风" });
    await user.click(screen.getByRole("checkbox", { name: "街头潮酷风" }));
    await user.click(screen.getByRole("checkbox", { name: "通勤质感风" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByText(/场景描述生成缺少已选风格/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "改写 首屏主视觉" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
  });

  it("reuses the existing prompt plan after returning from strategy drafting without input changes", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByRole("textbox", { name: "改写 首屏主视觉" })).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === "prompt_plan_create")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByRole("textbox", { name: "改写 首屏主视觉" })).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === "prompt_plan_create")).toHaveLength(1);
  });

  it("regenerates the prompt plan after returning from strategy drafting when product inputs change", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByRole("textbox", { name: "改写 首屏主视觉" })).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === "prompt_plan_create")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), " 支持通勤使用。");
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(await screen.findByRole("textbox", { name: "改写 首屏主视觉" })).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === "prompt_plan_create")).toHaveLength(2);
  });

  it("runs image rewrite tasks and applies the returned image", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气，适合日常通勤。");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const detailGenerateButton = await screen.findByRole("button", { name: /生成详情图/ });
    fireEvent.click(detailGenerateButton);

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("generated-detail-image-card")
          .some((card) => card.textContent?.includes("首屏主视觉")),
      ).toBe(true);
    });
    const sceneResultCard = screen
      .getAllByTestId("generated-detail-image-card")
      .find((card) => card.textContent?.includes("首屏主视觉")) as HTMLElement;
    await user.hover(sceneResultCard);
    await user.click(within(sceneResultCard).getByRole("button", { name: "AI改图 首屏主视觉" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "输入微调方向" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "输入调整要求" }), {
      target: { value: "把背景改成浅灰色，商品向左移动一点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新生成 15" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            inputAssets: [
              {
                assetId: "asset_generated_1",
                role: "reference",
                sortOrder: 0,
              },
            ],
            input: expect.objectContaining({
              basePrompt: expect.stringContaining("首屏主视觉"),
              imageNo: 1,
              parentTaskId: "task_image-generation",
              rewriteInstruction: "把背景改成浅灰色，商品向左移动一点",
              resolvedPrompt: expect.stringContaining("把背景改成浅灰色，商品向左移动一点"),
              sourceAssetId: "asset_generated_1",
              sourceImageTitle: "首屏主视觉",
              targetImageId: expect.any(String),
            }),
            kind: "image-edit",
            title: "微调 首屏主视觉",
            workspace: "product",
          }),
        }),
      ),
    );
    const rewriteTaskCreateCall = invokeMock.mock.calls.find(([command, args]) => {
      const input = (args as { input?: { kind?: string } } | undefined)?.input;
      return command === "generation_create_task" && input?.kind === "image-edit";
    });
    expect(JSON.stringify((rewriteTaskCreateCall?.[1] as { input?: unknown }).input)).not.toContain("data:image/");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_run_task", {
        taskId: "task_image-edit",
      }),
    );
    await waitFor(() =>
      expect(within(sceneResultCard).getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
        "src",
        expect.stringContaining("generated-1.png"),
      ),
    );
  });

  it.each([
    { replaceFails: false, title: "persists an image rewrite into the original result slot" },
    { replaceFails: true, title: "cleans up an unmerged image rewrite and keeps the original result" },
  ])("$title", async ({ replaceFails }) => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_replace_result_image" && replaceFails) {
        return Promise.reject(new Error("父任务槽位已变化"));
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_image-edit") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_rewritten_1",
                  localPath: "/workspace/current/assets/generated/rewritten-1.png",
                  relativePath: "assets/generated/rewritten-1.png",
                  url: "asset://localhost/workspace/current/assets/generated/rewritten-1.png",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            task: {
              id: taskId,
              kind: "image-edit",
              stage: "completed",
              status: "succeeded",
              workspace: "product",
            },
          });
        }
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: /生成详情图/ }));
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("generated-detail-image-card")
          .some((card) => card.textContent?.includes("首屏主视觉")),
      ).toBe(true);
    });
    const sceneResultCard = screen
      .getAllByTestId("generated-detail-image-card")
      .find((card) => card.textContent?.includes("首屏主视觉")) as HTMLElement;
    await user.hover(sceneResultCard);
    await user.click(within(sceneResultCard).getByRole("button", { name: "AI改图 首屏主视觉" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "输入调整要求" }), {
      target: { value: "把背景改成浅灰色" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新生成 15" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_replace_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            currentAssetId: "asset_generated_1",
            displayedAssetId: "asset_generated_1",
            replacementAssetId: "asset_rewritten_1",
            replacementTaskId: "task_image-edit",
            taskId: "task_image-generation",
          }),
        }),
      ),
    );
    if (replaceFails) {
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", { taskId: "task_image-edit" }),
      );
      expect(within(sceneResultCard).getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
        "src",
        expect.stringContaining("generated-1.png"),
      );
    }
  });

  it("shows image rewrite failures and keeps the original result", async () => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();

    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_image-edit") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [],
            task: {
              id: taskId,
              kind: "image-edit",
              stage: "failed",
              status: "failed",
              workspace: "product",
            },
          });
        }
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: /生成详情图/ }));
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("generated-detail-image-card")
          .some((card) => card.textContent?.includes("首屏主视觉")),
      ).toBe(true);
    });
    const sceneResultCard = screen
      .getAllByTestId("generated-detail-image-card")
      .find((card) => card.textContent?.includes("首屏主视觉")) as HTMLElement;
    const originalImage = within(sceneResultCard).getByRole("img", { name: "首屏主视觉" });
    expect(originalImage).toHaveAttribute("src", expect.stringContaining("generated-1.png"));

    await user.hover(sceneResultCard);
    await user.click(within(sceneResultCard).getByRole("button", { name: "AI改图 首屏主视觉" }));
    fireEvent.click(await screen.findByRole("button", { name: "重新生成 15" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("AI 改图失败。"));
    expect(within(sceneResultCard).getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
      "src",
      expect.stringContaining("generated-1.png"),
    );
  });

  it("routes failed listing copy retry to text generation instead of image generation", async () => {
    const imageRetry = vi.fn();
    const listingCopyRetry = vi.fn();

    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[
          {
            errorMessage: "上架文案生成失败。",
            id: "listing-copy-failed",
            kind: "listing-copy",
            status: "failed",
            title: "商品上架文案",
          },
        ]}
        onImageRetry={imageRetry}
        onListingCopyRetry={listingCopyRetry}
      />,
    );

    const listingCopyCard = screen.getByTestId("listing-copy-result-card");
    expect(listingCopyCard).toHaveTextContent("商品上架文案");
    expect(listingCopyCard).toHaveTextContent("生成失败");

    await userEvent.setup().click(within(listingCopyCard).getByRole("button", { name: "重新生成商品上架文案" }));

    expect(listingCopyRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "listing-copy-failed",
        kind: "listing-copy",
      }),
    );
    expect(imageRetry).not.toHaveBeenCalled();
  });

  it("does not let listing copy retry replace the currently opened history record", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let resolveListingRetryDetail: ((value: unknown) => void) | undefined;
    const listingRetryDetail = new Promise((resolve) => {
      resolveListingRetryDetail = resolve;
    });
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_list_tasks") {
        return Promise.resolve({
          items: [
            {
              attemptNo: 1,
              completedAt: "2026-07-02T12:01:00.000Z",
              createdAt: "2026-07-02T12:00:00.000Z",
              id: "task_record_with_failed_listing",
              kind: "image-generation",
              promptPlanId: "local-task_record_with_failed_listing",
              stage: "completed",
              status: "succeeded",
              title: "带文案失败的商品详情图",
              updatedAt: "2026-07-02T12:01:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T12:02:00.000Z",
              createdAt: "2026-07-02T12:01:30.000Z",
              id: "task_failed_listing_copy",
              kind: "listing-copy",
              promptPlanId: "local-task_record_with_failed_listing",
              stage: "failed",
              status: "failed",
              title: "商品上架文案",
              updatedAt: "2026-07-02T12:02:00.000Z",
              workspace: "product",
            },
            {
              attemptNo: 1,
              completedAt: "2026-07-02T12:11:00.000Z",
              createdAt: "2026-07-02T12:10:00.000Z",
              id: "task_other_history",
              kind: "image-generation",
              promptPlanId: "local-task_other_history",
              stage: "completed",
              status: "succeeded",
              title: "另一条商品详情图",
              updatedAt: "2026-07-02T12:11:00.000Z",
              workspace: "product",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 3,
        });
      }
      if (command === "generation_create_task") {
        const input = (args as { input?: { idempotencyKey?: string; kind?: string } } | undefined)?.input;
        return Promise.resolve({
          id: input?.idempotencyKey?.includes("listing-copy-retry")
            ? "task_listing_retry_pending"
            : `task_${input?.kind ?? "generation"}`,
          kind: input?.kind ?? "listing-copy",
          stage: "queued",
          status: "queued",
          workspace: "product",
        });
      }
      if (command === "generation_run_task") {
        return Promise.resolve({
          invocationId: "inv_listing_retry_pending",
          taskId: (args as { taskId?: string } | undefined)?.taskId,
        });
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_record_with_failed_listing") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              language: "中文",
              market: "中国",
              platform: "淘宝天猫",
              productSellingPoints: "旧记录商品",
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_failed_listing_parent",
                  relativePath: "assets/generated/failed-listing-parent.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/failed-listing-parent.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              planId: "local-task_record_with_failed_listing",
              items: [{ id: "hero", title: "旧记录首屏图" }],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "local-task_record_with_failed_listing",
              status: "succeeded",
              title: "带文案失败的商品详情图",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_failed_listing_copy") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-listing-copy",
              platform: "淘宝天猫",
            },
            inputAssets: [],
            output: null,
            outputAssets: [],
            promptPlanSnapshot: {
              planId: "local-task_record_with_failed_listing",
            },
            task: {
              error: { message: "上架文案生成失败。" },
              id: taskId,
              kind: "listing-copy",
              promptPlanId: "local-task_record_with_failed_listing",
              status: "failed",
              title: "商品上架文案",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_other_history") {
          return Promise.resolve({
            events: [],
            input: {
              kind: "product-detail-generation",
              language: "中文",
              market: "中国",
              platform: "淘宝天猫",
              productSellingPoints: "另一条记录商品",
            },
            inputAssets: [],
            outputAssets: [
              {
                asset: {
                  id: "asset_other_history",
                  relativePath: "assets/generated/other-history.jpeg",
                  url: "asset://localhost/workspace/current/assets/generated/other-history.jpeg",
                },
                role: "output",
                sortOrder: 0,
              },
            ],
            promptPlanSnapshot: {
              planId: "local-task_other_history",
              items: [{ id: "other-hero", title: "另一条首屏图" }],
            },
            task: {
              id: taskId,
              kind: "image-generation",
              promptPlanId: "local-task_other_history",
              status: "succeeded",
              title: "另一条商品详情图",
              workspace: "product",
            },
          });
        }
        if (taskId === "task_listing_retry_pending") {
          return listingRetryDetail;
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    renderApp();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_list_tasks", expect.any(Object)));
    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const firstHistoryDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(firstHistoryDialog).getByRole("button", { name: /旧记录首屏图 .*带文案失败的商品详情图/ }));
    expect(screen.getByRole("img", { name: "旧记录首屏图" })).toHaveAttribute(
      "src",
      expect.stringContaining("failed-listing-parent.jpeg"),
    );
    await user.click(screen.getByRole("button", { name: "重新生成商品上架文案" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_run_task", {
        taskId: "task_listing_retry_pending",
      }),
    );

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const secondHistoryDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(secondHistoryDialog).getByRole("button", { name: /另一条首屏图 .*另一条商品详情图/ }));
    expect(screen.getByRole("img", { name: "另一条首屏图" })).toHaveAttribute(
      "src",
      expect.stringContaining("other-history.jpeg"),
    );

    resolveListingRetryDetail?.({
      events: [],
      inputAssets: [],
      output: {
        attributeWords: ["旧记录"],
        detailCopy: "旧记录重试文案。",
        mainImageGuidance: ["主图展示"],
        promotionBenefits: ["适合旧记录"],
        searchKeywords: ["旧记录商品"],
        sellingPoints: ["旧记录卖点"],
        title: "旧记录重试文案标题",
      },
      outputAssets: [],
      task: {
        id: "task_listing_retry_pending",
        kind: "listing-copy",
        status: "succeeded",
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "另一条首屏图" })).toHaveAttribute(
        "src",
        expect.stringContaining("other-history.jpeg"),
      ),
    );
    expect(screen.queryByRole("img", { name: "旧记录首屏图" })).not.toBeInTheDocument();
  });

  it("locks strategy modules and shows generated detail image actions after starting detail generation", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "网面人像印花无袖运动T恤");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    await user.click(screen.getByRole("checkbox", { name: "尺寸/容量/尺码图" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const detailGenerateButton = await screen.findByRole("button", { name: "生成详情图（3张）" });
    fireEvent.click(detailGenerateButton);

    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    expect(screen.getByText("2026-06-29 15:52")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "全选" })).toBeInTheDocument();
    expect(screen.getByTestId("generated-detail-bulk-actions")).toHaveClass("min-h-7");
    expect(screen.queryByRole("button", { name: "删除所选图片" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量下载所选图片" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览长图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载全部" })).toBeInTheDocument();
    expect(screen.getAllByText("AI 生成中")).not.toHaveLength(0);

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("generated-detail-image-card")
          .some((card) => card.textContent?.includes("首屏主视觉")),
      ).toBe(true);
    });
    expect(screen.getByRole("complementary", { name: "模块策略与设计规范" })).toBeInTheDocument();
    expect(screen.getByTestId("studio-side-divider")).toHaveClass("left-[var(--studio-side-width)]");
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("left-[var(--studio-nav-width)]");
    const firstDetailImage = screen
        .getAllByTestId("generated-detail-image-card")
        .find((card) => card.textContent?.includes("首屏主视觉")) as HTMLElement | undefined;
    expect(firstDetailImage).toBeDefined();
    const firstDetailImageCard = firstDetailImage as HTMLElement;
    await user.hover(firstDetailImageCard);

    expect(firstDetailImageCard).toHaveTextContent("首屏主视觉");
    expect(firstDetailImageCard).toHaveClass("border-2");
    expect(within(firstDetailImageCard).getByTestId("generated-image-title")).toHaveClass(
      "translate-y-8",
      "group-hover:translate-y-0",
      "transition-transform",
    );
    expect(within(firstDetailImageCard).getByTestId("generated-image-card-actions")).toHaveClass(
      "translate-y-2",
      "opacity-0",
      "group-hover:translate-y-0",
      "group-hover:opacity-100",
    );
    expect(within(firstDetailImageCard).getByRole("button", { name: /修改尺寸/ })).toBeInTheDocument();
    expect(within(firstDetailImageCard).getByRole("button", { name: /下载/ })).toBeInTheDocument();
    expect(within(firstDetailImageCard).getByRole("button", { name: /删除/ })).toBeInTheDocument();
    const rewriteImageButton = within(firstDetailImageCard).getByRole("button", { name: "AI改图 首屏主视觉" });
    const editTextButton = within(firstDetailImageCard).getByRole("button", { name: "编辑文字 首屏主视觉" });
    expect(rewriteImageButton).toHaveClass(
      "bg-[#e4e4e4]",
      "text-slate-700",
      "duration-300",
      "hover:bg-[#3f3f3f]",
      "hover:text-white",
    );
    expect(editTextButton).toHaveClass(
      "bg-[#e4e4e4]",
      "text-slate-700",
      "duration-300",
      "hover:bg-[#3f3f3f]",
      "hover:text-white",
    );

    await user.click(within(firstDetailImageCard).getByRole("button", { name: "AI改图 首屏主视觉" }));

    const imageRewriteDialog = screen.getByRole("dialog", { name: "输入微调方向" });
    expect(imageRewriteDialog).toBeInTheDocument();
    expect(screen.queryByText("输入微调方向（选填）")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成 15" })).toHaveClass("h-8", "px-3");
    expect(screen.getByRole("button", { name: "重新生成 15" })).not.toHaveClass("w-full", "h-11");

    fireEvent.click(imageRewriteDialog);
    expect(screen.queryByRole("dialog", { name: "输入微调方向" })).not.toBeInTheDocument();

    await user.click(within(firstDetailImageCard).getByRole("button", { name: "AI改图 首屏主视觉" }));

    fireEvent.change(screen.getByRole("textbox", { name: "输入调整要求" }), {
      target: { value: "商品向左移动一点，换成浅灰色背景" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新生成 15" }));

    expect(screen.queryByRole("dialog", { name: "输入微调方向" })).not.toBeInTheDocument();
    expect(firstDetailImageCard).toHaveTextContent("AI 生成中");
    expect(within(firstDetailImageCard).queryByRole("button", { name: "AI改图 首屏主视觉" })).not.toBeInTheDocument();

    await waitFor(() => expect(firstDetailImageCard).toHaveTextContent("首屏主视觉"));
    expect(within(firstDetailImageCard).getByRole("button", { name: "AI改图 首屏主视觉" })).toBeInTheDocument();

    await user.click(within(firstDetailImageCard).getByRole("button", { name: "编辑文字 首屏主视觉" }));

    const textEditDialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(textEditDialog).toBeInTheDocument();
    expect(screen.getByDisplayValue("Size Guide")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Length (CM)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认改字 15" })).toHaveClass("h-8", "px-3");
    expect(screen.getByRole("button", { name: "确认改字 15" })).not.toHaveClass("h-[42px]");

    fireEvent.click(textEditDialog);
    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();

    await user.click(within(firstDetailImageCard).getByRole("button", { name: "编辑文字 首屏主视觉" }));

    fireEvent.change(screen.getByDisplayValue("Length (CM)"), {
      target: { value: "Length / 长度" },
    });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "确认改字 15" }));

    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();
    expect(firstDetailImageCard).toHaveTextContent("AI 生成中");
    expect(within(firstDetailImageCard).queryByRole("button", { name: "编辑文字 首屏主视觉" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    expect(firstDetailImageCard).toHaveTextContent("首屏主视觉");
    expect(within(firstDetailImageCard).getByRole("button", { name: "编辑文字 首屏主视觉" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览长图" }));

    const longPreviewDialog = screen.getByRole("dialog", { name: "长图预览" });
    expect(longPreviewDialog).toBeInTheDocument();
    expect(screen.getAllByTestId("long-preview-image-section")).toHaveLength(3);
    expect(within(longPreviewDialog).queryByText("首屏主视觉")).not.toBeInTheDocument();
    expect(within(longPreviewDialog).queryByText("突出商品核心卖点，强化购买决策")).not.toBeInTheDocument();

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/detail-long.png");
    await user.click(screen.getByRole("button", { name: "下载长图" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "生成结果-2026-06-29-1552-长图.png",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/detail-long.png",
      bytes: expect.any(Array),
    }));
    const longImagePayload = invokeMock.mock.calls[invokeMock.mock.calls.length - 1]?.[1] as { bytes: number[] };
    const longImageMarkup = new TextDecoder().decode(new Uint8Array(longImagePayload.bytes));
    expect(longImageMarkup).not.toContain("首屏主视觉");
    expect(longImageMarkup).not.toContain("突出商品核心卖点，强化购买决策");

    await user.click(screen.getByRole("button", { name: "关闭长图预览" }));

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/cover.png");
    await user.click(within(firstDetailImageCard).getByRole("button", { name: "下载 首屏主视觉" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "首屏主视觉.png",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/cover.png",
      bytes: expect.any(Array),
    }));

    await user.click(within(firstDetailImageCard).getByRole("button", { name: "修改尺寸 首屏主视觉" }));
    const resizeDialog = await screen.findByRole("dialog", { name: "修改图片尺寸" });
    await user.click(within(resizeDialog).getByRole("radio", { name: "方图 1:1 · 1024×1024" }));
    await user.click(within(resizeDialog).getByRole("button", { name: "修改" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            inputAssets: [{ assetId: "asset_generated_1", role: "reference", sortOrder: 0 }],
            input: expect.objectContaining({
              basePrompt: expect.any(String),
              imageNo: 1,
              kind: "result-image-resize",
              parentTaskId: expect.any(String),
              ratio: "1:1",
              size: "1024x1024",
              targetImageId: expect.any(String),
            }),
            kind: "image-edit",
            title: "修改尺寸 首屏主视觉",
            workspace: "product",
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_replace_result_image",
        expect.objectContaining({
          input: expect.objectContaining({
            currentAssetId: "asset_generated_1",
            replacementAssetId: "asset_generated_1",
            replacementTaskId: "task_image-edit",
          }),
        }),
      ),
    );

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/all.zip");
    await user.click(screen.getByRole("button", { name: "下载全部" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "生成结果-2026-06-29-1552-全部图片.zip",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/all.zip",
      bytes: expect.any(Array),
    }));

    await user.click(firstDetailImageCard);

    expect(firstDetailImageCard).not.toHaveClass("border-slate-950");
    expect(within(firstDetailImageCard).getByRole("checkbox", { name: "选择 首屏主视觉" })).not.toBeChecked();
    expect(screen.getByRole("dialog", { name: "图片相册预览" })).toHaveClass("fixed", "inset-0");
    expect(screen.getByText(/1 \/ \d/)).toBeInTheDocument();
    expect(screen.getByLabelText("预览 首屏主视觉")).toBeInTheDocument();
    expect(screen.getByTestId("image-lightbox-thumbnail-strip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看缩略图 使用场景图" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(screen.getByText(/2 \/ \d/)).toBeInTheDocument();
    expect(screen.getByLabelText("预览 使用场景图")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "放大图片" }));

    expect(screen.getByLabelText("预览 使用场景图")).toHaveStyle({ transform: "scale(1.25)" });
    expect(screen.getByRole("button", { name: "缩小图片" })).toBeEnabled();

    fireEvent.wheel(screen.getByLabelText("预览 使用场景图"), { deltaY: -120 });

    expect(screen.getByLabelText("预览 使用场景图")).toHaveStyle({ transform: "scale(1.5)" });

    fireEvent.click(screen.getByRole("dialog", { name: "图片相册预览" }));

    expect(screen.queryByRole("dialog", { name: "图片相册预览" })).not.toBeInTheDocument();

    await user.click(within(firstDetailImageCard).getByRole("checkbox", { name: "选择 首屏主视觉" }));
    await user.click(within(screen.getAllByTestId("generated-detail-image-card")[1]).getByRole("checkbox", { name: "选择 使用场景图" }));

    expect(firstDetailImageCard).toHaveClass("border-2", "border-slate-950");
    expect(screen.getByTestId("generated-detail-bulk-actions")).toHaveClass("min-h-7");
    expect(screen.getByRole("button", { name: "删除所选图片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量下载所选图片" })).toBeInTheDocument();

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/selected.zip");
    await user.click(screen.getByRole("button", { name: "批量下载所选图片" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "生成结果-2026-06-29-1552-已选图片.zip",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/selected.zip",
      bytes: expect.any(Array),
    }));

    await user.click(screen.getByRole("button", { name: "删除所选图片" }));

    expect(screen.queryByText("首屏主视觉")).not.toBeInTheDocument();
    expect(screen.queryByText("使用场景图")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除所选图片" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成详情图（3张）" })).toBeInTheDocument();
  });

  it("adds a listing copy result card and opens the listing copy dialog when enabled", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/jacket.png",
        aiAssistDataUrl: "data:image/png;base64,raw-product-image",
        aiAssistMimeType: "image/png",
        name: "jacket.png",
        path: "/Users/demo/Pictures/jacket.png",
        src: "asset://jacket.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.click(screen.getByRole("button", { name: "商品上架文案生成" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "黑色宽松落肩夹克，双面领设计，通勤防风。");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.mocked(Math.random).mockReturnValue(0);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const listingDetailGenerateButton = await screen.findByRole("button", { name: "生成详情图（2张）" });
    fireEvent.click(listingDetailGenerateButton);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("generation_create_task", expect.any(Object)));
    const imageTaskCreateCall = invokeMock.mock.calls.find(([command, args]) => {
      const input = (args as { input?: { kind?: string } } | undefined)?.input;
      return command === "generation_create_task" && input?.kind === "image-generation";
    });
    expect(imageTaskCreateCall).toBeDefined();
    const imageTaskPayload = JSON.stringify((imageTaskCreateCall?.[1] as { input?: unknown }).input);
    expect(imageTaskPayload).not.toContain("data:image/");
    expect(imageTaskPayload).toContain("模型生成 imagePrompt");
    expect(imageTaskPayload).toContain("imagePrompt");
    expect(imageTaskPayload).toContain("copyRequirements");
    expect(invokeMock).toHaveBeenCalledWith("asset_import_images", {
      input: {
        kind: "source",
        paths: ["/Users/demo/Pictures/jacket.png"],
      },
    });
    expect(imageTaskCreateCall?.[1]).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          inputAssets: [
            {
              assetId: "asset_imported_1",
              role: "source",
              sortOrder: 0,
            },
          ],
        }),
      }),
    );

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "generation_create_task",
        expect.objectContaining({
          input: expect.objectContaining({
            input: expect.objectContaining({
              kind: "product-listing-copy",
              platform: "淘宝天猫",
              productSellingPoints: expect.stringContaining("黑色宽松落肩夹克"),
              designSpec: expect.stringContaining("产品与卖点"),
            }),
            kind: "listing-copy",
            title: "商品上架文案",
            workspace: "product",
          }),
        }),
      ),
    );
    const listingTaskCreateCall = invokeMock.mock.calls.find(([command, args]) => {
      const input = (args as { input?: { kind?: string } } | undefined)?.input;
      return command === "generation_create_task" && input?.kind === "listing-copy";
    });
    const listingTaskInput = (listingTaskCreateCall?.[1] as { input?: { input?: Record<string, unknown> } } | undefined)
      ?.input?.input;
    expect(listingTaskInput).not.toHaveProperty("scenes");
    expect(listingTaskInput?.prompt).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("电商商品上架文案"),
            role: "system",
          }),
          expect.objectContaining({
            content: expect.stringContaining("黑色宽松落肩夹克"),
            role: "user",
          }),
          expect.objectContaining({
            content: expect.stringContaining("产品与卖点"),
            role: "user",
          }),
          expect.objectContaining({
            content: expect.stringContaining("只输出一个 JSON 对象"),
            role: "user",
          }),
          expect.objectContaining({
            content: expect.stringContaining("不要输出 Markdown"),
            role: "user",
          }),
        ]),
        rolelessPrompt: expect.stringContaining("黑色宽松落肩夹克"),
      }),
    );
    expect(JSON.stringify(listingTaskInput)).not.toContain("模型生成 imagePrompt");
    expect(JSON.stringify(listingTaskInput)).not.toContain("copyRequirements");
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_run_task", {
        taskId: "task_image-generation",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "generation_run_task",
      expect.objectContaining({
        taskId: expect.stringContaining("listing-copy"),
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_next_task");

    await waitFor(() => expect(screen.getByTestId("listing-copy-result-card")).not.toHaveTextContent("AI 生成中"));

    expect(screen.getAllByTestId("generated-detail-image-card").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("failed-result-card")).not.toBeInTheDocument();
    const listingCopyCard = screen.getByTestId("listing-copy-result-card");
    expect(listingCopyCard).toHaveTextContent("商品上架文案");
    expect(within(listingCopyCard).getByText("商品上架文案")).toHaveClass("bg-blue-50", "text-app-blue");
    expect(within(listingCopyCard).getByText("宝贝标题")).toBeInTheDocument();
    expect(within(listingCopyCard).getByText("核心卖点/促销利益点")).toBeInTheDocument();
    expect(within(listingCopyCard).getByText("详情页文案")).toBeInTheDocument();
    expect(within(listingCopyCard).getByText("搜索关键词/属性词")).toBeInTheDocument();
    expect(within(listingCopyCard).getByRole("button", { name: "查看商品上架文案" })).toBeInTheDocument();
    expect(within(listingCopyCard).getByRole("button", { name: "复制商品上架文案卡片" })).toBeInTheDocument();

    await user.click(within(listingCopyCard).getByRole("button", { name: "复制商品上架文案卡片" }));

    expect(screen.getByText("已复制商品上架文案")).toBeInTheDocument();

    await user.click(within(listingCopyCard).getByRole("button", { name: "查看商品上架文案" }));

    const listingDialog = screen.getByRole("dialog", { name: "商品上架文案" });
    expect(listingDialog).toBeInTheDocument();
    expect(within(listingDialog).getByText("宝贝标题")).toBeInTheDocument();
    expect(within(listingDialog).getByText("核心卖点/促销利益点")).toBeInTheDocument();
    expect(within(listingDialog).getByText("详情页文案")).toBeInTheDocument();
    expect(within(listingDialog).getByText("搜索关键词/属性词")).toBeInTheDocument();
    expect(within(listingDialog).getByText("主图拍摄规划")).toBeInTheDocument();
    expect(within(listingDialog).getByRole("button", { name: "翻译" })).toBeInTheDocument();
    expect(within(listingDialog).getByRole("button", { name: "复制商品上架文案" })).toBeInTheDocument();

    await user.click(within(listingDialog).getByRole("button", { name: "关闭商品上架文案" }));

    expect(screen.queryByRole("dialog", { name: "商品上架文案" })).not.toBeInTheDocument();
  });

  it("deletes tasks created after a generating history record was removed", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let resolveImageTask: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { kind?: string } } | undefined)?.input;
        if (input?.kind === "image-generation") {
          return new Promise((resolve) => {
            resolveImageTask = resolve;
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/jacket.png",
        aiAssistDataUrl: "data:image/png;base64,raw-product-image",
        aiAssistMimeType: "image/png",
        name: "jacket.png",
        path: "/Users/demo/Pictures/jacket.png",
        src: "asset://jacket.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "黑色宽松落肩夹克，双面领设计。");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "生成详情图（2张）" }));
    await waitFor(() => expect(resolveImageTask).toBeDefined());

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "删除记录 商品详情图" }));

    await act(async () => {
      resolveImageTask?.({
        attemptNo: 1,
        createdAt: "2026-07-02T00:00:00.000Z",
        id: "task_pending_image",
        kind: "image-generation",
        stage: "queued",
        status: "queued",
        title: "商品详情图",
        updatedAt: "2026-07-02T00:00:00.000Z",
        workspace: "product",
      });
    });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: "task_pending_image",
      }),
    );
  });

  it("deletes a clothing task created after its generating history record was removed", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("都市街头")).toBeInTheDocument();

    const baseInvoke = invokeMock.getMockImplementation();
    let resolveClothingTask: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-tryon-generation") {
          return new Promise((resolve) => {
            resolveClothingTask = resolve;
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    await user.click(screen.getByRole("checkbox", { name: "街角咖啡" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（3张）" }));
    await waitFor(() => expect(resolveClothingTask).toBeDefined());

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "删除记录 服饰场景图" }));

    await act(async () => {
      resolveClothingTask?.({
        attemptNo: 1,
        createdAt: "2026-07-02T00:00:00.000Z",
        id: "task_pending_clothing",
        kind: "image-generation",
        stage: "queued",
        status: "queued",
        title: "服饰场景图",
        updatedAt: "2026-07-02T00:00:00.000Z",
        workspace: "clothing",
      });
    });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: "task_pending_clothing",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_task", { taskId: "task_pending_clothing" });
  });

  it("deletes a clothing task created after generating history was cleared", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    expect(await screen.findByText("都市街头")).toBeInTheDocument();

    const baseInvoke = invokeMock.getMockImplementation();
    let resolveClothingTask: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_create_task") {
        const input = (args as { input?: { input?: { kind?: string } } } | undefined)?.input;
        if (input?.input?.kind === "clothing-tryon-generation") {
          return new Promise((resolve) => {
            resolveClothingTask = resolve;
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });

    await user.click(screen.getByRole("checkbox", { name: "街角咖啡" }));
    await user.click(screen.getByRole("button", { name: "生成场景图片（3张）" }));
    await waitFor(() => expect(resolveClothingTask).toBeDefined());

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    await user.click(screen.getByRole("button", { name: "清空" }));

    await act(async () => {
      resolveClothingTask?.({
        attemptNo: 1,
        createdAt: "2026-07-02T00:00:00.000Z",
        id: "task_pending_clothing_after_clear",
        kind: "image-generation",
        stage: "queued",
        status: "queued",
        title: "服饰场景图",
        updatedAt: "2026-07-02T00:00:00.000Z",
        workspace: "clothing",
      });
    });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_delete_task", {
        taskId: "task_pending_clothing_after_clear",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_task", {
      taskId: "task_pending_clothing_after_clear",
    });
  });

  it("renders each returned generated image progressively while other cards keep loading", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let imageDetailCalls = 0;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_image-generation") {
          imageDetailCalls += 1;
          const outputAssets = [
            {
              asset: {
                id: "asset_progressive_1",
                localPath: "/workspace/current/assets/generated/progressive-1.jpeg",
                relativePath: "assets/generated/progressive-1.jpeg",
                url: "asset://localhost/workspace/current/assets/generated/progressive-1.jpeg",
              },
              role: "output",
              sortOrder: 0,
            },
          ];
          if (imageDetailCalls > 1) {
            outputAssets.push({
              asset: {
                id: "asset_progressive_2",
                localPath: "/workspace/current/assets/generated/progressive-2.jpeg",
                relativePath: "assets/generated/progressive-2.jpeg",
                url: "asset://localhost/workspace/current/assets/generated/progressive-2.jpeg",
              },
              role: "output",
              sortOrder: 1,
            });
          }
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets,
            task: {
              id: taskId,
              kind: "image-generation",
              stage: imageDetailCalls > 1 ? "completed" : "calling-provider",
              status: imageDetailCalls > 1 ? "succeeded" : "running",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/tshirt.png",
        name: "tshirt.png",
        path: "/Users/demo/Pictures/tshirt.png",
        src: "asset://tshirt.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "藏青运动风字母印花圆领短袖T恤");
    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "生成详情图（2张）" }));

    const firstImage = await screen.findByRole("img", { name: "首屏主视觉" });
    expect(firstImage).toHaveAttribute("src", expect.stringContaining("progressive-1.jpeg"));
    expect(screen.getAllByText("AI 生成中").length).toBeGreaterThan(0);

    const secondImage = await screen.findByRole("img", { name: "使用场景图" });
    expect(secondImage).toHaveAttribute("src", expect.stringContaining("progressive-2.jpeg"));
  });

  it("keeps listing copy independent when the product image task fails", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_image-generation") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [],
            task: {
              error: { message: "图片生成失败" },
              id: taskId,
              kind: "image-generation",
              stage: "failed",
              status: "failed",
            },
          });
        }
        if (taskId.includes("listing")) {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            output: {
              attributeWords: ["玻璃瓶", "滴管瓶"],
              detailCopy: "透明玻璃滴管瓶，适合精华液分装与旅行携带。",
              mainImageGuidance: ["主图展示瓶身通透质感", "细节图突出滴管与瓶口"],
              platform: "淘宝天猫",
              promotionBenefits: ["便携分装"],
              searchKeywords: ["玻璃滴管瓶", "精华分装瓶"],
              sellingPoints: ["透明瓶身", "滴管取液"],
              title: "透明玻璃滴管精华分装瓶",
            },
            outputAssets: [],
            task: {
              id: taskId,
              kind: "listing-copy",
              stage: "completed",
              status: "succeeded",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/bottle.png",
        name: "bottle.png",
        path: "/Users/demo/Pictures/bottle.png",
        src: "asset://bottle.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "商品上架文案生成" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "透明玻璃滴管精华分装瓶，银色盖，便携分装。");
    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "生成详情图（2张）" }));

    await waitFor(() => expect(screen.getAllByTestId("failed-result-card")).toHaveLength(2));
    const listingCopyCard = await screen.findByTestId("listing-copy-result-card");
    expect(listingCopyCard).toHaveTextContent("透明玻璃滴管精华分装瓶");
    expect(listingCopyCard).not.toHaveTextContent("生成失败");
  });

  it("fails pending product image cards when the background task never starts", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_run_task") {
        return Promise.resolve(null);
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_image-generation") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: "queued",
              status: "queued",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/tshirt.png",
        name: "tshirt.png",
        path: "/Users/demo/Pictures/tshirt.png",
        src: "asset://tshirt.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "藏青运动风字母印花圆领短袖T恤");
    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "生成详情图（2张）" }));

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(13_000);
    });
    vi.useRealTimers();

    await waitFor(() => expect(screen.getAllByTestId("failed-result-card")).toHaveLength(2));
    expect(screen.queryByText("AI 生成中")).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("generation_run_task", { taskId: "task_image-generation" });
  });

  it("keeps queued tasks pending when runTask returns null before the worker picks them up", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let runTaskCalls = 0;
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_run_task") {
        runTaskCalls += 1;
        return Promise.resolve(runTaskCalls > 1 ? { taskId: "task_image-generation" } : null);
      }
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId === "task_image-generation") {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets:
              runTaskCalls > 1
                ? [
                    {
                      asset: {
                        id: "asset_late_start_1",
                        localPath: "/workspace/current/assets/generated/late-start-1.png",
                        relativePath: "assets/generated/late-start-1.png",
                        url: "asset://localhost/workspace/current/assets/generated/late-start-1.png",
                      },
                      role: "output",
                      sortOrder: 0,
                    },
                    {
                      asset: {
                        id: "asset_late_start_2",
                        localPath: "/workspace/current/assets/generated/late-start-2.png",
                        relativePath: "assets/generated/late-start-2.png",
                        url: "asset://localhost/workspace/current/assets/generated/late-start-2.png",
                      },
                      role: "output",
                      sortOrder: 1,
                    },
                  ]
                : [],
            task: {
              id: taskId,
              kind: "image-generation",
              stage: runTaskCalls > 1 ? "completed" : "queued",
              status: runTaskCalls > 1 ? "succeeded" : "queued",
            },
          });
        }
      }
      return baseInvoke?.(command, args) ?? Promise.resolve(undefined);
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/tshirt.png",
        name: "tshirt.png",
        path: "/Users/demo/Pictures/tshirt.png",
        src: "asset://tshirt.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "藏青运动风字母印花圆领短袖T恤");
    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByRole("button", { name: "生成详情图（2张）" }));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    });

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "首屏主视觉" })).toHaveAttribute(
        "src",
        expect.stringContaining("late-start-1.png"),
      ),
    );
    expect(runTaskCalls).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("failed-result-card")).not.toBeInTheDocument();
  });

  it("asks users to select product modules when all modules are unchecked", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "16:9" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "防晒透气，适合户外骑行。");

    const checkedModules = screen
      .getAllByRole("checkbox")
      .filter((checkbox) => checkbox.getAttribute("aria-checked") === "true");

    for (const checkbox of checkedModules) {
      await user.click(checkbox);
    }

    expect(screen.getByRole("button", { name: "请选择商品模块" })).toBeDisabled();
  });

  it("updates generation setting options and syncs language from the selected market", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));
    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));

    expect(screen.getByRole("button", { name: /高级A\+（Web端）/ })).toHaveTextContent("1464:600");
    expect(screen.getByRole("button", { name: /高级A\+（移动端）/ })).toHaveTextContent("600:450");
    expect(
      screen.getAllByRole("button", { name: /普通A\+/ }).find((button) => button.textContent?.includes("970:600")),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "9:16" }));

    expect(screen.getByRole("button", { name: "9:16" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));

    expect(screen.getByRole("button", { name: "淘宝天猫" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中国" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it("only shows ordinary and advanced A+ formats for Amazon", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(screen.getByTestId("product-format-select-trigger"));

    expect(screen.queryByRole("button", { name: "普通A+" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "高级A+" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级A\+（Web端）/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级A\+（移动端）/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "1:1" }).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));
    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));

    expect(screen.getAllByRole("button", { name: /普通A\+/ }).some((button) => button.textContent?.includes("970:600"))).toBe(true);
    expect(screen.getByRole("button", { name: "高级A+" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "高级A+" }));

    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（Web端）");

    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "京东" }));

    expect(screen.getByRole("button", { name: "京东" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中国" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("1:1");

    await user.click(screen.getByTestId("product-format-select-trigger"));

    expect(screen.queryByRole("button", { name: "普通A+" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "高级A+" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级A\+（Web端）/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级A\+（移动端）/ })).not.toBeInTheDocument();
  });

  it("keeps the format dropdown open for advanced A+ and supports web plus mobile selections", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));
    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "高级A+" }));

    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（Web端）");
    expect(
      screen
        .getAllByRole("button", { name: /高级A\+（Web端）/ })
        .find((button) => button.textContent?.includes("1464:600")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /高级A\+（移动端）/ })).toHaveTextContent("600:450");
    expect(screen.getByTestId("product-format-select-trigger")).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: /高级A\+（移动端）/ }));

    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（Web端）");
    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（移动端）");
    expect(screen.getByTestId("product-format-select-trigger")).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "1:1" }));

    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /高级A\+（移动端）/ })).not.toBeInTheDocument();
  });

  it("toggles product modules from the whole tile with desktop-like transitions", async () => {
    const user = userEvent.setup();

    renderApp();

    const brandModuleText = screen.getByText("品牌故事图");
    const brandModuleTile = brandModuleText.closest(".group");

    expect(brandModuleTile).toHaveClass("transition-all", "duration-300");
    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).not.toBeChecked();

    await user.click(brandModuleText);

    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).toBeChecked();

    await user.click(brandModuleText);

    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).not.toBeChecked();
  });

  it("runs viral style analysis after product images are uploaded", async () => {
    const user = userEvent.setup();
    const viralAnalysisResolvers: Array<() => void> = [];

    invokeMock.mockImplementation((command, args) => {
      if (command === "ai_assist_viral_style_analysis") {
        return new Promise((resolve) => {
          viralAnalysisResolvers.push(() =>
            resolve({
          capabilityId: "viral-style-analysis",
          promptId: "viral-style-analysis",
          data: {
            platform: "淘宝天猫",
            items: [
              {
                id: "style-1",
                title: "通勤质感风",
                subtitle: "突出黑色翻领衬衫的简洁通勤气质，适合天猫详情页表达。",
                colors: ["#111827", "#F8FAFC"],
              },
              {
                id: "style-2",
                title: "街头潮酷风",
                subtitle: "放大后背图案装饰记忆点，适合年轻人群点击。",
                colors: ["#0F172A", "#EF4444"],
              },
              {
                id: "style-3",
                title: "简约百搭风",
                subtitle: "强化黑色单品的搭配效率，适合详情页快速理解。",
                colors: ["#111111", "#FFFFFF"],
              },
              {
                id: "style-4",
                title: "细节品质风",
                subtitle: "用细节图与质感表达承接核心卖点，增强购买信任。",
                colors: ["#27272A", "#F4F4F5", "#71717A"],
              },
            ],
          },
          text: JSON.stringify(args),
            }),
          );
        });
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    expect(screen.getByText("附加功能")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "爆款风格分析" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "商品上架文案生成" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "开始爆款风格分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("限免")).not.toBeInTheDocument();
    expect(screen.getByLabelText("商品上架文案生成说明")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "爆款风格分析" }));

    expect(screen.getByRole("button", { name: "爆款风格分析" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "开始爆款风格分析" })).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText(/建议包含以下信息生成更精准/),
      "黑色翻领长袖版型，后背图案装饰，适合日常通勤。",
    );
    expect(screen.getByRole("button", { name: "开始爆款风格分析" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "开始爆款风格分析" }));

    expect(screen.getByText("正在分析爆款风格...")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("ai_assist_viral_style_analysis", {
      input: {
        platform: "淘宝天猫",
        productSellingPoints: "黑色翻领长袖版型，后背图案装饰，适合日常通勤。",
      },
    });

    act(() => viralAnalysisResolvers.shift()?.());
    expect(await screen.findByRole("checkbox", { name: "通勤质感风" })).toBeInTheDocument();
    expect(screen.queryByText("高级黑白")).not.toBeInTheDocument();
    expect(screen.queryByText("突出服装版型、面料质感和通勤搭配场景。")).not.toBeInTheDocument();
    expect(screen.queryByText("突出黑色翻领衬衫的简洁通勤气质，适合天猫详情页表达。")).not.toBeInTheDocument();
    expect(screen.getByText("突出黑色翻领衬衫的简洁通勤气质")).toBeInTheDocument();
    expect(screen.getAllByTestId("viral-style-color-dot")).toHaveLength(9);
    expect(screen.getAllByTestId("viral-style-color-row")[0]).toHaveClass("mt-auto");
    expect(screen.getByRole("button", { name: "换一批风格" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "换一批风格" }));

    expect(screen.getByText("正在分析爆款风格...")).toBeInTheDocument();
    act(() => viralAnalysisResolvers.shift()?.());
    expect(await screen.findByRole("checkbox", { name: "通勤质感风" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "商品上架文案生成" }));

    expect(screen.getByRole("button", { name: "商品上架文案生成" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /服饰/ }));
    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /商品/ }));

    expect(screen.getByRole("button", { name: "爆款风格分析" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "商品上架文案生成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "通勤质感风" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "换一批风格" })).toBeInTheDocument();
  });

  it("passes viral style generation guidance into product detail prompt planning", async () => {
    const user = userEvent.setup();
    let promptPlanIntent: Record<string, unknown> | undefined;

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/shirt.png",
        name: "shirt.png",
        path: "/Users/demo/Pictures/shirt.png",
        src: "asset://shirt.png",
      },
    ]);
    invokeMock.mockImplementation((command, args) => {
      if (command === "ai_assist_viral_style_analysis") {
        return Promise.resolve({
          capabilityId: "viral-style-analysis",
          data: {
            platform: "淘宝天猫",
            items: [
              {
                colors: ["#122344", "#F0F2F5", "#3377FF"],
                colorDescription: "深藏青（产品固有原色），浅米灰（大面积背景），雾霾蓝（卖点强调）",
                designFocus: "突出版型、质感、场景和人群标签。",
                fontStyleDescription: "常规字重无衬线体，规整端正，沉稳商务感",
                globalStyleNote: "柔和侧光，均匀漫射，低饱和氛围，细腻呈现面料肌理",
                iconStyle: "细线性简约商务风格",
                id: "style-1",
                reasoning: "适配上班族日常穿搭需求",
                subtitle: "适配通勤穿搭",
                title: "通勤质感风",
              },
              {
                colors: ["#102142", "#F5F7FA", "#FF7722"],
                colorDescription: "深藏青（产品固有原色），云亮白（大面积背景），暖橙色（卖点强调）",
                designFocus: "凸显速干高弹的运动属性。",
                fontStyleDescription: "稍粗字重无衬线体，利落方正，轻快活力感",
                globalStyleNote: "明亮自然光，顺向柔光铺设，通透清爽，阳光舒展氛围",
                iconStyle: "实心面性运动风格",
                id: "style-2",
                reasoning: "凸显速干高弹的运动属性",
                subtitle: "轻运动活力感",
                title: "轻运动活力风",
              },
              {
                colors: ["#132445", "#E8E9EB", "#555577"],
                colorDescription: "深藏青（产品固有原色），雅灰色（大面积背景），灰藏蓝（卖点强调）",
                designFocus: "契合极简穿搭人群审美。",
                fontStyleDescription: "中等字重无衬线体，间距宽松，简约高级感",
                globalStyleNote: "柔化顶侧光，低对比度光影，克制高级，干净沉静氛围",
                iconStyle: "极细线性极简风格",
                id: "style-3",
                reasoning: "契合极简穿搭人群审美",
                subtitle: "简约高级审美",
                title: "简约高级风",
              },
              {
                colors: ["#112243", "#EEF1EF", "#44AA66"],
                colorDescription: "深藏青（产品固有原色），雾青白（大面积背景），青绿色（卖点强调）",
                designFocus: "贴合城市漫步出行场景。",
                fontStyleDescription: "适中字重无衬线体，松弛舒展，休闲亲和感",
                globalStyleNote: "清透户外漫射光，明暗过渡自然，松弛随性，日常氛围感",
                iconStyle: "粗细结合休闲风格",
                id: "style-4",
                reasoning: "贴合城市漫步出行场景",
                subtitle: "城市休闲氛围",
                title: "城市休闲风",
              },
            ],
          },
          promptId: "viral-style-analysis",
          text: "",
        });
      }
      if (command === "prompt_plan_create") {
        promptPlanIntent = (args as { input?: { intent?: Record<string, unknown> } } | undefined)?.input?.intent;
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "爆款风格分析" }));
    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "深藏青速干T恤，适合通勤和轻运动。");
    await user.click(screen.getByRole("button", { name: "开始爆款风格分析" }));
    await screen.findByRole("checkbox", { name: "通勤质感风" });
    await user.click(screen.getByRole("checkbox", { name: "通勤质感风" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    await waitFor(() => expect(promptPlanIntent).toBeDefined());
    expect(promptPlanIntent).toEqual(
      expect.objectContaining({
        viralStyles: expect.arrayContaining([
          expect.objectContaining({
            colorDescription: "深藏青（产品固有原色），浅米灰（大面积背景），雾霾蓝（卖点强调）",
            fontStyleDescription: "常规字重无衬线体，规整端正，沉稳商务感",
            globalStyleNote: "柔和侧光，均匀漫射，低饱和氛围，细腻呈现面料肌理",
            iconStyle: "细线性简约商务风格",
            reasoning: "适配上班族日常穿搭需求",
            styleTitle: "通勤质感风",
          }),
        ]),
      }),
    );
  });

  it("returns viral style analysis to the start state after model failure", async () => {
    const user = userEvent.setup();
    let rejectViralAnalysis: ((error: Error) => void) | undefined;

    invokeMock.mockImplementation((command) => {
      if (command === "ai_assist_viral_style_analysis") {
        return new Promise((_, reject) => {
          rejectViralAnalysis = reject;
        });
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "爆款风格分析" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "黑色翻领衬衫，通勤穿搭。");
    await user.click(screen.getByRole("button", { name: "开始爆款风格分析" }));

    expect(screen.getByText("正在分析爆款风格...")).toBeInTheDocument();
    act(() => rejectViralAnalysis?.(new Error("没有可用模型")));
    expect(await screen.findByText("没有可用模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始爆款风格分析" })).toBeEnabled();
    expect(screen.queryByText("正在分析爆款风格...")).not.toBeInTheDocument();
  });

  it("disables product generation while viral style analysis is loading", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);
    invokeMock.mockImplementation((command) => {
      if (command === "ai_assist_viral_style_analysis") {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "儿童骑行头盔，轻量透气。");
    await user.click(screen.getByRole("button", { name: "爆款风格分析" }));

    const readyCta = screen.getByRole("button", { name: "开始生成" });
    expect(readyCta).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "开始爆款风格分析" }));

    expect(screen.getByText("正在分析爆款风格...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始生成" })).toBeDisabled();
  });

  it("groups generated product results by selected viral styles with a source image card", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet-front.png",
        name: "helmet-front.png",
        path: "/Users/demo/Pictures/helmet-front.png",
        src: "asset://helmet-front.png",
      },
      {
        id: "/Users/demo/Pictures/helmet-side.png",
        name: "helmet-side.png",
        path: "/Users/demo/Pictures/helmet-side.png",
        src: "asset://helmet-side.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "爆款风格分析" }));
    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByTestId("product-format-select-trigger"));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.click(screen.getByRole("button", { name: "商品上架文案生成" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "红黑潮玩摆件，电竞桌搭，适合社媒种草。");

    await user.click(screen.getByRole("button", { name: "开始爆款风格分析" }));
    await screen.findByRole("checkbox", { name: "街头潮酷风" });

    await user.click(screen.getByRole("checkbox", { name: "街头潮酷风" }));
    await user.click(screen.getByRole("checkbox", { name: "通勤质感风" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const groupedDetailGenerateButton = await screen.findByRole("button", { name: "生成详情图（12张）" });
    vi.useFakeTimers();
    fireEvent.click(groupedDetailGenerateButton);

    vi.mocked(Math.random).mockReturnValue(0.1);
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    const resultGroups = screen.getAllByTestId("generated-result-group");
    expect(resultGroups).toHaveLength(2);
    expect(resultGroups[0]).toHaveTextContent("街头潮酷风");
    expect(resultGroups[1]).toHaveTextContent("通勤质感风");
    expect(screen.queryByRole("button", { name: "预览长图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载全部" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多生成结果操作" })).not.toBeInTheDocument();

    for (const resultGroup of resultGroups) {
      const sourceCard = within(resultGroup).getByTestId("generated-source-image-card");
      expect(sourceCard).toHaveTextContent("原图");
      expect(within(sourceCard).getByText("原图")).toHaveClass("bg-slate-950/85", "text-white");
      expect(within(sourceCard).getAllByRole("img")).toHaveLength(2);
      expect(within(sourceCard).queryByRole("checkbox")).not.toBeInTheDocument();
      expect(within(sourceCard).queryByRole("button")).not.toBeInTheDocument();
      expect(within(resultGroup).getByTestId("listing-copy-result-card")).toBeInTheDocument();
    }
  });

  it("renders uploaded product images as one source card before flat generated results", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet-front.png",
        name: "helmet-front.png",
        path: "/Users/demo/Pictures/helmet-front.png",
        src: "asset://helmet-front.png",
      },
      {
        id: "/Users/demo/Pictures/helmet-side.png",
        name: "helmet-side.png",
        path: "/Users/demo/Pictures/helmet-side.png",
        src: "asset://helmet-side.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "红黑潮玩摆件，电竞桌搭，适合社媒种草。");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    vi.mocked(Math.random).mockReturnValue(0.99);
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const flatDetailGenerateButton = await screen.findByRole("button", { name: "生成详情图（6张）" });
    vi.useFakeTimers();
    fireEvent.click(flatDetailGenerateButton);

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    const resultGrid = screen.getByTestId("generated-result-grid");
    const firstResultCard = within(resultGrid).getAllByRole("article")[0];
    const sourceCard = within(resultGrid).getByTestId("generated-source-image-card");

    expect(firstResultCard).toBe(sourceCard);
    expect(sourceCard).toHaveTextContent("原图");
    expect(within(sourceCard).getByText("原图")).toHaveClass("bg-slate-950/85", "text-white");
    expect(sourceCard).not.toHaveTextContent("首屏主视觉");
    expect(within(sourceCard).getAllByRole("img")).toHaveLength(2);
    expect(within(sourceCard).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(sourceCard).queryByRole("button")).not.toBeInTheDocument();

    await user.click(sourceCard);

    expect(screen.queryByRole("dialog", { name: "图片相册预览" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览长图" }));

    const longPreviewSections = screen.getAllByTestId("long-preview-image-section");
    expect(longPreviewSections).toHaveLength(screen.getAllByTestId("generated-detail-image-card").length);
    const productLongPreviewDialog = screen.getByRole("dialog", { name: "长图预览" });
    expect(within(productLongPreviewDialog).queryByText("原图")).not.toBeInTheDocument();
    expect(within(productLongPreviewDialog).queryByRole("img", { name: "长图 helmet-front.png" })).not.toBeInTheDocument();
    expect(within(longPreviewSections[0]).getByRole("img", { name: "长图 首屏主视觉" })).toHaveClass(
      "block",
      "h-auto",
      "w-full",
      "object-contain",
    );
    expect(within(longPreviewSections[0]).getByRole("img", { name: "长图 首屏主视觉" })).not.toHaveClass(
      "absolute",
      "h-full",
      "object-cover",
    );
  });

  it("shows a toast when AI writing is requested before uploading product images", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: "AI 帮写" }));

    const disclaimer = screen.getByRole("dialog", { name: "图片上传与使用免责声明" });
    expect(disclaimer).toHaveTextContent("用户在使用本功能上传图片前");
    expect(screen.queryByText("请先上传商品图")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("ai_assist_product_selling_points", expect.anything());

    fireEvent.click(within(disclaimer).getByRole("button", { name: "我已知悉并继续" }));

    expect(screen.getByText("请先上传商品图")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "图片上传与使用免责声明" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "AI 帮写" })).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("ai_assist_product_selling_points", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("ai_assist_product_selling_points_stream", expect.anything());
  });

  it("calls product image-to-text AI writing and confirms the returned selling points", async () => {
    const user = userEvent.setup();
    const aiWritingText =
      "1、产品名称：黑色休闲翻领长袖衬衫\n\n2、核心卖点：\n* 卖点 1：黑色翻领长袖版型，简洁百搭。\n* 卖点 2：后背可见图案装饰，增加视觉层次。\n* 卖点 3：偏休闲穿搭，适合日常通勤和街头出行。\n* 卖点 4：需补充。";
    let resolveAssist: ((value: unknown) => void) | undefined;

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/shirt.png",
        name: "shirt.png",
        path: "/Users/demo/Pictures/shirt.png",
        src: "asset:///Users/demo/Pictures/shirt.png",
      },
    ]);
    invokeMock.mockImplementation((command) => {
      if (command === "ai_assist_product_selling_points_stream") {
        return new Promise((resolve) => {
          resolveAssist = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "AI 帮写" }));
    const disclaimer = await screen.findByRole("dialog", { name: "图片上传与使用免责声明" });
    expect(disclaimer).toHaveTextContent("AI 输出结果不代表平台");
    expect(invokeMock).not.toHaveBeenCalledWith("ai_assist_product_selling_points", expect.anything());

    await user.click(within(disclaimer).getByRole("button", { name: "我已知悉并继续" }));

    expect(invokeMock).toHaveBeenCalledWith("ai_assist_product_selling_points_stream", {
      input: {
        imagePaths: ["/Users/demo/Pictures/shirt.png"],
        requestId: expect.stringContaining("ai-writing-"),
      },
    });

    const dialog = await screen.findByRole("dialog", { name: "AI 帮写" });

    expect(screen.getByRole("complementary", { name: "生成配置" })).toHaveClass("z-40");
    expect(dialog).toHaveClass("w-[360px]", "p-5");
    expect(within(dialog).getByTestId("ai-writing-output")).toHaveClass("h-44", "max-h-64");
    expect(within(dialog).getByText("等待模型返回内容...")).toBeInTheDocument();
    const writingButton = within(dialog).getByRole("button", { name: "正在改写中" });
    expect(writingButton).toBeDisabled();
    expect(writingButton).toHaveClass("h-8", "px-3");
    expect(within(dialog).queryByRole("button", { name: "重新帮写" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "确认" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue("");

    resolveAssist?.({
      capabilityId: "product-selling-points",
      promptId: "product-selling-points",
      text: aiWritingText,
    });
    expect(await within(dialog).findByText(/产品名称：黑色休闲翻领长袖衬衫/)).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "重新帮写" })).toHaveClass("h-8", "px-3");
    expect(within(dialog).getByRole("button", { name: "确认" })).toHaveClass("h-8", "px-3");

    let resolveRefreshAssist: ((value: unknown) => void) | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "ai_assist_product_selling_points_stream") {
        return new Promise((resolve) => {
          resolveRefreshAssist = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    await user.click(within(dialog).getByRole("button", { name: "重新帮写" }));

    expect(within(dialog).getByRole("button", { name: "正在改写中" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "确认" })).not.toBeInTheDocument();

    resolveRefreshAssist?.({
      capabilityId: "product-selling-points",
      promptId: "product-selling-points",
      text: aiWritingText,
    });
    expect(await within(dialog).findByText(/产品名称：黑色休闲翻领长袖衬衫/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(screen.queryByRole("dialog", { name: "AI 帮写" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue(aiWritingText);
  });

  it("renders streamed AI writing deltas before the command resolves", async () => {
    const user = userEvent.setup();
    let resolveAssist: ((value: unknown) => void) | undefined;

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/shirt.png",
        name: "shirt.png",
        path: "/Users/demo/Pictures/shirt.png",
        src: "asset:///Users/demo/Pictures/shirt.png",
      },
    ]);
    invokeMock.mockImplementation((command) => {
      if (command === "ai_assist_product_selling_points_stream") {
        return new Promise((resolve) => {
          resolveAssist = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "AI 帮写" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "图片上传与使用免责声明" })).getByRole("button", {
        name: "我已知悉并继续",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "AI 帮写" });
    await waitFor(() => expect(tauriEventMock.listen).toHaveBeenCalled());
    const eventName = tauriEventMock.listen.mock.calls[0][0];
    const handler = tauriEventMock.listeners.get(eventName);
    expect(handler).toBeDefined();

    act(() => {
      handler?.({
        payload: {
          eventType: "delta",
          delta: "1、产品名称：",
        },
      });
      handler?.({
        payload: {
          eventType: "delta",
          delta: "测试商品",
        },
      });
    });

    expect(await within(dialog).findByText("1、产品名称：测试商品")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "正在改写中" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "确认" })).not.toBeInTheDocument();

    resolveAssist?.({
      capabilityId: "product-selling-points",
      promptId: "product-selling-points",
      text: "1、产品名称：测试商品",
    });

    expect(await within(dialog).findByRole("button", { name: "确认" })).toBeInTheDocument();
  });

  it("shows the runtime error when product image-to-text AI writing fails", async () => {
    const user = userEvent.setup();
    const runtimeError = "没有可用模型";

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/shirt.png",
        name: "shirt.png",
        path: "/Users/demo/Pictures/shirt.png",
        src: "asset:///Users/demo/Pictures/shirt.png",
      },
    ]);
    invokeMock.mockImplementation((command) => {
      if (command === "ai_assist_product_selling_points_stream") {
        return Promise.reject(new Error(runtimeError));
      }
      return Promise.resolve(undefined);
    });

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "AI 帮写" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "图片上传与使用免责声明" })).getByRole("button", {
        name: "我已知悉并继续",
      }),
    );

    expect(await screen.findByText(runtimeError)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "AI 帮写" })).not.toBeInTheDocument();
  });

  it("persists AI writing disclaimer acceptance after the first confirmed use", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/shirt.png",
        name: "shirt.png",
        path: "/Users/demo/Pictures/shirt.png",
        src: "asset:///Users/demo/Pictures/shirt.png",
      },
    ]);

    const { unmount } = renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "AI 帮写" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "图片上传与使用免责声明" })).getByRole("button", {
        name: "我已知悉并继续",
      }),
    );

    expect(window.localStorage.getItem(aiWritingDisclaimerAcceptedStorageKey)).toBe("true");
    unmount();
    invokeMock.mockClear();

    renderApp();
    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "AI 帮写" }));

    expect(screen.queryByRole("dialog", { name: "图片上传与使用免责声明" })).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("ai_assist_product_selling_points_stream", {
      input: {
        imagePaths: ["/Users/demo/Pictures/shirt.png"],
        requestId: expect.stringContaining("ai-writing-"),
      },
    });
  });

  it("keeps product images and parameters when switching workspaces", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("checkbox", { name: "品牌故事图" }));
    await user.type(
      screen.getByPlaceholderText(/建议包含以下信息生成更精准/),
      "保留商品卖点",
    );

    await user.click(screen.getByRole("button", { name: /服饰/ }));
    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /商品/ }));

    expect(screen.getByAltText("helmet.png")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).toBeChecked();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue("保留商品卖点");
  });

  it("keeps clothing parameters when switching workspaces", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.click(screen.getByRole("button", { name: /服饰/ }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "都市街头" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.type(screen.getByPlaceholderText(/描述你想要的场景/), "保留服饰场景");
    await user.click(screen.getByRole("button", { name: "AI推荐" }));

    await user.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /商品/ }));
    await user.click(screen.getByRole("button", { name: /服饰/ }));

    expect(screen.getByRole("button", { name: "AI 生成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "AI推荐" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("拍摄场景")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/描述你想要的场景/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AI推荐" }));

    expect(screen.getByRole("button", { name: "都市街头" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByPlaceholderText(/描述你想要的场景/)).toHaveValue("保留服饰场景");
  });

  it("starts a fresh product task from the first step without clearing other workspaces", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "防晒透气，适合户外骑行。");
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(screen.getByText("模块策略与设计规范")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(screen.getByRole("complementary", { name: "生成配置" })).toBeInTheDocument();
    expect(screen.queryByText("模块策略与设计规范")).not.toBeInTheDocument();
    expect(screen.queryByAltText("helmet.png")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "请上传产品图" })).toBeDisabled();
  });

  it("starts a fresh clothing task from the first step", async () => {
    const user = userEvent.setup();
    installBuiltinClothingModelMock();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));
    await user.click(screen.getByRole("button", { name: "开始生成" }));

    expect(screen.getByRole("complementary", { name: "选择场景" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(screen.getByRole("complementary", { name: "服饰配置" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "选择场景" })).not.toBeInTheDocument();
    expect(screen.queryByAltText("dress.png")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请上传服饰图片" })).toBeDisabled();
  });

  it("starts a fresh scene task from the first step", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/cup.png",
        name: "cup.png",
        path: "/Users/demo/Pictures/cup.png",
        src: "asset://cup.png",
      },
    ]);

    renderApp();

    await user.click(screen.getByRole("button", { name: "场景" }));
    await user.click(screen.getByRole("button", { name: "上传参考图" }));
    expect(await screen.findByAltText("cup.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "完整图片包（14 张）" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.type(screen.getByRole("textbox", { name: "补充信息" }), "陶瓷保温杯");
    fireEvent.click(screen.getByRole("button", { name: "生成图片方案" }));

    expect(screen.getByRole("complementary", { name: "场景方案" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(screen.getByRole("complementary", { name: "场景配置" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "场景方案" })).not.toBeInTheDocument();
    expect(screen.queryByAltText("cup.png")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "单张场景图（1 张）" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3:4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "补充信息" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "请上传参考图" })).toBeDisabled();
  });

  it("cancels a scene image task created after the workspace request was invalidated", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let resolveGenerationCreate: ((task: Record<string, unknown>) => void) | undefined;
    invokeMock.mockImplementation((command, args) => {
      const taskKind = (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind;
      if (command === "generation_create_task" && taskKind === "scene-image-generation") {
        return new Promise((resolve) => {
          resolveGenerationCreate = resolve;
        });
      }
      if (command === "generation_cancel_task") {
        return Promise.resolve({ cancelled: true });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/cup.png",
        name: "cup.png",
        path: "/Users/demo/Pictures/cup.png",
        src: "asset://cup.png",
      },
    ]);

    renderApp();
    await user.click(screen.getByRole("button", { name: "场景" }));
    await user.click(screen.getByRole("button", { name: "上传参考图" }));
    await user.click(screen.getByRole("button", { name: "完整图片包（14 张）" }));
    await user.type(screen.getByRole("textbox", { name: "补充信息" }), "陶瓷保温杯");
    await user.click(screen.getByRole("button", { name: "生成图片方案" }));
    await waitFor(() => expect(screen.getAllByTestId("scene-prompt-card")).toHaveLength(14));
    await user.click(screen.getByRole("button", { name: "开始生成图片" }));
    await waitFor(() => expect(resolveGenerationCreate).toBeDefined());

    await user.click(screen.getByRole("button", { name: "新建任务" }));
    await act(async () => {
      resolveGenerationCreate?.({
        attemptNo: 1,
        createdAt: "2026-07-12T12:00:00.000Z",
        id: "task_scene_created_after_reset",
        kind: "image-generation",
        stage: "queued",
        status: "queued",
        title: "场景图片生成",
        updatedAt: "2026-07-12T12:00:00.000Z",
        workspace: "scene",
      });
    });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generation_cancel_task", {
        taskId: "task_scene_created_after_reset",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("generation_run_task", {
      taskId: "task_scene_created_after_reset",
    });
  });

  it("keeps a viewed scene history record visible while another scene task finishes polling", async () => {
    const user = userEvent.setup();
    const baseInvoke = invokeMock.getMockImplementation();
    let resolveLiveDetail: ((detail: Record<string, unknown>) => void) | undefined;
    const historyDetail = {
      events: [],
      input: {
        items: [
          {
            code: "S1",
            imageId: "scene-s1",
            imageNo: 1,
            prompt: "历史场景 prompt",
            purpose: "历史场景",
            ratio: "3:4",
            sortOrder: 0,
            title: "历史场景",
          },
        ],
        kind: "scene-image-generation",
        outputMode: "single",
        ratio: "3:4",
      },
      inputAssets: [],
      outputAssets: [
        {
          asset: {
            id: "asset_scene_history",
            localPath: "/workspace/current/assets/generated/scene-history.png",
            relativePath: "assets/generated/scene-history.png",
          },
          role: "output",
          sortOrder: 0,
        },
      ],
      task: {
        completedAt: "2026-07-12T11:00:10.000Z",
        createdAt: "2026-07-12T11:00:00.000Z",
        id: "task_scene_history",
        kind: "image-generation",
        promptPlanId: "task_scene_history_plan",
        stage: "completed",
        status: "succeeded",
        title: "历史场景图片",
        updatedAt: "2026-07-12T11:00:10.000Z",
        workspace: "scene",
      },
    };
    invokeMock.mockImplementation((command, args) => {
      const taskKind = (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind;
      const taskId = (args as { taskId?: string } | undefined)?.taskId;
      if (command === "generation_list_tasks") {
        const workspace = (args as { query?: { workspace?: string } } | undefined)?.query?.workspace;
        const items = workspace === "scene" ? [historyDetail.task] : [];
        return Promise.resolve({ items, page: 1, pageSize: 20, total: items.length });
      }
      if (command === "generation_create_task" && taskKind === "scene-image-generation") {
        return Promise.resolve({
          attemptNo: 1,
          createdAt: "2026-07-12T12:00:00.000Z",
          id: "task_scene_live",
          kind: "image-generation",
          stage: "queued",
          status: "queued",
          title: "场景图片生成",
          updatedAt: "2026-07-12T12:00:00.000Z",
          workspace: "scene",
        });
      }
      if (command === "generation_get_task_detail" && taskId === "task_scene_history") {
        return Promise.resolve(historyDetail);
      }
      if (command === "generation_get_task_detail" && taskId === "task_scene_live") {
        return new Promise((resolve) => {
          resolveLiveDetail = resolve;
        });
      }
      return baseInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/cup.png",
        name: "cup.png",
        path: "/Users/demo/Pictures/cup.png",
        src: "asset://cup.png",
      },
    ]);

    renderApp();
    await user.click(screen.getByRole("button", { name: "场景" }));
    await user.click(screen.getByRole("button", { name: "上传参考图" }));
    await user.click(screen.getByRole("button", { name: "完整图片包（14 张）" }));
    await user.type(screen.getByRole("textbox", { name: "补充信息" }), "陶瓷保温杯");
    await user.click(screen.getByRole("button", { name: "生成图片方案" }));
    await waitFor(() => expect(screen.getAllByTestId("scene-prompt-card")).toHaveLength(14));
    await user.click(screen.getByRole("button", { name: "开始生成图片" }));
    await waitFor(() => expect(resolveLiveDetail).toBeDefined());

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByText("历史场景图片").closest("button") as HTMLButtonElement);
    expect(screen.getByRole("img", { name: "S1 历史场景" })).toBeInTheDocument();

    await act(async () => {
      resolveLiveDetail?.({
        events: [],
        inputAssets: [],
        outputAssets: Array.from({ length: 14 }, (_, index) => ({
          asset: {
            id: `asset_scene_live_${index + 1}`,
            localPath: `/workspace/current/assets/generated/scene-live-${index + 1}.png`,
            relativePath: `assets/generated/scene-live-${index + 1}.png`,
          },
          role: "output",
          sortOrder: index,
        })),
        task: {
          id: "task_scene_live",
          kind: "image-generation",
          stage: "completed",
          status: "succeeded",
          workspace: "scene",
        },
      });
    });

    await waitFor(() => expect(screen.getByRole("img", { name: "S1 历史场景" })).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: "H1 首屏主视觉" })).not.toBeInTheDocument();
  });

  it("returns to scene configuration when prompt planning validation fails", async () => {
    const user = userEvent.setup();
    const defaultInvoke = invokeMock.getMockImplementation();
    invokeMock.mockImplementation((command, args) => {
      if (command === "generation_get_task_detail") {
        const taskId = (args as { taskId?: string } | undefined)?.taskId ?? "";
        if (taskId.includes("scene-prompt-planning")) {
          return Promise.resolve({
            events: [],
            inputAssets: [],
            output: {},
            outputAssets: [],
            task: {
              error: {
                code: "SCENE_PROMPT_PLAN_OUTPUT_INVALID",
                message: "场景规划结果校验失败：单图元数据不符合冻结配置。",
                retryable: true,
              },
              id: taskId,
              kind: "prompt-plan",
              stage: "failed",
              status: "failed",
              workspace: "scene",
            },
          });
        }
      }
      return defaultInvoke?.(command, args) ?? Promise.reject(new Error(`Unhandled command ${command}`));
    });
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/person.png",
        name: "person.png",
        path: "/Users/demo/Pictures/person.png",
        src: "asset://person.png",
      },
    ]);

    renderApp();
    await user.click(screen.getByRole("button", { name: "场景" }));
    await user.click(screen.getByRole("button", { name: "上传参考图" }));
    expect(await screen.findByAltText("person.png")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "补充信息" }), "生成自然人物场景");
    await user.click(screen.getByRole("button", { name: "生成图片方案" }));

    expect(await screen.findByText(/场景方案生成失败：场景规划结果校验失败/)).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "场景配置" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "场景方案" })).not.toBeInTheDocument();
    expect(screen.getByAltText("person.png")).toBeInTheDocument();
  });

  it("guides scene generation through reference images, prompt review, and image results", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/cup.png",
        name: "cup.png",
        path: "/Users/demo/Pictures/cup.png",
        src: "asset://cup.png",
      },
    ]);

    renderApp();

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    const sceneNavigationButton = within(navigation).getByRole("button", { name: /场景/ });

    await user.click(sceneNavigationButton);

    expect(sceneNavigationButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "场景配置" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "场景预览画布" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请上传参考图" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "单张场景图（1 张）" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3:4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("tablist", { name: "场景分类" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "补充信息" })).toBeRequired();

    await user.click(screen.getByRole("button", { name: "上传参考图" }));

    expect(selectProductImagesMock).toHaveBeenCalledWith(3);
    expect(await screen.findByAltText("cup.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请填写补充信息" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "完整图片包（14 张）" }));

    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.type(
      screen.getByRole("textbox", { name: "补充信息" }),
      "  陶瓷保温杯，卖点是防滑杯套和通勤便携。  ",
    );

    fireEvent.click(screen.getByRole("button", { name: "生成图片方案" }));

    expect(screen.getByRole("complementary", { name: "场景方案" })).toBeInTheDocument();
    expect(screen.getByText("方案生成中...")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        invokeMock.mock.calls.find(
          ([command, args]) =>
            command === "generation_create_task" &&
            (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind ===
              "scene-prompt-planning",
        ),
      ).toBeDefined(),
    );
    const planningCreateCall = invokeMock.mock.calls.find(
      ([command, args]) =>
        command === "generation_create_task" &&
        (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind ===
          "scene-prompt-planning",
    );
    const planningInput = (
      planningCreateCall?.[1] as { input?: { input?: Record<string, unknown> } } | undefined
    )?.input?.input;
    expect(planningInput).toMatchObject({
      kind: "scene-prompt-planning",
      planningPromptVersion: "v10",
      supplementalInfo: "陶瓷保温杯，卖点是防滑杯套和通勤便携。",
    });
    expect(planningInput).not.toHaveProperty("selectedSceneTemplateId");
    expect(planningInput).not.toHaveProperty("selectedVisualDirectionId");

    expect(await screen.findByText("统一风格锁定")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("scene-prompt-card")).toHaveLength(14));
    expect(screen.getByText("H1 首屏主视觉")).toBeInTheDocument();
    expect(screen.getByText("D9 FAQ / 风险逆转 / CTA")).toBeInTheDocument();
    expect(screen.getAllByText(/陶瓷保温杯置于画面核心区域/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: /图片提示词/ })).not.toBeInTheDocument();
    expect(screen.queryByText("H1 首屏主视觉，陶瓷保温杯，固定色板。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始生成图片" }));

    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("generated-detail-image-card")).toHaveLength(14));
    const sceneResultGrid = screen.getByTestId("generated-result-grid");
    const sceneResultCards = within(sceneResultGrid).getAllByRole("article");
    const sceneSourceCard = within(sceneResultGrid).getByTestId("generated-source-image-card");
    const sceneGeneratedCards = within(sceneResultGrid).getAllByTestId("generated-detail-image-card");
    expect(sceneResultCards[0]).toBe(sceneSourceCard);
    expect(sceneSourceCard).toHaveTextContent("原图");
    expect(within(sceneSourceCard).getByRole("img", { name: "cup.png" })).toHaveAttribute("src", "asset://cup.png");
    expect(within(sceneSourceCard).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(sceneSourceCard).queryByRole("button")).not.toBeInTheDocument();
    expect(within(sceneGeneratedCards[0]).getByRole("img", { name: "H1 首屏主视觉" })).toHaveAttribute(
      "src",
      expect.stringContaining("generated-1.png"),
    );
    expect(screen.queryByTestId("failed-result-card")).not.toBeInTheDocument();
    expect(screen.getByText("H1 首屏主视觉")).toBeInTheDocument();

    await user.click(sceneSourceCard);
    expect(screen.queryByRole("dialog", { name: "图片相册预览" })).not.toBeInTheDocument();
    await user.click(sceneGeneratedCards[0]);
    const sceneLightbox = screen.getByRole("dialog", { name: "图片相册预览" });
    expect(within(sceneLightbox).getByText("1 / 14")).toBeInTheDocument();
    expect(within(sceneLightbox).getAllByRole("button", { name: /查看缩略图/ })).toHaveLength(14);
    expect(within(sceneLightbox).queryByRole("img", { name: "缩略图 cup.png" })).not.toBeInTheDocument();
    await user.click(within(sceneLightbox).getByRole("button", { name: "关闭图片预览" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "generation_create_task",
      expect.objectContaining({
        input: expect.objectContaining({
          input: expect.objectContaining({
            campaignStyleLock: "固定暖白色板、中性棚拍光与统一无衬线字体。",
            conversionDriver: "visual",
            generationPromptVersion: "v7",
            kind: "scene-image-generation",
            outputMode: "full-pack",
            planningPromptVersion: "v10",
            ratio: "1:1",
            templateCatalogVersion: "v5",
          }),
          workspace: "scene",
        }),
      }),
    );
    const generationCreateCall = invokeMock.mock.calls.find(
      ([command, args]) =>
        command === "generation_create_task" &&
        (args as { input?: { input?: { kind?: string } } } | undefined)?.input?.input?.kind ===
          "scene-image-generation",
    );
    const frozenInput = (
      generationCreateCall?.[1] as {
        input?: { input?: { items?: Array<{ prompt?: string; promptSummary?: string; templateId?: string }> } };
      } | undefined
    )?.input?.input;
    const frozenTemplateIds = frozenInput?.items?.map((item) => item.templateId) ?? [];
    expect(frozenInput).toMatchObject({ conversionDriver: "visual", outputMode: "full-pack" });
    expect(frozenInput?.items).toHaveLength(14);
    expect(frozenInput?.items?.[0]).toMatchObject({
      prompt: "H1 首屏主视觉，陶瓷保温杯，固定色板。",
      promptSummary: "首屏主视觉，陶瓷保温杯置于画面核心区域。",
    });
    expect(new Set(frozenTemplateIds).size).toBe(14);

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(historyDialog).getByRole("button", { name: "场景" }));
    expect(within(historyDialog).getByText("场景图片")).toBeInTheDocument();
    expect(within(historyDialog).getByText("14 张")).toBeInTheDocument();
    expect(within(historyDialog).getByText("已完成")).toBeInTheDocument();
  });

  it("switches from detail generation to the clothing try-on workspace", async () => {
    const user = userEvent.setup();

    renderApp();

    expect(screen.getByRole("button", { name: /场景/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /详情/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /服饰/ }));

    expect(screen.getByRole("complementary", { name: "服饰配置" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "服饰穿戴预览" })).toBeInTheDocument();
    expect(screen.getByTestId("clothing-config-scroll")).toHaveClass("overscroll-none");
    expect(screen.getByText("服饰图片")).toBeInTheDocument();
    expect(screen.getByText("模特形象")).toBeInTheDocument();
    expect(screen.getByText("AI服饰穿戴")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请上传服饰图片" })).toBeDisabled();
  });
});

function ensureTestLocalStorage() {
  if (typeof window.localStorage?.removeItem === "function") {
    return window.localStorage;
  }

  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });

  return storage;
}
