import { render, screen } from "@testing-library/react";
import { Image } from "lucide-react";
import { describe, expect, it } from "vitest";
import { PreviewCanvas } from "./PreviewCanvas";

describe("PreviewCanvas empty state", () => {
  it("shows the AI product title and bundled product example image", () => {
    render(
      <PreviewCanvas
        boards={[{ icon: Image, id: "source", title: "商品原图", tone: "light" }]}
      />,
    );

    expect(screen.getByText("AI 商品")).toBeInTheDocument();
    expect(screen.queryByText("A+ / 详情页")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "AI 商品详情视觉示例" })).toHaveAttribute(
      "src",
      expect.stringContaining("product.png"),
    );
    expect(screen.getByText("商品生成流程：商品原图")).toHaveClass("sr-only");
  });
});
