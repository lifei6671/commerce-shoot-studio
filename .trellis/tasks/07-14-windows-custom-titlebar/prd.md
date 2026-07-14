# Windows 自绘标题栏兼容

## Goal

让 Windows 11 使用与应用视觉一致的自绘顶部标题栏，移除仅为 macOS 原生交通灯预留的左侧空白，同时保持 macOS 当前原生交通灯与 Overlay 顶栏效果不变。

## Background

- `desktop/src/app/components/StudioToolbar.tsx:53-104` 已包含 Windows 顶栏尺寸、间距和自绘窗口按钮，但依赖 WebView2 不支持的 `@media(platform:windows)`，因此 Windows 样式未生效。
- `desktop/src-tauri/tauri.conf.json:21-29` 的 `titleBarStyle`、`hiddenTitle`、`trafficLightPosition` 属于 macOS 标题栏能力，不能直接让 Windows 获得同样的 Overlay 效果。
- 用户已确认采用 Windows 完整自绘标题栏方案；本阶段不实现 Win32 `WM_NCHITTEST` Snap Layout 悬停菜单。

## Requirements

- Windows 11 必须隐藏原生标题栏并显示现有的最小化、最大化和关闭按钮。
- Windows 品牌标题左侧不得保留 macOS 交通灯的 92px 占位；使用现有 Windows 设计意图中的紧凑间距和 44px 顶栏高度。
- Windows 顶栏空白区域必须支持拖动窗口，双击必须切换最大化，交互控件不得触发拖动或双击最大化。
- Windows 外框圆角由系统窗口负责，应用内层不得再使用 22px 圆角和白色边框裁切关闭按钮；关闭按钮悬停背景必须贴合右上外框。
- Windows 11 聚焦和失焦时不得绘制 DWM 蓝色/强调色边框，同时必须保留系统阴影和圆角。
- macOS 必须继续使用 `decorations: true`、Overlay 标题栏和原生交通灯位置；不得重绘或移动 macOS 交通灯。
- 平台判断必须使用 WebView 可执行的明确逻辑，不再依赖非标准 CSS media feature。
- 仅允许新增用户于 2026-07-14 明确授权的 Windows target-specific `windows 0.61` DWM 依赖；不修改 Public Runtime Port、DTO、数据库、权限或现有业务功能。
- 保留工作区中用户/工具已产生的无关改动，不覆盖 `Cargo.toml`、生成 schema 或其它未提交内容。

## Acceptance Criteria

- [ ] Windows 专属 Tauri 配置将主窗口设为无原生 decorations，并保留窗口尺寸、最小尺寸、阴影和透明度口径。
- [ ] Windows 顶栏高度为 44px，品牌区左侧使用 12px 间距，右侧显示三枚 Windows 窗口控制按钮。
- [ ] Windows 关闭按钮悬停背景与右上系统外框贴合，不出现由应用内层圆角或边框产生的白色空隙。
- [ ] Windows 11 使用 `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` 抑制系统强调色外框，并将 Tao 为阴影保留的顶部非客户区 `DWMWA_CAPTION_COLOR` 设为标题栏白色；继续保留 `shadow: true`、系统阴影和圆角。
- [ ] 不支持该 DWM 属性的 Windows 环境输出固定 warning 并继续启动，不因纯视觉兼容失败阻断主界面。
- [ ] macOS 顶栏仍为 52px，品牌区仍为原生交通灯保留 92px，且 Windows 自绘按钮不可见。
- [ ] AppShell 分隔线顶部与各平台实际顶栏高度一致。
- [ ] Windows 控制按钮分别调用 `minimize`、`toggleMaximize`、`close`；最大化按钮根据真实窗口状态切换“最大化”单方框与“还原”双方框，拖动和双击最大化行为测试通过。
- [ ] 前端相关 Vitest、前端构建和 Tauri 配置/编译检查通过；若 Windows 真机视觉验证受运行环境限制，明确记录剩余人工验收项。

## Out of Scope

- Windows 11 原生最大化按钮悬停 Snap Layout 菜单。
- 改动现有按钮视觉 token、色彩、阴影或业务布局；用户明确要求的 Windows 外框圆角修正除外。
- macOS 标题栏重新设计。

## Notes

- 用户于 2026-07-14 明确允许初始化 Trellis/CodeGraph，并确认推荐的 Windows 完整自绘方案。
- 用户于 2026-07-14 明确允许增加 Windows 专属 `windows 0.61` 依赖，通过 DWM API 消除蓝色激活边框。
