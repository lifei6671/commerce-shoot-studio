import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

const shellContent = {
  toolbar: <div>工具栏</div>,
  navigation: <div>导航</div>,
  configPanel: <div>配置</div>,
  canvas: <div>画布</div>,
  workspaceContent: <div>工作区</div>,
};

describe("AppShell", () => {
  it("lets the Windows system frame own the outer corner clipping", () => {
    render(<AppShell {...shellContent} platform="windows" />);

    expect(screen.getByTestId("studio-window-frame")).toHaveClass(
      "rounded-none",
      "border-0",
    );
    expect(screen.getByTestId("studio-window-frame")).not.toHaveClass(
      "rounded-[22px]",
      "border-white/70",
    );
  });

  it("keeps the existing macOS shell radius and border", () => {
    render(<AppShell {...shellContent} platform="macos" />);

    expect(screen.getByTestId("studio-window-frame")).toHaveClass(
      "rounded-[22px]",
      "border",
      "border-white/70",
    );
  });

  it("aligns the collapsed side divider with the Windows toolbar", () => {
    render(<AppShell {...shellContent} platform="windows" />);

    expect(screen.getByTestId("studio-side-divider")).toHaveClass("top-11");
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("top-[52px]");
  });

  it("keeps the collapsed side divider aligned with the macOS toolbar", () => {
    render(<AppShell {...shellContent} platform="macos" />);

    expect(screen.getByTestId("studio-side-divider")).toHaveClass("top-[52px]");
    expect(screen.getByTestId("studio-side-divider")).not.toHaveClass("top-11");
  });
});
