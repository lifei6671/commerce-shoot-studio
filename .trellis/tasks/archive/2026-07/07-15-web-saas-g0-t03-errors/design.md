# G0-T03 技术设计

## 边界与依赖方向

```text
Service / Repository / Worker
          │
          ├── lib/apperror   稳定业务错误与安全 cause 链
          └── lib/constant   数据库状态和稳定领域枚举

future HTTP middleware ──errors.As──> lib/apperror
future OpenAPI mapper  ──int(Code)───> ErrorResponse.code
```

两个包都只依赖 Go 标准库，互不依赖。`apperror` 不引入 Gin、OpenAPI DTO、日志或数据库；
`constant` 不承载错误码，避免两个事实源。现有启动配置错误发生在 HTTP 启动前，本轮不迁移。

## `lib/apperror`

文件结构：

```text
server/lib/apperror/
├── error.go
├── catalog.go
├── error_test.go
└── catalog_test.go
```

公开合同：

```go
type Code int

type Error struct { /* 私有字段 */ }

func (err *Error) Error() string
func (err *Error) Unwrap() error
func (err *Error) Is(target error) bool
func (err *Error) Code() Code
func (err *Error) HTTPStatus() int
func (err *Error) SafeMessage() string
func (err *Error) Wrap(cause error) *Error
```

包内 `define` 创建私有字段只读的导出 sentinel，例如 `ErrInvalidRequest`；调用方禁止重绑定
这些包级变量。不导出
`New(code, status, message)`，避免业务调用方绕过号段、唯一性和安全消息评审；字段保持私有，
禁止被 JSON/日志反射误暴露 cause。`Wrap` 复制稳定定义并保存 cause；`Error()` 永远只返回
安全消息，`Unwrap()` 保留内部错误链，`Is` 按稳定 code 匹配同一业务错误。

首批六项 HTTP 错误严格使用 PRD 表格。`CodeGenerationProviderResultUncertain=140504` 只是
稳定 code 常量，不进入 HTTP error catalog，因此 catalog 的每一项仍完整拥有合法 4xx/5xx
status 和安全消息。

## `lib/constant`

文件结构：

```text
server/lib/constant/
├── async_job_status.go
├── model_category.go
└── constant_test.go
```

使用 `type AsyncJobStatus uint8` 与 `type ModelCategory uint8` 两个不同具名类型，所有数值显式
赋值，不用会因插入顺序漂移的裸 `iota`。不实现 `String()` / JSON marshal；后续 Entity/DTO
Mapper 负责把数据库数值映射成公共字符串。不得创建通用 `status.go` 或通用 `Status` 类型。

## 测试与安全

- 外部包测试验证调用方只能读取 code/status/message，不能修改内部字段。
- cause 使用带 SQL、路径和 secret marker 的错误；`Error()`、`SafeMessage()`、`%v` 均不得
  泄漏 marker，同时 `errors.Is` / `errors.As` 必须保留链路。
- 内部 catalog 测试验证 code 全局唯一、位于固定号段、HTTP status 合法且消息非空。
- 常量测试精确断言持久值、底层类型为 `uint8`、类型名独立，并断言不存在通用
  `server/lib/constant/status.go`。

## 兼容与回滚

这是新 Go 包，没有既有调用方或数据库数据需要迁移。若合同审查失败，可删除两个新增包并
回退文档；本轮不修改启动入口、配置加载、HTTP、OpenAPI 或 schema。
