# 建立 Web SaaS server Go Module

## Goal

为 Web SaaS Go Runtime 建立一个可独立编译、测试且工具链版本可验证的 `server/` Go
Module，作为 G0 后续配置、错误合同、OpenAPI、日志和 HTTP 基线的唯一后端模块根。

## Requirements

- Module 目录固定为 `server/`，module path 固定为
  `github.com/lifei6671/commerce-shoot-studio/server`。
- `go.mod` 必须声明 `go 1.26.0` 和 `toolchain go1.26.5`；实际验证使用的 Go 版本必须是
  `go1.26.5`，不能把本机其他版本的成功结果当作验收证据。
- 只创建最小 `cmd/server` 进程入口和工具链 / Module 合同测试；入口不得启动 HTTP、读取
  配置、连接 MySQL / Redis、创建 Worker 或实现占位业务逻辑。
- 2026-07-15 用户批准方案 A：只创建上述真实文件，后续 G0 任务按需建立所属目录；不创建
  技术方案中的完整空目录树，也不使用 `.gitkeep`。
- 本切片不引入第三方依赖。Gin、logit、Viper、OpenAPI 等已批准依赖由各自 G0 任务按
  已批准精确版本加入，避免未使用依赖和无意义 `go.sum` 膨胀。
- 新增生产代码和测试必须包含准确的简体中文 package / 边界注释；注释解释合同与限制，
  不复述代码字面。
- 不修改 Desktop、`web/`、根 Makefile、CI、数据库 schema、公共 API 或配置定义。
- 本切片没有 HTTP 请求；不得提前创建绕过 logit 的 `net/http` / Gin 入口。G0-T05 必须
  依赖 G0-T09，保证后续每个入站 / 出站 HTTP 请求在实现时已具备 logit context 和完成日志。

## Acceptance Criteria

- [x] `server/go.mod` 的 module path、`go` 指令和 `toolchain` 指令与 Requirements 完全一致。
- [x] 合同测试会在 module path、Go 语言版本或 toolchain 版本漂移时明确失败。
- [x] `server/cmd/server` 可编译、可执行并正常退出，不产生网络监听或外部副作用。
- [x] `go version` 输出 `go1.26.5`，`go mod verify`、格式化检查、`go vet ./...`、
  `go test ./...` 和 `go test -race ./...` 全部通过。
- [x] `server/` 未出现未使用的第三方依赖、空目录占位、HTTP / DB / 配置抢跑或敏感信息。
- [x] 自 review 确认中文注释、最小范围、跨平台路径和错误输出清晰；清单 G0-T01 只在取得
  上述证据后标记完成。

## Validation Evidence

- 2026-07-15：初始 `go test ./...` 因目录不属于 Go Module 失败，确认第一阶段红灯。
- 2026-07-15：临时缺少 `toolchain` 的 `go.mod` 使合同测试分别报告缺少声明和运行时
  `go1.26.0` 不符合 `go1.26.5`，确认第二阶段红灯。
- 2026-07-15：补齐实现后，`go version`、`gofmt -l`、`go mod verify`、`go vet ./...`、
  `go test ./...`、`go test -race ./...`、`go run ./cmd/server` 与根目录 `git diff --check`
  全部通过。
