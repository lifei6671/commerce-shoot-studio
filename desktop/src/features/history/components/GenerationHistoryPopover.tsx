import { Clock3, Images, PackageCheck, Shirt, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../shared/lib/cn";
import type { GeneratedDetailImage } from "../../generation/components/PreviewCanvas";

export type GenerationRecord = {
  createdAt: number;
  id: string;
  images: GeneratedDetailImage[];
  inputSummary: string;
  kind: "product-detail" | "clothing-scene" | "scene-generation";
  promptPlanId?: string;
  persistedTaskId?: string;
  relatedTaskIds?: string[];
  status: "complete" | "failed" | "generating" | "partial";
  title: string;
  workspace: "product" | "clothing" | "scene";
};

type GenerationHistoryPopoverProps = {
  activeRecordId: string | null;
  onClearRecords: () => void;
  onClose: () => void;
  onDeleteRecord: (recordId: string) => void;
  onOpenRecord: (record: GenerationRecord) => void;
  open: boolean;
  records: GenerationRecord[];
};

type HistoryFilter = "all" | GenerationRecord["workspace"];

const filterOptions: Array<{ label: string; value: HistoryFilter }> = [
  { label: "全部", value: "all" },
  { label: "商品", value: "product" },
  { label: "场景", value: "scene" },
  { label: "服饰", value: "clothing" },
];

const statusLabelMap: Record<GenerationRecord["status"], string> = {
  complete: "已完成",
  failed: "失败",
  generating: "生成中",
  partial: "部分失败",
};

const historyPageSize = 10;
const historyLoadMoreThresholdPx = 96;

export function GenerationHistoryPopover({
  activeRecordId,
  onClearRecords,
  onClose,
  onDeleteRecord,
  onOpenRecord,
  open,
  records,
}: GenerationHistoryPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const recordListRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [activeFilter, setActiveFilter] = useState<HistoryFilter>("all");
  const [visibleRecordCount, setVisibleRecordCount] = useState(historyPageSize);
  const filteredRecords =
    activeFilter === "all" ? records : records.filter((record) => record.workspace === activeFilter);
  const visibleRecords = filteredRecords.slice(0, visibleRecordCount);
  const hasMoreRecords = visibleRecords.length < filteredRecords.length;

  useEffect(() => {
    setVisibleRecordCount((currentCount) => {
      if (filteredRecords.length === 0) {
        return historyPageSize;
      }
      return Math.max(historyPageSize, Math.min(currentCount, filteredRecords.length));
    });
  }, [filteredRecords.length]);

  useEffect(() => {
    if (!open || !hasMoreRecords || typeof IntersectionObserver === "undefined") {
      return;
    }

    const recordList = recordListRef.current;
    const loadMoreSentinel = loadMoreSentinelRef.current;
    if (!recordList || !loadMoreSentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        setVisibleRecordCount((currentCount) =>
          Math.min(currentCount + historyPageSize, filteredRecords.length),
        );
      },
      {
        root: recordList,
        rootMargin: `0px 0px ${historyLoadMoreThresholdPx}px 0px`,
      },
    );
    observer.observe(loadMoreSentinel);
    return () => observer.disconnect();
  }, [filteredRecords.length, hasMoreRecords, open, visibleRecordCount]);

  useEffect(() => {
    if (!open || !hasMoreRecords || typeof IntersectionObserver !== "undefined") {
      return;
    }

    const recordList = recordListRef.current;
    if (!recordList) {
      return;
    }

    function handleScroll(event: Event) {
      const currentTarget = event.currentTarget as HTMLDivElement;
      const distanceToBottom = currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight;
      if (distanceToBottom > historyLoadMoreThresholdPx) {
        return;
      }

      setVisibleRecordCount((currentCount) =>
        Math.min(currentCount + historyPageSize, filteredRecords.length),
      );
    }

    recordList.addEventListener("scroll", handleScroll, { passive: true });
    return () => recordList.removeEventListener("scroll", handleScroll);
  }, [filteredRecords.length, hasMoreRecords, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (popoverRef.current?.contains(event.target as Node) || target?.closest("[data-generation-history-root]")) {
        return;
      }

      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-label="生成记录"
      aria-modal="false"
      className="fixed right-[72px] top-[64px] z-[130] w-[386px] max-w-[calc(100vw-96px)] rounded-[18px] border border-white/90 bg-white p-3 text-app-text shadow-[0_22px_52px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.95)]"
      data-window-interactive
      ref={popoverRef}
      role="dialog"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <div className="text-[14px] font-semibold text-slate-950">生成记录</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{records.length} 条本地记录</div>
        </div>
        <div className="flex items-center gap-1">
          {records.length > 0 ? (
            <button
              className="h-7 rounded-[8px] px-2 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              onClick={onClearRecords}
              type="button"
            >
              清空
            </button>
          ) : null}
          <button
            aria-label="关闭生成记录"
            className="grid size-7 place-items-center rounded-[8px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 rounded-[12px] bg-slate-100/80 p-1">
        {filterOptions.map((option) => (
          <button
            aria-pressed={activeFilter === option.value}
            className={cn(
              "h-7 rounded-[9px] text-[12px] font-medium text-slate-500 transition-all duration-200",
              activeFilter === option.value
                ? "bg-white text-slate-950 shadow-[0_1px_4px_rgba(15,23,42,0.08)]"
                : "hover:bg-white/55 hover:text-slate-700",
            )}
            key={option.value}
            onClick={() => {
              setActiveFilter(option.value);
              setVisibleRecordCount(historyPageSize);
              if (recordListRef.current) {
                recordListRef.current.scrollTop = 0;
              }
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        aria-label="生成记录列表"
        className="mt-3 max-h-[56vh] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.48)_transparent]"
        ref={recordListRef}
        role="region"
        tabIndex={0}
      >
        {filteredRecords.length > 0 ? (
          visibleRecords.map((record) => (
            <GenerationHistoryRow
              active={record.id === activeRecordId}
              key={record.id}
              onDelete={() => onDeleteRecord(record.id)}
              onOpen={() => onOpenRecord(record)}
              record={record}
            />
          ))
        ) : (
          <GenerationHistoryEmptyState activeFilter={activeFilter} />
        )}
        {hasMoreRecords ? <div aria-hidden="true" className="!mt-0 h-px" ref={loadMoreSentinelRef} /> : null}
        <div aria-live="polite" className="sr-only !mt-0">
          已加载 {visibleRecords.length} / {filteredRecords.length} 条生成记录
        </div>
      </div>
    </div>
  );
}

function GenerationHistoryRow({
  active,
  onDelete,
  onOpen,
  record,
}: {
  active: boolean;
  onDelete: () => void;
  onOpen: () => void;
  record: GenerationRecord;
}) {
  const Icon = record.workspace === "product" ? PackageCheck : record.workspace === "scene" ? Images : Shirt;
  const generatedItems = record.images.filter((image) => image.kind !== "source-image");
  const completedCount = generatedItems.filter((image) => image.status === "complete").length;

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-[14px] border p-2 text-left transition-all duration-200",
        active
          ? "border-slate-950/20 bg-white shadow-[0_8px_18px_rgba(15,23,42,0.1)]"
          : "border-white/70 bg-slate-50/78 hover:border-blue-100 hover:bg-white hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)]",
      )}
    >
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen} type="button">
        <HistoryThumbnailStack images={record.images} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-slate-500" />
            <span className="truncate text-[12px] font-semibold text-slate-950">{record.title}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <Clock3 className="size-3" />
            <span>{formatRecordTime(record.createdAt)}</span>
            <span>·</span>
            <span>{generatedItems.length} 张</span>
            {record.status === "complete" ? <span>· 完成 {completedCount} 张</span> : null}
          </div>
          <div className="mt-1 truncate text-[11px] text-slate-400">{record.inputSummary}</div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            record.status === "complete"
              ? "bg-emerald-50 text-emerald-600"
              : record.status === "generating"
                ? "bg-blue-50 text-app-blue"
                : "bg-rose-50 text-rose-500",
          )}
        >
          {statusLabelMap[record.status]}
        </span>
        <div className="flex translate-y-1 items-center gap-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            className="h-6 rounded-[7px] bg-slate-100 px-2 text-[11px] font-medium text-slate-500 transition-colors hover:bg-blue-50 hover:text-app-blue"
            onClick={onOpen}
            type="button"
          >
            打开
          </button>
          <button
            aria-label={`删除记录 ${record.title}`}
            className="grid size-6 place-items-center rounded-[7px] bg-slate-100 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-500"
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryThumbnailStack({ images }: { images: GeneratedDetailImage[] }) {
  const generatedImagesWithPreview = images.filter(
    (image) => image.kind !== "source-image" && image.kind !== "listing-copy" && Boolean(image.src),
  );
  const previewImages = (generatedImagesWithPreview.length > 0 ? generatedImagesWithPreview : images).slice(0, 3);

  return (
    <div className="relative h-14 w-[58px] shrink-0">
      {previewImages.length > 0 ? (
        previewImages.map((image, index) => (
          <div
            className={cn(
              "absolute top-1 h-12 w-9 rounded-[9px] border border-white/90 bg-[linear-gradient(145deg,#eef3f9,#8b98a8_55%,#111827)] shadow-[0_5px_12px_rgba(15,23,42,0.16)]",
              image.status === "generating" && "animate-pulse",
            )}
            key={image.id}
            style={{ left: index * 10, zIndex: 3 - index }}
          >
            {image.src ? (
              <img
                alt={image.title}
                className="absolute inset-0 h-full w-full rounded-[9px] object-cover"
                decoding="async"
                draggable={false}
                loading="lazy"
                src={image.src}
              />
            ) : null}
            <div className="absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-white/42" />
          </div>
        ))
      ) : (
        <div className="grid h-14 w-14 place-items-center rounded-[12px] bg-slate-100 text-slate-400">
          <Images className="size-4" />
        </div>
      )}
    </div>
  );
}

function GenerationHistoryEmptyState({ activeFilter }: { activeFilter: HistoryFilter }) {
  const text =
    activeFilter === "all"
      ? "暂无生成记录"
      : activeFilter === "product"
        ? "暂无商品记录"
        : activeFilter === "scene"
          ? "暂无场景记录"
          : "暂无服饰记录";
  const description =
    activeFilter === "scene"
      ? "生成场景图片后会自动保留在这里。"
      : "生成详情图或服饰场景后会自动保留在这里。";

  return (
    <div
      className="grid min-h-[150px] place-items-center rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-6 text-center"
      data-testid="generation-history-empty-state"
    >
      <div>
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-white text-slate-400 shadow-[0_1px_4px_rgba(15,23,42,0.06)]">
          <Images className="size-4" />
        </div>
        <div className="mt-3 text-[13px] font-semibold text-slate-700">{text}</div>
        <div className="mt-1 text-[12px] leading-5 text-slate-400">{description}</div>
      </div>
    </div>
  );
}

function formatRecordTime(createdAt: number) {
  const date = new Date(createdAt);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${month}-${day} ${hour}:${minute}`;
}
