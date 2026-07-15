# 建立 Web SaaS 配置加载与边界校验

## Goal

为 Web SaaS Go Runtime 建立可测试、可快速失败且不会泄漏凭据的配置边界：从默认或显式
`app.yaml` 加载一套完整独立的部署配置，严格校验 MySQL、Session、条件启用的 Redis 与
验证码启动密钥；同时建立 `system_configs` 的 typed JSON 解码边界，但不提前实现数据库
Repository。

## Background

- G0-T01 已完成并归档，本任务是 G0-T07 应用装配和 G0-T08 migration CLI 的共同前置。
- Viper `v1.21.0` 已在 DS0-02 获批。本任务只使用 Viper 及其同版本解码栈
  `mapstructure/v2`、`go.yaml.in/yaml/v3`，不提前引入 validator、数据库驱动、Redis Client
  或第三方测试框架。YAML 模块用于补足 Viper 会归一化 map key 的已验证边界，不增加第二套
  配置来源或合并语义。
- MySQL、Session、选中 Redis Store 时的 Redis、验证码派生/校验密钥是启动级配置；S3、
  SMTP、OpenAI、火山引擎等非启动配置属于 `system_configs`。
- `system_configs` 的表结构、固定业务 key 和各业务 JSON schema 由 G1-T01/G1-T04 冻结；
  文档中的 `email_stmp` 只是示例，本任务不固化生产 key。

## Requirements

### 配置入口与工作目录

- 未传配置路径时固定加载进程工作目录下的 `conf/app.yaml`；显式传入时只加载指定文件。
  不扫描 HOME、环境变量或任意父目录，显式路径失败时不回退默认文件。
- 以加载的 `app.yaml` 文件为起点，它的上一级目录（即文件所在目录）是配置工作目录。后续
  相对路径统一以该目录为基准，不依赖进程启动位置。
- 每个 `app.yaml` 都内联 MySQL、Session、Security 和条件启用的 Redis 配置，代表一套完整、
  独立的部署配置；不引用领域 YAML，不继承模板，也不与另一配置文件合并。
- 仓库只提交字段完整、逐项带简体中文说明的 `server/conf/app.yaml.example`。用户复制或改名为
  `app.yaml` 后填写真实值；加载器永不自动加载 `.example`，`server/conf/app.yaml` 必须被 Git
  精确忽略。
- 未知字段、错误类型、非法枚举、YAML 语法错误、追加的第二个 YAML 文档和重复语义均快速失败。第一期不使用环境
  变量注入、Secret Manager、配置热更新或目录监听。

### MySQL

- 使用结构化 host、port、database、username、password、TLS、连接/读写 timeout 和连接池
  字段；主机、端口、库名、用户名和密码是启动必填。
- 提供 `dsn_params: map[string]string` 保存后续数据库驱动的自定义 DSN 查询参数。本任务只做
  typed 读取和安全校验，不自行拼接 DSN，也不提前引入 MySQL 驱动。
- 自定义参数不能表达或覆盖用户名、密码、网络、地址或库名，并明确禁止 `tls`、`timeout`、
  `readTimeout`、`writeTimeout`、`parseTime`、`loc`（键名大小写不敏感）；后续驱动装配强制
  `parseTime=true`、`loc=UTC`，其余保留项来自结构化字段。错误不得回显字段值或完整映射。

### Session 与 Redis

- Session Store 仅允许 `cookie` 或 `redis`。用户端和管理端分别配置独立 Cookie 名、认证
  密钥、加密密钥、idle TTL 与 absolute TTL；管理 TTL 必须短于用户 TTL。
- 第一版不实现 Session key ring 或密钥版本轮换。更换任一侧密钥后，该侧既有 Session 全部
  失效并要求重新登录。
- 只有选择 Redis Store 时才加载并要求单节点 Redis 地址、DB、连接池、TLS、key prefix 及
  连接/读写 timeout；`password` 为可选字段，以支持受控内网中的无密码 Redis。地址或其他
  必填字段缺失、无效时启动校验失败，禁止静默回退 Cookie。
- 不支持 Sentinel、Cluster 或自动探测；Cookie 模式不要求 Redis 配置。

### 已确认开发调试目标

- MySQL：`192.168.1.6:13306`，用户 `root`，数据库 `commerce_shoot_studio`；密码只进入本地
  部署配置，不写入仓库、任务文档、日志或测试 fixture。
- Redis：`192.168.1.6:6379`，受控内网单节点，无密码。
- 用户给出的调试 DSN 中 `loc=Local` 不进入配置合同；后续数据库装配仍固定
  `parseTime=true`、`loc=UTC`，保持数据库时间语义一致。

### 验证码与密钥

- 第一版分别配置一把 derivation key 和 verification key，不建立版本列表。两把密钥必须
  彼此独立且不得与用户/管理 Session 密钥复用。
- 更换任一验证码密钥后，所有未过期 challenge 失效并要求用户重新发送验证码。
- 所有启动密钥均使用标准 Base64 编码：Session 认证密钥解码后必须为 64 字节，Session
  AES-256 加密密钥为 32 字节，验证码 derivation/verification 密钥各为 32 字节。
- 仓库模板的所有 secret 保持空值，不包含可用于部署的示例密钥；模板可被严格解析，但必须
  因缺少部署 secret 而安全校验失败。

### Runtime typed JSON 边界

- 本轮只定义读取原始 JSON 的 `RuntimeDocumentSource` Port 与严格 decoder；不接 MySQL。
- decoder 只接受单个 JSON object，拒绝未知字段、字段类型错误和尾随内容，并在解码后调用
  具体类型的 `Validate()`。
- 错误不得包含原始 JSON、完整配置、密码、密钥或 marker 值。

### 范围限制

- 只创建真实使用的 `server/conf/app.yaml.example` 和 `server/internal/config` 实现/测试，
  并精确忽略本地运行文件 `server/conf/app.yaml`，不补领域配置文件或空目录树。
- 不修改 `cmd/server/main.go`，不连接 MySQL/Redis，不启动 HTTP、Worker 或 goroutine；真实
  装配、连接探测和 readiness 属于 G0-T07/G0-T08。

## Acceptance Criteria

- [x] YAML node 先拒绝大小写/空格语义重复键，Viper 再使用独立实例严格加载单个
  `app.yaml`；代码中不存在领域文件引用、`AutomaticEnv`、环境变量绑定、配置叠加或热更新。
- [x] 默认/显式入口、完整独立配置和配置工作目录语义由跨平台测试证明。
- [x] 缺文件、未知字段、错误类型、非法枚举和缺必填凭据均返回稳定、无敏感值错误；显式路径
  失败不回退默认文件。
- [x] MySQL `dsn_params` 正常保留自定义参数并拒绝结构化字段冲突，不生成或记录完整 DSN。
- [x] Cookie 模式不要求 Redis；Redis 模式允许无密码单节点，但缺少其他必要配置时失败且
  不会回退 Cookie。
- [x] Base64 密钥格式、精确字节长度、用户/管理/验证码密钥隔离均有测试。
- [x] `app.yaml.example` 完整列出当前字段和简体中文说明、无真实凭据；本地 `app.yaml` 被
  Git 精确忽略，并有 marker 泄漏回归测试覆盖错误文本。
- [x] runtime typed JSON 边界可用 fake source 测试严格解码，不依赖数据库 schema。
- [x] `gofmt -l` 无输出，`go mod verify`、`go vet ./...`、`go test ./...`、
  `go test -race ./...` 与根目录 `git diff --check` 全部通过。

## Out of Scope

- MySQL migration、GORM Entity、Repository、真实连接探测、DSN 构造和 readiness。
- SMTP、S3、Provider 的固定 key、完整 JSON schema、管理 DTO、CAS、缓存与热更新。
- Gin/HTTP、日志、Metrics、Tracing、Worker 与应用生命周期装配。
- Session 或验证码密钥的无损轮换与历史密钥兼容。
