# Model Provider API Key Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模型配置页切换离开并返回已配置 Provider 后，安全恢复 API Key 的“已配置”遮罩状态。

**Architecture:** 保持 Rust、SQLite、Runtime Port 和 IPC 不变，在 `ModelConfigPage` 的交互边界调用现有 `SecretPort.getSecretStatus`。每个模型类别分别维护 Provider status 与 API Key reveal 请求序号，只允许各自最新请求回写；整体配置替换和新 Key 输入会同时失效两类旧请求。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、Tauri v2 Runtime Ports。

## Global Constraints

- API Key 明文不得进入 `LocalModelConfigView`、日志、task events 或普通页面持久化状态。
- Provider 切换不得自动调用 `revealSecret`；明文只在用户点击眼睛后读取。
- 不修改 SQLite schema、Rust service、Tauri command、Runtime Port、依赖或现有视觉样式。
- 不保留未保存的 Provider 专属明文草稿。
- 保留当前 dirty tree，不提交、不暂存、不回退无关改动。

---

### Task 1: Provider 切换后恢复密钥状态并隔离过期响应

**Files:**
- Modify: `desktop/src/features/model-config/components/ModelConfigPage.test.tsx`
- Modify: `desktop/src/features/model-config/components/ModelConfigPage.tsx`
- Modify: `docs/2026-06-30-local-first-saas-ready-implementation-plan.md`
- Modify: `docs/2026-07-01-local-first-implementation-task-checklist.md`

**Interfaces:**
- Consumes: `SecretPort.getSecretStatus(scope: SecretScope): Promise<SecretStatus>` 与 `SecretPort.revealSecret(scope: SecretScope): Promise<string>`。
- Produces: `changeProvider(id: ModelCategoryId, nextProvider: ModelProviderId): Promise<void>`，并保证 Provider 切换只恢复脱敏状态。

- [x] **Step 1: 写 Provider 往返切换的失败测试**

在 `ModelConfigPage.test.tsx` 的 Provider 切换测试旁增加用例：初始 DeepSeek 已配置，OpenAI 未配置；切换到 OpenAI 后再切回 DeepSeek，预期恢复遮罩且不 reveal 明文。

```tsx
function renderProviderSwitchPage(secretPort: SecretPort) {
  const modelConfigPort: ModelConfigPort = {
    deleteConfig: vi.fn(),
    getConfig: vi.fn(),
    listConfigs: vi.fn(() => Promise.resolve([
      deepseekConfig("listing-copy"),
      deepseekConfig("prompt-plan"),
    ])),
    listProviderProfiles: vi.fn(() => Promise.resolve([deepseekProfile, openaiProfile])),
    saveConfig: vi.fn(),
    setDefaultConfig: vi.fn(),
    testConfig: vi.fn(),
  };

  render(
    <ToastProvider>
      <ModelConfigPage modelConfigPort={modelConfigPort} secretPort={secretPort} />
    </ToastProvider>,
  );
}

it("restores persisted API key status after switching away and back", async () => {
  const user = userEvent.setup();
  const secretPort: SecretPort = {
    deleteSecret: vi.fn(),
    getSecretStatus: vi.fn((scope) => Promise.resolve({
      configured: scope.providerProfileId === "deepseek",
      storage: "sqlite-local",
    })),
    revealSecret: vi.fn(),
    saveSecret: vi.fn(),
    testProviderConnection: vi.fn(),
  };

  renderProviderSwitchPage(secretPort);

  const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
  await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
  await user.click(screen.getByRole("button", { name: "OpenAI" }));
  await waitFor(() => expect(secretPort.getSecretStatus).toHaveBeenCalledWith({
    capabilityId: "listing-copy",
    providerProfileId: "openai",
  }));
  expect(apiKeyInput).toHaveValue("");

  await user.click(screen.getByRole("button", { name: "文生文 Provider OpenAI" }));
  await user.click(screen.getByRole("button", { name: "DeepSeek" }));
  await waitFor(() => expect(apiKeyInput)
    .toHaveValue("sk-••••••••••••••••••••••••已配置"));
  expect(secretPort.getSecretStatus).toHaveBeenCalledWith({
    capabilityId: "listing-copy",
    providerProfileId: "deepseek",
  });
  expect(secretPort.revealSecret).not.toHaveBeenCalled();
  expect(secretPort.saveSecret).not.toHaveBeenCalled();
  expect(secretPort.deleteSecret).not.toHaveBeenCalled();
});
```

- [x] **Step 2: 运行定向测试并确认 RED**

Run:

```bash
npm --prefix desktop test -- --run src/features/model-config/components/ModelConfigPage.test.tsx
```

Expected: 新用例失败；当前实现不会调用 `getSecretStatus`，切回 DeepSeek 后仍显示空输入框。

- [x] **Step 3: 写过期 status/reveal 与整体重置生命周期的失败测试**

增加异步用例：延迟返回的旧 Provider status 不覆盖当前 Provider；延迟返回的旧 Provider reveal 不把明文写进新 Provider 卡片；隐藏只取消 reveal、不取消 status；取消、恢复默认和新 Key 输入会使旧请求失效。

```tsx
it("ignores a stale secret status after switching back", async () => {
  const user = userEvent.setup();
  let resolveOpenAiStatus: ((status: { configured: boolean; storage: string }) => void) | undefined;
  const openAiStatus = new Promise<{ configured: boolean; storage: string }>((resolve) => {
    resolveOpenAiStatus = resolve;
  });
  const getSecretStatus = vi.fn((scope: SecretScope) =>
    scope.providerProfileId === "openai"
      ? openAiStatus
      : Promise.resolve({ configured: true, storage: "sqlite-local" }),
  );
  const secretPort: SecretPort = {
    deleteSecret: vi.fn(),
    getSecretStatus,
    revealSecret: vi.fn(),
    saveSecret: vi.fn(),
    testProviderConnection: vi.fn(),
  };
  renderProviderSwitchPage(secretPort);

  const apiKeyInput = await screen.findByRole("textbox", { name: "文生文 API Key" });
  await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
  await user.click(screen.getByRole("button", { name: "OpenAI" }));
  await user.click(screen.getByRole("button", { name: "文生文 Provider OpenAI" }));
  await user.click(screen.getByRole("button", { name: "DeepSeek" }));
  await waitFor(() => expect(apiKeyInput)
    .toHaveValue("sk-••••••••••••••••••••••••已配置"));

  resolveOpenAiStatus?.({ configured: false, storage: "sqlite-local" });
  await waitFor(() => expect(getSecretStatus).toHaveBeenCalledTimes(2));
  expect(apiKeyInput).toHaveValue("sk-••••••••••••••••••••••••已配置");
});

it("ignores a stale revealed secret after switching provider", async () => {
  const user = userEvent.setup();
  let resolveReveal: ((value: string) => void) | undefined;
  const revealSecret = vi.fn(() => new Promise<string>((resolve) => {
    resolveReveal = resolve;
  }));
  const secretPort: SecretPort = {
    deleteSecret: vi.fn(),
    getSecretStatus: vi.fn(() => Promise.resolve({ configured: false, storage: "sqlite-local" })),
    revealSecret,
    saveSecret: vi.fn(),
    testProviderConnection: vi.fn(),
  };
  renderProviderSwitchPage(secretPort);

  await screen.findByRole("textbox", { name: "文生文 API Key" });
  await user.click(screen.getByRole("button", { name: "显示文生文 API Key" }));
  await user.click(screen.getByRole("button", { name: "文生文 Provider DeepSeek" }));
  await user.click(screen.getByRole("button", { name: "OpenAI" }));
  resolveReveal?.("sk-old-provider-secret");

  await waitFor(() => expect(screen.getByRole("textbox", { name: "文生文 API Key" }))
    .not.toHaveValue("sk-old-provider-secret"));
  expect(screen.getByRole("button", { name: "文生文 Provider OpenAI" })).toBeInTheDocument();
});
```

- [x] **Step 4: 实现最小 Provider 切换处理器**

在 `ModelConfigPage.tsx` 中用 ref 记录每个模型类别的密钥请求序号。切换时立即清除旧明文、重置连接状态，并按新 Provider 查询状态。

```tsx
const providerStatusRequestIdsRef = useRef<Partial<Record<ModelCategoryId, number>>>({});
const revealRequestIdsRef = useRef<Partial<Record<ModelCategoryId, number>>>({});

function nextProviderStatusRequestId(id: ModelCategoryId) {
  const nextRequestId = (providerStatusRequestIdsRef.current[id] ?? 0) + 1;
  providerStatusRequestIdsRef.current[id] = nextRequestId;
  return nextRequestId;
}

function nextRevealRequestId(id: ModelCategoryId) {
  const nextRequestId = (revealRequestIdsRef.current[id] ?? 0) + 1;
  revealRequestIdsRef.current[id] = nextRequestId;
  return nextRequestId;
}

function invalidateAllSecretRequests() {
  for (const descriptor of modelCategoryDescriptors) {
    nextProviderStatusRequestId(descriptor.id);
    nextRevealRequestId(descriptor.id);
  }
}

function withId(currentIds: Set<ModelCategoryId>, id: ModelCategoryId) {
  return new Set(currentIds).add(id);
}

function withoutId(currentIds: Set<ModelCategoryId>, id: ModelCategoryId) {
  const nextIds = new Set(currentIds);
  nextIds.delete(id);
  return nextIds;
}

async function changeProvider(id: ModelCategoryId, nextProvider: ModelProviderId) {
  const requestId = nextProviderStatusRequestId(id);
  nextRevealRequestId(id);
  const nextModelOptions = modelCatalog[nextProvider][categoryCatalogKeys[id]];

  updateConfig(id, {
    apiKey: "",
    apiKeyConfigured: nextProvider === "mock-local",
    apiKeyDirty: false,
    apiKeyRevealed: false,
    baseUrl: getProviderBaseUrl(nextProvider, providerProfiles, id),
    connectionStatus: "unavailable",
    endpointPath: undefined,
    model: nextModelOptions[0],
    provider: nextProvider,
  });

  if (nextProvider === "mock-local") {
    setVisibleApiKeyIds((currentIds) => withoutId(currentIds, id));
    return;
  }

  setVisibleApiKeyIds((currentIds) => withId(currentIds, id));
  try {
    const status = await secretPort.getSecretStatus({
      providerProfileId: nextProvider,
      capabilityId: categoryCapabilityIds[id][0],
    });
    if (providerStatusRequestIdsRef.current[id] !== requestId) {
      return;
    }
    updateConfig(id, { apiKeyConfigured: status.configured });
    setVisibleApiKeyIds((currentIds) =>
      status.configured ? withoutId(currentIds, id) : withId(currentIds, id),
    );
  } catch {
    if (providerStatusRequestIdsRef.current[id] === requestId) {
      showToast({ message: "API Key 状态加载失败", variant: "error" });
    }
  }
}
```

`ModelConfigCard` 只上报 `onProviderChange(nextProvider)`；父组件负责异步状态和 toast。已配置时收起 API Key 输入，未配置或状态查询失败时保持空输入可编辑。

- [x] **Step 5: 给 reveal 加同一请求序号保护**

在 `toggleApiKeyVisibility` 开始时只生成 reveal 请求序号；隐藏或 Provider 切换都会使旧 reveal 失效，但不取消仍有效的 Provider status。只有 reveal 序号仍匹配时才写入明文和展开状态。`reloadRuntimeConfigs`、恢复默认和 API Key 编辑同时失效相关的 status/reveal 请求。

```tsx
const requestId = nextRevealRequestId(id);
const value = await secretPort.revealSecret(scope);
if (revealRequestIdsRef.current[id] !== requestId) {
  return;
}
updateConfig(id, { apiKey: value, apiKeyRevealed: true });
```

- [x] **Step 6: 运行定向测试并确认 GREEN**

Run:

```bash
npm --prefix desktop test -- --run src/features/model-config/components/ModelConfigPage.test.tsx
```

Expected: `ModelConfigPage.test.tsx` 全部通过，无未处理 Promise 或 React act warning。

- [x] **Step 7: 同步长期文档契约**

在技术方案的 `SecretScope` 说明中补充：Provider 切换按当前 Provider/capability 查询脱敏状态，切换本身不 reveal 明文。在任务清单“模型配置”中增加并标记已验证的 Provider 往返恢复遮罩行为；不修改 README、场景技术方案或 docs-sync Skill。

- [x] **Step 8: 完成格式、全量门禁和差异检查**

Run:

```bash
make check
git diff --check HEAD
```

Expected: 前端测试、前端构建、Cargo check、npm audit 与差异检查全部 exit 0。

- [x] **Step 9: 自 review**

逐项确认：切换不删除密钥、不自动 reveal、不保留旧明文；快速切换只允许最新响应回写；未配置 Provider 仍自动展开；没有修改 Rust/schema/DTO/依赖/视觉样式；未触碰无关 dirty-tree 文件。
