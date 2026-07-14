import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { localPromptPlanPort } from "./prompt-plan";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("localPromptPlanPort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("delegates prompt plan creation to the local Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "prompt_plan_1",
      items: [],
      resolverVersion: "product-detail-scene-description-v1",
      status: "draft",
      templateVersion: "v1",
      workspace: "product",
    });

    await localPromptPlanPort.createPlan({
      workspace: "product",
      intent: {
        language: "中文",
        modules: [{ moduleId: "scenario", moduleTitle: "使用场景图" }],
        platform: "淘宝天猫",
        productSellingPoints: "儿童骑行头盔，轻量透气。",
        ratio: "1:1",
        viralStyles: [],
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("prompt_plan_create", {
      input: {
        workspace: "product",
        intent: {
          language: "中文",
          modules: [{ moduleId: "scenario", moduleTitle: "使用场景图" }],
          platform: "淘宝天猫",
          productSellingPoints: "儿童骑行头盔，轻量透气。",
          ratio: "1:1",
          viralStyles: [],
        },
      },
    });
  });
});
