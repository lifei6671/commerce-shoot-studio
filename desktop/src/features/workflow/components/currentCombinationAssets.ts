import type { AssetFileView } from "../../assets/model/assetTypes";
import type { GenerationTaskResultAsset } from "../../generation-task/model/taskTypes";

export type CurrentCombinationAssetView = {
  people: AssetFileView[];
  garments: AssetFileView[];
  results: GenerationTaskResultAsset[];
};

export function buildCurrentCombinationAssetView({
  people,
  garments,
  results,
  personAssetId,
  personAssetIds,
  garmentAssetIds,
}: {
  people: AssetFileView[];
  garments: AssetFileView[];
  results: GenerationTaskResultAsset[];
  personAssetId: string | null;
  personAssetIds?: string[];
  garmentAssetIds: string[];
}): CurrentCombinationAssetView {
  const effectivePersonAssetIds = normalizeCombinationPersonAssetIds({
    currentPersonAssetId: personAssetId,
    currentPersonAssetIds: personAssetIds ?? [],
  });
  return {
    people: findAssetsByIds(people, effectivePersonAssetIds),
    garments: findAssetsByIds(garments, garmentAssetIds),
    results,
  };
}

export function buildCombinationPersonAssetIdsAfterImport({
  currentPersonAssetId,
  currentPersonAssetIds,
  importedPeople,
}: {
  currentPersonAssetId: string | null;
  currentPersonAssetIds: string[];
  importedPeople: AssetFileView[];
}) {
  return normalizeCombinationPersonAssetIds({
    currentPersonAssetId,
    currentPersonAssetIds: [
      ...importedPeople.map((asset) => asset.asset.id),
      ...currentPersonAssetIds,
    ],
  });
}

export function buildCombinationGarmentAssetIdsAfterImport({
  currentGarmentAssetIds,
  importedGarments,
}: {
  currentGarmentAssetIds: string[];
  importedGarments: AssetFileView[];
}) {
  const seen = new Set<string>();
  const currentIds: string[] = [];
  for (const id of currentGarmentAssetIds) {
    const value = id.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    currentIds.push(value);
  }

  const importedIds: string[] = [];
  for (const asset of importedGarments) {
    const value = asset.asset.id.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    importedIds.push(value);
  }
  return [...importedIds, ...currentIds];
}

export function buildCombinationAssetIdsAfterReorder({
  currentAssetIds,
  activeId,
  overId,
}: {
  currentAssetIds: string[];
  activeId: string;
  overId: string;
}) {
  if (activeId === overId) {
    return currentAssetIds;
  }
  const fromIndex = currentAssetIds.indexOf(activeId);
  const toIndex = currentAssetIds.indexOf(overId);
  if (fromIndex < 0 || toIndex < 0) {
    return currentAssetIds;
  }
  const nextAssetIds = currentAssetIds.slice();
  const [movedAssetId] = nextAssetIds.splice(fromIndex, 1);
  nextAssetIds.splice(toIndex, 0, movedAssetId);
  return nextAssetIds;
}

export function buildSelectedAssetIdsAfterCombinationReorder({
  currentAssetIds,
  selectedAssetIds,
}: {
  currentAssetIds: string[];
  selectedAssetIds: string[];
}) {
  const selectedIds = new Set(selectedAssetIds);
  const nextSelectedAssetIds = currentAssetIds.filter((id) => selectedIds.has(id));
  if (
    nextSelectedAssetIds.length === selectedAssetIds.length &&
    nextSelectedAssetIds.every((id, index) => id === selectedAssetIds[index])
  ) {
    return selectedAssetIds;
  }
  return nextSelectedAssetIds;
}

export function buildActivePersonAssetIdForCombination({
  currentPersonAssetId,
  currentPersonAssetIds,
  deselectedPersonAssetIds,
}: {
  currentPersonAssetId: string | null;
  currentPersonAssetIds: string[];
  deselectedPersonAssetIds: string[];
}) {
  const activeId = currentPersonAssetId?.trim();
  if (!activeId) {
    return null;
  }
  if (!currentPersonAssetIds.includes(activeId)) {
    return null;
  }
  if (deselectedPersonAssetIds.includes(activeId)) {
    return null;
  }
  return activeId;
}

export function buildActiveGarmentAssetIdsForCombination({
  currentGarmentAssetIds,
  deselectedGarmentAssetIds,
}: {
  currentGarmentAssetIds: string[];
  deselectedGarmentAssetIds: string[];
}) {
  return currentGarmentAssetIds.filter((id) => !deselectedGarmentAssetIds.includes(id));
}

export function buildDeselectedAssetIdsFromActiveIds({
  currentAssetIds,
  activeAssetIds,
}: {
  currentAssetIds: string[];
  activeAssetIds: string[];
}) {
  const activeIds = new Set(activeAssetIds);
  return currentAssetIds.filter((id) => !activeIds.has(id));
}

export function toggleDeselectedAssetId({
  assetId,
  isSelected,
  deselectedAssetIds,
}: {
  assetId: string;
  isSelected: boolean;
  deselectedAssetIds: string[];
}) {
  if (isSelected) {
    return deselectedAssetIds.includes(assetId)
      ? deselectedAssetIds
      : [assetId, ...deselectedAssetIds];
  }
  return deselectedAssetIds.filter((id) => id !== assetId);
}

export function buildPersonAssetSelectionAfterRemove({
  removedAssetId,
  selectedPersonAssetId,
  currentPersonAssetIds,
  deselectedPersonAssetIds,
}: {
  removedAssetId: string;
  selectedPersonAssetId: string | null;
  currentPersonAssetIds: string[];
  deselectedPersonAssetIds: string[];
}) {
  const personAssetIds = normalizeCombinationPersonAssetIds({
    currentPersonAssetId: selectedPersonAssetId,
    currentPersonAssetIds,
  }).filter((id) => id !== removedAssetId);
  const nextDeselectedPersonAssetIds = deselectedPersonAssetIds.filter(
    (id) => id !== removedAssetId && personAssetIds.includes(id),
  );
  const selectedPersonId =
    selectedPersonAssetId === removedAssetId
      ? (personAssetIds.find((id) => !nextDeselectedPersonAssetIds.includes(id)) ?? null)
      : selectedPersonAssetId;

  return {
    personAssetIds,
    selectedPersonAssetId: selectedPersonId,
    deselectedPersonAssetIds: nextDeselectedPersonAssetIds,
  };
}

export function normalizeCombinationPersonAssetIds({
  currentPersonAssetId,
  currentPersonAssetIds,
}: {
  currentPersonAssetId: string | null;
  currentPersonAssetIds: string[];
}) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of [
    ...currentPersonAssetIds,
    ...(currentPersonAssetId ? [currentPersonAssetId] : []),
  ]) {
    const value = id.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function findAssetsByIds(assets: AssetFileView[], assetIds: string[]) {
  const assetsById = new Map(assets.map((asset) => [asset.asset.id, asset]));
  return assetIds
    .map((assetId) => assetsById.get(assetId))
    .filter((asset): asset is AssetFileView => Boolean(asset));
}
