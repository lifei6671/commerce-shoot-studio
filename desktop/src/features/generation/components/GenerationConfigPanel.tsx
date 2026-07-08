import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, GripVertical, HelpCircle, Loader2, RefreshCw, Trash2, UploadCloud, WandSparkles, X } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { ControlGroup } from "../../../shared/ui/control-group";
import { ImageUploadGrid } from "../../../shared/ui/image-upload-grid";
import { ModuleTile } from "../../../shared/ui/module-tile";
import { SelectPill } from "../../../shared/ui/select-pill";
import { TextAreaPanel } from "../../../shared/ui/textarea-panel";
import { UploadDropzone } from "../../../shared/ui/upload-dropzone";
import { cn } from "../../../shared/lib/cn";
import type { AiAssistPort, PromptPlan, PromptPlanItem, PromptPlanPort } from "../../../runtime";
import { localAiAssistPort } from "../../../runtime/local/ai-assist";
import { localPromptPlanPort } from "../../../runtime/local/prompt-plan";
import { useToast } from "../../../shared/ui/toast";
import {
  type ProductImageAsset,
  selectProductImages,
} from "../lib/productImagePicker";

export type ModuleOption = {
  id: string;
  title: string;
  description: string;
  checked: boolean;
};

type GenerationConfigPanelProps = {
  aiAssistPort?: AiAssistPort;
  detailGenerating: boolean;
  generationSettings: ProductGenerationSettings;
  generationSettingsTouched: boolean;
  modules: ModuleOption[];
  onBackToProductInputs: () => void;
  onGenerateDetails: (drafts: StrategyModuleDraft[]) => void;
  onGenerateStrategy: () => void;
  onGenerationSettingsChange: (settings: ProductGenerationSettings) => void;
  onModuleCheckedChange: (moduleId: string, checked: boolean) => void;
  onProductImagesChange: (images: ProductImageAsset[]) => void;
  onProductPromptChange: (prompt: string) => void;
  onViralStylesChange?: (styles: ViralStyleAnalysisResult[]) => void;
  productImages: ProductImageAsset[];
  productPrompt: string;
  promptPlanPort?: PromptPlanPort;
  strategyDrafting: boolean;
};

const maxProductImageCount = 3;
const aiWritingDisclaimerAcceptedStorageKey = "commerce-shoot-studio.ai-writing-disclaimer.accepted.v1";
const aiWritingDisclaimerTitle = "图片上传与使用免责声明";
const aiWritingDisclaimerParagraphs = [
  "用户在使用本功能上传图片前，应确保其对所上传图片及图片中包含的人物肖像、商品外观、品牌标识、文字、图案、作品内容等享有合法使用权，或已取得相关权利人、肖像权人及其他必要主体的充分授权。",
  "用户不得上传、识别、编辑、生成或用于商业用途的内容包括但不限于：未经授权的他人肖像、明星或公众人物图片、第三方摄影作品、品牌商品图片、受版权保护的设计图案、商标标识、隐私信息、违法违规内容，以及可能侵犯他人著作权、肖像权、名誉权、隐私权、商标权或其他合法权益的内容。",
  "本功能仅作为图片识别、信息提取和电商文案辅助生成工具，AI 输出结果不代表平台对图片来源、权利归属、授权状态、商业使用合法性或生成内容合规性的确认、保证或背书。用户应自行对上传内容、AI 生成结果及其后续使用行为承担审查义务和法律责任。",
  "如用户将上传图片或生成内容用于商品详情页、广告投放、社交媒体发布、电商平台上架、商业宣传或其他公开传播场景，应自行确认相关内容不存在侵权、虚假宣传、误导消费者或违反平台规则的情形。",
  "如平台发现或收到关于相关内容涉嫌违法、违规、侵权或未经授权使用的投诉、通知或权利主张，平台有权在法律允许范围内采取包括但不限于停止处理、删除相关内容、限制功能使用、暂停或终止服务、保存必要记录并配合有关部门处理等措施。因用户上传、使用或传播相关内容引发的争议、投诉、索赔、行政处罚或其他法律责任，由用户自行承担；因此给平台或第三方造成损失的，用户应依法承担相应责任。",
];
const platformOptions = [
  { label: "淘宝天猫", value: "淘宝天猫" },
  { label: "亚马逊", value: "亚马逊" },
  { label: "拼多多", value: "拼多多" },
  { label: "抖音电商", value: "抖音电商" },
  { label: "京东", value: "京东" },
];
const chinaOnlyPlatforms = new Set(["淘宝天猫", "拼多多", "抖音电商", "京东"]);
const marketOptions = [
  { label: "中国", value: "中国" },
  { label: "美国", value: "美国" },
  { label: "东南亚", value: "东南亚" },
  { label: "日本", value: "日本" },
  { label: "韩国", value: "韩国" },
  { label: "墨西哥", value: "墨西哥" },
];
const languageOptions = [
  { label: "中文", value: "中文" },
  { label: "英文", value: "英文" },
  { label: "日文", value: "日文" },
  { label: "韩文", value: "韩文" },
  { label: "西班牙文", value: "西班牙文" },
];
const formatOptions = [
  { label: "高级A+", tone: "group" as const, value: "高级A+" },
  { detail: "1464:600", label: "高级A+（Web端）", nested: true, value: "高级A+（Web端）" },
  { detail: "600:450", label: "高级A+（移动端）", nested: true, value: "高级A+（移动端）" },
  { detail: "970:600", label: "普通A+", value: "普通A+" },
  { label: "1:1", value: "1:1" },
  { label: "3:4", value: "3:4" },
  { label: "9:16", value: "9:16" },
  { label: "16:9", value: "16:9" },
];
const advancedFormatValues = ["高级A+（Web端）", "高级A+（移动端）"];
const defaultAdvancedFormat = "高级A+（Web端）";
const amazonPlatform = "亚马逊";
const marketLanguageMap: Record<string, string> = {
  中国: "中文",
  美国: "英文",
  东南亚: "英文",
  日本: "日文",
  韩国: "韩文",
  墨西哥: "西班牙文",
};

export type ViralStyleAnalysisResult = {
  colors: string[];
  designFocus?: string;
  id?: string;
  subtitle: string;
  title: string;
};

export type ProductGenerationSettings = {
  advancedFormats: string[];
  format: string;
  language: string;
  listingCopyGenerationEnabled: boolean;
  market: string;
  platform: string;
  viralStyleAnalysisEnabled: boolean;
};

export const defaultProductGenerationSettings: ProductGenerationSettings = {
  advancedFormats: [],
  format: "1:1",
  language: "中文",
  listingCopyGenerationEnabled: false,
  market: "中国",
  platform: "淘宝天猫",
  viralStyleAnalysisEnabled: false,
};

export function GenerationConfigPanel({
  aiAssistPort = localAiAssistPort,
  detailGenerating,
  generationSettings,
  modules,
  onBackToProductInputs,
  onGenerateDetails,
  onGenerateStrategy,
  onGenerationSettingsChange,
  onModuleCheckedChange,
  onProductImagesChange,
  onProductPromptChange,
  onViralStylesChange,
  productImages,
  productPrompt,
  promptPlanPort = localPromptPlanPort,
  strategyDrafting,
}: GenerationConfigPanelProps) {
  const { showToast } = useToast();
  const hasProductImages = productImages.length > 0;
  const hasProductPrompt = productPrompt.trim().length > 0;
  const hasSelectedModules = modules.some((module) => module.checked);
  const [aiWritingDisclaimerAccepted, setAiWritingDisclaimerAccepted] = useState(() => readAiWritingDisclaimerAccepted());
  const [aiWritingDisclaimerOpen, setAiWritingDisclaimerOpen] = useState(false);
  const [aiWritingOpen, setAiWritingOpen] = useState(false);
  const [aiWritingStatus, setAiWritingStatus] = useState<"ready" | "writing">("ready");
  const [aiWritingText, setAiWritingText] = useState("");
  const [viralStyles, setViralStyles] = useState<ViralStyleAnalysisResult[]>([]);
  const [selectedViralStyleTitles, setSelectedViralStyleTitles] = useState<Set<string>>(() => new Set());
  const [viralStyleStatus, setViralStyleStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [generatedPromptPlan, setGeneratedPromptPlan] = useState<PromptPlan | null>(null);
  const [cachedPromptPlan, setCachedPromptPlan] = useState<{
    cacheKey: string;
    plan: PromptPlan;
  } | null>(null);
  const [strategyPlanning, setStrategyPlanning] = useState(false);
  const selectedViralStyles = useMemo(
    () =>
      generationSettings.viralStyleAnalysisEnabled
        ? viralStyles.filter((style) => selectedViralStyleTitles.has(style.title))
        : [],
    [generationSettings.viralStyleAnalysisEnabled, selectedViralStyleTitles, viralStyles],
  );
  const generationReady = hasProductImages && hasProductPrompt && hasSelectedModules;
  const generationBlocked = strategyPlanning || viralStyleStatus === "loading";
  const generationActionReady = generationReady && !generationBlocked;
  const generationCtaLabel = !hasProductImages
    ? "请上传产品图"
    : !hasProductPrompt
      ? "请补充商品卖点"
      : !hasSelectedModules
        ? "请选择商品模块"
        : "开始生成";

  function handleMarketChange(market: string) {
    onGenerationSettingsChange({
      ...generationSettings,
      language: marketLanguageMap[market] ?? generationSettings.language,
      market,
    });
  }

  function handlePlatformChange(platform: string) {
    const nextFormat = supportsAPlusFormats(platform) || !isAPlusFormat(generationSettings.format) ? generationSettings.format : "1:1";

    if (chinaOnlyPlatforms.has(platform)) {
      onGenerationSettingsChange({
        ...generationSettings,
        advancedFormats: [],
        format: nextFormat,
        language: "中文",
        market: "中国",
        platform,
      });
      return;
    }

    onGenerationSettingsChange({
      ...generationSettings,
      advancedFormats: supportsAPlusFormats(platform) ? generationSettings.advancedFormats : [],
      format: nextFormat,
      platform,
    });
  }

  async function handleSelectProductImages() {
    const remainingCount = maxProductImageCount - productImages.length;
    let selectedImages: ProductImageAsset[];
    try {
      selectedImages = await selectProductImages(remainingCount);
    } catch (error) {
      showToast({ message: imageSelectionErrorMessage(error), variant: "error" });
      return;
    }

    const knownPaths = new Set(productImages.map((image) => image.path));
    const nextImages = selectedImages.filter((image) => !knownPaths.has(image.path));

    onProductImagesChange([...productImages, ...nextImages].slice(0, maxProductImageCount));
  }

  function handleRemoveProductImage(imageId: string) {
    onProductImagesChange(productImages.filter((image) => image.id !== imageId));
  }

  function startAiWriting() {
    if (!aiWritingDisclaimerAccepted) {
      setAiWritingDisclaimerOpen(true);
      return;
    }

    void runAiWriting();
  }

  async function runAiWriting() {
    if (!hasProductImages) {
      showToast({ message: "请先上传商品图", variant: "error" });
      return;
    }

    setAiWritingOpen(true);
    setAiWritingStatus("writing");
    setAiWritingText("");

    try {
      const convertedImages = productImages
        .filter((image) => image.aiAssistDataUrl)
        .map((image) => ({
          originalName: image.name,
          mimeType: image.aiAssistMimeType,
          dataUrl: image.aiAssistDataUrl,
        }));
      const assistInput = {
        imagePaths: productImages
          .filter((image) => !image.aiAssistDataUrl)
          .map((image) => image.path),
        ...(convertedImages.length > 0 ? { images: convertedImages } : {}),
      };
      const result = aiAssistPort.streamProductSellingPoints
        ? await aiAssistPort.streamProductSellingPoints(assistInput, {
            onDelta: (delta) => setAiWritingText((currentText) => `${currentText}${delta}`),
          })
        : await aiAssistPort.generateProductSellingPoints(assistInput);
      setAiWritingText((currentText) => result.text?.trim() || currentText.trim() || "需补充");
      setAiWritingStatus("ready");
    } catch (error) {
      setAiWritingStatus("ready");
      setAiWritingOpen(false);
      showToast({ message: aiWritingErrorMessage(error), variant: "error" });
    }
  }

  function handleAcceptAiWritingDisclaimer() {
    writeAiWritingDisclaimerAccepted();
    setAiWritingDisclaimerAccepted(true);
    setAiWritingDisclaimerOpen(false);
    void runAiWriting();
  }

  function handleConfirmAiWriting() {
    onProductPromptChange(aiWritingText);
    setAiWritingOpen(false);
  }

  function handleAdditionalFeatureChange(
    feature: "listingCopyGenerationEnabled" | "viralStyleAnalysisEnabled",
    enabled: boolean,
  ) {
    onGenerationSettingsChange({ ...generationSettings, [feature]: enabled });
    if (feature === "viralStyleAnalysisEnabled" && !enabled) {
      setViralStyleStatus("idle");
      setViralStyles([]);
      setSelectedViralStyleTitles(new Set());
    }
  }

  async function startViralStyleAnalysis() {
    if (!hasProductPrompt) {
      return;
    }

    setSelectedViralStyleTitles(new Set());
    setViralStyleStatus("loading");
    try {
      const result = await aiAssistPort.analyzeViralStyle({
        platform: generationSettings.platform,
        productSellingPoints: productPrompt.trim(),
      });
      setViralStyles(normalizeViralStyleAnalysisResult(result.data));
      setViralStyleStatus("ready");
    } catch (error) {
      setViralStyles([]);
      setViralStyleStatus("idle");
      showToast({ message: aiWritingErrorMessage(error), variant: "error" });
    }
  }

  function refreshViralStyleAnalysis() {
    void startViralStyleAnalysis();
  }

  function handleGenerateStrategyClick() {
    if (!generationReady || generationBlocked) {
      return;
    }

    const promptPlanIntent = createProductDetailPromptPlanIntent(
      modules,
      generationSettings,
      productPrompt,
      selectedViralStyles,
    );
    const promptPlanCacheKey = createProductDetailPromptPlanCacheKey(
      modules,
      generationSettings,
      productImages,
      productPrompt,
      selectedViralStyles,
    );
    if (cachedPromptPlan?.cacheKey === promptPlanCacheKey) {
      setGeneratedPromptPlan(cachedPromptPlan.plan);
      onGenerateStrategy();
      return;
    }

    setGeneratedPromptPlan(null);
    setStrategyPlanning(true);
    onGenerateStrategy();

    void promptPlanPort
      .createPlan({
        workspace: "product",
        intent: promptPlanIntent,
      })
      .then((plan) => {
        validateProductDetailPromptPlan(plan, modules, selectedViralStyles);
        setCachedPromptPlan({ cacheKey: promptPlanCacheKey, plan });
        setGeneratedPromptPlan(plan);
      })
      .catch((error) => {
        setGeneratedPromptPlan(null);
        showToast({ message: promptPlanErrorMessage(error), variant: "error" });
        onBackToProductInputs();
      })
      .finally(() => setStrategyPlanning(false));
  }

  useEffect(() => {
    onViralStylesChange?.(selectedViralStyles);
  }, [onViralStylesChange, selectedViralStyles]);

  if (strategyDrafting) {
    return (
      <ProductStrategyDraftingPanel
        generationSettings={generationSettings}
        detailGenerating={detailGenerating}
        modules={modules}
        onBack={onBackToProductInputs}
        onGenerateDetails={onGenerateDetails}
        onDraftChanged={() => setCachedPromptPlan(null)}
        promptPlan={generatedPromptPlan}
        promptPlanLoading={strategyPlanning}
        selectedViralStyles={selectedViralStyles}
      />
    );
  }

  return (
    <>
    <aside
      aria-label="生成配置"
      className="relative z-40 flex min-h-0 flex-col bg-white/50 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
    >
      <div
        className="min-h-0 flex-1 overscroll-none overflow-y-auto px-4 py-5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]"
        data-testid="generation-config-scroll"
      >
        <ControlGroup title="商品原图" hint="最多 3 张">
          {hasProductImages ? (
            <ImageUploadGrid
              addLabel="添加商品原图"
              images={productImages}
              maxCount={maxProductImageCount}
              onAdd={handleSelectProductImages}
              onRemove={handleRemoveProductImage}
            />
          ) : (
            <UploadDropzone
              actionLabel="上传图片"
              description="同一产品，多角度图片可提升生成稳定性。"
              icon={<UploadCloud className="size-4" />}
              onClick={handleSelectProductImages}
            />
          )}
        </ControlGroup>

        <ControlGroup title="生成设置">
          <div className="grid grid-cols-3 gap-2">
            <SelectPill
              onChange={handlePlatformChange}
              options={platformOptions}
              value={generationSettings.platform}
            />
            <SelectPill
              onChange={handleMarketChange}
              options={marketOptions}
              value={generationSettings.market}
            />
            <SelectPill
              onChange={(language) => onGenerationSettingsChange({ ...generationSettings, language })}
              options={languageOptions}
              value={generationSettings.language}
            />
          </div>
          <ProductFormatSelect
            className="mt-2"
            onChange={onGenerationSettingsChange}
            settings={generationSettings}
          />
        </ControlGroup>

        <ControlGroup
          title="商品卖点&要求"
          action={
            <Button onClick={startAiWriting} size="xs" type="button" variant="softBlue">
              <WandSparkles className="size-3" />
              AI 帮写
            </Button>
          }
        >
          <TextAreaPanel
            onChange={(event) => onProductPromptChange(event.target.value)}
            placeholder={"建议包含以下信息生成更精准：\n1. 产品名称\n2. 核心卖点\n3. 适用人群\n4. 期望场景\n5. 具体参数"}
            value={productPrompt}
          />
        </ControlGroup>

        {aiWritingOpen ? (
          <div
            aria-label="AI 帮写"
            aria-modal="true"
            className="absolute left-[calc(100%-12px)] top-[330px] z-50 w-[360px] rounded-[14px] border border-white/80 bg-white p-5 shadow-[0_20px_46px_rgba(15,23,42,0.16),0_8px_18px_rgba(15,23,42,0.08)]"
            role="dialog"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-slate-950">AI 帮写</h2>
              <button
                aria-label="关闭 AI 帮写"
                className="grid size-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setAiWritingOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            <div
              className="h-44 max-h-64 overflow-y-auto rounded-control border border-slate-300 bg-white px-3 py-2.5 text-[13px] leading-6 text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)]"
              data-testid="ai-writing-output"
            >
              {aiWritingStatus === "writing" && !aiWritingText ? (
                <span className="text-slate-400">等待模型返回内容...</span>
              ) : (
                aiWritingText
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {aiWritingStatus === "writing" ? (
                <Button
                  className="border-slate-100 bg-slate-100 text-slate-500 shadow-none"
                  disabled
                  size="sm"
                  type="button"
                >
                  正在改写中
                </Button>
              ) : (
                <>
                  <Button
                    className="border-slate-100 bg-slate-100 text-slate-800 shadow-none hover:bg-slate-200/80"
                    onClick={startAiWriting}
                    size="sm"
                    type="button"
                  >
                    重新帮写
                  </Button>
                  <Button
                    className="border-slate-900 bg-[#1f1f21] text-white shadow-none hover:bg-black"
                    onClick={handleConfirmAiWriting}
                    size="sm"
                    type="button"
                  >
                    确认
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <ControlGroup title="包含模块（多选）" hint="组件化生成">
          <div className="grid grid-cols-2 gap-2">
            {modules.map((module) => (
              <ModuleTile
                key={module.id}
                {...module}
                onCheckedChange={(checked) => onModuleCheckedChange(module.id, checked)}
              />
            ))}
          </div>
        </ControlGroup>

        <ControlGroup title="附加功能">
          <div className="space-y-3">
            <ProductExtraFeatureCard
              checked={generationSettings.viralStyleAnalysisEnabled}
              label="爆款风格分析"
              onCheckedChange={(checked) => handleAdditionalFeatureChange("viralStyleAnalysisEnabled", checked)}
            >
              {generationSettings.viralStyleAnalysisEnabled ? (
                <ViralStyleAnalysisPanel
                  disabled={!hasProductPrompt}
                  onAnalyze={() => void startViralStyleAnalysis()}
                  onRefresh={refreshViralStyleAnalysis}
                  status={viralStyleStatus}
                  selectedStyleTitles={selectedViralStyleTitles}
                  styles={viralStyles}
                  onStyleCheckedChange={(styleTitle, checked) =>
                    setSelectedViralStyleTitles((currentTitles) => {
                      const nextTitles = new Set(currentTitles);
                      if (checked) {
                        nextTitles.add(styleTitle);
                      } else {
                        nextTitles.delete(styleTitle);
                      }
                      return nextTitles;
                    })
                  }
                />
              ) : null}
            </ProductExtraFeatureCard>

            <ProductExtraFeatureCard
              checked={generationSettings.listingCopyGenerationEnabled}
              label="商品上架文案生成"
              onCheckedChange={(checked) => handleAdditionalFeatureChange("listingCopyGenerationEnabled", checked)}
              showHelp
            />
          </div>
        </ControlGroup>
      </div>

      <div className="relative border-t border-white/70 bg-white/70 p-4 shadow-[0_-14px_28px_rgba(248,250,252,0.72)] backdrop-blur-2xl">
        <Button
          className={cn(
            "h-10 w-full justify-center rounded-control border font-semibold",
            generationActionReady
              ? "border-slate-950/10 bg-[linear-gradient(180deg,#111827,#071022)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_24px_rgba(15,23,42,0.22)] hover:bg-[linear-gradient(180deg,#172033,#0b1220)]"
              : "cursor-not-allowed border-slate-300 bg-slate-300 text-slate-700 shadow-none hover:bg-slate-300 hover:shadow-none",
          )}
          disabled={!generationActionReady}
          onClick={handleGenerateStrategyClick}
          type="button"
        >
          {strategyPlanning ? "生成中..." : generationCtaLabel}
        </Button>
      </div>
    </aside>
    {aiWritingDisclaimerOpen
      ? createPortal(
          <AiWritingDisclaimerDialog
            onAccept={handleAcceptAiWritingDisclaimer}
            onClose={() => setAiWritingDisclaimerOpen(false)}
          />,
          document.body,
        )
      : null}
    </>
  );
}

function readAiWritingDisclaimerAccepted() {
  try {
    return window.localStorage.getItem(aiWritingDisclaimerAcceptedStorageKey) === "true";
  } catch {
    return false;
  }
}

function writeAiWritingDisclaimerAccepted() {
  try {
    window.localStorage.setItem(aiWritingDisclaimerAcceptedStorageKey, "true");
  } catch {
    // 存储不可用时仍允许本次继续，避免阻断用户操作。
  }
}

function aiWritingErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "AI 帮写失败，请检查模型配置后重试";
}

function promptPlanErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "场景描述生成失败，将使用本地草稿继续";
}

function normalizeViralStyleAnalysisResult(data: unknown): ViralStyleAnalysisResult[] {
  if (!data || typeof data !== "object" || !("items" in data)) {
    throw new Error("爆款风格分析返回结构无效");
  }
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length !== 4) {
    throw new Error("爆款风格分析返回结构无效");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error("爆款风格分析返回结构无效");
    }
    const source = item as Record<string, unknown>;
    const title = stringField(source.title);
    const subtitle = stringField(source.subtitle);
    const colors = Array.isArray(source.colors) ? source.colors.map(stringField).filter(isHexColor) : [];
    if (!title || !subtitle || colors.length < 2 || colors.length > 3) {
      throw new Error("爆款风格分析返回结构无效");
    }
    return {
      colors,
      designFocus: stringField(source.designFocus),
      id: stringField(source.id) || `style-${index + 1}`,
      subtitle: compactViralStyleSubtitle(subtitle),
      title,
    };
  });
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function compactViralStyleSubtitle(value: string) {
  return Array.from(value).slice(0, 15).join("");
}

function imageSelectionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "图片处理失败，请使用 png、jpg、jpeg 或 webp 图片。";
}

function AiWritingDisclaimerDialog({
  onAccept,
  onClose,
}: {
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[170] grid place-items-center bg-slate-950/24 px-5 backdrop-blur-[3px]">
      <div
        aria-label={aiWritingDisclaimerTitle}
        aria-modal="true"
        className="w-[min(640px,calc(100vw-40px))] overflow-hidden rounded-[18px] border border-white/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.22),0_8px_24px_rgba(15,23,42,0.10)]"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-400">AI 帮写</div>
            <h2 className="mt-1 text-[18px] font-semibold text-slate-950">{aiWritingDisclaimerTitle}</h2>
          </div>
          <button
            aria-label="关闭免责声明"
            className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[48vh] space-y-4 overflow-y-auto px-6 py-5 text-[13px] leading-6 text-slate-600 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
          {aiWritingDisclaimerParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
          <Button
            className="border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-100"
            onClick={onClose}
            size="sm"
            type="button"
          >
            取消
          </Button>
          <Button
            className="border-slate-900 bg-[#1f1f21] text-white shadow-none hover:bg-black"
            onClick={onAccept}
            size="sm"
            type="button"
          >
            我已知悉并继续
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProductExtraFeatureCard({
  badge,
  checked,
  children,
  label,
  onCheckedChange,
  showHelp = false,
}: {
  badge?: string;
  checked: boolean;
  children?: ReactNode;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  showHelp?: boolean;
}) {
  return (
    <div className="rounded-[11px] bg-slate-100/80 px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium text-slate-800">{label}</span>
          {showHelp ? <ListingCopyTooltip /> : null}
          {badge ? (
            <span className="shrink-0 rounded-[6px] bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-600">
              {badge}
            </span>
          ) : null}
        </div>
        <ProductExtraFeatureSwitch checked={checked} label={label} onCheckedChange={onCheckedChange} />
      </div>
      {children}
    </div>
  );
}

function ListingCopyTooltip() {
  return (
    <span className="group relative inline-flex">
      <HelpCircle
        aria-label="商品上架文案生成说明"
        className="size-3.5 shrink-0 cursor-help text-slate-400 transition-colors group-hover:text-slate-600"
      />
      <span
        className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-50 w-[260px] -translate-x-1/2 rounded-[8px] bg-slate-800/88 px-3 py-2 text-center text-[12px] font-medium leading-5 text-white opacity-0 shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition-opacity group-hover:opacity-100"
        role="tooltip"
      >
        根据所选平台规范，智能生成符合上架要求的商品文案
      </span>
    </span>
  );
}

function ViralStyleAnalysisPanel({
  disabled,
  onAnalyze,
  onRefresh,
  onStyleCheckedChange,
  selectedStyleTitles,
  status,
  styles,
}: {
  disabled: boolean;
  onAnalyze: () => void;
  onRefresh: () => void;
  onStyleCheckedChange: (styleTitle: string, checked: boolean) => void;
  selectedStyleTitles: Set<string>;
  status: "idle" | "loading" | "ready";
  styles: ViralStyleAnalysisResult[];
}) {
  if (status === "loading") {
    return (
      <div className="mt-4 rounded-[11px] border border-white/70 bg-white/70 px-4 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
        <Loader2 className="mx-auto size-5 animate-spin text-app-blue" />
        <div className="mt-2 text-[13px] font-medium text-slate-800">正在分析爆款风格...</div>
        <p className="mt-1 text-[12px] text-slate-500">根据平台与商品卖点分析视觉方向</p>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="mt-4">
        <div className="grid grid-cols-2 gap-3">
          {styles.map((style) => (
            <ViralStyleCard
              checked={selectedStyleTitles.has(style.title)}
              key={style.title}
              onCheckedChange={(checked) => onStyleCheckedChange(style.title, checked)}
              style={style}
            />
          ))}
        </div>
        <button
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-slate-200/90 bg-white text-[13px] font-medium text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-white/95"
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw className="size-3.5" />
          换一批风格
        </button>
      </div>
    );
  }

  return (
    <button
      aria-label="开始爆款风格分析"
      className={cn(
        "mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-[11px] border border-slate-200/90 bg-white text-[13px] font-medium text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-white/95 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white/60 disabled:text-slate-400 disabled:shadow-none",
      )}
      disabled={disabled}
      onClick={onAnalyze}
      type="button"
    >
      <WandSparkles className={cn("size-4", disabled ? "text-slate-400" : "text-app-blue")} />
      爆款风格分析
    </button>
  );
}

function ViralStyleCard({
  checked,
  onCheckedChange,
  style,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  style: ViralStyleAnalysisResult;
}) {
  return (
    <label className="flex min-h-[112px] flex-col rounded-[10px] bg-white px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-2">
        <input
          aria-label={style.title}
          checked={checked}
          className="mt-0.5 size-4 rounded-[4px] border-slate-300 text-app-blue focus:ring-app-blue/30"
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-900">{style.title}</div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">{style.subtitle}</p>
        </div>
      </div>
      <div className="mt-auto flex justify-end gap-2 pt-3" data-testid="viral-style-color-row">
        {style.colors.slice(0, 3).map((color, index) => (
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(148,163,184,0.18),0_1px_2px_rgba(15,23,42,0.10)]"
            data-testid="viral-style-color-dot"
            key={`${style.title}-${color}-${index}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </label>
  );
}

function ProductExtraFeatureSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={cn(
        "relative h-5 w-9 shrink-0 overflow-hidden rounded-full shadow-[inset_0_1px_2px_rgba(15,23,42,0.14)] transition-colors",
        checked ? "bg-app-blue" : "bg-slate-500",
      )}
      onClick={() => onCheckedChange(!checked)}
      type="button"
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.18)] transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export type StrategyModuleDraft = {
  content: string;
  contentEdited?: boolean;
  description: string;
  id: string;
  promptPlanItems?: StrategyModulePromptPlanItem[];
  title: string;
};

export type StrategyModulePromptPlanItem = {
  imagePrompt: string;
  sceneDescription: string;
  styleId?: string;
  styleTitle?: string;
};

type StrategyModuleDragPreview = {
  currentX: number;
  currentY: number;
  height: number;
  id: string;
  left: number;
  offsetX: number;
  offsetY: number;
  top: number;
  width: number;
};

type ProductStrategyDraftingPanelProps = {
  detailGenerating: boolean;
  generationSettings: ProductGenerationSettings;
  modules: ModuleOption[];
  onBack: () => void;
  onDraftChanged: () => void;
  onGenerateDetails: (drafts: StrategyModuleDraft[]) => void;
  promptPlan?: PromptPlan | null;
  promptPlanLoading: boolean;
  selectedViralStyles: ViralStyleAnalysisResult[];
};

function ProductStrategyDraftingPanel({
  detailGenerating,
  generationSettings,
  modules,
  onBack,
  onDraftChanged,
  onGenerateDetails,
  promptPlan,
  promptPlanLoading,
  selectedViralStyles,
}: ProductStrategyDraftingPanelProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<StrategyModuleDragPreview | null>(null);
  const draggingModuleIdRef = useRef<string | null>(null);
  const appliedPromptPlanIdRef = useRef<string | null>(null);
  const [moduleDrafts, setModuleDrafts] = useState<StrategyModuleDraft[]>([]);
  const draggingModule = dragPreview
    ? moduleDrafts.find((moduleDraft) => moduleDraft.id === dragPreview.id)
    : undefined;
  const generationImageCount = moduleDrafts.length * Math.max(selectedViralStyles.length, 1);

  useEffect(() => {
    if (!promptPlan || appliedPromptPlanIdRef.current === promptPlan.id) {
      return;
    }
    appliedPromptPlanIdRef.current = promptPlan.id;
    setModuleDrafts((currentDrafts) => {
      if (currentDrafts.some((draft) => draft.contentEdited)) {
        return currentDrafts;
      }
      return modules
        .filter((module) => module.checked)
        .map((module) => createStrategyModuleDraft(module, promptPlan))
        .filter((draft): draft is StrategyModuleDraft => draft !== null);
    });
  }, [modules, promptPlan]);

  useEffect(() => {
    if (!draggingModuleId || detailGenerating) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
      const clientY = Number.isFinite(event.clientY) ? event.clientY : 0;

      setDragPreview((currentPreview) =>
        currentPreview ? { ...currentPreview, currentX: clientX, currentY: clientY } : currentPreview,
      );

      const sourceModuleId = draggingModuleIdRef.current;
      if (!sourceModuleId || typeof document.elementFromPoint !== "function") {
        return;
      }

      const targetCard = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-testid='strategy-module-card']");
      const targetModuleId = targetCard?.dataset.moduleId;
      if (!targetCard || !targetModuleId || targetModuleId === sourceModuleId) {
        return;
      }

      const targetRect = targetCard.getBoundingClientRect();
      const insertPosition = clientY > targetRect.top + targetRect.height / 2 ? "after" : "before";

      moveModuleRelative(targetModuleId, insertPosition, sourceModuleId, false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", clearDraggingModule, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clearDraggingModule);
    };
  }, [detailGenerating, draggingModuleId]);

  function removeModule(moduleId: string) {
    if (detailGenerating) {
      return;
    }

    setModuleDrafts((currentDrafts) => currentDrafts.filter((draft) => draft.id !== moduleId));
    onDraftChanged();
  }

  function rewriteModule(moduleId: string, content: string) {
    if (detailGenerating) {
      return;
    }

    setModuleDrafts((currentDrafts) =>
      currentDrafts.map((draft) => (draft.id === moduleId ? { ...draft, content, contentEdited: true } : draft)),
    );
    onDraftChanged();
  }

  function handleModulePointerDown(event: ReactPointerEvent<HTMLElement>, moduleId: string) {
    if (detailGenerating) {
      return;
    }

    const card = event.currentTarget.closest<HTMLElement>("[data-testid='strategy-module-card']");
    if (!card) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const rect = card.getBoundingClientRect();
    const clientX = Number.isFinite(event.clientX) ? event.clientX : rect.left;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top;
    draggingModuleIdRef.current = moduleId;
    setDragPreview({
      currentX: clientX,
      currentY: clientY,
      height: rect.height,
      id: moduleId,
      left: rect.left,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      top: rect.top,
      width: rect.width,
    });
    setDraggingModuleId(moduleId);
  }

  function clearDraggingModule() {
    draggingModuleIdRef.current = null;
    setDragPreview(null);
    setDraggingModuleId(null);
  }

  function moveModuleRelative(
    targetModuleId: string,
    insertPosition: "before" | "after",
    droppedModuleId?: string,
    shouldClearDragging = true,
  ) {
    if (detailGenerating) {
      return;
    }

    const sourceModuleId = droppedModuleId || draggingModuleIdRef.current || draggingModuleId;
    if (!sourceModuleId || sourceModuleId === targetModuleId) {
      return;
    }

    setModuleDrafts((currentDrafts) => {
      const sourceDraft = currentDrafts.find((draft) => draft.id === sourceModuleId);
      if (!sourceDraft) {
        return currentDrafts;
      }

      const remainingDrafts = currentDrafts.filter((draft) => draft.id !== sourceModuleId);
      const targetIndex = remainingDrafts.findIndex((draft) => draft.id === targetModuleId);
      if (targetIndex < 0) {
        return currentDrafts;
      }
      const insertIndex = insertPosition === "after" ? targetIndex + 1 : targetIndex;

      return [
        ...remainingDrafts.slice(0, insertIndex),
        sourceDraft,
        ...remainingDrafts.slice(insertIndex),
      ];
    });
    onDraftChanged();
    if (shouldClearDragging) {
      clearDraggingModule();
    }
  }

  if (promptPlanLoading || !promptPlan) {
    return (
      <aside
        aria-label="模块策略与设计规范"
        className="relative z-40 flex min-h-0 flex-col bg-white/70 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <h2 className="text-[14px] font-semibold text-slate-950">模块策略与设计规范</h2>
          <div className="mt-4 flex h-[330px] items-center justify-center rounded-[14px] bg-slate-100/80">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="flex items-center gap-2" aria-hidden="true">
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70" />
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70 [animation-delay:120ms]" />
                <span className="size-2.5 animate-pulse rounded-full bg-slate-400/70 [animation-delay:240ms]" />
              </div>
              <p className="text-[13px] font-medium">生成中...</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_2.25fr] gap-3 border-t border-slate-200/70 bg-white/80 p-4 shadow-[0_-10px_24px_rgba(248,250,252,0.78)] backdrop-blur-2xl">
          <Button
            className="h-10 justify-center border-slate-100 bg-slate-100 text-slate-800 shadow-none hover:bg-slate-200/80"
            onClick={onBack}
            type="button"
          >
            上一步
          </Button>
          <Button
            className="h-10 justify-center border-slate-200 bg-slate-200 font-semibold text-white shadow-none"
            disabled
            type="button"
          >
            请先选择策略
          </Button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="模块策略与设计规范"
      className="relative z-40 flex min-h-0 flex-col bg-white/70 shadow-[inset_1px_0_0_rgba(255,255,255,0.72)] backdrop-blur-2xl"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
        <h2 className="text-[14px] font-semibold text-slate-950">模块策略与设计规范</h2>
        <div className="mt-4 rounded-[14px] border border-slate-200/80 bg-white/82 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          <h3 className="text-[13px] font-medium text-slate-950">产品与卖点</h3>
          <p
            className={cn(
              "mt-2 whitespace-pre-line text-[12px] leading-6 text-slate-700",
              !summaryExpanded && "line-clamp-5",
            )}
            data-testid="strategy-summary-copy"
          >
            {promptPlan.userEditableSummary || "模型未返回产品与卖点摘要"}
            {"\n"}目标语言：{generationSettings.language}
          </p>
          <button
            className="mx-auto mt-2 block text-[12px] font-medium text-slate-700 transition-colors hover:text-slate-950"
            onClick={() => setSummaryExpanded((expanded) => !expanded)}
            type="button"
          >
            {summaryExpanded ? "收起" : "展开全部"}
            <ChevronDown
              className={cn("ml-1 inline size-3.5 transition-transform duration-200", summaryExpanded && "rotate-180")}
            />
          </button>
        </div>

        <h3 className="mt-5 text-[14px] font-semibold text-slate-950">模块内容</h3>
        <div className="mt-3 space-y-3">
          {moduleDrafts.map((moduleDraft) => (
            <article
              className={cn(
                "relative rounded-[14px] bg-slate-100/80 p-4 transition-all duration-300 ease-out hover:bg-slate-100",
                draggingModuleId === moduleDraft.id &&
                  "pointer-events-none opacity-35 ring-2 ring-blue-100",
                detailGenerating && "cursor-default opacity-80",
              )}
              data-module-id={moduleDraft.id}
              data-testid="strategy-module-card"
              draggable={false}
              key={moduleDraft.id}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h4 className="min-w-0 text-[13px] font-medium text-slate-950">
                  {moduleDraft.title}: {moduleDraft.description}
                </h4>
                <div className="flex shrink-0 items-center gap-1 text-slate-400">
                  <button
                    aria-label={`删除 ${moduleDraft.title}`}
                    className="grid size-7 place-items-center rounded-full transition-colors hover:bg-white hover:text-slate-700"
                    disabled={detailGenerating}
                    onClick={() => removeModule(moduleDraft.id)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  <span
                    aria-label={`拖动 ${moduleDraft.title}`}
                    className={cn(
                      "grid size-7 select-none place-items-center rounded-full transition-colors hover:bg-white hover:text-slate-700",
                      detailGenerating ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing",
                    )}
                    draggable={false}
                    onPointerDown={(event) => handleModulePointerDown(event, moduleDraft.id)}
                  >
                    <GripVertical className="size-4" />
                  </span>
                </div>
              </div>
              <textarea
                aria-label={`改写 ${moduleDraft.title}`}
                className="min-h-20 w-full resize-none bg-transparent pr-6 text-[12px] leading-6 text-slate-600 outline-none [scrollbar-color:rgba(148,163,184,0.6)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
                disabled={detailGenerating}
                onChange={(event) => rewriteModule(moduleDraft.id, event.target.value)}
                value={moduleDraft.content}
              />
            </article>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_2.25fr] gap-3 border-t border-slate-200/70 bg-white/80 p-4 shadow-[0_-10px_24px_rgba(248,250,252,0.78)] backdrop-blur-2xl">
        <Button
          className="h-10 justify-center border-slate-100 bg-slate-100 text-slate-800 shadow-none hover:bg-slate-200/80"
          onClick={onBack}
          type="button"
        >
          上一步
        </Button>
        <Button
          className={cn(
            "h-10 justify-center font-semibold",
            moduleDrafts.length > 0 && !detailGenerating
              ? "border-slate-950/10 bg-[#1f1f21] text-white shadow-none hover:bg-black"
              : "border-slate-200 bg-slate-200 text-white shadow-none",
          )}
          disabled={moduleDrafts.length === 0 || detailGenerating}
          onClick={() => onGenerateDetails(moduleDrafts)}
          type="button"
        >
          {detailGenerating
            ? "详情图生成中"
            : moduleDrafts.length > 0
              ? `生成详情图（${generationImageCount}张）`
              : "请先选择策略"}
        </Button>
      </div>
      {dragPreview && draggingModule
        ? createPortal(
            <article
              className="pointer-events-none fixed z-[120] rounded-[14px] bg-white p-4 shadow-[0_24px_54px_rgba(15,23,42,0.24)] ring-1 ring-slate-200/80"
              data-testid="strategy-module-drag-preview"
              style={{
                height: dragPreview.height,
                left: dragPreview.currentX - dragPreview.offsetX,
                top: dragPreview.currentY - dragPreview.offsetY,
                width: dragPreview.width,
              }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h4 className="min-w-0 text-[13px] font-medium text-slate-950">
                  {draggingModule.title}: {draggingModule.description}
                </h4>
                <GripVertical className="mt-1 size-4 shrink-0 text-slate-400" />
              </div>
              <p className="line-clamp-4 whitespace-pre-line text-[12px] leading-6 text-slate-600">
                {draggingModule.content}
              </p>
            </article>,
            document.body,
          )
        : null}
    </aside>
  );
}

function createStrategyModuleDraft(
  module: ModuleOption,
  promptPlan: PromptPlan,
): StrategyModuleDraft | null {
  const promptPlanItems = normalizePromptPlanItemsForModule(promptPlan, module.id);
  if (promptPlanItems.length > 0) {
    return {
      content: promptPlanItems[0].sceneDescription,
      description: module.description,
      id: module.id,
      promptPlanItems,
      title: module.title,
    };
  }
  return null;
}

function validateProductDetailPromptPlan(
  promptPlan: PromptPlan,
  modules: ModuleOption[],
  selectedViralStyles: ViralStyleAnalysisResult[],
) {
  const checkedModules = modules.filter((module) => module.checked);
  for (const module of checkedModules) {
    const moduleItems = normalizePromptPlanItemsForModule(promptPlan, module.id);
    if (moduleItems.length === 0) {
      throw new Error(`场景描述生成缺少已选模块：${module.title}`);
    }
    for (const style of selectedViralStyles) {
      const hasStyleItem = moduleItems.some(
        (item) => (item.styleId && style.id && item.styleId === style.id) || item.styleTitle === style.title,
      );
      if (!hasStyleItem) {
        throw new Error(`场景描述生成缺少已选风格：${style.title}`);
      }
    }
  }
}

function normalizePromptPlanItemsForModule(
  promptPlan: PromptPlan | null | undefined,
  moduleId: string,
): StrategyModulePromptPlanItem[] {
  if (!promptPlan?.items?.length) {
    return [];
  }

  return promptPlan.items
    .map((item) => normalizePromptPlanItem(item))
    .filter((item): item is StrategyModulePromptPlanItem & { moduleId: string } => item?.moduleId === moduleId)
    .map(({ moduleId: _moduleId, ...item }) => item);
}

function normalizePromptPlanItem(item: PromptPlanItem):
  | (StrategyModulePromptPlanItem & {
      moduleId: string;
    })
  | null {
  if (!item.intent || typeof item.intent !== "object") {
    return null;
  }
  const intent = item.intent as Record<string, unknown>;
  const moduleId = stringField(intent.moduleId);
  const sceneDescription = stringField(intent.sceneDescription) || item.displaySummary.trim();
  const imagePrompt = stringField(intent.imagePrompt);
  if (!moduleId || !sceneDescription || !imagePrompt) {
    return null;
  }

  return {
    imagePrompt,
    moduleId,
    sceneDescription,
    styleId: stringField(intent.styleId),
    styleTitle: stringField(intent.styleTitle),
  };
}

function createProductDetailPromptPlanIntent(
  modules: ModuleOption[],
  settings: ProductGenerationSettings,
  productPrompt: string,
  selectedViralStyles: ViralStyleAnalysisResult[],
) {
  const ratio = settings.advancedFormats.length > 0 ? settings.advancedFormats.join("、") : settings.format;
  return {
    language: settings.language,
    market: settings.market,
    modules: modules
      .filter((module) => module.checked)
      .map((module) => ({
        description: module.description,
        moduleId: module.id,
        moduleTitle: module.title,
      })),
    platform: settings.platform,
    productSellingPoints: productPrompt.trim(),
    ratio,
    viralStyles: selectedViralStyles.map((style, index) => ({
      colors: style.colors,
      designFocus: style.designFocus ?? "",
      styleId: style.id || `style-${index + 1}`,
      styleTitle: style.title,
      subtitle: style.subtitle,
    })),
  };
}

function createProductDetailPromptPlanCacheKey(
  modules: ModuleOption[],
  settings: ProductGenerationSettings,
  productImages: ProductImageAsset[],
  productPrompt: string,
  selectedViralStyles: ViralStyleAnalysisResult[],
) {
  return JSON.stringify({
    modules: modules.map((module) => ({
      checked: module.checked,
      description: module.description,
      id: module.id,
      title: module.title,
    })),
    productImages: productImages.map((image) => ({
      id: image.id,
      name: image.name,
      src: image.src,
    })),
    productPrompt: productPrompt.trim(),
    selectedViralStyles: selectedViralStyles.map((style) => ({
      colors: style.colors,
      designFocus: style.designFocus ?? "",
      id: style.id ?? "",
      subtitle: style.subtitle,
      title: style.title,
    })),
    settings,
  });
}

type ProductFormatSelectProps = {
  className?: string;
  onChange: (settings: ProductGenerationSettings) => void;
  settings: ProductGenerationSettings;
};

function ProductFormatSelect({ className, onChange, settings }: ProductFormatSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hideAPlusOptions = !supportsAPlusFormats(settings.platform);
  const visibleFormatOptions = hideAPlusOptions
    ? formatOptions.filter((option) => !isAPlusFormat(option.value))
    : formatOptions;
  const selectedAdvancedFormats =
    !hideAPlusOptions && settings.format === "高级A+"
      ? settings.advancedFormats.length > 0
        ? settings.advancedFormats
        : [defaultAdvancedFormat]
      : [];

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function selectAdvancedRoot() {
    onChange({
      ...settings,
      advancedFormats: selectedAdvancedFormats.length > 0 ? selectedAdvancedFormats : [defaultAdvancedFormat],
      format: "高级A+",
    });
  }

  function toggleAdvancedFormat(format: string) {
    const currentFormats = selectedAdvancedFormats.length > 0 ? selectedAdvancedFormats : [defaultAdvancedFormat];
    const nextFormats = currentFormats.includes(format)
      ? currentFormats.filter((currentFormat) => currentFormat !== format)
      : [...currentFormats, format];

    onChange({
      ...settings,
      advancedFormats: nextFormats.length > 0 ? nextFormats : [defaultAdvancedFormat],
      format: "高级A+",
    });
  }

  function removeAdvancedFormat(format: string) {
    const nextFormats = selectedAdvancedFormats.filter((currentFormat) => currentFormat !== format);

    onChange({
      ...settings,
      advancedFormats: nextFormats.length > 0 ? nextFormats : [],
      format: nextFormats.length > 0 ? "高级A+" : "普通A+",
    });
  }

  function selectSimpleFormat(format: string) {
    onChange({
      ...settings,
      advancedFormats: [],
      format,
    });
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        aria-expanded={open}
        className={cn(
          "inline-flex min-h-8 w-full items-center justify-between gap-2 rounded-control border border-white/60 bg-slate-100/70 px-3 py-1.5 text-[12px] font-medium text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-all duration-200 ease-out hover:border-white hover:bg-white/90 hover:shadow-control active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/25",
          open && "border-blue-200 bg-white shadow-control ring-2 ring-blue-100/70",
        )}
        data-testid="product-format-select-trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        type="button"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {settings.format === "高级A+" && !hideAPlusOptions ? (
            selectedAdvancedFormats.map((format) => (
              <span
                key={format}
                className="inline-flex h-6 max-w-full items-center gap-1 rounded-[8px] bg-blue-50 px-2 text-[12px] font-medium text-slate-800"
              >
                <span className="truncate">{format}</span>
                <span
                  className="grid size-4 place-items-center rounded-full text-slate-400 transition-colors hover:bg-blue-100 hover:text-slate-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeAdvancedFormat(format);
                  }}
                  title={`移除 ${format}`}
                >
                  <X className="size-3" />
                </span>
              </span>
            ))
          ) : (
            <span className="truncate">{hideAPlusOptions && isAPlusFormat(settings.format) ? "1:1" : settings.format}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-app-muted transition-transform duration-200",
            open && "rotate-180 text-slate-800",
          )}
        />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-panel border border-white/80 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
          {visibleFormatOptions.map((option) => {
            const advancedChild = advancedFormatValues.includes(option.value);
            const selected =
              option.value === "高级A+"
                ? settings.format === "高级A+"
                : advancedChild
                  ? selectedAdvancedFormats.includes(option.value)
                  : settings.format === option.value;

            return (
              <button
                key={option.value}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[12px] font-semibold text-slate-800 transition-all duration-150 ease-out hover:bg-slate-100 active:scale-[0.99]",
                  option.nested && "pl-6",
                  option.tone === "group" && "bg-slate-100/80",
                  selected && "text-slate-950",
                )}
                onClick={() => {
                  if (option.value === "高级A+") {
                    selectAdvancedRoot();
                    return;
                  }

                  if (advancedChild) {
                    toggleAdvancedFormat(option.value);
                    return;
                  }

                  selectSimpleFormat(option.value);
                }}
                type="button"
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border border-slate-300 bg-white transition-all duration-150",
                    option.nested && "rounded-[5px]",
                    selected && "border-app-blue bg-app-blue text-white shadow-[0_2px_6px_rgba(59,130,246,0.22)]",
                  )}
                >
                  {selected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.detail ? (
                  <span className="shrink-0 text-[12px] font-medium text-slate-400">{option.detail}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function supportsAPlusFormats(platform: string) {
  return platform === amazonPlatform;
}

function isAPlusFormat(format: string) {
  return format === "普通A+" || format === "高级A+" || advancedFormatValues.includes(format);
}
