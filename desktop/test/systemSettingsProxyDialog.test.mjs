import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
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
  assert.match(workflowCanvasSource, /const proxyTestDisabled = isSaving \|\| isTestingProxy \|\| manualProxyIncomplete;/);
  assert.doesNotMatch(workflowCanvasSource, /const proxyActionDisabled/);
});

test("model config preserves a loaded custom endpoint when saving supported providers", () => {
  assert.match(
    workflowCanvasSource,
    /providerBaseUrl:\s*isCustomProvider \|\| isCustomEndpointEnabled\s*\?\s*customBaseUrl\.trim\(\)\s*:\s*undefined/,
  );
});
