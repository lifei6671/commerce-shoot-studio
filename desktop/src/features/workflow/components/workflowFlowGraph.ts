export type FlowNodeId = "person" | "garments" | "prompt" | "model" | "execute" | "result";
export type FlowNodePosition = { x: number; y: number };
export type FlowNodeSize = { width: number; height: number };
export type WorkflowNodePositionChange = {
  id?: string;
  position?: FlowNodePosition;
  type: string;
};
export type WorkflowNodeSizeChange = {
  dimensions?: FlowNodeSize;
  id?: string;
  type: string;
};
type WorkflowNodeTransformOptions = {
  allowPositionChange?: boolean;
  allowSizeChange?: boolean;
};

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

export const WORKFLOW_NODE_MIN_SIZE: FlowNodeSize = { width: 96, height: 140 };

export const INITIAL_WORKFLOW_NODE_SIZES: Record<FlowNodeId, FlowNodeSize> = {
  person: { width: 124, height: 210 },
  garments: { width: 124, height: 210 },
  prompt: { width: 124, height: 210 },
  model: { width: 124, height: 210 },
  execute: { width: 124, height: 210 },
  result: { width: 124, height: 210 },
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

export function cloneInitialWorkflowNodeSizes(): Record<FlowNodeId, FlowNodeSize> {
  return {
    person: { ...INITIAL_WORKFLOW_NODE_SIZES.person },
    garments: { ...INITIAL_WORKFLOW_NODE_SIZES.garments },
    prompt: { ...INITIAL_WORKFLOW_NODE_SIZES.prompt },
    model: { ...INITIAL_WORKFLOW_NODE_SIZES.model },
    execute: { ...INITIAL_WORKFLOW_NODE_SIZES.execute },
    result: { ...INITIAL_WORKFLOW_NODE_SIZES.result },
  };
}

export function buildWorkflowEdges() {
  return WORKFLOW_EDGE_PAIRS.map(({ source, target }) => ({
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: "source",
    targetHandle: "target",
    type: "default" as const,
    selectable: false,
    deletable: false,
    reconnectable: false,
  }));
}

export function applyWorkflowNodePositionChanges(
  currentPositions: Record<FlowNodeId, FlowNodePosition>,
  changes: WorkflowNodePositionChange[],
  options: WorkflowNodeTransformOptions = {},
) {
  if (options.allowPositionChange === false) {
    return currentPositions;
  }

  let nextPositions = currentPositions;
  for (const change of changes) {
    const nodeId = change.id;
    if (change.type !== "position" || !change.position || !nodeId || !isFlowNodeId(nodeId)) {
      continue;
    }
    if (nextPositions === currentPositions) {
      nextPositions = { ...currentPositions };
    }
    nextPositions[nodeId] = change.position;
  }
  return nextPositions;
}

export function applyWorkflowNodeSizeChanges(
  currentSizes: Record<FlowNodeId, FlowNodeSize>,
  changes: WorkflowNodeSizeChange[],
  options: WorkflowNodeTransformOptions = {},
) {
  if (options.allowSizeChange === false) {
    return currentSizes;
  }

  let nextSizes = currentSizes;
  for (const change of changes) {
    const nodeId = change.id;
    const dimensions = change.dimensions;
    if (
      change.type !== "dimensions" ||
      !dimensions ||
      !nodeId ||
      !isFlowNodeId(nodeId) ||
      dimensions.width < WORKFLOW_NODE_MIN_SIZE.width ||
      dimensions.height < WORKFLOW_NODE_MIN_SIZE.height
    ) {
      continue;
    }
    if (nextSizes === currentSizes) {
      nextSizes = { ...currentSizes };
    }
    nextSizes[nodeId] = {
      width: dimensions.width,
      height: dimensions.height,
    };
  }
  return nextSizes;
}

export function isFlowNodeId(value: string): value is FlowNodeId {
  return WORKFLOW_NODE_ORDER.includes(value as FlowNodeId);
}
