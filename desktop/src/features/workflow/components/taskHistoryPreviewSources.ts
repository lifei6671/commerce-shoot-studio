import type { AssetFileView } from "../../assets/model/assetTypes";
import type {
  GenerationTaskDetail,
  GenerationTaskResultAsset,
} from "../../generation-task/model/taskTypes";

type FilePathConverter = (path: string) => string;

export type TaskHistoryPreviewSource = {
  assetId: string;
  label: string;
  role: "person" | "garment" | "result" | "unknown";
  src?: string;
};

type SnapshotAsset = {
  assetId: string;
  role: "person" | "garment" | "result" | "unknown";
  sortOrder: number;
  isPrimary: boolean;
  thumbFilePath?: string;
  filePath?: string;
  thumbRelativePath?: string;
  relativePath?: string;
};

export type TaskHistoryAssetLookup = Record<string, AssetFileView | undefined>;

export function collectTaskHistoryInputAssetIds(detail: GenerationTaskDetail): string[] {
  const ids = new Set<string>();

  for (const asset of readSnapshotAssets(detail.task.assetSnapshotJson)) {
    ids.add(asset.assetId);
  }

  const inputSnapshot = detail.task.inputSnapshotJson;
  if (typeof inputSnapshot.personAssetId === "string") {
    ids.add(inputSnapshot.personAssetId);
  }
  if (Array.isArray(inputSnapshot.garmentAssetIds)) {
    for (const assetId of inputSnapshot.garmentAssetIds) {
      if (typeof assetId === "string") {
        ids.add(assetId);
      }
    }
  }

  return Array.from(ids);
}

export function buildTaskHistoryInputPreviews(
  detail: GenerationTaskDetail,
  assetLookup: TaskHistoryAssetLookup,
  convertFilePath: FilePathConverter,
  workspaceRoot?: string,
): TaskHistoryPreviewSource[] {
  const snapshotAssets = readSnapshotAssets(detail.task.assetSnapshotJson);
  const assets = snapshotAssets.length
    ? snapshotAssets
    : buildAssetsFromInputSnapshot(detail.task.inputSnapshotJson);

  return assets
    .sort(compareInputPreviewOrder)
    .map((asset) => ({
      assetId: asset.assetId,
      label: getInputPreviewLabel(asset.role),
      role: asset.role,
      src: resolveInputAssetSrc(asset, assetLookup[asset.assetId], convertFilePath, workspaceRoot),
    }));
}

export function buildTaskHistoryDetailPreviews(
  detail: GenerationTaskDetail,
  assetLookup: TaskHistoryAssetLookup,
  convertFilePath: FilePathConverter,
  workspaceRoot?: string,
): TaskHistoryPreviewSource[] {
  const resultPreviews = detail.results.length
    ? detail.results.map((result, index) => ({
        assetId: result.assetId,
        label: index === 0 ? "结果图" : `结果图 ${index + 1}`,
        role: "result" as const,
        src: resultAssetSrc(result, convertFilePath),
      }))
    : [{
        assetId: "result-placeholder",
        label: "结果图",
        role: "result" as const,
      }];

  return [
    ...buildTaskHistoryInputPreviews(detail, assetLookup, convertFilePath, workspaceRoot),
    ...resultPreviews,
  ];
}

export function getTaskHistoryCoverImageSrc(
  detail: GenerationTaskDetail,
  assetLookup: TaskHistoryAssetLookup,
  convertFilePath: FilePathConverter,
  workspaceRoot?: string,
): string | undefined {
  const result = detail.results[0];
  if (result) {
    return resultAssetSrc(result, convertFilePath);
  }

  return buildTaskHistoryInputPreviews(detail, assetLookup, convertFilePath, workspaceRoot).find(
    (preview) => preview.src,
  )?.src;
}

function readSnapshotAssets(value: Record<string, unknown>): SnapshotAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const assetId = readString(record.assetId);
    if (!assetId) {
      return [];
    }

    return [{
      assetId,
      role: normalizeRole(readString(record.role)),
      sortOrder: readNumber(record.sortOrder) ?? index,
      isPrimary: record.isPrimary === true,
      thumbFilePath: readString(record.thumbFilePath),
      filePath: readString(record.filePath),
      thumbRelativePath: readString(record.thumbRelativePath),
      relativePath: readString(record.relativePath),
    }];
  });
}

function buildAssetsFromInputSnapshot(value: Record<string, unknown>): SnapshotAsset[] {
  const assets: SnapshotAsset[] = [];
  if (typeof value.personAssetId === "string") {
    assets.push({
      assetId: value.personAssetId,
      role: "person",
      sortOrder: 0,
      isPrimary: true,
    });
  }
  if (Array.isArray(value.garmentAssetIds)) {
    value.garmentAssetIds.forEach((assetId, index) => {
      if (typeof assetId === "string") {
        assets.push({
          assetId,
          role: "garment",
          sortOrder: index,
          isPrimary: false,
        });
      }
    });
  }
  return assets;
}

function compareInputPreviewOrder(left: SnapshotAsset, right: SnapshotAsset) {
  const roleOrder = (asset: SnapshotAsset) => {
    if (asset.role === "person") {
      return 0;
    }
    if (asset.role === "garment") {
      return 1;
    }
    return 2;
  };
  return roleOrder(left) - roleOrder(right) || Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder;
}

function resolveInputAssetSrc(
  snapshotAsset: SnapshotAsset,
  asset: AssetFileView | undefined,
  convertFilePath: FilePathConverter,
  workspaceRoot: string | undefined,
) {
  if (asset?.thumbDataUrl) {
    return asset.thumbDataUrl;
  }
  if (asset?.thumbFilePath) {
    return convertFilePath(asset.thumbFilePath);
  }
  if (asset?.filePath) {
    return convertFilePath(asset.filePath);
  }
  if (snapshotAsset.thumbFilePath) {
    return convertFilePath(snapshotAsset.thumbFilePath);
  }
  if (snapshotAsset.filePath) {
    return convertFilePath(snapshotAsset.filePath);
  }
  const snapshotRelativePath =
    snapshotAsset.thumbRelativePath ?? snapshotAsset.relativePath;
  const snapshotFilePath = resolveWorkspaceFilePath(workspaceRoot, snapshotRelativePath);
  if (snapshotFilePath) {
    return convertFilePath(snapshotFilePath);
  }
  return undefined;
}

function resultAssetSrc(result: GenerationTaskResultAsset, convertFilePath: FilePathConverter) {
  return convertFilePath(result.thumbFilePath || result.filePath);
}

function getInputPreviewLabel(role: SnapshotAsset["role"]) {
  if (role === "person") {
    return "人物图";
  }
  if (role === "garment") {
    return "服装图";
  }
  return "输入图";
}

function normalizeRole(value: string | undefined): SnapshotAsset["role"] {
  if (value === "person" || value === "garment" || value === "result") {
    return value;
  }
  return "unknown";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveWorkspaceFilePath(
  workspaceRoot: string | undefined,
  relativePath: string | undefined,
) {
  if (!relativePath) {
    return undefined;
  }
  if (isAbsoluteFilePath(relativePath)) {
    return relativePath;
  }
  const root = workspaceRoot?.trim();
  if (!root) {
    return undefined;
  }
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath
    .replace(/^[\\/]+/, "")
    .replace(/\//g, separator);
  return `${normalizedRoot}${separator}${normalizedRelative}`;
}

function isAbsoluteFilePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
