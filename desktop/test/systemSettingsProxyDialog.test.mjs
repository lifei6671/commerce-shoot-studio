import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
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
