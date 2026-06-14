export type FlowNodeRenderQualityStyle = {
  "--flow-node-render-scale": string;
  "--flow-node-render-scale-inverse": string;
};

export function getFlowNodeRenderScale(zoomPercent: number) {
  const zoomScale = Number.isFinite(zoomPercent) ? zoomPercent / 100 : 1;
  return Math.max(1, Math.min(3, zoomScale));
}

export function buildFlowNodeRenderQualityStyle(
  zoomPercent: number,
): FlowNodeRenderQualityStyle {
  const renderScale = getFlowNodeRenderScale(zoomPercent);
  return {
    "--flow-node-render-scale": formatCssNumber(renderScale),
    "--flow-node-render-scale-inverse": formatCssNumber(1 / renderScale),
  };
}

function formatCssNumber(value: number) {
  return Number(value.toFixed(6)).toString();
}
