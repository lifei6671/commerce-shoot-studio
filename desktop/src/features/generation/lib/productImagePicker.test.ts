import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pictureDir } from "@tauri-apps/api/path";
import {
  PRODUCT_IMAGE_DIR_STORAGE_KEY,
  selectProductImages,
} from "./productImagePicker";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("@tauri-apps/api/path", () => ({
  pictureDir: vi.fn(),
}));

const openMock = vi.mocked(open);
const convertFileSrcMock = vi.mocked(convertFileSrc);
const pictureDirMock = vi.mocked(pictureDir);

describe("productImagePicker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    const storage = new Map<string, string>();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        removeItem: vi.fn((key: string) => storage.delete(key)),
        setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      },
    });

    openMock.mockReset();
    convertFileSrcMock.mockClear();
    pictureDirMock.mockReset();
    pictureDirMock.mockResolvedValue("/Users/demo/Pictures");
  });

  it("opens the image dialog from the system pictures directory by default", async () => {
    openMock.mockResolvedValue(["/Users/demo/Pictures/helmet.png"]);

    const images = await selectProductImages(3);

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: false,
        defaultPath: "/Users/demo/Pictures",
        fileAccessMode: "copy",
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"],
          },
        ],
        multiple: true,
      }),
    );
    expect(images).toEqual([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset:///Users/demo/Pictures/helmet.png",
      },
    ]);
    expect(localStorage.getItem(PRODUCT_IMAGE_DIR_STORAGE_KEY)).toBe("/Users/demo/Pictures");
  });

  it("uses the remembered directory on the next image selection", async () => {
    localStorage.setItem(PRODUCT_IMAGE_DIR_STORAGE_KEY, "/Users/demo/Desktop");
    openMock.mockResolvedValue("/Users/demo/Desktop/poster.jpg");

    await selectProductImages(1);

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/Users/demo/Desktop",
      }),
    );
    expect(pictureDirMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(PRODUCT_IMAGE_DIR_STORAGE_KEY)).toBe("/Users/demo/Desktop");
  });

  it("ignores a remembered transient Photos directory", async () => {
    localStorage.setItem(
      PRODUCT_IMAGE_DIR_STORAGE_KEY,
      "/private/var/folders/sq/cache/T/uuid=388B3878-EE4A-42F9/folders/sq",
    );
    openMock.mockResolvedValue(null);

    await selectProductImages(3);

    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/Users/demo/Pictures",
      }),
    );
    expect(localStorage.getItem(PRODUCT_IMAGE_DIR_STORAGE_KEY)).toBeNull();
  });

  it("does not remember transient paths returned by the Photos media picker", async () => {
    localStorage.setItem(PRODUCT_IMAGE_DIR_STORAGE_KEY, "/Users/demo/Pictures");
    openMock.mockResolvedValue(
      "/private/var/folders/sq/cache/T/uuid=388B3878-EE4A-42F9/folders/sq/photo.jpg",
    );

    await selectProductImages(1);

    expect(localStorage.getItem(PRODUCT_IMAGE_DIR_STORAGE_KEY)).toBe("/Users/demo/Pictures");
  });

  it("converts unsupported selected image formats to webp data URLs for AI assist", async () => {
    openMock.mockResolvedValue(["/Users/demo/Pictures/source.bmp"]);
    const fetchMock = vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob([new Uint8Array([9, 8, 7])], { type: "image/bmp" })),
    });
    const closeMock = vi.fn();
    const createImageBitmapMock = vi.fn().mockResolvedValue({
      width: 2,
      height: 1,
      close: closeMock,
    });
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({
            drawImage: vi.fn(),
          })),
          toBlob: vi.fn((callback: BlobCallback, type?: string) => {
            callback(new Blob([new Uint8Array([1, 2, 3])], { type: type ?? "image/webp" }));
          }),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);

    const images = await selectProductImages(1);

    expect(fetchMock).toHaveBeenCalledWith("asset:///Users/demo/Pictures/source.bmp");
    expect(createImageBitmapMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
    expect(images).toEqual([
      {
        id: "/Users/demo/Pictures/source.bmp",
        name: "source.webp",
        path: "/Users/demo/Pictures/source.bmp",
        src: "data:image/webp;base64,AQID",
        aiAssistDataUrl: "data:image/webp;base64,AQID",
        aiAssistMimeType: "image/webp",
      },
    ]);

    createElementSpy.mockRestore();
  });

  it("rejects conversion when the browser cannot encode a real webp blob", async () => {
    openMock.mockResolvedValue(["/Users/demo/Pictures/source.bmp"]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        blob: vi.fn().mockResolvedValue(new Blob([new Uint8Array([9, 8, 7])], { type: "image/bmp" })),
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({
        width: 2,
        height: 1,
        close: vi.fn(),
      }),
    );
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({
            drawImage: vi.fn(),
          })),
          toBlob: vi.fn((callback: BlobCallback) => {
            callback(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
          }),
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    try {
      await expect(selectProductImages(1)).rejects.toThrow("当前浏览器无法将图片转换为 WebP。");
    } finally {
      createElementSpy.mockRestore();
    }
  });
});
