import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTaskHistoryDetailPreviews,
  collectTaskHistoryInputAssetIds,
  getTaskHistoryCoverImageSrc,
} from "../src/features/workflow/components/taskHistoryPreviewSources.ts";

const convert = (path) => `asset://${path}`;

function taskDetail({ results = [], assetSnapshotJson, inputSnapshotJson = {} } = {}) {
  return {
    task: {
      inputSnapshotJson,
      assetSnapshotJson,
    },
    results,
    executionLogs: [],
  };
}

function assetView(id, type, src) {
  return {
    asset: {
      id,
      assetType: type,
      originalName: `${id}.jpg`,
      relativePath: `assets/${type}/${id}.jpg`,
      thumbRelativePath: `assets/cache/thumbs/${id}.jpg`,
      mimeType: "image/jpeg",
      sha256: `sha-${id}`,
      width: 100,
      height: 160,
      createdAt: "2026-06-17 09:51:00",
    },
    filePath: `/workspace/assets/${type}/${id}.jpg`,
    thumbFilePath: `/workspace/assets/cache/thumbs/${id}.jpg`,
    thumbDataUrl: src,
  };
}

test("task history cover uses result thumbnail before input thumbnails", () => {
  const detail = taskDetail({
    results: [{
      assetId: "result-1",
      thumbFilePath: "/workspace/assets/cache/thumbs/result-1.jpg",
      filePath: "/workspace/assets/result/result-1.jpg",
    }],
    assetSnapshotJson: [
      { assetId: "person-1", role: "person", sortOrder: 0, isPrimary: true },
    ],
  });

  assert.equal(
    getTaskHistoryCoverImageSrc(detail, {
      "person-1": assetView("person-1", "person", "data:image/jpeg;base64,person"),
    }, convert),
    "asset:///workspace/assets/cache/thumbs/result-1.jpg",
  );
});

test("failed task history cover falls back to the primary person input", () => {
  const detail = taskDetail({
    assetSnapshotJson: [
      { assetId: "garment-1", role: "garment", sortOrder: 0, isPrimary: false },
      { assetId: "person-1", role: "person", sortOrder: 0, isPrimary: true },
    ],
  });

  assert.deepEqual(collectTaskHistoryInputAssetIds(detail), ["garment-1", "person-1"]);
  assert.equal(
    getTaskHistoryCoverImageSrc(detail, {
      "person-1": assetView("person-1", "person", "data:image/jpeg;base64,person"),
      "garment-1": assetView("garment-1", "garment", "data:image/jpeg;base64,garment"),
    }, convert),
    "data:image/jpeg;base64,person",
  );
});

test("task history input preview falls back to snapshot relative thumbnail path", () => {
  const detail = taskDetail({
    assetSnapshotJson: [
      {
        assetId: "person-1",
        role: "person",
        sortOrder: 0,
        isPrimary: true,
        relativePath: "assets/person/person-1.jpg",
        thumbRelativePath: "assets/cache/thumbs/person-1.jpg",
      },
    ],
  });

  assert.equal(
    getTaskHistoryCoverImageSrc(detail, {}, convert, "/workspace"),
    "asset:///workspace/assets/cache/thumbs/person-1.jpg",
  );
  assert.deepEqual(
    buildTaskHistoryDetailPreviews(detail, {}, convert, "/workspace").map((preview) => [
      preview.label,
      preview.src,
    ]),
    [
      ["人物图", "asset:///workspace/assets/cache/thumbs/person-1.jpg"],
      ["结果图", undefined],
    ],
  );
});

test("task history detail previews render person garment and result images", () => {
  const detail = taskDetail({
    results: [{
      assetId: "result-1",
      thumbFilePath: "/workspace/assets/cache/thumbs/result-1.jpg",
      filePath: "/workspace/assets/result/result-1.jpg",
    }],
    assetSnapshotJson: [
      { assetId: "person-1", role: "person", sortOrder: 0, isPrimary: true },
      { assetId: "garment-1", role: "garment", sortOrder: 0, isPrimary: false },
    ],
  });

  assert.deepEqual(
    buildTaskHistoryDetailPreviews(detail, {
      "person-1": assetView("person-1", "person", "data:image/jpeg;base64,person"),
      "garment-1": assetView("garment-1", "garment", "data:image/jpeg;base64,garment"),
    }, convert).map((preview) => [preview.label, preview.src]),
    [
      ["人物图", "data:image/jpeg;base64,person"],
      ["服装图", "data:image/jpeg;base64,garment"],
      ["结果图", "asset:///workspace/assets/cache/thumbs/result-1.jpg"],
    ],
  );
});

test("failed task history detail keeps a result placeholder", () => {
  const detail = taskDetail({
    assetSnapshotJson: [
      { assetId: "person-1", role: "person", sortOrder: 0, isPrimary: true },
      { assetId: "garment-1", role: "garment", sortOrder: 0, isPrimary: false },
    ],
  });

  assert.deepEqual(
    buildTaskHistoryDetailPreviews(detail, {
      "person-1": assetView("person-1", "person", "data:image/jpeg;base64,person"),
      "garment-1": assetView("garment-1", "garment", "data:image/jpeg;base64,garment"),
    }, convert).map((preview) => [preview.label, preview.src]),
    [
      ["人物图", "data:image/jpeg;base64,person"],
      ["服装图", "data:image/jpeg;base64,garment"],
      ["结果图", undefined],
    ],
  );
});
