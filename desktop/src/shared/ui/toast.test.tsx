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
      <button onClick={() => showToast({ message: "保存失败", variant: "error" })} type="button">
        duplicate error
      </button>
    </div>
  );
}

describe("ToastProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders success, error and warning toasts as compact rounded pills without status icons", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "success" }));
    await user.click(screen.getByRole("button", { name: "error" }));
    await user.click(screen.getByRole("button", { name: "warning" }));

    const toastCards = visibleToastCards();
    const viewport = screen.getByLabelText("全局提示");

    expect(viewport).toHaveClass("left-1/2", "-translate-x-1/2", "w-fit", "max-w-[min(320px,calc(100vw-48px))]");
    expect(viewport).not.toHaveClass("right-5");
    expect(toastCards).toHaveLength(3);
    expect(toastCards.map((toastCard) => toastCard.textContent)).toEqual(["保存成功", "保存失败", "注意配置"]);
    for (const toastCard of toastCards) {
      expect(toastCard).toHaveClass("rounded-full", "min-h-10", "min-w-[180px]", "px-4", "py-2", "pr-9");
      expect(toastCard).not.toHaveClass("border");
      expect(toastCard.querySelector("span")).not.toBeInTheDocument();
      expect(within(toastCard).getByRole("button", { name: "关闭提示" }).querySelector("svg")).toBeInTheDocument();
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

    expect(visibleToastCards().map((toastCard) => toastCard.textContent)).toEqual(["保存成功", "注意配置"]);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
    expect(screen.queryByText("注意配置")).not.toBeInTheDocument();
  });

  it("allows dismissing a toast manually", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "error" }));
    expect(screen.getByText("保存失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
  });

  it("keeps only one visible toast for the same message and variant", async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "error" }));
    await user.click(screen.getByRole("button", { name: "duplicate error" }));

    expect(screen.getAllByText("保存失败")).toHaveLength(1);
    expect(visibleToastCards()).toHaveLength(1);
  });
});

function visibleToastCards() {
  return within(screen.getByLabelText("全局提示")).getAllByRole("status");
}
