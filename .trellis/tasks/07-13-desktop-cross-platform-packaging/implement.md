# 实施计划

## 实现顺序

- [x] 新增 macOS Bash 脚本，完成参数解析、目标映射、前置检查、单次依赖安装、逐目标打包和产物输出。
- [x] 新增 Windows PowerShell 脚本，实现对称的参数、目标映射、前置检查与逐目标打包。
- [x] 新增 `build/README.md`，同步根 `README.md` 与 `Makefile` 帮助入口。
- [x] 在本地执行快速验证，修复发现的问题。
- [x] 自审与子代理复审，确认未覆盖既有 dirty tree、未泄漏 secret、未误报真机验证。
- [x] 在实现清单记录窄范围证据和剩余风险，不勾选四架构发布完成。
- [x] 新增 GitHub Actions 四目标矩阵，仅上传未签名 workflow artifacts。
- [x] 同步 README、build 文档和实施清单的 CI 入口、触发条件与未验证风险。
- [x] 完成 workflow YAML、权限、target/bundle 映射和第三方 Action 使用复审。
- [x] 修复 Windows 本地脚本跨 target 复用 MSVC 环境的问题，为每个 target 初始化同一 Visual Studio 安装的 Developer PowerShell。
- [x] 为 Windows 本地 MSI/all 打包补充 VBSCRIPT capability 与 `cscript.exe` 快速失败检查，保持纯 NSIS 不检查。

## 验证证据

- `bash -n build/package-macos.sh`：通过。
- macOS `--help`、非法架构、非法 bundle、缺失 `x86_64-apple-darwin` target：结果符合预期，未进入依赖安装或真实打包。
- `make help`、`make package-windows-info`：通过。
- `make check`：前端 30 个测试文件、289 个用例通过；生产构建、Rust `cargo check`、`npm audit --audit-level=high` 通过。
- `git diff --check`：通过。
- macOS 与 Windows 脚本早期复审发现的旧产物误判、macOS SDK 可用性和 Windows ARM64 MSVC 组件误判均已修复；后续全量 dirty-tree review 又发现 Windows 跨 target 未切换 Developer Shell、MSI 缺少 VBSCRIPT 预检两项问题，本轮已按上述结构契约修复。
- GitHub Actions workflow YAML 解析通过，四个矩阵项、target/bundle 映射、三个 Action 的完整提交 SHA、固定 Node/Rust、Cargo `--locked` 和名称隔离的未签名 artifact 均通过结构校验。
- workflow 权限与敏感信息复审通过：仅 `contents: read`，checkout 不持久化凭据，不包含 `contents: write`、release metadata、签名 secret、`GITHUB_TOKEN` 或 `continue-on-error`。
- Tauri Action 首次复审发现 annotated tag object SHA、checkout 凭据持久化和 Cargo 锁文件三项问题；已改为 v1 peeled commit `1deb371b0cd8bd54025b384f1cd735e725c4060f`、`persist-credentials: false` 和 `-- --locked`，二次复审无剩余 finding。
- Windows 本地脚本修复前的结构断言确认未调用 `Launch-VsDevShell.ps1`，也没有 VBSCRIPT/`cscript.exe` 预检；修复后静态契约确认每个 target 映射到 `Arch=amd64|arm64`、固定 `HostArch=amd64`、校验归一化后的 `VSCMD_ARG_TGT_ARCH`，并仅在 bundle 含 `msi` 时要求管理员权限和执行 MSI 前置检查。
- 最终独立复审确认 Windows 两项修复与 PreviewCanvas 跨类型下载互斥均已实质关闭，定向测试 8/8、`git diff --check` 通过，`no findings`。
- 当前环境未安装 `actionlint`，因此未执行该工具；以 Ruby YAML 解析、定向结构断言、`git diff --check` 和双人复审作为本地替代证据。

## 未验证项

- 当前 macOS 仅安装 `aarch64-apple-darwin`，且没有执行真实 release bundle；macOS ARM64/x64 的 app、dmg 仍待对应环境验证。
- 当前没有 PowerShell/Windows，Windows 脚本尚未进行 AST 解析、x64/ARM64 NSIS/MSI 打包与安装运行验证。
- Windows 跨 target Developer PowerShell 环境切换和 VBSCRIPT capability 查询尚未在 Windows 真机执行；当前证据仅为官方契约核对与脚本结构验证。
- 代码签名、公证、Authenticode 和发布上传不在第一版范围内。
- GitHub Actions workflow 尚未推送运行；Windows ARM64 runner 可用性和四目标在线产物仍待真实 workflow 验证。

## 验证命令

```bash
bash -n build/package-macos.sh
build/package-macos.sh --help
build/package-macos.sh --arch invalid
build/package-macos.sh --arch x64 --skip-install
make help
make frontend-build
make cargo-check
git diff --check
```

GitHub Actions 追加验证：

```bash
ruby -e 'require "yaml"; YAML.parse_file(".github/workflows/package-desktop.yml")'
rg -n "contents: read|--no-sign|uploadWorkflowArtifacts|windows-11-arm|macos-15-intel" .github/workflows/package-desktop.yml
```

`--arch x64 --skip-install` 在当前机器预期因缺少 Rust target 快速失败，不进入真实打包。Windows PowerShell 解析、四目标构建与安装 smoke 需在对应宿主补验。

## 风险与回滚点

- 不运行自动安装 Rust target 或平台工具链，避免脚本隐式修改开发机。
- 不修改锁文件、Tauri 配置或生成目录。
- 若 Windows PowerShell 结构审查发现行为不对称，先修脚本，不用 Bash 兼容层掩盖问题。
