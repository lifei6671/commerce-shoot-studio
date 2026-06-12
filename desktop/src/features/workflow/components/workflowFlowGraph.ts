export type FlowNodeId = "person" | "garments" | "prompt" | "model" | "execute" | "result";
export type FlowNodePosition = { x: number; y: number };

export const WORKFLOW_NODE_ORDER: FlowNodeId[] = [
  "person",
  "garments",
  "prompt",
  "model",
  "execute",
  "result",
];

export const INITIAL_WORKFLOW_NODE_POSITIONS: Record<FlowNodeId, FlowNodePosition> = {
  person: { x: 0, y: 40 },
  garments: { x: 198, y: 40 },
  prompt: { x: 396, y: 40 },
  model: { x: 594, y: 40 },
  execute: { x: 792, y: 40 },
  result: { x: 990, y: 40 },
};

export const WORKFLOW_EDGE_PAIRS: Array<{ source: FlowNodeId; target: FlowNodeId }> =
  WORKFLOW_NODE_ORDER.slice(0, -1).map((source, index) => ({
    source,
    target: WORKFLOW_NODE_ORDER[index + 1],
  }));

export function cloneInitialWorkflowNodePositions(): Record<FlowNodeId, FlowNodePosition> {
  return {
    person: { ...INITIAL_WORKFLOW_NODE_POSITIONS.person },
    garments: { ...INITIAL_WORKFLOW_NODE_POSITIONS.garments },
    prompt: { ...INITIAL_WORKFLOW_NODE_POSITIONS.prompt },
    model: { ...INITIAL_WORKFLOW_NODE_POSITIONS.model },
    execute: { ...INITIAL_WORKFLOW_NODE_POSITIONS.execute },
    result: { ...INITIAL_WORKFLOW_NODE_POSITIONS.result },
  };
}

export function buildWorkflowEdges() {
  return WORKFLOW_EDGE_PAIRS.map(({ source, target }) => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: "source",
    targetHandle: "target",
    type: "straight" as const,
    selectable: false,
    deletable: false,
    reconnectable: false,
  }));
}

export function isFlowNodeId(value: string): value is FlowNodeId {
  return WORKFLOW_NODE_ORDER.includes(value as FlowNodeId);
}
