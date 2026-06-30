import type { ProductImageAsset } from "../../generation/lib/productImagePicker";

export type SceneOutputMode = "single" | "hero-pack" | "detail-pack" | "full-pack";

export type SceneConfigState = {
  referenceImages: ProductImageAsset[];
  outputMode: SceneOutputMode;
  ratio: "3:4" | "1:1" | "9:16";
  supplementalInfo: string;
  selectedSceneTemplateId: string;
  selectedVisualDirectionId: string;
};

export type SceneTemplate = {
  group: "基础商品图" | "场景氛围图" | "内容营销图" | "信息说明图" | "特殊创意";
  description: string;
  id: string;
  sourceTemplateId: string;
  title: string;
};

export type SceneVisualDirection = {
  description: string;
  id: string;
  title: string;
};

export type SceneImagePlan = {
  code: string;
  id: string;
  prompt: string;
  promptSummary: string;
  purpose: string;
  ratio: string;
  templateId: string;
  title: string;
};

export const sceneRatios: SceneConfigState["ratio"][] = ["3:4", "1:1", "9:16"];

export const sceneOutputModes: Array<{ label: string; value: SceneOutputMode }> = [
  { label: "单张场景图", value: "single" },
  { label: "主图组", value: "hero-pack" },
  { label: "详情页组", value: "detail-pack" },
  { label: "完整图片包", value: "full-pack" },
];

export const sceneTemplates: SceneTemplate[] = [
  {
    description: "Amazon/淘宝首图、白底商品照",
    group: "基础商品图",
    id: "hero-image",
    sourceTemplateId: "hero-image",
    title: "白底主图",
  },
  {
    description: "使用场景、氛围感商品照",
    group: "场景氛围图",
    id: "lifestyle-scene",
    sourceTemplateId: "lifestyle-scene",
    title: "生活方式",
  },
  {
    description: "服装、美妆、配饰平铺展示",
    group: "基础商品图",
    id: "flat-lay",
    sourceTemplateId: "flat-lay",
    title: "平铺摆拍",
  },
  {
    description: "面料纹理、工艺细节、材质展示",
    group: "基础商品图",
    id: "detail-macro",
    sourceTemplateId: "detail-macro",
    title: "细节特写",
  },
  {
    description: "活动推广、首页 Banner",
    group: "内容营销图",
    id: "poster-banner",
    sourceTemplateId: "poster-banner",
    title: "海报 Banner",
  },
  {
    description: "社交平台种草图、UGC 内容",
    group: "内容营销图",
    id: "social-media",
    sourceTemplateId: "social-media",
    title: "社媒内容",
  },
  {
    description: "买家秀风格、真实使用场景",
    group: "场景氛围图",
    id: "ugc-style",
    sourceTemplateId: "ugc-style",
    title: "UGC 风格",
  },
  {
    description: "服装、配饰模特展示",
    group: "场景氛围图",
    id: "model-showcase",
    sourceTemplateId: "model-showcase",
    title: "模特展示",
  },
  {
    description: "护肤、清洁、健身效果对比",
    group: "信息说明图",
    id: "before-after",
    sourceTemplateId: "before-after",
    title: "前后对比",
  },
  {
    description: "产品包装展示、开箱体验",
    group: "信息说明图",
    id: "packaging",
    sourceTemplateId: "packaging",
    title: "包装设计",
  },
  {
    description: "产品参数、成分、规格说明",
    group: "信息说明图",
    id: "infographic",
    sourceTemplateId: "infographic",
    title: "信息图表",
  },
  {
    description: "品牌视觉概念、艺术化表达",
    group: "特殊创意",
    id: "creative-concept",
    sourceTemplateId: "creative-concept",
    title: "创意概念",
  },
  {
    description: "服装尺码对照、穿着建议",
    group: "信息说明图",
    id: "size-spec",
    sourceTemplateId: "size-spec",
    title: "尺码说明",
  },
  {
    description: "多款产品搭配、组合套装",
    group: "信息说明图",
    id: "multi-product",
    sourceTemplateId: "multi-product",
    title: "多品组合",
  },
  {
    description: "抖音、淘宝直播间截图风格",
    group: "内容营销图",
    id: "livestream",
    sourceTemplateId: "livestream",
    title: "直播间",
  },
  {
    description: "虚拟试穿、产品融入场景",
    group: "场景氛围图",
    id: "try-on-virtual",
    sourceTemplateId: "try-on-virtual",
    title: "虚拟试穿",
  },
  {
    description: "产品结构拆解、组件展示",
    group: "信息说明图",
    id: "exploded-view",
    sourceTemplateId: "exploded-view",
    title: "爆炸图",
  },
  {
    description: "服装 3D 立体展示",
    group: "基础商品图",
    id: "ghost-mannequin",
    sourceTemplateId: "ghost-mannequin",
    title: "隐形人台",
  },
  {
    description: "多角度产品展示网格",
    group: "基础商品图",
    id: "multi-angle-grid",
    sourceTemplateId: "multi-angle-grid",
    title: "多角度网格",
  },
  {
    description: "高级编辑部大片风格",
    group: "内容营销图",
    id: "magazine-editorial",
    sourceTemplateId: "magazine-editorial",
    title: "杂志编辑",
  },
  {
    description: "季节性营销活动",
    group: "内容营销图",
    id: "seasonal-campaign",
    sourceTemplateId: "seasonal-campaign",
    title: "季节 Campaign",
  },
  {
    description: "高端品牌氛围感大片",
    group: "场景氛围图",
    id: "luxury-atmospherics",
    sourceTemplateId: "luxury-atmospherics",
    title: "轻奢氛围",
  },
  {
    description: "手机、电脑产品样机展示",
    group: "特殊创意",
    id: "device-mockup",
    sourceTemplateId: "device-mockup",
    title: "设备样机",
  },
  {
    description: "线下店铺、展柜陈列",
    group: "场景氛围图",
    id: "storefront",
    sourceTemplateId: "storefront",
    title: "店铺陈列",
  },
  {
    description: "运动品牌 Campaign 风格",
    group: "内容营销图",
    id: "sports-campaign",
    sourceTemplateId: "sports-campaign",
    title: "运动 Campaign",
  },
];

export const visualDirections: SceneVisualDirection[] = [
  { description: "干净留白，适合大多数商品", id: "minimal", title: "极简电商" },
  { description: "高级 A+ 视觉和强层级信息图", id: "premium-a-plus", title: "高端 A+" },
  { description: "真实生活场景，弱广告感", id: "lifestyle", title: "生活方式" },
  { description: "手机拍摄质感，适合社媒", id: "ugc-real", title: "UGC 真实感" },
  { description: "深色或柔和材质，高端氛围", id: "luxury", title: "轻奢氛围" },
];

export const defaultSceneConfig: SceneConfigState = {
  outputMode: "single",
  ratio: "3:4",
  referenceImages: [],
  selectedSceneTemplateId: sceneTemplates[0].id,
  selectedVisualDirectionId: visualDirections[0].id,
  supplementalInfo: "",
};

const heroPackDefinitions = [
  { code: "H1", purpose: "一眼说明产品核心价值", templateId: "hero-image", title: "首屏主视觉" },
  { code: "H2", purpose: "突出商品核心卖点", templateId: "infographic", title: "核心卖点图" },
  { code: "H3", purpose: "展示典型使用场景", templateId: "lifestyle-scene", title: "使用场景图" },
  { code: "H4", purpose: "展示方案或体验对比", templateId: "before-after", title: "对比选择图" },
  { code: "H5", purpose: "收口优惠、保障或行动指令", templateId: "poster-banner", title: "CTA 收口图" },
];

const detailPackDefinitions = [
  { code: "D1", purpose: "承接首屏卖点", templateId: "infographic", title: "详情页首屏" },
  { code: "D2", purpose: "放大用户痛点", templateId: "before-after", title: "痛点放大" },
  { code: "D3", purpose: "说明产品机制", templateId: "infographic", title: "机制解释" },
  { code: "D4", purpose: "展示 2-4 个核心利益", templateId: "infographic", title: "核心利益" },
  { code: "D5", purpose: "降低使用理解成本", templateId: "size-spec", title: "使用步骤" },
  { code: "D6", purpose: "覆盖典型使用场景", templateId: "lifestyle-scene", title: "场景覆盖" },
  { code: "D7", purpose: "比较普通方案与本产品", templateId: "before-after", title: "对比选择" },
  { code: "D8", purpose: "展示材质、包装或质检证据", templateId: "detail-macro", title: "信任背书" },
  { code: "D9", purpose: "处理残留疑虑并引导行动", templateId: "poster-banner", title: "FAQ / 风险逆转 / CTA" },
];

export function createSceneImagePlans(config: SceneConfigState): SceneImagePlan[] {
  const selectedTemplate =
    sceneTemplates.find((template) => template.id === config.selectedSceneTemplateId) ?? sceneTemplates[0];
  const selectedDirection =
    visualDirections.find((direction) => direction.id === config.selectedVisualDirectionId) ?? visualDirections[0];

  if (config.outputMode === "single") {
    return [
      createSceneImagePlan({
        code: "S1",
        config,
        purpose: selectedTemplate.description,
        templateId: selectedTemplate.sourceTemplateId,
        title: selectedTemplate.title,
        visualDirection: selectedTemplate.title,
      }),
    ];
  }

  const definitions =
    config.outputMode === "hero-pack"
      ? heroPackDefinitions
      : config.outputMode === "detail-pack"
        ? detailPackDefinitions
        : [...heroPackDefinitions, ...detailPackDefinitions];

  return definitions.map((definition) =>
    createSceneImagePlan({
      code: definition.code,
      config,
      purpose: definition.purpose,
      templateId: definition.templateId,
      title: definition.title,
      visualDirection: selectedDirection.title,
    }),
  );
}

function createSceneImagePlan({
  code,
  config,
  purpose,
  templateId,
  title,
  visualDirection,
}: {
  code: string;
  config: SceneConfigState;
  purpose: string;
  templateId: string;
  title: string;
  visualDirection: string;
}): SceneImagePlan {
  const imageTitle = `${code} ${title}`;
  const supplement = config.supplementalInfo.trim() || "用户未填写补充信息，按参考图主体和场景模板生成。";
  const styleLock =
    "统一风格锁定：整套图片保持一致的高级电商视觉系统；固定干净的暖白背景、深炭灰文字和一个与产品匹配的强调色；使用中性偏冷的棚拍光、现代几何无衬线字体、统一线宽的细线图标和圆角标签；保持充足留白；不要混用字体、不要随机背景、不要出现光线漂移。";

  return {
    code,
    id: `${code.toLowerCase()}-${templateId}`,
    prompt: `${styleLock}\n\n${imageTitle}。用途：${purpose}。视觉方向：${visualDirection}。输出比例：${config.ratio}。参考图数量：${config.referenceImages.length}。补充信息：${supplement}\n\n画面要求：产品主体清晰，产品占比数字化，留白至少 45%，图片内文字使用「」包裹，避免密集小字。\n\n不要添加：水印、假 logo、虚构认证、虚构销量、无依据功效、杂乱装饰、随机背景。`,
    promptSummary: `${visualDirection} · ${purpose} · ${config.ratio}`,
    purpose,
    ratio: config.ratio,
    templateId,
    title: imageTitle,
  };
}
