import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { StudioToolbar } from "./StudioToolbar";

const toggleMaximize = vi.fn();
const startDragging = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    startDragging,
    toggleMaximize,
  }),
}));

describe("StudioToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startDragging.mockResolvedValue(undefined);
    toggleMaximize.mockResolvedValue(undefined);
  });

  it("starts native window dragging from non-interactive toolbar space", async () => {
    const user = userEvent.setup();

    render(<StudioToolbar />);

    await user.pointer({
      keys: "[MouseLeft>]",
      target: screen.getByRole("banner", { name: "应用工具栏" }),
    });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("keeps toolbar button presses from starting native dragging", async () => {
    const user = userEvent.setup();

    render(<StudioToolbar />);

    await user.pointer({
      keys: "[MouseLeft>]",
      target: screen.getByRole("button", { name: "新建任务" }),
    });

    expect(startDragging).not.toHaveBeenCalled();
  });

  it("toggles maximize state when the draggable toolbar is double clicked", async () => {
    const user = userEvent.setup();

    render(<StudioToolbar />);

    await user.dblClick(screen.getByRole("banner", { name: "应用工具栏" }));

    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("keeps toolbar button double clicks from toggling the window", async () => {
    const user = userEvent.setup();

    render(<StudioToolbar />);

    await user.dblClick(screen.getByRole("button", { name: "新建任务" }));

    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("keeps macOS traffic lights native while rendering Windows custom controls", () => {
    render(<StudioToolbar />);

    expect(screen.queryByLabelText("macOS 窗口控制")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Windows 窗口控制")).toBeInTheDocument();
  });

  it("splits brand and task actions across the left panel divider", () => {
    render(<StudioToolbar />);

    const brandRegion = screen.getByLabelText("品牌区");
    const actionRegion = screen.getByLabelText("任务操作区");
    const title = within(brandRegion).getByText("商拍工坊");

    expect(screen.getByRole("banner", { name: "应用工具栏" })).toHaveClass(
      "grid-cols-[var(--studio-side-width)_minmax(0,1fr)]",
    );
    expect(title).toBeInTheDocument();
    expect(title).toHaveClass("-translate-y-[3px]");
    expect(brandRegion.querySelector("svg")).not.toBeInTheDocument();
    expect(within(brandRegion).queryByRole("button", { name: "新建任务" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("toolbar-panel-divider")).not.toBeInTheDocument();

    expect(within(actionRegion).getByRole("button", { name: "新建任务" })).toBeInTheDocument();
    expect(within(actionRegion).getByRole("button", { name: "生成记录" })).toBeInTheDocument();
    expect(within(actionRegion).getByRole("button", { name: "设置" })).toBeInTheDocument();
  });
});
