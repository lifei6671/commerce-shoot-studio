import { ClothingConfigPanel, ClothingSceneSelectionPanel } from "./ClothingConfigPanel";
import type {
  BaseModelGenerationInput,
  ClothingConfigState,
  ClothingSceneDraft,
  GeneratedBaseModelImage,
} from "../types";

type ClothingWorkspacePanelProps = {
  baseModelGenerationSessionId: number;
  config: ClothingConfigState;
  drafts: ClothingSceneDraft[];
  onBackFromScenePlan: () => void;
  onConfigChange: (config: ClothingConfigState) => void;
  onDraftsChange: (drafts: ClothingSceneDraft[]) => void;
  onGenerateBaseModel: (input: BaseModelGenerationInput) => Promise<GeneratedBaseModelImage>;
  onGenerateSceneImages: (drafts: ClothingSceneDraft[]) => void;
  onGenerateScenePlan: (config: ClothingConfigState) => void;
  planning: boolean;
  sceneDrafting: boolean;
  sceneGenerating: boolean;
};

export function ClothingWorkspacePanel({
  baseModelGenerationSessionId,
  config,
  drafts,
  onBackFromScenePlan,
  onConfigChange,
  onDraftsChange,
  onGenerateBaseModel,
  onGenerateSceneImages,
  onGenerateScenePlan,
  planning,
  sceneDrafting,
  sceneGenerating,
}: ClothingWorkspacePanelProps) {
  return sceneDrafting ? (
    <ClothingSceneSelectionPanel
      drafts={drafts}
      onBack={onBackFromScenePlan}
      onChange={onDraftsChange}
      onGenerateSceneImages={onGenerateSceneImages}
      planning={planning}
      sceneGenerating={sceneGenerating}
    />
  ) : (
    <ClothingConfigPanel
      baseModelGenerationSessionId={baseModelGenerationSessionId}
      config={config}
      onChange={onConfigChange}
      onGenerateBaseModel={onGenerateBaseModel}
      onGenerateScenes={onGenerateScenePlan}
    />
  );
}
