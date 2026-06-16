export type NewCombinationForm = {
  name: string;
  code: string;
  description: string;
  personAssetId: string | null;
  personAssetIds: string[];
  garmentAssetIds: string[];
};

export function buildNewCombinationForm(
  override: Partial<NewCombinationForm> = {},
): NewCombinationForm {
  return {
    name: "",
    code: "",
    description: "",
    personAssetId: null,
    personAssetIds: [],
    garmentAssetIds: [],
    ...override,
  };
}

export function buildNewCombinationPersonAssetIdsAfterImport({
  currentPersonAssetId,
  currentPersonAssetIds,
  importedPersonAssetIds,
}: {
  currentPersonAssetId: string | null;
  currentPersonAssetIds: string[];
  importedPersonAssetIds: string[];
}) {
  const currentIds = normalizeNewCombinationPersonAssetIds({
    currentPersonAssetId,
    currentPersonAssetIds,
  });
  const currentIdSet = new Set(currentIds);
  return normalizeNewCombinationPersonAssetIds({
    currentPersonAssetId,
    currentPersonAssetIds: [
      ...importedPersonAssetIds.filter((id) => !currentIdSet.has(id.trim())),
      ...currentIds,
    ],
  });
}

export function filterNewCombinationPickerAssets<T>(
  assets: T[],
  selectedIds: string[],
  getAssetId: (asset: T) => string,
): T[] {
  if (!selectedIds.length) {
    return [];
  }

  const assetsById = new Map(assets.map((asset) => [getAssetId(asset), asset]));
  return selectedIds
    .map((assetId) => assetsById.get(assetId))
    .filter((asset): asset is T => Boolean(asset));
}

function normalizeNewCombinationPersonAssetIds({
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
