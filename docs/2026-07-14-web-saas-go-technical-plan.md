# 商拍工坊 Web SaaS Go 技术方案

> 文档状态：方案草案，尚未开始实现
> 创建日期：2026-07-14
> 适用范围：Web 用户端、Web 管理端、Go 后端、进程内任务执行器
> 关联文档：`docs/2026-06-30-local-first-saas-ready-implementation-plan.md`

## 1. 背景与结论

现有系统是 Tauri v2 + React + TypeScript + Rust + SQLite 的本地优先桌面应用，前端已经通过 `RuntimeClient` 和 Public Runtime Ports 隔离 Tauri、SQLite、Provider SDK 与文件系统细节。

Web SaaS 不在原 Rust runtime 内继续扩展，而是新增一套 Go Remote Runtime：

```text
local  -> LocalRuntimeClient  -> Tauri commands -> Rust / SQLite / 本地文件
remote -> RemoteRuntimeClient -> HTTPS API      -> Go / MySQL / Blob Storage
```

页面组件仍只调用 Runtime Ports，不判断 Tauri 或 Web。能够复用的是 React 业务页面、DTO 语义、任务状态机、Prompt 模板、Provider 规则与测试场景；Rust 源码、SQLite 物理结构和本地文件能力不直接复用。

本方案采用以下总体技术路线：

- Go 1.26；`go.mod` 使用 `go 1.26.0`、`toolchain go1.26.5`，CI 与构建镜像精确锁定 Go 1.26.5 并校验 `go version`。`toolchain` 指令不是版本上限，构建环境锁定仍是事实源。
- Gin 作为 HTTP Web 框架。
- MySQL 8.0.46，不再兼容 MySQL 5.6 / 5.7。MySQL 8.0 已结束官方社区生命周期，公网正式商用前必须确认数据库供应商的延长安全支持；自托管且没有延长支持时属于上线阻塞项。
- GORM 负责常规 ORM 映射，显式 SQL migration 管理 schema。
- API 和 Worker 运行在同一个 Go 进程，第一期生产固定单副本 `replicas = 1`。
- `async_jobs` 是第一期唯一持久队列表，生成、邮件和资产清理共用该表；`generation_tasks` 只保存生成业务事实。
- 图片支持 S3 兼容对象存储和本地文件存储。
- 本地 Blob 允许生产部署，但必须使用持久卷、固定单副本，并纳入容量监控和一致性备份。
- OpenAI、火山引擎优先接官方 Go SDK。
- 认证第一期使用 `gin-contrib/sessions`，通过配置在 Cookie Store 与 Redis Store 之间切换。
- 邮件服务支持 SMTP 配置，用于邮箱验证码和密码重置，发送动作由进程内 Worker 异步执行。
- 管理端采用 Ant Design v6；用户端在不改变既有视觉的前提下渐进接入。
- 用户端和管理端使用同一域名下的二级路径，不拆成三套部署。
- 第一期仅支持个人用户，不实现团队、租户成员和团队工作空间。
- 通用能力优先采用许可证清晰、持续维护的开源组件；不重复自研通用框架。

### 1.1 外部评审意见处理结论

本版已吸收评审中直接影响数据一致性、安全和生产恢复的建议：确定性验证码、`generation_runs`、持久化执行计划、HTTP 幂等、Provider `result_uncertain`、积分预留 / 消费 / 释放、上传会话、三类 Worker Pool、可信代理、持久安全限流、SSRF、防 Session fixation、Argon2id、readiness、优雅停机、独立 migration 和生产级本地 Blob 约束。

以下建议不采用或暂缓，原因以已确认需求和第一期范围为准：

- 数据库不改为 MySQL 8.4，按用户确认固定 MySQL 8.0.46；不再假定存在后续社区安全补丁，部署前必须登记供应商支持、漏洞响应、后续 LTS 迁移负责人和最晚完成日期。
- 不增加 `--role=api/worker` 和多进程模式，第一期只保留单进程、单副本，避免为未确认的拆分提前设计兼容层。
- 业务 API 仍严格只允许 GET / POST，不开放 HEAD / OPTIONS；这是明确合同约束，不把它宣称为安全机制。
- 所有业务表仍保留 `version`；追加型流水 / 审计表固定 `version = 1` 且禁止 UPDATE / DELETE，以同时满足项目统一字段约束和不可变语义。
- 状态常量仍统一置于 `server/lib/constant`，但必须按领域拆分强类型文件，禁止单一 `status.go` 和跨领域比较。
- 第一版先拆分邮件、生成、维护三个池；图片处理出现独立、可量化的 CPU / 内存瓶颈后再评估第四个处理池，不提前扩展。

## 2. 已确认范围

### 2.1 第一期包含

- 邮箱验证码、用户注册、登录、退出、密码重置和个人资料。
- 个人素材、个人生成任务、个人历史和个人设置。
- 商品图、服饰试穿、场景图、详情图及已有 AI 辅助能力。
- AI 帮写 / AI 改写使用 SSE 返回文本增量；图片生成、任务历史、邮件、导出和其他异步状态继续使用 polling。
- 图片上传、下载、软删除、结果归档和存储用量统计。
- 任务创建、排队、领取、执行、心跳、取消、重试和失败恢复。
- OpenAI 与火山引擎 Provider 接入。
- 平台管理端的用户、任务、模型配置、积分、存储和审计能力。
- 积分账户、管理员充值和不可变积分流水；第一期按“实际执行模型配置 × 每张成功图片”的冻结单价逐笔扣减。
- S3 兼容存储和本地存储两种部署模式。
- 结构化日志、指标、Tracing、健康检查和优雅停机。

### 2.2 第一期不包含

- 团队空间、成员邀请、组织层级和团队 RBAC。
- 独立 Worker 进程、微服务拆分和 Redis 任务队列。Redis 只作为可选 Session Store，不承担第一期任务队列。
- 本地桌面历史、API Key 和模型配置自动迁移到 SaaS。
- 企业 SSO、开放 API、Webhook 和私有化多集群管理。
- 在线支付、发票、优惠券和自动续费；如第一期需要支付，必须单独补充支付方案。
- 用户自定义 Provider、任意网关和 BYOK。

### 2.3 个人数据隔离口径

第一期不创建 `tenants`、`tenant_members` 或团队 `workspaces`。所有用户资源直接以 `user_id` 作为所有权边界：

- 用户 API 必须从认证 Session 获取 `user_id`，禁止信任客户端提交的所有者 ID。
- 资产、任务、历史、设置、积分流水等查询必须包含 `user_id` 条件。
- 平台管理员跨用户访问只能通过 `/api/admin/v1/*`，使用独立管理 Session 和权限中间件。
- 管理端所有写操作记录审计日志。

未来增加团队空间时，通过 migration 引入 `workspace_id`，再将个人数据迁移到每个用户的默认个人空间；第一期不提前实现团队模型。

## 3. 总体架构

```text
┌──────────────────────────── 单域名单部署 ────────────────────────────┐
│                                                                     │
│  /app/*                  /admin/*                                   │
│  用户端 React             管理端 React                                │
│       │                       │                                     │
│       └──────────── HTTPS / Same Origin ────────────┐               │
│                                                     ▼               │
│                                          ┌──────────────────────┐   │
│                                          │ Gin HTTP Server      │   │
│                                          │ User/Admin API       │   │
│                                          │ Static SPA           │   │
│                                          └──────────┬───────────┘   │
│                                                     │               │
│                       同一个 Go 进程                 │               │
│                                          ┌──────────▼───────────┐   │
│                                          │ Worker Supervisor    │   │
│                                          │ Claim + ants Pools   │   │
│                                          └──────────┬───────────┘   │
└─────────────────────────────────────────────────────┼───────────────┘
                                                      │
                           ┌──────────────────────────┼──────────────┐
                           ▼                          ▼              ▼
                     MySQL 8.0               S3 / Local Blob   AI Provider
                                                                  │
                                                        OpenAI / 火山引擎
```

### 3.1 部署路径

```text
/app/*                 用户端 SPA
/admin/*               平台管理端 SPA
/api/v1/*              用户 API
/api/admin/v1/*        平台管理 API
/healthz               进程存活检查
/readyz                MySQL、存储等依赖就绪检查
/metrics               Prometheus 指标，仅内网或受保护访问
```

前端建议构建为一个 Web 产物，按 `/app` 和 `/admin` 做路由级代码分割。Go 使用 `embed.FS` 或部署目录读取静态产物，由同一个 Gin 服务返回，保持单一部署单元和同源 Cookie，不引入跨域配置。

第一期部署边界：

- 生产固定 `replicas = 1`；模型并发、熔断、限流、配置缓存和 Worker 容量均定义为进程级能力。
- 使用 S3 也不代表已经支持多副本；多副本需要全局并发、限流、配置广播和 GC 选主方案，第一期不提前实现。
- 本地 Blob 生产部署必须挂载专用持久卷，临时对象、正式对象和 fileblob 临时文件必须位于同一文件系统。
- MySQL 与本地 Blob 必须形成同一恢复点的备份方案；只恢复数据库或只恢复文件目录都不能视为有效恢复。

### 3.2 单进程生命周期

进程启动顺序：

1. 加载并校验配置。
2. 初始化 `slog` 日志。
3. 连接 MySQL，检查 schema version；生产 schema 变更由发布前一次性 `server migrate up` 执行，常驻进程不自动 migration。
4. 初始化 Blob Bucket、Provider Client、Repository 和 Service。
5. 启动任务恢复扫描器、按 workload 领取的 claim 协程和有界 ants Pools。
6. 启动 Gin HTTP Server。

优雅停机顺序：

1. 收到 `SIGINT` / `SIGTERM` 后立即将 readiness 标记为 false，但不立即取消在途任务根 context。
2. Worker Supervisor 停止领取新任务。
3. HTTP Server 停止接收新请求，并等待短请求 drain。
4. Worker 在独立 drain context 内继续维护心跳并等待完成。
5. 达到 Worker 宽限期后取消剩余任务，由租约和 `result_uncertain` 规则恢复或转人工处理。
6. Flush 日志并关闭 MySQL、Blob Bucket 等资源；部署平台 termination grace 必须大于 HTTP 与 Worker drain 总时限。

禁止创建没有生命周期所有者的 goroutine。所有阻塞 IO、数据库、存储和 Provider 调用必须接收并传播 `context.Context`。

## 4. Go 工程目录

建议在仓库根目录新增 `server/`，第一期保持单个 Go Module：

```text
server/
├── cmd/
│   └── server/
│       └── main.go                 # API + Worker 唯一进程入口
├── api/
│   └── openapi.yaml                # 用户端和管理端 API 合同
├── conf/
│   ├── app.yaml                    # 系统默认入口配置，不含真实密钥
│   ├── database/mysql.yaml
│   ├── session/session.yaml        # cookie / redis Store 选择
│   ├── session/redis.yaml
│   ├── mail/smtp.yaml
│   ├── storage/storage.yaml
│   ├── model/models.yaml
│   ├── model/prompts/<capability>/vN.tmpl
│   ├── model/capabilities/<catalogVersion>.yaml
│   ├── worker/worker.yaml
│   ├── log/log.yaml
│   ├── observability/observability.yaml
│   └── security/security.yaml
├── migrations/                     # 显式 MySQL up/down SQL
├── internal/
│   ├── app/                        # 依赖装配、启动、优雅停机
│   ├── config/                     # Viper 配置加载与边界校验
│   ├── http/
│   │   ├── handler/                # Gin handler，仅做边界转换
│   │   │   ├── user/
│   │   │   └── admin/
│   │   ├── middleware/             # 认证、权限、日志、恢复、限流
│   │   └── router/                 # /app、/admin、API 路由注册
│   ├── service/                    # 各业务模块用例编排
│   │   ├── auth/
│   │   ├── mail/
│   │   ├── user/
│   │   ├── asset/
│   │   ├── generation/
│   │   ├── model/
│   │   │   └── provider/
│   │   │       ├── openai/
│   │   │       └── volcengine/
│   │   ├── setting/
│   │   ├── credit/
│   │   ├── admin/
│   │   └── systemconfig/
│   ├── repository/                 # GORM 与必要的原生 SQL
│   ├── models/
│   │   ├── entity/                 # MySQL / GORM 映射结构体
│   │   ├── dto/generated/          # OpenAPI 生成的 HTTP DTO，禁止手改
│   │   └── mapper/                 # Entity / Service View / DTO 显式映射
│   ├── worker/                     # Supervisor、领取、租约、ants Worker Pool
│   └── storage/                    # Go CDK Blob 初始化与业务键策略
├── lib/
│   ├── apperror/                   # 统一错误码和错误类型
│   ├── constant/                   # 状态、错误码、Header、分页等全局常量
│   ├── logger/                     # slog / logit 初始化
│   ├── response/                   # Gin 错误响应写出
│   └── helper/                     # 已有跨模块复用需求的小函数
├── test/
│   ├── integration/
│   └── fixtures/
├── go.mod
└── go.sum
```

配置约束：

- 所有静态配置只能位于 `server/conf/`；默认入口固定为 `server/conf/app.yaml`，其他配置按领域放入子目录。
- `app.yaml` 只保存环境无关默认值和各领域配置引用。数据库密码、SMTP 密码、Session 密钥、Redis 密码和 Provider API Key 必须由环境变量或部署 Secret 覆盖，禁止提交真实值。
- 配置加载顺序固定为：领域默认 YAML -> `app.yaml` 覆盖 -> 环境变量 / Secret 覆盖。启动时完成结构校验；选择 Redis Session Store 但 Redis 不可用时快速失败。
- YAML 是部署级启动配置；管理员在线修改的是 `system_configs` 中的业务全局配置。数据库连接、Cookie 加密密钥等启动级敏感配置不能在线修改。

### 4.1 分层约束

```text
Gin Handler -> Service -> Repository / Storage / Provider
                    │
                    └-> Worker 使用同一 Service，不复制业务逻辑
```

- Handler 只做参数绑定、边界校验、调用 Service 和 DTO 转换。
- Service 持有业务状态机、权限后的用例编排和事务边界；内部输入 / 输出分别使用领域 Command / View，不直接传递 HTTP DTO。
- Repository 负责 GORM 查询、事务和 MySQL 8.0 专用原生 SQL。
- Entity 不直接作为 JSON 返回，避免数据库字段和敏感字段泄漏到 API。
- OpenAPI 生成类型是唯一 HTTP DTO 事实源，保留在 `internal/models/dto/generated`；禁止再手写第二套 HTTP DTO。DTO 不包含 GORM tag，不被 Repository 使用。
- Mapper 必须是显式纯函数，不使用反射式自动拷贝组件。
- Provider SDK 只能出现在 `service/model/provider/*`，不能被 Handler 或其他业务模块直接调用。
- Worker 调用 generation Service 的执行入口，不能建立第二套任务状态规则。

### 4.2 `lib` 边界

`lib` 只保存确实跨模块复用的基础能力，不建立无边界的 `utils` 大包：

- `apperror`：稳定错误码、HTTP status 和可安全展示的中文消息。
- `constant`：整数错误码、状态 `TINYINT` 映射、Header 名、上下文键、分页上限等跨模块常量。
- `logger`：日志初始化和 `slog.Handler` 装配。
- `response`：统一错误响应，不承载业务逻辑。
- `helper`：只有出现当前真实复用时才增加函数。

所有 `status` 字段统一在 `server/lib/constant/` 下按领域拆分强类型常量文件，例如 `generation_status.go`、`job_status.go`、`credit_status.go`，禁止不同领域状态互相比较；模型类别等稳定跨模块枚举也放入 `constant`。仅供单一领域使用的非状态规则仍留在对应 Service 模块。

## 5. API 合同

API 使用 OpenAPI contract-first，后端通过 `oapi-codegen` 生成 Gin 接口骨架，前端通过 `openapi-typescript` 生成 TypeScript 类型。生成代码禁止手改。OpenAPI 业务合同只允许 `GET` 和 `POST`：GET 必须只读，所有创建、修改、删除、取消、重试、验证码发送等操作统一使用动作式 POST 路径。Gin `NoMethod` 对 PUT、PATCH、DELETE、HEAD、OPTIONS、CONNECT、TRACE 等其他方法统一返回 HTTP 405 和整数错误码；系统同源部署，不注册 CORS 预检路由。

### 5.1 用户 API

```text
GET    /api/v1/auth/csrf-token
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/email-codes/send
POST   /api/v1/auth/email-codes/verify
POST   /api/v1/auth/password-reset/request
POST   /api/v1/auth/password-reset/confirm
GET    /api/v1/profile
POST   /api/v1/profile/update

POST   /api/v1/assets/uploads/prepare
POST   /api/v1/assets/uploads/complete
POST   /api/v1/assets/upload              # 本地存储流式上传
GET    /api/v1/assets
GET    /api/v1/assets/{assetId}
POST   /api/v1/assets/{assetId}/delete

GET    /api/v1/capabilities
POST   /api/v1/ai-assist/rewrites/stream      # 仅 AI 改写，响应 text/event-stream
POST   /api/v1/generation-tasks
GET    /api/v1/generation-tasks
GET    /api/v1/generation-tasks/{taskId}
GET    /api/v1/generation-tasks/{taskId}/events
POST   /api/v1/generation-tasks/{taskId}/cancel
POST   /api/v1/generation-tasks/{taskId}/retry

GET    /api/v1/settings
POST   /api/v1/settings/update
GET    /api/v1/credits
GET    /api/v1/credits/ledger
```

第一期通信策略固定为“AI 改写使用 SSE，其他异步状态使用短间隔 polling”。`POST /api/v1/ai-assist/rewrites/stream` 只承载 AI 帮写 / AI 改写的文本增量，不作为通用任务进度通道；图片生成、任务历史、邮件、导出和管理端任务状态继续轮询现有 GET API。任务 DTO 继续保留事件序号和状态版本，第一期不为这些场景增加 SSE，也不引入 WebSocket。`GET /generation-tasks/{taskId}/events` 支持 `afterSequence + limit` 增量返回事件，按 sequence 升序且客户端按 sequence 去重；`GET /generation-tasks/{taskId}` 响应携带最新 task version，前端忽略低版本响应，并在 `completed / failed / cancelled` 终态停止 polling。`result_uncertain / reconciling` 不是终态，应降低轮询频率后继续查询。

### 5.2 管理 API

```text
GET    /api/admin/v1/auth/csrf-token
POST   /api/admin/v1/auth/login
POST   /api/admin/v1/auth/logout
GET    /api/admin/v1/users
GET    /api/admin/v1/users/{userId}
POST   /api/admin/v1/users/{userId}/disable
POST   /api/admin/v1/users/{userId}/enable
GET    /api/admin/v1/tasks
POST   /api/admin/v1/tasks/{taskId}/cancel
GET    /api/admin/v1/model-configs
POST   /api/admin/v1/model-configs/create
POST   /api/admin/v1/model-configs/{configId}/update
POST   /api/admin/v1/model-configs/{configId}/delete
POST   /api/admin/v1/model-configs/{configId}/test
GET    /api/admin/v1/system-configs
POST   /api/admin/v1/system-configs/update
POST   /api/admin/v1/mail/test
GET    /api/admin/v1/storage/usage
POST   /api/admin/v1/users/{userId}/credits/recharge
GET    /api/admin/v1/users/{userId}/credits/ledger
GET    /api/admin/v1/credits/uncertain-runs
POST   /api/admin/v1/credits/uncertain-runs/{runId}/reconcile
POST   /api/admin/v1/credits/uncertain-runs/{runId}/confirm-recovered-outputs
POST   /api/admin/v1/credits/uncertain-runs/{runId}/mark-no-result
GET    /api/admin/v1/audit-logs
```

用户 Session 与管理 Session 使用不同 Cookie 名、作用路径和中间件。管理端必须支持 MFA 后才能进入正式商用；第一期内部测试若暂不实现 MFA，必须限制管理入口的网络访问范围并记录为上线阻塞项。

用户端和管理端 CSRF Token 分别由对应 `GET .../auth/csrf-token` 在匿名状态签发，以 JSON 字段和固定响应 Header 返回 masked token；响应固定设置 `Cache-Control: no-store, private` 和 `Vary: Cookie`，禁止 CDN 缓存。前端后续 POST 使用约定 Header 回传。两端使用独立 CSRF Cookie、认证 key 和 Path。登录成功重新签发 Session 后必须刷新 CSRF Token；Token 过期或校验失败时前端只能重新获取一次，禁止自动重放原业务 POST。

所有列表接口必须分页，禁止提供“返回全部”开关。普通列表统一接收 `page`、`pageSize`，默认 1 / 20，`pageSize` 最大 100，并返回 `list`、`total`、`page`、`pageSize`。`task_events`、`credit_ledger`、`model_invocations`、`ai_assist_invocations` 等高增长列表使用 `(created_at, id)` 游标分页，返回 `nextCursor` 和 `hasMore`；所有分页排序必须包含唯一键保证稳定性。`GET /api/v1/credits/ledger` 只查询当前 Session 用户，支持按流水类型和时间范围筛选，默认按 `(created_at, id)` 倒序返回，禁止通过请求参数覆盖 `user_id`。管理端指定用户流水接口复用相同游标合同，但必须校验独立积分查看权限，并记录管理员、目标用户、筛选范围和 request ID 的访问审计；不得复用用户 Session 或绕过 DTO 脱敏。

### 5.3 错误合同

统一错误响应：

```json
{
  "code": 140404,
  "message": "生成任务不存在",
  "requestId": "01J..."
}
```

```go
type ErrorResponse struct {
    Code      int    `json:"code"`
    Message   string `json:"message"`
    RequestID string `json:"requestId"`
}
```

规则：

- `lib/apperror` 使用 `int` 定义稳定错误码、HTTP status、安全消息和 cause；错误码按模块划分号段，禁止直接返回字符串错误码。
- 建议号段：`100xxx` 通用、`110xxx` 认证、`120xxx` 用户、`130xxx` 资产、`140xxx` 生成、`150xxx` 模型、`160xxx` 配置 / 邮件、`170xxx` 积分、`190xxx` 管理端。HTTP status 表示协议结果，`code` 表示稳定业务原因，两者不得混用。
- Service 返回业务错误，不依赖 Gin。
- 全局错误中间件使用 `errors.Is` / `errors.As` 映射响应。
- MySQL、存储和 Provider 原始错误只进入脱敏内部日志，不直接返回前端。
- 不返回堆栈、SQL、对象路径、Provider response、Prompt 或密钥。

### 5.4 业务幂等合同

创建生成任务、AI 改写流、用户主动重试、上传 complete、管理员积分充值、积分不确定状态对账等会创建资产、产生外部调用或变更积分的 POST 必须携带 `Idempotency-Key`：

- `idempotency_records` 对 `(actor_type, actor_id, operation, idempotency_key_hash)` 建立唯一约束，并保存 `request_hash`、状态、资源类型 / ID、响应 HTTP status / 业务 code 和过期时间。
- `request_hash` 必须基于边界校验、默认值填充和字段规范化后的 Service Command 计算，禁止直接对原始 JSON 字节做 hash。
- 同 key、同 request hash 返回第一次创建的稳定资源；同 key、不同请求返回 HTTP 409 和整数幂等冲突错误码。
- 首次生成时，幂等记录、task、首个 run、积分预留和 async job 必须在同一个 MySQL 事务提交。
- 事务型幂等用于创建 task / run、管理员充值和纯数据库对账；唯一键抢占、业务变更和幂等结果在同一短事务完成。
- 上传 complete 等包含 Blob IO 的操作使用 Saga 型幂等：`idempotency_records` 只映射稳定 upload session / operation ID，`asset_upload_sessions` 通过 `status + owner_token + lease_expires_at + version` 短事务抢占执行权，事务外完成 HEAD、流式校验和对象提交，再用短事务写完成结果。相同 key 遇到处理中状态时返回已有 operation 状态，禁止重复执行 Blob 操作。
- 导出等异步外部操作由 `async_jobs` 持有 lease；第一期不把 `idempotency_records` 扩展成第二套通用 Saga 或任务队列。
- 幂等记录只保存资源引用和安全响应摘要，不保存 Cookie、验证码、Prompt、图片或 Provider response。
- 普通资料更新使用 `version` 乐观锁即可，不为所有 POST 强制增加幂等记录。

### 5.5 AI 改写 SSE 合同

AI 改写 SSE 直接映射现有 `AiAssistPort.streamProductSellingPoints` 一类轻量文本流能力，不创建 `generation_task`，不进入 `async_jobs`，也不扣图片生成积分。由于请求体包含结构化图片引用和改写参数，前端使用 `fetch` + `ReadableStream` 发起 POST 并消费 SSE，不使用只支持 GET 的原生 `EventSource`。

响应固定设置：

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```

事件合同固定为：

```text
event: meta
data: {"requestId":"...","aiAssistInvocationId":"...","replayed":false}

event: delta
data: {"sequence":1,"text":"增量文本"}

event: done
data: {"sequence":2,"result":{"text":"最终聚合文本"}}

event: error
data: {"sequence":2,"code":150409,"message":"可安全展示的错误"}
```

- 该 endpoint 仅接受服务端白名单内的纯文本帮写 / 改写 capability；图片生成、图片识别和通用任务订阅请求直接拒绝，不能把它演变成通用事件总线。
- `meta` 和心跳 comment 不参与 sequence；`delta` 使用 `1..K`，唯一终态事件 `done | error` 使用 `K+1`。终态事件后禁止继续写入任何业务事件。Handler 在发送 headers 前发生错误时返回普通 JSON `ErrorResponse`，开始流后发生错误只发送一次 `error` 事件并关闭连接。
- Handler 只发送业务归一化后的文本增量和最终结果，禁止透传 Provider 原始 SSE chunk、raw response、usage 原文、模型内部事件、Prompt 或凭据。所有事件 payload 必须通过 `encoding/json` 序列化为单条 `data:`，禁止把模型文本直接拼接进 SSE 帧；每个事件设置字节上限并保证 UTF-8 字符完整，避免换行或伪造 `event:` / `data:` 造成事件注入。
- SSE Handler 直接调用 `AiAssistService` 并传播请求 context。Provider 正常结束后先聚合并校验最终文本，再在同一事务中以 `running + version` 为条件把父 `ai_assist_invocation` 和最后一个 `model_invocation` 提交为 `completed`，事务成功后才能发送 `done`；持久化失败只能发送 `error`。客户端断开时取消 Provider context、停止写流，并且只允许把仍为 `running` 的父子调用 CAS 为 `cancelled_by_client`，不得覆盖已提交的 `completed`，也不能把客户端取消计入 Provider failure。任一终态先成功提交后，晚到结果都不得覆盖。第一期不实现 `Last-Event-ID`、服务端增量事件持久化或自动断点续传，用户明确点击“重新帮写”时使用新的 Idempotency-Key 发起新请求。
- `ai_assist_invocations` 保存用户、capability、request hash、幂等键引用、状态、最终归一化结果、整数错误码、`deadline_at`、开始 / 完成时间和 version，不保存输入图片内容、完整 Prompt、Provider raw response 或流式 delta。相同 key 正在执行且未过 deadline 时返回 HTTP 409 和 `150409` 整数错误码（内部常量名 `AI_REWRITE_IN_PROGRESS`）；`completed` 用 `replayed:true` 的 `meta + done` 合成流，`failed / cancelled` 用 `replayed:true` 的 `meta + error` 合成流，均不得重复调用 Provider。重试必须使用新 Idempotency-Key。启动恢复和同 key 查询发现超过 `deadline_at` 的 `running` 时，以 version CAS 转为 `failed_interrupted`，避免永久占用幂等键。
- 按 capability 在服务端限制请求体字节数、输入字符数、资产引用数量、Provider `max_output_tokens`、单事件及累计输出字节数和最大流持续时间；任一上限触发时取消 Provider context，发送归一化整数错误码后关闭。SDK 到 Handler 之间使用有界 channel，并在客户端写入变慢时通过 context 反压或取消，禁止无界缓存 delta。
- SSE POST 与其他业务 POST 一样校验用户 Session、CSRF 和限流；同时限制用户 / IP 请求频率、单用户并发流及单进程活跃流总数。心跳使用 SSE comment，间隔在 `server/conf/app.yaml` 配置且小于整条链路的最短 idle timeout；反向代理 buffering 必须实际关闭，代理 idle timeout、Go HTTP write deadline 和模型 timeout 必须大于约定的最大流持续时间并保留安全余量。Gin 的压缩中间件必须跳过该路由，响应不得设置 `Content-Length`，每个事件写入后显式 flush；部署验收必须验证网关 / CDN 未缓存、缓冲或转换流内容，不能只依赖 `X-Accel-Buffering` Header。
- 对外 `aiAssistInvocationId` 始终指向父 `ai_assist_invocations.id`，不得暴露内部 `model_invocations.id`；候选降级产生的多个内部调用统一通过 `subject_type=ai_assist_invocation + subject_id` 审计。
- 日志、Trace event / span attribute 和 Metrics label 均不得记录用户输入正文、delta 或最终改写文本；只记录 AI assist invocation ID、capability、状态、整数错误码、输入 / 输出字节或 token 数、首个增量耗时和总耗时。
- 图片生成和其他长任务不得复用此 SSE endpoint；它们继续通过 `GET /generation-tasks/*` polling，避免把单进程内的瞬时连接通道扩展成通用消息系统。

## 6. MySQL 设计

### 6.1 兼容基线

- 数据库版本固定为 MySQL 8.0.46，所有表使用 InnoDB。开发、CI、测试和生产必须锁定相同版本；数据库供应商延长支持与漏洞响应属于发布门禁，不由应用代码兜底。
- 数据库、表和普通文本列统一使用 `utf8mb4` + `utf8mb4_0900_ai_ci`。该 collation 对普通字符串比较和 `LIKE` 默认不区分大小写，查询不得再包裹 `LOWER()` / `UPPER()`。
- Token、Hash、对象 key、幂等摘要等精确值使用 `BINARY` / `VARBINARY` 或 binary collation，不能被大小写折叠。
- 所有表名固定为小写 `snake_case`。数据 collation 不控制表名大小写，禁止依赖操作系统相关的 `lower_case_table_names` 行为。
- 结构化快照使用 MySQL 原生 `JSON`；只为实际查询字段建立生成列或索引，不对任意 JSON 路径过度索引。
- 所有日期时间列，包括创建、更新、删除、过期、领取、心跳和完成时间，统一使用 `DATETIME(3)` 并保存 UTC；DSN 使用 `parseTime=true&loc=UTC`，连接初始化设置 `time_zone='+00:00'`。
- 所有 `status` 列使用 `TINYINT UNSIGNED`，Go 通过 `server/lib/constant` 中的具名 `uint8` 类型常量映射，不使用 `ENUM` 和裸数字。
- 所有业务数据表都包含 `version BIGINT UNSIGNED NOT NULL DEFAULT 1`。GORM 使用官方 `gorm.io/plugin/optimisticlock`；更新必须携带非零版本并检查 `RowsAffected == 1`，冲突返回 HTTP 409 和稳定整数错误码。
- Repository 禁止通过零值 Version、`Unscoped`、无条件批量更新或不受控 `Save` 绕过乐观锁；队列 lease fencing 与业务 `version` 各自解决不同并发问题，不能互相替代。
- ID 推荐使用 `google/uuid` 的 UUIDv7，数据库保存 `BINARY(16)`，API 输出标准字符串。
- GORM `AutoMigrate` 只允许测试环境使用，生产 schema 必须由 Goose 显式 SQL migration 管理。

可变聚合表 DDL 基线：

```sql
status TINYINT UNSIGNED NOT NULL DEFAULT 1,
version BIGINT UNSIGNED NOT NULL DEFAULT 1,
created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ON UPDATE CURRENT_TIMESTAMP(3),
deleted_at DATETIME(3) NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
```

migration 元数据等框架表不属于业务数据表，可按组件要求定义；其余由本项目管理的业务表均不得省略 `version`。可变聚合使用 `version` 做乐观锁；追加型审计 / 流水表固定 `version = 1` 并禁止 UPDATE / DELETE，不强制设置没有业务意义的 `updated_at`、`deleted_at`。

### 6.2 核心表

```text
users                       用户与状态
user_passwords              密码 hash 和密码版本
email_verification_codes    邮箱验证码 hash、用途、过期和尝试次数
email_verification_grants   验证成功后的短期一次性凭证
admin_users                 平台管理员
admin_audit_logs            管理操作审计
system_configs              管理员可维护的全局业务配置
security_rate_limit_windows 登录、验证码等关键安全限流状态

assets                      图片资产元数据和 Blob key
asset_upload_sessions       prepare / complete 上传会话和临时对象
generation_tasks            用户的一次生成意图与聚合展示状态
generation_runs             一次真实执行、冻结计划和积分状态
generation_run_outputs      每次执行产生的不可变输出
generation_task_input_assets 任务输入资产关系
generation_assets           用户可见稳定结果槽，引用采用的 run output
task_events                 结构化任务事件
ai_assist_invocations       AI 改写调用状态、幂等和最终归一化结果
model_invocations           生成 run / AI 改写的模型调用审计摘要与 usage
async_jobs                  唯一数据库任务队列表：生成、邮件、GC 等
idempotency_records         HTTP 写操作业务幂等记录

model_configs               四类模型的多候选路由配置及模型级积分单价，不含密钥明文
user_settings               用户设置
credit_accounts             用户可用 / 预留积分账户
credit_reservations         每个 generation run 的候选模型最高价预留与实际价结算
credit_ledger               充值、预留、逐输出消费、释放的不可变积分流水及模型价格快照
```

`system_configs` 至少包含 `config_group`、`config_key`、`value_json`、`value_type`、`secret_ref`、`description`、`status`、`version` 和日期时间字段，并建立 `(config_group, config_key)` 唯一索引。邮件主机、端口、发件人、TLS 策略、验证码有效期等可由管理员维护；SMTP 密码和 Provider API Key 只能写入部署 Secret 或经确认的 Secret Manager，表内只保存 `secret_ref`，管理 API 不回传明文。

第一版必须在 migration 前冻结唯一约束和删除策略，不依赖 GORM tag 推断：

```text
users.email_canonical                                  UNIQUE
user_settings.user_id                                  UNIQUE
credit_accounts.user_id                                UNIQUE
generation_runs(task_id, run_no)                       UNIQUE
generation_assets(task_id, slot_code)                  UNIQUE
generation_run_outputs(run_id, slot_code)              UNIQUE
task_events(task_id, sequence)                          UNIQUE
credit_reservations.generation_run_id                  UNIQUE
credit_ledger(account_id, operation, run_id, slot_code) UNIQUE（consume）
model_invocations(subject_type, subject_id, invocation_key) UNIQUE
```

外键只用于同一业务聚合内、不会阻碍追加审计和分批清理的强关系；跨生命周期关系可以使用逻辑外键，但 Repository 必须显式校验。Migration 设计记录每条关系的事实源、`ON DELETE` 策略、软删除语义和保留期限。用户、资产或任务的删除不得级联物理删除审计、积分流水或仍被历史任务引用的 Blob。

核心关系矩阵固定为：

```text
generation_runs.task_id
  -> generation_tasks.id                       物理 FK / ON DELETE RESTRICT
generation_task_input_assets.task_id
  -> generation_tasks.id                       物理 FK / ON DELETE RESTRICT
generation_task_input_assets.asset_id
  -> assets.id                                  物理 FK / ON DELETE RESTRICT
generation_run_outputs.run_id
  -> generation_runs.id                         物理 FK / ON DELETE RESTRICT
generation_run_outputs.asset_id
  -> assets.id                                  物理 FK / ON DELETE RESTRICT
generation_run_outputs.model_invocation_id
  -> model_invocations.id                       物理 FK / ON DELETE RESTRICT
generation_run_outputs.model_config_id
  -> model_configs.id                           物理 FK / ON DELETE RESTRICT
generation_assets.task_id
  -> generation_tasks.id                       物理 FK / ON DELETE RESTRICT
generation_assets.adopted_run_output_id
  -> generation_run_outputs.id                 物理 FK / ON DELETE RESTRICT，可空
credit_accounts.user_id
  -> users.id                                   物理 FK / ON DELETE RESTRICT
ai_assist_invocations.user_id
  -> users.id                                   物理 FK / ON DELETE RESTRICT
credit_reservations(account_id, generation_run_id)
  -> credit_accounts.id, generation_runs.id    物理 FK / ON DELETE RESTRICT
credit_ledger.account_id
  -> credit_accounts.id                         物理 FK / ON DELETE RESTRICT
credit_ledger.output_id / model_invocation_id / model_config_id
  -> generation_run_outputs.id / model_invocations.id / model_configs.id
                                                物理 FK / ON DELETE RESTRICT，非消费流水可空
model_invocations(subject_type, subject_id)             多态逻辑 FK，仅允许 generation_run / ai_assist_invocation
async_jobs(aggregate_type, aggregate_id)         多态逻辑 FK，由 Service 校验
idempotency_records(resource_type, resource_id) 多态逻辑 FK，由 Service 校验
```

第一期业务实体只做软删除，强关系不使用级联物理删除；达到保留期后的 purge 由 Service 按明确顺序分批执行，审计、task events、run outputs 和积分流水继续遵守各自保留策略。

邮箱同时保存用户输入的展示值与唯一的 `email_canonical`。规范化规则固定为：去除首尾空白、校验地址结构、域名执行 IDNA 规范化后转小写；第一版产品规则将 local-part 同样转小写，不实现 Gmail 点号、加号等厂商特例。`email_canonical` 使用 binary collation 或等价 `VARBINARY` 精确比较后建立唯一索引，禁止依赖普通文本的 `utf8mb4_0900_ai_ci` 唯一性语义。

第一期用户软删除后邮箱仍被唯一索引占用，不允许用同一邮箱重新注册；管理员可以按审计流程恢复原账户。永久注销、法定删除和邮箱匿名化属于后续独立数据治理方案，不能通过临时修改唯一键绕过。

同一领域配置建议以一个经过 schema 校验的 JSON 文档原子更新，避免逐 key 修改产生半配置状态。MySQL 是运行时全局配置的事实源；进程内只允许有界只读快照缓存，管理员更新成功后按 `config_group + version` 失效 / 替换，新请求使用新版本，在途任务继续使用启动时冻结的配置快照。每次变更必须写 `admin_audit_logs`。

允许为明确的管理端检索场景增加 `user_email_snapshot`、`provider_code`、`model_name_snapshot` 等冗余列，但必须说明事实源、快照语义和同事务同步规则。普通查询优先避免复杂 JOIN：先分页主表，再通过有界 `IN` 查询关联数据；禁止 N+1、无界关联预加载和为了省一次查询而复制不稳定业务事实。

### 6.3 生成执行模型与持久计划

```text
generation_task
  └── generation_run
        ├── async_job
        ├── model_invocations
        └── generation_run_outputs
                  │
                  └── generation_assets（用户可见稳定结果槽）
```

- `generation_tasks` 保存用户的一次稳定生成意图；初次执行和每次用户主动重试都创建新的 `generation_runs`，不覆盖历史 run。
- `async_jobs.aggregate_id` 对生成任务必须指向 `run_id`，不直接调度 task。队列自身的网络 / DB 重试可继续使用同一个 run，但是否创建新 invocation 必须由错误分类决定。
- `assets` 是唯一 Blob 元数据事实源；`generation_run_outputs.asset_id` 引用 `assets.id`，不重复保存完整 Blob 字段；`generation_assets` 只维护 `(task_id, slot_code) -> adopted_run_output_id` 的用户可见稳定结果槽，并使用显式 CAS 更新。
- `generation_tasks` 的原始审计终态不因后续重试被覆盖；用户可见聚合状态由稳定结果槽、当前未隐藏 run 和失败槽派生。允许落库有版本的 `display_status` 冗余快照，但必须在结果槽或 run 终态事务内同步更新，查询时不得混用多套来源。
- `generation_runs` 在创建时持久化不可变 `execution_plan_json`、`execution_plan_hash` 和 `plan_version`，不能只在 Worker 内存冻结配置。
- 执行计划至少保存 capability / 版本、Prompt 模板 ID / 版本 / hash、用户结构化业务输入、输入资产 ID / 版本 / SHA-256、候选模型顺序及其配置快照、生成参数、总 deadline，以及每个候选 `model_config_id + model_config_version + billing_unit + unit_points`；管理员调价不得改变在途 run。
- 用户填写的卖点、场景和修改要求属于业务输入，可以持久化；最终编译的 System Prompt、Provider raw prompt / request / response 继续禁止入库。

Prompt 与 Capability 第一版使用 `server/conf/model/prompts/<capability>/vN.tmpl` 和 `server/conf/model/capabilities/<catalogVersion>.yaml` 作为随版本发布、构建时 embed 的不可变 Catalog。已发布并可能被 run 引用的版本只能新增，禁止覆盖或删除；启动时校验 manifest 和 hash。`execution_plan_json` 保存 catalog version、模板 ID / 版本 / hash 和 capability version，确保旧 run 在进程重启或新版本部署后仍可解析；第一版不增加管理端在线编辑 Prompt，也不建立数据库 Prompt 版本表。

输出提交前预生成 `asset_id` 和不可变最终 object key。Provider 结果完成下载与校验后先写 Blob，再开启短 MySQL 事务，并按固定顺序锁定 `generation_run -> async_job -> model_invocation -> credit_account -> credit_reservation`。事务必须重新校验 lease token、run 状态、用户取消状态、实际模型及价格快照、账户 / reservation version 和输出结算键，然后在同一事务内插入并激活 `assets` 元数据、插入带实际模型价格快照的 `generation_run_output`、更新 account 与 reservation、写逐输出 `credit_ledger`、CAS 更新稳定结果槽并同步 `display_status`。任一 CAS 或状态校验失败时整体回滚；Blob 写失败禁止插入可见 output 或扣积分，Blob 写成功但事务失败只留下待分批 GC 的孤儿对象。

多图任务分为两类事务：每张成功图片的结算事务只提交 asset、run output、积分消费、稳定结果槽、run 进度和 display snapshot；最后一张完成或任务明确停止后的终态事务再释放剩余预留，并更新 run / job 终态和 task 聚合快照。两类事务都必须校验 lease token、取消状态和 version，首张成功不得提前把多图 run / job 标记为终态。

### 6.4 模型计价、积分账户与逐图结算

第一版只实现平台积分，不接支付、套餐、过期积分、退款或团队共享余额。计费项固定为 `image_generation`，计费单位固定为 `per_successful_image`，积分统一使用 `BIGINT` 整数。`model_configs` 是唯一价格事实源，不再使用全局统一图片单价：

- 每个可用于文生图或图生图的 `model_configs` 必须配置 `billing_enabled`、`billing_unit` 和 `unit_points`。`unit_points` 允许 0 表示该模型免费，禁止负数；第一期文生文和图生文不扣积分，其模型配置必须显式为免费，不能借此字段提前实现 token 计费。
- 创建或更新模型价格只能通过管理端模型配置 Service；价格变化递增实体 `version`，该 `model_config_version` 同时作为价格快照版本，并写 `admin_audit_logs` 的旧值 / 新值、原因和操作者，避免维护第二套定价版本。价格不再写入 `system_configs`，原计划中的独立 `credit-rules` API 取消。
- 创建 run 时冻结全部候选模型的 ID、模型配置版本、计费单位和积分单价。提交前端可展示预计冻结积分，但最终消费以实际成功输出关联的模型价格快照为准；配置更新不得修改在途 run 或历史流水。
- 为保证候选降级后仍有足够余额，提交生成时按照“冻结候选中的最高 `unit_points` × requested_image_count”原子预留积分；余额不足则不创建 task / run / job。禁止只按首选模型低价预留后，在 Worker 内临时追加扣款。
- `generation_run_outputs` 必须关联实际产生该输出的 `model_invocation_id`，并冗余保存 `model_config_id`、安全展示名称、Provider / model 标识、`model_config_version`、`billing_unit` 和 `unit_points_snapshot`。候选降级后只能按实际成功模型的冻结单价消费，禁止仍按首选模型计价。
- 只有图片已通过校验、Blob 已成功提交且 `generation_run_outputs` 已激活为用户可见候选输出时才扣积分；失败图片不扣，部分成功逐张扣，用户后续删除图片不退款。实际单价不得超过该 run 冻结的最高预留单价；违反时结算失败并告警，禁止透支或临时采用新价格。
- 每个成功稳定槽通过唯一结算键 `consume:{run_id}:{slot_code}` 将该输出实际单价从 reserved 转为 consumed，并写一条独立 `credit_ledger` 消费流水；`generation_run_output_id` 只作为审计引用，不作为幂等身份。同一 `(run_id, slot_code)` 无论 Worker 重试、恢复查询或重新生成 output ID 都只能消费一次。run 明确失败、取消或部分成功终结时释放“最高价预留 - 已按实际模型消费”的全部剩余积分。
- Provider 结果不确定时，已明确成功的稳定槽正常消费，已明确失败的槽和最高候选价差立即释放；只按“不确定 invocation 的冻结单价 × 仍未决 slot 数”保留 `uncertain_hold`，禁止冻结整个 run 的剩余最高价额度，也不自动再次调用。管理员对账取得、校验并成功采用输出后按该 invocation 冻结价格逐槽结算，确认无结果或超过既定 SLA 后释放未消费 hold，SLA 后晚到费用不得追扣用户。
- 管理员充值只接受正整数积分、原因和幂等键；同一事务锁定账户、增加 available、写 `credit_ledger` 和 `admin_audit_logs`。第一版不提供负数调账。

账户变动必须使用行锁加显式 version / CAS，并写不可变流水；禁止绕过 Service 直接修改余额。`credit_accounts` 至少保存 available、reserved、累计充值和累计消费；`credit_reservations` 以 `generation_run_id` 唯一，记录 requested count、候选最高单价、pricing plan hash、planned / reserved / consumed / released；`credit_ledger` 禁止 UPDATE / DELETE。

每次逐图消费流水至少保存 `account_id`、`user_id`、operation、points、task / run / output ID、slot code、实际 `model_invocation_id`、模型计费展示名快照、`unit_points_snapshot`、`model_config_version`、`delta_available`、`delta_reserved`、`available_after`、`reserved_after`、idempotency key hash 和发生时间。用户端 `GET /api/v1/credits/ledger` 只通过显式 Mapper 返回 `id`、operation、billing item、available / reserved delta 与 after、unit points、quantity、公开模型计费展示名、当前用户可访问的 task / output slot 引用、安全描述和发生时间，使用户能够按时间逐笔查看使用情况；预留和释放必须标为冻结 / 解冻，不能伪装成实际消费。DTO 禁止返回 account / user / run / model invocation ID、真实 Provider / model name、配置版本、幂等键、管理员原始备注、密钥、Base URL、endpoint、Prompt 或 Provider 原始数据。

积分事务必须保持以下不变量，并在单元测试、故障注入和定期 reconciliation 中验证：

```text
credit_accounts.available >= 0
credit_accounts.reserved >= 0

credit_reservations.planned
  = credit_reservations.reserved
  + credit_reservations.consumed
  + credit_reservations.released

credit_reservations.planned
  = MAX(frozen_candidate_unit_points) * requested_image_count

credit_reservations.consumed
  = SUM(credit_ledger.points WHERE operation = consume AND reservation_id = ?)

credit_accounts.reserved
  = SUM(credit_reservations.reserved WHERE account_id = ?)
```

预留、消费和释放必须在行锁 / CAS 事务内同步更新 account、reservation 和 ledger。`credit_ledger` 建立 `UNIQUE(account_id, operation, idempotency_key_hash)`，消费流水额外建立 `UNIQUE(account_id, operation, run_id, slot_code)`；定期对账同时核对账户、reservation、稳定槽、输出价格快照和逐笔 ledger，发现不一致时只告警和阻止高风险结算，不自动修改不可变流水。

### 6.5 Entity 与 DTO

```text
internal/models/entity/generation_task.go   # GORM 字段和表名
internal/models/dto/generated/types.gen.go  # OpenAPI 生成的 HTTP DTO
internal/models/mapper/generation.go        # 显式映射
internal/service/generation/command.go      # 内部写用例参数
internal/service/generation/view.go         # 内部查询结果
```

每一个 GORM Entity 都必须以值接收者显式实现静态 `TableName()`，禁止依赖 GORM 自动复数和大小写推断：

```go
func (GenerationTask) TableName() string {
    return "generation_tasks"
}
```

Repository 禁止无条件 `Find`、`Scan`、`Preload` 把全表读入内存。列表查询必须分页；导出、GC、统计和数据修复使用 `FindInBatches` 或流式 `Rows` 固定批次处理。`%keyword%` 模糊查询即使不区分大小写，也通常无法有效使用 B-Tree 索引；第一期优先精确或前缀搜索，任意包含搜索需评估 MySQL FULLTEXT / ngram，并用生产量级数据执行 `EXPLAIN ANALYZE`。

以下字段禁止进入用户 DTO：

- `worker_id`、`lease_token`、`lease_expires_at`。
- Provider、model、base URL、endpoint path。
- API Key、secret ref 和凭据版本。
- raw prompt、system prompt、Provider raw request / response。
- 本地绝对路径、S3 credential 和内部 bucket 信息。

### 6.6 密码存储

新系统使用 Argon2id，不保留 bcrypt 兼容分支。优先采用基于 `golang.org/x/crypto/argon2` 的成熟开源封装并使用 PHC 格式保存算法、参数、salt 和 hash：

- `user_passwords` 保存 `password_hash`、`password_hash_version` 和参数版本；salt 使用密码组件生成的密码学随机值。
- Argon2id 参数必须在生产规格硬件上基准测试，并限制认证并发和密码 UTF-8 字节长度，避免内存消耗型 DoS。
- 登录成功后发现旧参数版本时原子 rehash；密码错误、hash 格式错误和版本不支持返回统一认证错误，不泄漏内部原因。
- 密码重置成功后更新 hash、递增密码版本与 `session_version`，使旧会话失效。

### 6.7 Session 设计

第一期使用 MIT 许可证的 `github.com/gin-contrib/sessions`：

- `server/conf/session/session.yaml` 通过 `store: cookie | redis` 选择 Store，默认 Cookie Store；`server/conf/session/redis.yaml` 保存 Redis 地址、DB、连接池、TLS 和 key prefix 等非敏感项。
- Cookie Store 同时配置认证 key 和加密 key，仅保存 `user_id`、`session_version`、登录时间、认证等级等最小身份数据；完整用户、邮箱、角色事实、积分和任何 secret 不进入 Cookie。
- 认证中间件用 `user_id + session_version` 查询当前用户状态；数据库是用户状态和权限的事实源，停用用户或版本不匹配时立即拒绝并清理 Session。
- Redis Store 只让 Cookie 保存随机 Session ID，服务端设置 TTL、独立 prefix、连接 / 读写 timeout。选中 Redis 但初始化失败时服务启动失败，禁止静默回退 Cookie。
- 用户 Session Cookie 使用 `Path=/api/v1`，管理 Session Cookie 使用 `Path=/api/admin/v1`；两端使用不同 Cookie 名、CSRF Cookie、密钥和中间件，删除时必须使用原 Path。
- Cookie 均设置 `Secure`、`HttpOnly`、合理 `SameSite`，并分别配置 idle TTL 与 absolute TTL；管理 Session TTL 更短，高风险管理操作要求近期重新认证。
- 登录成功后废弃匿名 Session 并重新签发认证 Session，防止 fixation；Cookie Store 支持多组 key pair 轮换，第一组写入，后续组只读取旧 Cookie。
- 密码重置、用户封禁或全端退出时递增 `session_version`，使旧会话失效。
- Cookie 与 Redis Store 的切换需要重启并使已有会话失效，第一期不自研跨 Store 在线迁移。
- Cookie Store 是第一期正式支持基线；单节点 Redis Store 完成目标环境集成测试后正式支持。Redis TLS / Sentinel / Cluster 分别进入支持矩阵，未经验证不得宣称等价生产能力。

### 6.8 邮件验证码与密码重置

第一期 SMTP Adapter 使用 MIT 许可证的 `github.com/wneessen/go-mail`，模板使用标准库 `html/template` + `embed.FS`，不自研 SMTP Client 或模板引擎：

- `server/conf/mail/smtp.yaml` 提供部署默认值和允许的 SMTP host / port / profile allowlist；管理员只能选择部署明确放行的 endpoint，并通过 `system_configs` 维护 profile、from、TLS 策略、timeout、验证码 TTL / 发送间隔等运行时配置，禁止录入任意 host 探测内部网络。内部 SMTP 必须由部署配置显式放行。SMTP 密码只使用 `secret_ref`，管理端只显示已配置 / 未配置。
- 创建 challenge 时使用 `crypto/rand` 生成至少 128 bit nonce，并用独立、版本化的部署 Secret 对 `challenge_id + nonce + purpose + email_canonical` 做 HMAC 确定性派生六位验证码；数字映射需避免明显取模偏差。
- 数据库保存 nonce、`derivation_key_version`、`verification_key_version` 和 code hash，不保存验证码明文；旧派生密钥与旧 verification key 至少保留到对应 challenge 全部过期，不能复用 Session、SMTP 或 Provider 密钥。确定性派生密钥只供 Worker 重建邮件内容，`code_hash` 使用独立 verification pepper 并通过恒定时间比较验证，两者职责不得混用。
- `email_verification_codes.user_id` 允许为空，注册场景以 `email_canonical + purpose` 为主体；保存 attempt / max attempts、固定 expires_at、sent / consumed / superseded 时间、status 和 version。
- 状态固定为 `pending_send / sent / delivery_failed / consumed / superseded / expired`。同一邮件 job 重试重新派生并发送同一个验证码，不能延长 expires_at；用户主动重新发送时才创建新 challenge 并 supersede 旧记录。SMTP 用尽 `max_attempts` 后原子进入 `delivery_failed`。
- Worker 发送前重新确认 challenge 仍是该邮箱和 purpose 下的最新有效记录，且 `expires_at - now` 不小于配置的 `min_delivery_validity`；SMTP 已接收但进程崩溃时，重试只会重复同一个有效验证码。
- 验证成功后签发短期一次性 `email_verification_grants`；grant 保存 token hash、purpose、`email_canonical`、可空 `user_id`、过期时间、消费时间、status 和 version，原始 token 只向客户端返回一次。验证码尝试次数递增、最大次数条件校验、challenge 消费和 grant 签发必须在同一事务内使用条件更新；注册或密码重置事务再原子消费 grant，避免验证码先消费而后续事务失败。
- 发送和校验按 email hash + 可信客户端 IP + purpose 持久限流，对“邮箱是否存在”返回统一文案，防止账号枚举。
- HTTP 请求不阻塞等待 SMTP。Service 在同一事务写 challenge 与 `async_jobs` 邮件 job，job 只引用 challenge / template ID。
- SMTP 调用必须传递 context、设置明确 timeout、生产禁止跳过 TLS 校验。测试邮件、配置更新和发送失败都写管理员审计，但不返回 SMTP raw error 或凭据。

## 7. 数据库表队列与进程内 Worker

### 7.1 唯一通用队列表

`async_jobs` 只负责持久调度，`generation_runs`、`email_verification_codes` 等业务表继续作为业务事实源。创建业务记录和对应 job 必须处于同一个 MySQL 事务，避免“业务已提交但任务未入队”。队列表至少包含：

```text
id, queue_name, job_type, aggregate_type, aggregate_id
payload_version, payload_json
status, priority_sort, available_at
attempt_no, max_attempts
worker_id, lease_token, lease_expires_at, heartbeat_at
idempotency_hash
started_at, finished_at, last_error_code, last_error_at
version, created_at, updated_at
```

`payload_json` 只保存执行所需的非敏感引用，不保存验证码明文、API Key、SMTP 密码、raw prompt、图片 Base64 或 Provider raw response。推荐索引：

```sql
KEY idx_claim(queue_name, status, priority_sort, available_at, id),
KEY idx_recover(status, lease_expires_at, id),
UNIQUE KEY uk_job_idempotency(job_type, idempotency_hash)
```

### 7.2 MySQL 8.0 领取算法

Supervisor 先读取 `ants` 空闲槽位，再以极短事务批量领取不超过空闲槽位数的任务：

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;

SELECT id
FROM async_jobs
WHERE queue_name = ?
  AND status = 0
  AND attempt_no < max_attempts
  AND available_at <= UTC_TIMESTAMP(3)
ORDER BY priority_sort, available_at, id
LIMIT ?
FOR UPDATE SKIP LOCKED;

-- 对每个已锁定 job 分别生成 lease_token，再逐行更新或使用 CASE 批量更新。
UPDATE async_jobs
SET status = 1,
    worker_id = ?,
    lease_token = ?,
    attempt_no = attempt_no + 1,
    heartbeat_at = UTC_TIMESTAMP(3),
    lease_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND),
    started_at = IFNULL(started_at, UTC_TIMESTAMP(3)),
    version = version + 1
WHERE id = ?
  AND queue_name = ?
  AND status = 0
  AND attempt_no < max_attempts;

COMMIT;
```

领取事务内禁止执行网络、存储和模型调用。`SKIP LOCKED` 只用于队列表，不用于要求一致视图的普通业务查询；MySQL binlog 使用 row-based replication。`FORCE INDEX` 只能在生产量级 `EXPLAIN ANALYZE` 证明必要后加入。Claim 死锁或 lock wait timeout 只允许少量、有界、带 jitter 的重试；实际更新数必须等于领取数。

### 7.3 `ants` 执行池与恢复规则

- 使用 `github.com/panjf2000/ants/v2` 创建 `mail_pool`、`generation_pool`、`maintenance_pool` 三个有界执行池；数据库仍是唯一持久队列，`ants` 只是进程内执行器。
- 三个 Supervisor 分别领取 `mail`、`generation`、`maintenance` queue；每个池独立配置 capacity、claim batch、lease、heartbeat 和 job timeout，并统一使用 `Nonblocking=true`。
- `ants` 不保证执行顺序，数据库优先级只保证领取优先级，不承诺完成顺序。
- 配置 panic handler；panic 必须脱敏记录并把 job 标记为失败，不能只 recover 后吞掉。
- 部署资源限制控制进程总并发；每个模型配置继续使用 `golang.org/x/sync/semaphore.Weighted` 作为 generation pool 内的二级并发限制。
- 每次 claim 数量不得超过对应池的真实空闲槽位；`Submit` 失败必须使用 `id + running + lease_token` CAS 立即回队，禁止 running job 滞留在 ants 内存队列。
- 心跳、完成、失败、取消和结果写入必须匹配 `id + running + lease_token`，并递增 `version`；影响行数为 0 时旧 Worker 必须丢弃晚到结果。
- 每类 job 的 lease 必须覆盖外部调用 timeout、结果下载与校验、Blob 提交、数据库终态事务和安全余量；heartbeat 周期不得超过 lease 的三分之一。心跳续租失败时立即取消 Provider context，禁止继续提交结果。
- 恢复过期 generation job 时必须先检查已有 `model_invocation` 和 Provider task / request ID；明确未受理才允许按错误分类重试，无法判断是否受理时进入 `result_uncertain`，禁止作为普通 job retry 再次计费调用。
- 任务执行是至少一次语义；业务结果、验证码状态、积分结算和结果槽归并必须幂等。
- 每个 `(run_id, slot_code)` 只能通过唯一 ledger key 消费一次积分，output ID 仅作审计引用；run 终态释放未消费预留，`result_uncertain` 只保留“不确定 invocation 冻结单价 × 未决槽数”，其余候选价差立即释放。
- 普通 job，以及 generation invocation 已明确未被 Provider 受理的 job，租约过期且未达到 `max_attempts` 时才恢复为 queued；存在 Provider request / task ID 或受理状态不明时进入 `reconciling / result_uncertain`，禁止回 queued。Provider 查询确认无结果后才允许按错误分类回队；确认已有结果则进入恢复输出流程。超过上限后写 failed，并同步业务事实表的可见状态。
- job 重试使用有最大间隔的指数退避和 jitter，`last_error_code` 保存最近稳定整数错误码；用尽 max attempts 后才写业务终态错误。
- 用户取消先写业务表取消状态，再取消执行 context；终态事务必须重新校验业务取消状态和 job 租约。
- 优雅停机按“停止领取 -> 等待在途任务到宽限期 -> `ReleaseTimeout` -> 依赖租约恢复”执行。

数据库表队列是第一期必要业务实现，不扩展成通用队列框架。后续 Redis 任务队列阶段评估 Asynq 等成熟开源组件。

## 8. 图片存储

### 8.1 开源实现

使用 Go Cloud Development Kit 的 `gocloud.dev/blob`：

- `s3blob`：S3 及兼容协议。
- `fileblob`：本地文件系统。
- `blob.Bucket`：统一 Read、Write、Delete、List 和 SignedURL 能力。

不自行实现一套 S3 Client 或多后端文件 API。由于本系统禁止 PUT 接口，浏览器直传 S3 时使用 AWS SDK for Go v2 的 Presigned POST 薄适配，而不是预签名 PUT；其余 Blob 操作继续走 Go CDK。`internal/storage` 只负责业务对象键、用户权限、上传会话和响应 DTO 的薄适配。

### 8.2 对象键

```text
tmp/uploads/{uploadSessionId}/{objectId}.{ext}
users/{userId}/assets/{assetId}/original.{ext}
users/{userId}/tasks/{taskId}/outputs/{outputId}.{ext}
users/{userId}/exports/{exportId}.zip
```

MySQL 只保存 backend、bucket alias、object key、sha256、MIME、宽高、字节数和生命周期；本地绝对根目录只存在服务端配置中，不进入资产表、任务表或 DTO。

### 8.3 上传流程

S3 模式：

```text
prepare 创建 upload session -> 短期 Presigned POST 到隔离区 -> complete -> 服务端重新校验 -> 正式对象 -> 激活资产
```

本地模式：

```text
prepare 创建 upload session -> POST /assets/upload 流式写同卷临时对象 -> 校验 -> 原子 rename -> 激活资产
```

共同规则：

- 只接受明确登记的 PNG、JPEG、WebP。
- `asset_upload_sessions` 保存用户、asset、backend、临时对象 key、期望 size / MIME / SHA-256、`owner_token`、`lease_expires_at`、过期 / 完成时间、status 和 version；状态固定为 `prepared / validating / completed / failed / expired`，prepare、complete、失败恢复和过期清理均须幂等。Lease 必须覆盖最大 complete 时长或在流式校验 / 复制期间续租；最终激活必须使用 `id + validating + owner_token + version` CAS。Owner 丢失 lease 后禁止激活资产，只允许留下由 lifecycle / maintenance 清理的临时对象。
- Presigned POST Policy 固定 object key，限制 content-length-range、MIME allowlist、短过期时间和对象存储支持的 checksum 字段。
- 先校验 Content-Length，再校验文件魔数、真实 MIME、图片尺寸和解码上限。
- complete 不信任客户端提交的 MIME、尺寸或 hash；服务端重新 HEAD，并受限流式读取内容计算 SHA-256 和执行完整图片校验。
- 对象名由服务端生成，不使用用户原文件名拼路径。
- 文件写入先临时对象后提交，MySQL 和 Blob 失败使用补偿清理，不伪装成分布式事务。
- 下载使用短期签名 URL 或鉴权代理，不公开 bucket。
- 删除先写 tombstone，再异步清理物理对象；失败进入可观察的 GC 重试记录。

S3 浏览器直传是 SaaS Origin 到对象存储域名的跨域请求，Bucket 必须单独配置最小 CORS，不受 Gin 业务 API 仅允许 GET / POST 的限制：

- `AllowedOrigins` 只允许精确 SaaS Origin，禁止 `*`；`AllowedMethods` 默认只开放 POST，只有浏览器确需直读时才增加 GET / HEAD；`AllowedHeaders`、`ExposeHeaders` 只列实际签名字段、ETag 和 checksum Header。
- Bucket 保持私有并启用 Block Public Access、服务端加密；上传身份只能写 `tmp/uploads/*`，Presigned POST 固定 key，禁止客户端覆盖正式对象。
- `tmp/uploads/*` 配置短生命周期。upload session 完成后旧 Presigned POST 可能仍在有效期内，complete 必须拒绝再次激活；重传产生的临时孤儿由对象存储 lifecycle 和 maintenance job 双重清理。
- complete 后从隔离区提交正式对象时必须绑定已校验对象的 checksum、ETag 或 VersionId；不支持条件提交的 S3 兼容实现不得直接宣称生产支持。
- CORS、POST Policy、checksum、条件复制和生命周期能力必须进入 S3 兼容厂商测试矩阵；部署配置模板统一归档在 `server/conf/storage/`。

### 8.4 资产引用与物理删除

`assets.deleted_at` 只表示资产从用户素材库隐藏，不代表 Blob 可以立即释放。第一版不增加通用 `asset_object_references` 表，使用现有强关系作为引用事实：

- 用户删除素材后，已经创建的 queued / running run 继续使用原输入；历史任务保留期间仍允许基于冻结输入创建重试 run。
- “有效引用”由任务保留状态决定：`generation_tasks.purged_at IS NULL` 且 `retention_until > now` 的输入关系、不可变 run output 和稳定结果槽，以及未完成 upload session，都会阻止 GC；仅有一条已过保留期的不可变审计 output 记录不再永久阻止物理释放。
- 任务历史被用户删除或达到已确认保留期后，purge 事务设置 `purged_at`、失效稳定结果槽并释放对应逻辑引用，但不修改不可变 run output、task event 和积分流水；GC 只处理已经过宽限期且不存在有效引用的 tombstone。
- GC 使用上述统一有效引用谓词执行索引化 `NOT EXISTS` / 有界批次查询，禁止加载全部资产或目录到内存。删除前按相同谓词再次校验引用与 asset version，避免扫描后新引用产生竞争。
- 被任务历史引用的 Blob 继续计入用户存储用量；第一期不提供“删除素材即释放历史输入空间”的例外策略。

### 8.5 本地 Blob 生产部署

本地 Blob 是第一期正式支持的生产模式，但仅支持单实例，不宣称高可用：

- `storage.local.root` 必须是源码目录之外的绝对路径并挂载持久卷，禁止写入容器临时层；MySQL 始终只保存 backend 与相对 object key。
- 临时目录固定为 `{blobRoot}/.tmp/`，与正式对象位于同一文件系统；启动时验证根目录非符号链接逃逸、可写、可执行同卷原子 rename。
- Go CDK fileblob 固定配置 `fileblob.Options.NoTempDir=true`，让内部临时文件位于目标对象附近，避免跨文件系统 rename；应用级上传临时对象仍位于 `{blobRoot}/.tmp/`。Windows rename 前关闭全部文件句柄。
- 本地下载统一通过 Gin 鉴权代理，不公开目录和服务器绝对路径。
- 配置 warning / critical 磁盘水位。达到 critical 时拒绝新上传和新生成写入，但继续允许读取、下载、删除与 GC。
- 临时对象、tombstone 和孤儿对象由 maintenance pool 固定批次清理，禁止一次性把整个目录清单读入内存。
- `/readyz` 检查本地根目录最近一次探测结果；根目录丢失或不可写时未就绪，容量临界但仍可读取时由写接口返回稳定错误码。
- 第一版采用维护窗口备份协议：`readiness=false -> 停止上传、生成、领取和 GC -> drain 在途写入 -> 记录 backup_epoch -> 备份 MySQL -> 快照 Blob Volume -> 恢复服务`。备份窗口和备份保留期内禁止 GC 删除对应数据库备份可能引用的对象。
- 上线前必须完成上述 MySQL 与 Blob 一致性备份 runbook 和至少一次隔离环境恢复演练。备份元数据记录同一 `backup_epoch`、数据库位置和卷快照 ID；恢复后分批 reconciliation：标记 DB 缺失文件，对孤儿文件经过宽限期后再 GC。

## 9. Provider SDK 与模型网关

### 9.1 内部接口

模型类别沿用现有 Runtime 合同的四类，不新增第五种类别：

```text
1 = text-to-text    文生文
2 = text-to-image   文生图
3 = image-to-image  图生图
4 = image-to-text   图生文
```

数据库保存 `TINYINT` 类别，Go 使用全局具名常量，DTO 映射为现有字符串。同一 `(category, capability_code)` 允许存在多个启用的 `model_configs` 候选项。一条配置至少包含：

```text
name, category, capability_code
provider_code, model_name, base_url_profile, endpoint_path, secret_ref
priority, max_concurrency, timeout_seconds
failure_threshold, cooldown_seconds
public_billing_name, billing_enabled, billing_unit, unit_points
connection_status, status, version
created_at, updated_at
```

`priority` 数字越小优先级越高，候选查询使用 `category + capability_code + status + connection_status` 的联合索引并按 `priority, id` 稳定排序。创建 generation run 时将有限数量的候选顺序、必要非敏感配置和各候选价格快照持久化到 execution plan，避免管理员中途改配置或进程重启造成不可复现。

`public_billing_name` 是专门给用户积分流水展示的安全名称，不得直接复制内部 endpoint、部署区域或含敏感信息的模型标识。图片生成模型启用前必须存在合法计费配置；管理端更新价格要求独立计费权限、近期重新认证、非负整数校验、reason 和 `version` CAS，并在同一事务写不可变 `admin_audit_logs`。价格变化只影响更新后新建的 run。

```go
type ModelProvider interface {
    Invoke(ctx context.Context, req InvocationRequest) (InvocationResult, error)
}
```

接口只描述当前业务真实需要的能力，不暴露 SDK 类型。Provider、model、base URL、endpoint path、system prompt 和 API Key 由服务端配置和能力路由解析，Web 前端只能提交 capability、结构化输入和资产引用。

### 9.2 OpenAI

- 使用官方 `github.com/openai/openai-go/v3`，Apache-2.0。
- SDK 要求 Go 1.22+。
- Responses、Chat、Images 等能力通过官方 SDK 接入。
- `scene-prompt-planning` 继续使用 Responses API。
- OpenAI 图生图继续使用官方 Images Edits 能力和 multipart 图片输入。
- 显式设置总 timeout、连接 timeout 和响应体上限。
- OpenAI Client 显式配置 `option.WithMaxRetries(0)`，关闭 SDK 默认重试；图片调用禁止在 Adapter 内重试，文本调用如需重试也必须由统一 Provider Policy 显式决定，禁止“SDK 重试 × 候选降级”叠加。

### 9.3 火山引擎

- 使用官方 `github.com/volcengine/volcengine-go-sdk/service/arkruntime`，Apache-2.0。
- Ark Runtime 要求 Go 1.18+。
- Responses、Chat 和 Images 使用官方 SDK。
- Seedream 不同模型的组图、stream、size 等字段继续由服务端能力表精确控制，不能依赖 SDK 默认值猜测。
- 图像能力使用 API Key 接入；不在 DTO、日志或事件中返回凭据。
- 显式覆盖 SDK timeout 和 retry，使其符合现有 60 秒文本、300 秒图片等能力口径。

### 9.4 共同安全规则

- Provider Client 单例注入，复用连接池。
- 每次调用都从任务 context 派生 timeout。
- Provider 错误归一化为稳定错误码，只记录脱敏摘要。
- raw prompt、raw request、raw response、Authorization、Cookie、完整 URL 和图片 Base64 永不入库。
- 生产环境禁止启用 SDK request / response dump。
- 模型调用审计只保存 capability、配置版本、耗时、usage、结果状态和脱敏结构摘要。
- 管理端不能录入任意 Provider URL，只能选择内置 `base_url_profile` 或部署配置预先登记的 host allowlist。
- Provider 请求和结果 URL 下载统一执行 SSRF 边界：只允许 HTTPS / 登记端口，禁止 URL credentials、环回、私网、链路本地、云元数据和保留地址；DNS 解析与实际连接绑定，默认禁止跨主机重定向。
- 结果下载限制 redirect 次数、响应大小、MIME 和 timeout，凭据不得随跨主机跳转发送。

### 9.5 多模型降级、并发和超时

每个候选模型有独立的 `max_concurrency` 和 `timeout_seconds`。执行流程固定为：检查配置状态 / 熔断器 -> 获取该配置的 `semaphore.Weighted` -> 在数据库预创建唯一 `model_invocation` -> 派生 timeout context -> 调用官方 SDK 一次 -> 持久化结果 -> 成功停止或按错误分类进入下一个候选。

- 第一阶段每个候选默认只调用一次，并显式关闭或覆盖 SDK 自动重试，避免“SDK 重试 × 候选链”放大费用。
- 可自动降级：熔断已打开、连接建立失败、明确的 429、Provider 明确标记可重试的 5xx、模型临时不可用。
- 禁止自动降级：入参 / 资产校验错误、401 / 403、密钥或配置错误、内容安全拒绝、余额不足、硬配额耗尽、用户取消、任务总 deadline 到期、响应合同不匹配。
- AI 改写 SSE 只允许在首个 `delta` 发出前按上述分类切换候选；首个 `delta` 发出后锁定当前 `model_invocation`，关闭 SDK 自动重试并禁止再降级。此后 Provider 失败必须将父子调用以 version CAS 提交为失败并发送唯一 `error` 终态，最终文本只能来自唯一实际输出过 delta 的内部调用，避免拼接不同模型的文本。
- `model_invocations` 使用 `subject_type + subject_id` 关联 `generation_run` 或 `ai_assist_invocation`，并对 `(subject_type, subject_id, invocation_key)` 建立唯一约束；Provider 支持幂等键时透传由 invocation ID 派生的稳定 key，返回 request / task ID 时必须持久化用于恢复查询和对账。
- 图片 invocation 必须保存本次负责的稳定 `target_slot_codes`、冻结的 `model_config_id / version / billing_unit / unit_points`；候选失败后只有尚未产生并采用有效输出的槽位可以交给下一候选，已结算槽不得再次生成或扣费。Provider 多返回的图片、稳定槽 CAS 失败的晚到输出和未通过校验的输出不得扣用户积分。
- Lease 丢失时立即取消 Provider context。图片请求出现网络读超时、连接中断或其他无法判断是否受理的错误时，invocation、run 和积分预留分别进入 `result_uncertain / uncertain_hold`，停止自动重试与候选降级。
- `result_uncertain` 未解决前禁止自动创建新 run；恢复时优先查询 Provider 原任务。确认成功并取回图片后按正常逐图结算，确认无结果后释放预留，人工操作必须幂等并审计。
- `generation_runs` 记录 `uncertain_since`、`next_reconcile_at`、`reconcile_attempts`、`reconcile_deadline`、`resolution_reason` 和 `resolved_by`。自动 reconciliation 使用有上限的退避查询；超过自动查询窗口后进入管理端待处理队列并告警。
- `confirm-recovered-outputs` 只允许系统已经重新取得、完成图片校验并写入 Blob 的输出进入原子结算事务，管理员点击本身不能生成结果或直接扣积分；`mark-no-result` 必须填写可审计证据并释放预留。最大冻结期限必须是有限值，具体 SLA 在正式商用前由运营确认并写入 `system_configs`；未确认前不得开放外部注册。
- 到达 `reconcile_deadline` 仍没有已验证输出时，系统幂等释放用户预留，记录 `resolution_reason = sla_expired_release` 并进入平台成本待核销；后续即使 Provider 证明已产生费用，也不得追扣用户，只能进入运营损失对账。
- 整条候选链受任务总 deadline 和最大候选数限制。Provider 调用 deadline 取任务剩余时间、模型 timeout、进程停机 deadline 的最小值。
- 使用 MIT 许可证的 `sony/gobreaker/v2` 维护每个 `config_id + version` 的进程内熔断状态；配置版本变化时创建新 limiter / breaker，旧在途调用继续使用旧实例并在完成后回收。
- `model_invocations` 保存 subject type / ID、可空 task / job、类别、能力、候选序号、配置 ID / 版本、图片目标槽与冻结单价、provider / model 摘要、起止时间、耗时、状态、整数错误码、fallback reason 和 usage，不保存敏感原文。

## 10. 日志、错误和可观测性

### 10.1 `slog` 与 logit

业务代码统一依赖标准库 `*slog.Logger`，由 `lib/logger` 完成装配：

```text
Service / Repository / Worker -> *slog.Logger
                                     │
                                     └-> logit.NewSlogHandler(...)
```

计划采用 `github.com/lifei6671/logit` 的 `NewSlogHandler` / `NewSlogLogger`，获得上下文字段、JSON/text、文件分流、轮转和清理能力。容器部署默认写 JSON stdout；本地一体化部署可启用 logit 文件轮转。

当前阻塞：截至 2026-07-14，`lifei6671/logit` 仓库没有 `LICENSE` 文件，法律意义上不能认定为开源组件，与本项目的开源组件原则冲突。正式加入 `go.mod` 前必须为该仓库补充明确的 MIT、Apache-2.0 或其他兼容开源许可证；许可证未补前使用 Go 标准库 `slog.JSONHandler`，不自行实现日志库。

日志字段至少包含：

```text
timestamp, level, message, service, version
request_id, trace_id
user_id（内部 ID，必要时脱敏）
task_id, invocation_id
error_code, elapsed_ms
```

禁止记录 API Key、密码、Session token、Authorization、Cookie、raw prompt、Provider raw response、图片 Base64 和用户可配置 URL 的完整路径。

### 10.2 Metrics 与 Tracing

采用 Prometheus `client_golang` 和 OpenTelemetry Go：

- Gin 使用 `otelgin` 创建请求 span。
- Service、MySQL、Blob 和 Provider 调用创建子 span。
- Worker 从任务保存的 trace context 恢复链路。
- 指标不使用 `user_id`、`task_id` 等高基数 label。

核心指标：

```text
http_requests_total
http_request_duration_seconds
ai_rewrite_sse_streams_total
ai_rewrite_sse_active
ai_rewrite_sse_duration_seconds
ai_rewrite_sse_time_to_first_delta_seconds
ai_rewrite_sse_errors_total
ai_rewrite_sse_disconnects_total
generation_tasks_total
generation_task_duration_seconds
generation_queue_depth
generation_running_tasks
generation_queue_lag_seconds
provider_requests_total
provider_request_duration_seconds
provider_errors_total
provider_result_uncertain_total
provider_result_uncertain_current
provider_reconciliation_overdue
storage_operations_total
storage_read_bytes_total
storage_written_bytes_total
storage_usage_bytes
storage_objects
async_jobs_ready
async_jobs_running
async_job_queue_lag_seconds
async_job_retries_total
async_job_lease_lost_total
mail_queue_lag_seconds
gc_backlog_objects
security_rate_limit_blocked_total
credit_reconciliation_mismatch_total
```

`ai_rewrite_sse_active` 必须通过统一 defer 在成功、错误、断连和 panic 的所有退出路径归零；错误指标只使用有限的 `error_class`，不得把错误消息或用户数据放入 label。

累计读写流量使用 Counter，当前存量 / 对象数 / backlog 使用 Gauge，延迟使用 Histogram。指标标签只允许 `job_type`、`backend`、`provider_code`、`error_class` 等低基数值，禁止用户 ID、任务 ID、邮箱和对象 key。

## 11. 开源组件清单

| 类别 | 首选组件 | 许可证 | 使用边界 |
| --- | --- | --- | --- |
| HTTP | Gin | MIT | 路由、中间件、参数绑定 |
| ORM | GORM + go-sql-driver/mysql | MIT | Entity 映射、常规查询、事务 |
| 乐观锁 | gorm.io/plugin/optimisticlock | MIT | 业务表 version 条件更新 |
| Migration | Pressly Goose | MIT | 显式 SQL migration；禁用生产 AutoMigrate |
| 配置 | Viper | MIT | 配置文件和环境变量；第一期不做热更新 |
| DTO 校验 | validator/v10 | MIT | HTTP 边界结构校验 |
| Session | gin-contrib/sessions | MIT | Cookie / Redis Store 配置切换 |
| CSRF | gorilla/csrf | BSD-3-Clause | Session Cookie 场景的 CSRF Token 校验 |
| 邮件 | wneessen/go-mail | MIT | SMTP、TLS、context timeout；模板使用标准库 |
| 密码 | alexedwards/argon2id + x/crypto/argon2 | MIT / BSD-3-Clause | Argon2id PHC hash、参数版本和 rehash |
| ID | google/uuid | BSD-3-Clause | UUIDv7 生成和解析 |
| Blob | Go CDK blob / s3blob / fileblob | Apache-2.0 | S3 与本地存储统一实现 |
| S3 表单直传 | AWS SDK for Go v2 S3 | Apache-2.0 | Presigned POST 薄适配，避免 PUT |
| MIME | gabriel-vasile/mimetype | MIT | 文件魔数和真实 MIME 判断 |
| OpenAPI | oapi-codegen + openapi-typescript | Apache-2.0 / MIT | Go/TS 合同生成 |
| 限流 | ulule/limiter | MIT | 单进程内存限流，后续可切 Redis Store |
| Worker Pool | panjf2000/ants/v2 | MIT | 进程内有界协程池，不承担持久队列 |
| 模型并发 | golang.org/x/sync/semaphore | BSD-3-Clause | 每模型配置独立并发上限 |
| 模型熔断 | sony/gobreaker/v2 | MIT | 按模型配置版本维护熔断状态 |
| Metrics | prometheus/client_golang | Apache-2.0 | `/metrics` 与应用指标 |
| Tracing | OpenTelemetry Go + otelgin | Apache-2.0 | HTTP、DB、Worker、Provider 链路 |
| OpenAI | openai/openai-go/v3 | Apache-2.0 | OpenAI 官方 API |
| 火山引擎 | volcengine-go-sdk/arkruntime | Apache-2.0 | Ark 官方 API |
| 日志 | lifei6671/logit | 当前无许可证 | 补兼容开源许可证后采用；之前使用 slog |
| Web UI | Ant Design v6 | MIT | 管理端通用表单、表格、分页、弹窗等 |
| 测试 | testing + testify + testcontainers-go | BSD / MIT / MIT | 单测与真实 MySQL/S3 兼容测试 |
| Mock | uber-go/mock | Apache-2.0 | 接口测试替身 |
| 后续 Redis 队列 | hibiken/asynq | MIT | Redis 阶段再引入，第一期不依赖 |

依赖准入规则：

1. 必须有明确、兼容的开源许可证。
2. 必须有 Go Module、维护记录和可追踪 release。
3. 必须锁定版本，不依赖浮动分支。
4. 引入前检查 CVE、传递依赖和维护状态。
5. 同一职责只选择一个主组件，避免 ORM、配置、日志等能力重叠。
6. 只允许自行业务实现任务状态机、MySQL 8.0 队列领取事务、积分规则、Provider 能力路由、错误码和权限后的用例编排。
7. 不自行实现 ORM、migration、S3 SDK、Session、SMTP Client、密码算法、日志框架、协程池、通用 UI 控件、API 生成器、限流器、指标和 Tracing SDK。

## 12. 前端接入

Web 端新增 `RemoteRuntimeClient`：

```text
desktop feature / web feature
            │
            ▼
      Public Runtime Ports
        ├── Local adapter  -> Tauri
        └── Remote adapter -> Gin API
```

第一期前端建议新增：

```text
web/
├── src/
│   ├── app/                    # /app 用户端路由
│   ├── admin/                  # /admin 管理端路由
│   ├── runtime/remote/         # HTTPS API adapter
│   └── shared/                 # 两端共享 UI 与 API client
└── dist/
```

接入原则：

- UI 框架采用 Ant Design v6 最新稳定系列，实施时锁定经过验证的具体 patch 版本，不使用浮动 `latest`。React 18 满足 v6 最低要求，升级 React 19 不属于本期必要范围。
- 管理端优先使用 Ant Design 的 `Form`、`Table`、`Pagination`、`Modal`、`Upload`、`Message` 等成熟组件，禁止自研通用表单、表格、分页、弹窗和上传控件。
- 用户端尽量复用现有 React feature 和既有视觉，不顺手重做 UI。
- `/admin` 使用独立 `ConfigProvider` 和主题边界；`/app` 只在新增且交互已确认的页面渐进使用 Ant Design，不能全量替换 `desktop/src/shared/ui`，也不能改变既有 token、圆角、阴影、间距或色彩。
- `ShellPort`、本地 `WorkspacePort`、`ModelConfigPort`、`SecretPort` 在 Web mode 下通过 capability 隐藏本地入口。
- Web 新增 Auth、Profile、Credit 等合同前，先确认 Public Runtime Port 变更。
- 管理端是新界面，具体交互与视觉需在实现前单独确认。
- Remote adapter 不传 Base64、完整 Prompt、Provider 配置或 raw response。
- 用户端与管理端共享 OpenAPI 生成类型，但不共享认证状态和权限中间件。

## 13. 安全设计

- Session Cookie 使用 `Secure`、`HttpOnly` 和合适的 `SameSite`。
- Session 认证 / 加密 key、验证码 pepper、数据库 / Redis / SMTP 密码和 Provider API Key 只从环境变量或部署 Secret 注入。
- `server/conf/security/security.yaml` 显式配置 trusted proxy CIDR，默认空列表；直接暴露 Gin 时调用 `SetTrustedProxies(nil)`，只信任实际 Ingress / LB，禁止直接信任客户端 `X-Forwarded-For`。
- 登录、验证码发送 / 校验、密码重置和管理员登录使用 MySQL `security_rate_limit_windows` 持久化原子计数与 blocked_until，不能只依赖重启即清零的进程内 limiter；普通请求整形仍可使用开源 limiter。
- `security_rate_limit_windows` 至少保存 subject hash、action、window start / end、count、`blocked_until`、`expires_at`、status 和 version，并建立 `(expires_at, id)` 清理索引；maintenance pool 固定批次删除过期窗口，防止随机邮箱和 IP 攻击无限制造永久记录。
- 上传、生成和管理操作分别限流，审计与限流统一使用可信代理解析后的客户端 IP。
- 所有资源查询在 Repository 层强制包含 `user_id`，Service 再校验业务所有权。
- 管理 API 使用独立管理员表、Session 和审计日志。
- Provider 与 SMTP Secret 只通过部署 Secret 注入，不进入普通配置文件、`system_configs.value_json`、DTO 和日志。
- 所有 HTTP Server 配置 read header、read、write、idle timeout 和 body 上限。
- 上传防止路径穿越、伪造 MIME、超大图片、解码炸弹和对象覆盖。
- Provider 与结果下载执行统一 SSRF host allowlist、DNS / IP、重定向、响应体上限和 timeout 策略。
- `/metrics`、`pprof`、migration 和内部诊断接口不公开暴露。
- CORS 默认关闭，因为用户端、管理端和 API 同源。
- 所有业务写操作均为 POST，并使用 `gorilla/csrf` 校验；前端通过约定 Header 回传 Token，不自行实现 Token 算法。
- 管理端正式商用前必须启用 MFA、登录审计和高风险操作二次确认。

健康检查边界：`/healthz` 只证明进程存活；`/readyz` 检查初始化完成、schema version、MySQL、当前 Blob，以及配置选中的 Redis Session Store。OpenAI、火山引擎和 SMTP 的临时故障通过 capability health、指标和管理端诊断暴露，不导致基础 API readiness 失败。

## 14. 测试与质量门槛

### 14.1 Go 验证

```bash
gofmt -w ./
go vet ./...
golangci-lint run ./...
go test ./...
go test -race ./...
```

具体 Makefile 命令在 Go 工程建立后再同步补充，当前文档不把这些命令声明为仓库已存在能力。

### 14.2 兼容矩阵

- MySQL 8.0.46：schema、JSON、collation、唯一 / 外键矩阵、分页、乐观锁、`SKIP LOCKED` 并发领取、租约恢复和幂等测试；关键查询使用生产量级数据执行 `EXPLAIN ANALYZE`。
- Session：Cookie Store 与 Redis Store 分别验证登录、fixation 防护、idle / absolute TTL、退出、`session_version` 失效、密钥轮换、Cookie Path、匿名 CSRF Token 获取、登录后刷新、Store 切换全量登出和已声明的 Redis 支持矩阵。
- SMTP：使用本地开源测试 SMTP 服务验证 TLS、timeout、验证码一次性消费、同一 challenge 重试仍发送同一码、旧 challenge 失效、`delivery_failed`、最小剩余有效期、grant 原子消费、并发校验上限、进程在 SMTP 接收后崩溃的恢复，以及敏感信息不泄漏。
- 密码：在目标生产规格硬件上对 Argon2id 参数做基准测试，并验证 PHC 解析、旧参数 rehash、并发限制和超长输入拒绝。
- 本地 Blob：`NoTempDir=true`、原子写入、相对 key、引用保护、分批 GC、Windows 路径、同文件系统 rename、磁盘空间阈值、持久卷重启、backup epoch、备份恢复和数据库 / Blob 对账。
- S3 Blob：使用 S3 兼容测试服务验证 Bucket CORS、Presigned POST policy、上传会话、completed 后重传、checksum / ETag / VersionId 条件提交、服务端 complete 校验、临时对象 lifecycle、读取和删除。
- Provider：使用 `httptest.Server` 验证官方 SDK 的请求结构、`WithMaxRetries(0)`、timeout、取消、错误归一化、持久化调用记录、Provider 幂等标识、`result_uncertain` 自动 / 人工对账、证据约束和 SLA 超期处理。
- AI 改写 SSE：验证 POST + CSRF、capability 白名单、输入 / 输出 / 并发上限、`text/event-stream` Header、禁用压缩和 `Content-Length`、`meta -> delta* -> done|error` 顺序、终态后禁止继续写事件、sequence 规则、JSON 安全序列化与事件注入、UTF-8 跨 chunk 拼接、心跳、即时 flush、代理不缓冲、超时和客户端断开取消 Provider。状态竞争必须覆盖 completed / failed / cancelled 终态重放不重复调用模型、stale-running 恢复、DB 成功但 `done` 写失败、DB 失败不得发送 `done`、首个 delta 后禁止 fallback，以及断连取消与 Provider 完成并发时只有一个 CAS 终态成功。
- 真实 OpenAI / 火山调用只作为受控 smoke test，不能成为默认 CI。

### 14.3 必测业务风险

- 未登录、跨用户 IDOR 和管理端越权。
- 相同 Idempotency-Key 与相同请求体返回同一结果；相同 key 搭配不同请求体被拒绝，且不会重复建任务、run、积分预占或 job。
- 规范化后语义相同但 JSON 字段顺序不同的请求产生相同 request hash；并发上传 complete 只能由一个 upload session owner 执行 Blob 提交，处理中请求返回同一 operation 状态。
- 任务重试创建新的 `generation_run`；创建 run 后修改模型配置，不得改变该 run 已冻结的执行计划。
- Worker 崩溃、进程重启、租约过期、独立 lease token、超过最大次数不再领取、晚到结果和取消竞争。
- 邮件、生成、维护三个池的容量、领取和故障相互隔离，任何池都不得超领超过自身空闲槽位的 job。
- 商品/服饰单图重试的稳定结果槽与 tombstone。
- Provider 超时、限流、非法响应、SSRF、下载失败、部分成功和 `result_uncertain`；结果不确定时不得自动切换候选造成重复费用。
- 冻结候选模型价格后按“最高候选单价 × 请求图片数”预留；只按每个已校验、已入 Blob、已激活输出的实际模型冻结单价逐笔消费，低价候选产生的差额、失败 / 取消余量必须释放，结果不确定继续冻结。覆盖首选与降级模型价格不同、任务创建后调价、部分成功、重复完成、历史流水不被当前价格回算，以及管理员充值正数 / 幂等 / 审计。
- 用户积分流水必须逐输出展示公开模型计费名、冻结单价、扣除积分和扣后余额；游标翻页始终按 Session 用户过滤，关联任务已 purge 时不得泄露内部 ID，DTO 不返回 Provider、真实模型、配置、幂等或审计敏感字段。
- S3 与本地存储保持同一业务结果；上传会话过期、伪造 MIME、超大对象、路径穿越、磁盘写满和本地 Blob 恢复均有失败用例。
- 删除素材与 queued / running run、历史重试并发时，仍被引用的输入和输出 Blob 不得被 GC；引用释放与 GC 竞争必须再次校验对象版本。
- Blob 已写入后，分别在 output 插入、积分流水、账户更新、稳定槽 CAS、run / job 终态处注入失败，整个 MySQL 事务必须回滚且只留下可清理孤儿 Blob；同一 `(run_id, slot_code)` 即使恢复时产生不同 output ID 或重复完成，也只能生成一条消费流水。
- 验证 `available >= 0`、`reserved >= 0`、reservation 守恒和 account reserved 对账不变量；发现不一致只告警，不自动改账。
- trusted proxy、登录 / 验证码持久限流、Session CSRF 和管理员高风险操作权限边界。
- 只有 AI 帮写 / AI 改写 endpoint 返回 SSE；图片生成、任务历史、邮件、导出和管理端任务状态保持 polling。SSE 事件不得包含 raw Provider chunk、Prompt、凭据或字符串错误码。
- 日志、数据库、事件和 API DTO 不包含密钥、raw prompt 或 raw response。
- 每个 Entity 都实现静态 `TableName()`；每张业务表都有 `version`，所有 status / 日期时间列分别为 `TINYINT` / `DATETIME(3)`。
- OpenAPI 只包含 GET / POST；Gin 业务 API 对 PUT / PATCH / DELETE / HEAD / OPTIONS / CONNECT / TRACE 统一返回 405 和整数错误码。S3 外部端点的 CORS 预检与 HEAD 按对象存储兼容矩阵单独测试，不计入 Gin 业务 API。
- OpenAPI 生成 DTO 只能位于 `internal/models/dto/generated`，不得再手写同名 HTTP DTO；Service 内部 Command / View 不得泄漏到 Handler 合同。
- 所有列表均分页，Repository 不存在无界 `Find` / `Scan` / `Preload`，关键 SQL 通过生产量级数据的 `EXPLAIN ANALYZE`。
- 同一模型类别 / 能力的多候选覆盖 429、5xx、熔断、认证失败、内容拒绝、用户取消、结果不确定和配置版本切换。

## 15. 实施阶段

### G0：工程骨架与合同

- 新建 `server/` 单 Go Module。
- 建立 Go 1.26 Module、Gin、`server/conf/app.yaml` 与领域配置、日志、整数错误码、OpenAPI 和依赖装配。
- 建立 `/app`、`/admin`、用户 API、管理 API 路由组。
- 从 OpenAPI 生成 `internal/models/dto/generated`，增加合同检查，确保只出现 GET / POST 且不存在重复手写 HTTP DTO。
- 建立 trusted proxy、匿名 / 登录态 CSRF 获取合同、请求体上限、`/healthz`、`/readyz`、`server migrate up` 和 serve 阶段 schema 校验。
- 确认 logit 开源许可证后再加入依赖。

### G0.5：状态机、幂等与故障注入定稿

- 冻结 `generation_task`、`generation_run`、`async_job`、`model_invocation`、资产引用和稳定结果槽之间的状态、事实源和事务边界。
- 冻结输出提交、候选模型最高价预留、实际模型价逐槽消费、价格快照、用户逐笔流水、差额释放、`result_uncertain` hold / SLA、邮件 challenge / grant、事务型 / Saga 型 Idempotency-Key，以及 Prompt / Capability 历史版本协议。
- 冻结 `mail`、`generation`、`maintenance` 三条逻辑队列和三个 `ants` 池的容量、租约与停机协议。
- 输出 generation run、async job、model invocation、credit reservation、upload session 和 mail challenge 的状态转换表；每条迁移标注事务边界、幂等键、允许操作者和失败恢复路径。
- 先完成 SMTP 已接收后崩溃、Provider 已受理后超时、Blob 已写入但事务失败、积分消费时崩溃、资产删除与任务引用竞争、两个相同 Idempotency-Key 并发提交等故障注入测试。G0.5 验收通过是进入 G1～G4 核心实现的门禁。

### G1：MySQL 基线与最小邮件队列

- MySQL 8.0.46 显式 migration、核心表、唯一 / 外键矩阵、`utf8mb4_0900_ai_ci`、`DATETIME(3)`、`TINYINT` status、`version` 和显式 `TableName()`。
- `model_configs` 在基线 schema 中直接包含模型计费展示名、计费单位和整数单价；`generation_run_outputs`、`model_invocations` 和 `credit_ledger` 建立价格快照与稳定槽结算关系，不引入临时全局价格字段。
- 建立 Repository 事务基线、`async_jobs`、`FOR UPDATE SKIP LOCKED`、租约和恢复扫描器。
- 建立最小 `mail_pool` 垂直切片，用测试 job 验证入队、领取、续租、完成、失败、重启恢复和优雅停机；此时不实现业务验证码内容。

### G2：用户、Session 与邮件闭环

- 用户、Argon2id 密码、邮箱验证码、密码重置、Gin Session 和个人资料。
- Cookie / Redis Session Store 配置切换、fixation 防护、idle / absolute TTL、密钥轮换和 `session_version` 失效。
- `wneessen/go-mail` SMTP Adapter、确定性 challenge 验证码、验证 grant、持久限流、邮件模板，以及复用 G1 mail pool 的真实异步发送闭环。
- 独立管理 Session、最小管理员权限和审计；用户资源 Repository 强制所有权过滤。

### G3：Blob、生成队列与积分

- Go CDK `fileblob` / `s3blob`；资产 upload session、prepare / upload / complete、引用保护、软删除和分批 GC。
- 本地 Blob 生产部署的持久卷、同文件系统原子写、磁盘水位、backup epoch、备份恢复和对账；S3 验证 CORS、Presigned POST、checksum 和条件提交兼容性。
- 在 G1 队列基线上增加 `generation_pool`、`maintenance_pool`，形成邮件、生成、维护三个有界 Worker Pool；分别验证租约、心跳、恢复和资源隔离。
- `generation_runs`、持久化执行计划、幂等、取消、重试、晚到结果拒绝和结果槽归并。
- 积分账户、模型候选价格快照、按最高候选单价预留、按实际成功模型逐输出消费、差额 / 失败释放及结果不确定冻结。
- G3 可使用固定 model config / invocation fixture 验证积分状态机；真实 Provider 路由在 G4 接入，但不得为阶段解耦临时增加全局统一价格。

### G4：模型网关

- OpenAI 官方 Go SDK adapter。
- 火山引擎 Ark 官方 Go SDK adapter。
- 四类模型多候选、优先级、独立并发 / timeout、熔断、降级分类和调用审计。
- 模型配置级 `public_billing_name / unit_points`、基于 model config version 的价格快照与变更审计，以及 actual model invocation 到输出和积分流水的关联。
- Prompt Catalog、Capability、模型路由、SSRF 防护和安全日志。
- 调用前持久化 `model_invocation`，透传 Provider 支持的幂等 / request 标识，并实现 `result_uncertain` 人工对账入口。
- 建立 `AiAssistService` 流式入口和 `ai_assist_invocations`，将官方 SDK 文本增量归一化为 SSE `meta / delta / done / error`，不进入 `async_jobs`，并验证断开取消和幂等终态重放。

### G5：用户 Web

- `RemoteRuntimeClient`。
- `/app` 登录、素材、生成、历史、设置和个人积分流水；用户可逐笔查看任务 / 输出、公开模型计费名、冻结单价、扣除积分和扣后余额。
- Remote `AiAssistPort.streamProductSellingPoints` 使用 POST fetch 流消费 SSE；其他 Runtime Port 的异步任务状态继续 polling，不建立通用 SSE Client 或 WebSocket 层。
- 保持现有用户侧视觉与业务流程，替换数据和交互接线。

### G6：管理 Web

- `/admin` 用户、任务、模型、积分、存储和审计。
- 管理员积分充值、在模型配置中维护每张成功图片积分单价、价格版本与审计、积分流水，以及结果不确定 run 的确认 / 释放处理；不再提供独立全局计费规则页面。
- `system_configs`、邮件服务配置、测试邮件和 Ant Design v6 组件接入。
- loading、disabled、toast、权限和危险操作确认。
- 具体视觉和交互先经用户确认。

### G7：商用加固

- MFA、告警、容量压测、安全回归和灾难恢复演练；核心持久限流、指标、Tracing 与备份恢复不得推迟到本阶段才首次实现。
- 跨用户安全测试、故障演练和对象清理演练。
- 内部用户灰度后再开放外部注册。

## 16. 风险与待确认项

### 16.1 已识别风险

1. API 与 Worker 同进程降低部署复杂度，但进程故障会同时影响 API、邮件和生成任务；必须依靠租约恢复、资源隔离和优雅停机降低影响。
2. MySQL `SKIP LOCKED` 适合队列表但返回不一致视图，只能用于 `async_jobs`；部署必须采用 row-based binlog。
3. `utf8mb4_0900_ai_ci` 同时对重音不敏感；邮箱已采用明确 canonicalization 和 binary 精确唯一比较，Token / Hash 也必须使用 binary 类型或 collation，禁止后续 migration 偷换回普通文本比较。
4. S3 与本地模式的上传方式不同，必须通过 prepare / complete 合同屏蔽差异；S3 Presigned POST 需单独验证兼容对象存储实现。
5. 官方模型 SDK 自带 retry 或较长 timeout 时可能造成重复费用；OpenAI 固定 `WithMaxRetries(0)`，其他 SDK 也必须在集成测试中证明不会绕过统一 Provider Policy。图片 timeout 的结果不确定场景默认停止自动降级。
6. Cookie 切换 Redis Session Store 会使全部已有会话失效；`gin-contrib/sessions` 的 Go 版本、Redis TLS / Sentinel / Cluster 支持需按部署环境验证。
7. SMTP 接收响应超时可能导致重复投递；同一 challenge 的验证码必须由版本化密钥确定性派生，重试发送同一码，创建新 challenge 时显式废弃旧 challenge。
8. `lifei6671/logit` 当前缺少开源许可证，补许可证前不能满足本项目依赖准入规则。
9. 第一阶段直接使用 `user_id` 隔离最简单，但未来团队空间需要一次明确的数据 migration。
10. 第一版固定单副本；本地 Blob 即使支持生产也仍是单节点故障域，必须使用持久卷、容量告警、一致性备份和恢复演练，不能把切换 S3 等同于已经支持多副本。
11. Provider 结果不确定会继续冻结积分并占用用户余额；必须提供有限 SLA、自动查询、证据约束、告警，以及管理员确认已恢复输出或标记无结果的可审计流程。
12. 确定性验证码依赖版本化 HMAC 密钥；密钥轮换、保留周期和灾难恢复必须与未过期 challenge 生命周期匹配。
13. MySQL 8.0.46 是已确认基线但已结束社区生命周期；开发、CI、测试和生产必须锁定相同版本。缺少数据库供应商延长安全支持或已批准的漏洞响应方案时，不得公网正式商用，并必须预留升级到后续 LTS 的负责人和截止日期。
14. 资产逻辑删除与物理对象释放分离后，历史保留会增加存储成本；GC 引用查询、保留期限和用户用量展示必须持续对账，不能用提前删除换取容量。
15. S3 兼容实现对 Presigned POST、CORS、checksum 和条件复制的支持不一致；未通过目标厂商兼容矩阵时只能标记为实验性存储后端。
16. SSE 会占用长连接并受到反向代理 buffering、idle timeout、HTTP write deadline 和浏览器断连影响；第一期严格限制在 AI 改写，设置用户级并发与最大持续时间，不能扩展成通用任务总线。
17. 按最高候选模型单价预留会短暂冻结高于最终消费的积分；前端必须展示预计冻结值，候选数量应有限，run 终态必须立即释放差额，并监控长期未释放 reservation。

### 16.2 实施前仍需确认

- Provider API Key 是否只由部署环境注入；若管理端必须在线更新，需要先选择开源 Secret Manager。
- SMTP 密码是否只由部署环境注入；若管理员必须在页面直接录入和更新密码，需要先确认 OpenBao 等开源 Secret Manager，禁止在 MySQL 明文保存或自研加密管理。
- Redis Session 是否需要 TLS、Sentinel 或 Cluster；该答案决定 `gin-contrib/sessions` Redis Store 的初始化适配和集成测试范围。
- Argon2id 的最终内存、迭代和并行参数需在生产规格硬件完成基准测试后定值，方案阶段不写死未经验证的参数。
- 正式部署使用的 MySQL 8.0.46 供应商是否提供延长安全支持；若没有，需要单独确认漏洞响应责任和后续 LTS 迁移截止日期。
- `result_uncertain` 的最大积分冻结时长和超期处理 SLA；未确定有限值前不得开放外部注册。

## 17. 参考组件与官方资料

- [Gin](https://github.com/gin-gonic/gin)
- [Gin trusted proxies](https://gin-gonic.com/en/docs/examples/trusted-proxies/)
- [Go Release History](https://go.dev/doc/devel/release)
- [Go Toolchains](https://go.dev/doc/toolchain)
- [GORM](https://github.com/go-gorm/gorm)
- [GORM TableName 约定](https://gorm.io/docs/conventions.html)
- [GORM optimisticlock](https://github.com/go-gorm/optimisticlock)
- [Pressly Goose](https://github.com/pressly/goose)
- [gin-contrib/sessions](https://github.com/gin-contrib/sessions)
- [gorilla/csrf](https://github.com/gorilla/csrf)
- [alexedwards/argon2id](https://github.com/alexedwards/argon2id)
- [golang.org/x/crypto/argon2](https://pkg.go.dev/golang.org/x/crypto/argon2)
- [wneessen/go-mail](https://github.com/wneessen/go-mail)
- [panjf2000/ants](https://github.com/panjf2000/ants)
- [sony/gobreaker](https://github.com/sony/gobreaker)
- [Ant Design](https://github.com/ant-design/ant-design)
- [Go CDK Blob](https://pkg.go.dev/gocloud.dev/blob)
- [Go CDK fileblob](https://pkg.go.dev/gocloud.dev/blob/fileblob)
- [Amazon S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)
- [OpenAI 官方 Go SDK](https://github.com/openai/openai-go)
- [火山引擎官方 Go SDK](https://github.com/volcengine/volcengine-go-sdk)
- [lifei6671/logit](https://github.com/lifei6671/logit)
- [MySQL 8.0 字符集与 collation](https://dev.mysql.com/doc/refman/8.0/en/charset.html)
- [MySQL 8.0 字符串大小写规则](https://dev.mysql.com/doc/refman/8.0/en/case-sensitivity.html)
- [MySQL 8.0 Locking Reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)
- [MySQL 8.0 Release Notes（8.0.46 EOL）](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/)
- [OpenTelemetry Go](https://opentelemetry.io/docs/languages/go/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## 18. 最终原则

1. Go 1.26 单进程同时承载 Gin API 和有界 Worker Pool；第一版生产固定单副本。
2. 用户端与管理端同域部署，通过 `/app` 和 `/admin` 隔离。
3. 第一期只做个人用户，所有业务数据以 `user_id` 隔离。
4. 数据库固定 MySQL 8.0.46，统一 collation、DATETIME、TINYINT status、version 乐观锁和显式 `TableName()`；延长安全支持或经批准的风险响应是正式商用门禁。
5. `async_jobs` 是唯一持久队列，邮件、生成、维护使用三个独立 `ants` 池；业务事实仍保存在各自业务表，租约、心跳和幂等不可省略。
6. `generation_task` 表示用户意图，`generation_run` 表示一次执行尝试；执行计划在 run 创建时持久化冻结，重试必须新建 run。
7. 积分按整数记账，管理员可幂等充值；第一版在每个图片生成模型配置上维护单价，按最高候选价预留、按实际成功模型的冻结价格逐输出消费并生成用户可查询的不可变流水，差额 / 失败释放，结果不确定按有限 SLA 冻结并进入可审计对账。
8. S3 和本地存储统一使用 Go CDK Blob，不自行实现对象存储 SDK；资产逻辑删除不得破坏任务引用，本地 Blob 可用于单副本生产，但必须使用持久卷、磁盘水位、backup epoch 和恢复演练。
9. OpenAI 和火山引擎优先使用官方 SDK，只在业务边界做薄适配；结果不确定不得自动切换候选。
10. Entity、DTO 和 Mapper 明确分离，数据库结构不得直接暴露到 HTTP。
11. `lib` 只承载跨模块基础能力，不演变成无边界工具包。
12. 日志统一使用 `slog`；logit 补充兼容开源许可证后作为 Handler 实现。
13. HTTP 业务合同只允许 GET / POST，错误码使用 int；所有列表必须分页，禁止无界查询和一次性全量加载。
14. Session 使用 Gin 中间件并可配置 Cookie / Redis Store；密码使用 Argon2id；邮件使用确定性 challenge 验证码和 SMTP 开源组件异步发送。
15. 四类模型均允许配置多个候选，每个候选有独立优先级、并发、timeout 和降级规则。
16. 管理端使用 Ant Design v6，用户端不得因接入组件库改变既有视觉。
17. 通用能力优先选择成熟开源组件，自行代码只保留业务状态机和必要适配。
18. raw prompt、Provider raw response、验证码、凭据和图片 Base64 不进入数据库、日志、事件或前端 DTO。
19. 第一期仅 AI 帮写 / AI 改写使用 POST SSE 流式返回文本；图片生成及其他异步任务继续 polling，不引入 WebSocket，也不把 SSE 扩展成持久队列。
