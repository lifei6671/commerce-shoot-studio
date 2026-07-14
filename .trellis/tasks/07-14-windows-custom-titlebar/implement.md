# Windows 自绘标题栏实施计划

1. 新增桌面平台识别函数及单元测试。
2. 先补充 Windows/macOS 顶栏布局失败测试，覆盖高度、左间距、控制按钮和 AppShell 分隔线。
3. 将 `StudioToolbar` 与 `AppShell` 的无效 platform media 变体替换为显式平台分支，保持现有视觉值不变。
4. 新增 `tauri.windows.conf.json`，关闭 Windows decorations 并完整保留主窗口字段。
5. 运行相关 Vitest、完整前端测试、`npm run build` 与 Cargo/Tauri 配置检查。
6. 自 review 拖动命中区、按钮事件隔离、Windows 缩放/阴影、macOS 回归与未提交文件隔离。
7. 增加 target-specific `windows 0.61` DWM 依赖，在 Tauri setup 中抑制 Windows 11 系统边框，并将 Tao 保留的顶部非客户区设为标题栏白色；不支持时 warning 后继续启动。
8. 运行 Rust 格式化、检查、测试和 Windows Release 构建，并人工验证聚焦/失焦、阴影、圆角和最大化/还原。
9. 监听 Windows 窗口 resize 后读取真实最大化状态，切换最大化/还原图标和可访问名称；补充只读 `isMaximized` capability 与组件测试。

## Risky Files

- `desktop/src-tauri/tauri.windows.conf.json`：平台配置覆盖数组必须包含完整主窗口字段。
- `desktop/src-tauri/src/services/desktop_runtime.rs`：DWM 调用必须限制在 Windows，unsafe 边界保持最小，失败不得阻断旧系统启动。
- `desktop/src-tauri/Cargo.toml`：仅增加 Windows target-specific 依赖，锁文件必须由 Cargo 自动维护。
- `desktop/src/app/components/StudioToolbar.tsx`：不得改变 macOS 视觉值或按钮业务布局。
- `desktop/src/app/components/AppShell.tsx`：分隔线 top 必须与平台顶栏高度一致。

## Validation

```powershell
npm.cmd --prefix desktop run test -- StudioToolbar platform-window-controls
npm.cmd --prefix desktop run test
npm.cmd --prefix desktop run build
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Windows 真机启动后人工检查：无左侧空白、右侧三枚窗口按钮可用、空白区可拖动、双击最大化、窗口边缘可缩放、最大化后显示还原图标、还原后恢复最大化图标，且布局正常。
