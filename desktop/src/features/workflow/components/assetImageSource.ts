import type { AssetFileView } from "../../assets/model/assetTypes";

export type AssetPathConverter = (path: string) => string;

export type AssetImageSources = {
  canvasPrimarySrc: string;
  canvasFallbackSrc: string | null;
  thumbSrc: string;
};

export function buildAssetImageSources(
  asset: AssetFileView,
  convertFilePath: AssetPathConverter,
): AssetImageSources {
  const thumbSrc = asset.thumbDataUrl || convertFilePath(asset.thumbFilePath);
  const canvasPrimarySrc = convertFilePath(asset.filePath);

  return {
    canvasPrimarySrc,
    canvasFallbackSrc: thumbSrc === canvasPrimarySrc ? null : thumbSrc,
    thumbSrc,
  };
}
