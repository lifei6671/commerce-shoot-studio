# 技术设计

## Architecture

链路拆成一个无历史副作用的识别调用和一个可追踪的结果资产任务：

```text
当前结果资产
  → AiAssistPort.recognizeImageText(assetId)
  → Rust 读取 workspace 资产
  → image-text-recognition 真实图生文模型
  → Rust 校验并规范化文字行 + bbox
  → PreviewCanvas 逐行编辑
  → GenerationPort.createTask(kind=image-edit)
  → result-image-text-rewrite
  → 当前结果资产 + changed items
  → 真实图生图模型
  → replaceResultImage 原子替换原槽位
```

第一阶段不创建 `generation_task`，避免一次临时 OCR 操作污染生成历史。新增
`AiAssistPort.recognizeImageText`，其输入只接受 workspace 资产 ID，不接受前端路径、URL 或
Data URL。第二阶段继续复用现有 `GenerationPort`、后台执行器、Provider 并发控制、generated
asset 落盘和稳定槽位替换事务。

## Public Contracts

### Image text recognition

```ts
type RecognizeImageTextInput = {
  assetId: string;
};

type ImageTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RecognizedImageTextItem = {
  id: string;
  text: string;
  box: ImageTextBox;
};

type ImageTextRecognitionResult = {
  items: RecognizedImageTextItem[];
};

type ImageTextRecognitionError = {
  code: string;
  message: string;
  retryable: boolean;
};
```

`AiAssistPort` 新增：

```ts
recognizeImageText(input: RecognizeImageTextInput): Promise<ImageTextRecognitionResult>;
```

Tauri command 使用 owned DTO，按当前 workspace 解析 `assetId`，只允许 active generated
图片资产。command 返回可序列化 `Result<ImageTextRecognitionResult, ImageTextRecognitionError>`，
注册到 `generate_handler![]`，不新增 capability permission。至少稳定区分
`MODEL_CAPABILITY_UNAVAILABLE`、`IMAGE_TEXT_RECOGNITION_OUTPUT_INVALID`、资产错误和既有归一化
Provider 失败；错误只含安全 message，不含 raw response。runtime local adapter 在边界统一转换
为保留 `code/message/retryable` 的 typed runtime error，组件不得解析字符串前缀或退化成普通
字符串 Error。

### Text rewrite task

```ts
type ResultImageTextChange =
  | {
      lineId: string;
      operation: "replace";
      originalText: string;
      replacementText: string;
      box: ImageTextBox;
    }
  | {
      lineId: string;
      operation: "delete";
      originalText: string;
      box: ImageTextBox;
    };
```

`image-edit` task input 使用 `kind = "result-image-text-rewrite"`，并保留
`parentTaskId/targetImageId/imageNo/sourceAssetId/changes`。当前图片通过唯一
`inputAssets(role=reference)` 关联。`generation.rs` 的 replacement allowlist 加入该内部 kind。
所有 `result-image-resize`、`result-image-rewrite`、`product-detail-image-rewrite` 和
`result-image-text-rewrite` 内部 kind 都必须与外层 `GenerationTaskKind::ImageEdit` 配对；create
和 retry 边界在写入新任务前拒绝不一致组合，已有错误历史仍可读取但不能继续复制非法任务。
retry 只复核该类型配对，不追溯套用新建任务的敏感字段/结构规则，确保外层类型正确、但保留旧版
内存 Prompt 快照的历史图片编辑仍可重试。

### Rewrite input validation

`generation_tasks.input_json` 是执行器边界的不可信输入。Rust 在构造 Provider Prompt 前规范化并
校验 `changes`：

- 数组必须非空且最多 100 项。
- `lineId` trim 后非空且唯一；`originalText` trim 后非空且不超过 500 字。
- `replace` 必须携带 trim 后非空、不超过 500 字且与规范化原文不同的 `replacementText`。
- `delete` 禁止携带 `replacementText`；不能靠空字符串推断操作。
- 两种操作都重新执行 bbox finite、0..1、正面积和不越界校验。
- 任一项非法时返回 `IMAGE_TEXT_REWRITE_INPUT_INVALID`，不得调用 Provider，也不得创建结果资产。

`result_image_text_rewrite.toml` 对 delete 明确要求：bbox 只用于辅助定位，只擦除唯一匹配的
原文字实际字形及原占位，使用邻近背景自然补全，不得自动补写或把整个近似框当作蒙版。人物、
主体、Logo、图案、布局和其它文字的保真约束适用于匹配字形及原占位之外或未指定区域。OCR
原文、新文及位置均作为结构化数据而非指令处理。

## Model Capability and Prompt Configuration

- 新增 `image-text-recognition` capability，category 为 `image-to-text`。
- 前端 capability union、Rust `CAPABILITIES`、provider allowlist、模型配置页图生文类别和测试
  同步更新。
- capability 标记为 real-provider-only；当前默认是 `mock-local` 时，按现有同类别规则解析已测试
  的真实图生文配置，否则返回 `MODEL_CAPABILITY_UNAVAILABLE`。
- OpenAI 与火山均复用现有 Responses `input_image + input_text` 适配器，不新增 Provider。
- 新增内置 `image_text_recognition.toml` 与 `result_image_text_rewrite.toml`。模型行为、事实保真、
  Prompt 注入防护和输出格式要求放在 TOML；Rust 只做选择、变量渲染、结构校验与调用。
- system/user/roleless Prompt、临时 URL 和 Provider raw response 只存在于内存及既有显式 debug
  安全边界，不进入 SQLite、task events、前端 DTO 或导出包。前端→Tauri 识别 DTO 只含
  `assetId`；图片 Base64 仅可在 Rust 读取 workspace 资产后进入 Rust→Provider 内存请求。
- 识别请求显式使用 `maxOutputTokens = 12000`，覆盖最多 100 行结构化 JSON 的常见密集图片，
  不依赖网关默认的 2000 tokens。
- 模型配置缺失仍返回不可重试的 `MODEL_CAPABILITY_UNAVAILABLE`；Provider 响应读取、解析或
  结构归一化异常返回不含 raw response 的 `IMAGE_TEXT_RECOGNITION_PROVIDER_UNAVAILABLE`，并允许重试。

## Recognition Normalization

模型输出仅作为外部不可信输入。OCR Prompt v2 要求模型返回无歧义的归一化边界
`left/top/right/bottom`，Rust 转换成 Public Runtime DTO 使用的 `x/y/width/height`。Rust 忽略模型提供的行 ID，按返回顺序生成
`line-001...line-100`；不按 `x/y` 重新排序，避免破坏多栏或竖排阅读顺序。

校验规则：

- `items` 必须为数组，允许空数组。
- 最多 100 行；每行 trim 后文字非空且不超过 500 个 Unicode scalar values。
- v2 `left/top/right/bottom` 必须是有限的 `0..1` 数值，并满足 `left < right`、`top < bottom`；
  运行时确定性转换成严格合法的 `x/y/width/height`。
- 若模型仍返回旧版 `x/y/width/height`，四个字段本身仍必须有限且分别位于合法范围。只要整批
  legacy item 中存在 xywh 越界，且所有 legacy item 都满足 `x < width`、`y < height`，运行时才把
  后两个字段统一解释为 `right/bottom` 并转换，避免逐项猜测导致首项被放大。无法形成一致模式的
  越界 legacy item 直接忽略并记录脱敏分类；合法 xywh item 仍保留，全部忽略时返回空 items。
  不猜测像素、百分比或负数坐标，也不把不可靠范围扩展到图片边缘。
- 进入前端和改字任务的最终 bbox 必须严格满足 `x/y ∈ [0,1]`、`width/height ∈ (0,1]`、
  `x + width <= 1`、`y + height <= 1`。改字执行器不得继承 OCR Provider 边界的模糊容忍。
- 单项文字有效但 bbox 缺失、类型错误、非有限、成员越界、edge 顺序错误或 legacy 语义歧义时，
  只记录脱敏 `item_skipped` 并忽略该项；保留项继续按 Provider 阅读顺序返回并重新生成连续 line
  ID，全部忽略时返回空 items。JSON、顶层结构、items 数组/数量、item 对象或 text 合同非法仍
  返回 `IMAGE_TEXT_RECOGNITION_OUTPUT_INVALID`，不得把 raw 模型片段写入错误或诊断。
- 接受纯 JSON，或仅由一个完整 `json` Markdown 围栏包裹的 JSON；不得从任意说明文字中猜测
  截取对象。拒绝时只记录安全的失败类别、行索引、字段名、输出字符数和是否以围栏开头，不记录
  OCR 原文、坐标值或 Provider raw response。

空 `items` 是成功识别但没有文字，不是任务失败。`PreviewCanvas` 仅在 recognition request、
dialog session 与 source asset identity 仍有效时调用 App 的全局 warning toast 回调提示
“未识别到文字”，随后清空识别状态并关闭浮层；失效请求的空结果直接忽略。

OCR 位置允许是能够区分相邻文字行的保守近似区域。改字 Prompt v2 把 bbox 作为空间提示，
  `originalText` 作为首要视觉锚点：只有在框内或紧邻范围唯一、可靠匹配到同一视觉行时才修改；
找不到、重复且无法消歧、与其它 change 冲突时保持该项不变。replace/delete 只修改匹配文字的
实际字形和原占位，不得把整个近似框当作擦除或重绘区域，也不得以“位置框之外”为硬边界阻止
修复落在近似框边缘的同一匹配字形。

## UI State Machine

`PreviewCanvas` 新增两个明确 handler：

```ts
onRecognizeImageText(image)
onImageTextRewrite(image, changes)
```

状态机：

```text
closed → recognizing → ready → submitting → closed
                  ↘ recognition-error → recognizing / closed
                         ready ↔ editing
```

- 点击“编辑文字”同步打开浮层并进入 `recognizing`。
- 识别中显示 4-6 行与输入框同高的 `animate-pulse` 骨架；容器设置 `aria-busy=true`，并提供
  `role=status` 的“正在识别图片文字”文本。
- 使用独立 recognition request ID 与 dialog session ID。关闭浮层、切换目标、切换历史，或
  当前目标的 source asset/status 变化都会使旧识别请求失效；无关卡片的 `detailImages` 更新不得
  关闭当前浮层，晚到响应不得重开或覆盖新浮层。
- 识别失败保留浮层并显示归一化安全错误，不填充示例文字。仅 `retryable = true` 时显示并启用
  “重试”；`MODEL_CAPABILITY_UNAVAILABLE`、不可恢复资产错误等 `retryable = false` 时只显示关闭入口。
- ready 时按返回顺序展示输入框，key 使用 Rust 分配的稳定 line ID。
- 比较时使用 `trim()` 后的原值与新值。没有有效变化时确认按钮禁用。
- 新值 trim 后为空时生成显式 `delete`；否则生成 `replace`，只提交发生变化的行。
- “确认改字”无 icon 和数字。提交中按钮 disabled + `aria-busy`，保留浮层内容，并禁用 X、
  取消按钮和遮罩关闭，避免用户误以为已取消 Provider。
- 提交的 success/error/finally 回调必须同时校验 history record scope、dialog session ID、target
  image ID 和识别时的 source asset ID。即使未来允许关闭或历史切换，晚到结果也只能让 App 完成精确 record 的资产
  写回，不得关闭、覆盖或改写当前新浮层。
- 改字失败只在当前 dialog identity 与当前 source asset 仍匹配时调用全局 error toast，保留当前
  session 的浮层和用户修改以便重试；旧 session 的失败不得提示到新浮层。提交期间 source asset
  已变化时关闭旧浮层并提示重新识别；成功后仅关闭同一 session 的浮层。
- 提交标记按 `record scope + image ID + operation token` 独立保存在可订阅、且生命周期长于
  `PreviewCanvas` 组件实例的 store 中。scope 切换或画布卸载只关闭当前浮层，不得清理旧 scope
  的提交标记；A → B → A 或卸载后重新挂载 A 时仍保持锁定，直到旧 A 请求的 `finally` 只移除
  自己的 token。

## History and Stale-Asset Safety

- 仅当 `historyViewingRecordId` 指向当前操作 workspace 的 record 时才采用；否则使用该 workspace
  自己的当前展示 record。不得复用其它 workspace 的全局 history/active ID，也不得按 workspace +
  image ID 搜索其它历史。
- history viewing identity 按 workspace 保存；结果查看布局和生成记录浮层的 active row 都从当前
  workspace 的精确 displayed record 推导，不能继续使用最后一次跨 workspace 打开的全局 record ID。
- 识别结果绑定打开时的 `sourceAssetId`。确认前再次解析当前 record；如果当前展示资产已被
  resize、retry 或其它 rewrite 替换，则拒绝提交并提示“当前图片已变化，请重新识别文字”。
- Provider 成功但 replacement lineage 校验失败时清理未归并派生任务并保留原图。现有
  `deleteTask` 对未归并 `result-image-text-rewrite` 执行派生任务清理：保留任务与事件审计，解除该
  子任务 input/output 关系、隐藏任务并软删除已无可见引用的 replacement asset；普通任务删除仍
  保持 hide-only 语义。
- 直接清理未归并改字任务时，source input 仍由父任务当前 output relation 持有，因此不能无条件
  软删除 input asset；父槽后续发生替换或删除时，由该事务在清理旧派生 relation 后对旧 source
  执行引用感知软删除。

## Compatibility and Non-goals

- 商品、服饰、场景实时结果和三类历史入口共用同一个 `PreviewCanvas` 状态机。
- source-image、listing-copy、failed 或 generating 卡片不显示文字编辑入口。
- 不新增 OCR 永久索引、数据库 schema、migration、依赖、Tauri 权限、文字拖拽、字体/样式选择、
  翻译或新增未识别文字。
- 旧历史结果仍可查看；只要当前 output asset 可解析即可启动新的识别。

## Operational Risks

- bbox 是模型估计，真实 Provider 对小字、竖排、多栏、重复文字的定位精度必须手工验收。
- 识别 command 关闭后无法取消已发出的 Provider HTTP 时，前端仍必须丢弃晚到结果；该调用不写
  history，因此不会出现可见 orphan task。
- OCR 原文和用户新文都按数据处理，Prompt 配置必须明确禁止把其中内容解释为指令。
