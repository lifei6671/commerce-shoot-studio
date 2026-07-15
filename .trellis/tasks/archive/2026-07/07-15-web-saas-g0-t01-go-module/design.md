# G0-T01 技术设计

## 边界

本任务只建立 Go Module 和最小编译入口，不承担 G0 其他任务的依赖装配。用户已批准方案
A：目录随真实文件创建，不生成大量空包或 `.gitkeep`：

```text
server/
├── go.mod
├── cmd/server/main.go
└── internal/buildcontract/module_contract_test.go
```

只有实际引入第三方 module 后才允许生成并提交 `go.sum`；若本切片没有外部依赖，缺少
`go.sum` 是正常结果，不创建空文件伪装依赖锁定。

## 工具链合同

`go.mod` 使用以下不可漂移值：

```text
module github.com/lifei6671/commerce-shoot-studio/server

go 1.26.0

toolchain go1.26.5
```

合同测试从 module 根定位并解析 `go.mod`，分别断言 module、Go 语言版本和 toolchain，
并直接断言 `runtime.Version() == "go1.26.5"`；错误信息使用简体中文并指出实际值与期望值。
测试不得依赖调用目录、用户 HOME、Unix shell 或仓库绝对路径。

验收时额外记录 `go version` 输出。这是构建环境合同，不能只依赖 `toolchain` 指令，因为
更高版本 Go 可能不会自动降级；跨平台自动断言由 Go 合同测试负责。

## 最小进程入口

`cmd/server/main.go` 只声明 `main` package 和空的 `main()`。注释明确 G0-T01 不进行网络、
配置或依赖初始化，真实生命周期由 G0-T07 接管。保持正常退出可以证明编译入口存在，同时
避免用占位输出形成未来兼容负担。

## 依赖与兼容性

- 本任务只依赖 Go 标准库，不运行 `go get`，不提前锁定未使用第三方依赖。
- Go 1.26.5 可由 `GOTOOLCHAIN=auto` 获取；若网络不可用，应报告工具链验证阻塞，不能用
  本机 `go1.26.0` 或更高版本替代证据。
- 路径处理使用 `runtime.Caller` / `filepath` 或等价跨平台方式，不拼接 Unix 专用路径。
- 本任务不含 HTTP；用户要求的 logit 请求上下文合同由 G0-T09 实现。清单把 G0-T09 加入
  G0-T05 前置依赖，从拓扑上阻止无日志 Gin 路由先落地。

## 回滚点

任务只新增 `server/` 最小文件与清单证据。若工具链或 module contract 验证失败，删除本任务
新增文件即可回到无 Go Module 状态，不影响 Desktop 和现有 Rust / TypeScript 构建。
