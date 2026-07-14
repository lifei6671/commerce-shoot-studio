import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { PlatformWindowControls } from "./platform-window-controls";

const close = vi.fn();
const isMaximized = vi.fn();
const minimize = vi.fn();
const onResized = vi.fn();
const toggleMaximize = vi.fn();
const unlistenResized = vi.fn();
let resizedListener: (() => void) | undefined;

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close,
    isMaximized,
    minimize,
    onResized,
    toggleMaximize,
  }),
}));

describe("PlatformWindowControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resizedListener = undefined;
    close.mockResolvedValue(undefined);
    isMaximized.mockResolvedValue(false);
    minimize.mockResolvedValue(undefined);
    onResized.mockImplementation(async (listener: () => void) => {
      resizedListener = listener;
      return unlistenResized;
    });
    toggleMaximize.mockResolvedValue(undefined);
  });

  it("wires macOS-style controls to the current Tauri window", async () => {
    const user = userEvent.setup();

    render(<PlatformWindowControls />);

    await user.click(screen.getByRole("button", { name: "关闭窗口" }));
    await user.click(screen.getByRole("button", { name: "最小化窗口" }));
    await user.click(screen.getByRole("button", { name: "最大化窗口" }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("wires Windows-style controls to the current Tauri window", async () => {
    const user = userEvent.setup();

    render(<PlatformWindowControls variant="windows" />);

    await user.click(screen.getByRole("button", { name: "Windows 最小化窗口" }));
    await user.click(screen.getByRole("button", { name: "Windows 最大化窗口" }));
    await user.click(screen.getByRole("button", { name: "Windows 关闭窗口" }));

    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("switches the Windows maximize control to restore after the window is maximized", async () => {
    const user = userEvent.setup();
    render(<PlatformWindowControls variant="windows" />);

    const maximizeButton = screen.getByRole("button", { name: "Windows 最大化窗口" });
    expect(maximizeButton.querySelector("svg")).toHaveClass("lucide-square");

    await waitFor(() => expect(onResized).toHaveBeenCalledTimes(1));
    isMaximized.mockResolvedValue(true);
    resizedListener?.();

    const restoreButton = await screen.findByRole("button", { name: "Windows 还原窗口" });
    expect(restoreButton.querySelector("svg")).toHaveClass("lucide-copy");

    await user.click(restoreButton);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("renders the restore control when the window starts maximized", async () => {
    isMaximized.mockResolvedValue(true);

    render(<PlatformWindowControls variant="windows" />);

    const restoreButton = await screen.findByRole("button", { name: "Windows 还原窗口" });
    expect(restoreButton.querySelector("svg")).toHaveClass("lucide-copy");
  });

  it("refreshes maximize state after the native resize listener is registered", async () => {
    isMaximized.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<PlatformWindowControls variant="windows" />);

    const restoreButton = await screen.findByRole("button", { name: "Windows 还原窗口" });
    expect(restoreButton.querySelector("svg")).toHaveClass("lucide-copy");
    expect(isMaximized).toHaveBeenCalledTimes(2);
  });

  it("does not observe native resize events for macOS controls", () => {
    render(<PlatformWindowControls />);

    expect(isMaximized).not.toHaveBeenCalled();
    expect(onResized).not.toHaveBeenCalled();
  });

  it("stops observing native resize events after unmount", async () => {
    const { unmount } = render(<PlatformWindowControls variant="windows" />);

    await waitFor(() => expect(onResized).toHaveBeenCalledTimes(1));
    unmount();

    expect(unlistenResized).toHaveBeenCalledTimes(1);
  });

  it("stops a native resize listener that finishes registering after unmount", async () => {
    let resolveListener: ((unlisten: () => void) => void) | undefined;
    onResized.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveListener = resolve;
      }),
    );
    const { unmount } = render(<PlatformWindowControls variant="windows" />);

    await waitFor(() => expect(onResized).toHaveBeenCalledTimes(1));
    unmount();
    resolveListener?.(unlistenResized);

    await waitFor(() => expect(unlistenResized).toHaveBeenCalledTimes(1));
  });
});
