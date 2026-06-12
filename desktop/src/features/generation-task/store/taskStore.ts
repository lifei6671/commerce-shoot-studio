import { create } from "zustand";

import type { GenerationTaskDetail } from "../model/taskTypes";

type GenerationTaskStore = {
  latestTask: GenerationTaskDetail | null;
  runningTasks: GenerationTaskDetail[];
  recentTasks: GenerationTaskDetail[];
  setLatestTask: (task: GenerationTaskDetail | null) => void;
  setRunningTasks: (tasks: GenerationTaskDetail[]) => void;
  setRecentTasks: (tasks: GenerationTaskDetail[]) => void;
};

export const useGenerationTaskStore = create<GenerationTaskStore>((set) => ({
  latestTask: null,
  runningTasks: [],
  recentTasks: [],
  setLatestTask: (latestTask) => set({ latestTask }),
  setRunningTasks: (runningTasks) => set({ runningTasks }),
  setRecentTasks: (recentTasks) => set({ recentTasks }),
}));
