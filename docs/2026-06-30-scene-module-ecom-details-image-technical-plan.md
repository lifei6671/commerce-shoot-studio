# 场景模块融合 ecom-details-image 技术方案

> 日期：2026-06-30
>
> 目标项目：`commerce-shoot-studio/desktop`
>
> 参考项目：`/Users/lifeilin/wx_lifeilin/github.com/ecom-details-image`

> 2026-07-12 实现口径：原 Skill 中影响模型行为的规则已经迁移为
> `scene_template_routing.toml`、`scene_prompt_planning.toml`、
> `scene_template_catalog.toml` 和 `scene_image_generation.toml`。运行时不依赖原 Skill、Python、JSON、
> apimart 或原项目目录。

## 1. 结论

新增第三个一级主模块：`场景`。

`场景`模块用于融合 `ecom-details-image` 的多场景电商图片生成能力。它不替代现有 `商品` 和 `服饰` 模块，而是承接“基于参考图生成主图、详情页图、营销场景图”的独立工作流。

第一版按当前桌面端风格实现：

1. 最左侧导航新增 `场景`。
2. 左侧配置面板视觉上复用 `商品` 模块。
3. 不保留 `商品` 模块里的平台、国家、语言和高级 A+ 生成设置。
4. `商品卖点&要求` 改为必填的 `补充信息`。
5. 不向用户展示场景模板或视觉方向选择；routing 根据参考图、输出内容和补充信息选择
   conversion driver、视觉方向与模板，planning 再在冻结模板内选择 variant。
6. 输出尺寸复用 `服饰` 模块当前尺寸能力：`3:4`、`1:1`、`9:16`。
7. 生成流程保持当前产品节奏：配置参数 -> 等待方案生成 -> 确认场景摘要 -> 实际生成图片。

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
└── 补充信息（必填）
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

- `单张场景图`：由 runtime 自动路由一个最合适的场景模板，固定输出 1 张图。
- `主图组`：固定输出 5 张 `H1-H5`，按转化驱动力组织商品上架主图叙事。
- `详情页组`：固定输出 9 张 `D1-D9`，覆盖首屏承接到 FAQ / CTA 的 PDP 叙事。
- `完整图片包`：固定输出 14 张 `H1-H5 + D1-D9`，组合主图与详情页完整叙事。

四个标题后均紧邻展示说明图标，鼠标悬停或键盘聚焦时通过共享 Tooltip 组件解释上述实际输出
数量和用途。图标不承担模式切换；模式仍由标题所在的单选控件选择。

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

`补充信息` 不强制使用固定结构，但必须填写非空内容。它与参考图共同构成模板路由和完整
规划的事实输入；缺失时禁用 `生成图片方案`，不能用默认模板或空字符串静默继续。

### 4.5 自动模板路由

UI 不再展示或提交 `场景类型`、模板卡片或 `视觉方向`。25 个模板及其 variant、品类、
Anti-AI、文字和证据规则仍保留在 catalog 中，分别作为 routing 与 planning 的 Prompt 事实源。

一个 `scene-prompt-planning` 任务内部串行完成两次同 capability 调用：

1. 模板路由调用只接收参考图角色、输出内容、比例、必填补充信息、H/D 槽位规则和精简
   routing index，返回 `conversionDriver`、多图视觉方向及每个槽位唯一的 `templateId`。
2. Rust 只校验路由数量、H/D 顺序、模板属于 25 项 catalog，以及 routing 与 planning 的
   冻结一致性。主体识别、证据门槛和模板适配属于 routing/planning Prompt 的模型行为约束，
   不由 Rust 复制一套业务判断；真实参考图上的语义表现仍待人工验收。
3. 完整规划调用只注入路由实际选中的去重模板完整规则和冻结路由，生成 Campaign Style
   Lock、摘要及完整执行 Prompt，并在冻结模板内选择 variant；模型不得在第二次调用中改选
   driver 或模板，没有适用 override 时使用 `base`。

路由结果只在本次 executor 调用内存中存在，不写入 `generation_tasks`、SQLite、task events、
诊断文件或前端 DTO。任务只持久化第二次调用通过校验后的规范化最终方案；两次调用的
invocation ID 可作为脱敏执行证据关联同一个任务。

项目内置 `ecom-details-image` 的 25 个场景模板，并按业务分组维护：

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
├── 多角度组合
└── 爆炸图

特殊创意
├── 创意概念
└── 设备样机
```

主图组和详情页组不能把一套固定“视觉方向”当成模板选择。H/D 槽位只固定 code、purpose
与顺序，`recommendedTemplateIds` 是常见匹配提示而不是 allowlist。routing Prompt 要求模型根据
参考图、补充信息、主体类型和证据门槛，从完整 25 模板中选择最佳模板；planning 再基于冻结
模板选择 variant 并生成统一视觉系统。视觉方向只约束跨图色板、光线与版式基线，不得覆盖
模板原生视觉语言。25 模板可达性与证据门槛的真实语义效果尚未通过付费 Provider 人工验收。

`multi-product` 在当前同一商品最多 3 张参考图的资产合同下收窄为“同一商品的多角度、
同系列或参考图中已明确存在的组合展示”。没有多 SKU 事实源时不得凭空增加商品款式，
UI 对外名称使用“多角度组合”。真正的多 SKU 组合需要后续增加独立商品资产角色后再开放。

## 5. 四步生成流程

`场景`模块保持当前商品模块的交互节奏，但明确拆成四步。

```text
第一步：配置参数
  ↓
第二步：等待方案生成
  ↓
第三步：确认场景摘要并执行完整 Prompt
  ↓
第四步：实际生成图片
```

### 5.1 第一步：配置参数

用户完成：

- 上传参考图。
- 选择输出内容。
- 选择输出尺寸。
- 填写非空补充信息。

底部 CTA：

```text
生成图片方案
```

禁用态文案：

- 未上传参考图：`请上传参考图`
- 未选择输出内容：`请选择输出内容`
- 未选择尺寸：`请选择输出尺寸`
- 未填写补充信息：`请填写补充信息`

### 5.2 第二步：等待方案生成

进入方案生成态，展示与当前 `商品` 模块策略生成态一致的等待 UI。

本步骤在同一个 `scene-prompt-planning` 任务内先路由、再完整规划，最终产出：

- `统一风格锁定`
- 图片包计划
- 每张图的用途、尺寸、自动路由模板、短文案
- 每张图的 `variantId`、场景摘要和完整可执行 Prompt。

两次调用都通过真实 `scene-prompt-planning` 图生文 Provider 完成并顺序复用同一个任务；
第一次只选择 conversion driver、视觉方向与模板，第二次只接收选中模板的完整配置，在冻结
模板内选择 variant 并生成最终方案。完整 Prompt 保存在规范化规划输出中供执行器使用，
但审核 UI 只读取摘要。

### 5.3 第三步：确认场景摘要

第三步是本模块和 `ecom-details-image` 融合的关键。

界面结构：

```text
场景方案
├── 参考图与补充信息摘要
├── 统一风格锁定摘要
└── 场景摘要列表
    ├── H1 首屏主视觉
    ├── H2 核心卖点图
    ├── D1 详情页首屏
    └── ...
```

每张摘要卡片默认展示：

- 图片编号。
- 图片用途。
- 输出尺寸。
- 模型生成的 1-3 句场景、构图、动作和氛围摘要。
- 不展示内部模板 ID、`variantId`、视觉方向或完整 Prompt；这些字段由第二步生成并作为冻结
  执行数据进入第三步。

允许用户：

- 根据摘要确认整套场景；如果方向不对，返回第一步调整场景或补充信息后重新规划，
  不在摘要页直接编辑隐藏的完整 Prompt。
- `主图组`、`详情页组`、`完整图片包` 的固定序列不可删除或拖拽，避免破坏
  5/9/14 项 runtime 合同；单张模式本身也不提供删除入口。
- 任一摘要或完整 Prompt 缺失时禁用 CTA，不能创建生图任务。

底部 CTA：

```text
开始生成图片
```

如果规划结果不完整，CTA 禁用并展示：

```text
场景方案不完整，请重新规划
```

### 5.4 第四步：实际生成图片

实际生成阶段复用当前结果页能力：

- 首位原图卡。
- 结果卡片。
- 单图预览。
- 长图预览。
- 单图下载。
- 全部下载。
- 已选下载。
- 重生成。
- 文字修改。

结果网格首位使用规划时冻结的参考图构造只读“原图”卡，其余结果卡只渲染真实任务输出
资产，不再使用 fake timer 或占位图判定成功。原图卡不是 generated asset，不计入生成数量，
也不参与选择、下载、长图预览或图片相册；历史恢复时从 `inputAssets(role=reference)` 重建。
图片相册仅包含成功的 generated asset，主图容器按图片固有比例收缩，不在图片外补浅色背景。
商品、服饰、场景实时结果和生成历史共用 `PreviewCanvas` 的下载链路：长图合成必须先读取真实
workspace asset 字节，再通过同源 Blob / ImageBitmap 解码到受尺寸与总像素上限约束的 Canvas，
最终只保存真实 PNG；不允许用 SVG 或渐变占位内容冒充 PNG。全部下载、分组下载和已选下载的
ZIP 必须包含原始生成资产字节并保留图片扩展名，中文文件名写入 UTF-8 标记。下载期间入口禁用，
读取、解码、合成、编码或保存失败统一提示用户，取消系统保存对话框不报错。受当前 JSON IPC
内存边界约束，ZIP 顺序读取图片且原始资产累计超过 32 MiB 时提示按分组或分批下载。
单图、长图和 ZIP 在转换为 IPC number array 前还必须校验最终文件不超过 32 MiB；超过时不调用
写盘命令并展示明确提示。

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
  imageNo: number;
  sortOrder: number;
  code: string;
  title: string;
  purpose: string;
  ratio: string;
  templateId: string;
  variantId: string;
  promptSummary: string;
  prompt: string;
  negativeConstraints: string;
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
  variantId: "minimal",
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

场景结果与从生成历史恢复的场景结果复用统一 AI 改图链路：用户在结果卡输入微调 Prompt 后，
前端创建 `image-edit` 任务，以当前展示资产作为唯一 reference，并只持久化用户微调要求与
结果 lineage；完整 Provider Prompt 由 Rust 执行器在内存组装。Rust 执行时解析当前默认真实
`image-edit` 模型配置，`mock-local` 不得返回可归并结果。新图成功落盘后原子替换父任务稳定
槽位，Provider 或归并失败时保留原图。提交按钮只显示“重新生成”。

场景实时结果和历史恢复结果也复用统一“编辑文字”链路。打开浮层后先显示骨架屏，并以当前
active generated asset 调用最新真实 `image-text-recognition` 配置；返回项包含按阅读顺序排列
的文字和归一化 bbox。未识别到文字时提示用户并关闭浮层；未发生修改时确认按钮禁用。用户
清空某一行表示删除该 bbox 内文字，非空修改表示替换；前端只提交变化行，Rust 将其校验后交给
执行时最新真实 `image-edit` 配置，成功后替换原稳定槽位。Prompt 与图片数据仅在内存构造，
真实 Provider 的 OCR 准确率、bbox 精度和擦字背景补全效果仍待人工验收。

## 7. Prompt 配置与生成规则

业务 Prompt 的唯一事实源是 Rust bundle 内的四个 TOML：

- `scene_template_routing.toml`（当前 `v3`）：只负责 conversion driver、视觉方向和模板路由，
  使用精简 routing index，不接收完整模板执行规则。
- `scene_prompt_planning.toml`（当前 `v10`）：接收已校验的冻结路由和选中模板完整规则，生成
  Campaign Style Lock、1/5/9/14 项摘要及完整可执行 Prompt。
- `scene_template_catalog.toml`（当前 catalog `v5`）：25 个模板的生图专业身份、构图、默认、
  变体、品类、Anti-AI、文字和证据规则。
- `scene_image_generation.toml`（当前 `v7`）：薄 image-to-image 执行器，按 `templateId` 注入
  catalog 中对应的专业身份，再直接使用完整场景 Prompt、参考图和尺寸；不描述流程步骤，
  不再拼接 Style Lock、模板规则、标题、用途或独立负向约束。

Rust 只负责加载内置配置、替换变量、校验结构/catalog/冻结路由一致性和调用 Provider，
不负责业务模板或 variant 的语义选择，也不硬编码主体识别与证据门槛规则。
planning v10 的 `system_rules` 只保留会影响模型创作判断的事实与证据边界、模板原生视觉语言
优先级、精简 Style Lock、variant / `base` 选择、自包含最终 Prompt、摘要边界和安全注入规则。
数量、code/purpose 顺序、稳定 ID、版本、字段类型、残留占位符和冻结路由一致性由
`output_format` 与 Rust 校验负责，不在 system rules 中重复堆叠。planning 调用只注入当前
code/purpose 与逐槽位冻结模板完整配置，不再注入 routing 阶段的 `recommendedTemplateIds`；
推荐集合只服务 routing 排序，不能再次影响最终规划。
`single` 模式的 `imageNo/sortOrder/code/purpose/ratio` 由冻结输入唯一确定，`templateId` 由
routing v3 冻结；Rust 校验 planning 结果与这些确定性字段一致，并校验 `variantId` 属于当前
冻结模板或为允许的 `base`。模型仍负责 `campaignStyleLock/title/variantId/promptSummary/prompt/
negativeConstraints` 的语义内容。规划失败时前端返回场景配置页并保留参考图，不能停留在空的
Prompt 审核页。
`prompt` 与 `negativeConstraints` 必须分别非空且不能残留占位符；规划 Prompt 负责保证完整
负向语义已经写入最终 Prompt，Rust 不要求两段文本逐字相同或形成精确子串，避免模型仅调整
标点或同义措辞就误判整份方案无效。
路由调用只注入精简 routing index；完整规划调用只注入路由选中的去重模板，两个调用都
不能发送完整 catalog。配置与运行时共同保证：

1. 多图任务必须生成同一段 `统一风格锁定`。
2. 每张图 Prompt 第一段必须原样复用同一段统一风格锁定。
3. 颜色尽量使用 hex 值。
4. 产品占比必须数字化。
5. 留白必须显式声明。
6. 每张 Prompt 必须包含负面约束。
7. 中文图片内文字用 `「」` 包裹。
8. catalog `v5` 已逐项复核原 25 个 JSON，保留原 variant ID 和逐品类规则，并增加每个
   模板对应的生图专业身份；固定 8K、
   绝对像素、真实媒体/平台/设备品牌和示例 Prompt 原文继续按安全边界排除，并用无品牌
   镜头、光线、景深、真实皮肤/材质和版式语言替代。
9. routing v3 先识别交付物形式，再识别画面语言和投放渠道；“用于小红书发布的信息图”仍
   路由到 infographic，只有明确要求手机随拍或社媒原生照片时才选择 social-media。
10. infographic 在 planning v10 中恢复完整执行合同：以 `E-commerce infographic` 开头，
    明确结构化布局、HEX 色板、移动端字号、4-6 个证据型 callout、标注线、主体占比、留白、
    光线和专项禁止项；文化器物仅标注参考图可见结构，年代、来源、尺寸、用途、馆藏和考古
    信息不得从图片推断。
11. routing 必须为每项只选择一个模板并写入稳定 `templateId`；完整规划模型只能消费冻结
   路由，不能重新选择模板，并在该模板内选择唯一 variant override；没有适用 override 时
   使用 `variantId="base"`。规划再将模板基础结构、该 variant、适用品类、
   Anti-AI、文字和证据规则展开进完整 Prompt，
   生图执行器不得再次读取或拼接 catalog 规则。
12. 参考图统一描述为主体视觉事实源。商品保持结构、颜色、图案、文字和 Logo；人物保持
    身份、五官结构、肤色、体型和发型关键特征。仅当服装本身是商品参考、reference role
    明确为服装或用户要求保留时，现有服装才作为不可改写事实；其它人物场景可按模板和
    variant 调整造型，并受控设计姿态、视线、表情、肩颈动作和自然妆发整理。
13. Campaign Style Lock 只保存视觉系统，不得重述或猜测具体人物、服装或商品事实；
    用户未确认精确文字时只保留排版安全区，不生成占位字符。
14. `promptSummary` 只给用户展示场景结果摘要，完整 Prompt 不进入审核 DOM；执行器原样
    消费完整 Prompt，不重新规划、扩写、改写、总结或叠加限定词。
15. single 不生成 Campaign Style Lock；5/9/14 多图 Prompt 的第一段必须原样包含同一
    Style Lock。每个 Prompt 本身包含该项完整负向约束，默认使用英文，除非用户明确指定语言。
16. 25 个模板必须各自配置 `executor_identity`。最终 system Prompt 只声明当前模板身份，
    user Prompt 只包含完整场景 Prompt 与输出尺寸，禁止出现“第一步/第二步/第三步/上一步/本阶段”等流程上下文。
17. `variantId` 只要求属于当前 `templateId`，允许不同模板使用同名 variant；没有适用 override
    时统一使用 `base`。`templateId` 在 full-pack 中不要求全局唯一，只要复用项具有不同 purpose、
    构图或 Campaign 角色；不得为了机械去重选择次优或证据不足的模板。
18. single 的冻结输入合同固定 `conversionDriver=visual`，routing 按该合同返回 driver、视觉方向
    和模板；Rust 只校验结果一致性。该字段只用于统一结构，不能把人物、空间、界面或概念单图
    改写成电商转化叙事。
17. 商品摄影模板在图片包内组合与参考证据相容的角度和景别，避免连续 3 张机械复用同一
    机位；人物、空间、界面、UGC、杂志、运动、生活方式和抽象创意模板的镜头节奏服从各自
    模板与 variant，不强制凑齐俯视、仰视或微距。棚拍、海报和信息图可轮换 Style Lock
    定义的 HEX 背景；自然环境类模板锁定环境材质、地点族、主色倾向和光线连续性即可。
18. 商品主体占比按白底、卖点、场景、广告和多规格图分别约束；只有详情信息图才限制标题、
    短标签和单屏总字量。缺失受众或平台时使用中性、跨平台安全构图；不得猜测功能、材质、
    参数、效果、促销、认证或其它营销事实。
19. routing Prompt 要求 25 个模板在主体匹配且满足 `routing_required_evidence` 时可由任意 H/D
    槽位路由；人物、包装、多商品、界面、门店、内部结构、对比、规格、促销或效果模板不得
    绕过证据门槛。该语义约束不由 Rust 重新实现，真实参考图上的效果仍待人工验收。
20. 模板 executor identity、variant、文字/证据政策和原生视觉语言优先于视觉方向。D1-D9 的
    信息职责由所选模板使用自身构图语言表达，不强制每张详情图套用相同信息图骨架。
21. 镜头、景别、背景、服装保真和字体策略按商品、人物、空间、界面或混合主体条件化应用；
    商品占比、人物服装或营销字体规则不得无差别覆盖其它主体类型。

H1-H5 必须按 `conversionDriver` 选择唯一叙事：

- `visual`：视觉主张 → 功能/质感特写 → 使用场景 → 普通方案/升级方案对比 →
  已有证据支持的保障或 CTA。
- `pain-point`：问题快照 → 解决机制 → 利益证明 → 已有证据支持的信任画面 →
  CTA；没有紧迫性或优惠事实时不得虚构。
- `emotional`：情绪场景 → 身份/价值表达 → 产品作为实现方式 →
  归属/社交信号 → 情绪强化 CTA。

D1-D9 固定为 PDP 业务叙事，而不是强制套用包装、多品或社媒模板：

1. `D1` 首屏承接。
2. `D2` 痛点放大。
3. `D3` 机制解释。
4. `D4` 核心利益。
5. `D5` 使用步骤。
6. `D6` 场景覆盖。
7. `D7` 对比选择。
8. `D8` 信任背书；只使用参考图或补充信息中的已有证据。
9. `D9` FAQ / 风险逆转 / CTA。

两阶段任务、摘要边界、薄生图执行、参考资产安全、脱敏、variant/routing 和 Scene
`input.userImages` 入库前拒绝、显式尺寸与冻结比例一致性，以及成功重试在归并窗口和重启后的
恢复合同均已完成自动化验证；失败 retry 不覆盖已有成功父图。React/WebView 重载时仍处于
`queued` / `running` 的场景父任务与 retry 会恢复轮询和取消追踪，进程重启后已由 startup
recovery 标记为 `interrupted` 的任务不会被重新启动。用户开始另一轮场景规划或生成时，旧
恢复任务继续独立更新自己的历史记录，但不得覆盖当前画布。
`make check` 已通过，包含 255 项 Vitest、frontend build、cargo check 和 0 个高危 npm
audit；Rust 全量 `cargo test` 也已通过，
lib 185/185 且全部 integration/doc tests 成功。25 模板在真实参考图上的语义路由、证据门槛和
生成效果仍需付费 Provider 人工验收，真实桌面快速新建、历史切换和重启重试竞态也仍待手工
验收；在这些人工证据齐备前不标记整个 M7-T07 完成。

通用安全补充：主图和详情页应使用互补角度与景别，避免整套图雷同；详情页必须完成对应
信息职责，但表现方式服从所选模板，可使用信息图、场景摄影、细节标注、步骤、对比或其它
证据安全的模板语言；不得虚构认证、销量、实验数据、医疗功效或真实评价。

## 8. 源项目能力映射

| ecom-details-image 能力 | 场景模块落点 | 第一版状态 |
| --- | --- | --- |
| 25 个场景模板 | runtime 自动路由，UI 不展示模板选择 | 已内置完整 25 个模板 |
| 统一风格锁定 | 第三步 Prompt 确认页 | 必做 |
| 主图 H1-H5 | `主图组` 输出内容 | 必做 |
| 详情页 D1-D9 | `详情页组` 输出内容 | 必做 |
| 主图+详情页完整包 | `完整图片包` 输出内容 | 必做 |
| generate_image.py | 不迁移；由现有 Rust Provider adapter 执行 | 已完成 |
| apimart 异步轮询 | 不迁移；沿用现有 Provider 协议与超时 | 已完成 |
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
- 配置面板包含参考图、输出内容、输出尺寸和必填补充信息，不显示模板或视觉方向选择。
- 未上传参考图时底部 CTA 禁用。

### Phase 2：场景模板 catalog 与自动路由

目标：把 `ecom-details-image` 的 25 个场景转成内置 catalog，并由 runtime 自动路由。

涉及文件：

- `desktop/src-tauri/src/services/prompts/scene_template_routing.toml`
- `desktop/src-tauri/src/services/prompts/scene_template_catalog.toml`
- `desktop/src-tauri/src/services/prompt_registry.rs`
- `desktop/src-tauri/src/services/local_task_executor.rs`

验收：

- catalog 完整覆盖 25 个源模板，并通过稳定模板 ID 精确映射。
- 四种输出模式都由 runtime 自动路由模板，最终规划在冻结模板内选择 variant；UI 不提交模板或视觉方向。
- H/D 推荐模板不构成 allowlist；routing Prompt 要求 25 个模板在证据充分时均可到达，真实
  语义可达性仍待人工验收；full-pack 可合理复用模板，无适用 override 时使用 `base` variant。
- 补充信息为空时不能创建规划任务。
- 输出尺寸复用 `3:4`、`1:1`、`9:16`。

### Phase 3：真实图片计划与场景摘要确认页

目标：完成配置 -> 自动路由与完整方案生成 -> 场景摘要确认流程。

涉及文件：

- `desktop/src/features/scenes/lib/scenePromptBuilder.ts`
- `desktop/src/features/scenes/lib/sceneImagePlan.ts`
- `desktop/src/features/scenes/components/ScenePromptReviewPanel.tsx`
- `desktop/src/app/App.tsx`
- `desktop/src/app/App.test.tsx`

验收：

- 点击 `生成图片方案` 后创建并启动一个 `scene-prompt-planning` 真实任务；任务内部先执行
  模板路由调用，再以冻结路由执行完整规划调用。
- 轮询任务成功后，严格校验结构化方案，但审核 UI 只展示场景摘要。
- `单张场景图` 生成 1 张图片计划。
- `主图组` 生成 H1-H5。
- `详情页组` 生成 D1-D9。
- `完整图片包` 生成 H1-H5 + D1-D9。
- 每张图都包含 Prompt、用途和尺寸。

### Phase 4：结果页复用与真实生成

目标：Prompt 确认后进入结果页，复用现有预览和下载能力。

涉及文件：

- `desktop/src/features/scenes/components/ScenePreviewCanvas.tsx`
- `desktop/src/features/generation/components/PreviewCanvas.tsx`
- `desktop/src/app/App.tsx`
- `desktop/src/app/App.test.tsx`

验收：

- 点击 `开始生成图片` 后创建并启动一个父 `scene-image-generation` 任务。
- 生成完成后展示结果图卡片。
- 单图预览、删除、下载、全部下载继续可用。
- 长图下载保存真实 PNG，全部/分组/已选下载保存真实生成资产字节；共享下载按钮具备 loading、
  防重复提交和失败 toast。
- 场景实时结果和历史恢复结果均可用当前图片与用户 Prompt 发起 AI 改图；成功替换原槽位，失败保留原图。
- 结果卡片标题来自图片计划，而不是固定占位文案。

### Phase 5：真实 Provider 接入

目标：把 Prompt 计划交给 Rust 层固定 Provider 适配器，真实生成图片并保存到本地资产。

本阶段沿用现有模型配置、密钥、任务、资产和 Provider adapter，不新增依赖、
数据库 schema、Tauri capability 或 `GenerationPort` 方法。

建议边界：

- API Key 只由 Rust 层读取。
- 前端不保存 API Key。
- 不直接调用 Python 脚本。
- OpenAI 规划使用 Responses，生图使用 `/v1/images/edits` multipart。
- 火山规划使用 Responses，生图使用 `/images/generations`，多参考图发送数组。
- 火山图片尺寸按具体 Seedream 模型登记：Seedream 5.0 / 5.0 Lite 的 2K
  `3:4`、`9:16`、`16:9` 分别使用 `1728x2304`、`1440x2560`、`2560x1440`；
  Seedream 5.0 Pro 的连接探测使用 1K 降低测试成本，但真实场景任务未显式指定尺寸时
  必须按当前比例选择 2K 档；4.5 / 4.0 保留各自旧尺寸表，不能跨模型复用低于 5.0
  像素下限的尺寸。
- Rust 层负责最多 4 个 item 的 `JoinSet` 并发、Provider semaphore、下载、
  错误传播、本地保存、部分失败和稳定 `sortOrder`。
- 父任务冻结两份 Prompt 版本、catalog 版本、Campaign Style Lock 与 items；
  旧版本结果可查看，但单图重试必须重新规划。
- 场景父任务创建后立即进入生成历史；成功、部分失败和失败均按父任务状态更新，
  成功生成的人物或商品场景图作为缩略图进入“场景”筛选。参考图不单独创建历史记录。

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
3. 选择输出内容和尺寸，并填写非空补充信息。
4. 点击 `生成图片方案`。
5. 查看每张主图或详情图的场景摘要；内部模板、variant 和完整 Prompt 不在审核 UI 展示。
6. 点击 `开始生成图片`。
7. 在结果页查看、预览和下载图片。

场景规划和生图均要求可用的真实 OpenAI 或火山配置；仅有 Mock Local 时必须明确
失败，不能以占位图伪装真实结果。
