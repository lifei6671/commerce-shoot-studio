import { create } from "zustand";

import type { ValidateCombinationResponse } from "../../assets/model/combinationTypes";

type WorkflowStore = {
  selectedNode: string;
  validationRevision: number;
  validationResult: ValidateCombinationResponse | null;
  setSelectedNode: (nodeId: string) => void;
  nextValidationRevision: () => number;
  acceptValidationResult: (result: ValidateCombinationResponse) => void;
};

export const useWorkbenchStore = create<WorkflowStore>((set) => ({
  selectedNode: "person",
  validationRevision: 0,
  validationResult: null,
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  nextValidationRevision: () => {
    let nextRevision = 0;
    set((state) => {
      nextRevision = state.validationRevision + 1;
      return { validationRevision: nextRevision };
    });
    return nextRevision;
  },
  acceptValidationResult: (result) =>
    set((state) => {
      if (result.revision !== state.validationRevision) {
        return state;
      }
      return { validationResult: result };
    }),
}));
