# G0-T04 实施计划

## 顺序

1. 先写 OpenAPI 结构与生成边界测试，使用坏文档证明 remote ref、非 GET/POST、重复
   operationId、CSRF/敏感字段和脚本漂移会失败。
2. 新增 `server/api/openapi.yaml`，只实现确认的共享/核心 components 和 `paths: {}`，让结构
   测试转绿。
3. 新增 models-only `oapi-codegen` 配置与精确版本 `go:generate` 指令，生成并提交
   `types.gen.go`；不修改产品 Go module 依赖。
4. 创建最小 `web/package.json`，精确安装 `openapi-typescript@7.13.0` 生成独立 lockfile 和
   `web/src/api/generated/openapi.ts`；不安装 UI/运行时依赖。
5. 先把生成物加入 Git index，再二次运行两条生成命令并检查生成物无 diff；同时由合同测试校验
   schema/双端生成物 SHA-256 审查快照，避免首次 untracked 文件让 diff 检查假绿。
6. 自 review 公共字段、敏感信息、Desktop 零改动、Gin/G0.5/G2～G6 越界和 Windows 路径。
7. 使用 docs-sync 同步技术方案、实施清单、README/Makefile 影响判断和 Trellis 规范。
8. 使用 trellis-check 完成全量复审，通过后提交、归档并记录开发日志。

## 验证命令

在 `server/`：

```bash
go generate ./api
gofmt -l ./api ./internal/buildcontract ./internal/models/dto/generated
go mod tidy -diff
go mod verify
go vet ./...
go test -count=1 ./...
go test -race -count=1 ./...
```

在仓库根目录：

```bash
npm ci --prefix web
npm run --prefix web generate:openapi
npm audit --prefix web --audit-level=high
# 首次新增时先 git add 两个生成物，再运行本检查。
git diff --exit-code -- server/internal/models/dto/generated/types.gen.go web/src/api/generated/openapi.ts
git diff --check
```

如本机存在已批准的扫描工具，再运行 `govulncheck ./...`、npm SBOM 与许可证清单；工具缺失时
必须记录未验证风险，不临时引入未批准依赖。

## 风险与回滚点

- 任何业务 path、request/response 字段、Cookie scheme、Idempotency-Key 格式或新增 component
  都是公共合同变更；超出 PRD 首批列表时停止并回到规划。
- 生成器默认 Gin ErrorHandler 可能暴露原始错误，本轮不生成 Gin server；G0-T05 必须显式
  接入 `apperror` 安全映射。
- 禁止手工修改生成文件；修改必须回到 `openapi.yaml` 后重新生成两端产物。
- 若 npm lockfile 引入高危依赖或许可证不满足已批准边界，回滚 Web 工具壳并重新选择工具链，
  不忽略扫描结果。
