import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClothingPreviewCanvas } from "./ClothingPreviewCanvas";

function installMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: vi.fn(),
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  );
}

function currentSlideButton(index: number) {
  return screen.getByRole("button", { name: `查看第 ${index} 张服饰示例` });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ClothingPreviewCanvas", () => {
  it("shows the four apparel images in a stable initial order", () => {
    installMatchMedia(false);
    render(<ClothingPreviewCanvas />);

    const images = screen.getAllByRole("img", { hidden: true });
    expect(images).toHaveLength(4);
    expect(images.map((image) => image.getAttribute("alt"))).toEqual([
      "同场景多姿势服饰示例",
      "多品类童装搭配示例",
      "多场景女装拍摄示例",
      "男装配饰定制示例",
    ]);
    expect(screen.getByRole("img", { name: "同场景多姿势服饰示例" })).toBeInTheDocument();
    expect(currentSlideButton(1)).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("clothing-preview-track")).toHaveStyle({ transform: "translateX(0%)" });
  });

  it("automatically advances every four seconds and loops to the first image", () => {
    installMatchMedia(false);
    vi.useFakeTimers();
    render(<ClothingPreviewCanvas />);

    for (const expectedIndex of [2, 3, 4, 1]) {
      act(() => vi.advanceTimersByTime(4_000));
      expect(currentSlideButton(expectedIndex)).toHaveAttribute("aria-current", "true");
    }
  });

  it("allows manual selection, resets the timer, and pauses while hovered or focused", () => {
    installMatchMedia(false);
    vi.useFakeTimers();
    render(<ClothingPreviewCanvas />);

    const carousel = screen.getByRole("region", { name: "服饰穿戴示例" });
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.click(currentSlideButton(3));
    act(() => vi.advanceTimersByTime(3_999));
    expect(currentSlideButton(3)).toHaveAttribute("aria-current", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(currentSlideButton(4)).toHaveAttribute("aria-current", "true");

    fireEvent.mouseEnter(carousel);
    act(() => vi.advanceTimersByTime(8_000));
    expect(currentSlideButton(4)).toHaveAttribute("aria-current", "true");
    fireEvent.mouseLeave(carousel);
    act(() => vi.advanceTimersByTime(4_000));
    expect(currentSlideButton(1)).toHaveAttribute("aria-current", "true");

    fireEvent.focus(currentSlideButton(2));
    act(() => vi.advanceTimersByTime(8_000));
    expect(currentSlideButton(1)).toHaveAttribute("aria-current", "true");
    fireEvent.blur(currentSlideButton(2), { relatedTarget: null });
    act(() => vi.advanceTimersByTime(4_000));
    expect(currentSlideButton(2)).toHaveAttribute("aria-current", "true");
  });

  it("disables autoplay and slide animation when reduced motion is requested", () => {
    installMatchMedia(true);
    vi.useFakeTimers();
    render(<ClothingPreviewCanvas />);

    act(() => vi.advanceTimersByTime(16_000));
    expect(currentSlideButton(1)).toHaveAttribute("aria-current", "true");
    fireEvent.click(currentSlideButton(2));
    expect(currentSlideButton(2)).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("clothing-preview-track")).toHaveClass("transition-none");
  });
});
