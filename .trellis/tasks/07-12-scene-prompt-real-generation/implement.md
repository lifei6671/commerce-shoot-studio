# 实施清单

1. 新增四份 TOML，迁移 Skill 的模板路由、规划、模板、Style Lock、H/D 序列、信息图、Anti-AI、证据和最终忠实约束。
2. 扩展 Prompt Registry 与独立 catalog loader，补配置、选中模板和占位符测试。
3. 扩展 capability/provider 矩阵，加入 `scene-prompt-planning`，调整 Scene image category 和 OpenAI endpoint。
4. 在 LocalTaskExecutor 增加 Scene 规划输入渲染、输出解析/校验和 Scene itemized 图片执行。
5. 接入参考资产、Provider 尺寸、部分失败、取消、落盘、重试归并和历史恢复。
6. 前端删除 Scene fake timers，接 create/run/poll，映射规划输出和真实 output assets，并接结果操作。
7. 更新场景技术方案、local-first 方案和 M7 checklist，只记录已验证状态。
8. 运行定向测试，再运行 `make test`、`make frontend-build`、`make cargo-check`、`make check`、`git diff --check`；复审安全、Windows、状态竞争和无关 diff。
9. 将 H/D 输出模式改为 TOML 驱动的转化叙事与模板推荐，固定 code/purpose 但不建立模板
   allowlist；补 conversionDriver、详情九屏、25 模板可达和完整包合理复用测试。
10. 删除场景模板、模板分类和视觉方向选择；补充信息改为必填；继续校验空 Prompt 和固定图片包合同，并收窄 multi-product 与误导性场景文案。
11. 为四个输出内容标题增加数量与紧邻的 Tooltip icon，支持鼠标悬停和键盘聚焦，并通过 Portal 避免滚动面板裁剪；补交互测试。
12. 按原 Skill 收口职责：规划阶段应用模板/variant/品类并生成摘要与完整 Prompt；审核页只显示摘要；generation TOML 只做薄执行。
13. 为 25 个模板配置生图专业身份；第三步只发送当前身份、完整场景 Prompt、参考图和尺寸，不暴露流程步骤。
14. 升级 routing/planning/catalog 为 v2/v9/v4，generation 保持 v6：同一 prompt-plan
    任务先用精简 index 路由模板，再只注入选中模板完整规则并在该模板内选择 variant；修正
    variant `base` 语义与模板复用规则，固定 single visual driver，并恢复原 Skill 的多角度、景别、
    背景节奏、分图型占比、文字密度与缺失事实边界。
15. 场景实时结果与历史恢复均补首位只读原图卡，保持生成数量和历史缩略图只计算输出
    资产；共享相册按图片固有比例展示主图并移除图片外部浅色留边。
16. 路由结果只保留在 executor 内存；routing 失败、非法或调用间取消时不执行 planning，
    SQLite、task events、诊断和前端 DTO 不得出现路由 JSON、raw Prompt 或 raw Provider 内容。
17. 补 routing → planning 顺序、选中模板最小注入、冻结路由一致性、必填补充信息、失败短路、
    取消与安全持久化测试；完成定向和全量验证前不标记相关 checklist 完成。
18. 补 routing v2 / planning v9 能力对齐：25 模板均可在证据充分时命中，H/D 推荐模板不作
    白名单，full-pack 可合理复用；模板视觉语言优先于视觉方向基线，详情职责以及镜头、背景、
    服装与字体规则按所选模板和主体类型条件化执行。
19. 精简 planning v9 system rules，只保留事实、模板优先、Style Lock、variant/base、自包含
    Prompt、摘要和安全注入；planning 输入仅保留 code/purpose 与冻结模板，结构合同由
    Rust/output format 校验。自动化合同已验证，真实 Provider 语义表现仍待人工验收。
20. 升级 routing/planning/generation/catalog 为 `v3/v10/v7/v5`：区分交付物形式与投放渠道，
    恢复 infographic 的完整可执行版式、4-6 个证据型 callout 与文化器物事实边界；旧版本
    任务仍可查看，但重试必须重新规划。真实 Provider 语义表现仍待人工验收。

## 2026-07-12 自动化验证记录

- 原 Skill 模板目录与迁移 catalog 均为 25 项，ID 无缺失或多余，源 variant ID 均有迁移规则。
- 前端全量：26 个文件、249 项通过；Scene retry lifecycle 定向测试 5/5 通过。
- Rust `provider_adapter`：46/46 通过；Rust 全量：182 个 lib tests 及全部 integration tests 通过。
- planning v9 `system_rules` 从 2981 字、68 行精简为 1372 字、23 行；最终 planning Prompt
  保留冻结 `routedTemplateId`、code 和 purpose，不包含 `recommendedTemplateIds`。
- `make test`、`make frontend-build`、`make cargo-check`、`make check`、`cargo fmt --check`、
  `git diff --check` 均通过，`npm audit --audit-level=high` 为 0 个高危漏洞。
- 未调用真实付费 Provider。25 模板基于真实参考图和补充信息的语义路由、证据门槛及生成效果
  仍需人工 A/B 验收，相关 checklist 保持未完成。

## 2026-07-13 信息图 Prompt 修复验证

- routing/planning/generation/catalog 升级为 `v3/v10/v7/v5`，前后端冻结版本已同步。
- 新增渠道与交付物优先级、infographic 完整度、文化器物事实边界和选中模板隔离回归。
- `make check` 通过：250 项 Vitest、frontend build、cargo check、npm audit 0 个漏洞。
- Rust 全量通过：184 项 lib tests 及全部 integration/doc tests；`cargo fmt --check`、
  `git diff --check` 通过。
- 未调用真实付费 Provider；同一参考图的 v10 语义路由与最终视觉效果仍待人工 A/B 验收。

## Rollback Points

- Prompt 配置/loader、capability、executor、前端接线按上述顺序保持可独立回退。
- 不修改 schema/lockfile/权限，回滚无需数据迁移。
