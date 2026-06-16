import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const tauriConfigSource = readFileSync(
  new URL("../src-tauri/tauri.conf.json", import.meta.url),
  "utf8",
);
const tauriLibSource = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);

test("macOS app menu uses Chinese labels and exposes navigation entries", () => {
  const tauriConfig = JSON.parse(tauriConfigSource);
  assert.equal(tauriConfig.productName, "商拍工坊");

  for (const menuLabel of [
    "关于商拍工坊",
    "打开工作台",
    "偏好设置...",
    "模型设置",
    "方案中心",
    "退出商拍工坊",
    "文件",
    "编辑",
    "视图",
    "窗口",
  ]) {
    assert.match(tauriLibSource, new RegExp(menuLabel.replaceAll(".", String.raw`\.`)));
  }
});

test("macOS menu opens the requested workbench destination", () => {
  for (const eventName of [
    "commerce-shoot-studio://open-workbench",
    "commerce-shoot-studio://open-system-settings",
    "commerce-shoot-studio://open-model-settings",
    "commerce-shoot-studio://open-prompt-preset-center",
  ]) {
    assert.match(tauriLibSource, new RegExp(eventName.replaceAll("/", String.raw`\/`)));
    assert.match(workflowCanvasSource, new RegExp(eventName.replaceAll("/", String.raw`\/`)));
  }

  assert.match(workflowCanvasSource, /listen\(OPEN_SYSTEM_SETTINGS_EVENT, \(\) => \{[\s\S]*?openSettingsCenter\("system"\);/);
  assert.match(workflowCanvasSource, /listen\(OPEN_MODEL_SETTINGS_EVENT, \(\) => \{[\s\S]*?openSettingsCenter\("model"\);/);
  assert.match(workflowCanvasSource, /listen\(OPEN_PROMPT_PRESET_CENTER_EVENT, \(\) => \{[\s\S]*?openPromptPresetCenter\(\);/);
  assert.match(workflowCanvasSource, /onModelSettings=\{\(\) => openSettingsCenter\("model"\)\}/);
});

test("macOS hides the window and exposes a right-side status item menu", () => {
  assert.match(tauriLibSource, /#\[cfg\(target_os = "macos"\)\]\s*configure_macos_status_item\(app\)\?/);
  assert.match(tauriLibSource, /TrayIconBuilder::with_id\("commerce-shoot-studio-status"\)/);
  assert.match(tauriLibSource, /\.menu\(&tray_menu\)/);
  assert.match(tauriLibSource, /\.show_menu_on_left_click\(true\)/);
  assert.match(tauriLibSource, /app\.default_window_icon\(\)\.cloned\(\)/);
  assert.match(tauriLibSource, /tray_builder = tray_builder\.icon\(icon\)\.icon_as_template\(false\)/);
  assert.match(tauriLibSource, /#\[cfg\(not\(target_os = "macos"\)\)\]\s*fn configure_tray/);
  assert.match(tauriLibSource, /#\[cfg\(target_os = "macos"\)\][\s\S]*?api\.prevent_close\(\);[\s\S]*?window\.hide\(\);/);
});
