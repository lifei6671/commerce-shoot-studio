import type { ProductImageAsset } from "../../generation/lib/productImagePicker";

export type SceneOutputMode = "single" | "hero-pack" | "detail-pack" | "full-pack";

export type SceneConfigState = {
  referenceImages: ProductImageAsset[];
  outputMode: SceneOutputMode;
  ratio: "3:4" | "1:1" | "9:16";
  supplementalInfo: string;
};

export type SceneTemplate = {
  group: "基础商品图" | "场景氛围图" | "内容营销图" | "信息说明图" | "特殊创意";
  description: string;
  id: string;
  sourceTemplateId: string;
  title: string;
};

export type SceneImagePlan = {
  code: string;
  id: string;
  imageNo: number;
  negativeConstraints: string;
  prompt: string;
  promptSummary: string;
  purpose: string;
  ratio: string;
  sortOrder: number;
  templateId: string;
  title: string;
  variantId: string;
};

export type ScenePlanningSnapshot = {
  campaignStyleLock: string;
  conversionDriver: "visual" | "pain-point" | "emotional";
  items: SceneImagePlan[];
  templateCatalogVersion: string;
};

export const scenePlanningPromptVersion = "v10";
export const sceneImageGenerationPromptVersion = "v7";
export const sceneTemplateCatalogVersion = "v5";

export const sceneRatios: SceneConfigState["ratio"][] = ["3:4", "1:1", "9:16"];

export const sceneOutputModes: Array<{ label: string; tooltip: string; value: SceneOutputMode }> = [
  {
    label: "单张场景图（1 张）",
    tooltip: "输出 1 张图片，AI 根据参考图和补充信息自动选择场景类型，适合补充单个明确用途的图片。",
    value: "single",
  },
  {
    label: "主图组（5 张）",
    tooltip: "输出 H1–H5 共 5 张主图，覆盖首屏主视觉、卖点、场景、对比和行动引导。",
    value: "hero-pack",
  },
  {
    label: "详情页组（9 张）",
    tooltip: "输出 D1–D9 共 9 张详情图，形成从首屏、痛点、机制到信任与 FAQ/CTA 的完整叙事。",
    value: "detail-pack",
  },
  {
    label: "完整图片包（14 张）",
    tooltip: "输出 H1–H5 主图与 D1–D9 详情图，共 14 张，组成一套完整电商图片内容。",
    value: "full-pack",
  },
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
    description: "仅在参考图或补充信息提供证据时展示前后差异",
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
    description: "通用尺寸、规格、测量方法或使用步骤",
    group: "信息说明图",
    id: "size-spec",
    sourceTemplateId: "size-spec",
    title: "尺码说明",
  },
  {
    description: "仅组合参考图中已明确出现的商品或套装",
    group: "信息说明图",
    id: "multi-product",
    sourceTemplateId: "multi-product",
    title: "多品组合",
  },
  {
    description: "无平台 Logo、虚假价格或销量的泛化直播画面",
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
    description: "APP、网站或 SaaS 界面的手机与电脑设备样机",
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

export const defaultSceneConfig: SceneConfigState = {
  outputMode: "single",
  ratio: "3:4",
  referenceImages: [],
  supplementalInfo: "",
};

const heroPackCodes = ["H1", "H2", "H3", "H4", "H5"] as const;
const detailPackCodes = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const;

const sceneTemplateIds = new Set(sceneTemplates.map((template) => template.sourceTemplateId));
const unresolvedPlaceholderPattern = /\{\{[^{}]+\}\}/;

export function decodeScenePlanningOutput(output: unknown, outputMode: SceneOutputMode): ScenePlanningSnapshot {
  const value = asRecord(output, "场景规划结果格式无效。");
  const templateCatalogVersion = requiredString(value.templateCatalogVersion, "场景模板目录版本缺失。");
  if (templateCatalogVersion !== sceneTemplateCatalogVersion) {
    throw new Error(`场景模板目录版本不兼容：${templateCatalogVersion}。`);
  }
  const campaignStyleLock = requiredPossiblyEmptyString(value.campaignStyleLock, "统一风格锁定字段缺失。");
  if (outputMode === "single" && campaignStyleLock) {
    throw new Error("单张场景规划不应包含统一风格锁定。");
  }
  if (outputMode !== "single" && !campaignStyleLock) {
    throw new Error("多图场景规划缺少统一风格锁定。");
  }
  const conversionDriver = requiredString(value.conversionDriver, "转化驱动力缺失。");
  if (conversionDriver !== "visual" && conversionDriver !== "pain-point" && conversionDriver !== "emotional") {
    throw new Error("场景规划返回了不支持的转化驱动力。");
  }
  if (!Array.isArray(value.items)) {
    throw new Error("场景规划图片项缺失。");
  }

  const expectedDefinitions = expectedDefinitionsForMode(outputMode);
  if (value.items.length !== expectedDefinitions.length) {
    throw new Error(`场景规划应返回 ${expectedDefinitions.length} 张图片，实际返回 ${value.items.length} 张。`);
  }

  const seenImageIds = new Set<string>();
  const items = value.items.map((item, index): SceneImagePlan => {
    const itemValue = asRecord(item, `场景规划第 ${index + 1} 项格式无效。`);
    const expectedCode = expectedDefinitions[index];
    const code = requiredString(itemValue.code, `场景规划第 ${index + 1} 项编号缺失。`);
    const id = requiredString(itemValue.imageId, `场景规划第 ${index + 1} 项图片 ID 缺失。`);
    const imageNo = requiredInteger(itemValue.imageNo, `场景规划第 ${index + 1} 项图片序号无效。`);
    const sortOrder = requiredInteger(itemValue.sortOrder, `场景规划第 ${index + 1} 项排序无效。`);
    const templateId = requiredString(itemValue.templateId, `场景规划第 ${index + 1} 项模板缺失。`);
    const variantId = requiredString(itemValue.variantId, `场景规划第 ${index + 1} 项变体缺失。`);
    const prompt = requiredString(itemValue.prompt, `场景规划第 ${index + 1} 项 Prompt 缺失。`);
    const promptSummary = requiredString(itemValue.promptSummary, `场景规划第 ${index + 1} 项摘要缺失。`);
    const negativeConstraints = requiredString(
      itemValue.negativeConstraints,
      `场景规划第 ${index + 1} 项负向约束缺失。`,
    );
    if (code !== expectedCode || imageNo !== index + 1 || sortOrder !== index) {
      throw new Error(`场景规划第 ${index + 1} 项顺序与 ${expectedCode} 合同不一致。`);
    }
    if (!sceneTemplateIds.has(templateId)) {
      throw new Error(`场景规划第 ${index + 1} 项使用了未知模板 ${templateId}。`);
    }
    if (seenImageIds.has(id)) {
      throw new Error(`场景规划存在重复图片 ID：${id}。`);
    }
    if (
      unresolvedPlaceholderPattern.test(prompt) ||
      unresolvedPlaceholderPattern.test(promptSummary) ||
      unresolvedPlaceholderPattern.test(negativeConstraints)
    ) {
      throw new Error(`场景规划第 ${index + 1} 项仍包含未替换占位符。`);
    }
    seenImageIds.add(id);
    const purpose = requiredString(itemValue.purpose, `场景规划第 ${index + 1} 项用途缺失。`);
    const ratio = requiredString(itemValue.ratio, `场景规划第 ${index + 1} 项比例缺失。`);
    const title = requiredString(itemValue.title, `场景规划第 ${index + 1} 项标题缺失。`);
    const titleWithCode = title.startsWith(`${code} `) ? title : `${code} ${title}`;
    return {
      code,
      id,
      imageNo,
      negativeConstraints,
      prompt,
      promptSummary,
      purpose,
      ratio,
      sortOrder,
      templateId,
      title: titleWithCode,
      variantId,
    };
  });

  return { campaignStyleLock, conversionDriver, items, templateCatalogVersion };
}

function expectedDefinitionsForMode(outputMode: SceneOutputMode) {
  if (outputMode === "single") {
    return ["S1"];
  }
  if (outputMode === "hero-pack") {
    return heroPackCodes;
  }
  if (outputMode === "detail-pack") {
    return detailPackCodes;
  }
  return [...heroPackCodes, ...detailPackCodes];
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function requiredPossiblyEmptyString(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new Error(message);
  }
  return value.trim();
}

function requiredInteger(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }
  return value;
}
