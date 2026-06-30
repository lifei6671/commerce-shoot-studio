import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { App } from "./App";
import { selectProductImages } from "../features/generation/lib/productImagePicker";

vi.mock("../features/generation/lib/productImagePicker", () => ({
  selectProductImages: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

const selectProductImagesMock = vi.mocked(selectProductImages);
const invokeMock = vi.mocked(invoke);
const saveMock = vi.mocked(save);

describe("App shell", () => {
  beforeEach(() => {
    selectProductImagesMock.mockReset();
    invokeMock.mockReset();
    saveMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a native-feeling workspace with reusable layout regions", () => {
    render(<App />);

    expect(screen.getByRole("banner", { name: "应用工具栏" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /商品/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /商品/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /详情/ })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "生成配置" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "生成预览画布" })).toBeInTheDocument();
    expect(screen.getByTestId("generation-config-scroll")).toHaveClass("overscroll-none");
    expect(screen.getByTestId("studio-side-divider")).toHaveClass(
      "absolute",
      "inset-y-0",
      "left-[var(--studio-side-width)]",
    );
  });

  it("keeps the first UI slice free of right inspector and bottom status regions", () => {
    render(<App />);

    expect(screen.queryByRole("complementary", { name: "右侧属性区" })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo", { name: "底部状态栏" })).not.toBeInTheDocument();
  });

  it("exposes the primary product workflow modules as reusable option tiles", () => {
    render(<App />);

    expect(screen.getByRole("checkbox", { name: "首屏主视觉" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "核心卖点图" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "商品细节图" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).not.toBeChecked();
  });

  it("defaults product generation settings to Tmall China Chinese", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "淘宝天猫" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中国" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it("disables the browser context menu inside the desktop window", () => {
    render(<App />);

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it("opens a local generation history popover and restores generated product results", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "生成记录" }));

    expect(screen.getByRole("dialog", { name: "生成记录" })).toBeInTheDocument();
    expect(screen.getByText("暂无生成记录")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成记录" }));
    expect(screen.queryByRole("dialog", { name: "生成记录" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成记录" }));
    await user.click(screen.getByRole("button", { name: "关闭生成记录" }));
    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "网面人像印花无袖运动T恤");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "生成详情图（2张）" }));

    fireEvent.click(screen.getByRole("button", { name: /生成记录/ }));

    const historyDialog = screen.getByRole("dialog", { name: "生成记录" });
    expect(within(historyDialog).getByText("商品详情图")).toBeInTheDocument();
    expect(within(historyDialog).getByText("生成中")).toBeInTheDocument();
    expect(within(historyDialog).getByText(/淘宝天猫 · 中国 · 中文 · 9:16 · 2 张/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    expect(within(historyDialog).getByText("已完成")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭生成记录" }));
    await user.click(screen.getByRole("button", { name: "服饰" }));

    expect(screen.getByText("AI服饰穿戴")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /生成记录/ }));
    const restoredHistoryDialog = screen.getByRole("dialog", { name: "生成记录" });
    await user.click(within(restoredHistoryDialog).getAllByRole("button", { name: /商品详情图/ })[0]);

    expect(screen.getByRole("button", { name: /商品/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    expect(screen.getAllByTestId("generated-detail-image-card")).toHaveLength(2);
  });

  it("opens product image selection, previews selected images, and removes them", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
      {
        id: "/Users/demo/Pictures/poster.jpg",
        name: "poster.jpg",
        path: "/Users/demo/Pictures/poster.jpg",
        src: "asset://poster.jpg",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "上传图片" }));

    expect(selectProductImagesMock).toHaveBeenCalledWith(3);
    expect(await screen.findByAltText("helmet.png")).toBeInTheDocument();
    expect(screen.getByAltText("poster.jpg")).toBeInTheDocument();
    expect(screen.getAllByTestId("product-image-preview-card")[0]).toHaveClass(
      "rounded-[22px]",
      "p-[3px]",
      "ring-1",
      "ring-slate-200/80",
    );
    expect(screen.getByRole("button", { name: "添加商品原图" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 helmet.png" }));

    expect(screen.queryByAltText("helmet.png")).not.toBeInTheDocument();
    expect(screen.getByAltText("poster.jpg")).toBeInTheDocument();
  });

  it("opens product image selection when clicking the upload dropzone body", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([]);

    render(<App />);

    const uploadDropzone = screen.getByRole("button", { name: "上传图片" });
    expect(uploadDropzone).toHaveClass(
      "w-full",
      "border-2",
      "border-dashed",
      "hover:border-blue-200",
    );

    await user.click(screen.getByText("同一产品，多角度图片可提升生成稳定性。"));

    expect(selectProductImagesMock).toHaveBeenCalledWith(3);
  });

  it("uploads clothing images, keeps one selected model, and hides scene controls when AI recommends", async () => {
    const user = userEvent.setup();

    selectProductImagesMock
      .mockResolvedValueOnce([
        {
          id: "/Users/demo/Pictures/look-1.png",
          name: "look-1.png",
          path: "/Users/demo/Pictures/look-1.png",
          src: "asset://look-1.png",
        },
        {
          id: "/Users/demo/Pictures/look-2.png",
          name: "look-2.png",
          path: "/Users/demo/Pictures/look-2.png",
          src: "asset://look-2.png",
        },
        {
          id: "/Users/demo/Pictures/look-3.png",
          name: "look-3.png",
          path: "/Users/demo/Pictures/look-3.png",
          src: "asset://look-3.png",
        },
        {
          id: "/Users/demo/Pictures/look-4.png",
          name: "look-4.png",
          path: "/Users/demo/Pictures/look-4.png",
          src: "asset://look-4.png",
        },
        {
          id: "/Users/demo/Pictures/look-5.png",
          name: "look-5.png",
          path: "/Users/demo/Pictures/look-5.png",
          src: "asset://look-5.png",
        },
        {
          id: "/Users/demo/Pictures/look-6.png",
          name: "look-6.png",
          path: "/Users/demo/Pictures/look-6.png",
          src: "asset://look-6.png",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "/Users/demo/Pictures/model-a.png",
          name: "model-a.png",
          path: "/Users/demo/Pictures/model-a.png",
          src: "asset://model-a.png",
        },
      ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));

    expect(selectProductImagesMock).toHaveBeenLastCalledWith(5);
    expect(await screen.findByAltText("look-1.png")).toBeInTheDocument();
    expect(screen.getByAltText("look-5.png")).toBeInTheDocument();
    expect(screen.queryByAltText("look-6.png")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加服装图片" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上传新模特" }));

    expect(selectProductImagesMock).toHaveBeenLastCalledWith(1);
    const uploadedModel = await screen.findByRole("button", { name: "选择模特 model-a.png" });
    expect(uploadedModel).toHaveAttribute("aria-pressed", "true");
    expect(within(uploadedModel).getByLabelText("已选中 model-a.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "柔光女模" }));

    expect(uploadedModel).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "柔光女模" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("已选中 model-a.png")).not.toBeInTheDocument();

    const aiRecommendSwitch = screen.getByRole("button", { name: "AI推荐" });
    expect(aiRecommendSwitch).toHaveAttribute("aria-pressed", "false");

    await user.click(aiRecommendSwitch);

    expect(aiRecommendSwitch).toHaveAttribute("aria-pressed", "true");
    expect(within(aiRecommendSwitch).getByTestId("ai-recommend-switch-thumb")).toHaveClass("translate-x-4");
    expect(screen.queryByText("拍摄场景")).not.toBeInTheDocument();
    expect(screen.queryByText("自定义描述场景")).not.toBeInTheDocument();
  });

  it("shows AI model generation controls after switching the clothing model tab", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));

    expect(screen.getByRole("button", { name: "AI 生成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "上传新模特" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "柔光女模" })).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-model-generation-controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "性别 男" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "年龄 青年" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "人群 中国人" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "体型 标准" })).toBeInTheDocument();

    const genderSelect = screen.getByRole("button", { name: "性别 男" });

    expect(genderSelect).toHaveClass("h-8", "rounded-control", "border", "border-white/60", "text-[12px]");

    await user.click(genderSelect);

    expect(genderSelect).toHaveClass("border-blue-200", "bg-white", "ring-2", "ring-blue-100/70");

    for (const option of ["男", "女"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "女" }));

    expect(screen.getByRole("button", { name: "性别 女" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "年龄 青年" }));

    for (const option of ["婴儿", "儿童", "青少年", "青年", "中年", "老年"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "中年" }));

    expect(screen.getByRole("button", { name: "年龄 中年" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "人群 中国人" }));

    for (const option of ["欧美白人", "中国人", "东亚人", "东南亚人", "非裔", "中东人", "拉丁裔"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "东南亚人" }));

    expect(screen.getByRole("button", { name: "人群 东南亚人" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "体型 标准" }));

    for (const option of ["纤细", "标准", "肌肉", "微胖", "大码"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "肌肉" }));

    expect(screen.getByRole("button", { name: "体型 肌肉" })).toBeInTheDocument();

    const detailInput = screen.getByRole("textbox", { name: "外貌细节" });
    expect(detailInput).toHaveAttribute("placeholder", "例如：小麦色皮肤、齐刘海、眼角有泪痣...");

    await user.type(detailInput, "小麦色皮肤，短发");

    expect(detailInput).toHaveValue("小麦色皮肤，短发");
    expect(screen.getByRole("button", { name: "生成基准模特" })).toBeInTheDocument();
  });

  it("drafts clothing scene selection after uploading clothing images", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));

    expect(selectProductImagesMock).toHaveBeenCalledWith(5);
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "柔光女模" }));

    const generateButton = screen.getByRole("button", { name: "开始生成" });
    expect(generateButton).toBeEnabled();

    vi.useFakeTimers();
    fireEvent.click(generateButton);

    expect(screen.getByRole("complementary", { name: "选择场景" })).toBeInTheDocument();
    expect(screen.getByText("生成中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    expect(screen.getByRole("complementary", { name: "选择场景" })).toBeInTheDocument();
    expect(screen.getByText("都市街头")).toBeInTheDocument();
    expect(screen.getByText("街角咖啡")).toBeInTheDocument();
    expect(screen.getAllByTestId("clothing-scene-card")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "生成场景图片（6张）" })).toBeEnabled();
  });

  it("links clothing scene selections, reveals dropdowns only for selected cards, and generates results", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "服饰" }));
    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "柔光女模" }));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    const urbanGroupCheckbox = screen.getByRole("checkbox", { name: "都市街头" });
    expect(urbanGroupCheckbox).toHaveAttribute("aria-checked", "mixed");

    const uncheckedCard = screen.getByText(/身体微向前倾/).closest("[data-testid='clothing-scene-card']");
    expect(uncheckedCard).not.toBeNull();

    if (!uncheckedCard) {
      throw new Error("missing unchecked clothing scene card");
    }
    const uncheckedSceneCard = uncheckedCard as HTMLElement;

    expect(within(uncheckedSceneCard).queryByRole("button", { name: "画幅 全身" })).not.toBeInTheDocument();
    expect(within(uncheckedSceneCard).queryByRole("button", { name: "角度 正面" })).not.toBeInTheDocument();

    await user.click(within(uncheckedSceneCard).getByRole("checkbox", { name: /身体微向前倾/ }));

    expect(urbanGroupCheckbox).toBeChecked();

    const framingDropdown = within(uncheckedSceneCard).getByRole("button", { name: "画幅 全身" });
    expect(framingDropdown).toHaveClass("h-8", "rounded-control", "border", "text-[12px]");
    expect(framingDropdown).not.toHaveClass("border-white/60", "bg-slate-100/70");
    expect(framingDropdown).toHaveClass("border-slate-200/80", "bg-white/30");

    await user.click(framingDropdown);

    for (const option of ["全身", "四分之三", "半身", "特写"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "特写" }));

    expect(within(uncheckedSceneCard).getByRole("button", { name: "画幅 特写" })).toBeInTheDocument();

    await user.click(within(uncheckedSceneCard).getByRole("button", { name: "角度 正面" }));

    for (const option of ["正面", "侧面", "3/4 侧", "背面"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("option", { name: "背面" }));

    expect(within(uncheckedSceneCard).getByRole("button", { name: "角度 背面" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "都市街头" }));

    expect(urbanGroupCheckbox).not.toBeChecked();
    expect(within(uncheckedSceneCard).queryByRole("button", { name: "画幅 特写" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成场景图片（3张）" })).toBeEnabled();

    await user.click(screen.getByRole("checkbox", { name: "街角咖啡" }));

    expect(screen.getByRole("button", { name: "请先选择场景" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "街角咖啡" }));

    const generateScenesButton = screen.getByRole("button", { name: "生成场景图片（3张）" });
    expect(generateScenesButton).toBeEnabled();

    vi.useFakeTimers();
    fireEvent.click(generateScenesButton);

    expect(screen.getByRole("main", { name: "生成预览画布" })).toBeInTheDocument();
    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    expect(screen.getAllByText("AI 生成中")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "上一步" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成场景图片（3张）" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "街角咖啡" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "画幅 全身" })[0]).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(3100);
    });
    vi.useRealTimers();

    expect(screen.getByRole("button", { name: "预览长图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "生成场景图片（3张）" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "街角咖啡" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "画幅 全身" })[0]).toBeEnabled();
    expect(screen.getAllByTestId("generated-detail-image-card")).toHaveLength(3);
  });

  it("guides clothing generation through image, model, and scene requirements", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/dress.png",
        name: "dress.png",
        path: "/Users/demo/Pictures/dress.png",
        src: "asset://dress.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "服饰" }));

    expect(screen.getByRole("button", { name: "请上传服饰图片" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "服装图片" }));
    expect(await screen.findByAltText("dress.png")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "请选择模特" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "柔光女模" }));

    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "纯色棚拍" }));
    await user.click(screen.getByRole("button", { name: "都市街头" }));

    expect(screen.getByRole("button", { name: "请选择拍摄场景" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "AI推荐" }));

    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
  });

  it("keeps the product generation call to action disabled until product images are uploaded", () => {
    render(<App />);

    const cta = screen.getByRole("button", { name: "请上传产品图" });

    expect(cta).toBeDisabled();
    expect(cta).toHaveClass("bg-slate-300", "cursor-not-allowed", "font-semibold", "text-slate-700");
  });

  it("guides product generation through required inputs and opens the strategy drafting panel", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "上传图片" }));

    expect(await screen.findByRole("button", { name: "请选择生成设置" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "9:16" }));

    expect(screen.getByRole("button", { name: "请补充商品卖点" })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "防晒透气，适合户外骑行。");

    const readyCta = screen.getByRole("button", { name: "开始生成" });
    expect(readyCta).toBeEnabled();

    await user.click(readyCta);

    expect(screen.getByText("模块策略与设计规范")).toBeInTheDocument();
    expect(screen.getByText("生成中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一步" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "请先选择策略" })).toBeDisabled();
  });

  it("renders selected module strategies after drafting and supports delete, drag sort, and rewriting", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "网面人像印花无袖运动T恤");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    await user.click(screen.getByRole("checkbox", { name: "尺寸/容量/尺码图" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    expect(screen.getByText("生成中...")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    expect(screen.getByText("产品与卖点")).toBeInTheDocument();
    expect(screen.getByText("模块内容")).toBeInTheDocument();
    expect(screen.getByTestId("strategy-summary-copy")).toHaveClass("line-clamp-5");

    await user.click(screen.getByRole("button", { name: /展开全部/ }));

    expect(screen.getByTestId("strategy-summary-copy")).not.toHaveClass("line-clamp-5");
    expect(screen.getByRole("button", { name: /收起/ })).toBeInTheDocument();
    expect(screen.getByText("首屏主视觉: 传递核心价值")).toBeInTheDocument();
    expect(screen.getByText("使用场景图: 呈现真实使用场景")).toBeInTheDocument();
    expect(screen.getByText("尺寸/容量/尺码图: 展示规格信息")).toBeInTheDocument();
    expect(screen.queryByText("核心卖点图: 突出差异优势")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "删除 首屏主视觉" }));

    expect(screen.queryByText("首屏主视觉: 传递核心价值")).not.toBeInTheDocument();

    const sizeModuleCard = screen
      .getByText("尺寸/容量/尺码图: 展示规格信息")
      .closest("[data-testid='strategy-module-card']");
    const scenarioModuleCard = screen
      .getByText("使用场景图: 呈现真实使用场景")
      .closest("[data-testid='strategy-module-card']");

    expect(sizeModuleCard).not.toBeNull();
    expect(scenarioModuleCard).not.toBeNull();

    const sizeModuleDragHandle = screen.getByLabelText("拖动 尺寸/容量/尺码图");

    const originalElementFromPoint = document.elementFromPoint;
    const elementFromPointMock = vi.fn(() => scenarioModuleCard as Element);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPointMock,
    });
    const scenarioRectSpy = vi.spyOn(scenarioModuleCard!, "getBoundingClientRect").mockReturnValue({
      bottom: 220,
      height: 120,
      left: 0,
      right: 320,
      top: 100,
      width: 320,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    const sizeRectSpy = vi.spyOn(sizeModuleCard!, "getBoundingClientRect").mockReturnValue({
      bottom: 420,
      height: 120,
      left: 20,
      right: 340,
      top: 300,
      width: 320,
      x: 20,
      y: 300,
      toJSON: () => ({}),
    });
    const createPointerEvent = (type: string, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: 300 });
      Object.defineProperty(event, "clientY", { value: clientY });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };

    fireEvent(sizeModuleDragHandle, createPointerEvent("pointerdown", 300));
    expect(sizeModuleCard).toHaveClass("opacity-35");
    expect(screen.getByTestId("strategy-module-drag-preview")).toHaveStyle({
      height: "120px",
      left: "20px",
      top: "300px",
      width: "320px",
    });

    fireEvent(window, createPointerEvent("pointermove", 120));
    expect(screen.getByTestId("strategy-module-drag-preview")).toHaveStyle({
      left: "20px",
      top: "120px",
    });

    fireEvent(window, createPointerEvent("pointerup", 120));
    expect(screen.queryByTestId("strategy-module-drag-preview")).not.toBeInTheDocument();

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
    scenarioRectSpy.mockRestore();
    sizeRectSpy.mockRestore();

    const moduleCards = screen.getAllByTestId("strategy-module-card");
    expect(moduleCards[0]).toHaveTextContent("尺寸/容量/尺码图: 展示规格信息");

    const scenarioRewrite = screen.getByRole("textbox", { name: "改写 使用场景图" });
    expect(scenarioRewrite).toHaveClass("pr-6", "[scrollbar-gutter:stable]");

    await user.clear(scenarioRewrite);
    await user.type(scenarioRewrite, "主标题: Fit For Every Day，目标语言: 中文");

    expect(scenarioRewrite).toHaveValue("主标题: Fit For Every Day，目标语言: 中文");
    expect(screen.getByRole("button", { name: "生成详情图（2张）" })).toBeEnabled();
  });

  it("locks strategy modules and shows generated detail image actions after starting detail generation", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "9:16" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "网面人像印花无袖运动T恤");

    for (const moduleName of ["核心卖点图", "多角度图", "场景氛围图", "商品细节图"]) {
      await user.click(screen.getByRole("checkbox", { name: moduleName }));
    }

    await user.click(screen.getByRole("checkbox", { name: "尺寸/容量/尺码图" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    vi.useRealTimers();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "生成详情图（3张）" }));

    expect(screen.getByRole("button", { name: "详情图生成中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除 首屏主视觉" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "改写 使用场景图" })).toBeDisabled();
    expect(screen.getAllByTestId("strategy-module-card")[0]).toHaveAttribute("draggable", "false");
    expect(screen.getByText("生成结果:")).toBeInTheDocument();
    expect(screen.getByText("2026-06-29 15:52")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "全选" })).toBeInTheDocument();
    expect(screen.getByTestId("generated-detail-bulk-actions")).toHaveClass("min-h-7");
    expect(screen.queryByRole("button", { name: "删除所选图片" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量下载所选图片" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览长图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载全部" })).toBeInTheDocument();
    expect(screen.getAllByText("AI 生成中")).not.toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    const firstDetailImage = screen.getAllByTestId("generated-detail-image-card")[0];
    await user.hover(firstDetailImage);

    expect(firstDetailImage).toHaveTextContent("首屏主视觉");
    expect(firstDetailImage).toHaveClass("border-2");
    expect(within(firstDetailImage).getByRole("button", { name: /修改尺寸/ })).toBeInTheDocument();
    expect(within(firstDetailImage).getByRole("button", { name: /下载/ })).toBeInTheDocument();
    expect(within(firstDetailImage).getByRole("button", { name: /删除/ })).toBeInTheDocument();
    expect(within(firstDetailImage).getByRole("button", { name: "AI改图 首屏主视觉" })).toBeInTheDocument();
    expect(within(firstDetailImage).getByRole("button", { name: "编辑文字 首屏主视觉" })).toBeInTheDocument();

    await user.click(within(firstDetailImage).getByRole("button", { name: "AI改图 首屏主视觉" }));

    const imageRewriteDialog = screen.getByRole("dialog", { name: "输入微调方向" });
    expect(imageRewriteDialog).toBeInTheDocument();
    expect(screen.queryByText("输入微调方向（选填）")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成 15" })).toHaveClass("h-8", "px-3");
    expect(screen.getByRole("button", { name: "重新生成 15" })).not.toHaveClass("w-full", "h-11");

    fireEvent.click(imageRewriteDialog);
    expect(screen.queryByRole("dialog", { name: "输入微调方向" })).not.toBeInTheDocument();

    await user.click(within(firstDetailImage).getByRole("button", { name: "AI改图 首屏主视觉" }));

    fireEvent.change(screen.getByRole("textbox", { name: "输入调整要求" }), {
      target: { value: "商品向左移动一点，换成浅灰色背景" },
    });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "重新生成 15" }));

    expect(screen.queryByRole("dialog", { name: "输入微调方向" })).not.toBeInTheDocument();
    expect(firstDetailImage).toHaveTextContent("AI 生成中");
    expect(within(firstDetailImage).queryByRole("button", { name: "AI改图 首屏主视觉" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    expect(firstDetailImage).toHaveTextContent("首屏主视觉");
    expect(within(firstDetailImage).getByRole("button", { name: "AI改图 首屏主视觉" })).toBeInTheDocument();

    await user.click(within(firstDetailImage).getByRole("button", { name: "编辑文字 首屏主视觉" }));

    const textEditDialog = screen.getByRole("dialog", { name: "编辑文字" });
    expect(textEditDialog).toBeInTheDocument();
    expect(screen.getByDisplayValue("Size Guide")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Length (CM)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认改字 15" })).toHaveClass("h-8", "px-3");
    expect(screen.getByRole("button", { name: "确认改字 15" })).not.toHaveClass("h-[42px]");

    fireEvent.click(textEditDialog);
    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();

    await user.click(within(firstDetailImage).getByRole("button", { name: "编辑文字 首屏主视觉" }));

    fireEvent.change(screen.getByDisplayValue("Length (CM)"), {
      target: { value: "Length / 长度" },
    });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "确认改字 15" }));

    expect(screen.queryByRole("dialog", { name: "编辑文字" })).not.toBeInTheDocument();
    expect(firstDetailImage).toHaveTextContent("AI 生成中");
    expect(within(firstDetailImage).queryByRole("button", { name: "编辑文字 首屏主视觉" })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3200);
    });
    vi.useRealTimers();

    expect(firstDetailImage).toHaveTextContent("首屏主视觉");
    expect(within(firstDetailImage).getByRole("button", { name: "编辑文字 首屏主视觉" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览长图" }));

    const longPreviewDialog = screen.getByRole("dialog", { name: "长图预览" });
    expect(longPreviewDialog).toBeInTheDocument();
    expect(screen.getAllByTestId("long-preview-image-section")).toHaveLength(3);
    expect(within(longPreviewDialog).queryByText("首屏主视觉")).not.toBeInTheDocument();
    expect(within(longPreviewDialog).queryByText("突出商品核心卖点，强化购买决策")).not.toBeInTheDocument();

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/detail-long.png");
    await user.click(screen.getByRole("button", { name: "下载长图" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "生成结果-2026-06-29-1552-长图.png",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/detail-long.png",
      bytes: expect.any(Array),
    }));
    const longImagePayload = invokeMock.mock.calls[invokeMock.mock.calls.length - 1]?.[1] as { bytes: number[] };
    const longImageMarkup = new TextDecoder().decode(new Uint8Array(longImagePayload.bytes));
    expect(longImageMarkup).not.toContain("首屏主视觉");
    expect(longImageMarkup).not.toContain("突出商品核心卖点，强化购买决策");

    await user.click(screen.getByRole("button", { name: "关闭长图预览" }));

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/cover.png");
    await user.click(within(firstDetailImage).getByRole("button", { name: "下载 首屏主视觉" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "首屏主视觉.png",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/cover.png",
      bytes: expect.any(Array),
    }));

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/all.zip");
    await user.click(screen.getByRole("button", { name: "下载全部" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "生成结果-2026-06-29-1552-全部图片.zip",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/all.zip",
      bytes: expect.any(Array),
    }));

    await user.click(firstDetailImage);

    expect(firstDetailImage).not.toHaveClass("border-slate-950");
    expect(within(firstDetailImage).getByRole("checkbox", { name: "选择 首屏主视觉" })).not.toBeChecked();
    expect(screen.getByRole("dialog", { name: "图片相册预览" })).toHaveClass("fixed", "inset-0");
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("预览 首屏主视觉")).toBeInTheDocument();
    expect(screen.getByTestId("image-lightbox-thumbnail-strip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看缩略图 使用场景图" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("预览 使用场景图")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "放大图片" }));

    expect(screen.getByLabelText("预览 使用场景图")).toHaveStyle({ transform: "scale(1.25)" });
    expect(screen.getByRole("button", { name: "缩小图片" })).toBeEnabled();

    fireEvent.wheel(screen.getByLabelText("预览 使用场景图"), { deltaY: -120 });

    expect(screen.getByLabelText("预览 使用场景图")).toHaveStyle({ transform: "scale(1.5)" });

    fireEvent.click(screen.getByRole("dialog", { name: "图片相册预览" }));

    expect(screen.queryByRole("dialog", { name: "图片相册预览" })).not.toBeInTheDocument();

    await user.click(within(firstDetailImage).getByRole("checkbox", { name: "选择 首屏主视觉" }));
    await user.click(within(screen.getAllByTestId("generated-detail-image-card")[1]).getByRole("checkbox", { name: "选择 使用场景图" }));

    expect(firstDetailImage).toHaveClass("border-2", "border-slate-950");
    expect(screen.getByTestId("generated-detail-bulk-actions")).toHaveClass("min-h-7");
    expect(screen.getByRole("button", { name: "删除所选图片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量下载所选图片" })).toBeInTheDocument();

    saveMock.mockResolvedValueOnce("/Users/demo/Desktop/selected.zip");
    await user.click(screen.getByRole("button", { name: "批量下载所选图片" }));

    expect(saveMock).toHaveBeenLastCalledWith(expect.objectContaining({
      defaultPath: "生成结果-2026-06-29-1552-已选图片.zip",
    }));
    expect(invokeMock).toHaveBeenLastCalledWith("save_generated_asset", expect.objectContaining({
      path: "/Users/demo/Desktop/selected.zip",
      bytes: expect.any(Array),
    }));

    await user.click(screen.getByRole("button", { name: "删除所选图片" }));

    expect(screen.queryByText("首屏主视觉")).not.toBeInTheDocument();
    expect(screen.queryByText("使用场景图")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除所选图片" })).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "生成详情图（3张）" }));

    expect(screen.getByRole("button", { name: "详情图生成中" })).toBeDisabled();
    expect(screen.getAllByText("AI 生成中")).toHaveLength(3);
  });

  it("asks users to select product modules when all modules are unchecked", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "16:9" }));
    await user.type(screen.getByPlaceholderText(/建议包含以下信息生成更精准/), "防晒透气，适合户外骑行。");

    const checkedModules = screen
      .getAllByRole("checkbox")
      .filter((checkbox) => checkbox.getAttribute("aria-checked") === "true");

    for (const checkbox of checkedModules) {
      await user.click(checkbox);
    }

    expect(screen.getByRole("button", { name: "请选择商品模块" })).toBeDisabled();
  });

  it("updates generation setting options and syncs language from the selected market", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));
    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));

    expect(screen.getByRole("button", { name: /高级A\+（Web端）/ })).toHaveTextContent("1464:600");
    expect(screen.getByRole("button", { name: /高级A\+（移动端）/ })).toHaveTextContent("600:450");
    expect(
      screen.getAllByRole("button", { name: /普通A\+/ }).find((button) => button.textContent?.includes("970:600")),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "9:16" }));

    expect(screen.getByRole("button", { name: "9:16" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));

    expect(screen.getByRole("button", { name: "淘宝天猫" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中国" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
  });

  it("defaults domestic platforms to China and hides advanced A+ format options", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));
    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "高级A+" }));

    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（Web端）");

    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "京东" }));

    expect(screen.getByRole("button", { name: "京东" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中国" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中文" })).toBeInTheDocument();
    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("普通A+");

    await user.click(screen.getByTestId("product-format-select-trigger"));

    expect(screen.queryByRole("button", { name: "高级A+" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级A\+（Web端）/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级A\+（移动端）/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /普通A\+/ }).some((button) => button.textContent?.includes("970:600"))).toBe(true);
  });

  it("keeps the format dropdown open for advanced A+ and supports web plus mobile selections", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "淘宝天猫" }));
    await user.click(screen.getByRole("button", { name: "亚马逊" }));
    await user.click(screen.getByRole("button", { name: "普通A+" }));
    await user.click(screen.getByRole("button", { name: "高级A+" }));

    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（Web端）");
    expect(
      screen
        .getAllByRole("button", { name: /高级A\+（Web端）/ })
        .find((button) => button.textContent?.includes("1464:600")),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /高级A\+（移动端）/ })).toHaveTextContent("600:450");
    expect(screen.getByTestId("product-format-select-trigger")).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: /高级A\+（移动端）/ }));

    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（Web端）");
    expect(screen.getByTestId("product-format-select-trigger")).toHaveTextContent("高级A+（移动端）");
    expect(screen.getByTestId("product-format-select-trigger")).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "1:1" }));

    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /高级A\+（移动端）/ })).not.toBeInTheDocument();
  });

  it("toggles product modules from the whole tile with desktop-like transitions", async () => {
    const user = userEvent.setup();

    render(<App />);

    const brandModuleText = screen.getByText("品牌故事图");
    const brandModuleTile = brandModuleText.closest(".group");

    expect(brandModuleTile).toHaveClass("transition-all", "duration-300");
    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).not.toBeChecked();

    await user.click(brandModuleText);

    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).toBeChecked();

    await user.click(brandModuleText);

    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).not.toBeChecked();
  });

  it("opens a non-editable AI writing dialog and confirms the suggestion", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: "AI 帮写" }));

    const dialog = screen.getByRole("dialog", { name: "AI 帮写" });

    expect(screen.getByRole("complementary", { name: "生成配置" })).toHaveClass("z-40");
    expect(dialog).toHaveClass("w-[360px]", "p-5");
    expect(within(dialog).getByRole("button", { name: "确认" })).toHaveClass("h-8", "px-3");
    expect(within(dialog).getByText(/产品名称：黑色休闲翻领长袖衬衫/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue("");

    await user.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(screen.queryByRole("dialog", { name: "AI 帮写" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue(
      "1、产品名称：黑色休闲翻领长袖衬衫 2、核心卖点：纯黑百搭、后背创意印花、宽松翻领剪裁 3、适用人群：日常通勤青年、潮流穿搭爱好者、休闲出行人群 4、使用场景：日常街头出行、朋友休闲聚会、居家外出随性穿搭 5、规格参数：颜色：纯黑 外观：后背带有创意印花装饰 版型：翻领长袖休闲款",
    );
  });

  it("keeps product images and parameters when switching workspaces", async () => {
    const user = userEvent.setup();

    selectProductImagesMock.mockResolvedValue([
      {
        id: "/Users/demo/Pictures/helmet.png",
        name: "helmet.png",
        path: "/Users/demo/Pictures/helmet.png",
        src: "asset://helmet.png",
      },
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: "上传图片" }));
    await user.click(screen.getByRole("checkbox", { name: "品牌故事图" }));
    await user.type(
      screen.getByPlaceholderText(/建议包含以下信息生成更精准/),
      "保留商品卖点",
    );

    await user.click(screen.getByRole("button", { name: /服饰/ }));
    await user.click(screen.getByRole("button", { name: /商品/ }));

    expect(screen.getByAltText("helmet.png")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "品牌故事图" })).toBeChecked();
    expect(screen.getByPlaceholderText(/建议包含以下信息生成更精准/)).toHaveValue("保留商品卖点");
  });

  it("keeps clothing parameters when switching workspaces", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("button", { name: /服饰/ }));
    await user.click(screen.getByRole("button", { name: "AI 生成" }));
    await user.click(screen.getByRole("button", { name: "都市街头" }));
    await user.click(screen.getByRole("button", { name: "1:1" }));
    await user.type(screen.getByPlaceholderText(/描述你想要的场景/), "保留服饰场景");
    await user.click(screen.getByRole("button", { name: "AI推荐" }));

    await user.click(screen.getByRole("button", { name: /商品/ }));
    await user.click(screen.getByRole("button", { name: /服饰/ }));

    expect(screen.getByRole("button", { name: "AI 生成" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1:1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "AI推荐" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("拍摄场景")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/描述你想要的场景/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AI推荐" }));

    expect(screen.getByRole("button", { name: "都市街头" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByPlaceholderText(/描述你想要的场景/)).toHaveValue("保留服饰场景");
  });

  it("switches from detail generation to the clothing try-on workspace", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.queryByRole("button", { name: /场景/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /详情/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /服饰/ }));

    expect(screen.getByRole("complementary", { name: "服饰配置" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "服饰穿戴预览" })).toBeInTheDocument();
    expect(screen.getByTestId("clothing-config-scroll")).toHaveClass("overscroll-none");
    expect(screen.getByText("服饰图片")).toBeInTheDocument();
    expect(screen.getByText("模特形象")).toBeInTheDocument();
    expect(screen.getByText("AI服饰穿戴")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请上传服饰图片" })).toBeDisabled();
  });
});
