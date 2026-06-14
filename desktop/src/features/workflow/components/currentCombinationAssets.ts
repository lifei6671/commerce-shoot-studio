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

export function pickCurrentPersonAssetIdAfterImport({
  currentPersonAssetId,
  importedPeople,
}: {
  currentPersonAssetId: string | null;
  importedPeople: AssetFileView[];
}) {
  return importedPeople[0]?.asset.id ?? currentPersonAssetId;
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
