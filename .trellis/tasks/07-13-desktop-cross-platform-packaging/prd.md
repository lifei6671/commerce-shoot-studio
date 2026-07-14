# macOS 与 Windows 双架构打包脚本

## Goal

在仓库根目录提供可重复执行的桌面应用打包入口，并通过 GitHub Actions 在对应宿主 runner 上构建 macOS 与 Windows 的 `x86_64`、`arm64` 应用及安装产物。

## Background

- 当前根 `Makefile` 已通过 `npm --prefix desktop run tauri -- build` 提供当前宿主平台的通用构建入口，但不能选择业务友好的架构名称，也没有对宿主系统、Rust target 和平台工具链做前置检查。
- `desktop/src-tauri/tauri.conf.json` 已声明应用资源、图标和 `bundle.targets = "all"`，新脚本只包装既有 Tauri v2 构建链，不修改 Tauri 配置、依赖或锁文件。
- 用户已确认本任务中的 `x86` 指 `x86_64`，不支持 32 位 `i686`。

## Requirements

1. 在根目录新增 `build/package-macos.sh`：
   - 仅允许在 macOS 执行。
   - 支持 `arm64`、`x64`、`all`，映射为 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`。
   - 默认构建当前宿主架构；`all` 按两个独立 target 依次打包。
   - 默认生成 `app,dmg`。
2. 在根目录新增 `build/package-windows.ps1`：
   - 仅允许在 Windows PowerShell 执行。
   - 支持 `arm64`、`x64`、`all`，映射为 `aarch64-pc-windows-msvc` 与 `x86_64-pc-windows-msvc`。
   - 默认构建当前宿主架构；`all` 按两个独立 target 依次打包。
   - 默认生成 `nsis,msi`。
   - 从同一个 Visual Studio 安装为每个 target 单独初始化 Developer PowerShell 环境，不能复用调用脚本前或上一 target 的 MSVC 架构环境。
   - 仅当 bundle 包含 `msi` 时要求管理员 PowerShell，并检查 VBSCRIPT capability 和 `cscript.exe`；缺少权限或功能时在进入构建前明确失败。
3. 两个脚本都必须：
   - 复用 `desktop/package.json` 的 Tauri CLI 和 `tauri.conf.json` 的前端构建/资源收集流程。
   - 支持跳过依赖安装；默认用锁文件执行 `npm ci`，每次调用最多执行一次。
   - 在构建前检查 Node/npm、Cargo/Rustup、目标 Rust target 和平台必要工具；缺失时快速失败并给出可执行提示。
   - 第一版显式使用未签名模式，不读取、打印或持久化证书与密钥。
   - 成功后输出实际 bundle 目录，不把安装包复制到仓库根目录。
4. 新增 `build/README.md`，说明命令、参数、宿主限制、目标三元组、产物目录以及签名/公证不在第一版范围内。
5. 同步根 `README.md` 和 `Makefile` 的打包入口说明；不改变现有 `make package` 的行为。
6. 新增 `.github/workflows/package-desktop.yml`：
   - 支持手动触发和 `v*` tag 触发。
   - 使用四个独立矩阵项构建 macOS ARM64、macOS x64、Windows x64、Windows ARM64，避免单个 Job 混合宿主或架构。
   - 使用 GitHub 当前对应架构 runner；Windows ARM64 runner 处于预览状态，必须在文档中显式标记。
   - 使用 `tauri-apps/tauri-action` 调用 `desktop` 内的项目 CLI；macOS 生成 `app,dmg`，Windows x64 与 ARM64 的稳定 CI 产物生成 `nsis`。
   - 固定 Node、Rust 和所有 Action 的版本；MSI 保留为本地脚本实验能力，不阻断稳定 CI 的 NSIS 产物。
   - 第一版只上传未签名的 Actions Artifacts，不创建或更新 GitHub Release，不读取签名 secret。
   - 权限收口为只读仓库内容，不允许 workflow 写 release、tag 或仓库内容。

## Acceptance Criteria

- [x] `build/package-macos.sh --help` 成功并列出 `arm64|x64|all`、默认 bundle 与示例。
- [x] macOS 脚本对非法架构、非法 bundle、非 macOS 宿主和缺失 Rust target 明确失败。
- [x] Windows 脚本参数使用 `ValidateSet` 限制 `arm64|x64|all` 与 `nsis|msi|all`，并对非 Windows 宿主、缺失 Rust target/MSVC 工具链明确失败。
- [x] 两个平台脚本都只调用仓库内已安装的 Tauri CLI，并显式传递目标 triple、bundle 列表、CI 与未签名参数。
- [x] macOS shell 语法检查、帮助/错误路径测试和仓库前端/Rust 静态检查通过。
- [x] Windows 脚本完成结构级复审；当前环境没有 PowerShell/Windows，真机语法、打包与运行仍明确标记为未验证。
- [x] Windows 脚本按 target 调用同一 Visual Studio 安装的 `Launch-VsDevShell.ps1`，并仅为 MSI/all 执行 VBSCRIPT 与 `cscript.exe` 结构级预检。
- [x] README、Makefile 和任务清单准确区分“脚本已提供”与“四架构真机产物已验证”。
- [x] workflow 具备四个明确的 OS/架构/target/bundle 映射，并为每个矩阵项安装对应 Rust target。
- [x] workflow 使用 `projectPath: desktop`、仓库锁文件执行 `npm ci`，并将安装产物上传为带 `unsigned` 且名称不冲突的 Actions Artifacts。
- [x] workflow 只使用 `contents: read`，保持 `--no-sign`，不包含 release、tag 写入或签名 secret。
- [x] workflow YAML 可解析，相关文档准确记录手动/tag 触发、runner 预览状态、首次在线运行证据和 Windows MSI 剩余风险。

## Out of Scope

- 32 位 `i686`。
- 从 macOS 直接交叉生成 Windows 安装包，或从 Windows 生成 macOS 安装包。
- Apple codesign/notarization/stapling、Windows Authenticode、证书管理和自动更新。
- 自动创建 GitHub Release、上传发布渠道、版本自动递增。
- 修改 Tauri bundle 配置、依赖、锁文件、权限或业务代码。
- 修复 GitHub hosted runner 的 WiX 3.14.1/VBScript ICE 环境，或将 Windows MSI 恢复为稳定 CI 产物。
