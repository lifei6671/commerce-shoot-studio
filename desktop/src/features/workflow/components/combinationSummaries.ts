import type {
  ImageCombination,
  ImageCombinationSummary,
} from "../../assets/model/combinationTypes";

function compareSummaryOrder(left: ImageCombinationSummary, right: ImageCombinationSummary) {
  const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }
  return right.id.localeCompare(left.id);
}

export function sortCombinationSummaries(summaries: ImageCombinationSummary[]) {
  return summaries.slice().sort(compareSummaryOrder);
}

export function getDefaultCombinationSummary(summaries: ImageCombinationSummary[]) {
  return sortCombinationSummaries(summaries)[0] ?? null;
}

export function buildCombinationSummary(
  combination: ImageCombination,
): ImageCombinationSummary {
  return {
    id: combination.id,
    name: combination.name,
    personAssetId: combination.personAssetId,
    garmentCount: combination.garmentAssetIds.length,
    createdAt: combination.createdAt,
    updatedAt: combination.updatedAt,
  };
}

export function upsertCombinationSummary(
  summaries: ImageCombinationSummary[],
  combination: ImageCombination,
) {
  const summary = buildCombinationSummary(combination);
  return sortCombinationSummaries([
    summary,
    ...summaries.filter((item) => item.id !== combination.id),
  ]);
}
