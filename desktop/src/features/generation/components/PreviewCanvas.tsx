import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Languages,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Minus,
  Plus,
  Trash2,
  Type,
  WandSparkles,
  X,
} from "lucide-react";
import { cn } from "../../../shared/lib/cn";
import type { ProductImageAsset } from "../lib/productImagePicker";

export type PreviewBoard = {
  id: string;
  title: string;
  icon: LucideIcon;
  tone: "light" | "blue" | "dark";
};

type PreviewCanvasProps = {
  boards: PreviewBoard[];
  detailImages?: GeneratedDetailImage[];
};

export type GeneratedDetailImage = {
  errorMessage?: string;
  groupId?: string;
  groupTitle?: string;
  id: string;
  kind?: "image" | "listing-copy" | "source-image";
  listingCopy?: ProductListingCopy;
  prompt?: string;
  ratio?: string;
  sourceImages?: ProductImageAsset[];
  src?: string;
  status: "generating" | "complete" | "failed";
  title: string;
};

export type ProductListingCopy = {
  detailCopy: string;
  keywords: string;
  sellingPoints: string[];
  shootingPlan: string[];
  sourcePrompt: string;
  title: string;
};

export function PreviewCanvas({ boards, detailImages = [] }: PreviewCanvasProps) {
  if (detailImages.length > 0) {
    return <GeneratedDetailCanvas detailImages={detailImages} />;
  }

  return (
    <main
      aria-label="生成预览画布"
      className="desktop-grain relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_50%_26%,rgba(255,255,255,0.98),rgba(244,247,251,0.93)_42%,rgba(232,237,244,0.86))]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.78),transparent_24%,transparent_76%,rgba(255,255,255,0.78))]" />
      <div className="absolute left-1/2 top-[39%] h-[420px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-100/30 blur-3xl" />
      <section className="relative flex h-full flex-col items-center justify-center px-10">
        <div className="mb-10 text-center">
          <div className="text-[34px] font-bold tracking-normal text-slate-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            A+ / 详情页
          </div>
          <p className="mt-3 text-[14px] text-app-muted drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
            上传商品图，AI 即刻生成
            <span className="mx-1 text-app-blue">符合多平台规范</span>
            的专业详情页。
          </p>
        </div>

        <div className="desktop-raised relative flex items-center gap-5 rounded-[24px] border border-white/90 bg-white/70 p-5 backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white" />
          <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.7),transparent_52%)]" />
          <div className="grid gap-2">
            {boards.slice(0, 2).map((board) => (
              <PreviewTile key={board.id} board={board} size="small" />
            ))}
          </div>
          <ArrowRight className="relative size-7 text-slate-300 drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]" />
          <div className="grid grid-cols-[80px_150px_150px] gap-2">
            {boards.map((board, index) => (
              <PreviewTile key={board.id} board={board} size={index === 0 ? "tall" : "wide"} />
            ))}
          </div>
        </div>
      </section>
      <button
        className="absolute bottom-5 right-5 grid size-9 place-items-center rounded-full border border-white/80 bg-white/80 text-[13px] font-semibold text-app-text shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_6px_16px_rgba(15,23,42,0.1)] backdrop-blur-xl transition-all duration-200 hover:bg-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.12)] active:scale-95"
        type="button"
      >
        ?
      </button>
    </main>
  );
}

function GeneratedDetailCanvas({ detailImages }: { detailImages: GeneratedDetailImage[] }) {
  const [removedImageIds, setRemovedImageIds] = useState<Set<string>>(() => new Set());
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [regeneratingImageIds, setRegeneratingImageIds] = useState<Set<string>>(() => new Set());
  const [imageRewriteTargetId, setImageRewriteTargetId] = useState<string | null>(null);
  const [imageRewritePrompt, setImageRewritePrompt] = useState("");
  const [textEditTargetId, setTextEditTargetId] = useState<string | null>(null);
  const [listingCopyTargetId, setListingCopyTargetId] = useState<string | null>(null);
  const [textEditValues, setTextEditValues] = useState(() => defaultEditableTexts);
  const [longPreviewOpen, setLongPreviewOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const visibleImages = detailImages
    .filter((image) => !removedImageIds.has(image.id))
    .map((image) => (regeneratingImageIds.has(image.id) ? { ...image, status: "generating" as const } : image));
  const visibleImageItems = visibleImages.filter((image) => image.kind !== "listing-copy" && image.kind !== "source-image");
  const groupedResultSections = createGeneratedResultGroups(visibleImages);
  const hasGroupedResults = groupedResultSections.length > 0;
  const completedImages = visibleImageItems.filter((image) => image.status === "complete");
  const selectedImages = completedImages.filter((image) => selectedImageIds.has(image.id));
  const allCompletedSelected = completedImages.length > 0 && completedImages.every((image) => selectedImageIds.has(image.id));
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const previewImage = completedImages.find((image) => image.id === previewImageId) ?? null;
  const previewImageIndex = previewImage ? completedImages.findIndex((image) => image.id === previewImage.id) : -1;
  const imageRewriteTarget = completedImages.find((image) => image.id === imageRewriteTargetId) ?? null;
  const textEditTarget = completedImages.find((image) => image.id === textEditTargetId) ?? null;
  const listingCopyTarget =
    visibleImages.find((image) => image.id === listingCopyTargetId && image.kind === "listing-copy" && image.status === "complete") ??
    null;

  function openImagePreview(image: GeneratedDetailImage) {
    if (image.status !== "complete") {
      return;
    }

    setPreviewImageId(image.id);
    setPreviewZoom(1);
  }

  function closeImagePreview() {
    setPreviewImageId(null);
    setPreviewZoom(1);
  }

  function showAdjacentPreviewImage(direction: -1 | 1) {
    if (previewImageIndex < 0 || completedImages.length === 0) {
      return;
    }

    const nextIndex = (previewImageIndex + direction + completedImages.length) % completedImages.length;
    setPreviewImageId(completedImages[nextIndex].id);
    setPreviewZoom(1);
  }

  function changePreviewZoom(delta: number) {
    setPreviewZoom((zoom) => Math.min(2, Math.max(0.75, zoom + delta)));
  }

  function toggleImageSelection(imageId: string, selected: boolean) {
    setSelectedImageIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (selected) {
        nextIds.add(imageId);
      } else {
        nextIds.delete(imageId);
      }
      return nextIds;
    });
  }

  function toggleAllCompletedImages(selected: boolean) {
    setSelectedImageIds(selected ? new Set(completedImages.map((image) => image.id)) : new Set());
  }

  function toggleGeneratedGroupSelection(images: GeneratedDetailImage[], selected: boolean) {
    const groupImageIds = images
      .filter((image) => image.kind !== "source-image" && image.kind !== "listing-copy" && image.status === "complete")
      .map((image) => image.id);

    setSelectedImageIds((currentIds) => {
      const nextIds = new Set(currentIds);
      for (const imageId of groupImageIds) {
        if (selected) {
          nextIds.add(imageId);
        } else {
          nextIds.delete(imageId);
        }
      }
      return nextIds;
    });
  }

  function deleteSelectedImages() {
    if (selectedImageIds.size === 0) {
      return;
    }

    setRemovedImageIds((currentIds) => new Set([...currentIds, ...selectedImageIds]));
    setSelectedImageIds(new Set());
    if (previewImageId && selectedImageIds.has(previewImageId)) {
      closeImagePreview();
    }
  }

  function deleteImageById(imageId: string) {
    setRemovedImageIds((currentIds) => new Set([...currentIds, imageId]));
    setSelectedImageIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(imageId);
      return nextIds;
    });
    if (previewImageId === imageId) {
      closeImagePreview();
    }
  }

  function openImageRewriteDialog(image: GeneratedDetailImage) {
    setImageRewriteTargetId(image.id);
    setImageRewritePrompt("");
  }

  function closeImageRewriteDialog() {
    setImageRewriteTargetId(null);
    setImageRewritePrompt("");
  }

  function regenerateImageById(targetId: string) {
    setRegeneratingImageIds((currentIds) => new Set([...currentIds, targetId]));
    setSelectedImageIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(targetId);
      return nextIds;
    });
    if (previewImageId === targetId) {
      closeImagePreview();
    }

    window.setTimeout(() => {
      setRegeneratingImageIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(targetId);
        return nextIds;
      });
    }, 3000);
  }

  function regenerateImage() {
    if (!imageRewriteTargetId) {
      return;
    }

    regenerateImageById(imageRewriteTargetId);
    closeImageRewriteDialog();
  }

  function openTextEditDialog(image: GeneratedDetailImage) {
    setTextEditTargetId(image.id);
    setTextEditValues(defaultEditableTexts);
  }

  function openListingCopyDialog(image: GeneratedDetailImage) {
    if (image.kind !== "listing-copy" || image.status !== "complete") {
      return;
    }

    setListingCopyTargetId(image.id);
  }

  function closeListingCopyDialog() {
    setListingCopyTargetId(null);
  }

  function showCopyToast(message: string) {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  }

  async function copyProductListingCopy(copy: ProductListingCopy) {
    const clipboard = window.navigator?.clipboard;
    if (!clipboard?.writeText) {
      showCopyToast("当前环境不支持复制");
      return;
    }

    try {
      await clipboard.writeText(formatProductListingCopy(copy));
      showCopyToast("已复制商品上架文案");
    } catch {
      showCopyToast("复制失败，请重试");
    }
  }

  function closeTextEditDialog() {
    setTextEditTargetId(null);
    setTextEditValues(defaultEditableTexts);
  }

  function updateTextEditValue(index: number, value: string) {
    setTextEditValues((currentValues) => currentValues.map((currentValue, currentIndex) => (currentIndex === index ? value : currentValue)));
  }

  function confirmTextEdit() {
    if (!textEditTargetId) {
      return;
    }

    regenerateImageById(textEditTargetId);
    closeTextEditDialog();
  }

  useEffect(() => {
    if (!detailImages.some((image) => image.status === "generating")) {
      return;
    }

    setRemovedImageIds(new Set());
    setSelectedImageIds(new Set());
    setRegeneratingImageIds(new Set());
    setImageRewriteTargetId(null);
    setImageRewritePrompt("");
    setTextEditTargetId(null);
    setListingCopyTargetId(null);
    setTextEditValues(defaultEditableTexts);
    setLongPreviewOpen(false);
    setPreviewImageId(null);
    setPreviewZoom(1);
  }, [detailImages]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  async function saveBytes(defaultPath: string, bytes: Uint8Array, extension: string) {
    const path = await save({
      defaultPath,
      filters: [{ extensions: [extension], name: extension.toUpperCase() }],
    });
    if (!path) {
      return;
    }

    await invoke("save_generated_asset", {
      bytes: Array.from(bytes),
      path,
    });
  }

  async function downloadImage(image: GeneratedDetailImage, index: number) {
    const bytes = await blobToBytes(await createGeneratedImageBlob(image, index));
    await saveBytes(`${sanitizeFilename(image.title)}.png`, bytes, "png");
  }

  async function downloadLongImage() {
    const bytes = await blobToBytes(await createLongImageBlob(completedImages));
    await saveBytes(`${generatedResultFilePrefix}-长图.png`, bytes, "png");
  }

  async function downloadImagesZip(images: GeneratedDetailImage[], zipLabel: string) {
    if (images.length === 0) {
      return;
    }

    const files = await Promise.all(
      images.map(async (image, index) => ({
        bytes: await blobToBytes(await createGeneratedImageBlob(image, index)),
        name: `${String(index + 1).padStart(2, "0")}-${sanitizeFilename(image.title)}.png`,
      })),
    );
    await saveBytes(`${generatedResultFilePrefix}-${zipLabel}.zip`, createZipBytes(files), "zip");
  }

  function renderGeneratedResultCard(image: GeneratedDetailImage) {
    if (image.kind === "source-image") {
      return <GeneratedSourceImageCard image={image} key={image.id} />;
    }

    if (image.status === "failed") {
      return (
        <GeneratedFailedResultCard
          image={image}
          key={image.id}
          onDelete={() => deleteImageById(image.id)}
          onRetry={() => regenerateImageById(image.id)}
          onSelect={(selected) => toggleImageSelection(image.id, selected)}
          selected={selectedImageIds.has(image.id)}
        />
      );
    }

    if (image.kind === "listing-copy") {
      return (
        <GeneratedListingCopyCard
          image={image}
          key={image.id}
          onCopy={(copy) => void copyProductListingCopy(copy)}
          onOpen={() => openListingCopyDialog(image)}
        />
      );
    }

    const imageIndex = visibleImageItems.findIndex((visibleImage) => visibleImage.id === image.id);

    return (
      <GeneratedDetailImageCard
        image={image}
        index={imageIndex}
        key={image.id}
        onOpenPreview={openImagePreview}
        onSelect={(selected) => toggleImageSelection(image.id, selected)}
        onDownload={() => void downloadImage(image, imageIndex)}
        onRewrite={() => openImageRewriteDialog(image)}
        onEditText={() => openTextEditDialog(image)}
        selected={selectedImageIds.has(image.id)}
      />
    );
  }

  useEffect(() => {
    const visibleImageIds = new Set(visibleImages.map((image) => image.id));
    setSelectedImageIds((currentIds) => {
      const nextIds = new Set([...currentIds].filter((imageId) => visibleImageIds.has(imageId)));
      return nextIds.size === currentIds.size ? currentIds : nextIds;
    });
  }, [detailImages, removedImageIds]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showAdjacentPreviewImage(-1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        showAdjacentPreviewImage(1);
      }

      if (event.key === "Escape") {
        closeImagePreview();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [completedImages, previewImage, previewImageIndex]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function handleGestureChange(event: Event) {
      const gestureEvent = event as Event & { scale?: number };
      event.preventDefault();
      if (!gestureEvent.scale || gestureEvent.scale === 1) {
        return;
      }

      changePreviewZoom(gestureEvent.scale > 1 ? 0.25 : -0.25);
    }

    window.addEventListener("gesturechange", handleGestureChange, { passive: false });

    return () => window.removeEventListener("gesturechange", handleGestureChange);
  }, [previewImage]);

  return (
    <main
      aria-label="生成预览画布"
      className="relative min-h-0 overflow-hidden bg-[#f5f6f8]"
    >
      <section className="relative h-full overflow-y-auto px-10 py-8 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-slate-950">生成结果:</h1>
            <div className={cn("mt-7 flex items-center gap-2 text-[13px] font-medium text-slate-700", hasGroupedResults && "hidden")}>
              <input
                aria-label="选择本次生成结果"
                className="size-3.5 rounded-[4px] border-slate-300 text-app-blue focus:ring-app-blue/20"
                type="checkbox"
              />
              <span>2026-06-29 15:52</span>
              <Pencil className="size-3.5 text-slate-500" />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-8">
            <div className="flex min-h-7 items-center gap-2" data-testid="generated-detail-bulk-actions">
              {selectedImageIds.size > 0 ? (
                <>
                  <button
                    aria-label="删除所选图片"
                    className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-white px-2.5 text-[12px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-slate-50"
                    onClick={deleteSelectedImages}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </button>
                  {selectedImages.length > 0 ? (
                    <button
                      aria-label="批量下载所选图片"
                      className="inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-[#1f1f21] px-2.5 text-[12px] font-medium text-white shadow-[0_4px_12px_rgba(15,23,42,0.16)] transition-colors hover:bg-black"
                      onClick={() => void downloadImagesZip(selectedImages, "已选图片")}
                      type="button"
                    >
                      <Download className="size-3.5" />
                      批量下载
                    </button>
                  ) : null}
                </>
              ) : null}
              <label className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                <input
                  aria-label="全选"
                  checked={allCompletedSelected}
                  className="size-3.5 rounded-[4px] border-slate-300 text-app-blue focus:ring-app-blue/20"
                  onChange={(event) => toggleAllCompletedImages(event.currentTarget.checked)}
                  type="checkbox"
                />
                全选
              </label>
            </div>
            {!hasGroupedResults ? (
              <div className="flex items-center gap-2">
                <button
                  className="h-8 rounded-[8px] bg-white px-3 text-[12px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:bg-slate-50"
                  onClick={() => setLongPreviewOpen(true)}
                  type="button"
                >
                  预览长图
                </button>
                <button
                  aria-label="下载全部"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#1f1f21] px-3 text-[12px] font-medium text-white shadow-[0_4px_12px_rgba(15,23,42,0.18)] transition-colors hover:bg-black"
                  onClick={() => void downloadImagesZip(completedImages, "全部图片")}
                  type="button"
                >
                  <Download className="size-3.5" />
                  下载
                </button>
                <button
                  aria-label="更多生成结果操作"
                  className="grid size-8 place-items-center rounded-[8px] bg-[#1f1f21] text-white shadow-[0_4px_12px_rgba(15,23,42,0.18)] transition-colors hover:bg-black"
                  type="button"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {hasGroupedResults ? (
          <div className="space-y-10">
            {groupedResultSections.map((group) => {
              const groupCompletedImages = group.images.filter(
                (image) => image.kind !== "source-image" && image.kind !== "listing-copy" && image.status === "complete",
              );
              const allGroupImagesSelected =
                groupCompletedImages.length > 0 && groupCompletedImages.every((image) => selectedImageIds.has(image.id));

              return (
                <section className="space-y-4" data-testid="generated-result-group" key={group.id}>
                  <div className="flex items-center justify-between gap-4">
                    <label className="inline-flex min-w-0 items-center gap-2 text-[13px] font-semibold text-slate-700">
                      <input
                        aria-label={`选择 ${group.title} 分组`}
                        checked={allGroupImagesSelected}
                        className="size-3.5 rounded-[4px] border-slate-300 text-app-blue focus:ring-app-blue/20"
                        disabled={groupCompletedImages.length === 0}
                        onChange={(event) => toggleGeneratedGroupSelection(group.images, event.currentTarget.checked)}
                        type="checkbox"
                      />
                      <span className="shrink-0">2026-06-30 16:53</span>
                      <span className="truncate">{group.title}</span>
                      <Pencil className="size-3.5 shrink-0 text-slate-500" />
                    </label>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        aria-label={`下载 ${group.title}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#1f1f21] px-3 text-[12px] font-medium text-white shadow-[0_4px_12px_rgba(15,23,42,0.18)] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                        disabled={groupCompletedImages.length === 0}
                        onClick={() => void downloadImagesZip(groupCompletedImages, group.title)}
                        type="button"
                      >
                        <Download className="size-3.5" />
                        下载
                      </button>
                      <button
                        aria-label={`更多 ${group.title} 操作`}
                        className="grid size-8 place-items-center rounded-[8px] bg-[#1f1f21] text-white shadow-[0_4px_12px_rgba(15,23,42,0.18)] transition-colors hover:bg-black"
                        type="button"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                    {group.images.map((image) => renderGeneratedResultCard(image))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4" data-testid="generated-result-grid">
            {visibleImages.map((image) => renderGeneratedResultCard(image))}
          </div>
        )}
      </section>
      {toastMessage ? (
        <div
          className="fixed left-1/2 top-[72px] z-[140] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-[13px] font-medium text-white shadow-[0_12px_30px_rgba(15,23,42,0.22)]"
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}
      {listingCopyTarget?.listingCopy
        ? createPortal(
            <ProductListingCopyDialog
              copy={listingCopyTarget.listingCopy}
              onClose={closeListingCopyDialog}
              onCopy={(copy) => void copyProductListingCopy(copy)}
            />,
            document.body,
          )
        : null}
      {imageRewriteTarget
        ? createPortal(
            <div
              aria-label="输入微调方向"
              aria-modal="true"
              className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/32 p-8 backdrop-blur-[2px]"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeImageRewriteDialog();
                }
              }}
              role="dialog"
            >
              <div className="w-[360px] rounded-[14px] border border-white/80 bg-white p-5 shadow-[0_20px_46px_rgba(15,23,42,0.16),0_8px_18px_rgba(15,23,42,0.08)]">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h2 className="text-[16px] font-semibold text-slate-950">输入微调方向</h2>
                  <button
                    aria-label="关闭微调弹窗"
                    className="grid size-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    onClick={closeImageRewriteDialog}
                    type="button"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <textarea
                  aria-label="输入调整要求"
                  className="h-44 w-full resize-none rounded-[9px] border border-slate-200 bg-white px-3 py-3 text-[14px] leading-7 text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-300"
                  onChange={(event) => setImageRewritePrompt(event.target.value)}
                  placeholder="输入调整要求，空着将默认重绘。如：商品向左移动一点，换成浅灰色背景..."
                  value={imageRewritePrompt}
                />
                <div className="mt-4 flex justify-end">
                  <button
                    aria-label="重新生成 15"
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-control border border-slate-900 bg-[#1f1f21] px-3 text-[13px] font-medium text-white shadow-none transition-colors hover:bg-black"
                    onClick={regenerateImage}
                    type="button"
                  >
                    重新生成
                    <span aria-hidden="true">🔥</span>
                    15
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {textEditTarget
        ? createPortal(
            <div
              aria-label="编辑文字"
              aria-modal="true"
              className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/32 p-8 backdrop-blur-[2px]"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeTextEditDialog();
                }
              }}
              role="dialog"
            >
              <div className="flex max-h-[520px] w-[360px] flex-col rounded-[14px] border border-white/80 bg-white p-5 shadow-[0_20px_46px_rgba(15,23,42,0.16),0_8px_18px_rgba(15,23,42,0.08)]">
                <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
                  <h2 className="text-[16px] font-semibold text-slate-950">编辑文字</h2>
                  <button
                    aria-label="关闭编辑文字"
                    className="grid size-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    onClick={closeTextEditDialog}
                    type="button"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <div className="min-h-0 max-h-72 flex-1 space-y-3 overflow-y-auto pr-2 [scrollbar-color:rgba(148,163,184,0.72)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]">
                  {textEditValues.map((value, index) => (
                    <input
                      aria-label={`编辑文字 ${index + 1}`}
                      className="h-10 w-full rounded-[9px] border border-slate-200 bg-slate-50/70 px-3 text-[14px] text-slate-700 outline-none transition-colors focus:border-app-blue focus:bg-white"
                      key={`${textEditTarget.id}-${index}`}
                      onChange={(event) => updateTextEditValue(index, event.target.value)}
                      value={value}
                    />
                  ))}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="inline-flex h-8 items-center justify-center rounded-control border border-slate-100 bg-slate-100 px-3 text-[13px] font-medium text-slate-800 shadow-none transition-colors hover:bg-slate-200/80"
                    onClick={closeTextEditDialog}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    aria-label="确认改字 15"
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-control border border-slate-900 bg-[#1f1f21] px-3 text-[13px] font-medium text-white shadow-none transition-colors hover:bg-black"
                    onClick={confirmTextEdit}
                    type="button"
                  >
                    确认改字
                    <span aria-hidden="true">🔥</span>
                    15
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {longPreviewOpen
        ? createPortal(
            <div
              aria-label="长图预览"
              aria-modal="true"
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-9 backdrop-blur-sm"
              role="dialog"
            >
              <div className="flex h-[82vh] w-[82vw] max-w-[1180px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-4">
                  <div className="text-[13px] font-medium text-slate-700">生成结果 2026-06-29 15:52:34</div>
                  <div className="flex items-center gap-2">
                    <button
                      aria-label="下载长图"
                      className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-slate-100 px-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
                      onClick={() => void downloadLongImage()}
                      type="button"
                    >
                      <Download className="size-3.5" />
                      下载长图
                    </button>
                    <button
                      aria-label="下载全部图片"
                      className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-slate-100 px-2.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
                      onClick={() => void downloadImagesZip(completedImages, "全部图片")}
                      type="button"
                    >
                      <Download className="size-3.5" />
                      下载全部图片
                    </button>
                    <button
                      aria-label="关闭长图预览"
                      className="grid size-7 place-items-center rounded-[6px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      onClick={() => setLongPreviewOpen(false)}
                      type="button"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-white px-10 py-4">
                  <div className="mx-auto w-full max-w-[620px]">
                    {completedImages.map((image, index) => (
                      <div
                        className={cn(
                          "relative aspect-[970/600] w-full overflow-hidden",
                          generatedImageBackgrounds[index % generatedImageBackgrounds.length],
                        )}
                        data-testid="long-preview-image-section"
                        key={image.id}
                      >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(255,255,255,0.72),transparent_42%)]" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {previewImage
        ? createPortal(
            <div
              aria-label="图片相册预览"
              aria-modal="true"
              className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-8 backdrop-blur-xl"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeImagePreview();
                }
              }}
              role="dialog"
            >
              <div className="absolute left-8 top-7 text-sm font-semibold text-white">
                {previewImageIndex + 1} / {completedImages.length}
              </div>
              <div className="absolute right-8 top-6 flex items-center gap-2">
                <button
                  aria-label="缩小图片"
                  className="grid size-9 place-items-center rounded-full bg-white/12 text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={previewZoom <= 0.75}
                  onClick={() => changePreviewZoom(-0.25)}
                  type="button"
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-14 text-center text-xs font-semibold text-white">{Math.round(previewZoom * 100)}%</span>
                <button
                  aria-label="放大图片"
                  className="grid size-9 place-items-center rounded-full bg-white/12 text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={previewZoom >= 2}
                  onClick={() => changePreviewZoom(0.25)}
                  type="button"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  aria-label="关闭图片预览"
                  className="ml-2 grid size-9 place-items-center rounded-full bg-white/12 text-white backdrop-blur-md transition-colors hover:bg-white/20"
                  onClick={closeImagePreview}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </div>
              <button
                aria-label="上一张图片"
                className="absolute left-8 grid size-11 place-items-center rounded-full bg-white/12 text-white backdrop-blur-md transition-colors hover:bg-white/20"
                onClick={() => showAdjacentPreviewImage(-1)}
                type="button"
              >
                <ChevronLeft className="size-5" />
              </button>
              <div className="relative flex max-h-[82vh] max-w-[78vw] flex-col items-center gap-4">
                <div
                  aria-label={`预览 ${previewImage.title}`}
                  className={cn(
                    "h-[68vh] w-[min(68vh,70vw)] origin-center rounded-[14px] shadow-[0_24px_80px_rgba(0,0,0,0.36)] transition-transform duration-200",
                    generatedImageBackgrounds[Math.max(previewImageIndex, 0) % generatedImageBackgrounds.length],
                  )}
                  onWheel={(event) => {
                    event.preventDefault();
                    changePreviewZoom(event.deltaY < 0 ? 0.25 : -0.25);
                  }}
                  style={{ transform: `scale(${previewZoom})` }}
                >
                  <div className="h-full w-full rounded-[14px] bg-[radial-gradient(circle_at_50%_10%,rgba(255,255,255,0.72),transparent_42%)]" />
                </div>
                <div className="rounded-full bg-black/32 px-4 py-2 text-sm font-medium text-white backdrop-blur-md">
                  {previewImage.title}
                </div>
              </div>
              <button
                aria-label="下一张图片"
                className="absolute right-8 grid size-11 place-items-center rounded-full bg-white/12 text-white backdrop-blur-md transition-colors hover:bg-white/20"
                onClick={() => showAdjacentPreviewImage(1)}
                type="button"
              >
                <ChevronRight className="size-5" />
              </button>
              <div
                className="absolute bottom-7 left-1/2 flex max-w-[72vw] -translate-x-1/2 gap-2 overflow-x-auto rounded-[16px] bg-black/24 p-2 backdrop-blur-xl [scrollbar-width:none]"
                data-testid="image-lightbox-thumbnail-strip"
              >
                {completedImages.map((image, index) => (
                  <button
                    aria-label={`查看缩略图 ${image.title}`}
                    className={cn(
                      "h-14 w-14 shrink-0 overflow-hidden rounded-[10px] border transition-all duration-200",
                      previewImage.id === image.id ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.28)]" : "border-white/20 opacity-70 hover:opacity-100",
                    )}
                    key={image.id}
                    onClick={() => {
                      setPreviewImageId(image.id);
                      setPreviewZoom(1);
                    }}
                    type="button"
                  >
                    <span
                      className={cn("block h-full w-full", generatedImageBackgrounds[index % generatedImageBackgrounds.length])}
                    />
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
      <button
        className="absolute bottom-5 right-5 grid size-9 place-items-center rounded-full border border-white/80 bg-white/80 text-[13px] font-semibold text-app-text shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_6px_16px_rgba(15,23,42,0.1)] backdrop-blur-xl transition-all duration-200 hover:bg-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_rgba(15,23,42,0.12)] active:scale-95"
        type="button"
      >
        ?
      </button>
    </main>
  );
}

function GeneratedSourceImageCard({ image }: { image: GeneratedDetailImage }) {
  const sourceImages = image.sourceImages ?? [];

  return (
    <article
      className="relative aspect-square overflow-hidden rounded-[8px] border-2 border-white/80 bg-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
      data-testid="generated-source-image-card"
    >
      <div className="absolute left-2 top-2 z-10 rounded-[5px] bg-black/64 px-2 py-1 text-[11px] font-semibold leading-none text-white shadow-sm">
        原图
      </div>
      {sourceImages.length > 0 ? (
        <div className={cn("h-full w-full", sourceImages.length === 1 ? "block" : "grid grid-cols-2 gap-px bg-white")}>
          {sourceImages.map((sourceImage) => (
            <img
              alt={sourceImage.name}
              className="h-full w-full object-cover"
              draggable={false}
              key={sourceImage.id}
              src={sourceImage.src}
            />
          ))}
        </div>
      ) : (
        <div className="h-full w-full bg-[linear-gradient(135deg,#f8fafc,#dbe3ee)]" />
      )}
    </article>
  );
}

function GeneratedListingCopyCard({
  image,
  onCopy,
  onOpen,
}: {
  image: GeneratedDetailImage;
  onCopy: (copy: ProductListingCopy) => void;
  onOpen: () => void;
}) {
  const complete = image.status === "complete";
  const copy = image.listingCopy;

  return (
    <article
      className="group relative aspect-square cursor-default overflow-hidden rounded-[8px] border-2 border-white/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all duration-200 hover:shadow-[0_10px_22px_rgba(15,23,42,0.14)]"
      data-testid="listing-copy-result-card"
    >
      {complete && copy ? (
        <div className="flex h-full w-full flex-col bg-white p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-[6px] bg-blue-50 px-1.5 py-1 text-[12px] font-medium leading-none text-app-blue">
              商品上架文案
            </span>
            <div className="flex items-center gap-2">
              <button
                aria-label="查看商品上架文案"
                className="grid size-7 place-items-center rounded-[7px] text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                onClick={onOpen}
                type="button"
              >
                <Eye className="size-4" />
              </button>
              <button
                aria-label="复制商品上架文案卡片"
                className="grid size-7 place-items-center rounded-[7px] text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                onClick={() => onCopy(copy)}
                type="button"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 h-px bg-slate-100" />
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-hidden">
            <ListingCopyPreviewSection title="宝贝标题" value={copy.title} />
            <ListingCopyPreviewSection title="核心卖点/促销利益点" value={copy.sellingPoints[0] ?? ""} />
            <ListingCopyPreviewSection title="详情页文案" value={copy.detailCopy} />
            <ListingCopyPreviewSection title="搜索关键词/属性词" value={copy.keywords} />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,#eef2f7,#e2e8f0)] text-slate-500">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="size-2.5 animate-pulse rounded-full bg-slate-400" />
              <span className="size-2.5 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
              <span className="size-2.5 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
            </div>
            <span className="text-[13px] font-semibold">AI 生成中</span>
          </div>
        </div>
      )}
    </article>
  );
}

function ListingCopyPreviewSection({ title, value }: { title: string; value: string }) {
  return (
    <section>
      <h3 className="text-[12px] font-semibold leading-5 text-slate-950">{title}</h3>
      <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-400">{value}</p>
    </section>
  );
}

function GeneratedFailedResultCard({
  image,
  onDelete,
  onRetry,
  onSelect,
  selected,
}: {
  image: GeneratedDetailImage;
  onDelete: () => void;
  onRetry: () => void;
  onSelect: (selected: boolean) => void;
  selected: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative aspect-square cursor-default overflow-hidden rounded-[8px] border-2 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all duration-200 hover:border-slate-950/90 hover:shadow-[0_10px_22px_rgba(15,23,42,0.14)]",
        selected ? "border-slate-950" : "border-transparent",
      )}
      data-testid="failed-result-card"
    >
      <div className={cn("absolute left-2 top-2 z-10 transition-opacity duration-200 group-hover:opacity-100", selected ? "opacity-100" : "opacity-0")}>
        <input
          aria-label={`选择 ${image.title}`}
          checked={selected}
          className="size-3.5 rounded-[4px] border-slate-300 bg-white text-app-blue shadow-sm focus:ring-app-blue/20"
          onChange={(event) => onSelect(event.currentTarget.checked)}
          type="checkbox"
        />
      </div>
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <IconActionButton icon={Trash2} label={`删除 ${image.title}`} onClick={onDelete} />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#ffffff_0%,#eeeeef_46%,#a6a6a6_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_13%,rgba(255,255,255,0.72),transparent_42%)]" />
      <div className="relative flex h-full flex-col items-center justify-center px-5 pb-14 pt-8 text-center">
        <div className="grid size-11 place-items-center rounded-full border-[3px] border-slate-500/70 text-[28px] font-semibold leading-none text-slate-500/80">
          !
        </div>
        <h2 className="mt-4 text-[15px] font-medium text-slate-500">生成失败</h2>
      </div>
      <div className="absolute inset-x-2.5 bottom-2.5 translate-y-2 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
        <button
          aria-label={`重试 ${image.title}`}
          className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-[#e4e4e4] px-2 text-[11px] font-medium text-slate-700 transition-colors duration-300 ease-out hover:bg-[#3f3f3f] hover:text-white"
          onClick={onRetry}
          type="button"
        >
          重新生成
        </button>
      </div>
    </article>
  );
}

function ProductListingCopyDialog({
  copy,
  onClose,
  onCopy,
}: {
  copy: ProductListingCopy;
  onClose: () => void;
  onCopy: (copy: ProductListingCopy) => void;
}) {
  return (
    <div
      aria-label="商品上架文案"
      aria-modal="true"
      className="fixed inset-0 z-[115] flex items-center justify-center bg-black/42 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="flex max-h-[88vh] w-[min(96vw,1120px)] flex-col rounded-[26px] bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
        <header className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <h2 className="text-[18px] font-semibold text-slate-950">商品上架文案</h2>
          <div className="flex items-center gap-2">
            <button
              aria-label="翻译"
              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-slate-100 px-4 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-200/80"
              type="button"
            >
              <Languages className="size-4" />
              翻译
              <span className="relative h-5 w-9 rounded-full bg-white shadow-inner">
                <span className="absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.22)]" />
              </span>
            </button>
            <button
              aria-label="复制商品上架文案"
              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-slate-100 px-4 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-200/80"
              onClick={() => onCopy(copy)}
              type="button"
            >
              <Copy className="size-4" />
              复制
            </button>
            <button
              aria-label="关闭商品上架文案"
              className="grid size-9 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              onClick={onClose}
              type="button"
            >
              <X className="size-6" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-[18px] bg-slate-100 px-5 py-4 text-slate-700 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.48)_transparent]">
          <ListingCopySection title="宝贝标题" value={copy.title} />
          <ListingCopySection title="核心卖点/促销利益点" value={copy.sellingPoints.join("\n")} />
          <ListingCopySection title="详情页文案" value={copy.detailCopy} />
          <ListingCopySection title="搜索关键词/属性词" value={copy.keywords} />
          <ListingCopySection title="主图拍摄规划" value={copy.shootingPlan.map((plan, index) => `${index + 1}. ${plan}`).join("\n")} />
        </div>
      </div>
    </div>
  );
}

function formatProductListingCopy(copy: ProductListingCopy) {
  return [
    `宝贝标题\n${copy.title}`,
    `核心卖点/促销利益点\n${copy.sellingPoints.join("\n")}`,
    `详情页文案\n${copy.detailCopy}`,
    `搜索关键词/属性词\n${copy.keywords}`,
    `主图拍摄规划\n${copy.shootingPlan.map((plan, index) => `${index + 1}. ${plan}`).join("\n")}`,
  ].join("\n\n");
}

function ListingCopySection({ title, value }: { title: string; value: string }) {
  return (
    <section className="py-4 first:pt-1">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-[17px] font-semibold text-slate-950">{title}</h3>
        <button
          aria-label={`复制 ${title}`}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[13px] font-medium text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
          type="button"
        >
          <Copy className="size-4" />
          复制
        </button>
      </div>
      <p className="whitespace-pre-line text-[15px] leading-8 text-slate-600">{value}</p>
    </section>
  );
}

function GeneratedDetailImageCard({
  image,
  index,
  onOpenPreview,
  onSelect,
  onDownload,
  onRewrite,
  onEditText,
  selected,
}: {
  image: GeneratedDetailImage;
  index: number;
  onDownload: () => void;
  onEditText: () => void;
  onOpenPreview: (image: GeneratedDetailImage) => void;
  onRewrite: () => void;
  onSelect: (selected: boolean) => void;
  selected: boolean;
}) {
  const complete = image.status === "complete";

  return (
    <article
      className={cn(
        "group relative aspect-square overflow-hidden rounded-[8px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all duration-200 hover:shadow-[0_10px_22px_rgba(15,23,42,0.14)]",
        complete ? "cursor-zoom-in" : "cursor-default",
        selected ? "border-2 border-slate-950" : "border-2 border-white/80",
      )}
      data-testid="generated-detail-image-card"
      onClick={() => {
        if (complete) {
          onOpenPreview(image);
        }
      }}
    >
      <div
        className={cn(
          "absolute inset-0",
          complete
            ? generatedImageBackgrounds[index % generatedImageBackgrounds.length]
            : "bg-[linear-gradient(135deg,#eef2f7,#e2e8f0)]",
        )}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(255,255,255,0.72),transparent_42%)]" />

      {complete ? (
        <>
          <div className={cn("absolute left-2 top-2 transition-opacity duration-200 group-hover:opacity-100", selected ? "opacity-100" : "opacity-0")}>
            <input
              aria-label={`选择 ${image.title}`}
              className="size-3.5 rounded-[4px] border-white/80 bg-white/80 text-app-blue shadow-sm focus:ring-app-blue/20"
              checked={selected}
              onChange={(event) => onSelect(event.currentTarget.checked)}
              onClick={(event) => event.stopPropagation()}
              type="checkbox"
            />
          </div>
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <IconActionButton icon={Maximize2} label={`修改尺寸 ${image.title}`} />
            <IconActionButton icon={Download} label={`下载 ${image.title}`} onClick={onDownload} />
            <IconActionButton icon={Trash2} label={`删除 ${image.title}`} />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[104px] bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.58)_24%,rgba(15,23,42,0.88))] px-2.5 pb-2.5 text-white">
            <h2
              className="absolute inset-x-2.5 bottom-10 translate-y-8 truncate text-[12px] font-medium transition-transform duration-300 ease-out group-hover:translate-y-0"
              data-testid="generated-image-title"
            >
              {image.title}：{generatedImageSubtitles[index % generatedImageSubtitles.length]}
            </h2>
            <div
              className="absolute inset-x-2.5 bottom-2.5 grid translate-y-2 grid-cols-2 gap-2 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100"
              data-testid="generated-image-card-actions"
            >
              <button
                aria-label={`AI改图 ${image.title}`}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-[6px] bg-[#e4e4e4] px-2 text-[11px] font-medium text-slate-700 transition-colors duration-300 ease-out hover:bg-[#3f3f3f] hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onRewrite();
                }}
                type="button"
              >
                <WandSparkles className="size-3" />
                AI改图
              </button>
              <button
                aria-label={`编辑文字 ${image.title}`}
                className="inline-flex h-7 items-center justify-center gap-1 rounded-[6px] bg-[#e4e4e4] px-2 text-[11px] font-medium text-slate-700 transition-colors duration-300 ease-out hover:bg-[#3f3f3f] hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditText();
                }}
                type="button"
              >
                <Type className="size-3" />
                编辑文字
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-slate-500">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="size-2.5 animate-pulse rounded-full bg-slate-400" />
              <span className="size-2.5 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
              <span className="size-2.5 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
            </div>
            <span className="text-[13px] font-semibold">AI 生成中</span>
          </div>
        </div>
      )}
    </article>
  );
}

function IconActionButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid size-7 place-items-center rounded-[7px] bg-white/86 text-slate-700 shadow-[0_4px_12px_rgba(15,23,42,0.14)] backdrop-blur-md transition-all hover:bg-white hover:text-slate-950"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      type="button"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

const generatedResultFilePrefix = "生成结果-2026-06-29-1552";
const generatedImageSize = { height: 600, width: 970 };

const generatedImageBackgrounds = [
  "bg-[linear-gradient(135deg,#111827,#334155_38%,#94a3b8_39%,#0f172a_68%,#020617)]",
  "bg-[linear-gradient(145deg,#f8fafc,#cbd5e1_48%,#64748b)]",
  "bg-[linear-gradient(135deg,#0f172a,#1d4ed8_42%,#111827_43%,#2563eb)]",
  "bg-[linear-gradient(145deg,#f8fafc,#e2e8f0_44%,#94a3b8_45%,#334155)]",
  "bg-[linear-gradient(145deg,#f8fafc,#d1d5db_48%,#111827)]",
];

const generatedImageSubtitles = [
  "突出商品核心卖点，强化购买决策",
  "展示多场景适配性，提升代入感",
  "清晰展示尺码参数，降低选码误差",
  "展示完整产品信息，打消决策顾虑",
  "传递品牌运动潮流理念，建立用户信任",
];

const defaultEditableTexts = [
  "Size Guide",
  "Size",
  "Length (CM)",
  "Chest (CM)",
  "Shoulder (CM)",
  "XS",
  "S",
  "M",
  "L",
  "XL",
];

const generatedCanvasGradients = [
  ["#111827", "#334155", "#94a3b8", "#020617"],
  ["#f8fafc", "#cbd5e1", "#64748b", "#0f172a"],
  ["#0f172a", "#1d4ed8", "#111827", "#2563eb"],
  ["#f8fafc", "#e2e8f0", "#94a3b8", "#334155"],
  ["#f8fafc", "#d1d5db", "#111827", "#020617"],
];

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-");
}

async function blobToBytes(blob: Blob) {
  if (typeof blob.arrayBuffer !== "function") {
    return new TextEncoder().encode("generated-image-fallback");
  }

  return new Uint8Array(await blob.arrayBuffer());
}

async function createGeneratedImageBlob(image: GeneratedDetailImage, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = generatedImageSize.width;
  canvas.height = generatedImageSize.height;
  const context = getCanvasContext(canvas);
  if (!context) {
    return createGeneratedImageSvgBlob([image]);
  }

  drawGeneratedImage(context, image, index, 0, 0, generatedImageSize.width, generatedImageSize.height, true);

  return canvasToPngBlob(canvas, () => createGeneratedImageSvgBlob([image]));
}

async function createLongImageBlob(images: GeneratedDetailImage[]) {
  const canvas = document.createElement("canvas");
  canvas.width = generatedImageSize.width;
  canvas.height = Math.max(generatedImageSize.height, generatedImageSize.height * images.length);
  const context = getCanvasContext(canvas);
  if (!context) {
    return createGeneratedImageSvgBlob(images, false);
  }

  images.forEach((image, index) => {
    drawGeneratedImage(
      context,
      image,
      index,
      0,
      index * generatedImageSize.height,
      generatedImageSize.width,
      generatedImageSize.height,
      false,
    );
  });

  return canvasToPngBlob(canvas, () => createGeneratedImageSvgBlob(images, false));
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  if (typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom")) {
    return null;
  }

  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

function drawGeneratedImage(
  context: CanvasRenderingContext2D,
  image: GeneratedDetailImage,
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
  includeCaption: boolean,
) {
  const colors = generatedCanvasGradients[index % generatedCanvasGradients.length];
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  colors.forEach((color, colorIndex) => gradient.addColorStop(colorIndex / (colors.length - 1), color));
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);

  const shine = context.createRadialGradient(x + width * 0.48, y + height * 0.12, 10, x + width * 0.48, y + height * 0.12, width * 0.45);
  shine.addColorStop(0, "rgba(255,255,255,0.66)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = shine;
  context.fillRect(x, y, width, height);

  if (includeCaption) {
    const overlay = context.createLinearGradient(x, y + height * 0.55, x, y + height);
    overlay.addColorStop(0, "rgba(15,23,42,0)");
    overlay.addColorStop(0.35, "rgba(15,23,42,0.72)");
    overlay.addColorStop(1, "rgba(15,23,42,0.92)");
    context.fillStyle = overlay;
    context.fillRect(x, y + height * 0.45, width, height * 0.55);

    context.fillStyle = "#ffffff";
    context.font = "700 54px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText(image.title, x + 56, y + height - 118);
    context.font = "500 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText(generatedImageSubtitles[index % generatedImageSubtitles.length], x + 56, y + height - 70);
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement, fallback: () => Blob) {
  return new Promise<Blob>((resolve) => {
    if (!canvas.toBlob) {
      resolve(fallback());
      return;
    }

    canvas.toBlob((blob) => resolve(blob ?? fallback()), "image/png");
  });
}

function createGeneratedImageSvgBlob(images: GeneratedDetailImage[], includeCaption = true) {
  const width = generatedImageSize.width;
  const height = generatedImageSize.height * Math.max(1, images.length);
  const sections = images.map((image, index) => {
    const y = index * generatedImageSize.height;
    const colors = generatedCanvasGradients[index % generatedCanvasGradients.length];
    return `
      <defs>
        <linearGradient id="g${index}" x1="0" y1="${y}" x2="${width}" y2="${y + generatedImageSize.height}">
          ${colors.map((color, colorIndex) => `<stop offset="${(colorIndex / (colors.length - 1)) * 100}%" stop-color="${color}" />`).join("")}
        </linearGradient>
      </defs>
      <rect x="0" y="${y}" width="${width}" height="${generatedImageSize.height}" fill="url(#g${index})" />
      ${
        includeCaption
          ? `
            <rect x="0" y="${y + generatedImageSize.height * 0.45}" width="${width}" height="${generatedImageSize.height * 0.55}" fill="rgba(15,23,42,0.76)" />
            <text x="56" y="${y + generatedImageSize.height - 118}" fill="white" font-size="54" font-weight="700">${escapeXml(image.title)}</text>
            <text x="56" y="${y + generatedImageSize.height - 70}" fill="white" font-size="28" font-weight="500">${escapeXml(generatedImageSubtitles[index % generatedImageSubtitles.length])}</text>
          `
          : ""
      }
    `;
  });

  return new Blob(
    [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${sections.join("")}</svg>`],
    { type: "image/svg+xml" },
  );
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createZipBytes(files: Array<{ bytes: Uint8Array; name: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.bytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatBytes([...localParts, ...centralParts, endRecord]);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createGeneratedResultGroups(images: GeneratedDetailImage[]) {
  const groupedImages = images.filter((image) => image.groupId);
  if (groupedImages.length === 0) {
    return [];
  }

  const groupMap = new Map<string, { id: string; images: GeneratedDetailImage[]; title: string }>();
  for (const image of groupedImages) {
    const groupId = image.groupId ?? image.id;
    const currentGroup = groupMap.get(groupId);
    if (currentGroup) {
      currentGroup.images.push(image);
    } else {
      groupMap.set(groupId, {
        id: groupId,
        images: [image],
        title: image.groupTitle ?? "生成结果",
      });
    }
  }

  return Array.from(groupMap.values());
}

function PreviewTile({ board, size }: { board: PreviewBoard; size: "small" | "tall" | "wide" }) {
  const Icon = board.icon;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[14px] border border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_7px_16px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_12px_24px_rgba(15,23,42,0.11)]",
        size === "small" && "h-[82px] w-[82px]",
        size === "tall" && "row-span-2 h-[172px] w-[80px]",
        size === "wide" && "h-[82px] w-[150px]",
        board.tone === "light" && "bg-[linear-gradient(145deg,#f8fafc,#e8eef6)]",
        board.tone === "blue" && "bg-[linear-gradient(135deg,#cfe1ff,#2563eb)]",
        board.tone === "dark" && "bg-[linear-gradient(135deg,#0f172a,#1d4ed8)]",
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_14%,rgba(255,255,255,0.72),transparent_38%)]" />
      <div className="absolute inset-x-3 top-2 h-px bg-white/60" />
      <div className="relative flex h-full flex-col justify-between p-3">
        <Icon className={cn("size-6", board.tone === "light" ? "text-app-blue" : "text-white")} />
        {size !== "small" ? (
          <div className="space-y-1" aria-hidden="true">
            <span
              className={cn(
                "block h-1.5 rounded-full",
                board.tone === "light" ? "bg-slate-300/70" : "bg-white/30",
              )}
            />
            <span
              className={cn(
                "block h-1.5 w-2/3 rounded-full",
                board.tone === "light" ? "bg-slate-200/90" : "bg-white/25",
              )}
            />
          </div>
        ) : null}
        <span
          className={cn(
            "max-w-full truncate rounded-full px-2 py-1 text-[10px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
            board.tone === "light" ? "bg-white/80 text-slate-700" : "bg-white/20 text-white",
          )}
        >
          {board.title}
        </span>
      </div>
    </div>
  );
}
