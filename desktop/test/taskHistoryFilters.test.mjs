import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildTaskHistoryDateRange,
  buildTaskHistoryModelOptions,
  buildTaskHistoryProviderOptions,
  canRetryTaskHistoryItem,
} from "../src/features/generation-task/model/taskHistoryFilters.ts";

const workflowCanvasSource = readFileSync(
  new URL("../src/features/workflow/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8",
);
const globalCssSource = readFileSync(
  new URL("../src/shared/styles/global.css", import.meta.url),
  "utf8",
);
const taskHistoryPreviewSource = readFileSync(
  new URL("../src/features/workflow/components/taskHistoryPreviewSources.ts", import.meta.url),
  "utf8",
);

test("task history provider options include catalog providers beyond the current page", () => {
  const options = buildTaskHistoryProviderOptions(
    ["openai"],
    ["fal", "openai", "replicate"],
  );

  assert.deepEqual(options, ["fal", "openai", "replicate"]);
});

test("task history model options include catalog models beyond the current page", () => {
  const options = buildTaskHistoryModelOptions(
    ["gpt-image-1"],
    ["flux-dev", "gpt-image-1", "sdxl"],
  );

  assert.deepEqual(options, ["flux-dev", "gpt-image-1", "sdxl"]);
});

test("task history filter menu closes after selecting an option", () => {
  assert.match(
    workflowCanvasSource,
    /onClick=\{\(\) => \{\s*onChange\(option\.value\);\s*onOpenChange\(false\);\s*\}\}/,
  );
});

test("task history page header places title after the back button", () => {
  const headerStart = workflowCanvasSource.indexOf('className="settings-center__header"');
  const backButton = workflowCanvasSource.indexOf('className="settings-back-button"', headerStart);
  const title = workflowCanvasSource.indexOf('className="task-history-title"', headerStart);
  const body = workflowCanvasSource.indexOf('className="settings-center__body"', headerStart);

  assert.notEqual(headerStart, -1);
  assert.ok(backButton > headerStart);
  assert.ok(title > backButton);
  assert.ok(body > title);
  assert.match(workflowCanvasSource, /<h1>任务历史<\/h1>/);
  assert.match(workflowCanvasSource, /追踪生成任务、执行日志与结果文件/);
  assert.doesNotMatch(workflowCanvasSource, /className="task-history-header"/);
});

test("task history toolbar order matches the workbench layout", () => {
  const toolbarStart = workflowCanvasSource.indexOf('className="task-history-toolbar"');
  const tabs = workflowCanvasSource.indexOf('className="task-history-tabs"', toolbarStart);
  const providerFilter = workflowCanvasSource.indexOf('openFilterMenu === "provider"', toolbarStart);
  const modelFilter = workflowCanvasSource.indexOf('openFilterMenu === "model"', toolbarStart);
  const dateFilter = workflowCanvasSource.indexOf('openFilterMenu === "date"', toolbarStart);
  const search = workflowCanvasSource.indexOf('className="task-history-search"', toolbarStart);
  const searchButton = workflowCanvasSource.indexOf(
    'className="task-history-search-button"',
    toolbarStart,
  );
  const refreshButton = workflowCanvasSource.indexOf(
    'className="task-history-refresh-button"',
    toolbarStart,
  );

  assert.notEqual(toolbarStart, -1);
  assert.ok(tabs > toolbarStart);
  assert.ok(providerFilter > tabs);
  assert.ok(modelFilter > providerFilter);
  assert.ok(dateFilter > modelFilter);
  assert.ok(search > dateFilter);
  assert.ok(searchButton > search);
  assert.ok(refreshButton > searchButton);
});

test("task history global stats stay above filters and ignore search results", () => {
  const boardStart = workflowCanvasSource.indexOf('className="task-history-board"');
  const stats = workflowCanvasSource.indexOf('className="task-history-stats"', boardStart);
  const toolbar = workflowCanvasSource.indexOf('className="task-history-toolbar"', boardStart);

  assert.notEqual(boardStart, -1);
  assert.ok(stats > boardStart);
  assert.ok(toolbar > stats);
  assert.match(workflowCanvasSource, /const \[allHistoryStats, setAllHistoryStats\]/);
  assert.match(
    workflowCanvasSource,
    /const allStatsPage = await listGenerationTaskHistory\(\{\s*limit: 1,\s*offset: 0,\s*\}\);/,
  );
  assert.match(workflowCanvasSource, /value=\{allHistoryStats\.total\}/);
  assert.match(workflowCanvasSource, /value=\{allHistoryStats\.succeeded\}/);
  assert.match(workflowCanvasSource, /value=\{allHistoryStats\.failed\}/);
  assert.match(workflowCanvasSource, /value=\{allHistoryStats\.cancelled\}/);
  assert.doesNotMatch(workflowCanvasSource, /value=\{historyPage\?\.stats\.total \?\? 0\}/);
});

test("task history global stats use distinct color blocks", () => {
  assert.match(globalCssSource, /\.task-history-stat\.is-total\s*\{/);
  assert.match(globalCssSource, /\.task-history-stat\.is-succeeded\s*\{/);
  assert.match(globalCssSource, /\.task-history-stat\.is-failed\s*\{/);
  assert.match(globalCssSource, /\.task-history-stat\.is-cancelled\s*\{/);
  assert.match(globalCssSource, /\.task-history-stat\s*\{[\s\S]*?border-radius:\s*8px/);
});

test("task history search only reloads after search is submitted", () => {
  assert.match(workflowCanvasSource, /const \[searchDraft, setSearchDraft\] = useState\(""\)/);
  assert.match(
    workflowCanvasSource,
    /function runTaskHistorySearch\(\) \{[\s\S]*?setSearch\(searchDraft\);/,
  );
  assert.match(workflowCanvasSource, /value=\{searchDraft\}/);
  assert.match(
    workflowCanvasSource,
    /onChange=\{\(event\) => setSearchDraft\(event\.target\.value\)\}/,
  );
  assert.doesNotMatch(
    workflowCanvasSource,
    /onChange=\{\(event\) => resetPageAndSetSearch\(event\.target\.value\)\}/,
  );
});

test("task history log export reloads all rows that match the current filters", () => {
  assert.match(
    workflowCanvasSource,
    /const exportItems: GenerationTaskDetail\[\] = \[\];\s*let exportTotal = historyPage\?\.total \?\? 0;\s*do \{\s*const exportPage = await listGenerationTaskHistory\(\{\s*search,\s*status: status === "all" \? null : status,\s*provider: provider === "all" \? null : provider,\s*modelId: modelId === "all" \? null : modelId,\s*createdFrom: exportDateRange\.createdFrom,\s*createdTo: exportDateRange\.createdTo,\s*limit: EXPORT_PAGE_SIZE,\s*offset: exportItems\.length,\s*\}\);\s*exportItems\.push\(\.\.\.exportPage\.items\);\s*exportTotal = exportPage\.total;\s*if \(!exportPage\.items\.length\) \{\s*break;\s*\}\s*\} while \(exportItems\.length < exportTotal\);/,
  );
});

test("task history date range uses UTC sqlite boundaries for local day filters", () => {
  process.env.TZ = "Asia/Shanghai";
  const now = new Date(2026, 5, 15, 8, 30, 0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const range = buildTaskHistoryDateRange("today", now);

  assert.equal(range.createdFrom, formatUtcSqliteDateTime(start));
  assert.equal(range.createdTo, formatUtcSqliteDateTime(end));
  assert.notEqual(range.createdFrom, formatLocalSqliteDateTime(start));
});

test("task history retry is limited to failed openai tasks", () => {
  assert.equal(canRetryTaskHistoryItem({ status: "failed", provider: "openai" }), true);
  assert.equal(canRetryTaskHistoryItem({ status: "cancelled", provider: "openai" }), true);
  assert.equal(canRetryTaskHistoryItem({ status: "succeeded", provider: "openai" }), false);
  assert.equal(canRetryTaskHistoryItem({ status: "failed", provider: "legacy-provider" }), false);
});

test("task history exposes retry and rerun as separate actions", () => {
  assert.match(workflowCanvasSource, /retryGenerationTask\(selectedDetail\.task\.id\)/);
  assert.match(
    workflowCanvasSource,
    /rerunGenerationFromCurrentCombination\(currentCombinationId, modelConfig\)/,
  );
  assert.match(workflowCanvasSource, />\s*重试任务\s*<\/Button>/);
  assert.match(workflowCanvasSource, />\s*按当前配置重跑\s*<\/Button>/);
});

test("task history detail displays immutable task snapshots", () => {
  assert.match(workflowCanvasSource, /<h4>输入快照<\/h4>/);
  assert.match(workflowCanvasSource, /selectedDetail\.task\.assetSnapshotJson/);
  assert.match(workflowCanvasSource, /<h4>最终 Prompt<\/h4>/);
  assert.match(workflowCanvasSource, /selectedDetail\.task\.finalPromptSnapshotJson/);
  assert.match(workflowCanvasSource, /<h4>模型参数<\/h4>/);
  assert.match(workflowCanvasSource, /selectedDetail\.task\.modelConfigSnapshotJson/);
});

test("task history previews use real result or input asset images", () => {
  assert.match(workflowCanvasSource, /collectTaskHistoryInputAssetIds/);
  assert.match(workflowCanvasSource, /getTaskHistoryCoverImageSrc\(/);
  assert.match(workflowCanvasSource, /buildTaskHistoryDetailPreviews\(/);
  assert.match(workflowCanvasSource, /const \[historyAssetViews, setHistoryAssetViews\]/);
  assert.match(taskHistoryPreviewSource, /thumbDataUrl/);
  assert.doesNotMatch(workflowCanvasSource, /const \[previewAssets, setPreviewAssets\]/);
});

test("task history detail actions are styled as visible buttons", () => {
  assert.match(globalCssSource, /\.task-history-detail-actions button\s*\{[\s\S]*?height:\s*38px/);
  assert.match(globalCssSource, /\.task-history-detail-actions button\s*\{[\s\S]*?border:\s*1px solid #d8e0ec/);
  assert.match(globalCssSource, /\.task-history-detail-actions button\s*\{[\s\S]*?background:\s*#ffffff/);
  assert.match(globalCssSource, /\.task-history-detail-actions button:not\(:disabled\):hover\s*\{/);
  assert.match(globalCssSource, /\.task-history-detail-actions button:disabled\s*\{/);
});

test("task history pagination typography matches table rows", () => {
  const rowRule = globalCssSource.match(/^\.task-history-row\s*\{(?<body>[^}]*)\}/m)?.groups
    ?.body;
  const paginationRule = globalCssSource.match(
    /^\.task-history-pagination\s*\{(?<body>[^}]*)\}/m,
  )?.groups?.body;
  const paginationTextRule = globalCssSource.match(
    /^\.task-history-pagination span,\n\.task-history-pagination strong\s*\{(?<body>[^}]*)\}/m,
  )?.groups?.body;

  assert.ok(rowRule);
  assert.ok(paginationRule);
  assert.ok(paginationTextRule);
  assert.match(rowRule, /font-size:\s*11px/);
  assert.match(paginationRule, /font-size:\s*11px/);
  assert.match(paginationRule, /line-height:\s*1/);
  assert.match(paginationTextRule, /font-size:\s*11px/);
  assert.match(paginationTextRule, /line-height:\s*1/);
});

test("task events combine realtime updates with startup polling fallback", () => {
  assert.match(workflowCanvasSource, /refreshTaskLists\(\)\.catch\(\(\) => undefined\);/);
  assert.match(
    workflowCanvasSource,
    /listenGenerationTaskUpdates\(\(task\) => \{[\s\S]*?getGenerationTaskDetail\(task\.id\)[\s\S]*?setLatestTask\(detail\);[\s\S]*?refreshTaskLists\(\)\.catch\(\(\) => undefined\);/,
  );
});

test("task history error actions report failures through toast", () => {
  assert.match(
    workflowCanvasSource,
    /try \{\s*await navigator\.clipboard\.writeText\(JSON\.stringify\(value, null, 2\)\);\s*onNotifyMessage\("错误返回已复制"\);\s*\} catch \(error\) \{\s*onNotifyError\(error instanceof Error \? error\.message : "复制错误返回失败"\);\s*\}/,
  );
  assert.match(
    workflowCanvasSource,
    /openGenerationResult\(first\.assetId\)\.catch\(\(error\) => \{\s*onNotifyError\(error instanceof Error \? error\.message : "打开结果文件失败"\);\s*\}\)/,
  );
});

function formatUtcSqliteDateTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function formatLocalSqliteDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
