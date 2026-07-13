# 实施计划：精简 App 并优化首屏加载

## 1. 建立回归保护

- 记录现有构建基线与 chunk 数量。
- 补默认商品首屏和非首屏工作区异步进入的最小测试。
- 确认测试失败仅来自尚未建立 lazy 边界或同步断言不兼容。

## 2. 抽离稳定纯逻辑

- 抽 generation/history 共享类型，更新直接 import。
- 抽商品 Prompt、结果计划和 listing copy 纯函数。
- 抽历史恢复、结果合并和状态映射纯函数。
- 迁移对应测试 import，不保留无调用价值的旧 wrapper。

## 3. 抽离工作区展示组件

- 提取商品、服饰、场景工作区的配置区与画布组合。
- 保持现有 DOM、props、hidden 挂载和事件回调语义。
- 避免修改当前 dirty `PreviewCanvas.tsx` 的行为。

## 4. 建立首屏分包

- 对服饰、场景、模型配置和设置工作区使用直接动态 import。
- 使用轻量、无视觉跳变的 Suspense fallback。
- 保持启动历史恢复不依赖 lazy 模块。

## 5. 验证与复审

- 运行受影响的 App、BootstrappedApp 和 feature 测试。
- 运行 `make frontend-build`，记录入口和异步 chunk 大小。
- 运行 `git diff --check`。
- 对 `App.test.tsx` 和 `PreviewCanvas.tsx` 做 dirty-tree 保护复核。
- 自 review UI/状态/历史/敏感信息/Windows 风险；本次无文件系统路径变更时说明
  Windows 风险不适用。

## 回滚点

- 纯函数迁移、展示组件拆分、lazy 分包分别保持独立 diff 边界。
- 任一步出现行为回归时，只撤销本任务对应新增文件和局部 import，不触碰用户原有
  未提交修改。

## 完成证据

- `App.tsx`：4,911 行降至 3,309 行，减少 1,602 行（32.6%）。
- 入口 JS：540.68 kB / gzip 158.73 kB 降至 444.48 kB / gzip 133.96 kB；
  原始体积减少 96.20 kB（17.8%），不再触发 Vite 500 kB 警告。
- 生成 7 个业务异步 chunk：服饰工作区/画布、场景工作区/画布、生成记录、模型配置、
  设置；商品首屏保持同步。
- `make test`：29 个测试文件、284 项测试全部通过。
- `make frontend-build`：TypeScript 与 Vite 生产构建通过。
- `git diff --check`：通过。
- 生成记录流式分页定向测试 4/4 通过；前端全量更新为 30 个测试文件、288/288 通过。
- 两轮并行复审发现的历史筛选挂载、测试预热和混合支持模块问题均已修复；最终复审未发现
  循环依赖、静态回流、敏感信息或 dirty-tree 覆盖。

## 文档同步结论

- 本任务更新 Trellis 任务 PRD、设计与验证证据，并在实施清单追加生成记录
  流式分页的验收证据。
- README、长期方案和场景技术计划的产品行为、Runtime 合同和命令均未改变，
  因此本任务不更新这些文档。
- 现有三份 `docs/` 修改属于用户并行的图片下载功能，本任务未覆盖或混入。
- History checklist 仅追加流式分页验收证据，不标记 M3-T06 完成。
