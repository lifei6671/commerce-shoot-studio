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
- MySQL 最低兼容版本为 8.0，不兼容 MySQL 5.6 / 5.7；项目不锁定具体 patch 或 LTS 系列，部署方自行选择实际版本。
- GORM 负责常规 ORM 映射，显式 SQL migration 管理 schema。
- API 和 Worker 运行在同一个 Go 进程，第一期生产固定单副本 `replicas = 1`。
- `async_jobs` 是第一期唯一持久队列表，生成、邮件和资产清理共用该表；`generation_tasks` 只保存生成业务事实。
- 图片支持 S3 兼容对象存储和本地文件存储。
- 本地 Blob 允许生产部署，但必须使用持久卷、固定单副本，并纳入容量监控和一致性备份。
- OpenAI、火山引擎优先接官方 Go SDK。
- 认证第一期使用 `gin-contrib/sessions`，通过配置在 Cookie Store 与 Redis Store 之间切换。
- 邮件服务支持 SMTP 配置，用于邮箱验证码和密码重置，发送动作由进程内 Worker 异步执行。
- 管理端采用 Ant Design v6；`/app` 新增认证、上传和积分等 SaaS 页面使用 Ant Design，商品、服饰、场景等 Web 核心工作台使用独立 `web/` shadcn/ui 展示层重新进行响应式适配与视觉美化；不复用或修改 Desktop UI/CSS/Tauri adapter，Desktop 视觉保持不变。
- 用户端和管理端使用同一域名下的二级路径，不拆成三套部署。
- 第一期仅支持个人用户，不实现团队、租户成员和团队工作空间。
- 通用能力优先采用许可证清晰、持续维护的开源组件；不重复自研通用框架。

### 1.1 外部评审意见处理结论

本版已吸收评审中直接影响数据一致性、安全和生产恢复的建议：确定性验证码、`generation_runs`、持久化执行计划、HTTP 幂等、Provider `result_uncertain`、积分预留 / 消费 / 释放、上传会话、三类 Worker Pool、可信代理、持久安全限流、SSRF、防 Session fixation、Argon2id、readiness、优雅停机、独立 migration 和生产级本地 Blob 约束。

以下建议不采用或暂缓，原因以已确认需求和第一期范围为准：

- 数据库合同只要求 SQL、migration、事务和运维脚本最低兼容 MySQL 8.0；不得依赖高于 8.0 才提供的专属语法。CI 至少验证一个 8.0.x 环境，部署前再对实际选用版本完成同一套验收。
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
- AI 帮写 / AI 改写使用 SSE 返回文本增量；图片生成、任务历史、邮件和管理任务状态继续使用 polling。
- 图片上传、鉴权下载、软删除、现有全部图片 / 长图下载行为的 Web 对齐和存储用量统计；第一期不建设服务端 ZIP 归档或完整个人数据导出。
- 任务创建、排队、领取、执行、心跳、取消、重试和失败恢复。
- OpenAI 与火山引擎 Provider 接入。
- 平台管理端的用户、任务、模型配置、积分、存储和审计能力。
- 积分账户、管理员充值和不可变积分流水；第一期图片单价绑定模型配置，与 Provider 真实成本解耦；每张被稳定结果槽采纳的有效图片按实际产出模型冻结单价收费，同一 run 的总积分等于各成功图片积分之和。
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
                     MySQL 8.0+              S3 / Local Blob   AI Provider
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
5. 达到 Worker 宽限期后取消剩余任务；明确未被 Provider 受理的调用按租约规则恢复，受理状态不明的调用按 `result_uncertain` 规则立即终结用户侧执行并转平台内部对账。
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
│   ├── app.yaml                    # 系统入口配置；仓库模板不含真实凭据
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
- 配置加载顺序固定为：领域默认 YAML -> 部署实例 `app.yaml` 与领域配置覆盖 -> 启动后读取 MySQL `system_configs` 运行时配置。第一期不使用环境变量注入或 Secret Manager。启动时完成结构校验；选择 Redis Session Store 但 Redis 不可用时快速失败。
- MySQL、Redis、Cookie Session key、验证码派生/校验 key 等启动必需凭据直接写入部署实例配置文件。仓库只提交空值或占位模板，真实部署配置不得提交到 Git。
- S3、SMTP、OpenAI、火山引擎等非启动必需配置及密钥由管理员在线维护，并直接写入 `system_configs`。普通用户没有配置权限；第一期不新建独立密钥表，也不引入应用层加密或外部密钥管理组件。
- 启动级配置不能在线修改；S3 存储后端和 Session Store 的切换保存后明确提示重启生效，不实现热切换。

### 4.1 分层约束

```text
Gin Handler -> Service -> Repository / Storage / Provider
                    │
                    └-> Worker 使用同一 Service，不复制业务逻辑
```

- Handler 只做参数绑定、边界校验、调用 Service 和 DTO 转换。
- Service 持有业务状态机、权限后的用例编排和事务边界；内部输入 / 输出分别使用领域 Command / View，不直接传递 HTTP DTO。
- Repository 负责 GORM 查询、事务和最低兼容 MySQL 8.0 的必要原生 SQL。
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

API 使用 OpenAPI contract-first，后端通过锁定的 `oapi-codegen v2.7.2` 生成 Gin 接口骨架，前端通过 `openapi-typescript 7.13.0` 生成 TypeScript 类型。生成工具只允许读取仓库内受评审的 OpenAPI 文件，禁止构建时下载远程 schema、接受用户上传或第三方 schema；OpenAPI 变更和生成 diff 都必须审查，CI 必须校验生成结果与 schema 一致。生成代码禁止手改。OpenAPI 业务合同只允许 `GET` 和 `POST`：GET 必须只读，所有创建、修改、删除、取消、重试、验证码发送等操作统一使用动作式 POST 路径。Gin `NoMethod` 对 PUT、PATCH、DELETE、HEAD、OPTIONS、CONNECT、TRACE 等其他方法统一返回 HTTP 405 和整数错误码；系统同源部署，不注册 CORS 预检路由。

### 5.1 用户 API

```text
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
POST   /api/v1/generation-plans/quote         # 无副作用报价，不创建任务或冻结积分
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

第一期通信策略固定为“AI 改写使用 SSE，其他异步状态使用短间隔 polling”。`POST /api/v1/ai-assist/rewrites/stream` 只承载 AI 帮写 / AI 改写的文本增量，不作为通用任务进度通道；图片生成、任务历史、邮件和管理端任务状态继续轮询现有 GET API。任务 DTO 继续保留事件序号和状态版本，第一期不为这些场景增加 SSE，也不引入 WebSocket。`GET /generation-tasks/{taskId}/events` 支持 `afterSequence + limit` 增量返回事件，按 sequence 升序且客户端按 sequence 去重；`GET /generation-tasks/{taskId}` 响应携带最新 task version，前端忽略低版本响应，并在 `completed / failed / partial_failed / cancelled` 用户展示终态停止 polling。Provider `result_uncertain` 不能成为用户侧非终态：内部 run / job 统一进入既有 `failed`，用户聚合状态按是否已有有效输出映射为 `failed` 或 `partial_failed`，并返回稳定整数错误码；Provider 内部对账状态不进入用户 DTO。

### 5.2 管理 API

```text
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
GET    /api/admin/v1/model-invocations/uncertain
POST   /api/admin/v1/model-invocations/{invocationId}/reconcile
POST   /api/admin/v1/model-invocations/{invocationId}/resolve
GET    /api/admin/v1/audit-logs
```

用户 Session 与管理 Session 使用不同 Cookie 名、作用路径和中间件。管理端必须支持 MFA 后才能进入正式商用；第一期内部测试若暂不实现 MFA，必须限制管理入口的网络访问范围并记录为上线阻塞项。

用户端和管理端统一使用 Go 1.25+ 标准库 `net/http.CrossOriginProtection` 拒绝非安全跨域浏览器请求，通过 `Sec-Fetch-Site` 和 `Origin` 判断同源关系，不签发 CSRF Token、CSRF Cookie，也不保留无安全作用的 Token Header 合同。两端分别装配拒绝处理器并返回统一整数错误码；默认不配置 trusted origin 或不安全 bypass。所有写操作只能使用 POST，GET 不得产生状态变更。Session 响应继续固定设置 `Cache-Control: no-store, private` 和 `Vary: Cookie`，禁止 CDN 缓存。

用户 Web 认证采用独立 `/app/login`、`/app/register`、`/app/forgot-password`、`/app/reset-password` 路由。未登录访问素材、历史、任务等受保护 `/app/*` 深链时，前端转到登录页；登录 API 成功并重新签发 Session 后使用 history replace 回到原路径，默认回 `/app`。`returnTo` 只属于前端导航状态，不传给登录 API，也不由服务端返回重定向；规范化后只允许同源且以 `/app/` 开头的普通路径，必须拒绝协议、`//`、反斜杠、控制字符、编码绕过和 `/admin`，非法值回退 `/app`。401 只清理认证状态并跳登录，不自动重放失败的 POST 请求。注册和找回密码入口是否可用由服务端 capability 返回；SMTP 未配置、注册未开放或能力不可用时明确禁用并展示安全原因。

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
- 第一阶段不建设服务端 ZIP 或个人数据导出任务；未来若经 `WEB-FUP-01` / `WEB-FUP-02` 立项，异步操作必须复用 `async_jobs` lease，禁止把 `idempotency_records` 扩展成第二套任务队列。
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
- SSE POST 与其他业务 POST 一样校验用户 Session、`CrossOriginProtection` 和限流；同时限制用户 / IP 请求频率、单用户并发流及单进程活跃流总数。心跳使用 SSE comment，间隔在 `server/conf/app.yaml` 配置且小于整条链路的最短 idle timeout；反向代理 buffering 必须实际关闭，代理 idle timeout、Go HTTP write deadline 和模型 timeout 必须大于约定的最大流持续时间并保留安全余量。Gin 的压缩中间件必须跳过该路由，响应不得设置 `Content-Length`，每个事件写入后显式 flush；部署验收必须验证网关 / CDN 未缓存、缓冲或转换流内容，不能只依赖 `X-Accel-Buffering` Header。
- 对外 `aiAssistInvocationId` 始终指向父 `ai_assist_invocations.id`，不得暴露内部 `model_invocations.id`；候选降级产生的多个内部调用统一通过 `subject_type=ai_assist_invocation + subject_id` 审计。
- 日志、Trace event / span attribute 和 Metrics label 均不得记录用户输入正文、delta 或最终改写文本；只记录 AI assist invocation ID、capability、状态、整数错误码、输入 / 输出字节或 token 数、首个增量耗时和总耗时。
- 图片生成和其他长任务不得复用此 SSE endpoint；它们继续通过 `GET /generation-tasks/*` polling，避免把单进程内的瞬时连接通道扩展成通用消息系统。

## 6. MySQL 设计

### 6.1 兼容基线

- 数据库最低兼容 MySQL 8.0，所有表使用 InnoDB。项目不锁定具体 MySQL patch；SQL、migration 和事务语义只能使用 MySQL 8.0 已提供的能力。MariaDB 不在声明的兼容范围内。migration 与 serve 启动时读取数据库版本和必要能力，低于 8.0、识别为 MariaDB 或缺少必要能力时快速失败。CI 至少覆盖一个 8.0.x 环境，部署候选版本必须重复执行完整 `V-DB`、备份恢复和关键 SQL 验收。
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
admin_users                 平台管理员；第一期固定 platform_admin 权限，不保存角色矩阵
admin_audit_logs            管理操作审计
system_configs              管理员可维护的全局业务配置
security_rate_limit_windows 登录、验证码等关键安全限流状态

assets                      图片资产元数据和 Blob key
asset_upload_sessions       prepare / complete 上传会话和临时对象
generation_tasks            用户的一次生成意图与聚合展示状态
generation_runs             一次真实执行、冻结计划和用户侧执行状态
generation_run_outputs      每次执行产生的不可变输出
generation_task_input_assets 任务输入资产关系
generation_assets           用户可见稳定结果槽，引用采用的 run output
task_events                 结构化任务事件
ai_assist_invocations       AI 改写调用状态、幂等和最终归一化结果
model_invocations           生成 run / AI 改写的模型调用审计摘要与 usage
async_jobs                  唯一数据库任务队列表：生成、邮件、GC 等
idempotency_records         HTTP 写操作业务幂等记录

model_configs               四类模型的多候选路由配置、用户图片积分单价，不含密钥明文
user_settings               用户设置
credit_accounts             用户可用 / 预留积分账户
credit_reservations         每个 generation run 的图片槽级总预留与结算汇总
credit_ledger               充值、槽级预留、逐图消费和释放的不可变积分流水
```

`system_configs` 是纯 KV 配置表，至少包含 `config_key`、`value_json`、`description`、`status`、`version` 和日期时间字段，并对 `config_key` 建立唯一索引。`config_key` 由服务端按业务固定并以常量维护，客户端不能创建任意 key；`value_json` 保存该业务配置的完整 JSON 文档。例如邮件服务按固定 key（用户给出的示例为 `email_stmp`）读取并解析 SMTP host、port、用户名、密码等字段。邮件、S3 和 Provider 等管理员配置均直接保存在该表，不增加 `value_type`、`secret_ref` 或独立密钥表。

每个业务配置 JSON 必须有显式 schema 和专用 Service / DTO。管理员更新时由 Service 将请求字段与当前 JSON 合并，再通过 `version` CAS 原子替换完整 JSON；读取接口由业务 Mapper 移除密码、API Key 等字段，只返回页面需要的普通字段和 `credentialConfigured` 状态。省略密钥字段表示保留数据库中的原值，显式清空使用单独布尔动作，禁止把空字符串或前端掩码写回数据库。

Repository 可以按固定 `config_key` 读取完整 JSON 供 SMTP、S3 或 Provider Adapter 使用，但通用列表、缓存快照、审计 old/new value、日志、Trace、Metrics、诊断、任务 payload、执行计划和任何后续导出不得复制其中的密钥字段。数据库备份会包含明文凭据，这是当前简化方案已接受的残余风险。

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
credit_ledger(account_id, operation, generation_run_id, slot_code) UNIQUE（consume）
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
credit_ledger.user_id
  -> users.id                                   物理 FK / ON DELETE RESTRICT
credit_ledger.reservation_id
  -> credit_reservations.id                     物理 FK / ON DELETE RESTRICT，非生成流水可空
credit_ledger.generation_task_id
  -> generation_tasks.id                       物理 FK / ON DELETE RESTRICT，非生成流水可空
credit_ledger.generation_run_id
  -> generation_runs.id                         物理 FK / ON DELETE RESTRICT，非生成流水可空
credit_ledger.generation_run_output_id
  -> generation_run_outputs.id                  物理 FK / ON DELETE RESTRICT，非图片消费流水可空
credit_ledger.pricing_model_config_id
  -> model_configs.id                           物理 FK / ON DELETE RESTRICT，非生成流水可空
model_invocations.resolved_by_admin_id
  -> admin_users.id                             物理 FK / ON DELETE RESTRICT，可空
model_invocations(subject_type, subject_id)             多态逻辑 FK，仅允许 generation_run / ai_assist_invocation
async_jobs(aggregate_type, aggregate_id)         多态逻辑 FK，由 Service 校验
idempotency_records(resource_type, resource_id) 多态逻辑 FK，由 Service 校验
```

第一期业务实体只做软删除，强关系不使用级联物理删除；达到保留期后的 purge 由 Service 按明确顺序分批执行，审计、task events、run outputs 和积分流水继续遵守各自保留策略。

邮箱同时保存用户输入的展示值与唯一的 `email_canonical`。规范化规则固定为：去除首尾空白、校验地址结构、域名执行 IDNA 规范化后转小写；第一版产品规则将 local-part 同样转小写，不实现 Gmail 点号、加号等厂商特例。`email_canonical` 使用 binary collation 或等价 `VARBINARY` 精确比较后建立唯一索引，禁止依赖普通文本的 `utf8mb4_0900_ai_ci` 唯一性语义。

第一期用户软删除后邮箱仍被唯一索引占用，不允许用同一邮箱重新注册；管理员可以按审计流程恢复原账户。永久注销、法定删除和邮箱匿名化属于后续独立数据治理方案，不能通过临时修改唯一键绕过。

每个固定业务 key 对应一个经过 schema 校验的 JSON 文档并原子更新，避免拆字段修改产生半配置状态。MySQL 是运行时全局配置的事实源；进程内只允许有界只读快照缓存，管理员更新成功后按 `config_key + version` 失效 / 替换，新请求使用新版本，在途任务继续使用启动时冻结的配置快照。每次变更必须写 `admin_audit_logs`，但包含密钥的字段只记录是否已配置，不记录 old/new 原值。

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
- 执行计划至少保存 capability / 版本、Prompt 模板 ID / 版本 / hash、用户结构化业务输入、输入资产 ID / 版本 / SHA-256、计划结果槽、每个槽的候选模型顺序及其 `model_config_id + model_config_version + unit_points_snapshot`、生成参数和总 deadline；run 一对一 `credit_reservations` 保存总预留汇总，逐图 `credit_ledger` 保存实际产出模型与单价快照，`generation_runs` 不重复保存计价字段。
- 用户填写的卖点、场景和修改要求属于业务输入，可以持久化；最终编译的 System Prompt、Provider raw prompt / request / response 继续禁止入库。

Prompt 与 Capability 第一版使用 `server/conf/model/prompts/<capability>/vN.tmpl` 和 `server/conf/model/capabilities/<catalogVersion>.yaml` 作为随版本发布、构建时 embed 的不可变 Catalog。已发布并可能被 run 引用的版本只能新增，禁止覆盖或删除；启动时校验 manifest 和 hash。`execution_plan_json` 保存 catalog version、模板 ID / 版本 / hash 和 capability version，确保旧 run 在进程重启或新版本部署后仍可解析；第一版不增加管理端在线编辑 Prompt，也不建立数据库 Prompt 版本表。

输出提交前预生成 `asset_id` 和不可变最终 object key。Provider 结果完成下载与校验后先写 Blob，再开启短 MySQL 事务，并按固定顺序锁定 `generation_run -> async_job -> model_invocation -> credit_account -> credit_reservation`。事务必须重新校验 lease token、run 状态、用户取消状态、实际模型图片单价快照、账户 / reservation version 和槽级消费键，然后在同一事务内插入并激活 `assets` 元数据、插入 `generation_run_output`、按实际产出模型冻结单价消费该结果槽积分、释放该槽预留价差、CAS 更新稳定结果槽并同步 `display_status`。任一 CAS 或状态校验失败时整体回滚；Blob 写失败禁止插入可见 output 或扣积分，Blob 写成功但事务失败只留下待分批 GC 的孤儿对象。

多图任务的每张成功图片分别提交 asset、run output、稳定结果槽、该槽消费流水、run 进度和 display snapshot；幂等键固定为 `consume:{run_id}:{slot_code}`，保证同一槽的 Worker 重试、租约恢复或重复完成只收费一次。同一 run 可以按不同实际模型产生多条槽级消费流水。任务停止时释放所有尚未成功交付槽的未消费预留；所有事务都必须校验 lease token、取消状态和 version，首张成功不得提前把多图 run / job 标记为终态。

### 6.4 模型图片单价、积分账户与逐图结算

第一版只实现平台积分，不接支付、套餐、过期积分、退款或团队共享余额。图片生成计费单位固定为“每张完成校验、Blob 提交并被稳定结果槽采纳的有效图片”，单价由管理员在 `model_configs` 上配置，与 Provider 的真实货币成本解耦；不再使用 `system_configs` 保存全局图片生成价格。模型 A 每张 3 积分产出 2 张、模型 B 每张 5 积分产出 1 张时，同一 run 合计消费 `3×2+5×1=11` 积分。所有积分余额、累计值、单价快照、流水 points 和绝对 delta 的业务上限固定为 1,000,000,000,000，写入或计算超限时整笔事务失败，确保 Go `int64`、OpenAPI `int64` 与 TypeScript `number` 无损表达。

- 每个可用于图片生成的 `model_configs` 必须保存 `points_per_image`，表示每张图片积分单价，取值为 0～1,000,000,000,000 的整数，0 表示该模型生成的单张图片免费；文生文和图生文第一期不使用该字段扣图片生成积分。
- 管理员通过 Model Config Service 创建或更新图片单价，使用 model config `version` CAS、近期重新认证、变更原因和脱敏审计。单价更新只影响后续新建 run，在途 execution plan 和历史 ledger 不回算。
- generation run 的执行计划冻结计划结果槽，以及每个槽的候选顺序、`model_config_id + model_config_version + unit_points_snapshot`。Provider 真实成本和运行时账单不得修改冻结单价；实际消费数量由成功采纳的图片槽数量决定。
- 创建 generation run 时，对每个计划结果槽取候选模型最高冻结单价，再对所有槽求和后原子预留。前端提交前展示该最高可能扣费；Provider 返回超过计划槽数的图片不得被额外采纳或收费。
- 每张图片完成校验、Blob 提交并被稳定结果槽采纳时，在同一事务中使用 `consume:{run_id}:{slot_code}`，按实际产出模型冻结单价消费一次，并释放该槽最高预留与实际单价的差额。同一 run 可以产生多条消费流水，但同一 `run_id + slot_code` 最多消费一次。
- 同一槽的 Worker 重试、租约恢复、候选降级或重复完成不得重复收费；用户主动重试创建新 run 和新计费槽，并按新 execution plan 重新预留。
- run 明确失败或被取消时，释放全部尚未交付槽的未消费预留；已成功交付并消费的图片不退款，用户随后删除成功图片也不退款。部分成功按实际成功图片逐张收费并释放剩余槽预留。
- Provider 返回 `result_uncertain` 时，必须在将内部 run / job 终结为 `failed` 的同一事务中释放所有未交付槽的未消费预留；已成功交付槽的消费保持不变。用户聚合状态按是否已有有效输出展示为 `failed` 或 `partial_failed`，并可以立即创建新 run 重试。
- 原 `model_invocation` 保持内部 `result_uncertain` 状态并进入平台对账，但不得继续占用未交付槽积分。任何晚到结果都不得写入用户可见 output、覆盖稳定结果槽或触发补扣；只允许进入隔离记录 / 孤儿对象清理和平台成本核销。
- 管理员充值只接受正整数积分、原因和幂等键；同一事务锁定账户、增加 available、写 `credit_ledger` 和 `admin_audit_logs`。第一期不提供负数调账。

`credit_reservations` 以 `generation_run_id` 唯一，作为 run 的总预留与结算汇总事实源，保存 `planned_slot_count`、`planned_points_snapshot`、`reserved_points`、`consumed_points`、`released_points`、status 和 version。它不再保存单一最终定价模型，因为同一 run 的不同成功图片可以来自不同模型。`generation_runs` 不重复保存同一组账务汇总字段。

`credit_ledger` 的每条图片消费流水保存 `generation_run_id + slot_code + generation_run_output_id + pricing_model_config_id + pricing_model_config_version + unit_points_snapshot + quantity=1`，并禁止 UPDATE / DELETE。用户端 `GET /api/v1/credits/ledger` 通过显式 Mapper 返回 operation、图片单价、quantity=1、图片消费积分、available / reserved delta 与 after、当前用户可访问的 task / output 引用、安全描述和发生时间；DTO 始终禁止返回真实 Provider、内部 model config ID / version、Provider 成本、幂等键、管理员原始备注、密钥、Base URL、endpoint、Prompt 或 Provider 原始数据。

用户端积分交互采用行内透明提示，不为每次生成增加确认 Modal。该交互需要 Generation Plan Quote View 返回当前配置对应的 `plannedSlotCount`、`maxReservedPoints`、可用积分和 `quoteVersion`；配置区主按钮显示“开始生成 · 最高冻结 N 积分”，免费时显示“开始生成 · 免费”，单图重试只显示该槽最高冻结值。报价计算中或影响计划的配置变化后必须禁用提交并失效旧报价；余额不足时显示缺口并跳转 `/app/credits`，不得创建 task/run。创建成功显示“已冻结 N 积分”，每张成功/失败结果分别显示实际扣费/未扣费，终态汇总实际扣除、释放和可用余额；用户可由单图扣费跳转并定位对应 output 流水。前端不自行维护模型价格表或推算积分，服务端创建事务仍执行最终原子校验，余额不足的失败 POST 不自动重放。

积分事务必须保持以下不变量，并在单元测试、故障注入和定期 reconciliation 中验证：

```text
credit_accounts.available >= 0
credit_accounts.reserved >= 0

credit_reservations.planned_points_snapshot
  = SUM(max_candidate_unit_points_for_each_planned_slot)

credit_reservations.planned_points_snapshot
  = credit_reservations.reserved_points
  + credit_reservations.consumed_points
  + credit_reservations.released_points

credit_reservations.consumed_points
  = SUM(credit_ledger.points WHERE operation = consume AND reservation_id = ?)

每个 (generation_run_id, slot_code) 最多一条 consume 流水

每条 consume.points
  = 对应 output 实际 model_config 在 execution plan 中冻结的 unit_points_snapshot

credit_accounts.reserved
  = SUM(credit_reservations.reserved_points WHERE account_id = ?)
```

预留、逐图消费和释放必须在行锁 / CAS 事务内同步更新 account、reservation 和 ledger；写图片消费流水时必须校验 ledger 的 `account_id + reservation_id + generation_run_id + slot_code + generation_run_output_id` 与已锁定 reservation 和刚提交的 output 完全一致。`credit_ledger` 建立 `UNIQUE(account_id, operation, idempotency_key_hash)`，图片消费流水额外建立 `UNIQUE(account_id, operation, generation_run_id, slot_code)`；定期对账同时核对账户、reservation、计划槽、已采纳 output、实际模型单价快照和逐笔 ledger，发现不一致时只告警和阻止高风险结算，不自动修改不可变流水。

#### 6.4.1 DS0-03 已批准计费合同基线

以下 baseline 已吸收“价格绑定 model config”“按实际产出模型价”“按成功图片逐张收费”和字段名 `points_per_image` 的最新决定，并于 2026-07-15 获用户重新批准：

1. `model_configs` 增加 `points_per_image BIGINT UNSIGNED NOT NULL DEFAULT 0`；Service 强制 0～1,000,000,000,000，非图片生成能力固定为 0，图片生成能力的 0 表示免费。所有 run 的计划槽总预留与累计消费也不得超过同一业务上限，乘加溢出或超限时整笔创建失败。不增加全局 `credit_billing` 配置，不保存 Provider 真实成本。管理 OpenAPI / TypeScript DTO 使用 `pointsPerImage`，由显式 Mapper 与数据库字段映射，不保留 `requestPoints` 兼容字段。

2. `credit_reservations` 是 run 唯一计费快照事实源，不在 `generation_runs` 重复保存：

   ```text
   id, account_id, generation_run_id
   planned_slot_count, planned_points_snapshot
   reserved_points, consumed_points, released_points
   status, version, created_at, updated_at
   ```

   `generation_run_id` 唯一；`planned_points_snapshot` 等于各计划结果槽候选模型最高冻结单价之和，并在 run 创建时全部预留。reservation 不保存单一最终定价模型或单一图片价，因为同一 run 的成功图片可以来自不同模型。不得保存 Provider 成本或增加 `uncertain_hold` 字段。

3. `credit_ledger` 保持不可变；每张图片消费流水保存 `generation_run_id`、`slot_code`、`generation_run_output_id`、实际 `pricing_model_config_id`、`pricing_model_config_version`、`unit_points_snapshot` 和 `quantity=1`，但用户 DTO 不返回内部配置 ID / version。建立 `UNIQUE(account_id, operation, idempotency_key_hash)` 和图片消费 `UNIQUE(account_id, operation, generation_run_id, slot_code)`；消费键为 `consume:{run_id}:{slot_code}`，结果不确定释放键仍为 `release:{run_id}:result_uncertain`。

4. `generation_run_outputs` 和 `model_invocations` 不保存 Provider 实际成本或另一套用户单价字段；它们已有的 model config / invocation 关联用于把成功 output 对应到 execution plan 中冻结的实际模型单价。execution plan 保存每个计划槽、每个候选的 model config ID / version / unit points 快照，防止管理员调价改写在途 run。

5. `result_uncertain` 只属于 `model_invocations`。内部状态迁移为 `running -> result_uncertain -> reconciled_no_result | reconciled_late_result`，并在 invocation 侧保存：

   ```text
   uncertain_since, next_reconcile_at, reconcile_attempts, reconcile_deadline
   resolution_reason, resolved_by_admin_id, resolved_at
   ```

   `generation_runs` 和 `async_jobs` 不增加 `result_uncertain` / `reconciling` 状态，也不保存上述内部对账字段；它们使用既有 `failed` 终态和稳定整数错误码 `140504`（`GENERATION_PROVIDER_RESULT_UNCERTAIN`）。

6. 用户 OpenAPI / Runtime DTO 不暴露 `result_uncertain`、内部 invocation ID 或对账字段。任务查询沿用现有任务 View，只补充/确认以下公共字段；积分 DTO 至少包含：

   ```text
   GenerationTaskView.status       = failed | partial_failed（展示状态）
   GenerationTaskView.errorCode    = 140504
   GenerationTaskView.retryable    = true

   CreditSummaryView.available
   CreditSummaryView.reserved

   CreditLedgerItemView.id
   CreditLedgerItemView.operation
   CreditLedgerItemView.unitPoints
   CreditLedgerItemView.quantity   = 1
   CreditLedgerItemView.points
   CreditLedgerItemView.deltaAvailable
   CreditLedgerItemView.deltaReserved
   CreditLedgerItemView.availableAfter
   CreditLedgerItemView.reservedAfter
   CreditLedgerItemView.taskId     = 当前用户可访问时返回
   CreditLedgerItemView.outputId   = 当前用户可访问时返回
   CreditLedgerItemView.description
   CreditLedgerItemView.createdAt
   ```

   DTO 不返回真实 Provider、内部 model config ID / version 或 Provider cost。已经批准的 `CreditPort` 仍只承担余额查询和游标分页流水查询，不增加 Provider 对账方法；管理能力继续使用独立 Admin API Client。

7. 管理 OpenAPI 从“积分不确定 run”改为“Provider 不确定 invocation”。`UncertainModelInvocationView` 只返回 invocation ID、capability、安全 Provider / model 摘要、内部状态、错误码、发生时间、对账次数 / deadline 和脱敏结论；只允许分页查询、触发 Provider 重新查询和记录 `reconciled_no_result` / `reconciled_late_result` 内部核销结论。删除恢复输出、稳定槽写入和用户积分补扣动作。所有写操作要求 Idempotency-Key、近期认证、权限、reason 和审计，DTO 不返回凭据、raw prompt、raw response 或图片原文。

#### 6.4.2 DS0-03 已批准生成前报价合同

2026-07-15 用户选择 A，批准新增无副作用的 `POST /api/v1/generation-plans/quote`。请求复用创建 generation task 的结构化业务输入与 assetId；报价与创建 task 必须调用同一个 plan compiler。`GenerationPlanQuoteView` 返回 `plannedSlotCount`、`maxReservedPoints`、`availablePoints`、`shortfallPoints`、不透明 `quoteVersion` 和安全失效原因；报价接口不创建 task/run/reservation/job，不冻结积分，也不持久化 Prompt 或报价记录。前端通过 `GenerationPort` 的独立报价方法调用该合同，不自行计算价格或解析 `quoteVersion`。

创建 task 请求必须携带最后一次有效报价的 `quoteVersion`，但服务端不得信任客户端价格，必须在创建事务前重新编译计划并执行最终原子余额校验。版本、模型配置或价格变化导致报价失效时，创建接口返回 HTTP 409、稳定整数错误码和刷新后的安全 `GenerationPlanQuoteView`；前端更新行内报价并等待用户再次提交，不得自动重放创建请求。create `previewOnly` 模式未获采用，不实现也不保留兼容入口。

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

Repository 禁止无条件 `Find`、`Scan`、`Preload` 把全表读入内存。列表查询必须分页；GC、统计和数据修复使用 `FindInBatches` 或流式 `Rows` 固定批次处理。`%keyword%` 模糊查询即使不区分大小写，也通常无法有效使用 B-Tree 索引；第一期优先精确或前缀搜索，任意包含搜索需评估 MySQL FULLTEXT / ngram，并用生产量级数据执行 `EXPLAIN ANALYZE`。

以下字段禁止进入用户 DTO：

- `worker_id`、`lease_token`、`lease_expires_at`。
- Provider、model、base URL、endpoint path。
- API Key、`system_configs.value_json` 中的密码/密钥字段和内部配置版本。
- raw prompt、system prompt、Provider raw request / response。
- 本地绝对路径、S3 credential 和内部 bucket 信息。

### 6.6 密码存储

新系统使用 Argon2id，不保留 bcrypt 兼容分支。优先采用基于 `golang.org/x/crypto/argon2` 的成熟开源封装并使用 PHC 格式保存算法、参数、salt 和 hash：

- `user_passwords` 保存 `password_hash`、`password_hash_version` 和参数版本；salt 使用密码组件生成的密码学随机值。
- 第一期开通生产所需的最低规格和 benchmark 基准固定为 `1 vCPU / 1 GiB`；全局最多同时执行 1 个密码 hash/verify，等待有界 semaphore 必须受请求 context 和 deadline 约束，不允许无限排队或自动重试。
- G2-T01 从 Argon2id `19 MiB / t=2 / p=1` 开始，在等价资源限制下分别 benchmark hash 与 verify；最终参数选择必须满足单次操作 `p95 <= 500ms`、最大值 `< 1s`，并记录 p50、p95、max、CPU 与峰值 RSS。不能用开发机结果代替，未来需要提高吞吐时优先扩容而不是在 1 vCPU 上放宽并发。
- 限制密码 UTF-8 字节长度，避免超长输入造成额外资源消耗。
- 登录成功后发现旧参数版本时原子 rehash；密码错误、hash 格式错误和版本不支持返回统一认证错误，不泄漏内部原因。
- 密码重置成功后更新 hash、递增密码版本与 `session_version`，使旧会话失效。

### 6.7 Session 设计

第一期使用 MIT 许可证的 `github.com/gin-contrib/sessions`：

- `server/conf/session/session.yaml` 通过 `store: cookie | redis` 选择 Store，默认 Cookie Store；`server/conf/session/redis.yaml` 保存 Redis 地址、密码、DB、连接池、TLS 和 key prefix。仓库模板中的密码保持空值，部署实例配置文件提供真实值。
- Cookie Store 同时配置认证 key 和加密 key，仅保存 `user_id`、`session_version`、登录时间、认证等级等最小身份数据；完整用户、邮箱、角色事实、积分和任何 secret 不进入 Cookie。
- 认证中间件用 `user_id + session_version` 查询当前用户状态；数据库是用户状态和权限的事实源，停用用户或版本不匹配时立即拒绝并清理 Session。
- Redis Store 只让 Cookie 保存随机 Session ID，服务端设置 TTL、独立 prefix、连接 / 读写 timeout。选中 Redis 但初始化失败时服务启动失败，禁止静默回退 Cookie。
- 用户 Session Cookie 使用 `Path=/api/v1`，管理 Session Cookie 使用 `Path=/api/admin/v1`；两端使用不同 Cookie 名、认证密钥和 Session 中间件，删除时必须使用原 Path。CSRF 防护不再创建 Cookie 或 Token，两端分别装配 `CrossOriginProtection` 拒绝处理器。
- Cookie 均设置 `Secure`、`HttpOnly`、合理 `SameSite`，并分别配置 idle TTL 与 absolute TTL；管理 Session TTL 更短，高风险管理操作要求近期重新认证。
- 登录成功后废弃匿名 Session 并重新签发认证 Session，防止 fixation；Cookie Store 支持多组 key pair 轮换，第一组写入，后续组只读取旧 Cookie。
- 密码重置、用户封禁或全端退出时递增 `session_version`，使旧会话失效。
- Cookie 与 Redis Store 的切换需要重启并使已有会话失效，第一期不自研跨 Store 在线迁移。
- Cookie Store 是第一期默认正式支持基线；只有管理员可以配置并切换 Session Store。Redis 第一期只支持单节点直连，可选 TLS，完成目标环境集成测试后正式支持；不支持 Sentinel 或 Cluster。普通用户没有 Session Store 配置入口。

### 6.8 邮件验证码与密码重置

第一期 SMTP Adapter 使用 MIT 许可证的 `github.com/wneessen/go-mail`，模板使用标准库 `html/template` + `embed.FS`，不自研 SMTP Client 或模板引擎。默认不配置 SMTP，支持标准 SMTP 而不绑定特定邮件厂商：

- `server/conf/mail/smtp.yaml` 提供允许的 SMTP host / port / profile allowlist；管理员只能选择部署明确放行的 endpoint，并通过 `system_configs` 的邮件业务固定 key 维护完整 SMTP JSON，包括 profile、from、TLS 策略、timeout、验证码 TTL / 发送间隔、用户名和密码，禁止录入任意 host 探测内部网络。内部 SMTP 必须由部署配置显式放行。普通用户没有 SMTP 配置入口；管理端查询时移除密码字段，只返回是否已配置。
- SMTP 未配置或临时不可用不影响基础 `/readyz`，但注册、验证码、密码重置和测试邮件等 capability 必须明确返回不可用，不能伪装为成功。开放外部注册前必须配置真实 SMTP 并完成 TLS、timeout、异步发送、失败恢复与审计验收。
- 创建 challenge 时使用 `crypto/rand` 生成至少 128 bit nonce，并用部署配置文件中独立、版本化的启动配置密钥对 `challenge_id + nonce + purpose + email_canonical` 做 HMAC 确定性派生六位验证码；数字映射需避免明显取模偏差。
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

### 7.2 MySQL 8.0 兼容领取算法

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
- 恢复过期 generation job 时必须先检查已有 `model_invocation` 和 Provider task / request ID；明确未受理才允许按错误分类重试，无法判断是否受理时进入 `result_uncertain`，禁止作为普通 job retry 再次调用 Provider。
- 任务执行是至少一次语义；业务结果、验证码状态、积分结算和结果槽归并必须幂等。
- 每个结果槽只能通过 `consume:{run_id}:{slot_code}` 唯一 ledger key 按实际模型冻结单价消费一次；同一 run 可有多条不同 slot 的图片消费流水。明确失败、取消或 `result_uncertain` 时释放所有未交付槽预留，已交付槽消费保持不变；`result_uncertain` 使用稳定释放键 `release:{run_id}:result_uncertain`，不得继续冻结或因晚到结果补扣。
- 普通 job，以及 generation invocation 已明确未被 Provider 受理的 job，租约过期且未达到 `max_attempts` 时才恢复为 queued；存在 Provider request / task ID 或受理状态不明时，原 invocation 进入内部 `result_uncertain`，用户侧 run / job 立即终结并释放未消费预留，禁止原 run 回 queued。Provider 后续查询只用于平台成本核销，取得的晚到结果也不得进入用户输出；用户重试只能显式创建新 run。
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

默认存储后端固定为 `fileblob`，数据写入部署方配置的本地持久目录。只有明确手动
配置并通过启动校验后才切换到 `s3blob`；未配置 S3 时不得尝试自动探测、静默上传
云端或从本地后端自动降级/升级。存储后端切换需要重启，第一期不实现运行中热切换
或自动迁移既有对象。S3 配置权限只属于管理员，普通用户不提供 Bucket、endpoint、
region、Access Key 或其他 S3 配置入口，也不能为个人账户绑定自有对象存储。
管理员保存的 S3 endpoint、Bucket、region、Access Key 和 Secret Key 统一写入
`system_configs` 的 S3 业务固定 key 所对应 JSON。存储后端切换仍需重启，后台必须明确
提示“已保存，重启后生效”，启动时读取并校验所选配置；管理端查询不回传密钥字段。

不自行实现一套 S3 Client 或多后端文件 API。由于本系统禁止 PUT 接口，浏览器直传 S3 时使用 AWS SDK for Go v2 的 Presigned POST 薄适配，而不是预签名 PUT；其余 Blob 操作继续走 Go CDK。`internal/storage` 只负责业务对象键、用户权限、上传会话和响应 DTO 的薄适配。

### 8.2 对象键

```text
tmp/uploads/{uploadSessionId}/{objectId}.{ext}
users/{userId}/assets/{assetId}/original.{ext}
users/{userId}/tasks/{taskId}/outputs/{outputId}.{ext}
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
- active 素材和任务历史第一期不自动过期，保留到用户主动删除；对应 `retention_until` 为
  NULL 时表示无自动到期。用户删除后立即从用户界面隐藏，并把清理边界设置为删除时间后
  7 天；该宽限期只用于并发引用安全、备份窗口和物理 GC，不承诺第一期提供回收站恢复。
- “有效引用”由任务保留状态决定：`generation_tasks.purged_at IS NULL` 且
  (`retention_until IS NULL` 或 `retention_until > now`) 的输入关系、不可变 run output 和稳定
  结果槽，以及未完成 upload session，都会阻止 GC；仅有一条已过保留期的不可变审计
  output 记录不再永久阻止物理释放。
- 任务历史被用户删除或达到已确认保留期后，purge 事务设置 `purged_at`、失效稳定结果槽并释放对应逻辑引用，但不修改不可变 run output、task event 和积分流水；GC 只处理已经过宽限期且不存在有效引用的 tombstone。
- 未完成 upload session、临时文件和孤儿对象最长保留 24 小时；task events 与模型调用诊断
  摘要保留 90 天后由 maintenance pool 固定批次清理。积分流水、管理审计及 task / run 核心
  审计记录第一期不自动删除；后续法定删除或匿名化必须通过独立数据治理方案重新审批。
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

第一期生产 Provider allowlist 固定为 OpenAI 与火山引擎，不开放任意 custom gateway。
默认不配置 Provider 凭据；只有管理员可以配置模型、capability、候选优先级、并发、
timeout 和启停状态，普通用户不能配置 API Key、Provider 或自带模型。endpoint/profile
必须来自服务端内置或部署 allowlist。未配置或临时不可用的 Provider 只让对应 AI
capability 标记不可用，不影响基础 `/readyz`。Mock Provider 仅用于自动化测试和本地
调试；默认 CI 不调用付费 Provider，真实调用只在受控环境执行 smoke test。

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
provider_code, model_name, base_url_profile, endpoint_path
priority, max_concurrency, timeout_seconds
failure_threshold, cooldown_seconds
points_per_image
connection_status, status, version
created_at, updated_at
```

Provider API Key 不进入 `model_configs`，而是保存在对应 Provider 业务固定 key 的
`system_configs.value_json` 中。管理员更新 API Key 后，必须在同一事务中递增配置版本、
把该 Provider 的模型连接状态重置为 `untested` 并写脱敏审计；查询模型配置只返回
API Key 是否已配置，不返回原值。

`priority` 数字越小优先级越高，候选查询使用 `category + capability_code + status + connection_status` 的联合索引并按 `priority, id` 稳定排序。图片单价字段表示该模型每产出一张被采纳有效图片收取的积分，不表示 Provider 成本；变更单价必须递增 model config version。创建 generation run 时将计划结果槽、有限数量的候选顺序、必要非敏感配置和各候选图片单价快照持久化到 execution plan，避免管理员中途改配置或进程重启造成不可复现。

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
- 图片 invocation 必须保存本次负责的稳定 `target_slot_codes` 和冻结的 `model_config_id / version`；候选失败后只有尚未产生并采用有效输出的槽位可以交给下一候选。Provider 多返回的图片、稳定槽 CAS 失败的晚到输出和未通过校验的输出不得触发用户积分消费。
- Lease 丢失时立即取消 Provider context。图片请求出现网络读超时、连接中断或其他无法判断是否受理的错误时，原 invocation 进入 `result_uncertain`，停止自动重试与候选降级；内部 run / job 同步进入 `failed` 终态，用户聚合状态按已有有效输出映射为 `failed` 或 `partial_failed`，并立即幂等释放未消费预留。
- 用户可立即显式创建新 run 重试。原 invocation 不得恢复为原 run 的用户可见结果；任何晚到输出不得覆盖稳定槽、触发积分补扣或进入历史结果，只能隔离并按孤儿对象规则清理。Provider 真实成本由平台承担。
- `result_uncertain` 对账字段归属 `model_invocations`，至少包括 `uncertain_since`、`next_reconcile_at`、`reconcile_attempts`、`reconcile_deadline`、`resolution_reason` 和 `resolved_by`；`generation_runs` 不保存内部对账状态。自动 reconciliation 使用有上限的退避查询，超过窗口后进入管理端待处理队列并告警。
- 管理端只提供 invocation 级查询、重新对账和内部核销动作，不再提供 `confirm-recovered-outputs`、用户积分补扣或恢复交付入口。管理员操作必须幂等并审计，不能修改已经释放或消费的用户积分流水。
- 后续即使 Provider 证明已经产生费用，也不得依据 Provider 账单追扣用户或修改 execution plan 中冻结的平台图片单价快照，只能进入运营损失对账。
- 整条候选链受任务总 deadline 和最大候选数限制。Provider 调用 deadline 取任务剩余时间、模型 timeout、进程停机 deadline 的最小值。
- 使用 MIT 许可证的 `sony/gobreaker/v2` 维护每个 `config_id + version` 的进程内熔断状态；配置版本变化时创建新 limiter / breaker，旧在途调用继续使用旧实例并在完成后回收。
- `model_invocations` 保存 subject type / ID、可空 task / job、类别、能力、候选序号、配置 ID / 版本、图片目标槽、provider / model 摘要、起止时间、耗时、状态、整数错误码、fallback reason 和 usage，不保存用户价格、Provider 实际成本或敏感原文。

## 10. 日志、错误和可观测性

### 10.1 `slog` 与 logit

业务代码统一依赖标准库 `*slog.Logger`，由 `lib/logger` 完成装配：

```text
Service / Repository / Worker -> *slog.Logger
                                     │
                                     └-> logit.NewSlogHandler(...)
```

计划采用 `github.com/lifei6671/logit` 的 `NewSlogHandler` / `NewSlogLogger`，获得上下文字段、JSON/text、文件分流、轮转和清理能力。容器部署默认写 JSON stdout；本地一体化部署可启用 logit 文件轮转。

截至 2026-07-14，`lifei6671/logit v1.0.0` 公开仓库尚未上传 `LICENSE` 文件。项目所有者 lifei6671 已明确授权本项目使用，因此当前开发可锁定该版本并加入 `go.mod`，不启用 `slog.JSONHandler` 回退。公开许可证仍是对外分发和开源合规证据，必须在正式发布前补齐；业务代码始终只依赖标准库 `*slog.Logger`，避免授权或 Handler 变化扩散到业务层。

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

`provider_result_uncertain_*` 和 `provider_reconciliation_overdue` 只统计 invocation 级平台内部对账，不表示用户 run 仍在执行或积分仍被冻结；用户侧终态和解冻延迟通过 generation / credit 事务指标单独验证。

`ai_rewrite_sse_active` 必须通过统一 defer 在成功、错误、断连和 panic 的所有退出路径归零；错误指标只使用有限的 `error_class`，不得把错误消息或用户数据放入 label。

累计读写流量使用 Counter，当前存量 / 对象数 / backlog 使用 Gauge，延迟使用 Histogram。指标标签只允许 `job_type`、`backend`、`provider_code`、`error_class` 等低基数值，禁止用户 ID、任务 ID、邮箱和对象 key。

## 11. 开源组件清单

| 类别 | 首选组件 | 许可证 | 使用边界 |
| --- | --- | --- | --- |
| HTTP | Gin `v1.12.0` | MIT | 路由、中间件、参数绑定 |
| ORM | GORM `v1.31.2` + GORM MySQL Driver `v1.6.0` | MIT | Entity 映射、常规查询、事务；底层使用 go-sql-driver/mysql |
| 乐观锁 | gorm.io/plugin/optimisticlock `v1.1.3` | MIT | 业务表 version 条件更新 |
| Migration | Pressly Goose `v3.27.2` | MIT | 显式 SQL migration；禁用生产 AutoMigrate |
| 配置 | Viper `v1.21.0` | MIT | 仓库默认配置与部署实例配置文件；第一期不使用环境变量，不做通用热更新 |
| DTO 校验 | validator/v10 `v10.30.3` | MIT | HTTP 边界结构校验 |
| Session | gin-contrib/sessions `v1.1.0` | MIT | Cookie / Redis Store 配置切换 |
| CSRF | Go 标准库 `net/http.CrossOriginProtection` | BSD-3-Clause | Go 1.25+ 同源保护；不签发 Token/Cookie，不引入存在未修复漏洞的 `gorilla/csrf` |
| 邮件 | wneessen/go-mail `v0.8.1` | MIT | SMTP、TLS、context timeout；模板使用标准库 |
| 密码 | alexedwards/argon2id `v1.0.0` + x/crypto `v0.54.0` | MIT / BSD-3-Clause | Argon2id PHC hash、参数版本和 rehash；禁止导入 `openpgp/*` |
| ID | google/uuid `v1.6.0` | BSD-3-Clause | UUIDv7 生成和解析 |
| Blob | Go CDK `v0.46.0` blob / s3blob / fileblob | Apache-2.0 | S3 与本地存储统一实现 |
| S3 表单直传 | AWS SDK for Go v2 S3 `v1.105.1` | Apache-2.0 | Presigned POST 薄适配，避免 PUT |
| MIME | gabriel-vasile/mimetype `v1.4.13` | MIT | 文件魔数和真实 MIME 判断 |
| OpenAPI | oapi-codegen `v2.7.2` + openapi-typescript `7.13.0` | Apache-2.0 / MIT | 只读取仓库内受评审 schema；禁止远程或不受信任输入；Go/TS 合同生成 diff 必审 |
| 限流 | ulule/limiter `v3.11.2` | MIT | 仅用于普通请求整形；认证安全限流使用 MySQL 原子计数 |
| Worker Pool | panjf2000/ants/v2 `v2.12.1` | MIT | 进程内有界协程池，不承担持久队列 |
| 模型并发 | golang.org/x/sync `v0.22.0` semaphore | BSD-3-Clause | 每模型配置独立并发上限 |
| 模型熔断 | sony/gobreaker/v2 `v2.4.0` | MIT | 按模型配置版本维护熔断状态 |
| Metrics | prometheus/client_golang `v1.23.2` | Apache-2.0 | `/metrics` 与应用指标 |
| Tracing | OpenTelemetry Go `v1.44.0` + otelgin `v0.69.0` | Apache-2.0 | HTTP、DB、Worker、Provider 链路 |
| OpenAI | openai/openai-go/v3 `v3.42.0` | Apache-2.0 | OpenAI 官方 API |
| 火山引擎 | volcengine-go-sdk/arkruntime `v1.2.42` | Apache-2.0 | Ark 官方 API |
| 日志 | lifei6671/logit `v1.0.0` | 所有者授权使用，公开许可证待补 | 业务只依赖 `*slog.Logger`；logit 作为 Handler；发布前补齐公开许可证据 |
| Web 管理/SaaS UI | React/React DOM `18.3.1` + Ant Design `6.5.1` | MIT | `/admin` 通用表单、表格、分页、弹窗和 `/app` 新增 SaaS 页面；不升级 React 19 |
| Web 核心工作台 UI | shadcn `4.13.0` 生成源码；Tailwind CSS `4.3.2`；`@tailwindcss/vite` `4.3.2`；radix-ui `1.6.2`；tw-animate-css `1.4.0`；CVA `0.7.1`；clsx `2.1.1`；tailwind-merge `3.6.0`；lucide-react `1.24.0`；@types/node `26.1.1` | MIT / Apache-2.0 / ISC | 2026-07-15 已补充批准；商品、服饰、场景等 Web 响应式工作台生成源码后必须审查并 eject，不把 CLI 作为长期运行时依赖 |
| 测试 | testing + testify `v1.11.1` + testcontainers-go `v0.43.0` | BSD / MIT / MIT | 单测与真实 MySQL/S3 兼容测试 |
| Mock | uber-go/mock `v0.6.0` | Apache-2.0 | 接口测试替身 |
| 后续 Redis 队列 | hibiken/asynq | MIT | Redis 阶段再引入，第一期不依赖 |

依赖准入规则：

1. 必须有明确、兼容的开源许可证。
2. 必须有 Go Module、维护记录和可追踪 release。
3. 必须锁定版本，不依赖浮动分支。
4. 引入前检查 CVE、传递依赖和维护状态。
5. 同一职责只选择一个主组件，避免 ORM、配置、日志等能力重叠。
6. 只允许自行业务实现任务状态机、MySQL 8.0 兼容队列领取事务、积分规则、Provider 能力路由、错误码和权限后的用例编排。
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

- `/admin` 与 `/app` 新增 SaaS 页面采用 Ant Design v6 已批准版本，不使用浮动 `latest`。React 18 满足 v6 最低要求，升级 React 19 不属于本期必要范围。
- 管理端优先使用 Ant Design 的 `Form`、`Table`、`Pagination`、`Modal`、`Upload`、`Message` 等成熟组件，禁止自研通用表单、表格、分页、弹窗和上传控件。
- `/admin` 信息架构采用“数据运营后台”：桌面端使用可折叠左侧导航，固定包含概览、用户、
  任务、模型、积分、系统配置和审计；顶部只放页面标题 / 面包屑、全局状态与管理员账户入口。
  列表页统一使用筛选栏、Ant Design Table 和服务端分页；详情与简单编辑使用右侧 Drawer，
  模型、存储、邮件和 Provider 等复杂配置使用独立页面，危险操作使用 Modal。第一期不建设
  指标卡 / 趋势图驱动的仪表盘，不为展示型图表增加新的聚合 API。
- 商品、服饰、场景等 Web 核心工作台使用 shadcn/ui 源码组件、Tailwind 和所需 Radix primitives，按 Web 宽屏、平板和移动端重新设计信息层级、布局与视觉；不得用桌面固定尺寸布局冒充 Web 适配。
- 核心工作台响应式合同已选择 A：宽屏使用模块导航、360～420px 配置面板和自适应结果画布；平板收起模块导航并把配置面板放入可关闭抽屉；手机使用顶部工具栏与底部模块导航，配置和结果采用单列分步展示。任何断点都不得依赖横向滚动访问核心操作。
- 核心工作台视觉采用“编辑部式明亮影棚”：暖灰纸白主画布、墨黑文字、钴蓝唯一主操作强调色，状态色只表达错误/警告/成功；结果区按摄影联系表组织大图、细边线、稳定编号和留白，配置区用清晰分组维持专业密度。禁止紫色渐变、重阴影、大量悬浮卡片和默认 shadcn 模板拼装感。
- 抽屉、选择态和结果进入动画控制在 160～220ms；生成中使用骨架屏与轻微呼吸，不使用视差或连续装饰动画。正文最小 14px、中文行高至少 1.5，关键对比满足 WCAG AA，并在 `prefers-reduced-motion` 下关闭非必要过渡。
- `/admin` 使用独立 Ant Design `ConfigProvider` 和主题边界；`/app` 的 Ant Design SaaS 页面与 shadcn/ui 核心工作台必须隔离 CSS reset、主题 token 和 Portal 容器，Tailwind v4 不加载全局 Preflight，Web 工作台所需基础样式限制在 `/app` 根作用域，避免两套组件体系互相污染。
- **已确认边界：** `web/` 建立独立 shadcn/ui 展示层，不直接复用 `desktop/src/shared/ui`；只共享 OpenAPI DTO、Runtime Port、Mapper、表单 schema、view-model 和无平台依赖的纯业务逻辑，保持 Desktop 现有展示与视觉不变。禁止在同一组件内通过 `isWeb` / `isTauri` 混入两套布局和平台调用。
- `ShellPort`、本地 `WorkspacePort`、`ModelConfigPort`、`SecretPort` 在 Web mode 下通过 capability 隐藏本地入口。
- Web 已确认新增 `AuthPort`、`ProfilePort`、`CreditPort`；上传扩展现有 `AssetPort`，不重复新增 UploadPort。禁止新增无边界 `HttpPort` / `RemoteRequestPort`。管理端使用独立 API Client 和认证状态，不把通用 `AdminPort` 塞入共享 `RuntimeClient`。
- 管理端采用已批准的数据运营后台信息架构；具体字段编排遵循 OpenAPI 与 Ant Design 表单
  规范，不得在实现中擅自增加新业务能力或改变已批准危险操作流程。
- Remote adapter 不传 Base64、完整 Prompt、Provider 配置或 raw response。
- 用户端与管理端共享 OpenAPI 生成类型，但不共享认证状态和权限中间件。

## 13. 安全设计

- Session Cookie 使用 `Secure`、`HttpOnly` 和合适的 `SameSite`。
- Session 认证 / 加密 key、验证码派生/校验 key、MySQL 和 Redis 密码从部署实例配置文件读取；SMTP、S3 和 Provider 密钥从 `system_configs` 对应业务固定 key 的 JSON 中读取。第一期不使用环境变量注入或 Secret Manager。
- `server/conf/security/security.yaml` 显式配置 trusted proxy CIDR，默认空列表；直接暴露 Gin 时调用 `SetTrustedProxies(nil)`，只信任实际 Ingress / LB，禁止直接信任客户端 `X-Forwarded-For`。
- 第一期生产最多支持一层反向代理或 Ingress，并要求显式配置其 CIDR；`/app`、`/admin` 与 API 保持同域。第一期不接入 CDN。代理必须对 AI 改写 SSE 关闭 buffering，idle timeout 必须大于 SSE 最大持续时间；上传限制、客户端 IP 和 HTTPS scheme 只使用可信代理解析结果。后续引入 CDN 必须重新审批缓存、Cookie、SSE、上传和源站保护矩阵。
- 登录、验证码发送 / 校验、密码重置和管理员登录使用 MySQL `security_rate_limit_windows` 持久化原子计数与 blocked_until，不能只依赖重启即清零的进程内 limiter；普通请求整形仍可使用开源 limiter。
- `security_rate_limit_windows` 至少保存 subject hash、action、window start / end、count、`blocked_until`、`expires_at`、status 和 version，并建立 `(expires_at, id)` 清理索引；maintenance pool 固定批次删除过期窗口，防止随机邮箱和 IP 攻击无限制造永久记录。
- 上传、生成和管理操作分别限流，审计与限流统一使用可信代理解析后的客户端 IP。
- 所有资源查询在 Repository 层强制包含 `user_id`，Service 再校验业务所有权。
- 管理 API 使用独立管理员表、Session 和审计日志。
- 第一期间管理权限固定为单一 `platform_admin` 权限集，允许多个独立管理员账号，但不在
  `admin_users` 增加 role / permission 字段，不建立 RBAC 表、角色分配 API 或权限配置页面。
  每个管理请求必须校验管理员启用状态和 `session_version`；停用或版本变化立即清理管理
  Session。用户 Session 与管理 Session 不得互相替代。
- S3、Provider 与 SMTP 密钥允许作为对应业务固定 key 的 `system_configs.value_json` 字段保存；不得进入 API 响应、通用缓存、审计 old/new value、任务 payload、执行计划、日志、事件或 Trace。
- 所有 HTTP Server 配置 read header、read、write、idle timeout 和 body 上限。
- 上传防止路径穿越、伪造 MIME、超大图片、解码炸弹和对象覆盖。
- Provider 与结果下载执行统一 SSRF host allowlist、DNS / IP、重定向、响应体上限和 timeout 策略。
- `/metrics`、`pprof`、migration 和内部诊断接口不公开暴露。
- CORS 默认关闭，因为用户端、管理端和 API 同源。
- 所有业务写操作均为 POST，并使用 `net/http.CrossOriginProtection` 拒绝非安全跨域浏览器请求；前端不获取或回传 CSRF Token，服务端不自行实现 Token 算法。
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

`golangci-lint` 锁定 `v2.12.2`，仅使用校验官方 checksum 的独立 CI 可执行文件；
不写入 `go.mod`、不链接进产品，也不随服务端或桌面产品分发。其 GPL-3.0
许可只作用于该外部工具，实施时必须保留版本与 checksum 证据。

具体 Makefile 命令在 Go 工程建立后再同步补充，当前文档不把这些命令声明为仓库已存在能力。

### 14.2 兼容矩阵

- MySQL：CI 至少在一个 8.0.x 环境验证 schema、JSON、collation、唯一 / 外键矩阵、分页、乐观锁、`SKIP LOCKED` 并发领取、租约恢复和幂等；部署实际版本重复同一套测试。关键查询使用生产量级数据执行查询计划分析；实际版本支持时使用 `EXPLAIN ANALYZE`，否则至少使用 `EXPLAIN FORMAT=JSON`。
- Session：Cookie Store 与 Redis Store 分别验证登录、fixation 防护、idle / absolute TTL、退出、`session_version` 失效、密钥轮换、Cookie Path、同源 POST 放行、跨域 POST 拒绝、Store 切换全量登出和已声明的 Redis 支持矩阵。
- SMTP：使用本地开源测试 SMTP 服务验证 TLS、timeout、验证码一次性消费、同一 challenge 重试仍发送同一码、旧 challenge 失效、`delivery_failed`、最小剩余有效期、grant 原子消费、并发校验上限、进程在 SMTP 接收后崩溃的恢复，以及敏感信息不泄漏。
- 密码：在 `1 vCPU / 1 GiB` 等价环境从 `19 MiB / t=2 / p=1` 开始 benchmark；hash、verify、rehash 和密码重置 hash 共用全局并发 1，记录 p50/p95/max、CPU 和峰值 RSS，并验证 `p95 <= 500ms`、`max < 1s`、PHC 解析、旧参数 rehash 和超长输入拒绝。
- 本地 Blob：`NoTempDir=true`、原子写入、相对 key、引用保护、分批 GC、Windows 路径、同文件系统 rename、磁盘空间阈值、持久卷重启、backup epoch、备份恢复和数据库 / Blob 对账。
- S3 Blob：使用 S3 兼容测试服务验证 Bucket CORS、Presigned POST policy、上传会话、completed 后重传、checksum / ETag / VersionId 条件提交、服务端 complete 校验、临时对象 lifecycle、读取和删除。
- Provider：使用 `httptest.Server` 验证官方 SDK 的请求结构、`WithMaxRetries(0)`、timeout、取消、错误归一化、持久化调用记录、Provider 幂等标识、`result_uncertain` 立即终结用户侧执行与释放预留、允许新 run 重试、晚到结果隔离、内部自动 / 人工对账和超期告警。
- AI 改写 SSE：验证 POST + `CrossOriginProtection`、capability 白名单、输入 / 输出 / 并发上限、`text/event-stream` Header、禁用压缩和 `Content-Length`、`meta -> delta* -> done|error` 顺序、终态后禁止继续写事件、sequence 规则、JSON 安全序列化与事件注入、UTF-8 跨 chunk 拼接、心跳、即时 flush、代理不缓冲、超时和客户端断开取消 Provider。状态竞争必须覆盖 completed / failed / cancelled 终态重放不重复调用模型、stale-running 恢复、DB 成功但 `done` 写失败、DB 失败不得发送 `done`、首个 delta 后禁止 fallback，以及断连取消与 Provider 完成并发时只有一个 CAS 终态成功。
- 真实 OpenAI / 火山调用只作为受控 smoke test，不能成为默认 CI。

### 14.3 必测业务风险

- 未登录、跨用户 IDOR 和管理端越权。
- 未登录访问受保护 `/app/*` 深链必须进入独立登录页；合法 `returnTo` 在登录成功后 replace 回跳，外部地址、`//`、反斜杠、编码绕过和 `/admin` 必须回退 `/app`；401 不得自动重放失败 POST。
- 相同 Idempotency-Key 与相同请求体返回同一结果；相同 key 搭配不同请求体被拒绝，且不会重复建任务、run、积分预占或 job。
- 规范化后语义相同但 JSON 字段顺序不同的请求产生相同 request hash；并发上传 complete 只能由一个 upload session owner 执行 Blob 提交，处理中请求返回同一 operation 状态。
- 任务重试创建新的 `generation_run`；创建 run 后修改模型配置，不得改变该 run 已冻结的执行计划。
- Worker 崩溃、进程重启、租约过期、独立 lease token、超过最大次数不再领取、晚到结果和取消竞争。
- 邮件、生成、维护三个池的容量、领取和故障相互隔离，任何池都不得超领超过自身空闲槽位的 job。
- 商品/服饰单图重试的稳定结果槽与 tombstone。
- Provider 超时、限流、非法响应、SSRF、下载失败、部分成功和 `result_uncertain`；结果不确定时不得在原 run 自动切换候选，用户侧必须立即失败/部分失败并释放未消费预留，晚到结果不得交付或补扣。
- 创建 run 时按每个计划槽的候选最高冻结单价之和预留；每张已校验、已入 Blob、已被稳定结果槽采纳的用户可见输出按实际模型冻结单价消费。覆盖 A 单价 3 产 2 张、B 单价 5 产 1 张合计 11，同槽重复完成只收费一次，不同槽逐张收费，首选与 fallback 单价不同，模型调价只影响新 run，用户主动重试的新 run 独立收费，部分成功按成功图收费并释放剩余预留，零成功明确失败或取消释放全部预留，积分字段超过 1,000,000,000,000 时拒绝整笔事务，以及管理员充值正数 / 幂等 / 审计。
- 用户积分流水必须逐图展示平台计费项、图片单价、quantity=1、冻结 / 解冻 / 消费和扣后余额；游标翻页始终按 Session 用户过滤，关联任务或 output 已 purge 时不得泄露内部 ID，DTO 不返回 Provider、真实模型、内部配置、幂等、Provider 成本或审计敏感字段。
- S3 与本地存储保持同一业务结果；上传会话过期、伪造 MIME、超大对象、路径穿越、磁盘写满和本地 Blob 恢复均有失败用例。
- 删除素材与 queued / running run、历史重试并发时，仍被引用的输入和输出 Blob 不得被 GC；引用释放与 GC 竞争必须再次校验对象版本。
- Blob 已写入后，分别在 output 插入、积分流水、账户更新、稳定槽 CAS、run / job 终态处注入失败，整个 MySQL 事务必须回滚且只留下可清理孤儿 Blob；同一 `run_id + slot_code` 即使恢复时产生不同 output ID 或重复完成，也只能生成一条消费流水，不同 slot 必须各自产生一次正确消费。
- 验证 `available >= 0`、`reserved >= 0`、reservation 守恒和 account reserved 对账不变量；发现不一致只告警，不自动改账。
- trusted proxy、登录 / 验证码持久限流、Session 同源 CSRF 防护和管理员高风险操作权限边界。
- 只有 AI 帮写 / AI 改写 endpoint 返回 SSE；图片生成、任务历史、邮件和管理端任务状态保持 polling。SSE 事件不得包含 raw Provider chunk、Prompt、凭据或字符串错误码。
- 除 `system_configs` 对应业务配置 JSON 的密钥字段外，其他数据库表、日志、事件和 API DTO 不包含密钥、raw prompt 或 raw response。
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
- 建立 trusted proxy、`CrossOriginProtection` 同源拒绝合同、请求体上限、`/healthz`、`/readyz`、`server migrate up` 和 serve 阶段 schema 校验。
- 按所有者授权锁定 `logit v1.0.0` 并作为 slog Handler；正式发布前补齐公开许可证据。

### G0.5：状态机、幂等与故障注入定稿

- 冻结 `generation_task`、`generation_run`、`async_job`、`model_invocation`、资产引用和稳定结果槽之间的状态、事实源和事务边界。
- 冻结输出提交、各计划槽候选最高图片单价预留、实际产出模型逐图消费、槽级价差与未交付槽释放、用户逐图流水、`result_uncertain` 处理、邮件 challenge / grant、事务型 / Saga 型 Idempotency-Key，以及 Prompt / Capability 历史版本协议。
- 冻结 `mail`、`generation`、`maintenance` 三条逻辑队列和三个 `ants` 池的容量、租约与停机协议。
- 输出 generation run、async job、model invocation、credit reservation、upload session 和 mail challenge 的状态转换表；每条迁移标注事务边界、幂等键、允许操作者和失败恢复路径。
- 先完成 SMTP 已接收后崩溃、Provider 已受理后超时、Blob 已写入但事务失败、积分消费时崩溃、资产删除与任务引用竞争、两个相同 Idempotency-Key 并发提交等故障注入测试。G0.5 验收通过是进入 G1～G4 核心实现的门禁。

### G1：MySQL 基线与最小邮件队列

- MySQL 8.0 兼容显式 migration、核心表、唯一 / 外键矩阵、`utf8mb4_0900_ai_ci`、`DATETIME(3)`、`TINYINT` status、`version` 和显式 `TableName()`。
- `model_configs` 直接保存管理员配置的每张图片积分单价；`credit_reservations` 是 run 的计划槽总预留汇总事实源，`credit_ledger` 逐图复制实际模型 ID / version 与单价快照，`generation_runs` 不重复保存账务字段。
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
- 积分账户、每槽候选模型单价快照、计划槽最高价总预留、实际产出模型逐图消费、槽级价差与未交付槽释放及结果不确定处理。
- G3 使用固定 model config 图片单价 fixture 验证积分状态机；真实 Provider 路由在 G4 接入，并验证不同模型共同产出时总消费等于各成功图片冻结单价之和，Provider 真实成本不得改变平台单价。

### G4：模型网关

- OpenAI 官方 Go SDK adapter。
- 火山引擎 Ark 官方 Go SDK adapter。
- 四类模型多候选、优先级、独立并发 / timeout、熔断、降级分类和调用审计。
- 模型配置图片单价、版本与变更审计，以及 actual model invocation 到 output / slot 的执行审计关联；invocation 不重复保存另一套用户单价。
- Prompt Catalog、Capability、模型路由、SSRF 防护和安全日志。
- 调用前持久化 `model_invocation`，透传 Provider 支持的幂等 / request 标识，并实现 `result_uncertain` 的立即用户侧终结、晚到隔离和仅供平台内部核销的对账入口。
- 建立 `AiAssistService` 流式入口和 `ai_assist_invocations`，将官方 SDK 文本增量归一化为 SSE `meta / delta / done / error`，不进入 `async_jobs`，并验证断开取消和幂等终态重放。

### G5：用户 Web

- `RemoteRuntimeClient`。
- `/app` 登录、素材、生成、历史、设置和个人积分流水；用户提交前可查看最高可能冻结积分，完成后逐图查看图片单价、消费和扣后余额，不展示真实 Provider、fallback 路径或 Provider 成本。
- 生成主操作使用行内积分提示而非重复弹窗；报价来自服务端 plan View，计算中、配置失效和余额不足均禁用提交。创建后区分冻结与消费，每张结果展示扣费/未扣费，终态展示实际扣除、解冻和余额。
- Remote `AiAssistPort.streamProductSellingPoints` 使用 POST fetch 流消费 SSE；其他 Runtime Port 的异步任务状态继续 polling，不建立通用 SSE Client 或 WebSocket 层。
- 登录、注册、找回密码、上传和积分流水等新增 SaaS 页面使用 Ant Design；商品、服饰、场景等 Web 核心工作台使用独立 shadcn/ui 展示层重新完成响应式适配与视觉美化，不复用 Desktop 展示组件或全局 CSS。
- 商品、服饰、场景 Web 页面保留“配置—生成—查看结果”的业务心智：宽屏并排操作，平板以抽屉编辑配置，手机以单列步骤切换配置与结果；历史、素材和积分保持全局导航入口，不嵌入模块临时配置状态。
- 三类工作台共享编辑部式明亮影棚 token 和联系表结果语言，不为不同模块建立三套主题色；模块差异由标题、内容、图像比例与业务控件体现。
- 素材采用“双入口、同一事实源”：商品、服饰、场景的素材槽同时提供上传与从素材库选择；
  工作台上传成功后自动选入当前槽并进入全局素材库，移除仅解除当前选择。批量上传只建立
  前端队列，每个文件独立执行 prepare/upload/complete 和 upload session；只有 completed
  asset 可用于生成，失败只重试失败项。宽屏内嵌选择器、平板抽屉、手机全屏“拍照/相册
  上传 + 素材库”，前端业务请求只传 assetId。

### G6：管理 Web

- `/admin` 用户、任务、模型、积分、存储和审计。
- 使用多个独立管理员账号和固定 `platform_admin` 权限集；不实现角色矩阵或权限配置页。
- 使用可折叠左侧导航、筛选表格、服务端分页、右侧详情 Drawer、复杂配置独立页和危险
  操作 Modal；不实现展示型仪表盘或额外趋势聚合 API。
- 管理员积分充值、在模型配置中维护每张图片积分单价、模型版本与审计、逐图积分流水，以及 invocation 级结果不确定内部对账；管理端不得把 Provider 成本作为用户单价，也不得恢复晚到交付或补扣用户。
- `system_configs`、邮件服务配置、测试邮件和 Ant Design v6 组件接入。
- loading、disabled、toast、权限和危险操作确认；积分充值、模型图片单价更新、模型删除、
  停用用户、Provider / S3 / SMTP 密钥变更和不确定 invocation 核销使用近期认证、原因、
  二次确认和脱敏审计，任务取消使用二次确认与审计。
- 具体视觉和交互先经用户确认。

### G7：商用加固

- MFA、告警、容量压测、安全回归和灾难恢复演练；核心持久限流、指标、Tracing 与备份恢复不得推迟到本阶段才首次实现。
- 跨用户安全测试、故障演练和对象清理演练。
- 内部用户灰度后再开放外部注册。

## 16. 风险与已关闭实施前决策

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
11. Provider 结果不确定时，平台可能已经产生真实成本；用户侧立即失败/部分失败并解冻后允许新 run 重试，可能形成重复 Provider 成本。必须监控不确定调用、隔离晚到结果并由平台核销，不能把成本反向转嫁给用户。
12. 确定性验证码依赖版本化 HMAC 密钥；密钥轮换、保留周期和灾难恢复必须与未过期 challenge 生命周期匹配。
13. 项目只承诺 SQL 最低兼容 MySQL 8.0，不锁定具体 patch；不同 8.0.x、8.4 或托管兼容实现仍可能在 collation、优化器、DDL 和运维能力上存在差异，因此部署实际版本必须重新执行 migration、事务、关键 SQL、备份恢复和故障验收。
14. 资产逻辑删除与物理对象释放分离后，历史保留会增加存储成本；GC 引用查询、保留期限和用户用量展示必须持续对账，不能用提前删除换取容量。
15. S3 兼容实现对 Presigned POST、CORS、checksum 和条件复制的支持不一致；未通过目标厂商兼容矩阵时只能标记为实验性存储后端。
16. SSE 会占用长连接并受到反向代理 buffering、idle timeout、HTTP write deadline 和浏览器断连影响；第一期严格限制在 AI 改写，设置用户级并发与最大持续时间，不能扩展成通用任务总线。
17. 模型图片单价与 Provider 成本解耦后，Provider 成本上涨不会自动调整用户积分单价；运营必须独立监控积分收入与真实成本差异，并通过更新 model config 图片单价和 version 只调整后续新 run 的价格。

### 16.2 DS0 实施前决策已关闭

DS0-01～DS0-10 已于 2026-07-15 全部获得用户批准。DS0-10 最终矩阵如下：

- 一期纳入鉴权素材 / 结果下载及现有单图、全部图片、长图下载的 Web 对齐，软删除、引用
  保护、Purge / GC，固定 `platform_admin` 与审计，用量统计和全局磁盘水位，以及已确认的
  分层保留期。
- 一期不纳入服务端 ZIP 归档、完整个人数据导出、细粒度 RBAC、自助永久注销 / 法定删除 /
  邮箱匿名化和按用户硬存储配额；分别由任务清单 `WEB-FUP-01`～`WEB-FUP-05` 跟踪。
- active 用户内容不自动过期；删除后 7 天 GC 宽限，临时 / 孤儿对象 24 小时，task events /
  模型诊断摘要 90 天，积分流水、管理审计及 task / run 核心审计记录第一期不自动删除。

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
- [net/http CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection)
- [GO-2025-3884：gorilla/csrf 未修复漏洞与迁移建议](https://pkg.go.dev/vuln/GO-2025-3884)
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
- [MySQL 8.0 Release Notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/)
- [OpenTelemetry Go](https://opentelemetry.io/docs/languages/go/)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## 18. 最终原则

1. Go 1.26 单进程同时承载 Gin API 和有界 Worker Pool；第一版生产固定单副本。
2. 用户端与管理端同域部署，通过 `/app` 和 `/admin` 隔离。
3. 第一期只做个人用户，所有业务数据以 `user_id` 隔离。
4. 数据库 SQL 最低兼容 MySQL 8.0，不锁定具体版本；统一 collation、DATETIME、TINYINT status、version 乐观锁和显式 `TableName()`，部署实际版本必须通过完整数据库验收。
5. `async_jobs` 是唯一持久队列，邮件、生成、维护使用三个独立 `ants` 池；业务事实仍保存在各自业务表，租约、心跳和幂等不可省略。
6. `generation_task` 表示用户意图，`generation_run` 表示一次执行尝试；执行计划在 run 创建时持久化冻结，重试必须新建 run。
7. 积分按整数记账，管理员可幂等充值；第一版在 model config 维护与 Provider 成本解耦的每张图片积分单价。创建 run 时按各计划槽候选最高单价之和预留，每张被稳定结果槽采纳的有效图片按实际产出模型冻结单价消费，A 单价 3 产 2 张、B 单价 5 产 1 张合计 11；失败、取消或结果不确定时释放未交付槽预留，已交付图片不退款，并生成用户可查询的逐图不可变流水；晚到结果不交付、不补扣。
8. S3 和本地存储统一使用 Go CDK Blob，不自行实现对象存储 SDK；资产逻辑删除不得破坏任务引用，本地 Blob 可用于单副本生产，但必须使用持久卷、磁盘水位、backup epoch 和恢复演练。
9. OpenAI 和火山引擎优先使用官方 SDK，只在业务边界做薄适配；结果不确定不得自动切换候选。
10. Entity、DTO 和 Mapper 明确分离，数据库结构不得直接暴露到 HTTP。
11. `lib` 只承载跨模块基础能力，不演变成无边界工具包。
12. 日志统一使用 `slog`；按所有者授权使用 `logit v1.0.0` 作为 Handler，正式发布前补齐公开许可证据。
13. HTTP 业务合同只允许 GET / POST，错误码使用 int；所有列表必须分页，禁止无界查询和一次性全量加载。
14. Session 使用 Gin 中间件并可配置 Cookie / Redis Store；密码使用 Argon2id；邮件使用确定性 challenge 验证码和 SMTP 开源组件异步发送。
15. 四类模型均允许配置多个候选，每个候选有独立优先级、并发、timeout 和降级规则。
16. 管理端和 `/app` 新增 SaaS 页面使用 Ant Design v6；商品、服饰、场景等 Web 核心工作台使用 shadcn/ui 做响应式适配与视觉美化。两套组件体系隔离主题和 CSS，Desktop 展示是否变化必须遵守 DS0-09 的明确授权。
17. 通用能力优先选择成熟开源组件，自行代码只保留业务状态机和必要适配。
18. 凭据只允许进入部署实例配置文件或 `system_configs` 对应业务固定 key 的 JSON；raw prompt、Provider raw response、验证码、凭据和图片 Base64 不进入其他数据库表、日志、事件或前端 DTO。
19. 第一期仅 AI 帮写 / AI 改写使用 POST SSE 流式返回文本；图片生成及其他异步任务继续 polling，不引入 WebSocket，也不把 SSE 扩展成持久队列。
