# G0-T02 技术设计

## 推荐边界

```text
默认 conf/app.yaml 或显式 app.yaml
              ↓ 以文件的上一级目录为工作目录
       单文件严格 Unmarshal + Validate
            启动级 Config

RuntimeDocumentSource → 固定业务 codec（G1 提供）→ typed runtime config
```

加载器接收一个可选配置文件路径。未传路径时固定使用进程工作目录下的
`conf/app.yaml`；传入路径时使用该文件。加载器完成绝对路径归一化后，把配置文件的上一级
目录（即文件所在目录）作为配置工作目录。后续相对路径均以此目录为基准。不搜索 HOME、环境变量或任意父
目录，也不在显式路径失败时静默回退默认文件。

G0-T07 的 serve 和 G0-T08 的 migrate 复用同一入口，只决定是否传入配置文件路径。显式
传入的配置文件代表一套完整、独立的部署配置，不继承仓库模板；缺少必要字段时直接失败。
仓库只提交 `conf/app.yaml.example`，用户复制或改名为 `app.yaml` 并填写真实值。本地
`conf/app.yaml` 由 Git 精确忽略，加载器不会自动尝试 `.example`。

## 静态配置结构

配置按领域内联在单个 `app.yaml`，并聚合成一个 `Config`：

- `mysql`：结构化 host、port、database、username、password、TLS、连接/
  读写 timeout 和连接池字段，并提供 `dsn_params: map[string]string` 扩展后续驱动参数。DSN
  只在内存中由装配层生成，不写入错误或日志；自定义参数大小写不敏感地拒绝 `tls`、
  `timeout`、`readTimeout`、`writeTimeout`、`parseTime`、`loc` 及连接身份/地址字段，后续装配
  固定 `parseTime=true`、`loc=UTC`。
- `session`：Store 选择，以及用户/管理两套独立 Cookie 名、认证密钥和加密密钥。
  第一版不建立 key ring、active version 或历史读取密钥；替换任一组密钥会让对应 Session
  全部失效。
- `redis`：单节点地址、可选密码、TLS、DB、连接池、timeout 与 key prefix；空密码
  明确表示目标 Redis 未启用认证，不触发 fallback 或自动探测。
- `security`：验证码 derivation / verification 两把独立固定密钥。第一版不保存
  密钥版本；替换任一密钥时，所有未过期 challenge 作废并要求重新发送。

所有启动密钥采用标准 Base64：Session 认证密钥解码为 64 字节，Session AES-256 加密密钥
解码为 32 字节，验证码两把密钥各解码为 32 字节。校验使用显式 Go `Validate()`，不引入
第二个依赖；错误只描述文件、字段路径和规则，不格式化完整配置或 secret 值。

加载器先用 Viper `v1.21.0` 已带入的 YAML v3 解码栈确认输入只有一个 YAML 文档，再审计 mapping key，拒绝大小写或去空格
后语义重复的字段；再为该文件创建独立 Viper 实例，严格解码到专用文档 DTO，最后显式
组装最终 `Config`。由于 Viper 会递归小写 map key，MySQL 文档在严格结构校验后从同一份
YAML node 恢复 `dsn_params` 原始键名，确保 `allowNativePasswords` 等驱动参数不被改写。
不使用 Viper 全局实例、环境变量、默认值叠加或 watcher。本任务不自行构造 DSN。

## Runtime 配置分界

G0-T02 只定义读取原始 JSON 的 source Port 与严格 typed decoder。decoder 必须只接受单个
JSON object、拒绝未知字段和尾随内容，并调用目标类型 `Validate()`。G1-T01/G1-T04 再定义
真实固定 key、表结构、Repository 和 SMTP/S3/Provider schema，避免倒置依赖。

## 兼容与回滚

- 本任务是新模块，无既有部署配置需要兼容或迁移；仓库只提交完整但 secret 为空的
  `conf/app.yaml.example`，它不是可启动配置或继承基线。
- 只新增 `conf/`、`internal/config/`、Viper 及其 mapstructure/YAML 解码栈与锁定的 `go.sum`。
- 若合同验证失败，可删除新增包和模板并回退 `go.mod/go.sum`，不影响 Desktop。
