export type DateTimeString = string;

export type RuntimeMode = "local" | "remote";

export type WorkspaceKind = "product" | "clothing" | "scene";

export type PageRequest = {
  page?: number;
  pageSize?: number;
};

export type PageResult<TItem> = {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
};
