# Windows 自绘标题栏兼容设计

## Architecture

### Frontend platform boundary

新增一个小型、无 IO 的桌面平台识别函数，根据 WebView `navigator.userAgent` 归一化为 `windows`、`macos` 或 `other`。`StudioToolbar` 与 `AppShell` 只消费该结果选择现有样式，不引入 Provider、Runtime Port 或新的全局状态。

### Window configuration

保留 `tauri.conf.json` 作为 macOS 当前事实源。新增 `tauri.windows.conf.json`，完整覆盖 `app.windows` 主窗口项并设置 `decorations: false`。Windows 配置保留既有尺寸、最小尺寸、透明度和阴影，避免数组合并导致窗口字段丢失。

Windows `shadow: true` 会让 DWM 同时绘制系统阴影、圆角和激活边框，Tao 还会为该组合保留约 1-2px 的顶部非客户区。Tauri setup 在主窗口 HWND 已创建后，通过 target-specific `windows 0.61` 先调用 `DwmSetWindowAttribute(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE)` 抑制外围强调色边框，再将 `DWMWA_CAPTION_COLOR` 设为与当前白色标题栏一致的 `0x00FFFFFF`，避免保留区继续显示蓝线；不关闭阴影，也不接管 `WM_NCCALCSIZE`。该视觉增强失败时输出固定 warning 并继续启动，兼容不支持相关属性的旧 Windows。

### Interaction

复用现有 `PlatformWindowControls variant="windows"` 和权限：

- 最小化：`getCurrentWindow().minimize()`
- 最大化/还原：`getCurrentWindow().toggleMaximize()`
- 最大化状态：首次渲染、`onResized` 监听注册完成和每次 resize 后调用 `getCurrentWindow().isMaximized()`，避免监听建立前的状态变化丢失；普通状态显示 `Square`/“Windows 最大化窗口”，最大化状态显示 `Copy`/“Windows 还原窗口”。仅 Windows 分支注册监听，卸载时调用 unlisten；capability 增加只读 `core:window:allow-is-maximized`。
- 关闭：`getCurrentWindow().close()`
- 标题栏拖动：现有 `startDragging()`
- 双击标题栏：现有 `toggleMaximize()`

## Compatibility

- macOS：未命中 Windows 分支，保持现有 52px、92px 交通灯预留和原生交通灯。
- Windows：使用 44px、12px 左间距、紧凑操作区和自绘窗口按钮；应用内层不设置圆角和白色边框，由 Windows 11 系统窗口负责外框圆角与裁切，避免关闭按钮悬停背景和外框之间出现白色空隙。
- Windows 11：保留 DWM 系统阴影和圆角，通过 `DWMWA_COLOR_NONE` 禁止绘制蓝色/强调色外框，并把 Tao 顶部非客户区设为标题栏白色。
- 旧 Windows：DWM 属性不受支持时保留系统默认边框并继续启动。
- 测试/JSDOM/未知平台：回落到当前 macOS/默认布局，避免测试环境误显示 Windows chrome；组件测试显式注入平台覆盖 Windows 分支。

## Trade-offs

- HTML 最大化按钮不提供原生 Windows 11 悬停 Snap Layout；本任务不引入 Win32 hit-test。
- 使用 user agent 是桌面壳展示层的最小方案，避免新增 `plugin-os` 依赖或扩大 RuntimeInfo 公共协议。
- 不采用 `shadow: false`，因为它会同时移除系统阴影并使圆角行为不稳定；不手写 Win32 FFI，使用已授权的 target-specific `windows` 依赖获得类型安全的 HWND 和 DWM 调用。

## Rollback

删除 Windows 专属配置与平台识别分支即可恢复现状；不涉及数据迁移或持久化格式。
