export type TaskHistoryDatePreset = "all" | "today" | "7d" | "30d";

export function buildTaskHistoryProviderOptions(
  historyProviders: string[],
  catalogProviders: string[],
): string[] {
  return [...new Set([...catalogProviders, ...historyProviders])].sort();
}

export function buildTaskHistoryModelOptions(
  historyModelIds: string[],
  catalogModels: string[],
): string[] {
  return [...new Set([...catalogModels, ...historyModelIds])].sort();
}

export function buildTaskHistoryDateRange(
  preset: TaskHistoryDatePreset,
  now = new Date(),
): { createdFrom: string | null; createdTo: string | null } {
  if (preset === "all") {
    return { createdFrom: null, createdTo: null };
  }
  const start = new Date(now);
  if (preset === "today") {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(now.getDate() - (preset === "7d" ? 6 : 29));
    start.setHours(0, 0, 0, 0);
  }
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    createdFrom: formatSqliteUtcDateTime(start),
    createdTo: formatSqliteUtcDateTime(end),
  };
}

export function canRetryTaskHistoryItem(task: {
  status: string;
  provider: string;
}): boolean {
  return (task.status === "failed" || task.status === "cancelled") && task.provider === "openai";
}

function formatSqliteUtcDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
