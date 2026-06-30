import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
