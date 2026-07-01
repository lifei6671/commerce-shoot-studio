import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function ToastHarness() {
  const { showToast } = useToast();

  return (
    <div>
      <button onClick={() => showToast({ message: "保存成功", variant: "success" })} type="button">
        success
      </button>
      <button onClick={() => showToast({ message: "保存失败", variant: "error" })} type="button">
        error
      </button>
      <button onClick={() => showToast({ message: "注意配置", variant: "warning" })} type="button">
        warning
      </button>
    </div>
  );
}

describe("ToastProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders success, error and warning toasts with an icon before copy", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "success" }));
    await user.click(screen.getByRole("button", { name: "error" }));
    await user.click(screen.getByRole("button", { name: "warning" }));

    const toastCards = screen.getAllByRole("status");

    expect(toastCards).toHaveLength(3);
    expect(toastCards.map((toastCard) => toastCard.textContent)).toEqual(["保存成功", "保存失败", "注意配置"]);
    for (const toastCard of toastCards) {
      expect(toastCard.querySelector("svg")).toBeInTheDocument();
      expect(toastCard.querySelector("svg")?.compareDocumentPosition(within(toastCard).getByText(toastCard.textContent ?? ""))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it("keeps newer toasts lower and removes expired toasts after 3 seconds", async () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "success" }));
    fireEvent.click(screen.getByRole("button", { name: "warning" }));

    expect(screen.getAllByRole("status").map((toastCard) => toastCard.textContent)).toEqual(["保存成功", "注意配置"]);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
