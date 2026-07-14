import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { StudioToolbar } from "./StudioToolbar";

const toggleMaximize = vi.fn();
const startDragging = vi.fn();
const isMaximized = vi.fn();
const onResized = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    isMaximized,
    minimize: vi.fn(),
    onResized,
    startDragging,
    toggleMaximize,
  }),
}));

describe("StudioToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMaximized.mockResolvedValue(false);
    onResized.mockResolvedValue(vi.fn());
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

  it("starts a new task from the primary action", async () => {
    const user = userEvent.setup();
    const onNewTask = vi.fn();

    render(<StudioToolbar onNewTask={onNewTask} />);

    await user.click(screen.getByRole("button", { name: "新建任务" }));

    expect(onNewTask).toHaveBeenCalledTimes(1);
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

  it("uses the compact toolbar layout and custom controls on Windows", () => {
    render(<StudioToolbar platform="windows" />);

    expect(screen.getByRole("banner", { name: "应用工具栏" })).toHaveClass(
      "h-11",
      "bg-white/[0.82]",
    );
    expect(screen.getByLabelText("品牌区")).toHaveClass("pl-3");
    expect(screen.getByText("商拍工坊")).toHaveClass("text-[12px]");
    expect(screen.getByLabelText("任务操作区")).toHaveClass("gap-2", "pr-0");
    expect(screen.getByLabelText("Windows 窗口控制")).toBeInTheDocument();
  });

  it("keeps the current toolbar layout and native traffic lights on macOS", () => {
    render(<StudioToolbar platform="macos" />);

    expect(screen.getByRole("banner", { name: "应用工具栏" })).toHaveClass("h-[52px]");
    expect(screen.getByLabelText("品牌区")).toHaveClass("pl-[92px]");
    expect(screen.getByText("商拍工坊")).toHaveClass("text-[13px]");
    expect(screen.getByLabelText("任务操作区")).toHaveClass("gap-3", "pr-3");
    expect(screen.queryByLabelText("Windows 窗口控制")).not.toBeInTheDocument();
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

  it("places new task before generation history and removes the balance button", () => {
    render(<StudioToolbar />);

    const actionRegion = screen.getByLabelText("任务操作区");
    const newTaskButton = within(actionRegion).getByRole("button", { name: "新建任务" });
    const historyButton = within(actionRegion).getByRole("button", { name: "生成记录" });

    expect(within(actionRegion).queryByRole("button", { name: "160" })).not.toBeInTheDocument();
    expect(newTaskButton.compareDocumentPosition(historyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
