import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

const loadClothingWorkspace = () => import("../../features/clothing/components/ClothingWorkspacePanel");
const loadClothingPreview = () => import("../../features/clothing/components/ClothingPreviewCanvas");
const loadSceneWorkspace = () => import("../../features/scenes/components/SceneWorkspacePanel");
const loadScenePreview = () => import("../../features/scenes/components/ScenePreviewCanvas");
const loadGenerationHistory = () => import("../../features/history/components/GenerationHistoryPopover");
const loadModelConfig = () => import("../../features/model-config/components/ModelConfigPage");
const loadSettings = () => import("../../features/settings/components/SettingsPage");

export function createDeferredComponent<Component extends ComponentType<any>>(
  loader: () => Promise<{ default: Component }>,
) {
  return lazy(loader);
}

export const DeferredClothingWorkspacePanel = createDeferredComponent(() =>
  loadClothingWorkspace().then((module) => ({
    default: module.ClothingWorkspacePanel,
  })),
);

export const DeferredClothingPreviewCanvas = createDeferredComponent(() =>
  loadClothingPreview().then((module) => ({
    default: module.ClothingPreviewCanvas,
  })),
);

export const DeferredSceneWorkspacePanel = createDeferredComponent(() =>
  loadSceneWorkspace().then((module) => ({
    default: module.SceneWorkspacePanel,
  })),
);

export const DeferredScenePreviewCanvas = createDeferredComponent(() =>
  loadScenePreview().then((module) => ({
    default: module.ScenePreviewCanvas,
  })),
);

export const DeferredGenerationHistoryPopover = createDeferredComponent(() =>
  loadGenerationHistory().then((module) => ({
    default: module.GenerationHistoryPopover,
  })),
);

export const DeferredModelConfigPage = createDeferredComponent(() =>
  loadModelConfig().then((module) => ({
    default: module.ModelConfigPage,
  })),
);

export const DeferredSettingsPage = createDeferredComponent(() =>
  loadSettings().then((module) => ({
    default: module.SettingsPage,
  })),
);

export function DeferredStudioContent({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div aria-hidden="true" className="h-full w-full" data-testid="deferred-studio-fallback" />}>
      {children}
    </Suspense>
  );
}
