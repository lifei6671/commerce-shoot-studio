import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScenePreviewCanvas } from "./ScenePreviewCanvas";

describe("ScenePreviewCanvas", () => {
  it("shows the bundled scene workflow image in the empty state", () => {
    render(<ScenePreviewCanvas />);

    expect(screen.getByText("场景图片")).toBeInTheDocument();
    expect(screen.getByText("上传参考图，选择场景与尺寸，生成适配电商投放的视觉素材。")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "AI 场景图片生成流程示例" })).toHaveAttribute(
      "src",
      expect.stringContaining("scenes.png"),
    );
    expect(screen.queryByText("Prompt 方案")).not.toBeInTheDocument();
  });
});
