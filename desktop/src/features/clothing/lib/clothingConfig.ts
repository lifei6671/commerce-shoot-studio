import type { ClothingConfigState, ClothingSceneDraft } from "../types";

const clothingSceneDrafts: ClothingSceneDraft[] = [
  {
    id: "urban-stand",
    scene: "都市街头",
    checked: true,
    description: "自然站立，双手插裤兜，肩膀微抬，直视镜头，清晰展示背心正面印花",
    framing: "全身",
    angle: "正面",
    sceneVisualAnchor: "城市街道人行道，背景为商业街区与轻微虚化的店铺门头",
    scenePromptSegment: "街头时尚摄影，自然光充足照明，色彩还原准确，对焦清晰锐利",
    shootingPosition: "平视机位",
  },
  {
    id: "urban-step",
    scene: "都市街头",
    checked: true,
    description: "侧身迈步向前走，一只手自然搭在裤边，转头看向前方，展示背心侧部剪裁",
    framing: "四分之三",
    angle: "3/4 侧",
    sceneVisualAnchor: "城市街道人行道，背景为商业街区与轻微虚化的店铺门头",
    scenePromptSegment: "街头时尚摄影，自然光充足照明，色彩还原准确，对焦清晰锐利",
    shootingPosition: "平视机位",
  },
  {
    id: "urban-road",
    scene: "都市街头",
    checked: true,
    description: "侧身靠在路牌上，一只手随意抬至脑后，展示背心肩线与手臂线条",
    framing: "半身",
    angle: "侧面",
    sceneVisualAnchor: "城市街道人行道，背景为商业街区与轻微虚化的店铺门头",
    scenePromptSegment: "街头时尚摄影，自然光充足照明，色彩还原准确，对焦清晰锐利",
    shootingPosition: "平视机位",
  },
  {
    id: "urban-front",
    scene: "都市街头",
    checked: false,
    description: "身体微向前倾，双手自然垂在身侧，下颌微抬，展示背心整体版型",
    framing: "全身",
    angle: "正面",
    sceneVisualAnchor: "城市街道人行道，背景为商业街区与轻微虚化的店铺门头",
    scenePromptSegment: "街头时尚摄影，自然光充足照明，色彩还原准确，对焦清晰锐利",
    shootingPosition: "平视机位",
  },
  {
    id: "cafe-sit",
    scene: "街角咖啡",
    checked: true,
    description: "坐在户外木椅上，身体放松靠向椅背，双手搭在桌沿，清晰展示背心正面",
    framing: "全身",
    angle: "正面",
    sceneVisualAnchor: "临街咖啡馆外摆座位，背景为玻璃窗、木质桌椅和暖色自然光",
    scenePromptSegment: "都市通勤服饰摄影，柔和自然侧光，背景轻微虚化，商业成片质感",
    shootingPosition: "平视机位",
  },
  {
    id: "cafe-turn",
    scene: "街角咖啡",
    checked: true,
    description: "站在咖啡店旁，一只手拿着冰咖啡，转头看向侧边，展示背心胸部轮廓",
    framing: "四分之三",
    angle: "3/4 侧",
    sceneVisualAnchor: "临街咖啡馆外摆座位，背景为玻璃窗、木质桌椅和暖色自然光",
    scenePromptSegment: "都市通勤服饰摄影，柔和自然侧光，背景轻微虚化，商业成片质感",
    shootingPosition: "平视机位",
  },
  {
    id: "cafe-lean",
    scene: "街角咖啡",
    checked: true,
    description: "侧身倚靠在咖啡店门框远方，展示背心肩线，姿态放松自然",
    framing: "半身",
    angle: "侧面",
    sceneVisualAnchor: "临街咖啡馆外摆座位，背景为玻璃窗、木质桌椅和暖色自然光",
    scenePromptSegment: "都市通勤服饰摄影，柔和自然侧光，背景轻微虚化，商业成片质感",
    shootingPosition: "平视机位",
  },
];

export const defaultClothingConfig: ClothingConfigState = {
  aiRecommended: false,
  aiModelAge: "青年",
  aiModelBody: "匀称",
  aiModelEthnicity: "中国人",
  aiModelGender: "男",
  aiModelAppearance: "",
  clothingImages: [],
  customScene: "",
  generatedBaseModelImages: [],
  modelMode: "library",
  modelImages: [],
  ratio: "3:4",
  sceneIds: ["纯色棚拍", "都市街头"],
  selectedModelId: null,
};

export function createDefaultClothingSceneDrafts(): ClothingSceneDraft[] {
  return clothingSceneDrafts.map((draft) => ({ ...draft, checked: false }));
}

export class ClothingBaseModelGenerationCancelledError extends Error {
  constructor() {
    super("基准模特生成已取消。");
    this.name = "ClothingBaseModelGenerationCancelledError";
  }
}

export function isClothingBaseModelGenerationCancelledError(error: unknown) {
  return error instanceof ClothingBaseModelGenerationCancelledError;
}
