import { convertFileSrc } from "@tauri-apps/api/core";
import { pictureDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";

export const PRODUCT_IMAGE_DIR_STORAGE_KEY = "commerce-shoot-studio:product-image-dir";

export type ProductImageAsset = {
  id: string;
  name: string;
  path: string;
  src: string;
  aiAssistDataUrl?: string;
  aiAssistMimeType?: string;
};

const passthroughImageExtensions = ["png", "jpg", "jpeg", "webp"];
const imageExtensions = [...passthroughImageExtensions, "gif", "bmp", "tif", "tiff", "heic", "heif"];

export async function selectProductImages(limit: number): Promise<ProductImageAsset[]> {
  if (limit <= 0) {
    return [];
  }

  const defaultPath = await getProductImageDialogDefaultPath();
  const selected = await open({
    title: "选择商品原图",
    multiple: limit > 1,
    directory: false,
    defaultPath,
    fileAccessMode: "copy",
    filters: [
      {
        name: "Images",
        extensions: imageExtensions,
      },
    ],
  });

  if (!selected) {
    return [];
  }

  const paths = normalizeSelectedPaths(selected).slice(0, limit);
  if (paths.length === 0) {
    return [];
  }

  rememberSelectedProductImageDirectory(paths[0]);

  return Promise.all(paths.map(createProductImageAsset));
}

async function getProductImageDialogDefaultPath() {
  return getRememberedProductImageDirectory() ?? (await pictureDir());
}

function getRememberedProductImageDirectory() {
  const directory = localStorage.getItem(PRODUCT_IMAGE_DIR_STORAGE_KEY);
  if (!directory) {
    return null;
  }

  if (isTransientMacosDirectory(directory)) {
    localStorage.removeItem(PRODUCT_IMAGE_DIR_STORAGE_KEY);
    return null;
  }

  return directory;
}

function rememberSelectedProductImageDirectory(path: string) {
  const selectedDirectory = path.replace(/[\\/][^\\/]*$/, "");
  if (!selectedDirectory || selectedDirectory === path || isTransientMacosDirectory(selectedDirectory)) {
    return;
  }

  localStorage.setItem(PRODUCT_IMAGE_DIR_STORAGE_KEY, selectedDirectory);
}

function isTransientMacosDirectory(directory: string) {
  const normalizedDirectory = directory.replace(/\\/g, "/");

  return (
    normalizedDirectory.startsWith("/private/var/folders/") ||
    normalizedDirectory.startsWith("/var/folders/") ||
    normalizedDirectory.startsWith("/private/tmp/") ||
    normalizedDirectory.startsWith("/tmp/") ||
    normalizedDirectory.includes("/TemporaryItems/") ||
    normalizedDirectory.includes("/uuid=")
  );
}

function normalizeSelectedPaths(selected: string | string[] | null): string[] {
  if (!selected) {
    return [];
  }

  return Array.isArray(selected) ? selected : [selected];
}

async function createProductImageAsset(path: string): Promise<ProductImageAsset> {
  const asset = {
    id: path,
    name: path.split(/[\\/]/).pop() ?? "商品原图",
    path,
    src: convertFileSrc(path),
  };
  if (shouldConvertToWebp(path)) {
    const dataUrl = await convertImagePathToWebpDataUrl(asset.src);
    return {
      ...asset,
      name: replaceImageExtension(asset.name, "webp"),
      src: dataUrl,
      aiAssistDataUrl: dataUrl,
      aiAssistMimeType: "image/webp",
    };
  }

  return asset;
}

function shouldConvertToWebp(path: string) {
  const extension = path
    .split(/[\\/]/)
    .pop()
    ?.split(".")
    .pop()
    ?.toLowerCase();

  return extension ? !passthroughImageExtensions.includes(extension) : true;
}

function replaceImageExtension(name: string, extension: string) {
  if (!name.includes(".")) {
    return `${name}.${extension}`;
  }

  return name.replace(/\.[^.]+$/, `.${extension}`);
}

async function convertImagePathToWebpDataUrl(src: string) {
  const response = await fetch(src);
  const sourceBlob = await response.blob();
  const decodedImage = await decodeImageBlob(sourceBlob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = decodedImage.width;
    canvas.height = decodedImage.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前浏览器无法创建图片转换画布。");
    }
    context.drawImage(decodedImage, 0, 0);
    const webpBlob = await canvasToWebpBlob(canvas);
    return blobToDataUrl(webpBlob);
  } finally {
    if ("close" in decodedImage && typeof decodedImage.close === "function") {
      decodedImage.close();
    }
  }
}

async function decodeImageBlob(blob: Blob): Promise<(CanvasImageSource & { width: number; height: number })> {
  if ("createImageBitmap" in window) {
    return createImageBitmap(blob);
  }

  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("当前浏览器无法解析该图片格式。"));
    };
    image.src = objectUrl;
  });
}

function canvasToWebpBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("当前浏览器无法将图片转换为 WebP。"));
          return;
        }
        if (blob.type.toLowerCase() !== "image/webp") {
          reject(new Error("当前浏览器无法将图片转换为 WebP。"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.92,
    );
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("当前浏览器无法读取转换后的 WebP 图片。"));
    };
    reader.onerror = () => reject(new Error("当前浏览器无法读取转换后的 WebP 图片。"));
    reader.readAsDataURL(blob);
  });
}
