# 商品菜单详情页 14 模块说明

> 日期：2026-07-08
>
> 适用范围：`desktop` 商品菜单下的商品详情图生成流程
>
> 相关代码：
>
> - `desktop/src/app/studioData.ts`
> - `desktop/src/features/generation/components/GenerationConfigPanel.tsx`
> - `desktop/src-tauri/src/services/prompt_plan.rs`
> - `desktop/src-tauri/src/services/prompts/product_detail_scene_prompt.toml`

## 1. 定位

商品菜单下的模块用于生成商品详情页图片方案，不属于场景菜单的 25 个场景模板。

商品详情图采用两阶段流程：

```text
商品图 + 商品卖点 + 已选模块 + 爆款风格
  -> PromptPlan 生成每个模块的 image_type / image_prompt / copy_requirements
  -> 用户编辑 copy_requirements
  -> 生图任务使用隐藏 image_prompt + 用户修改后的 copy_requirements
```

每个模块最终至少生成三类数据：

- `image_type`：模块标题和当前图的商品化主题，例如 `首屏主视觉: 传递核心价值`。
- `image_prompt`：下一步发给生图模型的核心画面 prompt，默认不展示给用户编辑。
- `copy_requirements`：用户可查看、可修改的文案与排版要求。

## 2. 模块清单

商品菜单支持 14 个详情页模块。前 6 个默认选中，后 8 个默认不选中。

| 序号 | 前端模块 id | 配置模块 id | 模块名称 | UI 描述 | 默认选中 |
| --- | --- | --- | --- | --- | --- |
| 1 | `hero` | `hero_visual` | 首屏主视觉 | 传递核心价值 | 是 |
| 2 | `selling-point` | `core_selling_point` | 核心卖点图 | 突出差异优势 | 是 |
| 3 | `scenario` | `usage_scene` | 使用场景图 | 呈现真实使用场景 | 是 |
| 4 | `angle` | `multi_angle` | 多角度图 | 多角度呈现外观 | 是 |
| 5 | `atmosphere` | `atmosphere_scene` | 场景氛围图 | 展示使用场景 | 是 |
| 6 | `detail` | `product_detail` | 商品细节图 | 放大材质与工艺 | 是 |
| 7 | `brand` | `brand_story` | 品牌故事图 | 传达品牌理念 | 否 |
| 8 | `size` | `size_capacity_size_chart` | 尺寸/容量/尺码图 | 展示规格信息 | 否 |
| 9 | `compare` | `effect_comparison` | 效果对比图 | 使用前后效果对比 | 否 |
| 10 | `spec` | `spec_parameter_table` | 详细规格/参数表 | 展示商品数据 | 否 |
| 11 | `process` | `craft_process` | 工艺制作图 | 展示工艺制作过程 | 否 |
| 12 | `parts` | `accessories_gifts` | 配件/赠品图 | 明确收纳的所有物品 | 否 |
| 13 | `series` | `series_showcase` | 系列展示图 | 多色或多 SKU 展示 | 否 |
| 14 | `components` | `ingredient_composition` | 商品成分图 | 展示配方/材质/成分 | 否 |

## 3. 模块职责

### 3.1 首屏主视觉

- 配置 id：`hero_visual`
- 核心目标：建立第一眼商品识别，传递最核心购买理由。
- 输出重点：商品完整主体、核心外观、第一卖点、主标题安全区。
- 约束：不改变产品造型，不添加不存在的配件，不堆叠过多卖点。

### 3.2 核心卖点图

- 配置 id：`core_selling_point`
- 核心目标：放大一个核心卖点，让用户理解为什么值得购买。
- 输出重点：单一核心卖点、商品主体、卖点信息区、辅助视觉元素。
- 约束：不夸大功效，不添加未经提供的技术参数，不使用医学化或认证化表达。

### 3.3 使用场景图

- 配置 id：`usage_scene`
- 核心目标：让用户代入真实使用方式，理解商品在具体生活场景中的价值。
- 输出重点：真实使用场景、合理使用方式、生活化道具、目标人群动作。
- 约束：不制造错误使用方式，不让人物或道具喧宾夺主，不遮挡商品主体。

### 3.4 多角度图

- 配置 id：`multi_angle`
- 核心目标：通过多视角降低用户对外观、结构、比例的判断成本。
- 输出重点：正面、侧面、俯视、局部等多角度组合。
- 约束：不改变产品比例，不改变 Logo 位置，不把单品生成多 SKU。

### 3.5 场景氛围图

- 配置 id：`atmosphere_scene`
- 核心目标：塑造商品审美、情绪价值和生活方式感。
- 输出重点：氛围场景、色彩、光影、材质和空间层次。
- 约束：不使用与商品定位冲突的场景，不让空间氛围压过商品。

### 3.6 商品细节图

- 配置 id：`product_detail`
- 核心目标：通过特写展示可见细节、结构、材质线索和品质感。
- 输出重点：局部放大、近景或微距、结构和质感线索。
- 约束：不编造材质，不展示未提供结构，不夸大工艺等级。

### 3.7 品牌故事图

- 配置 id：`brand_story`
- 核心目标：传递品牌理念、产品态度或长期价值感，增强信任。
- 必要信息：品牌理念、品牌故事、品牌关键词。
- 缺失策略：缺少品牌理念或品牌故事时，不编造历史、创始人、年份、奖项，只输出需补充。

### 3.8 尺寸/容量/尺码图

- 配置 id：`size_capacity_size_chart`
- 核心目标：展示尺寸、容量、尺码、重量等规格信息，降低购买判断成本。
- 必要信息：尺寸、容量、尺码、重量、规格。
- 缺失策略：缺少具体规格时，`copy_requirements` 写需补充，`image_prompt` 不生成虚假数字或虚假标尺。

### 3.9 效果对比图

- 配置 id：`effect_comparison`
- 核心目标：通过问题和方案、使用前后、左右对比展示感知差异，化解顾虑。
- 必要信息：核心卖点、用户顾虑、可对比状态。
- 缺失策略：缺少可证明效果时，只做体验对比或场景对比，不做硬性功效承诺。

### 3.10 详细规格/参数表

- 配置 id：`spec_parameter_table`
- 核心目标：集中展示商品参数，辅助用户决策。
- 必要信息：规格参数。
- 缺失策略：参数不足时写更多参数需补充，不编造任何数值。

### 3.11 工艺制作图

- 配置 id：`craft_process`
- 核心目标：展示已确认的工艺、制作流程或结构设计，增强品质信任。
- 必要信息：工艺、制作流程、结构说明。
- 缺失策略：没有工艺信息时，只能表达工艺感细节展示，不生成具体生产流程。

### 3.12 配件/赠品图

- 配置 id：`accessories_gifts`
- 核心目标：展示商品到手包含内容，减少用户对配件、赠品、包装清单的疑问。
- 必要信息：配件、赠品、包装清单。
- 缺失策略：未提供配件或赠品时，输出需补充，不自动添加说明书、线材、收纳袋、刷头、礼盒。

### 3.13 系列展示图

- 配置 id：`series_showcase`
- 核心目标：展示已确认的多色、多规格、多 SKU 或套装组合。
- 必要信息：SKU、颜色、规格、套装信息。
- 缺失策略：只有单品时不能编造系列，输出系列或 SKU 信息需补充。

### 3.14 商品成分图

- 配置 id：`ingredient_composition`
- 核心目标：展示已确认的成分、配方、材质或组成信息。
- 必要信息：成分、配方、材质、组成。
- 缺失策略：缺少成分、配方或材质信息时，输出成分信息需补充，不编造成分。

## 4. Prompt 配置使用规则

模块配置保存在 `product_detail_scene_prompt.toml` 中：

- `module_config_rules`：全局输出契约、全局规则、全局 image prompt 结构、全局 copy requirements 结构。
- `scene_modules`：14 个 `[[scene_modules]]` 模块配置。

运行时不会把全部 14 个模块都发给模型。流程如下：

```text
前端提交已选模块 moduleId/moduleTitle
  -> Rust 映射到配置模块 id
  -> 从 scene_modules 中筛选对应 [[scene_modules]] 段落
  -> 注入到 {{selectedSceneModules}}
  -> 文本模型生成当前任务的 image_type / image_prompt / copy_requirements
```

示例：

```text
用户只选择 使用场景图
  -> 前端模块 id: scenario
  -> 配置模块 id: usage_scene
  -> 发给模型的 Prompt 中只包含 usage_scene 配置
  -> 不包含 ingredient_composition 等未选模块配置
```

## 5. 占位变量规则

模块配置中存在两类占位变量。

本地可替换变量：

- `{target_platform}`：由当前目标平台替换。
- `{target_language}`：由当前目标语言替换。

模型生成型变量：

- `{visual_style}`
- `{product_subject}`
- `{core_value}`
- `{recommended_background}`
- `{recommended_props}`
- `{copy_space_position}`
- `{main_title}`、`{subtitle}`、`{tags}` 等。

这些变量没有本地固定数据源，模型必须根据商品卖点、已选模块、目标语言和爆款风格生成具体内容。

模型最终返回的 `image_prompt` 和 `copy_requirements` 不允许残留 `{...}` 占位符。后端解析 PromptPlan 时会校验，如果仍包含未填充占位符，则判定第二步返回无效。

## 6. 输出约束

每个已选模块必须输出一个对象，并按用户选择顺序生成 `index`。

字段要求：

- `index`：从 1 开始，按用户选择顺序递增。
- `image_type`：格式为 `模块名称: 商品化核心主题`。
- `image_prompt`：用于下一步生图，必须包含产品锁定段落。
- `copy_requirements`：用户可编辑文案和排版要求，必须遵守目标语言。

事实边界：

- 商品卖点摘要是唯一事实来源。
- 不编造参数、材质、认证、功效、容量、尺寸、功率、价格、产地、品牌历史。
- 每张图只表达一个核心观点。
- 标题、副标题、标签、参数文字默认作为后期设计层叠加；`image_prompt` 只要求预留排版空间。

## 7. 验收口径

商品菜单支持 14 个模块时，至少满足以下验收：

- UI 模块清单包含 14 个模块，且前 6 个默认选中。
- 第二步 PromptPlan 请求只注入用户已选模块对应配置。
- 未选模块配置不会进入当前请求。
- 每个模块返回 `image_type`、`image_prompt`、`copy_requirements`。
- 用户只编辑 `copy_requirements`，隐藏的 `image_prompt` 仍会在下一步生图时一起发送。
- 模型返回中残留 `{...}` 占位符时，后端拒绝该 PromptPlan。
