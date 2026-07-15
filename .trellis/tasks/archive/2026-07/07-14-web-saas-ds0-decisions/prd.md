# 冻结 Web SaaS DS0 决策

## Goal

在进入 Web SaaS Go 代码实施前，逐项冻结
`docs/2026-07-14-web-saas-go-implementation-task-checklist.md` 中
DS0-01～DS0-10 的产品、架构、安全、运维与交互决策，为 G0 及后续 Gate
提供可追溯、无歧义的授权边界。

## Background

- 事实源为 `docs/2026-07-14-web-saas-go-technical-plan.md` 和
  `docs/2026-07-14-web-saas-go-implementation-task-checklist.md`。
- 当前清单记录 100 个唯一任务，状态均未开始；DS0 是所有实现任务的前置门禁。
- DS0 全部属于 Ask First。未确认时只能研究和完善文档，不得写入依赖、lockfile、
  schema、公共 API、配置、权限或外部服务实现。
- 当前 Git 工作树在任务创建前为 clean；仓库存在 `.codegraph/`。
- CodeGraph 当前只定位到既有桌面 Rust HTTP Provider 实现，尚未发现已落地的 Web SaaS
  Go `server/`、Web 前端或 Go `logit` 请求日志封装。
- 只读摸底确认当前没有 `server/`、`web/`、`go.mod`、`go.sum`、Ant Design、
  Web API Client 或 RemoteRuntimeClient；本机 Go 为 `go1.26.0`，清单要求的
  `toolchain go1.26.5` 尚未落地验证。
- `github.com/lifei6671/logit` 最新 `v1.0.0` 提供 `WithContext`、`AddField`、
  `AddMetaField`、`NewSlogHandler` 和 `NewSlogLogger`，但该版本根目录没有
  `LICENSE`；旧版 `v0.4.6` 虽有 MIT LICENSE，但 API 不同且不作为推荐回退。
- 2026-07-14 用户确认 `logit` 是其本人项目，虽暂未公开上传开源协议，但明确授权
  本项目放心使用并继续推进。依赖规划按 `v1.0.0` 与其 slog Handler API 进行；
  公开许可证文件仍作为发布前依赖证据补齐项，不再作为当前开发规划阻塞。

## Requirements

### R1 决策门禁

- 逐项确认 DS0-01～DS0-10，不把技术方案中的建议自动视为用户批准。
- 每项决策记录推荐方案、备选方案、取舍、批准人和日期。
- 依赖未关闭的下游任务保持阻塞，不抢跑实现。

### R2 实施约束

- 后续新增或修改的代码必须具备完善、准确的简体中文注释，重点解释公开合同、
  边界规则、并发不变量、安全约束和失败语义，不写重复代码字面的无效注释。
- 存在方案分歧时，先给推荐方案及代价，由用户选择后再实施。
- Web UI 采用分区组件基线：`/admin` 全面使用 Ant Design v6；`/app` 的认证、上传、积分
  等新增 SaaS 页面按已选 A 使用 Ant Design，商品、服饰、场景等 Web 核心工作台使用
  shadcn/ui 重新做响应式适配与视觉美化。Desktop 既有 UI 保持独立展示层和现有视觉，
  不直接迁移 Web 组件、Tailwind 样式或 Remote adapter。
- 每次 HTTP 请求必须在请求前通过日志 context 写入入参摘要和核心关键参数，请求结束
  写结构化完成日志；凭据、验证码、raw prompt、Provider raw response、图片 Base64、
  原始文件内容和其他敏感字段不得进入 context 或日志。
- 推荐把“每次 HTTP 请求”解释为所有入站 Gin 请求和所有出站 HTTP 调用：入站由最外层
  middleware 创建 logit context，出站复用 request/job context；两者都只记录白名单
  参数、状态、安全错误码和耗时，不记录 raw body、完整 URL、header 或原始响应。
- 业务代码统一依赖标准库 `*slog.Logger`。技术方案建议用
  `github.com/lifei6671/logit v1.0.0` 作为 slog Handler。用户已作为项目所有者
  明确授权当前项目使用，因此不启用 `slog.JSONHandler` 回退；业务层不得直接绑定
  logit 具体类型，避免日志实现扩散到 Service、Repository 和 Worker。

### R3 开发与验收

- 后续实现遵循清单依赖拓扑、TDD、最小正确改动和仓库定义的验证命令。
- 任务只有在实现、自动化验证、所需环境/安全证据和人工验收均完成后才能标为
  `已完成` 并勾选 `[x]`。
- DS0 完成后从 G0 的最小依赖闭环开始，不修改 Local-first M0～M7 的完成状态。

## Confirmed Decisions

### DS0-01 第一期范围

- 批准人：lifei6671。
- 初次批准日期：2026-07-14。
- 计费合同重新批准日期：2026-07-15。
- 决策：第一期固定 Go 单进程、生产单副本、个人用户、同域 `/app` 与 `/admin`、
  业务 API 仅 GET/POST、SSE 仅用于 AI 帮写/改写。
- 明确排除：支付、团队、BYOK、多副本。
- 影响：按现有技术方案与任务清单依赖继续推进，不扩展权限、计费、租户与分布式
  协调范围。

### logit 使用授权

- 授权人：lifei6671。
- 授权日期：2026-07-14。
- 决策：允许本项目使用其本人维护的 `github.com/lifei6671/logit v1.0.0`；
  暂未公开上传许可证不阻塞当前开发规划。

### CSRF 防护组件

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：采用 Go 标准库 `net/http.CrossOriginProtection`，不引入存在未修复漏洞的
  `github.com/gorilla/csrf`。
- 合同影响：删除匿名 CSRF Token、登录后刷新 Token、CSRF Cookie 和对应 OpenAPI
  schema；用户端和管理端分别装配拒绝处理器并返回统一整数错误码。

### golangci-lint 许可边界

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：锁定 `golangci-lint v2.12.2`，仅使用校验 checksum 的官方独立 CI
  可执行文件；不写入 `go.mod`、不链接进产品、不随服务端或桌面产品分发。
- 许可记录：工具为 GPL-3.0；本项目只执行该外部工具，不复制或分发其二进制。

### OpenAPI 生成器输入边界

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：使用 `oapi-codegen v2.7.2`，只处理仓库内受评审 OpenAPI 文件；禁止
  构建时下载远程 schema、接受用户上传或第三方 schema。
- 质量门禁：OpenAPI 变更和生成 diff 都必须审查，CI 校验生成结果与 schema 一致；
  前端生成器锁定 `openapi-typescript 7.13.0` 并遵守同一输入边界。

### DS0-02 集中依赖审批

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：批准本 PRD“DS0-02 依赖核验”列出的精确版本及使用边界；Web 使用独立
  npm + `package-lock.json`，不迁移 pnpm/yarn 或 root workspace，不升级 React 19。
- 安全边界：`limiter` 只做普通流量整形；认证安全限流使用 MySQL 原子计数；
  x/crypto 禁止导入 `openpgp/*`；Argon2id 按 DS0-06 在 `1 vCPU / 1 GiB`
  环境从 `19 MiB / t=2 / p=1` 开始实测，最终参数由 G2-T01 产生。
- 后续门禁：生成 `go.mod`、`go.sum` 和前端 lockfile 后必须执行 `govulncheck`、
  `npm audit`、SBOM 和传递依赖许可证扫描；发现高危问题时回滚 DS0-02 重新选型。
- 补充审批结果：2026-07-15 用户新增 Web 核心工作台使用 shadcn/ui 的要求，并选择 A
  批准独立 `web/` 包、Tailwind v4、Radix、shadcn CLI 等下列精确依赖；Desktop UI、全局
  CSS、Tailwind 配置和 lockfile 保持不变。生成新 lockfile 后仍须执行既定依赖门禁。

### DS0-03 Schema 与公共合同

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：批准技术方案第 5、6 章定义的 MySQL baseline、OpenAPI、DTO、整数错误码、
  Idempotency-Key 和 AI 改写 POST SSE 合同；其他异步任务继续 polling。
- 分层边界：Entity、Service Command/View、OpenAPI DTO 严格分离；生成类型是唯一
  HTTP DTO；不新增通用 `HttpPort` 或 `RemoteRequestPort`。
- Runtime Port：新增 `AuthPort`、`ProfilePort`、`CreditPort`；上传扩展现有
  `AssetPort`；管理端使用独立 API Client 和认证状态，不把 `AdminPort` 塞入共享
  `RuntimeClient`；Web 模式通过 capability 隐藏仅本地可用端口。
- 修订状态：2026-07-15 用户否决 `system_configs["credit_billing"]` 全局价格方案，明确
  图片单价必须绑定 `model_configs`，管理员在配置模型时同时设置该模型面向用户的每张
  图片积分；该单价仍与 Provider 真实货币成本无关。
- 重新批准结果：用户确认每张被采纳的有效图片按实际产出模型单价收费，字段命名为
  `model_configs.points_per_image`；批准按计划结果槽预留、reservation / ledger 快照、
  `consume:{run_id}:{slot_code}`、槽级消费唯一键、管理 `pointsPerImage` 与用户逐图积分
  DTO，以及 `result_uncertain` 仅释放未交付槽的状态归属。
- 补充批准结果：2026-07-15 用户选择 A，新增独立、无副作用的
  `POST /api/v1/generation-plans/quote`。报价与创建 task 调用同一个 plan compiler；响应返回
  `plannedSlotCount`、`maxReservedPoints`、`availablePoints`、`shortfallPoints`、
  `quoteVersion` 和安全失效原因，不创建 task/run/reservation/job，也不持久化 Prompt 或报价。
- 创建 task 必须携带不透明 `quoteVersion`，服务端仍重新编译并执行最终原子余额校验；报价
  失效时返回 HTTP 409、稳定整数错误码和刷新后的安全 Quote View，前端不得自动重放。
  `GenerationPort` 增加生成计划报价方法；不保留 create `previewOnly` 兼容模式。

### DS0-04 存储后端默认值

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：默认使用本地目录 `fileblob` 存储文件；只有用户手动配置 S3 后才切换
  `s3blob`。
- 已确认边界：未配置 S3 时不自动探测或上传云端；切换后端需要重启，第一期不做
  运行中热切换或既有对象自动迁移。
- 配置权限：S3 仅管理员可配置；普通用户没有 Bucket、endpoint、region、Access Key
  或自有对象存储绑定入口。
- 配置存储：S3 endpoint、Bucket、region、Access Key 等配置统一由管理员后台写入
  `system_configs`；密钥字段按 DS0-05 的凭据配置规则处理。

### DS0-04 Session 与 Redis 拓扑

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：默认使用加密 Cookie Store；管理员可配置并切换为单节点 Redis Store，
  Redis 可选 TLS；第一期不支持 Sentinel 或 Cluster，普通用户不能选择 Store。
- 失败语义：启用 Redis 但连接失败时服务启动失败，禁止静默回退 Cookie；Store 切换
  需要重启并使现有 Session 全部失效，不实现在线迁移。

### DS0-04 SMTP 部署方式

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：默认不配置 SMTP，支持标准 SMTP 且不绑定特定厂商；部署配置维护 endpoint /
  profile 白名单，管理员只能选择白名单项和维护非敏感参数，普通用户不能配置。
- 可用性：SMTP 未配置或临时不可用不影响基础 readiness，但注册、验证码、密码重置
  等邮件 capability 必须标记不可用；开放外部注册前必须完成真实 SMTP 验收。
- 安全：禁止录入任意 host；测试邮件结果脱敏并写管理员审计；SMTP 密码由管理员后台
  写入 `system_configs`。

### DS0-04 反向代理与 CDN

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：默认 trusted proxy 列表为空；生产最多支持一层显式 CIDR 的反向代理或
  Ingress；用户端、管理端与 API 保持同域；第一期不接 CDN。
- 验收边界：代理必须关闭 AI 改写 SSE buffering，idle timeout 大于最大流时长；
  上传限制、客户端 IP 和 HTTPS scheme 只采用可信代理解析结果。
- 后续扩展：引入 CDN 需要重新审批缓存、Cookie、SSE、上传和源站保护矩阵。

### DS0-04 Provider 矩阵

- 批准人：lifei6671。
- 批准日期：2026-07-14。
- 决策：生产 Provider allowlist 固定为 OpenAI 与火山引擎，不开放 custom gateway；
  默认不配置凭据，仅管理员可配置模型与路由，普通用户不能配置 API Key 或 BYOK。
- 可用性：Provider 未配置或临时不可用只让对应 AI capability 标记不可用，不影响
  基础 readiness；Mock 仅用于测试和本地调试。
- 验证：CI 不调用付费 Provider；真实调用只在受控环境执行 smoke test；SDK 类型通过
  项目 Provider facade 隔离。

### DS0-04 完整部署矩阵

- MySQL：使用 MySQL，最低兼容与版本验收策略由 DS0-07 冻结。
- Blob：默认本地 `fileblob`；仅管理员可手动切换经兼容验证的 S3。
- Session：默认 Cookie；管理员可切单节点 Redis，可选 TLS，不支持 Sentinel/Cluster。
- SMTP：默认未配置；管理员只能选择部署白名单 profile；开放注册前真实验收。
- 网络：默认不信任代理；生产最多一层显式可信代理；同域部署；第一期不接 CDN。
- Provider：OpenAI 与火山引擎；无默认凭据；普通用户无配置权。

### DS0-05 Secret 管理口径

- 批准人：lifei6671。
- 批准日期：2026-07-15。
- 决策：不使用环境变量注入，不引入 Secret Manager。
- 启动必需凭据：MySQL、Redis 等程序启动所需密码直接写入服务端配置文件。
- 非必需凭据：S3、SMTP、OpenAI、火山引擎等密钥由管理员在后台配置页面维护并
  直接写入 MySQL `system_configs`；不新建独立密钥表，普通用户无配置权限。
- 表内约定：`system_configs` 是纯 KV 表，key 由服务端按业务固定，value 是该业务的
  完整 JSON 配置；不增加 `value_type`、凭据专用记录或 `secret_ref`。例如邮件服务可按
  用户给出的固定 key `email_stmp` 读取并解析 SMTP JSON。
- 管理语义：每个固定 key 使用独立 typed schema 和 DTO；管理员更新时原子合并 JSON，
  `version` CAS。省略密钥字段表示保留原值，空字符串非法，清空必须提交显式动作；
  查询移除密码/API Key 等字段，只返回普通配置和已配置状态。
- 访问边界：通用配置列表、DTO、缓存、审计 old/new value、日志、Trace、Metrics、
  任务 payload、执行计划、诊断和任何后续导出不得读取或复制完整敏感 JSON。
- 启动级配置：MySQL、Redis、Cookie Session key、验证码派生/校验 key 等在数据库
  连接或核心认证初始化前必须可用的值均写入部署配置文件，不能在管理后台修改。
- 已知风险：配置文件或数据库备份泄漏会直接暴露凭据；用户已明确选择简化方案。

### DS0-06 Argon2id 基准环境

- 批准人：lifei6671。
- 批准日期：2026-07-15。
- 决策：第一期最低生产规格和 Argon2id benchmark 基准固定为
  `1 vCPU / 1 GiB`；单实例全局最多同时执行 1 个密码 hash/verify，等待 semaphore
  必须受 request context 和 deadline 约束。
- 参数起点：从 OWASP 最低建议 `19 MiB / t=2 / p=1` 开始实测；最终参数由 G2-T01
  benchmark 产生，不在方案阶段写死。
- 验收门禁：预热后分别测试 hash 与 verify，单次操作 `p95 <= 500ms`、最大值
  `< 1s`；记录 p50、p95、max、CPU 和峰值 RSS。未来需要提高认证吞吐时优先扩容，
  不能在 1 vCPU 上直接放宽并发。

### DS0-07 MySQL 兼容与版本策略

- 批准人：lifei6671。
- 批准日期：2026-07-15。
- 决策：项目不限定具体 MySQL patch 或 LTS 系列；应用 SQL、migration、事务和
  Repository 最低兼容 MySQL 8.0，不支持 MySQL 5.6 / 5.7，MariaDB 不在声明范围。
- 验证：CI 至少在一个 8.0.x 环境执行数据库测试；migration 与 serve 拒绝低于 8.0、
  MariaDB 或缺少必要能力的实例；部署实际版本另行执行完整 `V-DB`、队列、关键 SQL、
  备份恢复和 CVE 检查。
- 版本管理：项目合同不固定数据库版本，但每次实际部署必须记录准确版本；版本升级后
  重新执行兼容验收，不能仅凭“同属 MySQL 8.x”直接放行。

### DS0-08 平台积分与 Provider 成本

- 批准人：lifei6671。
- 批准日期：2026-07-15。
- 已确认：用户积分价格由平台自行配置，与后端 Provider 的实际货币成本完全解耦。
  例如 Provider 实际调用成本为 2 元时，平台仍可把一次请求定价为 3 积分；Provider
  真实成本变化不得自动改变该请求展示给用户的积分价格。
- 已确认：图片积分单价绑定 `model_configs`，管理员在配置模型时设置每张成功图片所需
  积分；不使用 `system_configs` 保存全局图片生成价格。
- 已确认：选择 A“成功交付才扣”。创建 run 时按每个计划结果槽的候选模型最高冻结单价
  之和预留；只有图片完成校验、写入 Blob 并被稳定结果槽采纳后，才按该槽实际产出模型
  的冻结单价消费一次，并释放该槽最高预留与实际单价的差额。
- 已确认：计费粒度是每张被采纳的有效图片，不是每个 run 固定收费。模型 A 每张 3 积分
  产出 2 张、模型 B 每张 5 积分产出 1 张时，同一 run 合计消费 `3×2+5×1=11` 积分。
- 已确认：同一槽的 Worker 重试、租约恢复和候选降级不得重复收费；用户主动重试创建新
  run 和新计费槽。Provider 实际成本不得改变冻结单价，输出数量按实际成功采纳图片数
  逐张计费。
- 已确认：`result_uncertain` 采用立即解冻方案。原 `model_invocation` 保持内部不确定
  状态并进入平台对账；内部 run / job 立即进入既有 `failed` 终态，用户聚合状态按是否
  已有有效输出显示 `failed` 或 `partial_failed`，同一事务释放全部未消费预留，用户
  可以立即创建新 run 重试。
- 已确认：原 invocation 的任何晚到结果都不得恢复交付、覆盖稳定槽或补扣积分，只能
  隔离并按孤儿对象规则清理；Provider 真实成本由平台内部核销。
- 已确认：选择 A，`model_configs` 图片单价字段使用语义明确的 `points_per_image`；管理
  OpenAPI / TypeScript DTO 对应使用 `pointsPerImage`，不再保留 `request_points` 兼容字段。

### DS0-09 用户端与管理端交互

- 批准人：lifei6671。
- 决策日期：2026-07-15。
- 已确认：选择组件边界 A，`/admin` 以 Ant Design v6 为完整组件基线；`/app` 的登录、
  注册、找回密码、上传和积分流水等新增 SaaS 页面优先使用 Ant Design。
- 用户补充并确认：商品、服饰、场景等现有桌面工作台不能原样搬到 Web；Web 版本必须
  使用 shadcn/ui 重新完成响应式适配和视觉美化，保持真实 Remote Runtime/API 接线。
- 已确认：选择 A，为 Web 核心工作台建立独立 `web/` shadcn/ui 展示层，复用 OpenAPI
  DTO、Runtime Port、Mapper、表单 schema、view-model 和无 UI 业务逻辑；不复用
  `desktop/src/shared/ui`、Desktop 全局 CSS 或 Tauri adapter，Desktop 现有展示与视觉不变。
- 已确认：shadcn/ui 为源码组件集合，不作为单一运行时包；批准独立 Web lockfile 与已核验
  的 Tailwind v4、Radix primitives、CVA、图标和开发期 CLI 精确版本。生成组件源码后必须
  review 并 eject CLI 共享 CSS，Tailwind 不加载全局 Preflight，避免污染 Ant Design。
- 已确认：选择认证交互 A，使用 `/app/login`、`/app/register`、
  `/app/forgot-password`、`/app/reset-password` 独立认证路由。未登录访问受保护的
  `/app/*` 深链时转到登录页，登录成功并重新签发 Session 后使用 history replace 回跳；
  默认回 `/app`。
- 安全回跳：`returnTo` 只用于前端导航，不传给登录 API，也不触发服务端 `Location`；
  只接受解析后同源且以 `/app/` 开头的普通路径，拒绝协议、`//`、反斜杠、控制字符、
  编码绕过和 `/admin`。非法值回退 `/app`；401 不自动重放失败 POST。
- 已确认：选择响应式布局 A“工作室模式”。宽屏使用模块导航 + 360～420px 配置面板 +
  自适应结果画布，并保留全局工具栏；平板收起模块导航，配置面板改为可关闭抽屉；手机
  使用顶部工具栏 + 底部模块导航，输入配置和生成结果改为单列分步展示，不把桌面三栏
  强行压缩或依赖横向滚动。
- 业务连续性：商品、服饰、场景保留现有“配置—生成—查看结果”的操作心智，但 Web
  展示层可以重新设计信息层级、布局、响应式交互和视觉；历史、素材、积分作为全局入口，
  不与单个模块的临时配置状态混在同一导航层级。
- 已确认：视觉方向选择 A“编辑部式明亮影棚”。核心工作台以暖灰纸白为主画布、墨黑为
  主要文字、钴蓝为唯一主操作强调色，错误/警告/成功色只表达状态；禁止紫色渐变、重阴影、
  大量悬浮卡片和默认 shadcn 拼装感。
- 图像与信息层级：结果区采用摄影联系表语义，大图、细边线、稳定编号和充分留白优先；
  配置区保持专业信息密度，用分组、标题和边界组织，不把每个字段包成独立卡片。商品、
  服饰、场景共享视觉语言，只用内容和标题区分模块，不创建三套主题色。
- 动效与可访问性：抽屉、选中态和结果进入使用 160～220ms 克制过渡；生成中使用骨架屏
  和轻微呼吸，不使用视差或连续装饰动画。正文不小于 14px，中文行高至少 1.5，关键
  对比满足 WCAG AA，完整支持 `prefers-reduced-motion`。
- 已确认：素材交互选择 A“双入口、同一事实源”。商品、服饰、场景的每个素材槽同时
  提供“上传新素材”和“从素材库选择”；工作台上传完成后自动选入当前槽并进入全局素材库，
  素材库保留独立导航并支持跨任务复用。工作台移除只解除当前选择，不删除全局素材。
- 上传状态：批量上传只在前端建立队列，每个文件仍独立执行 `prepare → upload → complete`
  和独立 upload session；单文件显示排队、准备、上传进度、服务端校验、完成、失败/过期，
  只有 completed asset 才可选入任务。单项失败不影响其他文件，只重试失败项，成功项不得
  因“全部重试”重复上传。
- 终端适配：宽屏在素材槽内展开选择器并显示全局上传队列；平板使用抽屉；手机点击素材
  槽进入全屏选择页，提供“拍照/相册上传”和“素材库”标签，不依赖拖拽。前端始终只向
  业务请求传 `assetId`，不传 Base64、内部 object key 或本地绝对路径。
- 已确认：积分交互选择 A“行内透明提示”。配置区主操作旁固定展示可用积分与本次最高
  冻结积分，主按钮使用“开始生成 · 最高冻结 N 积分”；免费时显示“开始生成 · 免费”，
  单图重试显示对应槽的最高冻结积分，不在每次生成前增加确认 Modal。
- 报价状态：最高冻结值必须来自服务端 generation plan View，前端不得按模型或图片数量
  自行计算。计算中显示“正在计算积分…”并禁用按钮；任何影响计划槽/候选的配置变化都
  立即失效旧报价。余额不足时显示“积分不足 · 还差 N”，不创建 task/run，提供积分页入口；
  服务端仍在创建事务内做最终余额校验，失败 POST 不自动重放。
- 结算反馈：创建成功立即刷新余额并显示“已冻结 N 积分”，不把冻结误写为扣费；每张
  成功图片显示“已扣 N 积分”，失败图片显示“未扣费”。任务终态汇总实际扣除、已解冻和
  可用余额；点击单图扣费进入 `/app/credits` 并定位对应 output，不展示 Provider、内部模型
  配置或实际成本。
- 已确认：管理权限选择 A，第一期只有固定 `platform_admin` 权限集。允许创建多个实名独立
  管理员账号，但所有启用账号权限相同；`admin_users` 不增加 role / permission 字段，不建立
  RBAC 表、角色分配 API 或权限配置页面，也不使用共享管理员账号。
- 管理鉴权：`/admin` 使用独立管理 Session 和 Cookie；每个请求校验管理员状态与
  `session_version`，停用或版本变化立即失效。普通用户 Session 不能访问管理 API，管理
  Session 也不作为普通用户身份访问 `/api/v1/*`。
- 风险控制：所有管理写操作写脱敏审计。积分充值、模型图片单价更新、模型删除、停用用户、
  Provider / S3 / SMTP 密钥变更和不确定 invocation 核销要求近期重新认证、明确原因和二次
  确认；任务取消只要求二次确认与审计。2026-07-15 用户进一步确认本期不引入 MFA，不创建
  相关配置、API、数据库字段、前端交互或兼容壳，也不把 MFA 作为公网或发布门禁。
- 已确认：管理端信息架构选择 A“数据运营后台”。桌面端使用可折叠左侧导航，固定包含
  概览、用户、任务、模型、积分、系统配置和审计；顶部只保留页面标题 / 面包屑、全局状态
  和管理员账户入口，不堆叠重复业务导航。
- 页面交互：数据列表统一使用筛选栏、Ant Design Table 和服务端分页；查看详情及简单编辑
  使用右侧 Drawer，模型、存储、邮件和 Provider 等复杂配置使用独立页面，危险操作使用
  Modal。第一期不建设以指标卡和趋势图为主的仪表盘，也不为展示性图表增加聚合接口。

### DS0-10 方案缺口范围

- 批准人：lifei6671。
- 批准日期：2026-07-15。
- 批准结果：用户选择 A，整体批准以下一期纳入/不纳入矩阵。
- 一期纳入：用户自己的素材与生成结果鉴权下载，以及商品、服饰、场景现有单图、
  全部图片和长图下载行为的 Web 对齐（G3-T03、G3-T04、G5-T05）；素材/任务软删除、引用
  保护、Purge 与批量 GC（G05-T05、G1-T01、G3-T05）；固定 `platform_admin` 权限、独立
  管理 Session 和审计（G2-T09、G6-T01、G6-T02、G6-T07）；用户存储用量统计与全局磁盘 warning / critical
  水位（G3-T03、G3-T04）。现有下载对齐不扩展为服务端 ZIP 归档或全量数据导出。
- 一期不纳入：服务端批量 ZIP 归档、完整个人数据导出、细粒度 RBAC、自助永久注销、
  法定删除 / 邮箱匿名化，以及按用户硬存储配额。上述能力当前没有稳定实施任务，且技术
  方案已明确永久注销和法定删除需要独立数据治理方案；分别由清单 `WEB-FUP-01` 至
  `WEB-FUP-05` 跟踪，不阻塞一期开发。
- 已确认保留期选择 A：active 素材和任务历史不自动过期，保留到用户主动删除；删除后
  立即从用户界面隐藏并设置 7 天 GC 宽限期，宽限期只用于引用安全与物理清理，不承诺一期
  提供回收站恢复。未完成上传、临时文件和孤儿对象保留 24 小时；task events 与模型调用
  诊断摘要保留 90 天；积分流水、管理审计及任务 / run 核心审计记录第一期不自动删除。

## Research Findings

### DS0-02 依赖核验

- Go 工具链：官方已发布 `go1.26.5`，继续使用 `go 1.26.0` 与
  `toolchain go1.26.5`。
- Go 核心候选已锁定推荐版本：Gin `v1.12.0`、GORM `v1.31.2`、
  GORM MySQL Driver `v1.6.0`、optimisticlock `v1.1.3`、Goose `v3.27.2`、
  Viper `v1.21.0`、validator `v10.30.3`、UUID `v1.6.0`、testify
  `v1.11.1`、uber-go/mock `v0.6.0`。
- Web 与 Provider 候选已锁定推荐版本：Ant Design `6.5.1`、React/React DOM
  `18.3.1`、oapi-codegen `v2.7.2`、openapi-typescript `7.13.0`、
  OpenAI Go SDK `v3.42.0`、Volcengine Go SDK `v1.2.42`；Web 继续使用独立
  npm + `package-lock.json`，不迁移 pnpm/yarn 或 root workspace。
- shadcn/ui 补充候选：官方 Vite 指南使用 Tailwind CSS v4 与 `@tailwindcss/vite`；截至
  2026-07-15 核验的推荐精确版本为 `tailwindcss@4.3.2`、
  `@tailwindcss/vite@4.3.2`、`radix-ui@1.6.2`、`tw-animate-css@1.4.0`、
  `class-variance-authority@0.7.1`、`clsx@2.1.1`、`tailwind-merge@3.6.0`、
  `lucide-react@1.24.0`、`@types/node@26.1.1` 和开发期 `shadcn@4.13.0`；初始化并审查源码后使用 `eject`
  内联共享 Tailwind 工具并移除 CLI 运行时依赖。仅按实际组件增加源码和依赖，不安装
  全量 blocks。参考 [shadcn Vite 指南](https://ui.shadcn.com/docs/installation/vite)、
  [CLI eject](https://ui.shadcn.com/docs/cli)。
- 基础设施候选版本已核验：sessions `v1.1.0`、go-mail `v0.8.1`、
  argon2id `v1.0.0`、x/crypto `v0.54.0`、Go CDK `v0.46.0`、AWS S3
  `v1.105.1`、mimetype `v1.4.13`、limiter `v3.11.2`、ants `v2.12.1`、
  x/sync `v0.22.0`、gobreaker `v2.4.0`、client_golang `v1.23.2`、
  OpenTelemetry `v1.44.0`、otelgin `v0.69.0`、testcontainers-go `v0.43.0`。
- `golangci-lint v2.12.2` 仅作为独立 CI 工具使用，不进入 `go.mod`、不链接、
  不随产品分发；其 GPL-3.0 使用边界已由用户批准。
- oapi-codegen 只允许读取仓库内受评审的 OpenAPI，不在构建时下载远程 schema；
  所有生成 diff 必须审查。
- 以上为直接依赖核验；生成锁文件后仍须运行 `govulncheck ./...`、`npm audit`、
  SBOM 和传递依赖许可证扫描，才能完成 DS0-02 的最终 CVE 门禁。

### CSRF 组件阻塞

- 原方案的 `github.com/gorilla/csrf v1.7.3` 受 `GO-2025-3884` 影响且没有
  已知修复版本；`v1.7.2` 及更早版本又受 `GO-2025-3607` 影响，因此不能批准。
- Go 官方漏洞报告推荐迁移到 Go 1.25+ 标准库
  `net/http.CrossOriginProtection`。目标工具链为 Go 1.26.5，可直接采用且不新增依赖。
- 标准库方案通过 `Sec-Fetch-Site` 与 `Origin` 执行同源保护，不依赖 CSRF Token。
  已按用户批准同步移除匿名 Token、登录后刷新 Token 和对应 OpenAPI schema，
  不保留无安全作用的伪合同。

## Acceptance Criteria

- [x] AC1：DS0-01～DS0-10 每项都有明确结论、批准人、日期和可追溯证据。
- [x] AC2：DS0-02 原依赖已批准；2026-07-15 用户补充批准独立 Web 包与 shadcn/ui 精确
  依赖集合；logit 所有者授权例外、lockfile 后 `npm audit` / SBOM / 许可证扫描边界不变。
- [x] AC3：DS0-03 原合同、逐图计费修订和生成前报价补充合同均已批准；采用独立
  `POST /api/v1/generation-plans/quote` 与 `GenerationPort` 报价方法，不保留 create
  `previewOnly` 模式；既有 `model_configs.points_per_image`、MySQL baseline schema、
  OpenAPI DTO 和槽级消费唯一键批准保持有效。
- [x] AC4：DS0-04～DS0-07 已明确部署矩阵、凭据存储、Argon2id 基准环境和 MySQL
  最低兼容与部署版本验收；DS0-08 已冻结 `points_per_image`、按成功图片逐张扣费、按结果
  槽预留、实际产出模型单价、`result_uncertain` 未交付槽立即解冻、用户重试和晚到隔离。
- [x] AC5：DS0-09 已记录组件边界、认证、响应式/视觉、上传双入口、积分行内提示/逐图
  反馈、单一 `platform_admin` 权限模型，以及数据运营后台的信息架构与页面交互。
- [x] AC6：DS0-10 已形成一期纳入/不纳入矩阵；未纳入项由清单 `WEB-FUP-01` 至
  `WEB-FUP-05` 明确跟踪。
- [x] AC7：清单 DS0 状态、负责人和证据与最终决策同步，`git diff --check` 通过。
- [x] AC8：所有依赖 DS0 的代码实施在决策关闭和用户批准规划产物前均未启动。

## Out of Scope

- 本子任务不创建 `server/go.mod`、前端 lockfile、数据库 migration、OpenAPI 生成物或
  运行时代码。
- 本子任务不修改既有 Desktop Local-first 实现及其 M0～M7 状态。
- 本子任务不替代后续 G0～G7 各实施子任务的设计、TDD、质量检查和验收。
