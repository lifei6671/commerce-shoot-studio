import { SceneConfigPanel } from "./SceneConfigPanel";
import { ScenePromptReviewPanel } from "./ScenePromptReviewPanel";
import type { SceneConfigState, SceneImagePlan } from "../lib/sceneImagePlan";

type SceneWorkspacePanelProps = {
  campaignStyleLock: string;
  config: SceneConfigState;
  imageGenerating: boolean;
  onBack: () => void;
  onChange: (config: SceneConfigState) => void;
  onGenerateImages: (plans: SceneImagePlan[]) => void;
  onGeneratePlan: () => void;
  planGenerating: boolean;
  plans: SceneImagePlan[];
  promptReviewing: boolean;
};

export function SceneWorkspacePanel({
  campaignStyleLock,
  config,
  imageGenerating,
  onBack,
  onChange,
  onGenerateImages,
  onGeneratePlan,
  planGenerating,
  plans,
  promptReviewing,
}: SceneWorkspacePanelProps) {
  return promptReviewing ? (
    <ScenePromptReviewPanel
      campaignStyleLock={campaignStyleLock}
      config={config}
      imageGenerating={imageGenerating}
      onBack={onBack}
      onGenerateImages={onGenerateImages}
      planGenerating={planGenerating}
      plans={plans}
    />
  ) : (
    <SceneConfigPanel config={config} onChange={onChange} onGeneratePlan={onGeneratePlan} />
  );
}
