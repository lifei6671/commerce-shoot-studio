# G0-T03 实施计划

## 顺序

1. 先写 `lib/apperror` 外部行为测试和内部 catalog 测试，确认包不存在导致红灯。
2. 先写 `lib/constant` 持久数值、具名 `uint8` 类型和目录布局测试，确认包不存在导致红灯。
3. 实现最小 `Code` / `Error`、六项 HTTP sentinel 与 `140504` 结果 code，使错误测试转绿。
4. 实现 Async Job 状态和 Model Category 显式常量，使常量测试转绿。
5. 自 review：错误码唯一性、安全消息、cause 泄漏、标准库依赖、跨领域类型、G0.5 边界和
   是否出现通用 `status.go`。
6. 使用 docs-sync 同步技术方案、实施清单和 `.trellis/spec/backend` 的真实合同。
7. 使用 trellis-check 运行窄范围与完整 Go 门禁；通过后按 git-commit 规范提交并归档任务。

## 验证命令

在 `server/`：

```bash
gofmt -w ./lib/apperror ./lib/constant
gofmt -l ./lib/apperror ./lib/constant
go mod tidy -diff
go mod verify
go vet ./...
go test -count=1 ./lib/apperror ./lib/constant
go test -count=1 ./...
go test -race -count=1 ./...
go run ./cmd/server
```

在仓库根目录：

```bash
git diff --check
```

## 风险与回滚点

- 任何新增 code、HTTP 映射、安全文案或状态数值都属于公共合同；超出 PRD 表格时必须回到
  规划确认，不能在实现中顺手补齐。
- `140504` 没有同步 HTTP 映射，本轮只作为 code 常量；若测试要求 HTTP 504，说明测试越界。
- 不为未来领域创建空文件、占位类型、迁移方法或字符串 DTO 映射。
- 不修改 `internal/config` 现有启动错误，本轮只建立后续业务调用使用的新边界。
