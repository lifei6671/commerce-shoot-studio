import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAssetImageSources } from "../src/features/workflow/components/assetImageSource.ts";

function asset(overrides = {}) {
  return {
    asset: {
      id: "asset-a",
      assetType: "person",
      originalName: "person.jpg",
      relativePath: "assets/person.jpg",
      thumbRelativePath: "assets/person.thumb.jpg",
      mimeType: "image/jpeg",
      sha256: "asset-a",
      width: 1086,
      height: 1448,
      createdAt: "2026-06-13T00:00:00Z",
    },
    filePath: "/workspace/assets/person.jpg",
    thumbFilePath: "/workspace/assets/person.thumb.jpg",
    thumbDataUrl: "data:image/jpeg;base64,thumb",
    ...overrides,
  };
}

test("canvas image source keeps original image primary and uses thumbnail as fallback", () => {
  const sources = buildAssetImageSources(asset(), (path) => `asset://${path}`);

  assert.equal(sources.canvasPrimarySrc, "asset:///workspace/assets/person.jpg");
  assert.equal(sources.canvasFallbackSrc, "data:image/jpeg;base64,thumb");
  assert.equal(sources.thumbSrc, "data:image/jpeg;base64,thumb");
});

test("canvas image source falls back to converted thumbnail file when no data url exists", () => {
  const sources = buildAssetImageSources(asset({ thumbDataUrl: null }), (path) => `asset://${path}`);

  assert.equal(sources.canvasPrimarySrc, "asset:///workspace/assets/person.jpg");
  assert.equal(sources.canvasFallbackSrc, "asset:///workspace/assets/person.thumb.jpg");
  assert.equal(sources.thumbSrc, "asset:///workspace/assets/person.thumb.jpg");
});
