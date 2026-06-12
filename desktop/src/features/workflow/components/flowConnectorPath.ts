export type FlowNodePosition = { x: number; y: number };

type FlowConnectorSide = "left" | "right" | "top" | "bottom";

type FlowNodeRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

type FlowConnectorPoint = {
  side: FlowConnectorSide;
  x: number;
  y: number;
};

export const FLOW_NODE_WIDTH = 124;
export const FLOW_NODE_HEIGHT = 210;
export const FLOW_ARROW_EDGE_GAP = 12;
export const FLOW_ARROW_HEAD_LENGTH = 4;

export function buildFlowConnectorPath(from: FlowNodePosition, to: FlowNodePosition) {
  const fromRect = getFlowNodeRect(from);
  const toRect = getFlowNodeRect(to);
  let startSide: FlowConnectorSide = "right";
  let endSide: FlowConnectorSide = "left";

  if (toRect.left >= fromRect.right) {
    startSide = "right";
    endSide = "left";
  } else if (toRect.right <= fromRect.left) {
    startSide = "left";
    endSide = "right";
  } else if (toRect.centerY >= fromRect.centerY) {
    startSide = "bottom";
    endSide = "top";
  } else {
    startSide = "top";
    endSide = "bottom";
  }

  const start = getFlowConnectorPoint(fromRect, startSide, "start");
  const end = getFlowConnectorPoint(toRect, endSide, "end");
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function getFlowNodeRect(position: FlowNodePosition): FlowNodeRect {
  return {
    left: position.x,
    right: position.x + FLOW_NODE_WIDTH,
    top: position.y,
    bottom: position.y + FLOW_NODE_HEIGHT,
    centerX: position.x + FLOW_NODE_WIDTH / 2,
    centerY: position.y + FLOW_NODE_HEIGHT / 2,
  };
}

function getFlowConnectorPoint(
  rect: FlowNodeRect,
  side: FlowConnectorSide,
  role: "start" | "end",
): FlowConnectorPoint {
  const gap = FLOW_ARROW_EDGE_GAP + (role === "end" ? FLOW_ARROW_HEAD_LENGTH : 0);

  switch (side) {
    case "left":
      return { side, x: rect.left - gap, y: rect.centerY };
    case "right":
      return { side, x: rect.right + gap, y: rect.centerY };
    case "top":
      return { side, x: rect.centerX, y: rect.top - gap };
    case "bottom":
      return { side, x: rect.centerX, y: rect.bottom + gap };
    default:
      return { side: "right", x: rect.right + gap, y: rect.centerY };
  }
}
