import { Cpu, Image, Images, PackageCheck, Settings, Shirt, Sparkles, TextCursorInput } from "lucide-react";
import type { NavigationItem } from "./components/NavigationRail";
import type { ModuleOption } from "../features/generation/components/GenerationConfigPanel";
import type { PreviewBoard } from "../features/generation/components/PreviewCanvas";

export const navItems: NavigationItem[] = [
  { id: "product", label: "商品", icon: PackageCheck },
  { id: "clothing", label: "服饰", icon: Shirt },
  { id: "scene", label: "场景", icon: Images },
  { id: "model", label: "模型", icon: Cpu },
  { id: "settings", label: "设置", icon: Settings },
];

export const moduleOptions: ModuleOption[] = [
  { id: "hero", title: "首屏主视觉", description: "传递核心价值", checked: true },
  { id: "selling-point", title: "核心卖点图", description: "突出差异优势", checked: true },
  { id: "scenario", title: "使用场景图", description: "呈现真实使用场景", checked: true },
  { id: "angle", title: "多角度图", description: "多角度呈现外观", checked: true },
  { id: "atmosphere", title: "场景氛围图", description: "展示使用场景", checked: true },
  { id: "detail", title: "商品细节图", description: "放大材质与工艺", checked: true },
  { id: "brand", title: "品牌故事图", description: "传达品牌理念", checked: false },
  { id: "size", title: "尺寸/容量/尺码图", description: "展示规格信息", checked: false },
  { id: "compare", title: "效果对比图", description: "使用前后效果对比", checked: false },
  { id: "spec", title: "详细规格/参数表", description: "展示商品数据", checked: false },
  { id: "process", title: "工艺制作图", description: "展示工艺制作过程", checked: false },
  { id: "parts", title: "配件/赠品图", description: "明确收纳的所有物品", checked: false },
  { id: "series", title: "系列展示图", description: "多色或多 SKU 展示", checked: false },
  { id: "components", title: "商品成分图", description: "展示配方/材质/成分", checked: false },
];

export const previewBoards: PreviewBoard[] = [
  { id: "source", title: "上传商品图", icon: Image, tone: "light" },
  { id: "prompt", title: "生成详情页", icon: TextCursorInput, tone: "blue" },
  { id: "result", title: "多模块内容", icon: Images, tone: "dark" },
  { id: "polish", title: "质感增强", icon: Sparkles, tone: "blue" },
];
