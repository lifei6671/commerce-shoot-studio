import { describe, expect, it, vi } from "vitest";
import { runtimeContractVersion } from "./index";
import { localModelConfigPort } from "./local/model-config";
import type {
  AssetPage,
  CreateGenerationTaskInput,
  GenerationTask,
  LocalModelConfigView,
  ModelImageSizeOptions,
  ModelCapability,
  ProviderProfileView,
  RuntimeClient,
  RuntimeInfo,
  SaveLocalModelConfigInput,
  SecretStatus,
} from "./index";

describe("Runtime public contract", () => {
  it("exposes stable ports for local-first features", async () => {
    expect(runtimeContractVersion).toBe("2026-07-01.local-first.v1");

    const runtimeInfo: RuntimeInfo = {
      features: {
        mode: "local",
        supportsDirectoryPicker: true,
        supportsLocalFileReveal: true,
        supportsLocalModelConfig: true,
        supportsSecretManagement: true,
        supportsSystemNotification: true,
        supportsWorkspaceSwitch: true,
      },
      mode: "local",
      version: "0.1.0-test",
    };

    const capability: ModelCapability = {
      available: true,
      category: "text-to-image",
      displayName: "场景图生成",
      id: "scene-image-generation",
      maxImageCount: 4,
      maxInputAssets: 3,
      supportedAspectRatios: ["1:1", "3:4", "9:16", "16:9"],
    };

    const baseModelCapability: ModelCapability = {
      available: false,
      category: "text-to-image",
      displayName: "服饰基准模特生成",
      id: "clothing-base-model-generation",
      maxImageCount: 1,
      maxInputAssets: 0,
      supportedAspectRatios: ["2:3"],
      unavailableReason: "未配置可用真实模型。",
    };

    const secretStatus: SecretStatus = {
      configured: true,
      lastUpdatedAt: "2026-07-01T00:00:00.000Z",
      storage: "sqlite-local",
    };

    const config: LocalModelConfigView = {
      baseUrl: "https://api.openai.com",
      capabilityId: capability.id,
      connectionStatus: "available",
      displayName: "场景图默认配置",
      enabled: true,
      executionMode: "auto",
      id: "cfg_scene_default",
      isDefault: true,
      model: "gpt-image-2",
      protocol: "openai-compatible",
      providerLabel: "OpenAI",
      providerProfileId: "openai",
      secretStatus,
    };

    const imageSizeOptions: ModelImageSizeOptions = {
      capabilityId: "image-edit",
      configId: config.id,
      model: "gpt-image-1",
      options: [
        {
          height: 1536,
          id: "1024x1536",
          label: "竖图 2:3 · 1024x1536",
          providerValue: "1024x1536",
          ratio: "2:3",
          width: 1024,
        },
      ],
      providerProfileId: "openai",
    };

    const providerProfile: ProviderProfileView = {
      baseUrl: "https://api.openai.com",
      customEnabled: false,
      displayName: "OpenAI",
      id: "openai",
      protocol: "openai-compatible",
      providerLabel: "OpenAI",
      supportedCapabilities: [capability.id],
      supportedCategories: [capability.category],
    };

    const task: GenerationTask = {
      attemptNo: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      id: "task_1",
      kind: "image-generation",
      stage: "queued",
      status: "queued",
      title: "场景图任务",
      updatedAt: "2026-07-01T00:00:00.000Z",
      workspace: "scene",
    };

    const fakeRuntime: RuntimeClient = {
      aiAssist: {
        analyzeViralStyle: vi.fn(),
        generateListingCopy: vi.fn(),
        generateProductSellingPoints: vi.fn(),
        recognizeImageText: vi.fn(),
      },
      assets: {
        deleteAsset: vi.fn(),
        getAsset: vi.fn(),
        importImages: vi.fn(),
        listAssets: vi.fn<() => Promise<AssetPage>>(() =>
          Promise.resolve({
            items: [],
            page: 1,
            pageSize: 20,
            total: 0,
          }),
        ),
        listBuiltinModels: vi.fn(() => Promise.resolve([])),
        revealAsset: vi.fn(),
      },
      capabilities: {
        getCapability: vi.fn(() => Promise.resolve(capability)),
        listCapabilities: vi.fn(() => Promise.resolve([capability, baseModelCapability])),
      },
      generation: {
        cancelTask: vi.fn(() => Promise.resolve(task)),
        createTask: vi.fn((input: CreateGenerationTaskInput) =>
          Promise.resolve({
            ...task,
            idempotencyKey: input.idempotencyKey,
            title: input.title,
          }),
        ),
        deleteTask: vi.fn(() => Promise.resolve()),
        deleteResultImage: vi.fn(() => Promise.resolve()),
        getTask: vi.fn(() => Promise.resolve(task)),
        getTaskDetail: vi.fn(() =>
          Promise.resolve({
            events: [],
            inputAssets: [],
            outputAssets: [],
            task,
          }),
        ),
        listTasks: vi.fn(() =>
          Promise.resolve({
            items: [task],
            page: 1,
            pageSize: 20,
            total: 1,
          }),
        ),
        retryTask: vi.fn(() => Promise.resolve({ ...task, attemptNo: 2, retryOfTaskId: task.id })),
        replaceResultImage: vi.fn(() => Promise.resolve()),
        runNext: vi.fn(() => Promise.resolve({ invocationId: "inv_1", taskId: task.id })),
        runTask: vi.fn(() => Promise.resolve({ invocationId: "inv_1", taskId: task.id })),
      },
      modelConfig: {
        deleteConfig: vi.fn(() => Promise.resolve()),
        getConfig: vi.fn(() => Promise.resolve(config)),
        listConfigs: vi.fn(() => Promise.resolve([config])),
        listImageSizeOptions: vi.fn(() => Promise.resolve(imageSizeOptions)),
        listProviderProfiles: vi.fn(() => Promise.resolve([providerProfile])),
        saveConfig: vi.fn((input: SaveLocalModelConfigInput) =>
          Promise.resolve({
            ...config,
            capabilityId: input.capabilityId,
            displayName: input.displayName,
            enabled: input.enabled,
            executionMode: input.executionMode,
            model: input.model,
          }),
        ),
        setDefaultConfig: vi.fn(() => Promise.resolve(config)),
        testConfig: vi.fn(() =>
          Promise.resolve({
            ok: true,
          }),
        ),
      },
      promptPlans: {
        createPlan: vi.fn(),
      },
      runtimeInfo: {
        getRuntimeInfo: vi.fn(() => Promise.resolve(runtimeInfo)),
      },
      secrets: {
        deleteSecret: vi.fn(() => Promise.resolve()),
        getSecretStatus: vi.fn(() => Promise.resolve(secretStatus)),
        revealSecret: vi.fn(() => Promise.resolve("sk-test")),
        saveSecret: vi.fn(() => Promise.resolve(secretStatus)),
        testProviderConnection: vi.fn(() =>
          Promise.resolve({
            ok: true,
          }),
        ),
      },
      settings: {
        getSettings: vi.fn(),
        playNotificationSound: vi.fn(() => Promise.resolve()),
        saveSettings: vi.fn(),
      },
      shell: {
        chooseDirectory: vi.fn(),
        notify: vi.fn(),
        revealPath: vi.fn(),
      },
      workspace: {
        getStorageUsage: vi.fn(),
        getWorkspaceStatus: vi.fn(),
        initializeWorkspace: vi.fn(),
        repairWorkspace: vi.fn(),
        runGarbageCollection: vi.fn(),
        switchWorkspace: vi.fn(),
      },
    };

    await expect(fakeRuntime.runtimeInfo.getRuntimeInfo()).resolves.toMatchObject({
      features: {
        supportsLocalModelConfig: true,
        supportsSecretManagement: true,
      },
      mode: "local",
    });
    await expect(
      fakeRuntime.generation.createTask({
        idempotencyKey: "scene-task-click-1",
        kind: "image-generation",
        title: "双击幂等场景图",
        workspace: "scene",
      }),
    ).resolves.toMatchObject({
      idempotencyKey: "scene-task-click-1",
      kind: "image-generation",
      workspace: "scene",
    });
    await expect(fakeRuntime.modelConfig.listProviderProfiles()).resolves.toHaveLength(1);
    await expect(fakeRuntime.modelConfig.listImageSizeOptions("image-edit")).resolves.toEqual(imageSizeOptions);
    expect(typeof localModelConfigPort.listImageSizeOptions).toBe("function");
    await expect(fakeRuntime.secrets.getSecretStatus({ providerProfileId: "openai" })).resolves.toMatchObject({
      configured: true,
      storage: "sqlite-local",
    });
  });
});
