import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  CreateGenerationTaskInput,
  DeleteGenerationResultImageInput,
  GenerationPort,
  GenerationTask,
  GenerationTaskDetail,
  GenerationTaskPage,
  GenerationTaskQuery,
  LocalTaskExecutionResult,
  ReplaceGenerationResultImageInput,
  RetryGenerationTaskInput,
  WorkspaceStatus,
} from "../index";

export const localGenerationPort: GenerationPort = {
  createTask(input: CreateGenerationTaskInput) {
    return invoke<GenerationTask>("generation_create_task", { input });
  },
  retryTask(input: RetryGenerationTaskInput) {
    return invoke<GenerationTask>("generation_retry_task", { input });
  },
  cancelTask(taskId: string) {
    return invoke<GenerationTask>("generation_cancel_task", { taskId });
  },
  deleteTask(taskId: string) {
    return invoke("generation_delete_task", { taskId });
  },
  replaceResultImage(input: ReplaceGenerationResultImageInput) {
    return invoke("generation_replace_result_image", { input });
  },
  deleteResultImage(input: DeleteGenerationResultImageInput) {
    return invoke("generation_delete_result_image", { input });
  },
  getTask(taskId: string) {
    return invoke<GenerationTask>("generation_get_task", { taskId });
  },
  async getTaskDetail(taskId: string) {
    const [detail, workspaceStatus] = await Promise.all([
      invoke<GenerationTaskDetail>("generation_get_task_detail", { taskId }),
      invoke<WorkspaceStatus>("workspace_get_status"),
    ]);
    return decorateTaskDetailAssetUrls(detail, workspaceStatus.workspaceDirectory);
  },
  listTasks(query?: GenerationTaskQuery) {
    return invoke<GenerationTaskPage>("generation_list_tasks", { query });
  },
  runNext() {
    return invoke<LocalTaskExecutionResult | null>("generation_run_next_task");
  },
  runTask(taskId: string) {
    return invoke<LocalTaskExecutionResult | null>("generation_run_task", { taskId });
  },
};

function decorateTaskDetailAssetUrls(
  detail: GenerationTaskDetail,
  workspaceDirectory?: string,
): GenerationTaskDetail {
  if (!workspaceDirectory) {
    return detail;
  }

  return {
    ...detail,
    inputAssets: detail.inputAssets.map((item) => decorateTaskAssetUrl(item, workspaceDirectory)),
    outputAssets: detail.outputAssets.map((item) => decorateTaskAssetUrl(item, workspaceDirectory)),
  };
}

function decorateTaskAssetUrl<T extends GenerationTaskDetail["outputAssets"][number]>(
  item: T,
  workspaceDirectory: string,
): T {
  const localPath = joinWorkspaceRelativePath(workspaceDirectory, item.asset.relativePath);
  return {
    ...item,
    asset: {
      ...item.asset,
      localPath,
      url: convertFileSrc(localPath),
    },
  };
}

function joinWorkspaceRelativePath(workspaceDirectory: string, relativePath: string) {
  const separator = workspaceDirectory.includes("\\") ? "\\" : "/";
  const normalizedWorkspace = workspaceDirectory.replace(/[\\/]+$/, "");
  const normalizedRelative = relativePath.split("/").join(separator);
  return `${normalizedWorkspace}${separator}${normalizedRelative}`;
}
