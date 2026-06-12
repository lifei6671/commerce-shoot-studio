# commerce-shoot-studio
商拍工坊是一个面向电商服装商拍的本地 AI 生成工作台。通过人物图、多角度服装图、Prompt 配置和第三方生图模型，快速生成电商模特图、商品展示图和营销素材。

## 仓库结构

本仓库按阶段拆分为两个独立项目：

```text
commerce-shoot-studio/
├── desktop/          # 第一期：Tauri 2 + React + TypeScript 桌面端
├── license-server/   # 第二期：Go + Gin + PostgreSQL 授权后端
└── docs/             # 方案、任务清单和验收文档
```

第一期只开发 `desktop/`。`license-server/` 仅作为第二期授权、设备激活、套餐功能开关和支付 webhook 的代码目录保留。
