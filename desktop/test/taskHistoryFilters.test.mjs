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
