import type { GenerationRecord } from "../../features/history/components/GenerationHistoryPopover";
import { localGenerationPort } from "../../runtime/local/generation";

export function deletePersistedGenerationRecord(record: GenerationRecord | undefined) {
  if (!record) {
    return;
  }

  const taskIds = Array.from(
    new Set(
      [...(record.relatedTaskIds ?? []), record.persistedTaskId].filter(
        (taskId): taskId is string => Boolean(taskId),
      ),
    ),
  );
  deletePersistedGenerationTasks(taskIds);
}

export function deletePersistedGenerationTasks(taskIds: string[]) {
  taskIds.forEach((taskId) => {
    void localGenerationPort.deleteTask(taskId).catch((error) => {
      console.warn("delete persisted generation record failed", error);
    });
  });
}
