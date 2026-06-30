import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { PlatformWindowControls } from "./platform-window-controls";

const close = vi.fn();
const minimize = vi.fn();
const toggleMaximize = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close,
    minimize,
    toggleMaximize,
  }),
}));

describe("PlatformWindowControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    close.mockResolvedValue(undefined);
    minimize.mockResolvedValue(undefined);
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
});
