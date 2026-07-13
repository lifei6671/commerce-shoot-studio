# 结果图片文字识别与定位改字

## Goal

将生成结果卡片现有的静态“编辑文字”演示改成真实两阶段模型链路：先识别当前图片中的逐行文字及位置，再由用户修改后调用图生图模型精准替换对应文字。商品、服饰、场景以及从生成历史打开的结果使用同一行为。

## Background

- 当前结果卡共用 `PreviewCanvas`，但“编辑文字”浮层使用前端固定示例文字，没有读取当前图片或调用模型。
- 已有 AI 改图链路能够以当前展示资产作为 reference，运行时读取真实 `image-edit` 配置，并通过结果资产事务成功替换原槽位、失败保留原图。
- 项目禁止将完整 system/user/roleless Prompt、Base64、临时 URL 或 Provider raw response 持久化。

## Requirements

- 新增独立的 `image-text-recognition` 图生文 capability；模型配置按现有图生文类别接入，不复用商品卖点或场景规划的业务 Prompt。
- 用户点击“编辑文字”后立即打开浮层并显示骨架屏，同时把当前展示图片资产发送给执行时最新的真实图生文模型。
- 图生文模型返回按阅读顺序排列的文字项；每项包含稳定行标识、原文字和归一化位置框 `x/y/width/height`，运行时严格校验数量、非空文字、有限数值和边界范围。
- 识别成功后，每个文字项按行展示为可编辑输入框；浮层不得展示原始模型响应或隐藏 Prompt。
- 未识别到文字时，用全局 toast 提示“未识别到文字”，并关闭浮层。
- 识别失败时不得伪造默认文字；应展示明确的归一化错误，并允许用户安全退出或重试。
- 只有可重试错误显示“重试”；模型未配置、资产不可用等不可重试错误只显示安全错误和关闭入口。
- 用户没有修改任何识别文字时，“确认改字”按钮不可点击。
- 用户将某一行清空时，表示删除该位置文字；前端提交显式 `operation = "delete"`，图生图只擦除对应位置并自然补全背景，不得自动补写其它文字。
- 用户确认后，创建真实 `image-edit` 任务，输入当前展示图片、被修改文字的原值、新值及位置框；完整图生图 Prompt 只在 Rust 执行器内存组装。
- Rust 在 Provider 调用前重新严格校验 changed items，不能信任前端或此前 OCR 校验；空数组、重复行、字段冲突、无效文字或越界位置必须快速失败。
- 图生图成功后原子替换父任务稳定结果槽位；Provider 或归并失败时保留原图。
- 商品、服饰、场景实时结果和生成历史结果共用同一识别、编辑、提交、替换和错误处理链路。
- 跨 workspace 切换时，只有属于当前 workspace 的历史记录身份可参与识别和提交；否则使用该
  workspace 自己的当前展示记录。
- 提交标记按 record scope 和 operation token 隔离，并且生命周期长于单个 `PreviewCanvas` 组件
  实例；A → B → A 或画布卸载后重新挂载 A 时仍保持锁定，旧请求只能清除自己的标记。
- 浮层继续复用现有视觉风格；确认按钮移除积分 icon 和数字，只显示“确认改字”。
- 不新增数据库 schema、migration、第三方依赖或 Tauri 权限；不修改其它已确认 UI 视觉。

## Acceptance Criteria

- [ ] 当前图片作为唯一 reference 进入文字识别调用；前端→Tauri 识别 DTO 只含 `assetId`，SQLite、events 和前端 DTO 不包含 Base64、完整 Prompt、临时 URL 或 Provider raw response；仅 Rust→Provider 的内存请求可按既有适配器携带图片数据。
- [ ] 打开浮层立即显示可访问的骨架屏；识别完成前不能提交改字。
- [ ] 识别结果按行展示并携带通过 Rust 校验的归一化位置框。
- [ ] 未识别到文字时 toast 提示并关闭浮层，不保留空白或旧识别结果。
- [ ] 识别错误保留结构化 `code/message/retryable`；仅 `retryable = true` 显示重试入口。
- [ ] 未修改任何文字时确认按钮禁用；至少一项发生有效变化后启用。
- [ ] 清空识别文字会生成显式 delete change；非空变化生成 replace change，不靠空字符串在 Rust 中猜测操作。
- [ ] Rust 对改字 changes 做完整边界校验；非法输入返回 `IMAGE_TEXT_REWRITE_INPUT_INVALID`，且不会调用 Provider。
- [ ] delete 的内存 Prompt 明确只擦除对应 bbox 原文字、自然补全背景、不自动补写且不影响其它文字；该完整 Prompt 不进入持久层。
- [ ] 确认改字只提交发生变化的文字项及其位置，使用执行时最新的真实 `image-edit` 配置。
- [ ] 成功替换当前记录的原稳定槽位，失败保留当前图片；历史记录不会按重复 `imageId` 串写。
- [x] 跨 workspace 切换后，识别与提交仍绑定该 workspace 自己的当前展示记录；其它 workspace 的
      history ID 不得遮蔽它。
- [x] A、B scope 的提交标记相互隔离；A → B → A 或组件卸载后重新挂载 A 时仍锁定，任一
      `finally` 只解除自身 token。
- [x] 商品、服饰、场景和三类历史入口均有自动化覆盖。
- [ ] mock provider 不得产生可展示或可归并的识别/改字假结果。
- [x] 前端定向与全量测试、Rust 定向与全量测试、`make check`、`cargo fmt --check` 和 `git diff --check` 通过。

## Out of Scope

- 通用 OCR 搜索、复制、翻译、字体选择、文字样式编辑或画布内拖拽定位。
- 自动修复未被用户确认的文字、Logo、图案或非文字内容。
- 为图片保存永久 OCR 索引或新增数据库表。
