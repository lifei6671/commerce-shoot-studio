# G0-T05 实施计划：Gin 路由与 HTTP 边界

## 执行原则

- 用户 review 并批准本计划后才开始写生产代码。
- 全程 RED → 最小 GREEN → 自 review → 定向验证；测试命令统一 `-timeout=60s`。
- `go.mod/go.sum` 只有一个 dependency owner，禁止并行执行 `go get/tidy`。
- Router middleware 顺序高度耦合，`internal/httpapi` 由一个 owner 串行实现；配置、错误目录、
  httpserver 可在依赖边界清晰后并行。
- 不自动 stage/commit；所有改动保留在工作树供用户 review。

## Phase 0：依赖合同 RED → GREEN

### RED

1. 新增 `internal/buildcontract/http_contract_test.go` 的最小依赖测试：
   - 缺少直接 `github.com/gin-gonic/gin v1.12.0` 时失败；
   - 缺少直接 `golang.org/x/net v0.51.0` 时失败；
   - 两者存在 replace 或解析版本漂移时失败。
2. 运行：

```bash
cd server
go test -run 'TestHTTPDirectDependencyContract' -count=1 -timeout=60s ./internal/buildcontract
```

确认失败原因仅为目标依赖尚未加入。

### GREEN

单一 dependency owner 执行：

```bash
cd server
go get github.com/gin-gonic/gin@v1.12.0 golang.org/x/net@v0.51.0
go mod tidy
go mod verify
```

复跑依赖测试。记录 `go.mod/go.sum` diff，不手工编辑校验文件。

### Exit gate

- 精确直接版本和无 replace 测试通过。
- `go mod verify` 通过。
- 只有 dependency owner 改动 `go.mod/go.sum`。

## Phase 1：基础合同并行 TDD

Phase 0 后并行三个无写冲突 owner。

### 1A 配置 owner

文件：

- `internal/config/config.go`
- `internal/config/loader_test.go`
- 必要时 `internal/config/loader.go`
- `conf/app.yaml.example`

RED 测试：

- 完整合法 fixture 精确得到 5s/30s/5m/60s、32768、1048576 和两组 origins。
- 缺 `http`、缺字段、零/负 timeout/header/body、弱类型、未知字段均启动失败。
- Origin 接受规范 http/https、localhost/IP/非默认端口；拒绝 wildcard、null、userinfo、path、
  query、fragment、相对 URL、非 HTTP scheme、空格、尾点、非 ASCII、重复和非规范默认端口。
- user/admin 列表独立复制、不串用；错误不得回显恶意 Origin marker。
- example 包含完整中文注释和精确推荐值，仍不包含真实凭据，且不能作为默认配置加载。

GREEN：增加 typed HTTP/CORS config、严格解析/规范化/复制，不启用 Viper default/env/merge。

### 1B 错误与日志 owner

文件：

- `lib/apperror/catalog.go`
- `lib/apperror/catalog_test.go`
- `lib/logger/context.go`
- `lib/logger/context_test.go`

RED 测试：

- `100403/403/请求被拒绝`、`100404/404/请求路径不存在` 缺失时失败。
- code 唯一、号段、status 和安全消息精确。
- `logger.NewContext` 接受固定 `OTHER`，仍拒绝任意 raw method marker。

GREEN：只扩 catalog 和固定方法 allowlist，不改变既有 Error 实现和日志字段。

### 1C `http.Server` owner

文件：

- `internal/httpserver/server.go`
- `internal/httpserver/server_test.go`

RED 测试：

- 空/非法 address、nil handler/logger、任一非正 timeout/header limit 快速失败。
- 合法构造精确复制 handler、四类 timeout、32768 header limit。
- `DisableGeneralOptionsHandler=true`。
- 标准库 ErrorLog writer 收到包含 secret/path 的文本时，最终 slog 只出现固定消息。
- 源码不包含 Listen/Serve/Shutdown/goroutine/signal。

GREEN：只构造 `*http.Server`，设置安全 ErrorLog adapter，不产生外部副作用。

### Phase 1 验证

```bash
cd server
go test -count=1 -timeout=60s ./internal/config ./lib/apperror ./lib/logger ./internal/httpserver
```

## Phase 2：统一响应 RED → GREEN

文件：

- `lib/response/error.go`
- `lib/response/error_test.go`

RED 矩阵：

- raw/wrapped apperror 精确 status/code/message/requestId。
- raw/wrapped `*http.MaxBytesError` → 413/100413。
- 未知 error → 500/100500。
- request ID 为空与固定值两种响应精确三字段；Content-Type 为 JSON。
- HEAD 只写 status、context error code，不写 body。
- SQL/path/prompt/header/body/panic/secret marker 不出现在最终 writer。
- 只使用 generated `ErrorResponse`；测试守卫拒绝 `gin.H` 和第二 DTO。

GREEN：实现 `WriteError`/`ErrorCode`，不调用原始 error 的 `Error()`，不记录 raw error。

验证：

```bash
cd server
go test -count=1 -timeout=60s ./lib/response
```

## Phase 3：Router 单 owner 分步 TDD

文件：

- `internal/httpapi/router.go`
- `internal/httpapi/cors.go`
- `internal/httpapi/body.go`
- `internal/httpapi/middleware.go`
- 对应 `_test.go`

每个子步骤必须先有单独 RED，再加最小实现。

### 3.1 Router 与 NoRoute

- `gin.New()`，两个 API Group，无业务 route。
- GET/POST 未匹配分别返回 404/100404。
- `/api/v11` 不被误判为用户 API；日志 route template 只用固定 fallback。

### 3.2 CORS

测试矩阵：

- 合法预检：204 空 body，Allow、ACAO、credentials、ACAM、允许 headers、Max-Age=600、三项 Vary。
- 缺省 `Access-Control-Request-Headers` 合法；存在时逗号/OWS/大小写处理正确。
- Authorization、未知 header、非 GET/POST requested method、unlisted/null/malformed Origin →
  403/100403 且无 `Access-Control-Allow-*`。
- user Origin 不授权 admin，admin Origin 不授权 user。
- 同源、白名单同站跨 Origin、跨站拒绝；覆盖 `example.co.uk`、localhost/IP、不同端口、不同 scheme。
- 普通允许 Origin 的 2xx/4xx/5xx 都含 ACAO/credentials/Expose X-Request-ID。
- `Vary` 追加去重且保留预置 `Cookie`。
- 不读取 `X-Forwarded-*`；trusted external Origin 注入留 G0-T06。

### 3.3 Method guard

- PUT/PATCH/DELETE/CONNECT/TRACE 与 raw nonstandard method → 405/100405 JSON。
- nonstandard method 完成日志固定 `OTHER`，raw marker 不出现。
- 普通 OPTIONS → 405/100405；合法预检已在 CORS 层 204 终止。
- `OPTIONS *` 不被标准库默认处理绕过。
- HEAD 使用 `httptest.Server` + 带 2 秒 timeout 的真实 client 验证线路 status=405、body 为空、
  Allow/CORS 正确；日志 error code=100405。

### 3.4 Body limit 与 BindJSON

- 已知 Content-Length：limit 成功，limit+1 在 handler 副作用前 413。
- chunked/未知长度：middleware 不预读；`BindJSON` 完整读取并在业务 counter 前返回 413。
- malformed JSON → 400/100400；合法 JSON 后才执行业务 counter。
- 第二个 JSON 值和让请求超过上限的尾随字节必须在业务 counter 前分别返回 400/413。
- 默认 1 MiB 与 method+template override 并发互不串用。
- override 只允许 GET/POST、两个 API 前缀、真实 template、正数 bytes；非法/重复快速失败。
- 构造后修改原 slice/map 不影响运行策略。

### 3.5 Recovery 与完成日志

- 未提交响应 panic（string/error/marker）→ 500/100500，无 panic/stack/marker。
- 已提交响应 panic 不二次写 JSON、不缓存响应，仍标记 100500。
- 200/204/400/403/404/405/413/500、九种标准方法和 OTHER 均恰好一条完成日志。
- request ID 注入/空值、route fallback、status/error/elapsed/level 精确。
- 并发 request ID/route 不交叉；测试 writer 加锁并通过 Race。

### Phase 3 验证

```bash
cd server
go test -count=1 -timeout=60s ./internal/httpapi
go test -shuffle=on -count=20 -timeout=60s ./internal/httpapi
go test -race -shuffle=on -count=1 -timeout=60s ./internal/httpapi
```

## Phase 4：Build contract RED → GREEN

扩展 `internal/buildcontract/http_contract_test.go`，每个规则先加入可失败 bad fixture：

- Gin/x/net 精确直接版本与无 replace。
- Gin import 仅 `internal/httpapi`、`lib/response`。
- 禁止默认 Gin Logger/Recovery、`gin.H`、`engine.Run`、`http.TimeoutHandler`。
- `gin.New()` 只有一个生产 owner。
- 不存在生产占位 GET/POST/Any/Handle/Match 注册。
- 不存在第二 ErrorResponse 或 HTTP 原始 `.Error()` 输出。
- G0-T05 不出现 Listen/Serve/Shutdown/signal/goroutine。
- OpenAPI/generated hash 继续由既有合同测试保护，不修改生成物。

验证：

```bash
cd server
go test -count=1 -timeout=60s ./internal/buildcontract
```

## Phase 5：长期文档同步

单一 docs owner 使用 `docs-sync`：

- 技术方案同步：受控 CORS、同站双白名单、OPTIONS 204/403/405、100403/100404、HTTP 配置值、
  G0-T06 复用来源白名单。
- checklist 同步 G0-T05/G0-T06 交付物；完成前不勾选 G0-T05。
- 新增 `.trellis/spec/backend/http-guidelines.md`，更新 backend index。
- 更新 error/openapi/logging/directory specs 的真实合同和所有权。
- 不修改 OpenAPI schema/generated DTO、README、Desktop 文档或 UI。

## Phase 6：自 review 与质量门禁

### 自 review 清单

- DDD/依赖方向：Gin 未进入 Service/Repository/apperror/config。
- 安全：无 raw path/query/body/header/panic/error/config/secret 日志或响应。
- CORS：用户/管理不串用、只同站、无 wildcard、Vary 不覆盖 Cookie。
- HTTP：HEAD 真实线路、OPTIONS star、已提交 panic、chunked 绑定语义正确。
- 并发：options 防御性复制、无全局 Gin/Viper 状态、Race 无交叉。
- 范围：无业务 route、listener、CSRF/request ID 生成、lifecycle、health、metrics/tracing。

### 最终命令

```bash
cd server
gofmt -l $(rg --files -g '*.go')
go mod tidy -diff
go mod verify
go vet ./...
go test -count=1 -timeout=60s ./internal/config ./lib/apperror ./lib/logger ./lib/response ./internal/httpapi ./internal/httpserver ./internal/buildcontract
go test -shuffle=on -count=20 -timeout=60s ./lib/response ./internal/httpapi ./internal/httpserver
go test -race -shuffle=on -count=1 -timeout=60s ./internal/config ./lib/apperror ./lib/logger ./lib/response ./internal/httpapi ./internal/httpserver ./internal/buildcontract
go test -count=1 -timeout=60s ./...
go test -race -shuffle=on -count=1 -timeout=60s ./...
go build ./cmd/server
go run ./cmd/server
```

根目录：

```bash
git diff --check
```

若 `govulncheck`、SBOM、license 或锁定 lint 工具不可用，只记录缺失与风险，不伪装通过；工具链固化
仍由 G0-T12 收口。

## 完成条件

- PRD AC1～AC8 全部有自动化证据。
- `trellis-check` 与 `docs-sync` 复核通过。
- G0-T05 实现和文档改动全部留在未提交工作树，等待用户 review。
- 未经用户明确指令，不 stage、不 commit、不勾选为已提交证据。
