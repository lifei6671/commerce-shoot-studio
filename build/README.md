# 桌面端打包脚本

本目录提供 macOS 与 Windows 的 Tauri v2 宿主原生打包入口。脚本会检查宿主系统、
平台工具链和 Rust target，默认执行一次 `npm ci --prefix desktop`，然后调用仓库内的
Tauri CLI。产物保留在 Tauri 的默认 `target` 目录，不会复制到仓库根目录。

> 当前脚本生成的产物均未签名。Apple codesign、公证与 stapling、Windows
> Authenticode、自动更新和发布上传不在第一版范围内。

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

`make package-windows-info` 只打印 PowerShell 入口，不会尝试从 Makefile 启动 Windows
打包。

## GitHub Actions

[桌面安装包 workflow](../.github/workflows/package-desktop.yml) 支持在 Actions 页面手动
触发，也会在推送 `v*` tag 时触发。每次运行使用四个独立矩阵项：

| Job | runner | Rust target | bundle |
| --- | --- | --- | --- |
| macOS ARM64 | `macos-15` | `aarch64-apple-darwin` | `app,dmg` |
| macOS Intel x64 | `macos-15-intel` | `x86_64-apple-darwin` | `app,dmg` |
| Windows x64 | `windows-latest` | `x86_64-pc-windows-msvc` | `nsis,msi` |
| Windows ARM64 | `windows-11-arm` | `aarch64-pc-windows-msvc` | `nsis,msi` |

workflow 固定使用 Node.js `22.22.0` 和 Rust `1.96.0`，并将第三方 Action 锁定到明确
的提交 SHA：

- `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5`（v4）
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`（v4）
- `tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f`（v1）

每个 Job 使用 `desktop/package-lock.json` 执行 `npm ci`，checkout 不持久化凭据，
Cargo 强制使用 `--locked`，再由 Tauri Action 以 `projectPath: desktop` 调用项目内
CLI。Windows Job 在构建 MSI 前会检查 VBScript
capability 和 `cscript.exe`，缺失时快速失败。所有构建均传递 `--no-sign`，workflow
权限仅为 `contents: read`，不读取签名 secret，也不创建或更新 GitHub Release。

成功运行后，在对应 workflow run 的 **Artifacts** 区域下载产物。artifact 名称使用
`commerce-shoot-studio-unsigned-[platform]-[arch]-[bundle]` 模式，四个矩阵项及不同
bundle 不会互相覆盖。Actions Artifact 是有保留期限的 CI 产物，不等同于正式 Release。

该 workflow 当前只完成本地 YAML 与结构验证，尚未在 GitHub runner 上在线运行。
`windows-11-arm` 仍处于 Public Preview，实际可用性受仓库和 GitHub runner 状态影响；
不可用时应记录阻塞或改用 ARM64 自托管 runner，不能用 x64 产物替代 ARM64 验收。

## 产物目录

每个 target 的产物位于：

```text
desktop/src-tauri/target/<target-triple>/release/bundle/
```

常见子目录为 macOS 的 `macos/`、`dmg/`，以及 Windows 的 `nsis/`、`msi/`。这些目录
已包含在仓库的 Tauri 构建输出忽略规则中，不要提交生成的 `.app`、`.dmg`、`.exe` 或
`.msi` 文件。

## 验证状态

脚本入口与参数不等于四种架构已经完成发布验收。Windows 的逐 target Developer Shell
切换及 MSI 前置检查目前只有结构级验证，尚未在 Windows 真机执行。正式使用前仍需在
对应 macOS/Windows 宿主上分别确认：构建成功、产物架构正确、内置模特资源完整、
安装/启动/卸载正常，以及包含空格或中文的仓库路径可用。签名、公证和发布渠道还需
单独设计与验证。
