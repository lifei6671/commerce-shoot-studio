import { defaultProductGenerationSettings } from "../components/GenerationConfigPanel";
import type {
  StrategyModuleDraft,
  StrategyModulePromptPlanItem,
  ViralStyleAnalysisResult,
} from "../components/GenerationConfigPanel";
import type {
  GeneratedDetailImage,
  ProductListingCopy,
} from "../components/PreviewCanvas";
import type { ProductImageAsset } from "./productImagePicker";

export function createFlatProductResultItems(
  recordId: string,
  drafts: StrategyModuleDraft[],
  listingCopyGenerationEnabled: boolean,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  productImages: ProductImageAsset[],
) {
  const sourceImage: GeneratedDetailImage = {
    id: `${recordId}-source`,
    kind: "source-image",
    sourceImages: productImages,
    status: "complete",
    title: "原图",
  };
  const images: GeneratedDetailImage[] = drafts.map((draft, index) => {
    const imagePlan = createProductDetailImagePlan(draft, settings, productPrompt);
    return {
      copyRequirements: imagePlan.copyRequirements,
      coreImagePrompt: imagePlan.coreImagePrompt,
      designSpec: imagePlan.designSpec,
      id: `${recordId}-${draft.id}`,
      imageNo: index + 1,
      imageType: imagePlan.imageType,
      prompt: imagePlan.imagePrompt,
      sceneDescription: imagePlan.sceneDescription,
      status: "generating" as const,
      title: draft.title,
      visualConsistency: imagePlan.visualConsistency,
    };
  });

  return listingCopyGenerationEnabled
    ? [
        sourceImage,
        ...images,
        {
          id: `${recordId}-listing-copy`,
          kind: "listing-copy" as const,
          listingCopy: createProductListingCopy(productPrompt),
          status: "generating" as const,
          title: "商品上架文案",
        },
      ]
    : [sourceImage, ...images];
}

export function createProductDetailImagePlan(
  draft: StrategyModuleDraft,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  viralStyle?: ViralStyleAnalysisResult,
) {
  const promptPlanItem = findPromptPlanItemForStyle(draft, viralStyle);
  const sceneDescription = draft.contentEdited
    ? draft.content
    : promptPlanItem?.copyRequirements || promptPlanItem?.sceneDescription || draft.content;
  const coreImagePrompt = promptPlanItem?.imagePrompt;
  const imageType = promptPlanItem?.imageType || `${draft.title}: ${draft.description}`;
  const designSpec = promptPlanItem?.designSpec || createProductDetailDesignSpec(productPrompt, viralStyle, promptPlanItem);
  const imagePrompt = coreImagePrompt
    ? appendProductDetailPromptSafeguards(
        combineProductDetailImagePromptAndCopy(coreImagePrompt, sceneDescription),
        settings,
        productPrompt,
        viralStyle,
        draft,
        promptPlanItem,
        imageType,
        designSpec,
      )
    : createProductDetailImagePrompt(
        draft,
        settings,
        productPrompt,
        viralStyle,
        sceneDescription,
        promptPlanItem,
        imageType,
        designSpec,
      );

  return {
    copyRequirements: sceneDescription,
    coreImagePrompt: coreImagePrompt ?? imagePrompt,
    designSpec,
    imageType,
    imagePrompt,
    sceneDescription,
    visualConsistency: promptPlanItem?.visualConsistency,
  };
}

function combineProductDetailImagePromptAndCopy(imagePrompt: string, copyRequirements: string) {
  return [
    imagePrompt,
    copyRequirements.trim() ? `用户可修改文案要求：${copyRequirements.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function createProductDetailImagePrompt(
  draft: StrategyModuleDraft,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  viralStyle: ViralStyleAnalysisResult | undefined,
  sceneDescription: string,
  promptPlanItem: StrategyModulePromptPlanItem | undefined,
  imageType: string,
  designSpec: string,
) {
  const formatLabel =
    settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;
  const styleAnchor = viralStyle
    ? createViralStylePromptAnchor(viralStyle)
    : "爆款风格：未选择，采用中性、干净、可泛化的电商摄影棚视觉。";

  return [
    designSpec,
    `场景核心卖点：${imageType}`,
    `场景描述：${sceneDescription}`,
    `商品卖点：${productPrompt.trim() || "需补充商品卖点信息"}`,
    `模块目的：${draft.title}，${draft.description}`,
    createVisualConsistencyPromptAnchor(promptPlanItem?.visualConsistency),
    `平台与语言：${settings.platform}，${settings.market}，${settings.language}`,
    createLocalePromptConstraint(settings),
    `画面比例：适配 ${formatLabel} 比例的电商详情页画面`,
    styleAnchor,
    createOriginalImageFidelityConstraint(),
    createVisibleTextPromptConstraint(),
    "禁止项：禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标、未提供的材质或功效。",
  ].filter(Boolean).join("\n");
}

function appendProductDetailPromptSafeguards(
  imagePrompt: string,
  settings: typeof defaultProductGenerationSettings,
  productPrompt: string,
  viralStyle?: ViralStyleAnalysisResult,
  draft?: StrategyModuleDraft,
  promptPlanItem?: StrategyModulePromptPlanItem,
  imageType?: string,
  designSpec?: string,
) {
  const formatLabel =
    settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;
  const styleLine = viralStyle ? createViralStylePromptAnchor(viralStyle) : "爆款风格：未选择";
  return [
    designSpec,
    imageType ? `场景核心卖点：${imageType}` : "",
    draft ? `当前场景：${draft.title}，${draft.description}` : "",
    imagePrompt,
    `商品卖点事实边界：${productPrompt.trim() || "需补充商品卖点信息"}`,
    createVisualConsistencyPromptAnchor(promptPlanItem?.visualConsistency),
    `平台与语言：${settings.platform}，${settings.market}，${settings.language}`,
    createLocalePromptConstraint(settings),
    `画面比例：适配 ${formatLabel} 比例的电商详情页画面`,
    styleLine,
    createOriginalImageFidelityConstraint(),
    createVisibleTextPromptConstraint(),
    "禁止项：禁止新增未提供的品牌 Logo、价格、销量、认证标识、虚构参数、侵权 IP、名人肖像、第三方商标、未提供的材质或功效。",
  ].filter(Boolean).join("\n");
}

function createProductDetailDesignSpec(
  productPrompt: string,
  viralStyle: ViralStyleAnalysisResult | undefined,
  promptPlanItem: StrategyModulePromptPlanItem | undefined,
) {
  const productSentence = createProductSummarySentence(productPrompt);
  const sellingPoints = createShortTerms(productPrompt, ["需补充卖点"], 3);
  const concerns = createConcernTerms(productPrompt);

  return [
    "产品与卖点",
    `产品：${productSentence}`,
    `卖点：${sellingPoints.join(" / ")}`,
    `顾虑：${concerns.join(" / ")}`,
    `视觉重心：${createVisualFocusSentence(sellingPoints, concerns, promptPlanItem?.visualConsistency)}`,
    "",
    "视觉定调",
    `风格：${createStyleDirectionSentence(viralStyle)}`,
    `色彩：${createColorDirectionSentence(viralStyle, promptPlanItem?.visualConsistency)}`,
    `字体：${createFontDirectionSentence(viralStyle)}`,
    `色温：${createColorTemperatureSentence(viralStyle)}`,
    `光质：${createLightQualitySentence(viralStyle, promptPlanItem?.visualConsistency)}`,
  ].join("\n");
}

function createProductSummarySentence(productPrompt: string) {
  const value = productPrompt.trim();
  if (!value) {
    return "需补充产品信息。";
  }
  return /[。.!！?？]$/.test(value) ? value : `${value}。`;
}

function createShortTerms(productPrompt: string, fallback: string[], limit: number) {
  const terms = productPrompt
    .split(/[，,、；;。.!！?？\n\r]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && term.length <= 16);
  const uniqueTerms = Array.from(new Set(terms)).slice(0, limit);
  return uniqueTerms.length > 0 ? uniqueTerms : fallback;
}

function createConcernTerms(productPrompt: string) {
  const source = productPrompt.toLowerCase();
  if (/头盔|骑行|护具|安全帽|helmet/.test(source)) {
    return ["佩戴闷热", "安全感不足", "日常不百搭"];
  }
  if (/洁面|洗面奶|护肤|精华|面霜|乳液|防晒|cleanser|skincare/.test(source)) {
    return ["清洁刺激", "洗后紧绷", "成分不明"];
  }
  if (/衣|裤|裙|鞋|包|背心|夹克|外套|t恤|t-shirt|jacket|dress|shoe|bag/.test(source)) {
    return ["版型显臃肿", "闷汗不透气", "质感不稳定"];
  }
  if (/食品|零食|饮料|茶|咖啡|饼干|food|drink|coffee|tea/.test(source)) {
    return ["口味不直观", "配料不清晰", "包装无质感"];
  }
  return ["效果不直观", "质感不稳定", "信息不可信"];
}

function createVisualFocusSentence(
  sellingPoints: string[],
  concerns: string[],
  visualConsistency?: Record<string, unknown>,
) {
  const productAnchor = readVisualConsistencyText(visualConsistency, "productAnchor");
  const compositionAnchor = readVisualConsistencyText(visualConsistency, "compositionAnchor");
  const focusSubject = productAnchor || "商品主体";
  const sellingPointText = sellingPoints.slice(0, 2).join("+") || "核心卖点";
  const concernText = concerns[0] || "购买";
  const compositionText = compositionAnchor ? `，保持${compositionAnchor}` : "";
  return `${focusSubject}作为画面第一视觉中心${compositionText}，直观展示${sellingPointText}，打消用户${concernText}顾虑`;
}

function createStyleDirectionSentence(viralStyle?: ViralStyleAnalysisResult) {
  if (!viralStyle) {
    return "中性干净的电商详情页视觉，突出商品识别和转化效率";
  }
  const styleText = [viralStyle.title, viralStyle.subtitle, viralStyle.designFocus]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join(" / ");
  return styleText || "中性干净的电商详情页视觉，突出商品识别和转化效率";
}

function createColorDirectionSentence(
  viralStyle: ViralStyleAnalysisResult | undefined,
  visualConsistency?: Record<string, unknown>,
) {
  const colors = viralStyle?.colors?.filter((color) => color.trim()).join("/");
  const colorDescription = viralStyle?.colorDescription?.trim();
  const backgroundAnchor = readVisualConsistencyText(visualConsistency, "backgroundAnchor");
  if (colors && colorDescription) {
    return `${colors}作为统一配色，${colorDescription}，产品保持原色`;
  }
  if (colors) {
    return `${colors}作为统一配色，产品保持原色，重点信息使用高对比强调`;
  }
  if (backgroundAnchor) {
    return `${backgroundAnchor}作为统一背景基调，产品保持原色，重点信息使用高对比强调`;
  }
  return "中性色背景基调，产品保持原色，重点信息使用高对比强调";
}

function createFontDirectionSentence(viralStyle?: ViralStyleAnalysisResult) {
  return (
    viralStyle?.fontStyleDescription?.trim() ||
    "中等偏粗无衬线体用于标题，干净无衬线体用于正文信息"
  );
}

function createColorTemperatureSentence(viralStyle?: ViralStyleAnalysisResult) {
  const note = viralStyle?.globalStyleNote?.trim();
  if (note && /暖|warm/i.test(note)) {
    return "暖色温（全套统一）";
  }
  if (note && /冷|cold|cool/i.test(note)) {
    return "冷色温（全套统一）";
  }
  return "中性（全套统一）";
}

function createLightQualitySentence(
  viralStyle: ViralStyleAnalysisResult | undefined,
  visualConsistency?: Record<string, unknown>,
) {
  const lightingAnchor = readVisualConsistencyText(visualConsistency, "lightingAnchor");
  const globalStyleNote = viralStyle?.globalStyleNote?.trim();
  if (lightingAnchor && globalStyleNote) {
    return `${lightingAnchor} + ${globalStyleNote}`;
  }
  if (lightingAnchor) {
    return `${lightingAnchor}，突出商品轮廓、材质和关键信息`;
  }
  if (globalStyleNote) {
    return globalStyleNote;
  }
  return "自然柔光为主，局部轮廓光突出商品边缘与材质";
}

function readVisualConsistencyText(visualConsistency: Record<string, unknown> | undefined, key: string) {
  const value = visualConsistency?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function createListingCopyDesignSpec(items: Array<{ designSpec?: string; groupTitle?: string }>) {
  const specs = Array.from(
    new Set(
      items
        .map((item) => item.designSpec?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (specs.length === 0) {
    return "设计规范：未提供明确设计规范，仅根据商品卖点生成上架文案。";
  }
  return specs.join("\n\n");
}

export function createOriginalImageFidelityConstraint() {
  return "原图忠实约束：用户上传原图是商品唯一视觉事实源；核心商品主体只能做光影、背景、构图、清晰度和额外画面文案层面的微调，禁止重绘、换款、换包装、改颜色、改结构、改 Logo、改图案、改比例或新增未提供配件。必须逐项保留参考图中商品主体的原始色块、渐变、纹理、缝线、轮廓、版型、比例、Logo 位置、胸前英文印花文字、包装上的原有印花文字、图案和图形；这些原有文字和图案属于商品外观事实，不是需要生成的新文案，不得翻译、重写、删除或弱化，不得遮挡、改色或替换。";
}

function createViralStylePromptAnchor(viralStyle: ViralStyleAnalysisResult) {
  return [
    `爆款风格：${viralStyle.title}`,
    viralStyle.subtitle ? `风格语气：${viralStyle.subtitle}` : "",
    viralStyle.reasoning ? `推荐理由：${viralStyle.reasoning}` : "",
    viralStyle.designFocus ? `设计重点：${viralStyle.designFocus}` : "",
    viralStyle.globalStyleNote ? `全局光影氛围：${viralStyle.globalStyleNote}` : "",
    viralStyle.fontStyleDescription ? `字体气质：${viralStyle.fontStyleDescription}` : "",
    viralStyle.colors.length > 0 ? `沿用颜色：${viralStyle.colors.join("、")}` : "颜色：沿用输入风格，不新增颜色值",
    viralStyle.colorDescription ? `配色用途：${viralStyle.colorDescription}` : "",
    viralStyle.iconStyle ? `辅助图标风格：${viralStyle.iconStyle}` : "",
  ]
    .filter(Boolean)
    .join("；");
}

export function createLocalePromptConstraint(settings: typeof defaultProductGenerationSettings) {
  const market = settings.market.toLowerCase();
  const language = settings.language.toLowerCase();
  const isChinaMarket =
    settings.market.includes("中国") || market === "cn" || market === "china" || market.includes("mainland china");
  const isChineseLanguage =
    settings.language.includes("中文") || language === "zh" || language.startsWith("zh-") || language.includes("chinese");

  if (isChinaMarket && isChineseLanguage) {
    return "国家与语言约束：若画面出现人物，必须是中国人或中国电商模特气质；新增画面文案、信息区文字和标注标签必须使用中文，不得新增英文或外文。参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响，必须按原图原样保留，不得翻译、重写、删除或替换。";
  }
  if (isChineseLanguage) {
    return "语言约束：新增画面文案、信息区文字和标注标签必须使用中文，不得新增英文或外文。参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响，必须按原图原样保留，不得翻译、重写、删除或替换。";
  }
  return "国家与语言约束：人物、场景和文字语言必须匹配目标市场与目标语言。";
}

function createVisualConsistencyPromptAnchor(visualConsistency?: Record<string, unknown>) {
  if (!visualConsistency) {
    return "";
  }
  const entries = [
    ["商品主体锚点", visualConsistency.productAnchor],
    ["背景锚点", visualConsistency.backgroundAnchor],
    ["光影锚点", visualConsistency.lightingAnchor],
    ["构图锚点", visualConsistency.compositionAnchor],
    ["文字区锚点", visualConsistency.textAreaAnchor],
  ]
    .map(([label, value]) => (typeof value === "string" && value.trim() ? `${label}：${value.trim()}` : ""))
    .filter(Boolean);
  return entries.length > 0 ? `视觉一致性：${entries.join("；")}` : "";
}

export function createVisibleTextPromptConstraint() {
  return "生图文字约束：必须按照用户可修改文案要求生成画面内文字、结构化信息和已启用标注；文字必须清晰可读并使用目标语言；未在文案要求中列出的文字、乱码、伪文字、价格、销量、认证标识和虚假参数一律禁止。";
}

function findPromptPlanItemForStyle(
  draft: StrategyModuleDraft,
  viralStyle?: ViralStyleAnalysisResult,
): StrategyModulePromptPlanItem | undefined {
  if (!draft.promptPlanItems?.length) {
    return undefined;
  }
  if (!viralStyle) {
    return draft.promptPlanItems[0];
  }

  return (
    draft.promptPlanItems.find((item) => item.styleId && viralStyle.id && item.styleId === viralStyle.id) ??
    draft.promptPlanItems.find((item) => item.styleTitle && item.styleTitle === viralStyle.title)
  );
}

export function createResultGroupSlug(title: string) {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]/g, "")
    .toLowerCase();
}

export function createProductListingCopy(productPrompt: string): ProductListingCopy {
  const productName = productPrompt.trim() || "黑色宽松落肩夹克，双面领设计，通勤防风。";

  return {
    title: "Men's Japanese Style Loose Drop Shoulder Black Reversible Collar Casual Jacket",
    sellingPoints: [
      "Micro-silhouette cut, fits neatly and hides excess body fat for a crisp look",
      "Premium matte woven fabric, windproof, durable, anti-wrinkle and non-deformable",
      "2-way wearable stand/lapel collar, matches various styling for versatile daily wear",
    ],
    detailCopy:
      "This all-black casual jacket is designed for trend-focused commuters, street fashion enthusiasts and people looking for reliable daily outerwear. It fits perfectly for multiple scenarios including city daily commuting, offline friend gatherings and casual street shooting. No more trouble of messy wrinkles after long hours of wearing, no more limited outfit collocation options, this timeless basic piece will become your go-to staple for all daily occasions.",
    keywords:
      "men black jacket japanese style loose outerwear windproof anti wrinkle reversible collar jacket streetwear casual commuter jacket drop shoulder jacket",
    shootingPlan: [
      "White background image: Full front shot of the product, no extra elements, clearly shows the full outline and loose drop shoulder silhouette",
      "Scene image 1: Model wearing the jacket walking on busy city downtown street, showing the effect for daily commuting scenario",
      "Scene image 2: Model posing for photos at the trendy street corner, demonstrating the stylish street shooting effect",
      "Selling point image 1: Close-up shot of the matte woven fabric, showing the fine material texture with mark of windproof and anti-wrinkle performance",
      "Selling point image 2: Double angle shot showing both stand collar and lapel collar wearing effect, clearly display the 2-way wearing feature",
      "Other image 1: Model full-body matching display, showing how to pair the jacket with casual pants and sneakers for full daily styling",
      "Other image 2: Size chart display, clearly mark the detailed size parameters of the jacket for customers to choose proper fit",
    ],
    sourcePrompt: productName,
  };
}
