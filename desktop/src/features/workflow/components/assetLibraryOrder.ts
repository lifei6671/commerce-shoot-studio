import type { AssetFileView, AssetType } from "../../assets/model/assetTypes";

export type SortableAssetType = Extract<AssetType, "person" | "garment">;

export const ASSET_LIBRARY_ORDER_STORAGE_KEY =
  "commerce-shoot-studio.asset-library-order.v1";

type AssetLibraryOrderState = Partial<Record<SortableAssetType, string[]>>;
type AssetOrderStorage = Pick<Storage, "getItem" | "setItem">;

export function applyStoredAssetOrder(
  items: AssetFileView[],
  orderedIds: string[] | null | undefined,
) {
  if (!orderedIds?.length) {
    return items;
  }

  const rankById = new Map(orderedIds.map((id, index) => [id, index]));
  const unknownItems: AssetFileView[] = [];
  const knownItems: AssetFileView[] = [];

  for (const item of items) {
    if (rankById.has(item.asset.id)) {
      knownItems.push(item);
    } else {
      unknownItems.push(item);
    }
  }

  knownItems.sort(
    (left, right) =>
      (rankById.get(left.asset.id) ?? Number.MAX_SAFE_INTEGER) -
      (rankById.get(right.asset.id) ?? Number.MAX_SAFE_INTEGER),
  );

  return [...unknownItems, ...knownItems];
}

export function moveAssetById(
  items: AssetFileView[],
  activeId: string,
  overId: string,
) {
  if (activeId === overId) {
    return items;
  }

  const fromIndex = items.findIndex((item) => item.asset.id === activeId);
  const toIndex = items.findIndex((item) => item.asset.id === overId);
  if (fromIndex < 0 || toIndex < 0) {
    return items;
  }

  const nextItems = items.slice();
  const [moved] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, moved);
  return nextItems;
}

export function isAssetDropTarget({
  activeId,
  assetId,
  overId,
}: {
  activeId: string | null;
  assetId: string;
  overId: string | null;
}) {
  return Boolean(activeId && overId && activeId !== overId && assetId === overId);
}

export function readAssetLibraryOrder(
  storage: AssetOrderStorage | null,
  assetType: SortableAssetType,
) {
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(ASSET_LIBRARY_ORDER_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }
    const state = JSON.parse(rawValue) as AssetLibraryOrderState;
    const orderedIds = state[assetType];
    return Array.isArray(orderedIds)
      ? orderedIds.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveAssetLibraryOrder(
  storage: AssetOrderStorage | null,
  assetType: SortableAssetType,
  orderedIds: string[],
) {
  if (!storage) {
    return;
  }

  let state: AssetLibraryOrderState = {};
  try {
    const rawValue = storage.getItem(ASSET_LIBRARY_ORDER_STORAGE_KEY);
    state = rawValue ? (JSON.parse(rawValue) as AssetLibraryOrderState) : {};
  } catch {
    state = {};
  }

  try {
    storage.setItem(
      ASSET_LIBRARY_ORDER_STORAGE_KEY,
      JSON.stringify({
        ...state,
        [assetType]: orderedIds,
      }),
    );
  } catch {
    // Sorting should still work for the current session if browser storage is unavailable.
  }
}

export function assetIds(items: AssetFileView[]) {
  return items.map((item) => item.asset.id);
}
