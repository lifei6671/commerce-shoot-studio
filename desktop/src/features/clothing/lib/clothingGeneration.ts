import type { GenerationTaskDetail } from "../../../runtime";
import { readOutputString } from "../../generation/lib/generationResultState";
import type { ClothingSceneDraft } from "../types";

export function createClothingSceneDraftsFromTaskDetail(detail: GenerationTaskDetail): ClothingSceneDraft[] {
  const output = detail.output && typeof detail.output === "object" ? (detail.output as Record<string, unknown>) : {};
  const scenes = Array.isArray(output.scenes) ? output.scenes : [];
  const drafts = scenes.flatMap((sceneValue, sceneIndex) => {
    const sceneObject = sceneValue && typeof sceneValue === "object" ? (sceneValue as Record<string, unknown>) : {};
    const scene = readOutputString(sceneObject.scene) || `场景 ${sceneIndex + 1}`;
    const sceneVisualAnchor = readOutputString(sceneObject.sceneVisualAnchor);
    const scenePromptSegment = readOutputString(sceneObject.scenePromptSegment);
    const poses = Array.isArray(sceneObject.recommendedPoses) ? sceneObject.recommendedPoses : [];
    return poses.map((poseValue, poseIndex): ClothingSceneDraft => {
      const poseObject = poseValue && typeof poseValue === "object" ? (poseValue as Record<string, unknown>) : {};
      const cameraSetup =
        poseObject.cameraSetup && typeof poseObject.cameraSetup === "object"
          ? (poseObject.cameraSetup as Record<string, unknown>)
          : {};
      return {
        angle: readOutputString(cameraSetup.perspective) || "正面",
        checked: false,
        description: readOutputString(poseObject.poseAction) || "自然站立，展示服装整体版型",
        framing: readOutputString(cameraSetup.framing) || "全身",
        id: `scene-${sceneIndex + 1}-pose-${poseIndex + 1}`,
        scene,
        scenePromptSegment,
        sceneVisualAnchor,
        shootingPosition: readOutputString(cameraSetup.shootingPosition) || "平视机位",
      };
    });
  });
  if (drafts.length === 0) {
    throw new Error("服饰场景规划结果为空。");
  }
  return drafts;
}

export function readClothingModelFeaturesFromTaskDetail(detail: GenerationTaskDetail): unknown {
  const output = detail.output && typeof detail.output === "object" ? (detail.output as Record<string, unknown>) : {};
  return output.modelFeatures;
}

export function createClothingHistorySummary(drafts: ClothingSceneDraft[]) {
  const sceneNames = Array.from(new Set(drafts.map((draft) => draft.scene))).join("、");
  return `${sceneNames || "服饰场景"} · ${drafts.length} 张`;
}
