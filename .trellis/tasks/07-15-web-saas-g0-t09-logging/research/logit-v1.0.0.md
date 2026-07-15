# logit v1.0.0 研究记录

## 官方来源

- Tag / commit：<https://github.com/lifei6671/logit/tree/v1.0.0>，tag commit `fa8dd2d`。
- slog adapter：<https://github.com/lifei6671/logit/blob/v1.0.0/slog.go>。
- JSON encoder：<https://github.com/lifei6671/logit/blob/v1.0.0/encoder.go>。
- Context store：<https://github.com/lifei6671/logit/blob/v1.0.0/context.go>。
- Module：`github.com/lifei6671/logit`，`go 1.24.0`，v1.0.0 没有第三方 module require。
- 本机 module cache zip hash：`h1:0Jo6Mx8/2Tq21idHZRM8CtqUxcjB/5CbVPaBASP5siU=`。

## 已验证 API

- `NewSimpleLogger(io.Writer, ...SimpleLoggerOption)`。
- `WithEncoder`、`WithMinLevel`、`WithErrorHandler`。
- `NewSlogHandler(Logger, ...SlogHandlerOption)` / `NewSlogLogger`。
- `WithSlogMinLevel`、`WithSlogSource`。
- `NewContext` 创建 fresh store；`ForkContext` 克隆 store；`WithContext` 会复用已有 store。
- `AddMetaField(s)`、`AddField(s)` 写入 context。

## 对本项目的影响

- 默认 JSON key 是 `time/level/msg`，本项目必须在构造阶段改为
  `timestamp/level/message`。
- `WithSlogSource(true)` 会记录 runtime frame 的完整源码路径，本项目保持 false。
- SlogHandler 会原样透传 Any、error、bytes、group；直接 attrs 会覆盖 context 同名字段，必须
  在外层加应用 safeHandler。
- 底层 encode/write 错误只通过 `WithErrorHandler` 回调，回调不能递归使用同一个 logger。
- 不使用 `slog.SetDefault`，避免标准 log 和未审第三方日志进入已审 Handler。
- 目标 Go 1.26.5 下已只读验证 logit v1.0.0 普通测试与 Race 测试通过。

## 许可证

v1.0.0 tag 和 module zip 均没有 LICENSE/COPYING。项目所有者已在 DS0 明确授权当前项目使用，
所以不阻塞开发；公开许可证据仍归 G7-T05，当前不得把历史版本许可证宣称为 v1.0.0 许可证。
