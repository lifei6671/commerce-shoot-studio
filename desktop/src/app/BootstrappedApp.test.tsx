import { render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BootstrappedApp } from "./BootstrappedApp";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("BootstrappedApp", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command) => {
      if (command === "workspace_get_status") {
        return Promise.resolve({
          initialized: false,
          updatedAt: "2026-07-01T00:00:00.000Z",
          warnings: [],
          workspaceDirectory: "/tmp/commerce-shoot-studio",
        });
      }

      if (command === "workspace_initialize") {
        return Promise.resolve({
          initialized: true,
          updatedAt: "2026-07-01T00:00:01.000Z",
          warnings: [],
          workspaceDirectory: "/tmp/commerce-shoot-studio",
        });
      }

      return Promise.resolve(undefined);
    });
  });

  it("shows initialization loading first and enters product workspace after workspace is ready", async () => {
    render(<BootstrappedApp />);

    expect(screen.getByRole("status", { name: "应用初始化状态" })).toHaveTextContent("正在初始化工作区");

    const navigation = await screen.findByRole("navigation", { name: "主导航" });
    expect(navigation).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /商品/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("workspace_get_status");
      expect(invokeMock).toHaveBeenCalledWith("workspace_initialize", {
        workspaceDirectory: "/tmp/commerce-shoot-studio",
      });
    });
  });
});
