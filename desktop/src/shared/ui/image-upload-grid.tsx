import { Plus, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";

export type ImagePreviewAsset = {
  id: string;
  name: string;
  src: string;
};

type ImageUploadGridProps = {
  addLabel: string;
  images: ImagePreviewAsset[];
  maxCount: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
};

export function ImageUploadGrid({
  addLabel,
  images,
  maxCount,
  onAdd,
  onRemove,
}: ImageUploadGridProps) {
  const canAdd = images.length < maxCount;

  return (
    <div className="grid grid-cols-3 gap-3">
      {images.map((image) => (
        <div
          key={image.id}
          data-testid="product-image-preview-card"
          className="group relative aspect-square rounded-[22px] bg-white p-[3px] shadow-[0_10px_22px_rgba(15,23,42,0.1)] ring-1 ring-slate-200/80"
        >
          <div className="h-full w-full overflow-hidden rounded-[19px] bg-slate-100">
            <img
              alt={image.name}
              className="h-full w-full object-cover"
              draggable={false}
              src={image.src}
            />
          </div>
          <button
            aria-label={`删除 ${image.name}`}
            className="absolute right-2 top-2 grid size-7 place-items-center rounded-full border border-white/70 bg-white/92 text-slate-500 opacity-0 shadow-control backdrop-blur transition-all duration-150 hover:-translate-y-0.5 hover:text-rose-500 group-hover:opacity-100"
            onClick={() => onRemove(image.id)}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}

      {canAdd ? (
        <button
          aria-label={addLabel}
          className={cn(
            "grid aspect-square place-items-center rounded-[22px] border-2 border-dashed border-blue-200/70 bg-white/80 text-app-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-all duration-200",
            "hover:-translate-y-0.5 hover:border-blue-300 hover:bg-white hover:shadow-control",
          )}
          onClick={onAdd}
          type="button"
        >
          <Plus className="size-6" />
        </button>
      ) : null}
    </div>
  );
}
