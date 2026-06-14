export type NewCombinationForm = {
  name: string;
  code: string;
  description: string;
  personAssetId: string | null;
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
    garmentAssetIds: [],
    ...override,
  };
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
