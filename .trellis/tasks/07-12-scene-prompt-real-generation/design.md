# 技术设计

## Architecture

链路分成两个真实任务：

1. `scene-prompt-planning`：`workspace=scene`、`kind=prompt-plan`，读取参考资产和必填补充信息；
   同一任务内部先渲染 `scene_template_routing.toml` 选择 conversion driver、视觉方向和模板，
   Rust 校验并冻结路由后，再渲染 `scene_prompt_planning.toml` 生成完整方案，最终只持久化
   规范化规划输出。
2. `scene-image-generation`：`workspace=scene`、`kind=image-generation`，冻结规划产生的完整 Prompt，逐 item 通过薄 `scene_image_generation.toml` 原样执行，调用 OpenAI/火山并保存 generated assets。

Prompt 配置包括：

- `scene_template_routing.toml`：routing v3，使用精简 routing index，只输出 driver 与每项
  `templateId`；完整规划在该模板内选择 `variantId`。
- `scene_prompt_planning.toml`：planning v10，接收冻结路由与选中模板完整规则，输出 Style
  Lock、摘要、完整 Prompt 和最终 JSON 合同。
- `scene_template_catalog.toml`：25 个统一字段的 `[[scene_templates]]`，每项包含生图专业身份。
- `scene_image_generation.toml`：仅组合当前模板专业身份、完整 Prompt、尺寸和单图输出要求，
  不承载视觉规划规则或流程上下文。

## Contracts

- 规划输出：`templateCatalogVersion`、`conversionDriver`、`campaignStyleLock`、`items[]`。
- 路由中间输出：`catalogVersion`、`conversionDriver`、`visualDirectionId`、
  `selections[{code,templateId}]`；只存在于 executor 内存，不是持久化合同。
- item：`imageId/imageNo/sortOrder/code/title/purpose/templateId/variantId/ratio/promptSummary/prompt/negativeConstraints`。
- `prompt` 与 `negativeConstraints` 分别校验非空和残留占位符，不要求两者逐字形成子串；
  完整负向语义由规划 Prompt 合同负责，避免同义改写导致有效方案被拒绝。
- planning v10 中 `variantId` 必须属于 routing 冻结的当前模板，或在没有适用 override 时
  使用统一的 `base`；full-pack 允许有明确业务差异的模板复用。single 的 conversion driver
  由 runtime 固定为 visual。planning v10 必须逐项匹配冻结路由，不得改选 driver、视觉方向
  或模板；variant 只能在冻结模板内部选择。
- H/D 槽位只冻结 code、purpose、数量和顺序；`recommendedTemplateIds` 是路由提示而非
  allowlist。routing v3 可从全部 25 个模板中选择满足主体与证据门槛的最佳模板，并区分
  交付物形式、画面语言和投放渠道；渠道词不能覆盖更明确的信息图或结构说明形式。
- planning v10 的 system rules 只拥有模型行为：事实与证据、模板优先、Style Lock 核心、
  variant/base、自包含 Prompt、摘要边界和安全注入。数量、顺序、稳定 ID、字段类型、版本和
  冻结路由一致性由 output format 与 Rust 校验。
- infographic 由 catalog v5 与 planning v10 共同承担完整执行合同：结构化布局、HEX 色板、
  移动端文字层级、4-6 个证据型 callout、主体占比、留白、光线和专项负向约束；文化器物仅
  标注可见结构与表面状态，历史、馆藏和考古信息不得从图片推断。
- 最终任务快照保存两个 Prompt 版本、catalog 版本、Style Lock 和用户确认 items；参考图仅通过 `inputAssets(role=reference)` 关联。
- `scene-prompt-planning` 新增到公共 capability union；`scene-image-generation` 从 text-to-image 调整为 image-to-image，并加入 OpenAI allowlist。
- 不改变 GenerationPort 方法或数据库 schema。

## Data and Safety

- catalog loader 只接受内置配置，校验版本、25 个唯一 ID 和全部必填字段。
- 运行时只选取当前模板 section；用户输入视为数据，不能覆盖系统规则。
- Provider Prompt 只在内存与显式 debug stderr 中出现；持久层只保留结构化业务快照。
- 路由 JSON 同样只驻留内存，不写 `generation_tasks`、SQLite、task events、诊断或前端 DTO；
  task success 仅记录两次调用的脱敏 invocation ID。
- 参考图从 workspace 资产读取并在调用边界转换，绝对路径和 Base64 不进入任务 JSON。
- OpenAI 使用既有 multipart/MIME 校验；火山使用既有模型级参数矩阵。

## Planning Invocation

- 两次调用复用同一个 `scene-prompt-planning` capability、模型配置和父 `prompt-plan` 任务，
  不新增 capability、GenerationPort、schema、migration 或依赖。
- routing 调用只注入参考图、输出模式、比例、必填补充信息、H/D 槽位和精简 index。
- routing 通过结构校验后，planning 调用只注入逐槽位 code/purpose、路由选中的去重模板
  完整规则和冻结路由，不注入 routing 的 `recommendedTemplateIds`。
- 路由必须让 25 个模板全部可达，并在人物、包装、多商品、界面、门店、内部结构、对比、
  规格、促销或效果等场景应用对应证据门槛；证据不足时不得选择相关模板。
- 视觉方向仅锁定跨图色板、光线和版式基线，不能覆盖当前模板的 executor identity、variant、
  文字政策和原生视觉语言。详情屏的信息职责由所选模板以自身结构表现，不强制所有 D 图
  套用同一种信息图骨架。
- 规划按主体类型条件化镜头、景别、背景、服装保真与字体策略，避免把商品占比、人物服装
  或营销字体规则无差别套到空间、界面与混合主体。
- 两次调用串行服从既有 Provider semaphore；routing Provider 失败、路由非法或调用间任务
  已取消时不发起 planning。planning 失败或与冻结路由不一致时不保存 output。

## Execution and Recovery

- Scene 父任务按稳定 item 顺序并发执行，单任务最多 4 项，并服从全局 Provider semaphore。
- 至少一项保存成功则父任务 succeeded，并记录 failed item count；全部失败取最小 item index 的代表错误。
- cancel/hidden 守卫覆盖 Provider 返回、下载、落盘和关联，晚到结果不得复活。
- 单项重试创建含一个 item 的子任务，成功后原子归并父任务稳定槽位并隐藏子任务。
- Prompt/catalog 版本不匹配的旧任务仍可查看资产，但重试要求重新规划。
- 实时结果从规划上下文冻结的参考图构造首位只读原图卡；历史恢复从
  `inputAssets(role=reference)` 重建同一卡片。原图卡不参与 generated output 状态、数量、
  下载、长图和相册。共享相册按真实图片固有比例收缩主图容器，不为非方图补浅色背景。

## Compatibility

- 当前 UI 的统一比例和 1/5/9/14 数量优先于原 Skill 默认值。
- 默认无衬线；仅杂志/奢华模板允许衬线标题加无衬线正文。
- 不引入 TOML 依赖；catalog 使用项目现有的内置字符串/section 解析模式。
- `scene_template_routing.toml` 与 `scene_prompt_planning.toml` 分别拥有路由和完整规划职责；
  Rust 只负责选择配置、替换变量和结构校验，不维护第二份业务 Prompt。
- H/D 槽位保持固定 code、purpose、数量和 sortOrder；模板选择按 conversionDriver、主体与
  证据适配，推荐模板不构成白名单，后端只校验模板属于 25 项 catalog 且满足冻结路由。
- UI 不消费场景模板或视觉方向，只提交参考图、输出内容、比例和必填补充信息。
- 不新增多商品资产角色。本轮把 `multi-product` 收窄为参考图已经明确展示的套装/组合，避免修改公共资产合同。
- Tooltip 复用现有 shared UI primitive，不增加依赖。
