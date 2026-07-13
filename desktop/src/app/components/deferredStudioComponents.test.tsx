import { act, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { createDeferredComponent, DeferredStudioContent } from "./deferredStudioComponents";

it("在异步模块就绪前显示占位，随后渲染目标组件", async () => {
  let resolveModule: ((module: { default: ComponentType }) => void) | undefined;
  const DeferredExample = createDeferredComponent(
    () =>
      new Promise<{ default: ComponentType }>((resolve) => {
        resolveModule = resolve;
      }),
  );

  render(
    <DeferredStudioContent>
      <DeferredExample />
    </DeferredStudioContent>,
  );

  expect(screen.getByTestId("deferred-studio-fallback")).toBeInTheDocument();

  await act(async () => {
    resolveModule?.({ default: () => <div>异步工作区已加载</div> });
  });

  expect(await screen.findByText("异步工作区已加载")).toBeInTheDocument();
  expect(screen.queryByTestId("deferred-studio-fallback")).not.toBeInTheDocument();
});
