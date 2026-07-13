# 实施清单

1. 扩展前后端 model capability：新增 real-provider-only 的 `image-text-recognition`，接入图生文
   类别、provider allowlist、默认配置解析和 capability 测试。
2. 新增 `image_text_recognition.toml` 和 `result_image_text_rewrite.toml`，在 Prompt Registry 中
   加载并补版本、变量、输出格式和 Prompt 注入防护测试。
3. 扩展 `AiAssistPort`、runtime local adapter、Tauri command 和 Rust service：只接收
   `assetId`，读取 active generated asset，调用当前真实图生文配置并返回规范化 DTO；识别请求
   显式使用 12k 输出预算，Provider 响应异常保留为安全、可重试的结构化错误。
4. 在 Rust 增加 OCR 输出解析/校验：空数组、100 行上限、500 字上限、稳定 line ID、有限数值和
   归一化 bbox；Prompt v2 使用 `left/top/right/bottom` 并转换成内部严格 `x/y/width/height`，旧版
   legacy 坐标只在整批可一致判定为 `x/y/right/bottom` 时统一转换；任何单项 bbox 缺失、类型、
   范围、edge 顺序或语义不可靠都安全忽略并保留其它行；command 返回结构化
   `{code,message,retryable}` 错误，runtime adapter 统一转换；
   `IMAGE_TEXT_RECOGNITION_OUTPUT_INVALID` 等错误不得包含 raw 输出；runtime adapter 必须保留
   `code/message/retryable`，不能退化成普通字符串错误。
5. 先补前端失败测试，再把 `PreviewCanvas` 静态示例改成
   `closed/recognizing/ready/error/submitting` 状态机；加入可访问骨架屏、request ID 隔离、空结果
   toast + 关闭、失败重试、无修改禁用、recognition request ID 与 dialog session ID 隔离。
6. 定义 `replace/delete` changes：trim 后空值显式生成 delete，非空变化生成 replace，只提交有效
   changed items；确认按钮只显示“确认改字”。
7. 泛化 App 编排：商品、服饰、场景和历史都以当前 workspace 的精确展示 record + 当前 asset
   调用识别；其它 workspace 遗留的 history/active ID 不得参与解析。提交前复核 asset 未变化，
   否则拒绝 stale OCR。
8. 新增 `result-image-text-rewrite` image-edit 任务输入，在执行器内从 TOML 组装结构化 Prompt；
   当前图片作为唯一 reference，Prompt/Base64/raw response 不落库。Rust 重新验证 changes 非空且
   不超过 100 项、line ID 唯一、文字长度、replace/delete 字段互斥以及 bbox 边界；非法输入返回
   `IMAGE_TEXT_REWRITE_INPUT_INVALID` 且不调用 Provider。bbox 仅作为空间提示，图生图必须使用
   `originalText` 唯一匹配；歧义或找不到时不修改，不得擦除整个近似框。
9. 复用 `pollGeneratedImageReplacement`、`replaceResultImage` 和未归并任务清理；成功更新精确
   record，失败保留原图和用户编辑内容。未归并 `result-image-text-rewrite` 通过现有 `deleteTask`
   解除子任务输入/输出关系并软删除 orphan replacement asset，保留任务/事件审计；普通任务继续
   hide-only。结果图编辑内部 kind 在 create/retry 边界强制绑定外层 `image-edit`。
10. 补自动化矩阵：
    - 骨架、成功逐行、空结果 toast/关闭、可重试错误显示重试、不可重试错误只允许关闭；
    - 关闭/切目标/切历史/`detailImages` 变化后的识别晚响应不得回填；
    - 提交中 X、取消和遮罩关闭禁用；无关 `detailImages` 更新不得关闭当前浮层；A 提交后任何晚到
      success/error/finally 不得关闭、toast 或覆盖 B 浮层；A → B → A 或卸载后重新挂载 A 时仍保持
      提交锁，且 A、B 任一 `finally` 只能解除自己的 operation token；提交期间 source asset 变化后
      失败不得恢复旧 ready 状态；
    - 无变化禁用、replace/delete、只提交 changed items、提交失败保留编辑；
    - 商品/服饰/场景实时结果与三类历史、重复 imageId、stale asset；打开 A workspace 历史后切换
      到 B workspace 时，A 遗留 history ID 不得遮蔽 B 自己的当前展示 record；
    - 有效行夹着 bbox 缺失/类型/范围/edge 顺序错误时只跳过坏项并保持文字与框对应，全部位置
      无效时返回空 items；JSON/顶层/items/text 合同错误仍整批失败；
    - bbox NaN/越界/零面积/超量/长文本、Prompt 注入、安全持久化、mock 拒绝；
    - 空 changes、重复 line ID、replace 空值/同值、delete 携带 replacement、错误 DTO 分类；
    - delete 内存 Prompt 只擦除目标 bbox、自然补背景、不自动补字或影响其它文字，且 Prompt 不落库；
    - Provider 成功/归并失败保留原图。
    - 未归并改字任务删除后子任务 input/output 关系为 0、replacement asset 已软删除、父槽位与
      source asset 保持 active；父槽后续替换/删除时再按引用感知规则回收旧 source，普通任务删除
      仍保留原关系；错误外层 kind 在 create/retry 前拒绝。
11. 同步 local-first plan、M7 checklist、场景技术方案、AGENTS 长期结果卡规则和 Trellis 前后端
    code-spec；不追改历史归档计划。
12. 定向验证后运行：
    - `npm --prefix desktop test -- --run src/app/App.test.tsx`
    - OCR/改字相关 Rust 定向测试
    - `make test`
    - `cargo test --manifest-path desktop/src-tauri/Cargo.toml -- --nocapture`
    - `make frontend-build`
    - `make cargo-check`
    - `make check`
    - `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check`
    - `git diff --check`
13. 最终复审真实 Provider、Prompt/图片泄漏、history record 作用域、stale response、Windows 路径
    和无关 diff；真实 OpenAI/火山文字定位与改字保留为付费手工验收。

## Rollback Points

- capability/Port 尚未接 UI 前可整体回滚，不影响既有图片生成与 AI 改图。
- UI 状态机接入后若识别不可用，入口应显式报 capability unavailable，不得恢复静态示例文字。
- 第二阶段失败只产生隐藏/可清理的派生任务，父任务结果槽位和当前图片保持不变。
