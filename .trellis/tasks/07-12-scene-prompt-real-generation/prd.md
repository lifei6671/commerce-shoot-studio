# 场景 Prompt 配置化与真实生图

## Goal

将 `ecom-details-image` Skill 中影响模型行为的规则迁移为项目内 TOML Prompt 配置，并把第三个菜单“场景”的前端模拟流程替换为可恢复、可追踪的真实规划与图片生成链路。

## Requirements

- 新增模板路由、场景规划、场景模板目录和最终生图四份 TOML；运行时不依赖原 Skill、JSON、Python 或 apimart。
- Prompt 业务规则只存在于配置文件；Rust 只负责选择配置、变量替换、结构校验、Provider 调用和结果持久化。
- 规划阶段读取 1-3 张参考图，输出 conversion driver、仅多图使用的 Campaign Style Lock，
  以及 1/5/9/14 个包含 `variantId`、用户摘要和完整可执行 Prompt 的稳定图片项。
- UI 不展示或提交模板、模板分类或视觉方向；用户必须填写非空补充信息，由 runtime 自动
  路由模板，完整规划再在冻结模板内选择唯一 variant。
- 同一个 `scene-prompt-planning` 任务内部先执行 routing v3，再用冻结路由执行 planning v10；
  两次调用复用同一 capability，不新增任务、capability 或公共 port。
- 路由结果只驻留 executor 内存，不写 SQLite、task events、诊断或前端 DTO；只持久化通过
  路由一致性校验后的最终规划方案。
- 审核页只展示场景摘要，不展示或编辑完整 Prompt。
- 最终生图阶段按 `templateId` 注入 catalog 配置的场景专业身份，再原样使用规划 Prompt；
  不描述流程步骤，不再拼接 Style Lock、模板规则或独立负向约束；支持 OpenAI `/v1/images/edits` 与火山 `/images/generations`。
- 场景任务复用现有 GenerationPort、ModelGateway、Provider 并发限制、generated asset、历史、取消和单图结果语义。
- raw system/user/roleless Prompt、Base64、临时 URL 和 Provider raw response 不得持久化。
- 不新增依赖、数据库 schema、migration、Tauri 权限或新的 GenerationPort 方法。
- 保持现有场景页面视觉布局。
- 修复场景分类切换残留隐藏模板、空 Prompt 可提交、图片包删除后与固定合同冲突等 UI/runtime 问题。
- 主图组按 visual / pain-point / emotional 恢复原 Skill 的三套转化叙事；详情页组恢复九屏 PDP 叙事，并避免无证据强制包装/多品内容。
- H/D 的 code、purpose 与顺序是固定业务合同，槽位模板仅为推荐而非 allowlist；全部 25 个
  模板均可在主体匹配且满足证据门槛时被路由，详情信息职责由所选模板的原生视觉语言承载。
- full-pack 允许有业务理由的模板复用，不为机械去重牺牲主体、证据或用户意图；未命中明确
  variant override 时使用稳定 `base` 语义。
- 模板原生视觉语言优先于跨图视觉方向；视觉方向只提供色板、光线和版式基线。镜头、背景、
  服装处理和字体策略必须根据商品、人物、空间、界面或混合主体条件化生成。
- routing v3 区分交付物形式、画面语言和投放渠道，渠道词不得覆盖更明确的信息图、详情屏、
  结构标注等交付物形式；planning v10 为 infographic 恢复完整可执行版式和文化器物事实边界。
- planning v10 的 system rules 只保留事实与证据、模板优先、Style Lock 核心、variant/base、
  自包含 Prompt、摘要和安全注入规则；确定性结构由 Rust/output format 保证。planning 只
  注入 code/purpose 与冻结模板，不注入 `recommendedTemplateIds`。
- 输出内容四个标题显示对应数量，并紧邻增加 icon；鼠标悬停或键盘聚焦时使用 Tooltip 说明每种模式的实际输出含义，浮层不得被滚动面板裁剪。
- 模板 routing index 与完整执行规则分别进入 TOML；规划调用不能接收未选模板完整规则。
- 场景结果实时生成和历史恢复都把冻结参考图显示为首位只读“原图”卡；原图不计入生成数量、选择、下载、长图或相册。相册只查看生成图，并按图片固有比例展示，不补外部浅色背景。

## Acceptance Criteria

- [ ] 四份 TOML 可由 Prompt Registry/catalog loader 加载；版本为 routing/planning/generation/catalog `v3/v10/v7/v5`，25 个模板 ID 唯一。
- [ ] UI 不展示模板/视觉方向，补充信息去除首尾空白后为空时不能创建规划任务。
- [ ] 同一规划任务按顺序调用 routing 与 planning；routing 只注入精简 index，planning 只注入实际使用的去重模板，不发送完整 catalog。
- [ ] 路由结果不进入 SQLite、task events、诊断或前端 DTO；routing 失败、非法或调用间取消时不执行 planning。
- [ ] 规划任务替换前端定时器，严格校验 1/5/9/14 项、H/D 顺序、Style Lock、模板 ID 和残留占位符。
- [ ] 规划 item 冻结唯一 `variantId`、摘要和完整 Prompt；single Style Lock 为空，多图 Prompt 原样包含同一 Style Lock 与各自负向约束。
- [ ] 审核 UI 只显示摘要；最终执行器只消费完整 Prompt、参考图和尺寸。
- [ ] `scene-prompt-planning` 为最多 3 张参考图的 image-to-text 能力；`scene-image-generation` 为最多 3 张参考图的 image-to-image 能力。
- [ ] OpenAI 场景生图使用 multipart edits；火山使用 generations，尺寸按当前模型矩阵解析。
- [ ] 一个场景父任务可逐项生成并保持稳定 sort order；部分失败保留成功项，全部失败返回规范化错误。
- [ ] 场景结果来自真实 output assets，并支持历史恢复、取消、删除、尺寸修改和单图重试。
- [ ] SQLite、事件、诊断和前端 DTO 不包含敏感或 raw 模型内容。
- [ ] 输出模式 Tooltip 正确说明 1/5/9/14 张和实际 H/D 语义，鼠标悬停和键盘聚焦可访问，浮层不被滚动面板裁剪。
- [ ] 图片包不允许删除固定计划，空 Prompt 不能提交；分类切换不会保留不可见模板。
- [ ] conversionDriver 驱动 H1-H5 叙事，D1-D9 覆盖首屏、痛点、机制、利益、步骤、场景、对比、信任和 FAQ/CTA。
- [ ] H/D 固定 code/purpose 不形成模板白名单；25 个模板均可在证据充分时被路由，full-pack
  可合理复用模板，variant 未命中 override 时规范化为 `base`。
- [ ] 模板视觉语言优先于视觉方向基线，详情职责及主体相关镜头、背景、服装和字体策略按
  当前模板与主体类型执行。
- [ ] planning 请求只包含 code/purpose 与冻结模板；system rules 不重复数量、顺序、稳定 ID、
  字段类型和版本等 Rust/output format 已负责的结构合同。
- [ ] 场景结果首位为冻结参考图构成的原图卡，历史数量与相册仍只计算 generated outputs；相册无图片外部浅色留边。
- [ ] 定向测试、`make test`、`make frontend-build`、`make cargo-check`、`make check` 和 `git diff --check` 通过。

## Out of Scope

- apimart Provider、Python sidecar、`.env` 兼容和任意 custom gateway。
- 新的数据库表、公共 GenerationPort 方法或 UI 视觉重做。
- 自动验证图片中文字笔画、CTR 评估或付费真实 14 图自动化测试。
