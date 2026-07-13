import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui/toast";
import { SceneConfigPanel } from "./SceneConfigPanel";
import { defaultSceneConfig, type SceneConfigState } from "../lib/sceneImagePlan";

function SceneConfigHarness({ onGeneratePlan = vi.fn() }: { onGeneratePlan?: () => void }) {
  const [config, setConfig] = useState<SceneConfigState>({
    ...defaultSceneConfig,
    referenceImages: [
      {
        id: "reference-1",
        name: "reference.png",
        path: "/tmp/reference.png",
        src: "asset://reference.png",
      },
    ],
  });

  return (
    <ToastProvider>
      <SceneConfigPanel config={config} onChange={setConfig} onGeneratePlan={onGeneratePlan} />
    </ToastProvider>
  );
}

describe("SceneConfigPanel", () => {
  it("explains all output modes with hoverable portal tooltips", async () => {
    const user = userEvent.setup();
    render(<SceneConfigHarness />);

    expect(screen.getByRole("button", { name: "单张场景图（1 张）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主图组（5 张）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "详情页组（9 张）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完整图片包（14 张）" })).toBeInTheDocument();

    const helpButton = screen.getByRole("button", { name: "查看主图组（5 张）输出说明" });
    await user.hover(helpButton);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("H1–H5 共 5 张主图");
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip).toHaveClass("fixed", "z-[1000]");

    await user.unhover(helpButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(helpButton);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not render manual scene template or visual direction selectors", () => {
    render(<SceneConfigHarness />);

    expect(screen.queryByRole("tablist", { name: "场景分类" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText("场景类型")).not.toBeInTheDocument();
    expect(screen.queryByText("视觉方向")).not.toBeInTheDocument();
  });

  it("shows concise examples for writing useful supplemental information", () => {
    render(<SceneConfigHarness />);

    const examples = screen.getByLabelText("补充信息填写示例");
    expect(screen.getByRole("textbox", { name: "补充信息" })).toHaveAttribute(
      "aria-describedby",
      "scene-supplemental-info-help",
    );
    expect(examples).toHaveTextContent("推荐写法：用途 + 场景环境 + 主体保留 + 风格光线 + 禁用元素");
    expect(within(examples).getAllByRole("listitem")).toHaveLength(2);
    expect(examples).toHaveTextContent("商品外观和 Logo 不变");
    expect(examples).toHaveTextContent("人物五官与服装不变");
  });

  it("requires trimmed supplemental information before planning", async () => {
    const user = userEvent.setup();
    const onGeneratePlan = vi.fn();
    render(<SceneConfigHarness onGeneratePlan={onGeneratePlan} />);

    const supplementalInfo = screen.getByRole("textbox", { name: "补充信息" });
    expect(supplementalInfo).toBeRequired();
    expect(supplementalInfo).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("button", { name: "请填写补充信息" })).toBeDisabled();

    await user.type(supplementalInfo, "   ");
    expect(screen.getByRole("button", { name: "请填写补充信息" })).toBeDisabled();

    await user.type(supplementalInfo, "生成通勤场景，保持人物身份和服装不变");
    const generateButton = screen.getByRole("button", { name: "生成图片方案" });
    expect(generateButton).toBeEnabled();
    await user.click(generateButton);
    expect(onGeneratePlan).toHaveBeenCalledTimes(1);
  });
});
