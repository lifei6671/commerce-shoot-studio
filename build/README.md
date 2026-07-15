# 桌面端打包脚本

本目录提供 macOS 与 Windows 的 Tauri v2 宿主原生打包入口。脚本会检查宿主系统、
平台工具链和 Rust target，默认执行一次 `npm ci --prefix desktop`，然后调用仓库内的
Tauri CLI。产物保留在 Tauri 的默认 `target` 目录，不会复制到仓库根目录。

> 当前脚本和 CI 生成的产物均未签名。Apple codesign、公证与 stapling、Windows
> Authenticode 和自动更新不在第一版范围内；推送版本标签时，CI 会将未签名安装包
> 上传到对应的 GitHub Release，并在发布说明中明确提示这一风险。

## 支持矩阵

| 宿主 | `arch` | Rust target | bundle |
| --- | --- | --- | --- |
| macOS | `arm64` | `aarch64-apple-darwin` | `app`、`dmg` |
| macOS | `x64` | `x86_64-apple-darwin` | `app`、`dmg` |
| Windows | `x64` | `x86_64-pc-windows-msvc` | `nsis`、`msi` |
| Windows | `arm64` | `aarch64-pc-windows-msvc` | `nsis`、`msi` |

默认使用当前宿主架构。`all` 会依次构建表中的两个独立 target，不生成 macOS
universal app，也不生成 Windows 多架构合并安装包。脚本不支持从 macOS 交叉打包
Windows，或从 Windows 交叉打包 macOS。

## macOS

前置要求：Node.js/npm、Rust/Cargo/Rustup、Xcode Command Line Tools、`xcrun` 和
`hdiutil`。请求的 Rust target 必须提前安装，例如：

```bash
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin
```

从仓库根目录运行：

```bash
# 当前 Mac 架构，生成 app 和 dmg
build/package-macos.sh

# 分别构建两个架构，只生成 dmg
build/package-macos.sh --arch all --bundle dmg

# 构建 x64 app，并复用已安装的 desktop/node_modules
build/package-macos.sh --arch x64 --bundle app --skip-install
```

参数：

- `--arch arm64|x64|all`：默认使用当前 Mac 架构。
- `--bundle app|dmg|all`：默认 `all`，即 `app,dmg`。
- `--skip-install`：跳过 `npm ci --prefix desktop`。

也可用 `make package-macos` 执行当前架构、全部 bundle 的默认命令。

## Windows

纯 NSIS 构建可在普通 Windows PowerShell 或 Visual Studio Developer PowerShell 中运行；
MSI 或默认的 `all` 还需使用管理员 PowerShell，以读取 VBSCRIPT Windows capability。
前置要求为 Node.js/npm、Rust/Cargo/Rustup、Visual Studio 2022 Build Tools 和 Windows
SDK；当前 PowerShell 的执行策略必须允许运行 Visual Studio 自带脚本。请求的 Rust
target 必须提前安装。

脚本通过 Visual Studio Installer 的 `vswhere.exe` 选择一个同时包含全部请求组件的
Visual Studio 安装：x64 需要 `Microsoft.VisualStudio.Component.VC.Tools.x86.x64`，
ARM64 需要 `Microsoft.VisualStudio.Component.VC.Tools.ARM64`。构建每个 target 前，脚本
都会从该安装调用 `Common7\Tools\Launch-VsDevShell.ps1`，使用 `HostArch=amd64` 和对应的
`Arch=amd64|arm64` 重新初始化 `cl`、`link`、`rc` 环境，因此 `-Arch all` 不会复用上一
架构的 MSVC 环境。初始化后还会把 `VSCMD_ARG_TGT_ARCH` 归一化为 `x64|arm64` 并与
请求架构比较，不匹配时立即失败。该调用方式遵循
[Microsoft Developer PowerShell 官方说明](https://learn.microsoft.com/visualstudio/ide/reference/command-prompt-powershell?view=vs-2022)。例如：

```powershell
rustup target add x86_64-pc-windows-msvc
rustup target add aarch64-pc-windows-msvc
```

从仓库根目录运行：

```powershell
# 当前 Windows 架构，生成 NSIS 和 MSI
.\build\package-windows.ps1

# 分别构建两个架构，只生成 NSIS
.\build\package-windows.ps1 -Arch all -Bundle nsis

# 构建 ARM64 MSI，并复用已安装的 desktop/node_modules
.\build\package-windows.ps1 -Arch arm64 -Bundle msi -SkipInstall
```

参数：

- `-Arch x64|arm64|all`：默认使用当前 Windows 架构。
- `-Bundle nsis|msi|all`：默认 `all`，即 `nsis,msi`。
- `-SkipInstall`：跳过 `npm ci --prefix desktop`。

当 `-Bundle` 为 `msi` 或 `all` 时，脚本还会检查 Windows 的 VBSCRIPT capability 和
`cscript.exe`；此检查需要管理员 PowerShell。缺少权限或功能时会在进入构建前失败，
并给出启用命令或设置入口；只构建 `nsis` 不会执行这项检查。此要求来自
[Tauri Windows Installer 文档](https://v2.tauri.app/distribute/windows-installer/#building)。

本地脚本继续保留 MSI 参数，但当前将 MSI 视为实验能力。2026-07-14 的 GitHub hosted
runner 实测中，x64 与 ARM64 都成功完成应用和 NSIS 构建，随后统一在 WiX 3.14.1
`light.exe` 阶段失败。该结果说明 `cscript.exe` 存在和 capability 查询通过不足以证明
WiX ICE 所需的 VBScript 引擎可用；在补齐真实脚本引擎探针并完成安装/卸载验证前，
不要把本地 MSI 参数视为稳定发布入口。

`make package-windows-info` 只打印 PowerShell 入口，不会尝试从 Makefile 启动 Windows
打包。

## GitHub Actions

[桌面安装包 workflow](../.github/workflows/package-desktop.yml) 支持在 Actions 页面手动
触发，也会在推送 `v*` tag 时触发。每次运行使用四个独立矩阵项：

| Job | runner | Rust target | bundle |
| --- | --- | --- | --- |
| macOS ARM64 | `macos-15` | `aarch64-apple-darwin` | `app,dmg` |
| macOS Intel x64 | `macos-15-intel` | `x86_64-apple-darwin` | `app,dmg` |
| Windows x64 | `windows-latest` | `x86_64-pc-windows-msvc` | `nsis` |
| Windows ARM64 | `windows-11-arm` | `aarch64-pc-windows-msvc` | `nsis` |

workflow 的 checkout v7 与 setup-node v6 使用 Node 24 Action runtime；这不改变项目
工具链，setup-node 仍为项目安装 Node.js `22.22.0`，Rust 固定为 `1.96.0`。第三方
Action 均锁定到明确的提交 SHA：

- `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0`（v7.0.0）
- `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`（v6.4.0）
- `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`（v8.0.1）
- `tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f`（v1）

每个 Job 使用 `desktop/package-lock.json` 执行 `npm ci`，checkout 不持久化凭据，
Cargo 强制使用 `--locked`，再由 Tauri Action 以 `projectPath: desktop` 调用项目内
CLI。Windows hosted runner 当前只生成 NSIS，不进入 WiX/VBScript 依赖的 MSI 链路。
所有构建均传递 `--no-sign`，不读取签名 secret。四个构建 Job 保持
`contents: read`；只有依赖整个矩阵成功的发布 Job 拥有 `contents: write` 和
`actions: read`，用于下载本次运行的 Artifacts 并创建 Release。

成功运行后，可在对应 workflow run 的 **Artifacts** 区域下载产物。artifact 名称使用
`commerce-shoot-studio-unsigned-[platform]-[arch]-[bundle]` 模式，四个矩阵项及不同
bundle 不会互相覆盖。

上传 GitHub Release 前，发布脚本会保留 Actions Artifact 内的原始文件，并把四个安装包
复制为稳定的 ASCII 文件名，避免 GitHub 按特殊字符规则改写中文文件名后导致严格校验失败：

```text
commerce-shoot-studio_<version>_macos_arm64.dmg
commerce-shoot-studio_<version>_macos_x64.dmg
commerce-shoot-studio_<version>_windows_arm64-setup.exe
commerce-shoot-studio_<version>_windows_x64-setup.exe
```

若标签含 SemVer 构建元数据，文件名中的 `+` 会映射为 `_`；Release 标签和应用内版本仍保留
原始 SemVer，例如 `v0.2.0-beta.1+build.5` 对应文件名版本段
`0.2.0-beta.1_build.5`。

手动触发只生成 Actions Artifacts，不创建 Release。`v*` 标签会触发构建；标签必须符合
`vMAJOR.MINOR.PATCH` 格式，并作为本次发布的唯一版本事实源：构建 Job 去掉前缀
`v`，通过 Tauri `--config` 临时覆盖应用版本，不要求修改 `tauri.conf.json`、Cargo 或 npm
版本文件。四个矩阵项必须全部成功，随后发布 Job 才会汇总并校验 2 个 DMG 和 2 个 NSIS
`setup.exe`。发布流程先创建 Draft，
确认 macOS 与 Windows 均各有 ARM64、x64 产物，上传并精确复核四个安装包后再公开；
重跑时可以更新未公开的 Draft，但 Draft 存在额外资产时会停止发布，也不会覆盖已公开
Release 的资产。`.app` 目录、实验性 MSI 和其它中间文件不会上传到 Release。

例如，推送 `v0.1.2` 时，四个平台安装包和 GitHub Release 均使用 `0.1.2`；非法标签格式
或安装包数量不完整时，发布 Job 会明确失败且不公开不完整 Release。预发布版本（如
`v0.2.0-beta.1`）会创建 Prerelease。Actions Artifact 仍保留用于逐 Job 调试，并受
GitHub 的保留期限约束。

2026-07-14 的[首次在线运行](https://github.com/lifei6671/commerce-shoot-studio/actions/runs/29325750147)
已经验证两个 macOS Job 成功；两个 Windows Job 的应用与 NSIS 构建也成功，但同一 Job
后续的 MSI `light.exe` 失败，导致 Windows artifact 未上传，因此 workflow 已将 x64 与
ARM64 的稳定 CI bundle 收口为 NSIS。

2026-07-15 的 [v0.1.3 在线运行](https://github.com/lifei6671/commerce-shoot-studio/actions/runs/29385717828)
中，四个构建 Job 和六个 Actions Artifacts 均成功；统一发布 Job 在创建 Draft 并上传后，
因 GitHub 改写含中文的资产文件名而无法按原名复核。发布脚本现已在上传边界使用上述 ASCII
名称，下一次标签构建仍需验证 Release 可正常公开。`windows-11-arm` runner 仍处于 Public
Preview；不可用时应记录阻塞或改用 ARM64 自托管 runner，不能用 x64 产物替代 ARM64 验收。

## 产物目录

每个 target 的产物位于：

```text
desktop/src-tauri/target/<target-triple>/release/bundle/
```

常见子目录为 macOS 的 `macos/`、`dmg/`，以及 Windows 的 `nsis/`、`msi/`。这些目录
已包含在仓库的 Tauri 构建输出忽略规则中，不要提交生成的 `.app`、`.dmg`、`.exe` 或
`.msi` 文件。

## 验证状态

脚本入口和 CI 编译成功都不等于四种架构已经完成发布验收。v0.1.3 已证明调整后的四个构建
Job 和六个 Actions Artifacts 可在线成功，但产物架构、内置模特资源、安装/启动/卸载，
以及包含空格或中文的本地仓库路径仍需补验。MSI、签名和公证仍需单独设计与验证。GitHub
Release 自动发布链路还需要通过下一次真实 `v*` 标签构建核验 ASCII 资产名称、Draft 公开
和安装行为。

本轮新增 Release 模型边界也仍待产物验收：打包应用的 provider profiles、模型配置、
模型配置 UI 和任务执行链都不能暴露或执行 Mock Local；首次读取或解析含当前 mock
配置的旧 workspace 时应清理这些配置，但必须保留既有 `model_invocations` 历史审计记录。
Debug 构建和自动化测试继续保留 deterministic mock，不属于 Release 产物验收失败。
