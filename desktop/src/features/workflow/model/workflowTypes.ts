export type Asset = {
  id: string;
  imageSrc?: string;
  label?: string;
  selected?: boolean;
  width?: number;
  height?: number;
  mimeType?: string;
  createdAt?: string;
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
  assets?: Asset[];
  details?: string[];
  actionLabel?: string;
  results?: Array<{
    assetId: string;
    thumbFilePath: string;
    width: number;
    height: number;
  }>;
};
