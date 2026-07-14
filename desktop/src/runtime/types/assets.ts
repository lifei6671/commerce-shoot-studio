import type { DateTimeString, PageRequest, PageResult } from "./common";

export type AssetKind = "source" | "reference" | "model" | "generated" | "thumbnail";
export type AssetLifecycle = "staged" | "active" | "deleted";

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  originalName: string;
  mimeType: string;
  relativePath: string;
  sha256: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  lifecycle: AssetLifecycle;
  url?: string;
  localPath?: string;
  thumbnailPath?: string;
  deletedAt?: DateTimeString;
  createdAt: DateTimeString;
  updatedAt: DateTimeString;
};

export type BuiltinModelAsset = {
  id: string;
  label: string;
  fileName: string;
  path: string;
  thumbnailPath?: string;
};

export type AssetQuery = PageRequest & {
  kind?: AssetKind;
  includeDeleted?: boolean;
};

export type AssetPage = PageResult<Asset>;

export type ImportImagesInput = {
  kind: Exclude<AssetKind, "generated" | "thumbnail">;
  paths: string[];
};
