export type Asset = {
  id: string;
  visual: string;
  imageSrc?: string;
  label?: string;
  selected?: boolean;
};

export type WorkflowNodeTone =
  | "person"
  | "garment"
  | "prompt"
  | "model"
  | "execute"
  | "result";

export type WorkflowNodeData = {
  title: string;
  subtitle: string;
  tone: WorkflowNodeTone;
  status: "done" | "ready" | "pending";
};
