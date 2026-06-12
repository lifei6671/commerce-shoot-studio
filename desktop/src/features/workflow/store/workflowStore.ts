import { create } from "zustand";

type WorkflowStore = {
  selectedNode: string;
  setSelectedNode: (nodeId: string) => void;
};

export const useWorkbenchStore = create<WorkflowStore>((set) => ({
  selectedNode: "person",
  setSelectedNode: (selectedNode) => set({ selectedNode }),
}));
