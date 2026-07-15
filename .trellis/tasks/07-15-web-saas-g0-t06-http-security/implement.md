# G0-T06 实施计划：trusted proxy、Request ID 与 CSRF 基线

## 执行原则

- 用户 review 并批准本计划后才写生产代码。
- 不新增/升级依赖，不修改 OpenAPI generated DTO，不读取或改写真实 `conf/app.yaml`。
- 全程 TDD：每个切片先保留目标缺失的 RED，再做最小 GREEN、自 review 和定向验证。
- 测试命令统一显式 `-timeout=60s`；并发与共享策略必须通过 shuffle/race。
- 不 stage、不 commit；所有改动保留在工作树供用户 review。
- G0-T05 已由用户 review 后提交；本任务不回退该提交，也不混入无关 Desktop 改动。

## Phase 0：计划与规则门禁

1. 读取本任务 PRD/design/implement 与 Trellis Phase Index。
2. 执行 `trellis-before-dev`：重新读取 backend index、HTTP/config/logging/error/openapi/directory specs 及
   shared guides。
3. 用 CodeGraph 复核 `config.SecurityConfig`、`httpapi.Options`、middleware order、CORS external Origin、
   response/logger 调用路径与测试 blast radius。
4. 运行修改前基线：

```bash
cd server
go test -count=1 -timeout=60s ./internal/config ./internal/httpapi ./internal/buildcontract
```

Exit gate：计划已获用户批准，基线绿色，未发现新的依赖/配置/公共合同分歧。

## Phase 1：配置合同 RED → GREEN

单一 config owner 修改：

- `internal/config/config.go`
- `internal/config/loader_test.go`
- 必要时 `internal/config/loader.go`
- `conf/app.yaml.example`

### RED

- 完整 fixture 缺 `security.trusted_proxy_cidrs` 时严格失败；显式 `[]` 成功。
- 多个规范 IPv4/IPv6 CIDR 成功并保序。
- 非法 CIDR、host bits、重复、IPv4/IPv6 全网、IPv4-mapped IPv6 prefix、空白、弱类型与未知字段
  失败。
- 错误不回显恶意 marker/CIDR 原值。
- 构造结果 defensive copy；模板字段完整、注释清楚且不含凭据。

### GREEN

- `SecurityConfig.TrustedProxyCIDRs []netip.Prefix`。
- 文档层 `*[]string` 区分缺失与空列表。
- 用 `netip.ParsePrefix`、`Is4In6`、`Masked`、bits 与 canonical string 做最小严格校验。
- 不引入 Viper default/env/merge，不触碰真实配置。

### 验证

```bash
cd server
go test -run 'TestLoadTrustedProxy|TestRepositoryExample' -count=1 -timeout=60s ./internal/config
go test -race -count=1 -timeout=60s ./internal/config
```

## Phase 2：Request ID RED → GREEN

单一 request lifecycle owner 修改：

- `internal/httpapi/router.go`
- `internal/httpapi/middleware.go`
- 新增 `internal/httpapi/request_id.go`
- `lib/response/error.go`
- 对应测试

### RED

- Router 构造只读取一次 32 字节进程密钥；固定 key + sequence 的 HMAC known-vector 得到精确
  32 位 lowercase hex，连续样本不为空、不重复。
- 合法/非法/重复入站 `X-Request-ID` 全部被忽略且 marker 不进入响应/日志。
- 200、403、404、405、413、500、HEAD、OPTIONS 的 Header、错误体和日志 ID 一致。
- 并发请求用可区分 route 和 barrier 制造重叠，逐请求关联 Header、错误体与对应 route 完成日志；
  测试样本无重复且不串用，合同表述为 128-bit 碰撞安全性，不宣称数学硬唯一。handler 替换 Request
  context 也不能改变完成日志 ID。
- 包内 entropy reader short read/error 时 Router 构造失败，不产生可服务的 Engine，不进入请求路径。
- 固定 ASCII known-vector key 的原文、hex、Base64 不进入成功/统一错误/panic 的 Header、body 或最终
  日志；entropy error marker 不进入构造错误文本或任何 writer。
- `response.RequestID` 多次读取只返回生命周期已绑定值，不生成新 ID。
- 统一错误 writer 不再接受 caller 自由传入 request ID；绑定成功后所有错误体只能读取可信上下文。

### GREEN

- 生产 `New` 用 `io.ReadFull(crypto/rand.Reader, key[:])` 在构造期读取一次 32 字节密钥；仅
  package-private `newWithEntropy` 接受测试 reader，short read/error 直接让构造失败。
- generator 用 `atomic.Uint64` sequence 的大端字节作为 HMAC-SHA256 输入，截取 16 字节后
  `hex.EncodeToString`；只长期持有不可变 key/atomic counter，每个请求新建 HMAC 实例，不共享
  `hash.Hash`。请求路径不访问熵源，不调用 `crypto/rand.Read`，不读取入站 Request ID Header。
- lifecycle 先设置 API Header baseline，再取得 ID、调用唯一 `response.BindRequestID`、写响应 Header
  和 fresh logger context；完成日志始终使用 middleware 局部稳定 logContext。
- `response.WriteError` 从私有 Gin context key 读取 ID，移除自由字符串参数并迁移全部调用点。
- 进程密钥只留内存，不进入配置、日志、响应或持久化；Go runtime 不可恢复熵源故障只记录已确认的
  启动边界，不伪装成可测试的 HTTP 500。
- 删除旧 string-only RequestID 注入，不保留兼容 wrapper。

### 验证

```bash
cd server
go test -run 'TestRequestID|TestCompletion|TestWriteError' -count=1 -timeout=60s ./lib/response ./internal/httpapi
go test -race -run 'TestRequestID|TestCompletion|TestWriteError' -count=1 -timeout=60s ./lib/response ./internal/httpapi
```

## Phase 3：trusted proxy resolver RED → GREEN

单一 proxy owner 修改：

- 新增 `internal/httpapi/proxy.go`
- 新增 `internal/httpapi/proxy_test.go`
- `internal/httpapi/router.go`
- `internal/httpapi/cors.go` 的 external Origin 读取路径

### RED

- 空 prefix 列表明确关闭 Gin trusted proxies；伪造 XFF/XFP/XFH/X-Real-IP/Forwarded 不生效。
- 非空列表传递规范 CIDR，同时禁用 `ForwardedByClientIP`、`RemoteIPHeaders`、`TrustedPlatform`、
  AppEngine shortcut；`Context.ClientIP()` 不成为业务事实源。
- direct IPv4/IPv6、IPv4-mapped IPv6 unmap、zoned IPv6 拒绝、TLS/Host 与非默认端口解析正确；IPv4
  prefix 能匹配 mapped RemoteAddr。
- trusted peer 的合法单值 tuple 解析 clientIP/external Origin；覆盖内部 Host 改写。
- 每个字段分别缺失、空值、重复行、逗号链、非法 IP/scheme/host/port/userinfo/path/control char →
  403/100403。
- mapped `/96`/`/120` 配置拒绝；大写 DNS、默认端口和非规范 IPv6 XFH 因不等于 canonical
  authority 而拒绝。
- 非可信来源完整伪造 tuple 被忽略；X-Real-IP/Forwarded 永不生效。
- 解析完成后从 request 删除所有 `X-Forwarded-*`、`Forwarded`、`X-Real-IP`，下游遍历/clone Header
  也看不到原始代理输入。
- trusted CIDR 内非业务路径忽略 tuple，给未来 health probe 保留直连路径。
- 恶意 RemoteAddr/Header/Host marker 不进入响应或最终日志 writer。

### GREEN

- 构造期复制 prefix，设置 Gin 防御性字段并调用 `SetTrustedProxies`。
- `proxyMiddleware` 对请求只解析一次，保存 typed request metadata。
- RemoteAddr/XFF 拒绝 zone 并 unmap；XFH 原值必须等于 XFP 下的 canonical authority。
- typed metadata 建立后删除所有 forwarded/X-Real-IP Header。
- CORS 删除旧 ExternalOrigin 注入，仅读取 metadata。
- 严格 parser 只在 transport boundary 校验，不为下游增加 fallback。

### 验证

```bash
cd server
go test -run 'TestTrustedProxy|TestDirectRequestMetadata|TestCORS.*Proxy' -count=1 -timeout=60s ./internal/httpapi
go test -shuffle=on -count=20 -timeout=60s ./internal/httpapi
go test -race -count=1 -timeout=60s ./internal/httpapi
```

## Phase 4：缓存 Header 与 CSRF RED → GREEN

单一 HTTP policy owner 修改：

- 新增 `internal/httpapi/security.go`
- 新增 `internal/httpapi/security_test.go`
- `internal/httpapi/router.go`
- 必要的 `cors.go` 小范围复用调整

### RED：缓存

- 两个 API surface 的 2xx/403/404/405/413/500 均为 `Cache-Control: no-store, private`。
- `Vary` 同时保留 Cookie、Origin 与 OPTIONS 两个预检维度，大小写不敏感去重。
- 非 API 路径不添加 Cache-Control/Cookie Vary。
- CORS 拒绝不清理 Cache-Control、Vary 或 X-Request-ID。

### RED：COP

- 两个独立 protection 实例只复用各自 corsPolicy canonical map。
- POST + `Sec-Fetch-Site: same-origin|none` 通过。
- same-site + 对应白名单精确 Origin 通过；跨端白名单串用和 cross-site 拒绝。
- 缺 Fetch Metadata 时：Origin 与可信 external Host 相同通过，不同拒绝；两者都缺少按标准库放行。
- trusted proxy 把 Request.Host 改成内部值时，外部同源 POST 仍通过。
- GET 通过 COP；HEAD/普通 OPTIONS 最终仍由 method guard 返回 405；合法预检仍为 204。
- 拒绝统一 403/100403，包含同一 Request ID 和安全缓存/Vary，不出现标准库 error/Origin/Header marker。

### GREEN

- API response Header baseline 在 request ID 绑定、proxy、CORS 前设置 Cache-Control 与全部 Vary
  维度。
- 从 corsPolicy map 构造 user/admin 两个 `CrossOriginProtection`。
- middleware 按精确 API surface 选择实例，使用 external authority 的 request 浅副本执行 `Check`。
- 忽略 `Check` 原始 error，调用统一 response writer；无 Handler wrapper、deny bridge 或 bypass。

### 验证

```bash
cd server
go test -run 'TestAPICache|TestCrossOriginProtection' -count=1 -timeout=60s ./internal/httpapi
go test -shuffle=on -count=20 -timeout=60s ./internal/httpapi
go test -race -shuffle=on -count=1 -timeout=60s ./internal/httpapi
```

## Phase 5：Build contract RED → GREEN

扩展 `internal/buildcontract/http_contract_test.go`；每条规则先用 bad fixture 证明会失败：

- resolver 删除全部 forwarded/X-Real-IP 输入；生产读取只允许 `httpapi/proxy.go`，AST 守卫是纵深防御。
- 禁止生产业务使用 `gin.Context.ClientIP()`、Gin forwarded shortcut、TrustedPlatform。
- 禁止 `CrossOriginProtection.Handler`、`AddInsecureBypassPattern` 和第二 trusted-origin 配置。
- 禁止 CSRF 专用 Token/Cookie/Header（如 `X-CSRF-Token`）及其配置/DTO/OpenAPI contract；守卫不得
  用通用 `Cookie` / `Header` 字面量扫描误伤 Session 或 `Vary: Cookie`。
- 禁止 Request ID 使用 `math/rand`、时间戳、纯计数器输出或入站 Header；计数器只能作为 HMAC 输入。
- 禁止生产调用 `crypto/rand.Read` 或暴露 entropy Options；测试 reader 只能进入 package-private
  构造路径。
- 进程 HMAC 密钥不得进入配置、响应、日志、Trace、Metrics 或持久化。
- 禁止 package-level 或跨请求共享可变 `hash.Hash`；每次请求创建独立 HMAC 实例。
- `response.BindRequestID` 只允许 lifecycle 调用，`WriteError` 不接受 request ID 字符串。
- `response.RequestID` 只读生命周期已绑定值；completion 使用局部稳定 logContext。
- middleware 顺序为 lifecycle（API Header baseline → request identity → completion）→ recovery → proxy →
  CORS → COP → method → body。
- 不放宽 G0-T05 已有依赖、错误 DTO、监听/生命周期和业务 route 守卫。

验证：

```bash
cd server
go test -count=1 -timeout=60s ./internal/buildcontract
```

## Phase 6：并行自 review

实现完成后分三个只读 reviewer，并由主代理汇总修复：

1. proxy reviewer：CIDR、RemoteAddr、XFF/XFP/XFH、IPv4/IPv6、Gin 绕过与敏感值。
2. CSRF/cache reviewer：标准库行为、middleware order、用户/管理隔离、Host 浅副本、Vary。
3. request/log reviewer：熵源失败、ID 一致性、并发隔离、错误体与日志安全。

任何 reviewer 发现关键问题，修复后重跑对应定向和 Race；非关键 reviewer 失败最多重试两次，再由
主代理串行复核。

## Phase 7：长期文档同步

使用 `docs-sync` 和 `trellis-update-spec`：

- 技术方案补精确 proxy tuple、Request ID、cache/COP 与 Gin 设置。
- checklist 只在实现和完整验证通过后勾选 G0-T06 并追加证据。
- 更新 `http-guidelines.md`、backend index/directory/config/logging/openapi 所有权与测试矩阵。
- 更新本任务 PRD/design/implement 的实际偏差和证据。
- 不修改 README、Makefile、OpenAPI paths/generated DTO、Desktop/Web UI。

## Phase 8：质量门禁

### 自 review

- 安全：Header/CIDR/RemoteAddr/Origin/entropy error/raw error 不进响应或日志。
- 信任链：只有 proxy resolver 读取 forwarded Header；CORS/COP 使用同一个 typed metadata。
- 隔离：用户/管理 trusted Origin 不串用，cache/Vary 不覆盖，Request ID 并发不串用。
- 分层：config 不依赖 Gin；httpapi 不引入业务 Service/Repository；无过早公共 accessor。
- 范围：无 Session、CSRF Token、health、listener、lifecycle、Tracing、Metrics、依赖或 schema 变更。

### 最终命令

```bash
cd server
unformatted=$(rg --files -g '*.go' -0 | xargs -0 gofmt -l); test -z "$unformatted"
go mod tidy -diff
go mod verify
go vet ./...
go test -count=1 -timeout=60s ./internal/config ./internal/httpapi ./internal/buildcontract
go test -shuffle=on -count=20 -timeout=60s ./internal/config ./internal/httpapi ./internal/buildcontract
go test -race -shuffle=on -count=1 -timeout=60s ./internal/config ./internal/httpapi ./internal/buildcontract
go test -count=1 -timeout=60s ./...
go test -race -shuffle=on -count=1 -timeout=60s ./...
go build ./cmd/server
go run ./cmd/server
```

根目录：

```bash
git diff --check
```

补充执行 secret pattern scan 和 `git diff` 自 review。本机未安装的锁定 lint v2.12.2、govulncheck 等正式
工具只记录，不临时引入；仍由 G0-T12 固化。

## 实际实施证据（2026-07-15）

- Phase 1～5 均按 RED → GREEN 完成；未新增依赖、数据库 schema、OpenAPI operation 或真实
  `conf/app.yaml` 改动。
- 三路只读复审分别覆盖 proxy、Request ID/log、CSRF/cache；发现的测试与 AST 守卫缺口全部修复，
  最终均为 `no findings`。
- 已通过上述 NUL-safe `gofmt`、依赖一致性、vet、全包测试、全包 Race、build、run 与
  `git diff --check`。
- 工作树保持未暂存、未提交，等待用户 review。

## 完成条件

- PRD 所有 Acceptance Criteria 均有自动化证据。
- `trellis-check`、`docs-sync`、`trellis-update-spec` 与三路只读 review 收口。
- G0-T06 checklist 与 Trellis 证据真实同步。
- 不 stage、不 commit；等用户 review 后再执行任何 Git 提交操作。
