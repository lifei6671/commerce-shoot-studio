import { convertFileSrc } from "@tauri-apps/api/core";
import { pictureDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";

export const PRODUCT_IMAGE_DIR_STORAGE_KEY = "commerce-shoot-studio:product-image-dir";

export type ProductImageAsset = {
  id: string;
  name: string;
  path: string;
  src: string;
};

const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"];

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

  return paths.map(createProductImageAsset);
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

function createProductImageAsset(path: string): ProductImageAsset {
  return {
    id: path,
    name: path.split(/[\\/]/).pop() ?? "商品原图",
    path,
    src: convertFileSrc(path),
  };
}
