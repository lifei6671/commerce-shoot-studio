import type { FlowNodeId } from "./workflowFlowGraph";

export type SidePanelMode = "details" | "edit";

export function getInspectorPanelModes(nodeId: FlowNodeId): SidePanelMode[] {
  if (nodeId === "person") {
    return ["details"];
  }
  return ["details", "edit"];
}

export function normalizeInspectorPanelMode(
  nodeId: FlowNodeId,
  mode: SidePanelMode,
): SidePanelMode {
  return getInspectorPanelModes(nodeId).includes(mode) ? mode : "details";
}
