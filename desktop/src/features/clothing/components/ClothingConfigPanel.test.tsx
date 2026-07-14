import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ComponentProps } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ClothingConfigPanel,
  defaultClothingConfig,
  type ClothingConfigState,
  type GeneratedBaseModelImage,
} from "./ClothingConfigPanel";
import { ToastProvider } from "../../../shared/ui/toast";
import { localAssetPort } from "../../../runtime/local/assets";
import { selectProductImages } from "../../generation/lib/productImagePicker";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("../../../runtime/local/assets", () => ({
  localAssetPort: {
    deleteAsset: vi.fn(),
    importImages: vi.fn(),
    listBuiltinModels: vi.fn(),
    listAssets: vi.fn(),
  },
}));

vi.mock("../../generation/lib/productImagePicker", () => ({
  selectProductImages: vi.fn(),
}));

const listBuiltinModelsMock = vi.mocked(localAssetPort.listBuiltinModels);
const listAssetsMock = vi.mocked(localAssetPort.listAssets);
const importImagesMock = vi.mocked(localAssetPort.importImages);
const deleteAssetMock = vi.mocked(localAssetPort.deleteAsset);
const convertFileSrcMock = vi.mocked(convertFileSrc);
const selectProductImagesMock = vi.mocked(selectProductImages);

describe("ClothingConfigPanel", () => {
  beforeEach(() => {
    deleteAssetMock.mockReset();
    deleteAssetMock.mockResolvedValue(undefined);
    importImagesMock.mockReset();
    listAssetsMock.mockReset();
    listBuiltinModelsMock.mockResolvedValue([]);
    listAssetsMock.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });
    convertFileSrcMock.mockClear();
    selectProductImagesMock.mockReset();
  });

  it("shows builtin full-body models as cropped avatar tiles and selects one", async () => {
    const user = userEvent.setup();
    listBuiltinModelsMock.mockResolvedValue([
      {
        fileName: "model-01.png",
        id: "model-01",
        label: "内置模特 01",
        path: "/app/resources/builtin-models/model-01.png",
        thumbnailPath: "/app/resources/builtin-model-thumbnails/model-01.png",
      },
    ]);

    renderPanel();

    const modelTile = await screen.findByRole("button", { name: "选择内置模特 内置模特 01" });
    expect(convertFileSrcMock).toHaveBeenCalledWith("/app/resources/builtin-model-thumbnails/model-01.png");
    expect(within(modelTile).getByAltText("内置模特 01")).toHaveClass("object-cover");
    expect(within(modelTile).getByAltText("内置模特 01")).not.toHaveClass("scale-[2.35]");

    await user.click(modelTile);

    expect(modelTile).toHaveAttribute("aria-pressed", "true");
    expect(within(modelTile).getByLabelText("已选中 内置模特 01")).toBeInTheDocument();
  });

  it("keeps a selected builtin model out of the uploaded model section", async () => {
    const user = userEvent.setup();
    listBuiltinModelsMock.mockResolvedValue([
      {
        fileName: "model-01.png",
        id: "model-01",
        label: "内置模特 01",
        path: "/app/resources/builtin-models/model-01.png",
        thumbnailPath: "/app/resources/builtin-model-thumbnails/model-01.png",
      },
    ]);

    renderPanel();

    await user.click(await screen.findByRole("button", { name: "选择内置模特 内置模特 01" }));

    expect(screen.getAllByRole("button", { name: "选择内置模特 内置模特 01" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "选择模特 内置模特 01" })).not.toBeInTheDocument();
  });

  it("limits builtin model library to two rows and shows delayed full-body preview tooltip", async () => {
    listBuiltinModelsMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ({
        fileName: `model-${index + 1}.png`,
        id: `model-${index + 1}`,
        label: `内置模特 ${String(index + 1).padStart(2, "0")}`,
        path: `/app/resources/builtin-models/model-${index + 1}.png`,
        thumbnailPath: `/app/resources/builtin-model-thumbnails/model-${index + 1}.png`,
      })),
    );

    renderPanel();

    const modelTile = await screen.findByRole("button", { name: "选择内置模特 内置模特 01" });
    vi.useFakeTimers();
    try {
      const libraryScroll = screen.getByTestId("builtin-model-library-scroll");
      expect(libraryScroll).toHaveClass("max-h-[224px]", "overflow-y-auto", "pr-4", "[scrollbar-gutter:stable]");

      fireEvent.mouseEnter(modelTile);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(450);
      });

      const tooltip = screen.getByRole("tooltip", { name: "内置模特 01 全身照预览" });
      expect(tooltip).toHaveClass("fixed", "z-[130]");
      expect(within(tooltip).getByAltText("内置模特 01 全身照")).toHaveAttribute(
        "src",
        "asset://localhost//app/resources/builtin-models/model-1.png",
      );

      fireEvent.mouseLeave(modelTile);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("places uploaded model images before builtin models", async () => {
    listBuiltinModelsMock.mockResolvedValue([
      {
        fileName: "builtin-01.png",
        id: "builtin-01",
        label: "内置模特 01",
        path: "/app/resources/builtin-models/builtin-01.png",
        thumbnailPath: "/app/resources/builtin-model-thumbnails/builtin-01.png",
      },
    ]);

    renderPanel({
      modelImages: [
        {
          id: "/Users/demo/Pictures/uploaded-model.png",
          name: "uploaded-model.png",
          path: "/Users/demo/Pictures/uploaded-model.png",
          src: "asset://uploaded-model.png",
        },
      ],
      selectedModelId: "/Users/demo/Pictures/uploaded-model.png",
    });

    await screen.findByRole("button", { name: "选择内置模特 内置模特 01" });

    const modelButtons = screen.getAllByRole("button").filter((button) => {
      const label = button.getAttribute("aria-label") ?? "";
      return label === "上传新模特" || label.startsWith("选择模特 ") || label.startsWith("选择内置模特 ");
    });

    expect(modelButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "上传新模特",
      "选择模特 uploaded-model.png",
      "选择内置模特 内置模特 01",
    ]);
  });

  it("does not show asset-less presets while builtin models are loading", () => {
    listBuiltinModelsMock.mockImplementation(() => new Promise(() => {}));

    renderPanel();

    expect(screen.getByTestId("builtin-model-library-scroll")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "上传新模特" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "柔光女模" })).not.toBeInTheDocument();
  });

  it("keeps only the upload entry when builtin model loading completes empty", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("builtin-model-library-scroll")).toHaveAttribute("aria-busy", "false");
    });

    expect(screen.getByRole("button", { name: "上传新模特" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "柔光女模" })).not.toBeInTheDocument();
  });

  it("keeps generation disabled when the selected model id has no real image", async () => {
    renderPanel({
      aiRecommended: true,
      clothingImages: [
        {
          id: "clothing-1",
          name: "dress.png",
          path: "/workspace/current/assets/clothing/dress.png",
          src: "asset://dress.png",
        },
      ],
      selectedModelId: "preset:aurora",
    });

    await waitFor(() => {
      expect(screen.getByTestId("builtin-model-library-scroll")).toHaveAttribute("aria-busy", "false");
    });

    expect(screen.getByRole("button", { name: "请选择模特" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "开始生成" })).not.toBeInTheDocument();
  });

  it("restores uploaded model images from local model assets on startup", async () => {
    listAssetsMock.mockResolvedValue({
      items: [
        {
          createdAt: "2026-07-09T00:00:00.000Z",
          id: "asset_model_1",
          kind: "model",
          lifecycle: "staged",
          localPath: "/workspace/current/assets/model/uploaded-model.png",
          mimeType: "image/png",
          name: "asset-model.png",
          originalName: "uploaded-model.png",
          relativePath: "assets/model/uploaded-model.png",
          sha256: "sha256-model",
          sizeBytes: 128,
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    renderPanel();

    const restoredModel = await screen.findByRole("button", { name: "选择模特 uploaded-model.png" });
    expect(localAssetPort.listAssets).toHaveBeenCalledWith({ kind: "model", page: 1, pageSize: 100 });
    expect(within(restoredModel).getByAltText("uploaded-model.png")).toHaveAttribute(
      "src",
      "asset://localhost//workspace/current/assets/model/uploaded-model.png",
    );
  });

  it("restores uploaded model images from every asset page", async () => {
    const firstPageItems = Array.from({ length: 100 }, (_, index) => ({
      createdAt: "2026-07-09T00:00:00.000Z",
      id: `asset_model_${index + 1}`,
      kind: "model" as const,
      lifecycle: "active" as const,
      localPath: `/workspace/current/assets/model/model-${index + 1}.png`,
      mimeType: "image/png",
      name: `model-${index + 1}.png`,
      originalName: `模特 ${index + 1}.png`,
      relativePath: `assets/model/model-${index + 1}.png`,
      sha256: `sha256-model-${index + 1}`,
      sizeBytes: 128,
      updatedAt: "2026-07-09T00:00:00.000Z",
    }));
    listAssetsMock.mockImplementation(async (query) => {
      if (query?.page === 1) {
        return {
          items: firstPageItems,
          page: 1,
          pageSize: 100,
          total: 101,
        };
      }
      if (query?.page === 2) {
        return {
          items: [
            {
              createdAt: "2026-07-09T00:00:00.000Z",
              id: "asset_model_101",
              kind: "model",
              lifecycle: "active",
              localPath: "/workspace/current/assets/model/model-101.png",
              mimeType: "image/png",
              name: "model-101.png",
              originalName: "第 101 位模特.png",
              relativePath: "assets/model/model-101.png",
              sha256: "sha256-model-101",
              sizeBytes: 128,
              updatedAt: "2026-07-09T00:00:00.000Z",
            },
          ],
          page: 2,
          pageSize: 100,
          total: 101,
        };
      }
      throw new Error(`unexpected model asset page: ${query?.page}`);
    });

    renderPanel();

    expect(await screen.findByRole("button", { name: "选择模特 第 101 位模特.png" })).toBeInTheDocument();
    expect(localAssetPort.listAssets).toHaveBeenNthCalledWith(1, { kind: "model", page: 1, pageSize: 100 });
    expect(localAssetPort.listAssets).toHaveBeenNthCalledWith(2, { kind: "model", page: 2, pageSize: 100 });
  });

  it("uses a model asset thumbnail in the library while keeping the full-body preview", async () => {
    listAssetsMock.mockResolvedValue({
      items: [
        {
          createdAt: "2026-07-09T00:00:00.000Z",
          id: "asset_model_with_thumbnail",
          kind: "model",
          lifecycle: "active",
          localPath: "/workspace/current/assets/model/favorited-model.png",
          mimeType: "image/png",
          name: "favorited-model.png",
          originalName: "收藏模特.png",
          relativePath: "assets/model/favorited-model.png",
          sha256: "sha256-model-with-thumbnail",
          sizeBytes: 128,
          thumbnailPath: "/workspace/current/assets/thumbnail/favorited-model-320.png",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ],
      page: 1,
      pageSize: 100,
      total: 1,
    });

    renderPanel();

    const restoredModel = await screen.findByRole("button", { name: "选择模特 收藏模特.png" });
    expect(within(restoredModel).getByAltText("收藏模特.png")).toHaveAttribute(
      "src",
      "asset://localhost//workspace/current/assets/thumbnail/favorited-model-320.png",
    );

    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(restoredModel);
      act(() => {
        vi.advanceTimersByTime(450);
      });

      const tooltip = screen.getByRole("tooltip", { name: "收藏模特.png 全身照预览" });
      expect(within(tooltip).getByAltText("收藏模特.png 全身照")).toHaveAttribute(
        "src",
        "asset://localhost//workspace/current/assets/model/favorited-model.png",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("soft deletes uploaded model images from the model library without exposing delete for builtin models", async () => {
    const user = userEvent.setup();
    listBuiltinModelsMock.mockResolvedValue([
      {
        fileName: "builtin-01.png",
        id: "builtin-01",
        label: "内置模特 01",
        path: "/app/resources/builtin-models/builtin-01.png",
        thumbnailPath: "/app/resources/builtin-model-thumbnails/builtin-01.png",
      },
    ]);

    renderPanel({
      modelImages: [
        {
          assetId: "asset_uploaded_model",
          id: "asset_uploaded_model",
          name: "uploaded-model.png",
          path: "/workspace/current/assets/model/uploaded-model.png",
          src: "asset://uploaded-model.png",
        },
      ],
      selectedModelId: "asset_uploaded_model",
    });

    const uploadedModel = screen.getByRole("button", { name: "选择模特 uploaded-model.png" });
    const builtinModel = await screen.findByRole("button", { name: "选择内置模特 内置模特 01" });

    await user.hover(uploadedModel);
    const deleteButton = screen.getByRole("button", { name: "删除模特 uploaded-model.png" });
    expect(deleteButton).toHaveClass("group-hover/model:opacity-100");
    expect(within(builtinModel).queryByRole("button", { name: /删除模特/ })).not.toBeInTheDocument();

    await user.click(deleteButton);

    expect(localAssetPort.deleteAsset).toHaveBeenCalledWith("asset_uploaded_model");
    expect(screen.queryByRole("button", { name: "选择模特 uploaded-model.png" })).not.toBeInTheDocument();
  });

  it("does not restore a model deleted while the initial asset list request is pending", async () => {
    const user = userEvent.setup();
    const modelAsset = {
      createdAt: "2026-07-09T00:00:00.000Z",
      id: "asset_model_deleted_during_restore",
      kind: "model" as const,
      lifecycle: "active" as const,
      localPath: "/workspace/current/assets/model/deleted-during-restore.png",
      mimeType: "image/png",
      name: "deleted-during-restore.png",
      originalName: "恢复期间删除的模特.png",
      relativePath: "assets/model/deleted-during-restore.png",
      sha256: "sha256-model-deleted-during-restore",
      sizeBytes: 128,
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
    let resolveList: (result: Awaited<ReturnType<typeof localAssetPort.listAssets>>) => void = () => {};
    listAssetsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    renderPanel({
      modelImages: [
        {
          assetId: modelAsset.id,
          id: modelAsset.id,
          name: modelAsset.originalName,
          path: modelAsset.localPath,
          src: "asset://deleted-during-restore.png",
        },
      ],
      selectedModelId: modelAsset.id,
    });

    await waitFor(() => expect(localAssetPort.listAssets).toHaveBeenCalledTimes(1));
    const modelButton = screen.getByRole("button", { name: `选择模特 ${modelAsset.originalName}` });
    await user.hover(modelButton);
    await user.click(screen.getByRole("button", { name: `删除模特 ${modelAsset.originalName}` }));

    await act(async () => {
      resolveList({ items: [modelAsset], page: 1, pageSize: 100, total: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: `选择模特 ${modelAsset.originalName}` })).not.toBeInTheDocument();
  });

  it("keeps edits made while an uploaded model is being deleted", async () => {
    const user = userEvent.setup();
    const modelImage = {
      assetId: "asset_model_pending_delete",
      id: "asset_model_pending_delete",
      name: "待删除模特.png",
      path: "/workspace/current/assets/model/pending-delete.png",
      src: "asset://localhost/workspace/current/assets/model/pending-delete.png",
    };
    let resolveDelete: () => void = () => {};
    deleteAssetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    renderPanel({
      aiModelAppearance: "删除前描述",
      modelImages: [modelImage],
      selectedModelId: modelImage.id,
    });

    const modelButton = screen.getByRole("button", { name: "选择模特 待删除模特.png" });
    await user.hover(modelButton);
    await user.click(screen.getByRole("button", { name: "删除模特 待删除模特.png" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    const appearanceInput = screen.getByRole("textbox", { name: "外貌细节" });
    await user.clear(appearanceInput);
    await user.type(appearanceInput, "删除期间的新描述");

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    expect(screen.getByRole("textbox", { name: "外貌细节" })).toHaveValue("删除期间的新描述");
    await user.click(screen.getByRole("button", { name: "模特库" }));
    expect(screen.queryByRole("button", { name: "选择模特 待删除模特.png" })).not.toBeInTheDocument();
  });

  it("imports uploaded model images immediately and shows their full-body preview tooltip", async () => {
    const user = userEvent.setup();
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/uploaded-model.png",
        name: "uploaded-model.png",
        path: "/Users/demo/Pictures/uploaded-model.png",
        src: "asset://localhost//Users/demo/Pictures/uploaded-model.png",
      },
    ]);
    importImagesMock.mockResolvedValue([
      {
        createdAt: "2026-07-09T00:00:00.000Z",
        id: "asset_model_imported",
        kind: "model",
        lifecycle: "staged",
        localPath: "/workspace/current/assets/model/imported-model.png",
        mimeType: "image/png",
        name: "asset-model.png",
        originalName: "uploaded-model.png",
        relativePath: "assets/model/imported-model.png",
        sha256: "sha256-imported-model",
        sizeBytes: 128,
        thumbnailPath: "/workspace/current/assets/thumbnail/imported-model-320.png",
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);

    renderPanel();

    await user.click(screen.getByRole("button", { name: "上传新模特" }));

    expect(localAssetPort.importImages).toHaveBeenCalledWith({
      kind: "model",
      paths: ["/Users/demo/Pictures/uploaded-model.png"],
    });
    const uploadedModel = await screen.findByRole("button", { name: "选择模特 uploaded-model.png" });
    expect(within(uploadedModel).getByAltText("uploaded-model.png")).toHaveAttribute(
      "src",
      "asset://localhost//workspace/current/assets/thumbnail/imported-model-320.png",
    );

    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(uploadedModel);
      act(() => {
        vi.advanceTimersByTime(450);
      });

      const tooltip = screen.getByRole("tooltip", { name: "uploaded-model.png 全身照预览" });
      expect(within(tooltip).getByAltText("uploaded-model.png 全身照")).toHaveAttribute(
        "src",
        "asset://localhost//workspace/current/assets/model/imported-model.png",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps current edits and model selection while an uploaded model import is pending", async () => {
    const user = userEvent.setup();
    const selectedModel = {
      assetId: "asset_model_selected_while_importing",
      id: "asset_model_selected_while_importing",
      name: "导入期间选择的模特.png",
      path: "/workspace/current/assets/model/selected-while-importing.png",
      src: "asset://localhost//workspace/current/assets/model/selected-while-importing.png",
    };
    const restoredImportedModel = {
      assetId: "asset_model_import_pending",
      id: "asset_model_import_pending",
      name: "已恢复的导入模特.png",
      path: "/workspace/current/assets/model/import-pending.png",
      src: "asset://localhost//workspace/current/assets/model/import-pending.png",
    };
    let resolveImport: (assets: Awaited<ReturnType<typeof localAssetPort.importImages>>) => void =
      () => {};
    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/import-pending.png",
        name: "import-pending.png",
        path: "/Users/demo/Pictures/import-pending.png",
        src: "asset://localhost//Users/demo/Pictures/import-pending.png",
      },
    ]);
    importImagesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );

    renderPanel({
      modelImages: [selectedModel, restoredImportedModel],
      selectedModelId: restoredImportedModel.id,
    });

    await user.click(screen.getByRole("button", { name: "上传新模特" }));
    await waitFor(() => expect(localAssetPort.importImages).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.click(screen.getByRole("button", { name: `选择模特 ${selectedModel.name}` }));

    await act(async () => {
      resolveImport([
        {
          createdAt: "2026-07-09T00:00:00.000Z",
          id: restoredImportedModel.assetId,
          kind: "model",
          lifecycle: "staged",
          localPath: restoredImportedModel.path,
          mimeType: "image/png",
          name: "import-pending.png",
          originalName: restoredImportedModel.name,
          relativePath: "assets/model/import-pending.png",
          sha256: "sha256-import-pending",
          sizeBytes: 128,
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ]);
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: `选择模特 ${selectedModel.name}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getAllByRole("button", { name: `选择模特 ${restoredImportedModel.name}` }),
    ).toHaveLength(1);
  });

  it("generates a base model with a pending transition and favorite toggle", async () => {
    const user = userEvent.setup();
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_1",
      id: "generated-base-model-1",
      name: "基准模特图",
      path: "/workspace/current/assets/generated/generated-model.png",
      src: "asset://localhost//workspace/current/assets/generated/generated-model.png",
      status: "ready",
    };
    let resolveGeneration: (image: GeneratedBaseModelImage) => void = () => {};
    const onGenerateBaseModel = vi.fn(
      () =>
        new Promise<GeneratedBaseModelImage>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    importImagesMock.mockResolvedValue([
      {
        createdAt: "2026-07-09T00:00:00.000Z",
        id: "asset_model_favorited",
        kind: "model",
        lifecycle: "staged",
        localPath: "/workspace/current/assets/model/generated-model.png",
        mimeType: "image/png",
        name: "asset-model.png",
        originalName: "基准模特图",
        relativePath: "assets/model/generated-model.png",
        sha256: "sha256-favorited-model",
        sizeBytes: 128,
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    ]);

    renderPanel(
      {
        aiModelAppearance: "寸头，肌肉身材",
        modelMode: "ai",
      },
      { onGenerateBaseModel },
    );

    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    expect(onGenerateBaseModel).toHaveBeenCalledWith({
      age: "青年",
      appearance: "寸头，肌肉身材",
      body: "匀称",
      ethnicity: "中国人",
      gender: "男",
    });
    expect(screen.getByText("正在生成基准模特...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成基准模特" })).toBeDisabled();

    await act(async () => {
      resolveGeneration(generatedModel);
      await Promise.resolve();
    });

    const modelCard = await screen.findByRole("button", { name: "选择生成模特 基准模特图" });
    expect(within(modelCard).getByAltText("基准模特图")).toHaveAttribute(
      "src",
      "asset://localhost//workspace/current/assets/generated/generated-model.png",
    );

    await user.hover(modelCard);
    expect(await screen.findByRole("button", { name: "收藏基准模特图" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收藏基准模特图" }));

    expect(localAssetPort.importImages).toHaveBeenCalledWith({
      kind: "model",
      paths: ["/workspace/current/assets/generated/generated-model.png"],
    });
    expect(await screen.findByRole("button", { name: "取消收藏基准模特图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 生成" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "取消收藏基准模特图" }));

    expect(localAssetPort.deleteAsset).toHaveBeenCalledWith("asset_model_favorited");
    expect(await screen.findByRole("button", { name: "收藏基准模特图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 生成" })).toHaveAttribute("aria-pressed", "true");
  });

  it("disables scene planning while base model generation is pending", async () => {
    const user = userEvent.setup();
    const onGenerateBaseModel = vi.fn(() => new Promise<GeneratedBaseModelImage>(() => {}));
    const onGenerateScenes = vi.fn();
    const existingModel: GeneratedBaseModelImage = {
      id: "generated-base-model-existing",
      name: "已有基准模特",
      path: "/workspace/current/assets/generated/existing-model.png",
      src: "asset://localhost//workspace/current/assets/generated/existing-model.png",
      status: "ready",
    };

    renderPanel(
      {
        aiRecommended: true,
        clothingImages: [
          {
            id: "clothing-1",
            name: "dress.png",
            path: "/workspace/current/assets/source/dress.png",
            src: "asset://localhost//workspace/current/assets/source/dress.png",
          },
        ],
        generatedBaseModelImages: [existingModel],
        modelMode: "ai",
        selectedModelId: existingModel.id,
      },
      { onGenerateBaseModel, onGenerateScenes },
    );

    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    const scenePlanningButton = screen.getByRole("button", { name: "开始生成" });
    expect(scenePlanningButton).toBeDisabled();
    fireEvent.click(scenePlanningButton);
    expect(onGenerateScenes).not.toHaveBeenCalled();
  });

  it("keeps the selected plus-size label when requesting a base model", async () => {
    const user = userEvent.setup();
    const onGenerateBaseModel = vi.fn(() => new Promise<GeneratedBaseModelImage>(() => {}));

    renderPanel({ modelMode: "ai" }, { onGenerateBaseModel });

    expect(screen.getByRole("button", { name: "体型 匀称" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "体型 匀称" }));
    await user.click(screen.getByRole("option", { name: "大码" }));
    await user.click(screen.getByRole("button", { name: "生成基准模特" }));

    expect(onGenerateBaseModel).toHaveBeenCalledWith({
      age: "青年",
      appearance: "",
      body: "大码",
      ethnicity: "中国人",
      gender: "男",
    });
  });

  it("keeps edits made while a generated model is being favorited", async () => {
    const user = userEvent.setup();
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_pending_favorite",
      id: "generated-base-model-pending-favorite",
      name: "待收藏基准模特",
      path: "/workspace/current/assets/generated/pending-favorite.png",
      src: "asset://localhost/workspace/current/assets/generated/pending-favorite.png",
      status: "ready",
    };
    let resolveImport: (assets: Awaited<ReturnType<typeof localAssetPort.importImages>>) => void = () => {};
    importImagesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );

    renderPanel({
      aiModelAppearance: "收藏前描述",
      generatedBaseModelImages: [generatedModel],
      modelMode: "ai",
      selectedModelId: generatedModel.id,
    });

    const modelCard = screen.getByRole("button", { name: "选择生成模特 待收藏基准模特" });
    await user.hover(modelCard);
    await user.click(screen.getByRole("button", { name: "收藏待收藏基准模特" }));
    const appearanceInput = screen.getByRole("textbox", { name: "外貌细节" });
    await user.clear(appearanceInput);
    await user.type(appearanceInput, "收藏期间的新描述");

    await act(async () => {
      resolveImport([
        {
          createdAt: "2026-07-09T00:00:00.000Z",
          id: "asset_favorited_pending",
          kind: "model",
          lifecycle: "staged",
          localPath: "/workspace/current/assets/model/pending-favorite.png",
          mimeType: "image/png",
          name: "pending-favorite.png",
          originalName: "待收藏基准模特",
          relativePath: "assets/model/pending-favorite.png",
          sha256: "sha256-pending-favorite",
          sizeBytes: 128,
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ]);
      await Promise.resolve();
    });

    expect(screen.getByRole("textbox", { name: "外貌细节" })).toHaveValue("收藏期间的新描述");
    expect(await screen.findByRole("button", { name: "取消收藏待收藏基准模特" })).toBeInTheDocument();
  });

  it("keeps edits made while a generated model favorite is being removed", async () => {
    const user = userEvent.setup();
    const favoritedModelImage = {
      assetId: "asset_model_pending_unfavorite",
      id: "asset_model_pending_unfavorite",
      name: "已收藏基准模特",
      path: "/workspace/current/assets/model/pending-unfavorite.png",
      src: "asset://localhost/workspace/current/assets/model/pending-unfavorite.png",
    };
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_pending_unfavorite",
      favoritedModelImage,
      id: "generated-base-model-pending-unfavorite",
      name: "待取消收藏基准模特",
      path: "/workspace/current/assets/generated/pending-unfavorite.png",
      src: "asset://localhost/workspace/current/assets/generated/pending-unfavorite.png",
      status: "ready",
    };
    let resolveDelete: () => void = () => {};
    deleteAssetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    renderPanel({
      aiModelAppearance: "取消收藏前描述",
      generatedBaseModelImages: [generatedModel],
      modelImages: [favoritedModelImage],
      modelMode: "ai",
      selectedModelId: generatedModel.id,
    });

    const modelCard = screen.getByRole("button", { name: "选择生成模特 待取消收藏基准模特" });
    await user.hover(modelCard);
    await user.click(screen.getByRole("button", { name: "取消收藏待取消收藏基准模特" }));
    const appearanceInput = screen.getByRole("textbox", { name: "外貌细节" });
    await user.clear(appearanceInput);
    await user.type(appearanceInput, "取消收藏期间的新描述");

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    expect(screen.getByRole("textbox", { name: "外貌细节" })).toHaveValue("取消收藏期间的新描述");
    expect(await screen.findByRole("button", { name: "收藏待取消收藏基准模特" })).toBeInTheDocument();
  });

  it("guards one generated model from overlapping favorite requests", async () => {
    const user = userEvent.setup();
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_guard_favorite",
      id: "generated-base-model-guard-favorite",
      name: "并发收藏基准模特",
      path: "/workspace/current/assets/generated/guard-favorite.png",
      src: "asset://localhost/workspace/current/assets/generated/guard-favorite.png",
      status: "ready",
    };
    importImagesMock.mockImplementation(() => new Promise(() => {}));

    renderPanel({
      generatedBaseModelImages: [generatedModel],
      modelMode: "ai",
      selectedModelId: generatedModel.id,
    });

    const modelCard = screen.getByRole("button", { name: "选择生成模特 并发收藏基准模特" });
    await user.hover(modelCard);
    await user.click(screen.getByRole("button", { name: "收藏并发收藏基准模特" }));

    const pendingButton = screen.getByRole("button", { name: "正在收藏并发收藏基准模特" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(pendingButton);
    expect(localAssetPort.importImages).toHaveBeenCalledTimes(1);
  });

  it("guards one generated model from overlapping unfavorite requests", async () => {
    const user = userEvent.setup();
    const favoritedModelImage = {
      assetId: "asset_model_guard_unfavorite",
      id: "asset_model_guard_unfavorite",
      name: "已收藏并发基准模特",
      path: "/workspace/current/assets/model/guard-unfavorite.png",
      src: "asset://localhost/workspace/current/assets/model/guard-unfavorite.png",
    };
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_guard_unfavorite",
      favoritedModelImage,
      id: "generated-base-model-guard-unfavorite",
      name: "并发取消收藏基准模特",
      path: "/workspace/current/assets/generated/guard-unfavorite.png",
      src: "asset://localhost/workspace/current/assets/generated/guard-unfavorite.png",
      status: "ready",
    };
    deleteAssetMock.mockImplementation(() => new Promise(() => {}));

    renderPanel({
      generatedBaseModelImages: [generatedModel],
      modelImages: [favoritedModelImage],
      modelMode: "ai",
      selectedModelId: generatedModel.id,
    });

    const modelCard = screen.getByRole("button", { name: "选择生成模特 并发取消收藏基准模特" });
    await user.hover(modelCard);
    await user.click(screen.getByRole("button", { name: "取消收藏并发取消收藏基准模特" }));

    const pendingButton = screen.getByRole("button", { name: "正在取消收藏并发取消收藏基准模特" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(pendingButton);
    expect(localAssetPort.deleteAsset).toHaveBeenCalledTimes(1);
  });

  it("merges a completed base model into the latest config without reverting edits", async () => {
    const user = userEvent.setup();
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_latest",
      id: "generated-base-model-latest",
      name: "新基准模特图",
      path: "/workspace/current/assets/generated/generated-model-latest.png",
      src: "asset://localhost//workspace/current/assets/generated/generated-model-latest.png",
      status: "ready",
    };
    let resolveGeneration: (image: GeneratedBaseModelImage) => void = () => {};
    const onGenerateBaseModel = vi.fn(
      () =>
        new Promise<GeneratedBaseModelImage>((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    renderPanel(
      {
        aiModelAppearance: "生成前描述",
        modelMode: "ai",
      },
      { onGenerateBaseModel },
    );

    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    const appearanceInput = screen.getByRole("textbox", { name: "外貌细节" });
    await user.clear(appearanceInput);
    await user.type(appearanceInput, "生成期间的新描述");

    await act(async () => {
      resolveGeneration(generatedModel);
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: "选择生成模特 新基准模特图" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "外貌细节" })).toHaveValue("生成期间的新描述");
  });

  it("does not replace a model selected while base model generation is pending", async () => {
    const user = userEvent.setup();
    const firstModel: GeneratedBaseModelImage = {
      id: "generated-base-model-first",
      name: "已有模特一",
      path: "/workspace/current/assets/generated/existing-model-1.png",
      src: "asset://localhost//workspace/current/assets/generated/existing-model-1.png",
      status: "ready",
    };
    const secondModel: GeneratedBaseModelImage = {
      id: "generated-base-model-second",
      name: "已有模特二",
      path: "/workspace/current/assets/generated/existing-model-2.png",
      src: "asset://localhost//workspace/current/assets/generated/existing-model-2.png",
      status: "ready",
    };
    const generatedModel: GeneratedBaseModelImage = {
      id: "generated-base-model-new",
      name: "新生成模特",
      path: "/workspace/current/assets/generated/new-model.png",
      src: "asset://localhost//workspace/current/assets/generated/new-model.png",
      status: "ready",
    };
    let resolveGeneration: (image: GeneratedBaseModelImage) => void = () => {};
    const onGenerateBaseModel = vi.fn(
      () =>
        new Promise<GeneratedBaseModelImage>((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    renderPanel(
      {
        generatedBaseModelImages: [firstModel, secondModel],
        modelMode: "ai",
        selectedModelId: firstModel.id,
      },
      { onGenerateBaseModel },
    );

    await user.click(screen.getByRole("button", { name: "生成基准模特" }));
    await user.click(screen.getByRole("button", { name: "选择生成模特 已有模特二" }));

    await act(async () => {
      resolveGeneration(generatedModel);
      await Promise.resolve();
    });

    await screen.findByRole("button", { name: "选择生成模特 新生成模特" });
    expect(screen.getByRole("button", { name: "选择生成模特 已有模特二" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "选择生成模特 新生成模特" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows delayed full-body preview tooltip for generated base models", async () => {
    const generatedModel: GeneratedBaseModelImage = {
      assetId: "asset_generated_model_1",
      id: "generated-base-model-1",
      name: "基准模特图",
      path: "/workspace/current/assets/generated/generated-model.png",
      src: "asset://localhost//workspace/current/assets/generated/generated-model.png",
      status: "ready",
    };

    renderPanel({
      generatedBaseModelImages: [generatedModel],
      modelMode: "ai",
      selectedModelId: generatedModel.id,
    });

    const modelCard = screen.getByRole("button", { name: "选择生成模特 基准模特图" });
    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.mouseEnter(modelCard);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(450);
      });

      const tooltip = screen.getByRole("tooltip", { name: "基准模特图 全身照预览" });
      expect(tooltip).toHaveClass("fixed", "z-[130]");
      expect(within(tooltip).getByAltText("基准模特图 全身照")).toHaveAttribute(
        "src",
        "asset://localhost//workspace/current/assets/generated/generated-model.png",
      );

      fireEvent.mouseLeave(modelCard);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

function renderPanel(
  configPatch: Partial<ClothingConfigState> = {},
  props: Partial<ComponentProps<typeof ClothingConfigPanel>> = {},
) {
  function Harness() {
    const [config, setConfig] = useState<ClothingConfigState>({
      ...defaultClothingConfig,
      ...configPatch,
    });

    return (
      <ToastProvider>
        <ClothingConfigPanel
          baseModelGenerationSessionId={props.baseModelGenerationSessionId ?? 0}
          config={config}
          onChange={setConfig}
          onGenerateBaseModel={props.onGenerateBaseModel ?? vi.fn()}
          onGenerateScenes={props.onGenerateScenes ?? vi.fn()}
        />
      </ToastProvider>
    );
  }

  return render(<Harness />);
}
