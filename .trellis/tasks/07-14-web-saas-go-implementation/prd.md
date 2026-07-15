# Web SaaS Go 实施

## Goal

按照 `docs/2026-07-14-web-saas-go-implementation-task-checklist.md` 的依赖拓扑，
分阶段交付 Web 用户端、Web 管理端、Go Remote Runtime、MySQL、Blob、Provider、
进程内 Worker 和商用加固，并保持 Desktop Local-first 能力与状态不被误改。

## Requirements

- 以 DS0 → G0 → G0.5 → G1 → G2/G3 → G4 → G5/G6 → G7 的顺序推进。
- 每个可独立验收 Gate 或切片使用子任务承载，父任务负责跨任务约束和最终集成审查。
- 代码使用完善、准确的简体中文注释；方案分歧先给推荐方案并等待用户选择。
- `/admin` 与 `/app` 新增 SaaS 页面使用 Ant Design；商品、服饰、场景等 Web 核心工作台
  使用独立 `web/` shadcn/ui 展示层重新做响应式适配与视觉美化。两套组件体系隔离主题
  和 CSS，不复用 Desktop UI/CSS/Tauri adapter，Desktop 视觉保持不变。
- 每次 HTTP 请求在发起前把脱敏入参摘要与核心参数写入日志 context，结束时写结构化日志；
  统一基于 `slog`，使用已经项目所有者授权的 logit v1.0.0 作为 Handler。
- MySQL、Redis、Session 和验证码等启动必需凭据写部署配置文件；S3、SMTP、Provider
  等非启动型配置及密钥写入 `system_configs` 的业务固定 key 完整 JSON，不增加
  `value_type`、独立凭据记录或密钥表，也不使用环境变量或 Secret Manager。
- 图片生成积分使用管理员在 `model_configs.points_per_image` 上配置的**每张图片积分单价**，与 Provider
  真实货币成本解耦。创建 run 时按每个计划结果槽的候选模型最高单价之和预留；每张图片
  完成校验、Blob 提交并被稳定结果槽采纳后，按实际产出模型在 execution plan 中冻结的
  单价独立消费一次并释放该槽价差。同一 run 可产生多条槽级消费：A 单价 3 产出 2 张、
  B 单价 5 产出 1 张时合计消费 11 积分。失败、取消或 `result_uncertain` 只释放尚未交付
  槽的未消费预留；已交付图片不退款。晚到结果不交付、不补扣，只进入平台内部对账和
  成本核销。
- 遵循 TDD、最小改动、安全脱敏、清单状态证据和仓库质量门禁。

## Child Task Map

- `07-14-web-saas-ds0-decisions`：冻结 DS0-01～DS0-10 决策与授权。
- `07-15-web-saas-g0-t01-go-module`：建立 `server/` Go Module、精确工具链合同与最小进程
  入口；完成后才允许并行推进 G0-T02 / T03 / T04 / T09。
- 后续 G0～G7 子任务在各自前置依赖关闭后按独立验收边界创建。

## Acceptance Criteria

- [ ] DS0～G7 所有纳入一期的任务均有实现、验证、验收和可追溯证据。
- [ ] Web 用户端、管理端和 Go Remote Runtime 完成清单定义的完整业务闭环。
- [ ] 安全、并发、故障恢复、可观测性和商用门禁全部满足清单要求。
- [ ] Desktop Local-first 既有行为、视觉与 M0～M7 状态未被误改。
- [ ] 父任务完成最终跨层审查、文档同步和发布前验收。

## Out of Scope

- 清单明确排除或经 DS0-10 批准后置的能力。
- 未经确认的支付、团队、BYOK、多副本及其他扩展范围。
