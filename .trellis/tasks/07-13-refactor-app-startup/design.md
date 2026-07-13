# 技术设计：精简 App 并优化首屏加载

## 设计边界

本次采用“先纯逻辑、再展示边界、最后分包”的顺序。`App` 继续拥有跨工作区状态、
任务取消引用和历史恢复生命周期，避免一次重构同时改变状态所有权与加载语义。

## 模块拆分

1. 将生成结果、历史记录等被多个模块消费的类型移到 feature 级 `types.ts`，组件只
   负责 re-export 或直接导入，避免纯逻辑反向依赖 React 组件。
2. 将商品详情规划、Prompt 拼装、listing copy 解析等纯函数移到
   `features/generation/lib/`。
3. 将历史任务反序列化、结果资产合并、stale 状态映射等纯函数移到
   `features/history/lib/`。
4. 将商品、服饰、场景的配置区和画布组合抽成无状态工作区展示组件。首轮通过 props
   保持状态所有权不变，不提前抽 controller hook。
5. 使用 `React.lazy(() => import("明确模块路径"))` 加载非默认工作区。默认商品
   工作区保持同步；工作区入口不经 barrel，确保 Vite 能形成独立 chunk。

## 状态与兼容性

- 商品配置区当前通过 `hidden` 保持挂载；拆分后继续渲染并隐藏，不改为条件卸载。
- 服饰、场景、模型和设置仅在用户首次进入时加载；加载完成后 React 保留当前树的
  既有状态语义。
- 历史恢复 effect 仍随 `App` 启动执行，不跟随历史弹窗 lazy chunk。
- 历史弹窗首次打开后保持挂载，仅由 `open` 控制显隐，避免关闭再打开时丢失筛选状态。
- 不改变 `GenerationRecord`、`GeneratedDetailImage` 等类型的结构，仅改变定义位置。
- 若既有测试从 `App.tsx` 导入纯函数，优先迁移测试到新模块；生产代码不保留无价值
  兼容壳。
- 测试环境不预热 lazy chunk；工作区导航回归使用异步查询等待真实动态 import，另用
  可控 Promise 精确测试 Suspense fallback 与异步解析过程。

## 复审后的最终边界

- `features/history/lib/generationHistory.ts`：历史任务反序列化、重试结果归并等纯逻辑。
- `features/generation/lib/generationResultState.ts`：生成结果状态、资产输出映射和轮询辅助。
- `app/lib/generationInputAssets.ts`：输入资产导入与 Runtime IO。
- `app/lib/generationTaskPersistence.ts`：持久化任务删除与失败传播日志。
- `features/clothing/lib/clothingGeneration.ts`：服饰规划输出解析和历史摘要。

这样避免把 `App.tsx` 的单体逻辑整体搬到另一个混合工具文件。

## 性能策略

单纯移动源码不会改变首包。本次只把真正非首屏的工作区 UI 设为动态 import，并通过
构建产物验证：入口 chunk 应小于 540.68 kB，且生成多个异步 chunk。暂不添加
`manualChunks`，避免用配置强行拆包而没有真实按需加载。

### 生成记录流式分页

- 保留 App 启动时的完整历史任务恢复，因为父任务、listing-copy、单图重试和未完成任务
  续跑需要跨 task 归并，不能把 10 个 raw task 等同于 10 条业务记录。
- 弹窗按筛选结果先渲染 10 条，底部哨兵进入 96px 预加载区或滚动接近底部时追加
  下一批 10 条；首批未撑出滚动条时，哨兵会继续补批次，避免后续记录不可达。
- 哨兵使用 `IntersectionObserver`，滚动兜底使用 passive listener；筛选切换同步重置
  批次和滚动位置。
- 缩略图使用原生 lazy loading 与异步解码。本轮收益是减少弹窗首次打开的 DOM 和图片
  解码，不宣称减少启动期 SQLite / IPC IO。

## 风险与回滚

- `App.test.tsx` 已有下载相关未提交修改，只做局部测试适配并逐项复核 diff。
- lazy import 会把同步查询变为微任务后的异步渲染，相关测试改用 `findByRole`。
- 若工作区拆分导致 props 过多或循环依赖，停止在纯函数和直接 lazy 页面边界，不引入
  大型 context/reducer 作为兜底。
- 每个拆分阶段都保持可独立回退；不修改依赖、配置或后端 contract。
