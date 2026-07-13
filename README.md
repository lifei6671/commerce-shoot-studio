# commerce-shoot-studio

商拍工坊是一个面向电商服装商拍的本地 AI 生成工作台。通过人物图、多角度服装图、Prompt 配置和第三方生图模型，快速生成电商模特图、商品展示图和营销素材。

## 桌面端打包

仓库提供宿主原生的 macOS 与 Windows 双架构打包脚本。默认构建当前宿主架构并执行
`npm ci --prefix desktop`；传入 `all` 时会依次生成两个独立架构的产物。

```bash
# macOS：arm64 / x64，默认生成 app 和 dmg
build/package-macos.sh --arch arm64 --bundle all
```

```powershell
# Windows：x64 / arm64，默认生成 NSIS 和 MSI
.\build\package-windows.ps1 -Arch x64 -Bundle all
```

使用 `--skip-install`（macOS）或 `-SkipInstall`（Windows）可复用已安装的前端依赖。
Windows 的 MSI 或默认 `all` 打包需要管理员 PowerShell 完成 VBSCRIPT capability
预检；只生成 NSIS 可使用普通 PowerShell。
第一版产物未签名，也未完成四种目标架构的真机验收。完整参数、工具链要求、产物目录和
验证边界见 [build/README.md](build/README.md)。原有 `make package` 仍保持当前宿主的
Tauri 默认打包行为。

GitHub Actions 的 [桌面安装包 workflow](.github/workflows/package-desktop.yml) 支持
手动触发和 `v*` tag 触发，在四个独立 runner 上构建未签名的 workflow artifacts。
tag 触发只上传 Actions Artifacts，不创建或更新 GitHub Release。该 workflow 尚未完成
在线运行验证，Windows ARM64 runner 仍处于 Public Preview；具体矩阵和下载方式见
[打包说明](build/README.md#github-actions)。
