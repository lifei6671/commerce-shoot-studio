# 商拍工坊 Web SaaS Go 实施任务清单

> 日期：2026-07-14
>
> 来源方案：`docs/2026-07-14-web-saas-go-technical-plan.md`
>
> 目标：把 Web SaaS Go 技术方案拆成按依赖和优先级排序、可认领、可标记、可验证、可验收的实施任务。
>
> 范围：仅规划 Web 用户端、Web 管理端、Go Remote Runtime、MySQL、Blob、Provider、进程内 Worker 和商用加固；不修改 Local-first `M0 -> M7` 的完成状态。
>
> 当前状态：方案拆解完成，所有实施任务尚未开始。
>
> 任务规模：100 个唯一任务（10 个决策门禁 + 90 个实施/验收任务）。

## 1. 使用规则

### 1.1 排序规则

本文档中的任务顺序已经按以下规则排序：

1. 先满足依赖拓扑，前置任务未完成时不得开始下游任务。
2. 同一依赖层内按 `P0 -> P1 -> P2` 排序。
3. 同一优先级内按任务编号排序。
4. 标注“可并行”的任务可以由不同负责人同时认领，但不得并发修改同一合同、schema 或同一文件区域。

### 1.2 状态标记

- 任务标题或表格中的 `[ ]`：尚未完成。
- 任务标题或表格中的 `[x]`：已经完成全部验收，不表示“代码已写但未验收”。
- 状态只能使用：`待确认`、`待开始`、`进行中`、`阻塞`、`待验收`、`已完成`、`已取消`、`不适用`。
- `待验收`：实现和自动化验证已经完成，但仍缺人工、真实外部环境或发布门禁证据。
- `已完成`：验收标准全部满足、证据完整、没有未关闭的 P0 风险。
- 只有 `状态=已完成` 时才允许把任务改为 `[x]`；`待验收`、`阻塞`、`已取消`、`不适用` 都保持 `[ ]`。
- `已取消` 必须记录批准人、原因和替代任务；依赖它的下游任务自动进入阻塞，直到替代依赖获批。
- `不适用` 必须记录 DS0 批准人、理由和证据；派生 Gate 只把“已完成”或“经批准的不适用”视为已关闭。
- 里程碑和横向验收是派生 Gate，必须引用来源任务与证据后才能勾选，不能独立手工宣告通过。

### 1.3 优先级

- `P0`：关键路径、公共合同、数据一致性、安全或上线门禁。
- `P1`：第一期闭环必需，但不阻塞更早的基础建设。
- `P2`：增强项或经过明确批准可后置的工作。
- 条件能力一旦被 DS0 选为生产基线，其任务自动提升为 `P0`；未选能力只能经 DS0 验收人批准后标记 `不适用`，认领人不能自行豁免。已经写入第一期范围的替代后端即使本次未用于生产，也必须按 P1 完成交付，除非 DS0-01/DS0-10 明确批准缩减范围。

### 1.4 认领与验收记录

认领任务时填写“负责人”和“状态”；提交验收时把“证据”替换为可追溯记录：

```text
负责人：姓名或 Agent
状态：进行中 / 待验收 / 已完成
自动化证据：命令、日期、退出码、报告路径
环境证据：环境、版本、操作步骤、预期与实际结果
安全/运维证据：专项报告、演练记录；P0 的不适用必须关联 DS0 或验收人批准记录
变更证据：commit、PR 或文件路径
剩余风险：无，或明确列出未关闭项
验收人：姓名与日期
```

## 2. 依赖图与推荐推进批次

```text
DS0 决策与授权
  ↓
G0 工程骨架与合同
  ↓
G0.5 状态机、事务和故障模型冻结
  ↓
G1 MySQL + Repository + 最小邮件队列
  ├───────────────┐
  ↓               ↓
G2 认证与邮件     G3-A Blob 基础设施
  └───────┬───────┘
          ↓
G3-B 生成队列、积分与结果提交
          ↓
G4 模型网关、结果对账与 AI 改写 SSE
          ├───────────────┐
          ↓               ↓
     G5 用户 Web      G6 管理 Web
          └───────┬───────┘
                  ↓
          G7 商用加固与开放注册门禁
```

关键路径：

```text
DS0 → G0 → G0.5 → G1 → G2/G3 → G4 → G5/G6 → G7
```

推荐批次：

1. `B0`：集中确认 DS0 决策门禁。
2. `B1`：G0 内的配置/日志、OpenAPI、HTTP 基线、生命周期可分工并行，最后集成。
3. `B2`：G0.5 内生成、积分、上传、邮件状态机可并行建模，最后统一冻结锁序和不变量。
4. `B3`：完成 G1；它是 G2、G3 的共同数据库与队列基础。
5. `B4`：G2 与 G3-A 可并行；G3-B 的用户所有权闭环等待 G2 身份基线。
6. `B5`：G4 内 OpenAI、火山引擎、SSRF 下载器、SSE 合同测试可并行。
7. `B6`：G5 与 G6 可并行；管理端视觉与交互必须先完成用户确认。
8. `B7`：G7 的安全、压测、灾备和告警可并行；开放外部注册必须最后执行。

## 3. 全局验证档位

以下是工程建立后的验证档位，不代表当前仓库已经存在对应脚本：

- `V-GO`：开发时在 `server/` 运行 `gofmt -w ./`；CI 以 `gofmt -l ./` 输出为空做只读格式检查，并运行 `go vet ./...`、`golangci-lint run ./...`、`go test ./...`、`go test -race ./...`。
- `V-DB`：真实 MySQL 8.0.46 migration、schema、约束、事务、并发和 `EXPLAIN ANALYZE` 测试。
- `V-WORKER`：领取、租约、心跳、恢复、取消、停机、晚到结果和并发 fencing 测试。
- `V-SEC`：认证、CSRF、IDOR、SSRF、限流、权限和敏感信息泄漏测试。
- `V-BLOB`：fileblob/S3 上传、校验、原子提交、引用保护、GC 和恢复测试。
- `V-PROVIDER`：`httptest.Server` + 官方 SDK 请求结构、timeout、retry、取消和错误分类测试。
- `V-SSE`：事件顺序、flush、反压、断连、终态竞争、幂等重放和代理不缓冲测试。
- `V-WEB`：以未来 `web/package.json` 中实际登记的 test/typecheck/build 脚本为准，不提前杜撰命令。
- `V-E2E`：同域 `/app`、`/admin`、API、Cookie Path 和完整业务闭环测试。
- `V-OPS`：部署、备份恢复、容量、灰度、告警和故障演练。
- `V-DOC`：`git diff --check`，并核对引用的路径、命令、任务 ID 和状态证据。

默认 CI 不调用真实付费 Provider；OpenAI / 火山引擎真实调用只在受控环境做 smoke test，并单独保存证据。

## 4. DS0：实施前决策与授权门禁

DS0 全部为 Ask First 项。未确认时，可以继续研究和完善文档，但不得写入依赖、lockfile、schema、公共 API、配置、权限或外部服务实现。

建议认领角色：产品负责人、架构负责人、安全负责人、运维/DBA；决策验收人不得只由方案提出者本人担任。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] DS0-01 冻结第一期范围 | P0 | 待确认 | 待分配 | 无 | 明确单进程、单副本、个人用户、GET/POST、SSE 仅 AI 改写，以及不做支付/团队/BYOK/多副本 | 待补充 |
| [ ] DS0-02 集中审批新增依赖 | P0 | 待确认 | 待分配 | DS0-01 | 锁定 Go/前端依赖版本、许可证、CVE、维护状态；批准后才能生成 `go.sum`/lockfile | 待补充 |
| [ ] DS0-03 批准 schema 与公共合同变更 | P0 | 待确认 | 待分配 | DS0-01 | 批准 MySQL baseline schema、OpenAPI、DTO、错误码、幂等、SSE 和 Public Runtime Port 变更范围 | 待补充 |
| [ ] DS0-04 确认部署与外部服务矩阵 | P0 | 待确认 | 待分配 | DS0-01 | 明确 MySQL、Redis 拓扑、SMTP、目标 S3 厂商/本地 Blob、反向代理/CDN、OpenAI、火山引擎 | 待补充 |
| [ ] DS0-05 确认 Secret 管理口径 | P0 | 待确认 | 待分配 | DS0-04 | 确认 Provider/SMTP Secret 只由部署 Secret 注入；若需在线更新，先另行批准 Secret Manager | 待补充 |
| [ ] DS0-06 确认 Argon2id 基准环境 | P0 | 待确认 | 待分配 | DS0-04 | 指定生产规格硬件、认证并发预算和参数验收方法，不在方案阶段拍脑袋定值 | 待补充 |
| [ ] DS0-07 确认 MySQL 8.0.46 商用支持 | P0 | 待确认 | 待分配 | DS0-04 | 登记供应商延长安全支持，或批准漏洞响应责任、LTS 迁移负责人和截止日期 | 待补充 |
| [ ] DS0-08 确认 `result_uncertain` SLA | P0 | 待确认 | 待分配 | DS0-01 | 给出有限冻结时长、自动查询窗口、人工处理时限、超期释放和成本核销规则 | 待补充 |
| [ ] DS0-09 确认用户端与管理端交互 | P0 | 待确认 | 待分配 | DS0-03 | 批准 `/app` 新增认证/积分/上传路径、`/admin` 权限与危险操作流程、Ant Design 边界 | 待补充 |
| [ ] DS0-10 冻结方案缺口范围 | P0 | 待确认 | 待分配 | DS0-01 | 输出“事项/纳入或不纳入/原因/纳入任务 ID/不纳入后续 issue”矩阵，覆盖导出、下载、权限、保留期、配额、注销/法定删除 | 待补充 |

DS0 退出条件：所有影响当前实施的 P0 决策已有明确结论；DS0-10 纳入一期的事项已经补成稳定任务 ID 和依赖，未纳入事项已经写入后续 issue，不能保持模糊状态。

## 5. G0：工程骨架与合同

目标：建立可构建、可生成合同、可安全启动和停止的 Go 单进程骨架。

建议认领角色：Go 后端、API 合同负责人、DevOps、可观测性负责人。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G0-T01 建立 `server/` Go Module | P0 | 待开始 | 待分配 | DS0-02 | `go 1.26.0`、`toolchain go1.26.5`、方案目录骨架和精确版本校验；`V-GO` 可执行 | 待补充 |
| [ ] G0-T02 建立配置加载与边界校验 | P0 | 待开始 | 待分配 | G0-T01、DS0-05 | 领域 YAML → `app.yaml` →环境/Secret 覆盖顺序；无效配置快速失败；仓库无真实 Secret | 待补充 |
| [ ] G0-T03 建立整数错误与领域状态常量 | P0 | 待开始 | 待分配 | G0-T01 | 错误号段、HTTP 映射、安全消息和按领域拆分的强类型 `uint8` 状态，不出现通用 `status.go` | 待补充 |
| [ ] G0-T04 建立 OpenAPI 合同与生成链 | P0 | 待开始 | 待分配 | G0-T01、DS0-03 | 用户/管理 API、分页、错误、幂等、CSRF、SSE schema；生成 Go/TS DTO，生成物禁止手改 | 待补充 |
| [ ] G0-T05 建立 Gin 路由与 HTTP 边界 | P0 | 待开始 | 待分配 | G0-T03、G0-T04 | `/api/v1`、`/api/admin/v1`、统一错误、body/timeouts；非 GET/POST 返回 405 + 整数错误码 | 待补充 |
| [ ] G0-T06 建立 trusted proxy、请求 ID 与 CSRF 基线 | P0 | 待开始 | 待分配 | G0-T05、DS0-04 | 默认不信任代理；用户/管理匿名 CSRF 独立；响应 no-store/private、Vary Cookie | 待补充 |
| [ ] G0-T07 建立应用装配与生命周期框架 | P0 | 待开始 | 待分配 | G0-T02、G0-T05 | 使用 test double 验证配置→日志→依赖→Worker→HTTP 顺序、readiness、drain 和关闭；真实依赖装配在后续 Gate 验收 | 待补充 |
| [ ] G0-T08 建立 migration CLI 与 schema 检查 | P0 | 待开始 | 待分配 | G0-T01、G0-T02、DS0-03 | 独立 `server migrate up`；serve 不自动迁移；版本不匹配保持 readiness=false | 待补充 |
| [ ] G0-T09 建立日志安全基线 | P0 | 待开始 | 待分配 | G0-T01、DS0-02 | 业务只依赖 `slog`；logit 无兼容许可证时用 `slog.JSONHandler`；敏感字段泄漏测试通过 | 待补充 |
| [ ] G0-T10 建立 Metrics 与 Tracing 基线 | P0 | 待开始 | 待分配 | G0-T07、G0-T09 | HTTP/Service 子 span、低基数指标、异步 trace context 合同；`/metrics` 不公开暴露 | 待补充 |
| [ ] G0-T11 建立健康检查与同域 SPA 路由 | P0 | 待开始 | 待分配 | G0-T07、G0-T10 | `/healthz` 与 `/readyz` 语义分离；依赖失败保持未就绪；`/app/*`、`/admin/*` 静态回退不吞 API | 待补充 |
| [ ] G0-T12 建立 Makefile/CI 质量入口 | P1 | 待开始 | 待分配 | G0-T01 | 把实际可运行的格式化、vet、lint、测试、race、合同生成检查写入仓库入口和文档 | 待补充 |

G0 里程碑验收：

> 派生来源：G0-T01 至 G0-T12。勾选时必须在条目末尾补 `来源任务 + 证据链接`。

- [ ] 精确 Go 版本和依赖版本可重复构建。
- [ ] OpenAPI 可重复生成 Go/TS 类型，生成产物无手改或重复 HTTP DTO。
- [ ] 配置缺失、Secret 引用无效、schema 不匹配时安全失败。
- [ ] 非法 HTTP 方法、CSRF、trusted proxy、health/readiness 合同测试通过。
- [ ] 日志、指标、Trace 不包含 Secret、Prompt、图片 Base64 或 Provider raw 数据。

## 6. G0.5：状态机、事务与故障模型冻结

目标：在写核心业务实现前冻结事实源、状态转换、锁顺序、不变量和可执行测试规范。

建议认领角色：架构负责人、生成/积分/存储/认证领域负责人、测试负责人。

> G0.5 使用可控 fake、事务 harness 和 fixture 先跑通六类故障模型，不要求尚不存在的真实 Provider/Blob adapter。真实集成故障注入仍分别在 G1、G3、G4 作为退出门禁执行。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G05-T01 冻结 Task/Run/Job/Invocation 状态表 | P0 | 待开始 | 待分配 | G0-T03、G0-T04 | 每条迁移含前态、后态、操作者、事务、CAS、幂等键、恢复和非法迁移 | 待补充 |
| [ ] G05-T02 冻结稳定结果槽与展示状态真值表 | P0 | 待开始 | 待分配 | G05-T01 | 明确稳定槽、未隐藏 run、失败槽、tombstone 如何派生用户展示状态 | 待补充 |
| [ ] G05-T03 冻结执行计划与 Catalog 协议 | P0 | 待开始 | 待分配 | G05-T01 | `execution_plan_json/hash/version`、Prompt/Capability 版本、只增不改和升级后解析规则 | 待补充 |
| [ ] G05-T04 冻结积分状态与不变量 | P0 | 待开始 | 待分配 | G05-T01、DS0-08 | 最高价预留、实际价逐槽消费、释放、uncertain hold、充值和五项账务不变量 | 待补充 |
| [ ] G05-T05 冻结 Upload/Asset/GC 状态表 | P0 | 待开始 | 待分配 | G05-T01、DS0-10 | owner lease、CAS 激活、有效引用谓词、保留期、purge、tombstone、GC 再校验 | 待补充 |
| [ ] G05-T06 冻结邮件 Challenge/Grant 状态表 | P0 | 待开始 | 待分配 | G05-T01 | 确定性验证码、重试同码、supersede、delivery_failed、grant 原子一次性消费 | 待补充 |
| [ ] G05-T07 冻结事务型与 Saga 型幂等 | P0 | 待开始 | 待分配 | G05-T01、G05-T04、G05-T05 | 规范化 request hash、唯一键、处理中响应、稳定资源、Blob IO owner 和安全摘要 | 待补充 |
| [ ] G05-T08 冻结三池租约与停机协议 | P0 | 待开始 | 待分配 | G05-T01 | mail/generation/maintenance 容量、claim、lease、heartbeat、deadline、恢复和 drain | 待补充 |
| [ ] G05-T09 跑通故障注入 harness 与测试矩阵 | P0 | 待开始 | 待分配 | G05-T01 至 G05-T08 | 用可控 fake/事务 harness 执行并通过 SMTP 接收后崩溃、Provider 受理后超时、Blob 后 DB 失败、积分崩溃、GC 竞争、并发幂等 | 待补充 |

G0.5 退出条件：状态表、事务时序、锁顺序、不变量完成交叉评审，六类可控故障注入通过；没有“实现时再决定”的计费、恢复、所有权或删除规则。

## 7. G1：MySQL 基线与最小邮件队列

目标：在真实 MySQL 8.0.46 上建立 schema、Repository、持久队列和最小 Worker 垂直切片。

建议认领角色：DBA、Go 数据层负责人、Worker 负责人；migration 与账务相关验收需独立复核。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G1-T01 冻结 schema、索引、FK 与保留策略 | P0 | 待开始 | 待分配 | G05-T09、DS0-03、DS0-10 | 核心表、唯一键、物理/逻辑 FK、软删除、purge 顺序和各类数据保留期评审通过 | 待补充 |
| [ ] G1-T02 编写 MySQL 8.0.46 migration | P0 | 待开始 | 待分配 | G1-T01 | InnoDB、collation、UTC `DATETIME(3)`、`TINYINT` status、所有业务表 `version`、价格快照字段 | 待补充 |
| [ ] G1-T03 建立 Entity、UUIDv7 与乐观锁基线 | P0 | 待开始 | 待分配 | G1-T02 | 每个 Entity 静态 `TableName()`；BINARY(16) UUID；非零 version + RowsAffected 冲突检查 | 待补充 |
| [ ] G1-T04 建立 Repository、事务与分页基线 | P0 | 待开始 | 待分配 | G1-T03 | 用户作用域接口、稳定分页、游标、批处理、显式事务与锁序；禁止无界读取和 N+1 | 待补充 |
| [ ] G1-T05 实现 `async_jobs` Claim/Lease | P0 | 待开始 | 待分配 | G1-T04、G05-T08 | READ COMMITTED、SKIP LOCKED、独立 lease token、有界死锁重试、领取数=更新数 | 待补充 |
| [ ] G1-T06 实现 Worker Supervisor 骨架 | P0 | 待开始 | 待分配 | G1-T05、G0-T07 | 空闲槽感知、Nonblocking、panic handler、Submit 失败 CAS 回队、context 与 trace 传播 | 待补充 |
| [ ] G1-T07 完成最小 `mail_pool` 垂直切片 | P0 | 待开始 | 待分配 | G1-T06 | 测试 job 入队、领取、续租、完成、失败、重启恢复和优雅停机；暂不含验证码业务 | 待补充 |
| [ ] G1-T08 完成 MySQL 与队列验收 | P0 | 待开始 | 待分配 | G1-T02 至 G1-T07 | 空库 migration、schema/约束、row-based binlog 要求、并发 claim、fencing、关键 SQL `EXPLAIN ANALYZE` 通过 | 待补充 |
| [ ] G1-T09 完成 migration 恢复与兼容验收 | P0 | 待开始 | 待分配 | G1-T02、G1-T08 | 可逆变更验证 up→down→up；不可安全 down 的变更定义 forward-fix、备份恢复、应用/schema 兼容窗口和中途失败 readiness | 待补充 |

G1 退出条件：真实 MySQL 8.0.46 上 `V-DB`、`V-WORKER` 通过；旧 lease Worker 不能提交结果；migration 恢复与兼容验收通过。

## 8. G2：用户、Session 与邮件闭环

目标：完成用户身份、Cookie/Redis Session、CSRF、验证码、密码重置、个人资料和最小管理身份闭环。

建议认领角色：认证后端、安全工程师、邮件服务负责人、集成测试负责人。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G2-T01 实现 Argon2id 密码组件 | P0 | 待开始 | 待分配 | G1-T04、DS0-06 | PHC、参数版本、字节上限、并发限制、登录 rehash 和统一认证错误；目标硬件 benchmark | 待补充 |
| [ ] G2-T02 实现 Cookie Session Store | P0 | 待开始 | 待分配 | G2-T01、G0-T06 | fixation 防护、idle/absolute TTL、key 轮换、`session_version`、正确 Cookie Path | 待补充 |
| [ ] G2-T03 实现完整 CSRF 闭环 | P0 | 待开始 | 待分配 | G2-T02、G0-T06 | 用户/管理 Token、Cookie、密钥隔离；登录后刷新；失败只重取一次且不自动重放 POST | 待补充 |
| [ ] G2-T04 实现持久安全限流 | P0 | 待开始 | 待分配 | G1-T04、G0-T06 | email hash + 可信 IP + purpose 原子计数、blocked_until、批量过期清理 | 待补充 |
| [ ] G2-T05 实现 Challenge/Grant Service | P0 | 待开始 | 待分配 | G05-T06、G2-T04 | 版本化 HMAC、独立 verification pepper、恒定时间比较、并发尝试上限和 grant 原子签发/消费 | 待补充 |
| [ ] G2-T06 实现 SMTP Adapter 与模板 | P0 | 待开始 | 待分配 | G1-T07、G2-T05、DS0-05 | host allowlist、TLS、timeout、异步发送、同 challenge 重试同码、delivery_failed 和脱敏错误 | 待补充 |
| [ ] G2-T07 实现用户认证与资料 API | P0 | 待开始 | 待分配 | G2-T01 至 G2-T06 | 注册、登录、退出、重置、资料；账号枚举防护；重置后旧 Session 失效 | 待补充 |
| [ ] G2-T08 建立用户所有权 Repository 合同 | P0 | 待开始 | 待分配 | G1-T04、G2-T07 | 现有用户资源从 Session 取 `user_id`；禁止客户端 owner ID；后续资源任务补本领域 IDOR，G7 全量收口 | 待补充 |
| [ ] G2-T09 实现独立管理员 Session、权限与审计 | P0 | 待开始 | 待分配 | G2-T02、G2-T03、DS0-10 | 独立管理员表/Cookie/Path、最小权限矩阵、近期认证接口、写操作与跨用户读取审计 | 待补充 |
| [ ] G2-T10 验证 Redis Session Store | P1 | 待开始 | 待分配 | G2-T02、DS0-04 | 选中 Redis 不可用时启动失败；只对完成目标 TLS/Sentinel/Cluster 集成测试的拓扑声明支持 | 待补充 |

G2 里程碑验收：Cookie Store 生产基线、完整认证/邮件闭环、Argon2id benchmark、CSRF/fixation/IDOR/限流测试通过；Redis 未验证拓扑不得标记为正式支持。

## 9. G3：Blob、生成队列与积分

目标：完成资产存储、上传会话、生成 Task/Run、三池 Worker、积分预留/结算、稳定结果槽和备份恢复。

建议认领角色：存储后端、生成后端、积分后端、Worker 负责人、SRE；积分实现与验收必须分离。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G3-T01 建立 Go CDK Blob 与对象键策略 | P0 | 待开始 | 待分配 | G1-T04、DS0-04 | 统一 Bucket；DB 只保存 backend/alias/key；对象键由服务端生成，无绝对路径泄漏 | 待补充 |
| [ ] G3-T02 实现 Upload Session Saga | P0 | 待开始 | 待分配 | G3-T01、G05-T05、G05-T07 | prepare/upload/complete、owner lease、HEAD+流式校验、CAS 激活、处理中与重复 complete 幂等 | 待补充 |
| [ ] G3-T03 实现 fileblob 生产基线 | P0 | 待开始 | 待分配 | G3-T01、DS0-04 | 持久卷、NoTempDir、同卷原子 rename、Windows 句柄、路径逃逸、磁盘水位和鉴权下载 | 待补充 |
| [ ] G3-T04 实现资产 API 与用量统计 | P0 | 待开始 | 待分配 | G3-T02、G2-T08 | MIME/魔数/尺寸/解码上限、列表/详情/下载、软删除、用户隔离和安全 DTO | 待补充 |
| [ ] G3-T05 实现引用保护、Purge 与批量 GC | P0 | 待开始 | 待分配 | G3-T04、G05-T05、DS0-10 | 统一有效引用谓词、二次 version 校验、tombstone、孤儿对象、固定批次和保留期 | 待补充 |
| [ ] G3-T06 实现 generation/maintenance Worker Pool | P0 | 待开始 | 待分配 | G1-T06、G05-T08 | 三池容量隔离、独立 claim/lease/heartbeat/timeout、不得超领、取消与停机恢复 | 待补充 |
| [ ] G3-T07 实现 Generation Task/Run/Events | P0 | 待开始 | 待分配 | G1-T04、G05-T01 至 G05-T03、G2-T08 | task/run 分离、冻结 plan、事件 sequence、创建/取消/重试新 run、polling 版本合同 | 待补充 |
| [ ] G3-T08 实现积分账户、预留、充值与流水 | P0 | 待开始 | 待分配 | G1-T04、G05-T04 | 最高候选价预留、正数幂等充值、不可变 ledger、价格快照、行锁/CAS 和账务不变量 | 待补充 |
| [ ] G3-T09 实现输出提交与稳定结果槽事务 | P0 | 待开始 | 待分配 | G3-T04、G3-T07、G3-T08 | Blob 先写；固定锁序；asset/output/credit/slot/display 同事务；每槽只消费一次 | 待补充 |
| [ ] G3-T10 实现部分成功、释放与 uncertain hold fixture | P0 | 待开始 | 待分配 | G3-T09、DS0-08 | 按实际模型 fixture 逐图消费；失败/差额释放；只冻结不确定 invocation 未决槽的冻结价 | 待补充 |
| [ ] G3-T11 完成 G3 故障注入与账务对账 | P0 | 待开始 | 待分配 | G3-T05 至 G3-T10 | Blob 后各 DB 步骤失败回滚、GC/引用竞争、重复完成、取消竞争、五项积分不变量全部通过 | 待补充 |
| [ ] G3-T12 实现 User Settings Service/API | P0 | 待开始 | 待分配 | G1-T04、G2-T08 | `GET /settings`、`POST /settings/update`、用户隔离、schema 校验、version 冲突和即时生效语义 | 待补充 |
| [ ] G3-T13 验证 S3 + Presigned POST | P1（生产选用时 P0） | 待开始 | 待分配 | G3-T01、G3-T02、DS0-04 | 私有 Bucket、最小 CORS、POST policy、checksum、条件提交、lifecycle 和目标厂商矩阵 | 待补充 |
| [ ] G3-T14 完成生产 Blob 备份恢复 | P0 | 待开始 | 待分配 | G3-T05、DS0-04；按选择依赖 G3-T03 或 G3-T13 | 对选定生产后端完成同恢复点协议；本地验证 backup_epoch+卷，S3 验证版本/复制/恢复与 DB 对账 | 待补充 |

G3 里程碑验收：

> 派生来源：G3-T01 至 G3-T14。勾选时必须在条目末尾补 `来源任务 + 证据链接`。DS0-04 选中的生产后端任务为 P0，另一后端保持 P1 并完成兼容交付；只有 DS0-01/DS0-10 明确缩减一期范围后才能标记 `不适用`。

- [ ] fileblob 与 S3 按 DS0-04 选定的支持级别验收；目标厂商证明不能由 MinIO 结果替代。
- [ ] 并发 upload complete 只有一个 owner 可以激活资产。
- [ ] generation run 冻结计划可在重启和版本升级后解析。
- [ ] Blob 写入后任一 MySQL 步骤失败只留下可清理孤儿对象，不扣积分、不出现可见 output。
- [ ] 预留、消费、释放、部分成功、取消、重复完成和不确定结果的并发故障测试通过。

## 10. G4：模型网关、结果对账与 AI 改写 SSE

目标：完成四类模型的官方 SDK 薄适配、多候选策略、结果不确定对账和仅限 AI 改写的 SSE。

建议认领角色：模型网关后端、安全工程师、Provider 集成测试负责人、SSE/代理链路负责人。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G4-T01 实现 Prompt/Capability Catalog 与查询 API | P0 | 待开始 | 待分配 | G05-T03、G0-T02 | embed manifest/hash、历史版本只增不改、四类能力可验证；`GET /capabilities` 返回安全 Runtime DTO | 待补充 |
| [ ] G4-T02 实现 Model Config 与价格管理 Service | P0 | 待开始 | 待分配 | G3-T08、DS0-05 | provider allowlist、secret_ref、version CAS、公开计费名、价格校验和变更审计；不提前声称真实连接成功 | 待补充 |
| [ ] G4-T03 实现 Model Invocation 编排骨架 | P0 | 待开始 | 待分配 | G3-T07、G4-T01、G4-T02 | 调用前持久化、唯一 invocation key、冻结 slot/价格、context/timeout 和安全摘要 | 待补充 |
| [ ] G4-T04 实现 OpenAI 官方 SDK Adapter | P0 | 待开始 | 待分配 | G4-T03、DS0-02 | Responses/Chat/Images Edits、`WithMaxRetries(0)`、响应限制和 SDK 类型不外泄 | 待补充 |
| [ ] G4-T05 实现火山 Ark 官方 SDK Adapter | P0 | 待开始 | 待分配 | G4-T03、DS0-02 | 精确 Seedream 能力字段、60/300 秒口径、显式 retry 和四类能力支持边界 | 待补充 |
| [ ] G4-T06 实现统一 SSRF 安全下载器 | P0 | 待开始 | 待分配 | G4-T03、DS0-04 | HTTPS/端口 allowlist、DNS 与连接绑定、私网/元数据拒绝、redirect/MIME/size 限制 | 待补充 |
| [ ] G4-T07 实现多候选并发、熔断与降级 | P0 | 待开始 | 待分配 | G4-T04 至 G4-T06 | 配置级 semaphore/breaker、错误分类、总 deadline、已结算槽不重复生成 | 待补充 |
| [ ] G4-T08 实现 `result_uncertain` 自动/人工对账 | P0 | 待开始 | 待分配 | G4-T07、G3-T10、DS0-08 | Provider 查询、退避、deadline、证据约束、恢复输出、mark-no-result、超期释放和审计 | 待补充 |
| [ ] G4-T09 打通真实生成 Worker 闭环 | P0 | 待开始 | 待分配 | G3-T06、G3-T09、G4-T03 至 G4-T08 | generation job→GenerationService→候选模型→校验下载→输出结算→run/job 终态；取消、lease 丢失和晚到结果安全 | 待补充 |
| [ ] G4-T10 实现 AI Assist SSE Service/Handler | P0 | 待开始 | 待分配 | G2-T03、G2-T04、G2-T08、G3-T04、G4-T07、G05-T07 | 只接受当前用户有效资产引用；POST fetch、事件序列、有界 channel、断连取消、终态 CAS、幂等重放 | 待补充 |
| [ ] G4-T11 完成 Provider/SSE 综合验收 | P0 | 待开始 | 待分配 | G3-T11、G4-T04 至 G4-T10 | 真实连接测试、retry=0、受理不确定、首 delta 后禁 fallback、真实代理不缓冲、SSRF 和敏感原文不泄漏 | 待补充 |

G4 退出条件：G3-T11 已完成，`V-PROVIDER`、`V-SSE`、`V-SEC` 通过；真实生成闭环和 OpenAI/火山受控 smoke test 有独立证据；mock/httptest 不能单独证明真实 Provider 已接通。

## 11. G5：用户 Web

目标：通过 Remote Runtime 接入真实 SaaS API，保持现有用户端视觉和业务流程。

建议认领角色：Web 前端、Runtime 合同负责人、设计/视觉验收人、E2E 测试负责人。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G5-T01 建立 `web/` 与 `/app` 路由 | P0 | 待开始 | 待分配 | G0-T11、DS0-09 | 单 Web 产物、路由级拆包、同源 API；不擅自改变既有 token、布局和视觉 | 待补充 |
| [ ] G5-T02 实现 RemoteRuntimeClient/API Client | P0 | 待开始 | 待分配 | G0-T04、G4-T01、G5-T01、DS0-03 | 复用 OpenAPI 类型；Session/CSRF/request ID/错误映射、Remote CapabilityPort；低版本 polling 响应丢弃 | 待补充 |
| [ ] G5-T03 接入注册、登录、重置与资料 | P0 | 待开始 | 待分配 | G2-T07、G5-T02 | 登录后刷新 CSRF、错误可见、不自动重放失败 POST、loading/disabled 防重复 | 待补充 |
| [ ] G5-T04 接入素材上传与素材库 | P0 | 待开始 | 待分配 | G3-T04、G5-T02 | S3/local 合同统一；进度、失败、重试、删除；前端不传 Base64/内部 object key | 待补充 |
| [ ] G5-T05 接入生成、历史与事件 polling | P0 | 待开始 | 待分配 | G4-T09、G5-T02 | 终态停止、uncertain 降频、task version 防旧响应、event sequence 去重、稳定槽恢复 | 待补充 |
| [ ] G5-T06 接入积分余额与逐笔流水 | P0 | 待开始 | 待分配 | G3-T08、G5-T02 | 展示冻结/解冻/消费、公开模型名、单价和扣后余额；无内部 ID/Provider 泄漏 | 待补充 |
| [ ] G5-T07 实现 AI 改写 SSE Remote Port | P0 | 待开始 | 待分配 | G4-T10、G5-T02 | fetch+ReadableStream、唯一终态、重试使用新幂等键；不建立通用 SSE/WebSocket 层 | 待补充 |
| [ ] G5-T08 接入用户设置与 Remote SettingsPort | P0 | 待开始 | 待分配 | G3-T12、G5-T02 | 用户设置加载、即时保存、最后响应胜出、version 冲突、用户隔离和 E2E 通过 | 待补充 |
| [ ] G5-T09 完成 capability 隔离与视觉回归 | P0 | 待开始 | 待分配 | G5-T03 至 G5-T08 | Web mode 隐藏 Workspace/Shell/ModelConfig/Secret 本地入口；截图和交互回归无未授权变化 | 待补充 |

G5 退出条件：所有用户页面均接真实 API，不用 fixture/mock 冒充闭环；关键 E2E、Runtime Port 合同和人工视觉比对有证据。

## 12. G6：管理 Web

目标：完成独立认证和权限边界下的用户、任务、模型、积分、存储、配置与审计管理。

建议认领角色：产品/设计、管理端前端、管理后端、安全验收人。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G6-T01 确认 `/admin` 交互稿与组件边界 | P0 | 待开始 | 待分配 | DS0-09、DS0-10 | 独立 ConfigProvider、权限点、危险操作、MFA/近期认证、页面流程经用户确认 | 待补充 |
| [ ] G6-T02 实现管理端壳、登录与权限路由 | P0 | 待开始 | 待分配 | G2-T09、G6-T01 | 独立认证状态/Cookie；不复用用户 Session；无权限路由和操作不可见/不可调用 | 待补充 |
| [ ] G6-T03 实现模型配置与价格管理 | P0 | 待开始 | 待分配 | G4-T02、G4-T04、G4-T05、G6-T02 | CRUD/test、每图单价、version CAS、近期认证、reason 和审计 | 待补充 |
| [ ] G6-T04 实现积分充值与不确定 run 对账 | P0 | 待开始 | 待分配 | G4-T08、G6-T02 | 正整数幂等充值；恢复输出只采用已验证 Blob；无结果释放有证据且全程审计 | 待补充 |
| [ ] G6-T05 实现用户与任务管理 | P1 | 待开始 | 待分配 | G4-T08、G6-T02 | 分页、启停用户、取消任务、跨用户读取权限和访问审计 | 待补充 |
| [ ] G6-T06 实现 System Config 与 SMTP 管理 | P1 | 待开始 | 待分配 | G2-T06、G6-T02、DS0-05 | schema 校验后的原子 JSON、allowlist、Secret 只显示状态、测试邮件与变更审计 | 待补充 |
| [ ] G6-T07 实现存储用量与审计日志 | P1 | 待开始 | 待分配 | G3-T05、G6-T02 | 稳定分页、筛选、敏感字段脱敏、管理写操作可追溯 | 待补充 |
| [ ] G6-T08 完成管理端权限与交互验收 | P0 | 待开始 | 待分配 | G6-T03 至 G6-T07 | loading/disabled/toast、越权、CSRF、近期认证、二次确认和审计完整性通过 | 待补充 |

G6 退出条件：权限矩阵有自动化和人工证据；未启用 MFA 时只允许受限网络内部测试，不得公网正式商用。

## 13. G7：商用加固与开放注册门禁

目标：把已实现能力提升到可运营、可恢复、可审计的商用状态；G7 不是首次补安全、观测或备份。

建议认领角色：SRE、安全、DBA、法务/依赖审查、产品发布负责人。

| 任务 | 优先级 | 状态 | 负责人 | 依赖 | 可验收交付物 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] G7-T01 实现管理员 MFA 与高风险再认证 | P0 | 待开始 | 待分配 | G6-T08 | MFA、登录审计、充值/调价/对账的近期认证、恢复流程和应急访问策略 | 待补充 |
| [ ] G7-T02 完成全量安全回归 | P0 | 待开始 | 待分配 | G5-T09、G6-T08、G7-T01 | IDOR、CSRF、SSRF、Session、上传、限流、权限、Secret/raw 数据泄漏全部通过 | 待补充 |
| [ ] G7-T03 建立 Dashboard、告警与响应流程 | P0 | 待开始 | 待分配 | G3-T11、G4-T11 | 覆盖队列、lease、uncertain、积分错账、磁盘、GC、SSE、Provider；有阈值、值班与演练 | 待补充 |
| [ ] G7-T04 完成灾难恢复演练 | P0 | 待开始 | 待分配 | G3-T14、DS0-05 | 对 DS0-04 选定生产 Blob 完成 MySQL+Blob 同恢复点演练；Secret/key 恢复、RPO/RTO 和对账有记录 | 待补充 |
| [ ] G7-T05 完成依赖、许可证、CVE 与数据库支持审查 | P0 | 待开始 | 待分配 | G4-T11、DS0-07 | SBOM/版本锁定；logit 有兼容许可证才切换；MySQL 商用支持和高危漏洞处置完成 | 待补充 |
| [ ] G7-T06 完成容量与故障压测 | P0 | 待开始 | 待分配 | G5-T09、G6-T08 | API/三池/SSE/Provider/Blob 资源隔离；单副本容量上限、限流和降级路径有记录 | 待补充 |
| [ ] G7-T07 完成生产部署与回滚 Runbook | P0 | 待开始 | 待分配 | G7-T02 至 G7-T06 | 单副本、migration 先行、termination grace、持久卷、metrics 保护、暂停队列/只读/停止新生成路径 | 待补充 |
| [ ] G7-T08 完成内部灰度与开放注册审批 | P0 | 待开始 | 待分配 | G7-T07、DS0-08 | 内部灰度通过；SLA、保留期、责任人齐全；审批后才打开外部注册 | 待补充 |

G7 退出条件：安全、容量、灾备、告警、依赖和发布门禁全部有目标环境证据；没有未关闭的 P0 风险；外部注册由明确审批动作开启。

## 14. 横向验收清单

以下项目贯穿多个里程碑。相关任务不能只凭局部单测标记完成。

### 14.1 合同与分层

> 派生来源：G0-T03 至 G0-T06、G1-T03、G4-T01、G5-T02。每项勾选时补来源任务和证据链接。

- [ ] OpenAPI 业务路由只包含 GET/POST，其他方法统一返回 405 + 整数错误码。
- [ ] OpenAPI 生成 DTO 只位于生成目录，不存在第二套手写 HTTP DTO。
- [ ] Entity、Service Command/View、Mapper、HTTP DTO 边界清晰，Entity 不直接返回 JSON。
- [ ] Public Runtime Port 的新增和变更均有单独确认和合同测试。
- [ ] 已发布 Prompt/Capability Catalog 版本只能新增，CI 阻止覆盖或删除。

### 14.2 数据与账务一致性

> 派生来源：G05-T01 至 G05-T07、G1-T01 至 G1-T09、G3-T07 至 G3-T11。每项勾选时补来源任务和证据链接。

- [ ] 所有业务表都有 `version`；状态和时间类型分别为 `TINYINT` 与 `DATETIME(3)`。
- [ ] 相同幂等 key + 相同规范化请求返回相同资源；不同请求返回 409 且无重复副作用。
- [ ] task 重试创建新 run，模型调价不改变已冻结 plan。
- [ ] `available >= 0`、`reserved >= 0`、reservation 守恒、account reserved 对账成立。
- [ ] 同一 `(run_id, slot_code)` 最多只有一条 consume 流水。
- [ ] 对账异常只告警并阻止高风险结算，不自动修改不可变流水。

### 14.3 安全与个人数据隔离

> 派生来源：G0-T06、G2-T01 至 G2-T09、G3-T02、G3-T04、G4-T06、G7-T02。每项勾选时补来源任务和证据链接。

- [ ] 用户资源查询从 Session 取 `user_id`，客户端 owner ID 不参与授权。
- [ ] 资产、任务、事件、设置、积分、上传会话、下载 URL 的跨用户 IDOR 全部被拒绝。
- [ ] 管理跨用户访问只走 `/api/admin/v1/*`，权限和访问审计完整。
- [ ] trusted proxy、CSRF、持久限流、Session fixation、SSRF 和上传安全测试通过。
- [ ] API、日志、Trace、Metrics、事件、数据库不包含 Secret、验证码、raw prompt/response、图片 Base64。

### 14.4 Worker、Provider 与 SSE

> 派生来源：G1-T05 至 G1-T08、G3-T06、G4-T03 至 G4-T11。每项勾选时补来源任务和证据链接。

- [ ] 三个池不超过自身空闲槽领取 job，故障和容量相互隔离。
- [ ] lease 丢失后旧 Worker 不能提交晚到结果。
- [ ] Provider SDK 自动 retry 已关闭或被统一策略显式覆盖。
- [ ] `result_uncertain` 时禁止自动重试/降级，有限 SLA 后幂等释放用户冻结积分。
- [ ] 只有 AI 帮写/改写使用 SSE；图片、历史、邮件、导出和管理任务继续 polling。
- [ ] SSE 满足 `meta -> delta* -> done|error`、唯一终态、UTF-8/JSON 安全、即时 flush、反压和断连取消。

### 14.5 存储与恢复

> 派生来源：G3-T01 至 G3-T05、G3-T13、G3-T14、G7-T04。每项勾选时补来源任务和证据链接。

- [ ] 上传 complete 不信任客户端 MIME/hash/尺寸，并发只能由一个 owner 激活。
- [ ] 删除素材不破坏 queued/running run 或保留期内历史引用。
- [ ] GC 在删除前重新检查引用和 asset version，且固定批次执行。
- [ ] 本地 Blob critical 水位拒绝新写入但允许读取、下载、删除和 GC。
- [ ] S3 生产支持结论只适用于通过兼容矩阵的目标厂商。
- [ ] MySQL 与 Blob 同恢复点的备份恢复演练成功，缺失与孤儿对象完成对账。

### 14.6 Web 与运营

> 派生来源：G5-T01 至 G5-T09、G6-T01 至 G6-T08、G7-T01 至 G7-T08。每项勾选时补来源任务和证据链接。

- [ ] 用户端保持既有视觉；任何操作路径或视觉变化已有用户确认。
- [ ] Web mode 正确隐藏本地专属能力，不在页面写 `if (isTauri)`。
- [ ] 管理高风险动作具备权限、近期认证、loading/disabled、二次确认和审计。
- [ ] 指标已经被采集并形成 Dashboard/告警，不以“代码注册了指标”作为完成证据。
- [ ] production termination grace 大于 HTTP drain 与 Worker drain 总时限。
- [ ] 外部注册在全部商用门禁通过前保持关闭。

## 15. 明确不在本清单内

- 团队空间、成员邀请、团队 RBAC 和租户 workspace。
- 在线支付、发票、优惠券、套餐、退款和自动续费。
- 独立 Worker 进程、微服务、多副本和 Redis 任务队列。
- 本地桌面历史、API Key、模型配置自动迁移到 SaaS。
- 企业 SSO、开放 API、Webhook、BYOK、自定义 Provider 和任意网关。
- 经 DS0-10 明确确认不纳入一期的法定删除、数据导出或存储配额扩展。

## 16. 进度汇总模板

每次推进后只更新有证据的状态：

```text
当前阶段：Gx
已完成：TASK-ID ...
进行中：TASK-ID ...
待验收：TASK-ID ...
阻塞：TASK-ID + 原因 + 需要谁确认
不适用：TASK-ID + DS0 批准人 + 理由 + 证据
本轮验证：命令/环境 + 结果
下一批可认领：满足全部依赖的任务 ID
剩余 P0 风险：无，或逐项列出
```
