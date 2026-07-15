# G0-T01 实施计划

## 顺序

1. 按用户批准的目录方案 A 创建本地 `server/` 空目录（空目录不提交），在其中运行
   `go test ./...`，记录“当前目录不属于 Go Module”的预期红灯。
2. 写入只包含 module path 和 `go 1.26.0`、故意缺少 toolchain 的最小 `go.mod`；再新增
   `internal/buildcontract/module_contract_test.go`，测试 module path、语言版本、toolchain
   和 `runtime.Version()`，使用跨平台路径定位 `go.mod`。
3. 运行合同测试，确认它因缺少 `toolchain go1.26.5` / 实际运行版本不符而红灯；测试内再用
   缺字段 fixture 验证解析与错误信息不是只对正确文件全绿的空断言。
4. 在 `go.mod` 补齐 `toolchain go1.26.5`，由 Go 自动选择目标工具链并让合同测试转绿。
5. 新增 `cmd/server/main.go`，只提供无副作用进程入口，不实现 HTTP、配置、DB 或 Worker。
6. 运行格式化和窄范围测试；检查没有产生无用依赖、空目录、绝对路径或英文业务注释。
7. 运行完整 G0-T01 验证并自 review；只有证据齐全后才更新清单状态和证据列。

## 验证命令

在 `server/` 目录执行：

```bash
go version
gofmt -w ./cmd/server/main.go ./internal/buildcontract/module_contract_test.go
gofmt -l ./cmd/server/main.go ./internal/buildcontract/module_contract_test.go
go mod verify
go vet ./...
go test ./...
go test -race ./...
go run ./cmd/server
```

在仓库根目录执行：

```bash
git diff --check
```

`gofmt -l` 必须没有输出，`go version` 必须显示 `go1.26.5`。完整 `V-GO` 中的
`golangci-lint v2.12.2` 和可复用 CI / Makefile 入口由 G0-T12 收口；SBOM、许可证和漏洞
扫描属于 G7 门禁。当前机器若只有旧版 linter，不允许把旧版结果写成完成证据，也不在本
任务擅自安装工具。

## Review 清单

- module path、语言版本和 toolchain 只有一个事实源，合同测试不会因调用目录不同而失效。
- 生产入口没有网络、文件、环境变量或进程外副作用。
- 所有新增代码有必要且准确的简体中文注释。
- 未修改 Desktop、Web、根 Makefile、CI、数据库或公共 API。
- 未提前引入 Gin / logit；G0-T05 已在清单依赖 G0-T09。

## 风险与回滚

- `go1.26.5` 下载失败：保留规划和测试，不用其他版本伪造绿灯，报告网络 / 工具链阻塞。
- 合同测试只能在本机绝对路径运行：立即修正为相对 module 定位后重测。
- 发现需要第三方解析器：优先用标准库简单解析固定三行合同，不扩大依赖范围。
