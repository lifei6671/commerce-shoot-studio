import type { DateTimeString, WorkspaceKind } from "./common";

export type PromptPlanStatus = "draft" | "confirmed";

export type PromptPlanItem = {
  id: string;
  type: string;
  title: string;
  displaySummary: string;
  intent: unknown;
  editable: boolean;
  required: boolean;
  sortOrder: number;
  createdAt: DateTimeString;
  updatedAt: DateTimeString;
};

export type PromptPlan = {
  id: string;
  workspace: WorkspaceKind;
  status: PromptPlanStatus;
  userEditableSummary?: string;
  resolverVersion: string;
  templateVersion: string;
  items: PromptPlanItem[];
  createdAt: DateTimeString;
  updatedAt: DateTimeString;
  confirmedAt?: DateTimeString;
};

export type CreatePromptPlanInput = {
  workspace: WorkspaceKind;
  intent: unknown;
};

export type UpdatePromptPlanInput = {
  planId: string;
  userEditableSummary?: string;
  items?: Array<Pick<PromptPlanItem, "id" | "displaySummary" | "intent">>;
};
