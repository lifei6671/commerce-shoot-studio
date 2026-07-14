# 技术设计

## 边界

新增脚本是现有 Tauri v2 构建链的薄包装层：

```text
根 build 脚本
  -> 宿主/参数/工具链检查
  -> npm ci（可跳过，仅一次）
  -> npm --prefix desktop run tauri -- build
  -> tauri.conf.json beforeBuildCommand
  -> tsc + Vite + Cargo + Tauri bundler
  -> desktop/src-tauri/target/<triple>/release/bundle
```

不新增共享 target 配置文件：macOS Bash 与 Windows PowerShell 的参数语法、宿主检查和工具链不同，两个短脚本分别维护映射更直观；README 作为跨平台目标清单的审计入口。

## macOS

- `arm64 -> aarch64-apple-darwin`
- `x64 -> x86_64-apple-darwin`
- `all ->` 顺序构建上述两个独立目标，不额外生成 universal bundle。
- 默认架构根据 `uname -m` 推导。
- 默认 bundle 为 `app,dmg`；`--bundle app|dmg|all` 映射为 Tauri `--bundles` 参数。
- 检查 `npm`、`cargo`、`rustup`、`xcrun`、`hdiutil`，以及请求 target 是否已安装。

## Windows

- `x64 -> x86_64-pc-windows-msvc`
- `arm64 -> aarch64-pc-windows-msvc`
- `all ->` 顺序构建上述两个独立目标。
- 默认架构根据进程/操作系统架构推导；未知值快速失败。
- 默认 bundle 为 `nsis,msi`；`-Bundle nsis|msi|all` 映射为 Tauri `--bundles` 参数。
- 可从普通 Windows PowerShell 启动；通过 `vswhere.exe` 选择一个同时包含全部请求组件的 Visual Studio 安装，避免 `all` 在两个不同安装间获得不一致工具链。
- 每个 target 构建前均从该安装调用官方 `Common7\Tools\Launch-VsDevShell.ps1 -HostArch amd64 -Arch amd64|arm64 -SkipAutomaticLocation`，把 `VSCMD_ARG_TGT_ARCH` 归一化后与请求的 `x64|arm64` 比较，再检查 `cl`、`link`、`rc`，确保 `all` 不复用调用脚本前或上一 target 的 MSVC 架构环境。
- 仅当 bundle 包含 `msi` 时要求管理员 PowerShell、查询 VBSCRIPT Windows capability 并检查 `cscript.exe`；缺少权限或功能时在依赖安装和真实构建前给出启用提示，纯 NSIS 构建不受影响。

## 安全和产物

- 第一版始终传递 `--ci --no-sign`，不探测或输出证书环境变量。
- 产物保留在 Tauri 默认忽略目录，不新增 artifact 复制目录或 `.gitignore` 规则。
- 脚本只列出对应 target 的 bundle 文件；Tauri 退出失败时直接传播非零状态。
- `tauri.conf.json` 继续负责内置模特资源与图标收集，脚本不复制资源。

## GitHub Actions

- 新增单一 workflow，通过 `strategy.matrix.include` 固定四个组合：
  - `macos-15` + `aarch64-apple-darwin` + `app,dmg`
  - `macos-15-intel` + `x86_64-apple-darwin` + `app,dmg`
  - `windows-latest` + `x86_64-pc-windows-msvc` + `nsis`
  - `windows-11-arm` + `aarch64-pc-windows-msvc` + `nsis`
- 每个 Job 使用原生 runner，固定 Node `22.22.0`、Rust `1.96.0`，安装对应 Rust target 和 `desktop/package-lock.json` 锁定的 npm 依赖，再由固定完整 commit SHA 的 `tauri-apps/tauri-action` 调用项目内 Tauri CLI。
- Windows hosted runner 只进入 NSIS 链路，不再执行依赖 WiX/VBScript 的 MSI 构建；本地 wrapper 仍保留 `-Bundle msi|all` 作为实验入口。
- CI 不调用本地 root wrapper：GitHub runner 已按矩阵提供对应宿主工具链，Tauri Action 可直接执行锁定后的项目 CLI；本地 wrapper 仍负责交互式环境中的逐 target 工具链初始化，二者保持相同 target 与未签名语义，但 bundle 范围有意区分稳定 CI 与本地实验能力。
- `uploadWorkflowArtifacts` 以 `unsigned`、平台、架构和 bundle 命名产物，避免四个 Job 互相覆盖或让未签名产物看似正式发布包。
- workflow 只设置 `permissions.contents: read`，checkout 禁止持久化凭据，Cargo 强制 `--locked`；不配置 `GITHUB_TOKEN` 写权限、release metadata 或签名 secret。
- 第一版以 `workflow_dispatch` 和 `v*` tag 触发构建；tag 触发只产生 Actions Artifacts，不等同于发布 Release。

## 兼容与回滚

- 不修改 Runtime Port、Rust API、数据库、Tauri 配置或依赖，删除 `build/` 新文件并回退 README/Makefile 文案即可完整回滚。
- `make package` 保持原有“当前宿主默认配置”语义；新脚本用于明确的 OS/架构打包。

## 验证边界

- 当前 macOS ARM64 环境缺少 `x86_64-apple-darwin` target 与 PowerShell/Windows，因此只执行脚本语法、帮助/失败路径、前端构建、Rust check 以及 Windows 脚本的结构断言。
- 四个目标的正式 bundle、安装、启动及架构检查必须分别在具备对应工具链的 macOS/Windows 环境补验，不能以静态检查替代。
- 2026-07-14 的真实 runner 证据确认两个 macOS Job 成功，Windows x64/ARM64 均完成应用和 NSIS 生成，但后续 MSI `light.exe` 失败并使 Job 整体失败。调整后的 NSIS-only Windows Job 仍需再次在线运行并下载 artifact 核验。Windows ARM64 runner 当前为 Public Preview，若仓库不可用需改用自托管 ARM64 runner，不能静默回退到 x64 产物。
