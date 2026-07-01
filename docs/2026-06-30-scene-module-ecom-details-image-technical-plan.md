# 场景模块融合 ecom-details-image 技术方案

> 日期：2026-06-30
>
> 目标项目：`commerce-shoot-studio/desktop`
>
> 参考项目：`/Users/lifeilin/wx_lifeilin/github.com/ecom-details-image`

## 1. 结论

新增第三个一级主模块：`场景`。

`场景`模块用于融合 `ecom-details-image` 的多场景电商图片生成能力。它不替代现有 `商品` 和 `服饰` 模块，而是承接“基于参考图生成主图、详情页图、营销场景图”的独立工作流。

第一版按当前桌面端风格实现：

1. 最左侧导航新增 `场景`。
2. 左侧配置面板视觉上复用 `商品` 模块。
3. 不保留 `商品` 模块里的平台、国家、语言和高级 A+ 生成设置。
4. `商品卖点&要求` 改为 `补充信息`。
5. 下方模块区展示 `ecom-details-image` 支持的场景模板，第一版只支持单选。
6. 输出尺寸复用 `服饰` 模块当前尺寸能力：`3:4`、`1:1`、`9:16`。
7. 生成流程保持当前产品节奏：配置参数 -> 等待方案生成 -> 确认每张图 Prompt -> 实际生成图片。

## 2. 能力边界

### 2.1 当前要融合的能力

`ecom-details-image` 的核心能力不是 UI，而是图片生成策略：

- 25 类电商图片场景模板。
- `统一风格锁定`，用于锁定多图风格一致性。
- 主图组 `H1-H5` 规划。
- 详情页组 `D1-D9` 规划。
- 每张图片独立 Prompt。
- OpenAI 兼容 Images API 的提交、轮询、下载协议参考。

### 2.2 当前不直接融合的能力

以下内容不直接搬进产品运行时：

- 不原样复制 `.claude/skills/ecom-details-image/SKILL.md` 作为运行时代码。
- 不直接依赖 `generate_image.py` 作为 Tauri 打包产物的一部分。
- 不复制 `generated-images/` 示例图片作为产品资产。
- 不开放用户自定义 Provider base URL。
- 不在前端保存或展示 API Key。

## 3. 一级导航设计

现有导航：

```text
商品
服饰
```

调整后：

```text
商品
服饰
场景
```

三个模块的职责边界：

```text
商品：A+ / 详情页 / 商品模块化长图
服饰：试穿 / 模特 / 服装场景图
场景：参考图驱动的主图、详情页图、营销场景图
```

`场景` 不应命名为 `模板`、`Prompt` 或 `营销素材`。用户关心的是生成场景图，不是底层模板系统。

## 4. 场景模块左侧配置面板

左侧配置面板使用与 `商品` 模块一致的玻璃感浅色面板、紧凑控件、底部固定 CTA。

推荐结构：

```text
场景配置
├── 参考图
├── 输出内容
├── 输出尺寸
├── 补充信息
└── 场景类型 / 视觉方向
```

### 4.1 参考图

复用当前商品图选择能力：

- 入口文案：`上传参考图`
- 最多 3 张。
- 支持同一产品多角度图片。
- 继续使用 Tauri 原生选择器。
- 不退回浏览器 `<input type="file">`。

参考图用于提升生成结果的产品一致性。第一版前端可以继续保存 UI 选中态；真实生图阶段必须由 Rust 层读取和处理文件，避免把完整路径、base64 图片或 Provider raw response 写入不安全存储。

### 4.2 输出内容

新增单选控件：

```text
单张场景图
主图组
详情页组
完整图片包
```

含义：

- `单张场景图`：选择一个场景模板，输出一张或一组同场景图片。
- `主图组`：生成 `H1-H5`，适合商品上架主图堆栈。
- `详情页组`：生成 `D1-D9`，适合 A+ / PDP / 长图模块。
- `完整图片包`：生成 `H1-H5 + D1-D9`，最接近 `ecom-details-image` 原项目能力。

第一版建议默认选择 `单张场景图`，避免用户进入页面后立即看到过重的图片包配置。

### 4.3 输出尺寸

复用 `服饰` 模块当前尺寸能力：

```text
3:4
1:1
9:16
```

尺寸规则：

- `单张场景图` 使用用户选择的尺寸。
- `主图组` 默认建议 `1:1`。
- `详情页组` 默认建议 `3:4` 或 `9:16`。
- `完整图片包` 第一版仍使用一个统一尺寸，后续再支持主图和详情页分别配置尺寸。

后续可扩展 GPT-Image-2 支持的更多比例，例如 `4:5`、`16:9`、`2:3`，但不作为第一版必交付项。

### 4.4 补充信息

把 `商品` 模块里的 `商品卖点&要求` 改成更中性的 `补充信息`。

占位建议：

```text
建议补充：
1. 产品名称或主体描述
2. 核心卖点
3. 目标人群
4. 使用场景
5. 风格偏好或禁用元素
```

`补充信息` 不应强制结构化。第一版只作为 Prompt builder 的输入上下文。

### 4.5 场景类型 / 视觉方向

这里要根据 `输出内容` 动态变化。

当输出内容为 `单张场景图`：

- 展示 `场景类型`，采用 `分类 Tab + 场景卡片`。
- 使用 `ecom-details-image` 的场景模板。
- 单选。

第一版直接内置 `ecom-details-image` 的 25 个场景模板，并按业务分组放入 Tab：

```text
基础商品图
├── 白底主图
├── 平铺摆拍
├── 细节特写
├── 隐形人台
└── 多角度网格

场景氛围图
├── 生活方式
├── UGC 风格
├── 模特展示
├── 虚拟试穿
├── 轻奢氛围
└── 店铺陈列

内容营销图
├── 海报 Banner
├── 社媒内容
├── 直播间
├── 杂志编辑
├── 季节 Campaign
└── 运动 Campaign

信息说明图
├── 前后对比
├── 包装设计
├── 信息图表
├── 尺码说明
├── 多品组合
└── 爆炸图

特殊创意
├── 创意概念
└── 设备样机
```

当输出内容为 `主图组`、`详情页组` 或 `完整图片包`：

- 不展示 25 个场景模板。
- 改为展示 `视觉方向`。
- 单选。

建议第一版视觉方向：

```text
极简电商
高端 A+
生活方式
UGC 真实感
轻奢氛围
```

原因：主图组和详情页组是结构化图片包，不应只选一个“白底主图”或“直播间”模板，否则会破坏 H/D 序列完整性。

## 5. 四步生成流程

`场景`模块保持当前商品模块的交互节奏，但明确拆成四步。

```text
第一步：配置参数
  ↓
第二步：等待方案生成
  ↓
第三步：确认每张图片 Prompt
  ↓
第四步：实际生成图片
```

### 5.1 第一步：配置参数

用户完成：

- 上传参考图。
- 选择输出内容。
- 选择输出尺寸。
- 填写补充信息。
- 选择场景类型或视觉方向。

底部 CTA：

```text
生成图片方案
```

禁用态文案：

- 未上传参考图：`请上传参考图`
- 未选择输出内容：`请选择输出内容`
- 未选择尺寸：`请选择输出尺寸`
- 未选择场景或视觉方向：`请选择场景`

### 5.2 第二步：等待方案生成

进入方案生成态，展示与当前 `商品` 模块策略生成态一致的等待 UI。

本步骤产出：

- `统一风格锁定`
- 图片包计划
- 每张图的用途、尺寸、场景类型、短文案
- 每张图的 Prompt 草稿

第一版可以先本地同步生成 Prompt 计划，不调用外部 API。

### 5.3 第三步：确认 Prompt

第三步是本模块和 `ecom-details-image` 融合的关键。

界面结构：

```text
场景方案与 Prompt
├── 参考图与补充信息摘要
├── 统一风格锁定摘要
└── 图片 Prompt 列表
    ├── H1 首屏主视觉
    ├── H2 核心卖点图
    ├── D1 详情页首屏
    └── ...
```

每张 Prompt 卡片默认展示：

- 图片编号。
- 图片用途。
- 输出尺寸。
- 模板或视觉方向。
- 2 行 Prompt 摘要。
- 展开后展示完整 Prompt。

允许用户：

- 删除某张图。
- 改写某张图 Prompt。
- 拖拽调整顺序。

底部 CTA：

```text
开始生成图片
```

如果没有任何 Prompt 卡片，CTA 禁用并展示：

```text
请至少保留一张图片
```

### 5.4 第四步：实际生成图片

实际生成阶段复用当前结果页能力：

- 结果卡片。
- 单图预览。
- 长图预览。
- 单图下载。
- 全部下载。
- 已选下载。
- 重生成。
- 文字修改。

第一版结果可以继续用占位图验证 UI 闭环。接入真实 Provider 后，结果卡片优先渲染真实图片。

## 6. 数据模型设计

### 6.1 场景配置

```ts
export type SceneOutputMode =
  | "single"
  | "hero-pack"
  | "detail-pack"
  | "full-pack";

export type SceneConfigState = {
  referenceImages: ProductImageAsset[];
  outputMode: SceneOutputMode;
  ratio: "3:4" | "1:1" | "9:16";
  supplementalInfo: string;
  selectedSceneTemplateId: string | null;
  selectedVisualDirectionId: string | null;
};
```

### 6.2 场景模板

```ts
export type SceneTemplate = {
  id: string;
  title: string;
  description: string;
  group: "基础商品图" | "场景氛围图" | "内容营销图" | "信息说明图" | "特殊创意";
  sourceTemplateId: string;
};
```

`sourceTemplateId` 必须精确对应 `ecom-details-image` 的模板 ID：

- `hero-image`
- `lifestyle-scene`
- `flat-lay`
- `detail-macro`
- `poster-banner`
- `social-media`
- `ugc-style`
- `model-showcase`
- `before-after`
- `packaging`
- `infographic`
- `creative-concept`
- `size-spec`
- `multi-product`
- `livestream`
- `try-on-virtual`
- `exploded-view`
- `ghost-mannequin`
- `multi-angle-grid`
- `magazine-editorial`
- `seasonal-campaign`
- `luxury-atmospherics`
- `device-mockup`
- `storefront`
- `sports-campaign`

### 6.3 图片计划

```ts
export type SceneImagePlan = {
  id: string;
  code: string;
  title: string;
  purpose: string;
  ratio: string;
  templateId: string;
  prompt: string;
  promptSummary: string;
};
```

示例：

```ts
{
  id: "h1-hero",
  code: "H1",
  title: "首屏主视觉",
  purpose: "一眼说明产品核心价值",
  ratio: "1:1",
  templateId: "hero-image",
  prompt: "...",
  promptSummary: "纯白背景，产品居中，占画面 38%，顶部预留平台叠加区域"
}
```

### 6.4 生成结果

当前 `GeneratedDetailImage` 后续应扩展为：

```ts
export type GeneratedDetailImage = {
  id: string;
  status: "generating" | "complete" | "failed";
  title: string;
  prompt?: string;
  ratio?: string;
  src?: string;
  errorMessage?: string;
};
```

第一版可以只增加 `prompt` 和 `ratio`，真实图片字段等 Provider 接入时再启用。

## 7. Prompt 生成规则

Prompt builder 应吸收 `ecom-details-image` 的关键规则：

1. 多图任务必须生成同一段 `统一风格锁定`。
2. 每张图 Prompt 第一段必须原样复用同一段统一风格锁定。
3. 颜色尽量使用 hex 值。
4. 产品占比必须数字化。
5. 留白必须显式声明。
6. 每张 Prompt 必须包含负面约束。
7. 中文图片内文字用 `「」` 包裹。
8. 主图和详情页要使用不同角度、不同景别，避免整套图雷同。
9. 详情页图必须是电商信息图结构，不是单纯产品照片。
10. 不能虚构认证、销量、实验数据、医疗功效或真实评价。

## 8. 源项目能力映射

| ecom-details-image 能力 | 场景模块落点 | 第一版状态 |
| --- | --- | --- |
| 25 个场景模板 | `场景类型` Tab + 卡片单选 | 已内置完整 25 个模板 |
| 统一风格锁定 | 第三步 Prompt 确认页 | 必做 |
| 主图 H1-H5 | `主图组` 输出内容 | 必做 |
| 详情页 D1-D9 | `详情页组` 输出内容 | 必做 |
| 主图+详情页完整包 | `完整图片包` 输出内容 | 必做 |
| generate_image.py | Rust Provider 适配参考 | 后续做 |
| apimart 异步轮询 | Rust Provider 适配参考 | 后续做 |
| 参考图片输入 | `参考图` 上传 | 必做 |

## 9. 实施阶段

### Phase 1：场景模块 UI 骨架

目标：新增 `场景` 一级导航，并完成配置面板空态。

涉及文件：

- `desktop/src/app/studioData.ts`
- `desktop/src/app/App.tsx`
- `desktop/src/features/scenes/components/SceneConfigPanel.tsx`
- `desktop/src/features/scenes/components/ScenePreviewCanvas.tsx`
- `desktop/src/app/App.test.tsx`

验收：

- 最左侧出现 `场景` 导航。
- 点击 `场景` 后进入场景配置面板。
- 配置面板包含参考图、输出内容、输出尺寸、补充信息、场景类型。
- 未上传参考图时底部 CTA 禁用。

### Phase 2：场景模板与输出内容模型

目标：把 `ecom-details-image` 的 25 个场景转成产品内静态模型。

涉及文件：

- `desktop/src/features/scenes/lib/sceneTemplates.ts`
- `desktop/src/features/scenes/lib/sceneOutputModes.ts`
- `desktop/src/features/scenes/components/SceneConfigPanel.tsx`
- `desktop/src/app/App.test.tsx`

验收：

- `单张场景图` 模式展示场景类型分类 Tab 和场景卡片。
- 场景类型完整覆盖 25 个源模板，并通过 `sourceTemplateId` 精确映射。
- `主图组`、`详情页组`、`完整图片包` 模式展示视觉方向单选。
- 场景类型卡片只能单选。
- 输出尺寸复用 `3:4`、`1:1`、`9:16`。

### Phase 3：图片计划与 Prompt 确认页

目标：完成配置 -> 方案生成 -> Prompt 确认流程。

涉及文件：

- `desktop/src/features/scenes/lib/scenePromptBuilder.ts`
- `desktop/src/features/scenes/lib/sceneImagePlan.ts`
- `desktop/src/features/scenes/components/ScenePromptReviewPanel.tsx`
- `desktop/src/app/App.tsx`
- `desktop/src/app/App.test.tsx`

验收：

- 点击 `生成图片方案` 后进入等待态。
- 等待态结束后展示 Prompt 确认页。
- `单张场景图` 生成 1 张图片计划。
- `主图组` 生成 H1-H5。
- `详情页组` 生成 D1-D9。
- `完整图片包` 生成 H1-H5 + D1-D9。
- 每张图都包含 Prompt、用途和尺寸。

### Phase 4：结果页复用与占位生成

目标：Prompt 确认后进入结果页，复用现有预览和下载能力。

涉及文件：

- `desktop/src/features/scenes/components/ScenePreviewCanvas.tsx`
- `desktop/src/features/generation/components/PreviewCanvas.tsx`
- `desktop/src/app/App.tsx`
- `desktop/src/app/App.test.tsx`

验收：

- 点击 `开始生成图片` 后结果卡片进入生成中。
- 生成完成后展示结果图卡片。
- 单图预览、删除、下载、全部下载继续可用。
- 结果卡片标题来自图片计划，而不是固定占位文案。

### Phase 5：真实 Provider 接入

目标：把 Prompt 计划交给 Rust 层固定 Provider 适配器，真实生成图片并保存到本地资产。

本阶段涉及外部 API、密钥、Rust command 和可能的配置变更，进入编码前必须单独确认。

建议边界：

- API Key 只由 Rust 层读取。
- 前端不保存 API Key。
- 不开放用户自定义 base URL。
- 不直接调用 Python 脚本。
- Rust 层负责提交、轮询、下载、错误传播和本地保存。

## 10. 验证命令

文档落地后无需运行构建。进入实现阶段后按仓库现有命令验证：

```bash
npm --prefix desktop run test
npm --prefix desktop run build
make cargo-check
git diff --check
```

如果 Phase 5 接入真实 Provider，还需要补充：

```bash
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib -- --nocapture
```

## 11. 风险与决策点

### 11.1 需要先确认的事项

以下事项进入实现前必须确认：

1. `完整图片包` 第一版是否固定输出 14 张图，还是允许用户调整数量。
2. 主图和详情页是否第一版共用一个尺寸。
3. 真实 Provider 使用 OpenAI 官方还是 apimart 兼容接口。
4. 是否需要把生成结果纳入当前工作区资产体系。

### 11.2 明确不做

第一版不做：

- 模板搜索。
- 多场景批量多选。
- 复杂 Prompt 编辑器。
- 自定义 Provider。
- 自定义 base URL。
- 多任务并发队列。
- License Server。
- 支付和套餐能力。
- 云端业务后端。

## 12. 最小可交付定义

第一版完成后，用户可以：

1. 在最左侧进入 `场景`。
2. 上传参考图。
3. 选择输出内容、尺寸、补充信息和场景类型或视觉方向。
4. 点击 `生成图片方案`。
5. 查看每张主图或详情图的 Prompt。
6. 删除、改写或调整 Prompt。
7. 点击 `开始生成图片`。
8. 在结果页查看、预览和下载图片。

如果未接真实 Provider，则结果图可为占位图，但 Prompt 包和流程必须完整可用。
