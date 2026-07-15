# G0-T09 实施计划

## TDD 顺序

1. 在 `internal/buildcontract` 先写依赖/导入/调用面测试：当前缺 logit 依赖和 logger package，
   确认 RED；坏源码 fixture 分别证明越层 import、所有 package-level slog 日志入口、
   Default/With/New/NewLogLogger/TextHandler/JSONHandler/SetDefault、Handler 提取、日志方法值、
   slog.Any 和动态 message 会被拒绝；每种入口使用独立坏 fixture，避免一条规则假绿。
2. 在 `lib/logger` 写最终 writer 黑盒测试，覆盖基础 JSON、级别过滤、typed context、完成事件、
   安全 attrs、完整 Config、代表性 adversarial JSON、raw cause、并发隔离和 failing writer，确认 RED。
3. 通过 `go get github.com/lifei6671/logit@v1.0.0` 更新 module 文件；实现最小构造器、
   safeHandler、typed context 与完成事件，让定向测试转绿。
4. 运行 Shuffle/Race 和完整泄漏 marker 扫描；逐个 ContextFields 注入结构非法值，确认九种标准
   method 均可建立 context、outbound 无响应仍记录完成日志，并验证显式覆盖、
   WithGroup/WithAttrs 顺序组合、nested group、零调用/panic LogValuer、Base64、URL/query 与 writer
   error 不绕过；同时证明所有合法 context 字段真实写入，避免全丢弃假绿。
5. 自 review 分层、并发 store、动态 message、绝对路径、底层 error、Windows 输出和依赖边界。
6. 使用 docs-sync 同步技术方案、清单和 backend logging spec；不修改 README、Makefile、
   `app.yaml.example`、OpenAPI 或 Desktop。
7. 使用 trellis-check 执行全量门禁，通过后提交、归档并记录日志。

## 计划文件

- `server/lib/logger/logger.go`
- `server/lib/logger/safe_handler.go`
- `server/lib/logger/context.go`
- `server/lib/logger/*_test.go`
- `server/internal/buildcontract/logging_contract_test.go`
- `server/go.mod`、`server/go.sum`（只由 Go 命令更新）
- `.trellis/spec/backend/logging-guidelines.md` 及 index/directory spec
- Web SaaS 技术方案与实施清单

## 验证命令

在 `server/`：

```bash
gofmt -l ./lib/logger ./internal/buildcontract
go mod tidy -diff
go mod verify
go list -m -json github.com/lifei6671/logit
go vet ./...
go test -count=1 ./lib/logger ./internal/buildcontract ./internal/config ./lib/apperror
go test -shuffle=on -count=50 ./lib/logger
go test -count=1 ./...
go test -race -count=1 ./...
go run ./cmd/server
```

在仓库根目录：

```bash
git diff --check
```

若本机存在已批准且版本固定的扫描工具，再运行 `govulncheck ./...`、SBOM 和许可证扫描；工具
缺失时记录风险，不临时安装未批准工具。

## Review 与回滚点

- 若实现需要新增 logging 配置、文件权限、Gin/HTTP API 或 logit 之外的依赖，立即停止并重新
  规划，不把它作为“顺手补齐”。
- 如果 fixed allowlist 无法满足一个真实业务字段，先由该字段所属任务冻结名字、类型和泄漏测试，
  不改成任意 map 或敏感 key 黑名单。
- 若 logit v1.0.0 在目标工具链或 Race 下失败，停止实现并报告，不静默回退 JSONHandler 或旧版。
