import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import {
  ImageTextRecognitionError,
  type ImageTextRecognitionResult,
  type ResultImageTextChange,
} from "../../../runtime";
import { PreviewCanvas, type GeneratedDetailImage } from "./PreviewCanvas";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

const firstImage: GeneratedDetailImage = {
  assetId: "asset-first",
  id: "image-first",
  src: "asset://localhost/first.png",
  status: "complete",
  title: "第一张",
};

const secondImage: GeneratedDetailImage = {
  assetId: "asset-second",
  id: "image-second",
  src: "asset://localhost/second.png",
  status: "complete",
  title: "第二张",
};

const recognition: ImageTextRecognitionResult = {
  items: [
    { box: { height: 0.1, width: 0.3, x: 0.1, y: 0.1 }, id: "line-001", text: "Size Guide" },
    { box: { height: 0.08, width: 0.2, x: 0.2, y: 0.3 }, id: "line-002", text: "Chest" },
    { box: { height: 0.08, width: 0.1, x: 0.4, y: 0.5 }, id: "line-003", text: "XL" },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderTextEditor(
  options: {
    images?: GeneratedDetailImage[];
    onEmptyRecognition?: () => void;
    onRewriteError?: (message: string) => void;
    recognize?: (image: GeneratedDetailImage) => Promise<ImageTextRecognitionResult>;
    rewrite?: (image: GeneratedDetailImage, changes: ResultImageTextChange[]) => Promise<void> | void;
  } = {},
) {
  const recognize = options.recognize ?? vi.fn().mockResolvedValue(recognition);
  const rewrite = options.rewrite ?? vi.fn().mockResolvedValue(undefined);
  const result = render(
    <PreviewCanvas
      boards={[]}
      detailImages={options.images ?? [firstImage]}
      onImageTextRecognitionEmpty={options.onEmptyRecognition}
      onImageTextRewriteError={options.onRewriteError}
      onImageTextRewrite={rewrite}
      onRecognizeImageText={recognize}
    />,
  );
  return { ...result, recognize, rewrite };
}

describe("PreviewCanvas 图片文字编辑", () => {
  it("打开后显示可访问骨架，并在识别完成后按行展示且保持确认禁用", async () => {
    const request = deferred<ImageTextRecognitionResult>();
    const user = userEvent.setup();
    renderTextEditor({ recognize: vi.fn(() => request.promise) });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));

    const dialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(within(dialog).getByTestId("image-text-recognition-skeleton")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("正在识别图片文字");
    expect(within(dialog).getByRole("button", { name: "确认改字" })).toBeDisabled();

    await act(async () => request.resolve(recognition));

    expect(within(dialog).getByDisplayValue("Size Guide")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Chest")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("XL")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认改字" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "确认改字" })).toHaveTextContent(/^确认改字$/);
  });

  it("当前会话空识别结果通知一次并关闭浮层", async () => {
    const user = userEvent.setup();
    const onEmptyRecognition = vi.fn();
    renderTextEditor({ onEmptyRecognition, recognize: vi.fn().mockResolvedValue({ items: [] }) });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument());
    expect(onEmptyRecognition).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue("Size Guide")).not.toBeInTheDocument();
  });

  it("关闭后旧会话晚到空识别结果不通知且不影响新会话", async () => {
    const firstRequest = deferred<ImageTextRecognitionResult>();
    const secondRequest = deferred<ImageTextRecognitionResult>();
    const onEmptyRecognition = vi.fn();
    const recognize = vi.fn().mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
    const user = userEvent.setup();
    renderTextEditor({ images: [firstImage, secondImage], onEmptyRecognition, recognize });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    await user.click(screen.getByRole("button", { name: "关闭编辑文字" }));
    await user.click(screen.getByRole("button", { name: "编辑文字 第二张" }));

    await act(async () => firstRequest.resolve({ items: [] }));

    expect(onEmptyRecognition).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(within(dialog).getByTestId("image-text-recognition-skeleton")).toBeInTheDocument();

    await act(async () => secondRequest.resolve(recognition));
    expect(within(dialog).getByDisplayValue("Size Guide")).toBeInTheDocument();
    expect(onEmptyRecognition).not.toHaveBeenCalled();
  });

  it("仅可重试识别错误显示重试，并用新请求替换错误态", async () => {
    const user = userEvent.setup();
    const recognize = vi
      .fn()
      .mockRejectedValueOnce(
        new ImageTextRecognitionError({ code: "PROVIDER_TIMEOUT", message: "识别超时，请重试。", retryable: true }),
      )
      .mockResolvedValueOnce(recognition);
    renderTextEditor({ recognize });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const dialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(await within(dialog).findByText("识别超时，请重试。")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "重试" }));

    expect(await within(dialog).findByDisplayValue("Size Guide")).toBeInTheDocument();
    expect(recognize).toHaveBeenCalledTimes(2);

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    const unavailable = vi.fn().mockRejectedValue(
      new ImageTextRecognitionError({
        code: "MODEL_CAPABILITY_UNAVAILABLE",
        message: "未配置图生文模型。",
        retryable: false,
      }),
    );
    const { rerender } = renderTextEditor({ images: [secondImage], recognize: unavailable });
    await user.click(screen.getByRole("button", { name: "编辑文字 第二张" }));
    const unavailableDialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(await within(unavailableDialog).findByText("未配置图生文模型。")).toBeInTheDocument();
    expect(within(unavailableDialog).queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    rerender(<div />);
  });

  it("只提交有效变化，并把清空行显式转换为 delete", async () => {
    const user = userEvent.setup();
    const rewrite = vi.fn().mockResolvedValue(undefined);
    renderTextEditor({ rewrite });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const dialog = screen.getByRole("dialog", { name: "编辑文字" });
    const inputs = await within(dialog).findAllByRole("textbox");
    await user.clear(inputs[0]);
    await user.type(inputs[0], "  尺码指南  ");
    await user.clear(inputs[1]);

    const confirmButton = within(dialog).getByRole("button", { name: "确认改字" });
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() =>
      expect(rewrite).toHaveBeenCalledWith(firstImage, [
        {
          box: recognition.items[0].box,
          lineId: "line-001",
          operation: "replace",
          originalText: "Size Guide",
          replacementText: "尺码指南",
        },
        {
          box: recognition.items[1].box,
          lineId: "line-002",
          operation: "delete",
          originalText: "Chest",
        },
      ]),
    );
  });

  it("提交中禁止关闭，失败后保留用户编辑并允许重试", async () => {
    const request = deferred<void>();
    const user = userEvent.setup();
    const rewrite = vi.fn(() => request.promise);
    const onRewriteError = vi.fn();
    renderTextEditor({ onRewriteError, rewrite });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const dialog = screen.getByRole("dialog", { name: "编辑文字" });
    const firstInput = await within(dialog).findByDisplayValue("Size Guide");
    await user.clear(firstInput);
    await user.type(firstInput, "尺码指南");
    await user.click(within(dialog).getByRole("button", { name: "确认改字" }));

    expect(within(dialog).getByRole("button", { name: "关闭编辑文字" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "确认改字" })).toHaveAttribute("aria-busy", "true");
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: "编辑文字" })).toBeInTheDocument();

    await act(async () => request.reject(new Error("改字失败")));

    expect(within(dialog).getByDisplayValue("尺码指南")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "关闭编辑文字" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "确认改字" })).toBeEnabled();
    expect(onRewriteError).toHaveBeenCalledWith("改字失败");
  });

  it("关闭后打开另一图片时丢弃上一会话的晚到识别响应", async () => {
    const firstRequest = deferred<ImageTextRecognitionResult>();
    const secondRequest = deferred<ImageTextRecognitionResult>();
    const recognize = vi.fn().mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
    const user = userEvent.setup();
    renderTextEditor({ images: [firstImage, secondImage], recognize });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    await user.click(screen.getByRole("button", { name: "关闭编辑文字" }));
    await user.click(screen.getByRole("button", { name: "编辑文字 第二张" }));

    await act(async () => firstRequest.resolve(recognition));
    const dialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(within(dialog).getByTestId("image-text-recognition-skeleton")).toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue("Size Guide")).not.toBeInTheDocument();

    await act(async () =>
      secondRequest.resolve({
        items: [{ box: { height: 0.1, width: 0.2, x: 0.2, y: 0.2 }, id: "line-001", text: "第二张文字" }],
      }),
    );
    expect(within(dialog).getByDisplayValue("第二张文字")).toBeInTheDocument();
  });

  it("旧会话提交成功不会关闭后来打开的新会话", async () => {
    const rewriteRequest = deferred<void>();
    const user = userEvent.setup();
    const recognize = vi.fn(async (image: GeneratedDetailImage) => ({
      items: [
        {
          box: { height: 0.1, width: 0.2, x: 0.2, y: 0.2 },
          id: "line-001",
          text: image.id === firstImage.id ? "第一张文字" : "第二张文字",
        },
      ],
    }));
    const { rerender } = renderTextEditor({
      images: [firstImage, secondImage],
      recognize,
      rewrite: vi.fn(() => rewriteRequest.promise),
    });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const firstInput = await screen.findByDisplayValue("第一张文字");
    await user.clear(firstInput);
    await user.type(firstInput, "第一张新文字");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    await user.click(screen.getByRole("button", { name: "编辑文字 第二张" }));
    expect(await screen.findByDisplayValue("第二张文字")).toBeInTheDocument();

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[{ ...firstImage, assetId: "asset-first-replaced" }, secondImage]}
        onImageTextRewrite={vi.fn(() => rewriteRequest.promise)}
        onRecognizeImageText={recognize}
      />,
    );

    await act(async () => rewriteRequest.resolve());

    expect(screen.getByRole("dialog", { name: "编辑文字" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("第二张文字")).toBeInTheDocument();
  });

  it("旧会话提交失败不会提示或改变后来打开的新会话", async () => {
    const rewriteRequest = deferred<void>();
    const onRewriteError = vi.fn();
    const user = userEvent.setup();
    const recognize = vi.fn(async (image: GeneratedDetailImage) => ({
      items: [
        {
          box: { height: 0.1, width: 0.2, x: 0.2, y: 0.2 },
          id: "line-001",
          text: image.id === firstImage.id ? "第一张文字" : "第二张文字",
        },
      ],
    }));
    renderTextEditor({
      images: [firstImage, secondImage],
      onRewriteError,
      recognize,
      rewrite: vi.fn(() => rewriteRequest.promise),
    });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const firstInput = await screen.findByDisplayValue("第一张文字");
    await user.clear(firstInput);
    await user.type(firstInput, "第一张新文字");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    await user.click(screen.getByRole("button", { name: "编辑文字 第二张" }));
    expect(await screen.findByDisplayValue("第二张文字")).toBeInTheDocument();

    await act(async () => rewriteRequest.reject(new Error("第一张改字失败")));

    expect(onRewriteError).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "编辑文字" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("第二张文字")).toBeInTheDocument();
  });

  it("提交期间源资产变化后失败时关闭旧浮层且不恢复旧编辑态", async () => {
    const rewriteRequest = deferred<void>();
    const onRewriteError = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderTextEditor({
      onRewriteError,
      rewrite: vi.fn(() => rewriteRequest.promise),
    });

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const firstInput = await screen.findByDisplayValue("Size Guide");
    await user.clear(firstInput);
    await user.type(firstInput, "尺码指南");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[{ ...firstImage, assetId: "asset-replaced", src: "asset://localhost/replaced.png" }]}
        onImageTextRewrite={vi.fn(() => rewriteRequest.promise)}
        onImageTextRewriteError={onRewriteError}
        onRecognizeImageText={vi.fn().mockResolvedValue(recognition)}
      />,
    );
    await act(async () => rewriteRequest.reject(new Error("旧资产改字失败")));

    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("尺码指南")).not.toBeInTheDocument();
    expect(onRewriteError).toHaveBeenCalledWith("当前图片已变化，请重新识别文字。");
  });

  it("当前图片资产变化时关闭浮层并丢弃旧资产识别结果", async () => {
    const request = deferred<ImageTextRecognitionResult>();
    const user = userEvent.setup();
    const { rerender } = renderTextEditor({ recognize: vi.fn(() => request.promise) });
    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[{ ...firstImage, assetId: "asset-replaced", src: "asset://localhost/replaced.png" }]}
        onImageTextRewrite={vi.fn()}
        onRecognizeImageText={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();

    await act(async () => request.resolve(recognition));
    expect(screen.queryByDisplayValue("Size Guide")).not.toBeInTheDocument();
  });

  it("切换历史作用域时即使图片和资产标识相同也关闭旧浮层", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={vi.fn()}
        onRecognizeImageText={vi.fn().mockResolvedValue(recognition)}
        textEditScopeId="record-a"
      />,
    );
    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    expect(await screen.findByDisplayValue("Size Guide")).toBeInTheDocument();

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={vi.fn()}
        onRecognizeImageText={vi.fn().mockResolvedValue(recognition)}
        textEditScopeId="record-b"
      />,
    );

    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();
  });

  it("提交中切换历史作用域后旧成功不关闭新浮层或误标新记录", async () => {
    const rewriteRequest = deferred<void>();
    const recognize = vi.fn().mockResolvedValue(recognition);
    const rewrite = vi.fn(() => rewriteRequest.promise);
    const user = userEvent.setup();
    const { rerender } = render(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-a"
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const firstInput = await screen.findByDisplayValue("Size Guide");
    await user.clear(firstInput);
    await user.type(firstInput, "尺码指南");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-b"
      />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "编辑文字 第一张" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    expect(await screen.findByDisplayValue("Size Guide")).toBeInTheDocument();

    await act(async () => rewriteRequest.resolve());

    expect(screen.getByRole("dialog", { name: "编辑文字" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Size Guide")).toBeInTheDocument();
  });

  it("提交中切换历史作用域后旧失败不提示或污染同图片新记录", async () => {
    const rewriteRequest = deferred<void>();
    const onRewriteError = vi.fn();
    const recognize = vi.fn().mockResolvedValue(recognition);
    const rewrite = vi.fn(() => rewriteRequest.promise);
    const user = userEvent.setup();
    const { rerender } = render(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onImageTextRewriteError={onRewriteError}
        onRecognizeImageText={recognize}
        textEditScopeId="record-a"
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const firstInput = await screen.findByDisplayValue("Size Guide");
    await user.clear(firstInput);
    await user.type(firstInput, "尺码指南");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onImageTextRewriteError={onRewriteError}
        onRecognizeImageText={recognize}
        textEditScopeId="record-b"
      />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "编辑文字 第一张" })).toBeInTheDocument();

    await act(async () => rewriteRequest.reject(new Error("旧记录改字失败")));

    expect(onRewriteError).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑文字 第一张" })).toBeInTheDocument();
  });

  it("提交期间卸载并重挂同一作用域后仍保持锁定直到原请求结束", async () => {
    const rewriteRequest = deferred<void>();
    const recognize = vi.fn().mockResolvedValue(recognition);
    const rewrite = vi.fn(() => rewriteRequest.promise);
    const user = userEvent.setup();
    const firstRender = render(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-a"
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const firstInput = await screen.findByDisplayValue("Size Guide");
    await user.clear(firstInput);
    await user.type(firstInput, "记录 A 文字");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    firstRender.unmount();
    render(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-a"
      />,
    );

    const remountedCard = screen.getByTestId("generated-detail-image-card");
    expect(within(remountedCard).getByText("AI 生成中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑文字 第一张" })).not.toBeInTheDocument();
    expect(rewrite).toHaveBeenCalledTimes(1);

    await act(async () => rewriteRequest.resolve());

    expect(await screen.findByRole("button", { name: "编辑文字 第一张" })).toBeInTheDocument();
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it("不同历史作用域独立保留提交锁且迟到 finally 只解锁对应记录", async () => {
    const recordARewriteRequest = deferred<void>();
    const recordBRewriteRequest = deferred<void>();
    const recognize = vi.fn().mockResolvedValue(recognition);
    const rewrite = vi
      .fn()
      .mockReturnValueOnce(recordARewriteRequest.promise)
      .mockReturnValueOnce(recordBRewriteRequest.promise);
    const recordBImages = [firstImage, { ...secondImage, status: "generating" as const }];
    const user = userEvent.setup();
    const firstImageCard = () => screen.getAllByTestId("generated-detail-image-card")[0];
    const { rerender } = render(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-a"
      />,
    );

    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const recordAInput = await screen.findByDisplayValue("Size Guide");
    await user.clear(recordAInput);
    await user.type(recordAInput, "记录 A 文字");
    await user.click(screen.getByRole("button", { name: "确认改字" }));

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={recordBImages}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-b"
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "编辑文字 第一张" }));
    const recordBInput = await screen.findByDisplayValue("Size Guide");
    await user.clear(recordBInput);
    await user.type(recordBInput, "记录 B 文字");
    await user.click(screen.getByRole("button", { name: "确认改字" }));
    expect(within(firstImageCard()).getByText("AI 生成中")).toBeInTheDocument();

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={[firstImage]}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-a"
      />,
    );
    expect(within(firstImageCard()).getByText("AI 生成中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑文字 第一张" })).not.toBeInTheDocument();

    await act(async () => recordARewriteRequest.resolve());

    expect(await screen.findByRole("button", { name: "编辑文字 第一张" })).toBeInTheDocument();

    rerender(
      <PreviewCanvas
        boards={[]}
        detailImages={recordBImages}
        onImageTextRewrite={rewrite}
        onRecognizeImageText={recognize}
        textEditScopeId="record-b"
      />,
    );

    expect(within(firstImageCard()).getByText("AI 生成中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑文字 第一张" })).not.toBeInTheDocument();

    await act(async () => recordBRewriteRequest.resolve());
    expect(await screen.findByRole("button", { name: "编辑文字 第一张" })).toBeInTheDocument();
  });
});
