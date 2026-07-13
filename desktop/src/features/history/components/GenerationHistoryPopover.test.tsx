import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import type { GenerationRecord } from "./GenerationHistoryPopover";
import { GenerationHistoryPopover } from "./GenerationHistoryPopover";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createRecords(
  count: number,
  workspace: GenerationRecord["workspace"] = "product",
  titlePrefix = "记录",
): GenerationRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: Date.parse("2026-07-13T00:00:00.000Z") - index * 60_000,
    id: `${workspace}-${index + 1}`,
    images: [],
    inputSummary: "3:4 · 1 张",
    kind:
      workspace === "product"
        ? ("product-detail" as const)
        : workspace === "scene"
          ? ("scene-generation" as const)
          : ("clothing-scene" as const),
    status: "complete" as const,
    title: `${titlePrefix} ${String(index + 1).padStart(2, "0")}`,
    workspace,
  }));
}

function renderHistory(records: GenerationRecord[]) {
  return render(
    <GenerationHistoryPopover
      activeRecordId={null}
      onClearRecords={() => undefined}
      onClose={() => undefined}
      onDeleteRecord={() => undefined}
      onOpenRecord={() => undefined}
      open
      records={records}
    />,
  );
}

function scrollList(list: HTMLElement, scrollTop: number) {
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollTop: { configurable: true, value: scrollTop, writable: true },
  });
  fireEvent.scroll(list);
}

function scrollNearBottom(list: HTMLElement) {
  scrollList(list, 550);
}

it("默认渲染 10 条记录，并在滚动到底部时每次追加 10 条", () => {
  renderHistory(createRecords(25));

  const list = screen.getByRole("region", { name: "生成记录列表" });
  expect(within(list).getByText("记录 10")).toBeInTheDocument();
  expect(within(list).queryByText("记录 11")).not.toBeInTheDocument();

  scrollList(list, 0);
  expect(within(list).queryByText("记录 11")).not.toBeInTheDocument();

  scrollNearBottom(list);
  expect(within(list).getByText("记录 20")).toBeInTheDocument();
  expect(within(list).queryByText("记录 21")).not.toBeInTheDocument();

  scrollNearBottom(list);
  expect(within(list).getByText("记录 25")).toBeInTheDocument();
});

it("切换筛选后重置为该分类的前 10 条", () => {
  renderHistory([
    ...createRecords(15, "product", "商品记录"),
    ...createRecords(15, "scene", "场景记录"),
  ]);

  const list = screen.getByRole("region", { name: "生成记录列表" });
  scrollNearBottom(list);
  fireEvent.click(screen.getByRole("button", { name: "场景" }));

  expect(within(list).getByText("场景记录 10")).toBeInTheDocument();
  expect(within(list).queryByText("场景记录 11")).not.toBeInTheDocument();
  expect(within(list).queryByText("商品记录 01")).not.toBeInTheDocument();
});

it("删除已显示记录后自动补入下一条", () => {
  const records = createRecords(11);
  const view = renderHistory(records);

  const list = screen.getByRole("region", { name: "生成记录列表" });
  expect(within(list).queryByText("记录 11")).not.toBeInTheDocument();

  view.rerender(
    <GenerationHistoryPopover
      activeRecordId={null}
      onClearRecords={() => undefined}
      onClose={() => undefined}
      onDeleteRecord={() => undefined}
      onOpenRecord={() => undefined}
      open
      records={records.slice(1)}
    />,
  );

  expect(within(list).getByText("记录 11")).toBeInTheDocument();
});

it("首批记录未形成滚动条时通过底部哨兵继续加载", () => {
  let intersectionCallback: IntersectionObserverCallback | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      disconnect() {}
      observe() {}
    },
  );

  renderHistory(createRecords(25));
  const list = screen.getByRole("region", { name: "生成记录列表" });
  Object.defineProperties(list, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 400 },
  });
  expect(within(list).queryByText("记录 11")).not.toBeInTheDocument();

  act(() => {
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });

  expect(within(list).getByText("记录 20")).toBeInTheDocument();
  expect(within(list).queryByText("记录 21")).not.toBeInTheDocument();
});
