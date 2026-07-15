# G0-T02 实施计划

## 顺序

1. PRD 完成 convergence，固化默认/显式入口、完整独立单文件配置、MySQL/Redis、
   Base64 单组密钥和 runtime typed JSON 边界。
2. 先写失败测试：覆盖入口、环境变量无效、未知字段、显式路径不回退、缺启动凭据、
   `dsn_params` 冲突、Redis 条件规则、密钥隔离/长度和敏感 marker 不泄漏。
3. 只引入已批准的 Viper `v1.21.0` 及其 mapstructure/YAML 解码栈，生成并审查 `go.sum`。
4. 新增完整注释的 `app.yaml.example`、`app.yaml` 精确忽略规则和最小 `internal/config`
   加载/校验实现，使静态配置测试转绿。
5. 先写失败测试，再实现 runtime document source Port 与严格 typed JSON decoder。
6. 自 review 依赖范围、跨平台路径、错误传播、secret 泄漏和后续 G0-T07/G0-T08 复用边界。
7. 运行完整验证；证据齐全后同步 checklist，但没有真实 DB/Redis 证据时不扩大完成声明。

## 验证命令

在 `server/`：

```bash
go version
gofmt -w ./internal/config
gofmt -l ./internal/config
go mod tidy
go mod verify
go vet ./...
go test ./internal/config
go test ./...
go test -race ./...
go list -m all
```

在仓库根目录：

```bash
git diff --check
```

## 风险与回滚点

- YAML 合同已经冻结；若实现发现必须改变字段或加载语义，回到规划并等待确认，不在代码中
  静默扩展兼容入口。
- Viper 带来传递依赖；只接受 `go mod tidy` 生成结果，不手改 `go.sum`，并保留后续漏洞、
  SBOM 与许可证门禁。
- 错误对象若携带完整配置会泄密；测试使用唯一 marker 逐类断言错误文本不包含敏感值。
