import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);
const modelServiceSource = readFileSync(
  new URL("../src/features/model-config/services/modelService.ts", import.meta.url),
  "utf8",
);
const credentialCommandsSource = readFileSync(
  new URL("../src-tauri/src/commands/credentials.rs", import.meta.url),
  "utf8",
);
const tauriLibSource = readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const globalCssSource = readFileSync(
  new URL("../src/shared/styles/global.css", import.meta.url),
  "utf8",
);

test("proxy test uses an in-app domain dialog instead of native prompt", () => {
  assert.doesNotMatch(workflowCanvasSource, /window\.prompt/);
  assert.match(workflowCanvasSource, /ProxyTestDomainDialog/);
  assert.match(workflowCanvasSource, /测试域名/);
  assert.match(workflowCanvasSource, /google\.com/);
});

test("system settings does not expose unsupported socks proxy protocol", () => {
  assert.doesNotMatch(workflowCanvasSource, /SOCKS5|socks5/);
});

test("system settings does not expose unsupported ask-every-time save location", () => {
  assert.doesNotMatch(workflowCanvasSource, /ask_every_time|每次询问/);
});

test("system settings save action is page-level and independent from proxy validation", () => {
  assert.match(
    workflowCanvasSource,
    /<div className="system-settings-header-actions">[\s\S]*?<Button disabled=\{isSaving\} onClick=\{onSave\} type="button">[\s\S]*?保存设置[\s\S]*?<\/Button>[\s\S]*?<\/div>/,
  );
  assert.match(workflowCanvasSource, /const proxyModeNotSelected = draft\.proxy\.mode === "none";/);
  assert.match(
    workflowCanvasSource,
    /const systemProxyUnavailable =\s*draft\.proxy\.mode === "system" && !systemProxyDetected;/,
  );
  assert.match(
    workflowCanvasSource,
    /const proxyTestDisabled =\s*isSaving \|\|\s*isTestingProxy \|\|\s*proxyModeNotSelected \|\|\s*manualProxyIncomplete \|\|\s*systemProxyUnavailable;/,
  );
  assert.doesNotMatch(workflowCanvasSource, /const proxyActionDisabled/);
});

test("system proxy test uses detected system proxy availability from settings view", () => {
  assert.match(workflowCanvasSource, /systemProxyDetected=\{systemSettingsView\.systemProxyDetected\}/);
  assert.match(workflowCanvasSource, /systemProxyDetected: boolean;/);
  assert.match(
    workflowCanvasSource,
    /systemProxyDetected: false,\s*workspaceChangeRequiresRestart: false,/,
  );
});

test("proxy test dialog keeps footer actions readable and toast above modal", () => {
  assert.match(globalCssSource, /\.proxy-test-modal__footer button\s*\{[\s\S]*?height:\s*36px/);
  assert.match(globalCssSource, /\.proxy-test-modal__footer button\s*\{[\s\S]*?font-size:\s*13px/);
  assert.match(globalCssSource, /\.proxy-test-modal__footer button\[type="submit"\]\s*\{[\s\S]*?background:\s*#2563eb/);
  assert.match(globalCssSource, /\.modal-backdrop\s*\{[\s\S]*?z-index:\s*90/);
  assert.match(globalCssSource, /\.workbench-toast\s*\{[\s\S]*?z-index:\s*110/);
});

test("model config preserves a loaded custom endpoint when saving supported providers", () => {
  assert.match(
    workflowCanvasSource,
    /providerBaseUrl:\s*isCustomProvider \|\| isCustomEndpointEnabled\s*\?\s*customBaseUrl\.trim\(\)\s*:\s*undefined/,
  );
  assert.match(
    workflowCanvasSource,
    /const endpointCustomizationSupported = selectedProvider === DEFAULT_PROVIDER \|\| selectedProvider === CUSTOM_PROVIDER;/,
  );
  assert.doesNotMatch(
    workflowCanvasSource,
    /disabled=\{selectedProvider !== CUSTOM_PROVIDER\}/,
  );
  assert.match(workflowCanvasSource, /OpenAI 支持自定义 API 接入点/);
});

test("model connection test validates the current endpoint config before reporting success", () => {
  assert.match(
    workflowCanvasSource,
    /async function handleTestProviderConnection\(\)[\s\S]*?await saveModelConfig\(\{[\s\S]*?\.\.\.modelConfig,[\s\S]*?id: readStoredModelConfigId\(\),[\s\S]*?\}\);[\s\S]*?const status = await getProviderCredentialStatus\(selectedProvider\);[\s\S]*?setActionMessage\("连接检查通过"\)/,
  );
});

test("model settings keeps custom provider disabled until runtime adapter support exists", () => {
  assert.match(workflowCanvasSource, /\{ id: CUSTOM_PROVIDER, label: "Custom"[\s\S]*?enabled: false/);
  assert.doesNotMatch(workflowCanvasSource, /CustomProviderCreateModal/);
  assert.doesNotMatch(workflowCanvasSource, /新建 Provider/);
  assert.doesNotMatch(workflowCanvasSource, /function handleCreateCustomProvider/);
  assert.doesNotMatch(workflowCanvasSource, /setProviderApiKey\(CUSTOM_PROVIDER, apiKey\)/);
  assert.doesNotMatch(
    workflowCanvasSource,
    /saveModelConfig\(\{[\s\S]*?provider: CUSTOM_PROVIDER[\s\S]*?providerName[\s\S]*?providerBaseUrl/,
  );
});

test("api key inputs use visible masked text instead of password controls", () => {
  assert.match(
    workflowCanvasSource,
    /placeholder=\{credentialStatus\?\.maskedKey \?\? `输入 \$\{selectedProviderOption\.label\} API Key`\}[\s\S]*?type="text"/,
  );
  assert.match(
    workflowCanvasSource,
    /placeholder="粘贴 OpenAI API Key"[\s\S]*?type="text"/,
  );
  assert.match(
    workflowCanvasSource,
    /placeholder="OpenAI API Key"[\s\S]*?type="text"/,
  );
});

test("api key reveal button toggles saved secret on demand", () => {
  assert.match(modelServiceSource, /export async function getProviderApiKey/);
  assert.match(modelServiceSource, /invoke<string>\("get_provider_api_key"/);
  assert.match(credentialCommandsSource, /pub async fn get_provider_api_key/);
  assert.match(tauriLibSource, /commands::credentials::get_provider_api_key/);
  assert.match(workflowCanvasSource, /const \[revealedApiKey, setRevealedApiKey\] = useState<string \| null>\(null\);/);
  assert.match(workflowCanvasSource, /async function handleToggleApiKeyReveal\(\)/);
  assert.match(workflowCanvasSource, /await getProviderApiKey\(selectedProvider\)/);
  assert.match(workflowCanvasSource, /apiKeyVisible \? <EyeOff size=\{17\} \/> : <Eye size=\{17\} \/>/);
  assert.doesNotMatch(workflowCanvasSource, /aria-label="API Key 保存在系统密钥库" disabled/);
});

test("model list table columns shrink without clipping model names", () => {
  assert.match(
    globalCssSource,
    /\.model-table__head,\s*\.model-table button\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.05fr\) minmax\(0,\s*1\.45fr\) minmax\(64px,\s*0\.5fr\) 48px;/,
  );
  assert.match(
    globalCssSource,
    /\.model-table button > span\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
  );
  assert.match(globalCssSource, /\.model-table strong\s*\{[\s\S]*?white-space:\s*nowrap;/);
});

test("model settings defaults to gpt-image-2 and exposes the supported size presets", () => {
  assert.match(workflowCanvasSource, /const DEFAULT_MODEL_ID = "gpt-image-2";/);
  assert.match(workflowCanvasSource, /displayName: "GPT Image 2"/);
  for (const size of [
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
  ]) {
    assert.match(workflowCanvasSource, new RegExp(`"${size}"`));
  }
  assert.match(workflowCanvasSource, /formatModelSizeLabel\(size\)/);
});
