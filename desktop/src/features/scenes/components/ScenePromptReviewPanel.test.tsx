import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSceneConfig, type SceneImagePlan } from "../lib/sceneImagePlan";
import { ScenePromptReviewPanel } from "./ScenePromptReviewPanel";

function createPlan(code: string, prompt = `生成 ${code} 图片`): SceneImagePlan {
  return {
    code,
    id: `scene-${code.toLowerCase()}`,
    imageNo: 1,
    negativeConstraints: "禁止虚构信息",
    prompt,
    promptSummary: "暖白背景中的首屏主视觉，主体居中并保留充足留白。",
    purpose: "首屏主视觉",
    ratio: "1:1",
    sortOrder: 0,
    templateId: "hero-image",
    title: `${code} 首屏主视觉`,
    variantId: "minimal",
  };
}

describe("ScenePromptReviewPanel", () => {
  it("shows only the model summary while keeping the complete prompt hidden", () => {
    const onGenerateImages = vi.fn();
    const plan = createPlan("H1");
    const { rerender } = render(
      <ScenePromptReviewPanel
        campaignStyleLock="统一暖白色板"
        config={{ ...defaultSceneConfig, outputMode: "hero-pack" }}
        imageGenerating={false}
        onBack={vi.fn()}
        onGenerateImages={onGenerateImages}
        planGenerating={false}
        plans={[plan]}
      />,
    );

    expect(screen.queryByRole("button", { name: `删除 ${plan.title}` })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "统一风格锁定" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "场景方案" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "场景摘要" })).toBeInTheDocument();
    expect(screen.getByText(plan.promptSummary)).toBeInTheDocument();
    expect(screen.queryByText(plan.prompt)).not.toBeInTheDocument();
    expect(screen.queryByText(plan.templateId, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(plan.variantId, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    rerender(
      <ScenePromptReviewPanel
        campaignStyleLock="统一暖白色板"
        config={{ ...defaultSceneConfig, outputMode: "hero-pack" }}
        imageGenerating={false}
        onBack={vi.fn()}
        onGenerateImages={onGenerateImages}
        planGenerating={false}
        plans={[createPlan("H1", " ")]}
      />,
    );
    expect(screen.getByRole("button", { name: "场景方案不完整，请重新规划" })).toBeDisabled();
    expect(onGenerateImages).not.toHaveBeenCalled();
  });

  it("keeps the single output item fixed", () => {
    const plan = createPlan("S1");
    render(
      <ScenePromptReviewPanel
        campaignStyleLock=""
        config={{ ...defaultSceneConfig, outputMode: "single" }}
        imageGenerating={false}
        onBack={vi.fn()}
        onGenerateImages={vi.fn()}
        planGenerating={false}
        plans={[plan]}
      />,
    );

    expect(screen.queryByRole("button", { name: `删除 ${plan.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "统一风格锁定" })).not.toBeInTheDocument();
  });
});
