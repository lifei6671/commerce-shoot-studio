import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewCanvas } from "./PreviewCanvas";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const saveMock = vi.mocked(save);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

function createPngBlob() {
  const blob = new Blob([pngBytes], { type: "image/png" });
  Object.defineProperty(blob, "arrayBuffer", {
    value: async () => pngBytes.buffer.slice(0),
  });
  return blob;
}

class MockCanvasImage {
  crossOrigin: string | null = null;
  height = 600;
  naturalHeight = 600;
  naturalWidth = 970;
  onerror: OnErrorEventHandler | null = null;
  onload: (() => void) | null = null;
  srcValue = "";
  width = 970;

  set src(value: string) {
    this.srcValue = value;
    queueMicrotask(() => this.onload?.());
  }
}

function createCanvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    beginPath: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function renderCompleteResult() {
  render(
    <PreviewCanvas
      boards={[]}
      detailImages={[
        {
          assetId: "asset-hero",
          assetRelativePath: "assets/generated/hero.png",
          id: "hero",
          height: 600,
          src: "asset://localhost/workspace/current/assets/generated/hero.png",
          status: "complete",
          title: "首屏主视觉",
          width: 970,
        },
      ]}
    />,
  );
}

function bytesContain(haystack: number[], needle: Uint8Array) {
  return haystack.some((_, start) =>
    Array.from(needle).every((byte, offset) => haystack[start + offset] === byte),
  );
}

describe("PreviewCanvas 结果下载", () => {
  const originalImage = globalThis.Image;
  const originalUserAgent = window.navigator.userAgent;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(undefined);
    saveMock.mockReset();
    vi.restoreAllMocks();
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 commerce-shoot-studio",
    });
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: MockCanvasImage,
    });
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:generated-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, { headers: { "Content-Type": "image/png" } }),
    );
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: originalImage,
    });
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: originalCreateImageBitmap,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it("以 CORS 模式读取 macOS asset 图片并保存真实 PNG 长图", async () => {
    const user = userEvent.setup();
    const context = createCanvasContext();
    const loadedImages: MockCanvasImage[] = [];
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: class extends MockCanvasImage {
        constructor() {
          super();
          loadedImages.push(this);
        }
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(createPngBlob());
    });
    saveMock.mockResolvedValue("/Users/demo/Desktop/detail-long.png");

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "预览长图" }));
    await user.click(screen.getByRole("button", { name: "下载长图" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("asset://localhost/workspace/current/assets/generated/hero.png");
    expect(loadedImages).toHaveLength(1);
    expect(loadedImages[0].crossOrigin).toBe("anonymous");
    expect(loadedImages[0].srcValue).toBe("");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:generated-image");
    expect(context.drawImage).toHaveBeenCalledWith(loadedImages[0], 0, 0, 970, 600);
    expect(invokeMock).toHaveBeenCalledWith("save_generated_asset", {
      bytes: Array.from(pngBytes),
      path: "/Users/demo/Desktop/detail-long.png",
    });
  });

  it("长图合成失败时提示用户并恢复下载按钮", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createCanvasContext());
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {
      throw new DOMException("The operation is insecure", "SecurityError");
    });
    saveMock.mockResolvedValue("/Users/demo/Desktop/detail-long.png");

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "预览长图" }));
    await user.click(screen.getByRole("button", { name: "下载长图" }));

    expect(await screen.findByRole("status")).toHaveTextContent("长图下载失败，请重试");
    expect(screen.getByRole("button", { name: "下载长图" })).toBeEnabled();
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("长图保存期间禁用按钮并阻止重复提交", async () => {
    const user = userEvent.setup();
    const context = createCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(createPngBlob());
    });
    let resolveSave: ((path: string | null) => void) | undefined;
    saveMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "预览长图" }));
    const downloadButton = screen.getByRole("button", { name: "下载长图" });
    fireEvent.click(downloadButton);

    await waitFor(() => expect(downloadButton).toBeDisabled());
    fireEvent.click(downloadButton);
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveSave?.(null));
    await waitFor(() => expect(downloadButton).toBeEnabled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("任一下载进行期间禁用其他类型的下载入口", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createCanvasContext());
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(createPngBlob());
    });
    let resolveSave: ((path: string | null) => void) | undefined;
    saveMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "预览长图" }));
    fireEvent.click(screen.getByRole("button", { name: "下载长图" }));

    const archiveButton = screen.getByRole("button", { name: "下载全部图片" });
    const singleImageButton = screen.getByRole("button", { name: "下载 首屏主视觉" });
    await waitFor(() => {
      expect(archiveButton).toBeDisabled();
      expect(singleImageButton).toBeDisabled();
    });
    fireEvent.click(archiveButton);
    fireEvent.click(singleImageButton);
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveSave?.(null));
    await waitFor(() => {
      expect(archiveButton).toBeEnabled();
      expect(singleImageButton).toBeEnabled();
    });
  });

  it("单图保存期间禁用下载入口并阻止重复提交", async () => {
    let resolveSave: ((path: string | null) => void) | undefined;
    saveMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    renderCompleteResult();
    const downloadButton = screen.getByRole("button", { name: "下载 首屏主视觉" });
    fireEvent.click(downloadButton);

    await waitFor(() => expect(downloadButton).toBeDisabled());
    fireEvent.click(downloadButton);
    expect(saveMock).toHaveBeenCalledTimes(1);

    await act(async () => resolveSave?.(null));
    await waitFor(() => expect(downloadButton).toBeEnabled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("单图超过 IPC 安全上限时不写文件并提示当前限制", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, {
        headers: {
          "Content-Length": String(32 * 1024 * 1024 + 1),
          "Content-Type": "image/png",
        },
      }),
    );

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "下载 首屏主视觉" }));

    expect(await screen.findByRole("status")).toHaveTextContent("图片文件超过 32 MB，当前版本无法下载");
    expect(saveMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("批量下载的 ZIP 包含真实生成图片字节", async () => {
    const user = userEvent.setup();
    const originalImageBytes = new Uint8Array([0x52, 0x45, 0x41, 0x4c, 0x2d, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(originalImageBytes, { headers: { "Content-Type": "image/png" } }),
    );
    saveMock.mockResolvedValue("/Users/demo/Desktop/all.zip");

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "下载全部" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "save_generated_asset",
      expect.objectContaining({ path: "/Users/demo/Desktop/all.zip" }),
    ));
    expect(fetch).toHaveBeenCalledWith("asset://localhost/workspace/current/assets/generated/hero.png");
    const call = invokeMock.mock.calls.find(([command]) => command === "save_generated_asset");
    const bytes = (call?.[1] as { bytes?: number[] } | undefined)?.bytes ?? [];
    expect(bytesContain(bytes, originalImageBytes)).toBe(true);
  });

  it("批量图片超过内存安全上限时停止读取并提示分批下载", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, {
        headers: {
          "Content-Length": String(32 * 1024 * 1024 + 1),
          "Content-Type": "image/png",
        },
      }),
    );
    saveMock.mockResolvedValue("/Users/demo/Desktop/all.zip");

    renderCompleteResult();
    await user.click(screen.getByRole("button", { name: "下载全部" }));

    expect(await screen.findByRole("status")).toHaveTextContent("图片总大小超过 32 MB，请分组或分批下载");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
  });
});
