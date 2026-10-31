# LineWeb 设计系统（Apple 视觉语言）

> 本文件描述 2026-11 视觉重构后的设计口径。命名空间 `.gh-*` / `--gh-*` 是历史遗留
> （来自最初的 GitHub Primer 版本），**现在只作为命名空间使用**，取值与语义已全部切换为
> Apple 体系。批量改名会破坏测试（如 `TreeView.test.tsx` 直接断言
> `.gh-drive-tree-node-label`），因此不要改名。

## 1. 三层语言

| 层 | 参考 | 具体表现 |
| --- | --- | --- |
| 外壳 | macOS Sonoma | 56px 毛玻璃顶栏、半透明源列表侧栏、圆角选中填充、发丝分隔线 |
| 组件 | iOS 17 | 分段控件、填充输入框、胶囊按钮、inset grouped 列表、22px 圆角 sheet、系统色 |
| 内容 | apple.com | 超大标题 + 收紧字距、留白节奏、便当式卡片、极少的边框 |

## 2. 令牌（`client/src/styles/variables.css`）

### 2.1 色彩

| 语义 | 令牌 | Light | Dark |
| --- | --- | --- | --- |
| 页面画布 | `--gh-bg` | `#f5f5f7` | `#000000` |
| 卡片 / 面板 | `--gh-canvas` | `#ffffff` | `#1c1c1e` |
| 卡片浅层 | `--gh-canvas-subtle` | `#fbfbfd` | `#232325` |
| 凹槽 / 轨道 | `--gh-canvas-inset` | `rgba(120,120,128,.08)` | `rgba(118,118,128,.24)` |
| 悬停 / 输入 | `--gh-fill-2` | `rgba(120,120,128,.12)` | `rgba(118,118,128,.32)` |
| 按下 | `--gh-fill-3` | `rgba(118,118,128,.20)` | `rgba(118,118,128,.40)` |
| 发丝线 | `--gh-border` | `rgba(60,60,67,.10)` | `rgba(255,255,255,.10)` |
| 主文本 | `--gh-text` | `#1d1d1f` | `#f5f5f7` |
| 次文本 | `--gh-text-secondary` | `#515154` | `#a1a1a6` |
| 三级文本 | `--gh-text-tertiary` | `#6e6e73` | `#8e8e93` |
| 链接 / 强调 | `--gh-accent` | `#0066cc` | `#0a84ff` |
| 实心按钮底 | `--gh-accent-button` | `#0066cc` | `#0b64c9` |
| 成功 / 危险 / 警告 | `--gh-success` / `--gh-danger` / `--gh-warning` | `#1d7c3d` / `#d70015` / `#8a5300` | `#30d158` / `#ff453a` / `#ffd60a` |

- 白字只能放在 `--gh-accent-button` 上（暗色下 `--gh-accent` 与白字对比度不足）；
  链接与装饰仍用 `--gh-accent`。
- 材质：`--gh-material-chrome`、`--gh-material-sidebar`、`--gh-blur-chrome`；
  `@supports not (backdrop-filter)` 与 `prefers-reduced-transparency` 会自动回退为不透明表面。
- 对比度由 `node scripts/check-design-tokens.cjs` 守护（正文 ≥ 4.5:1）。

### 2.2 字体与字阶

- 栈：`SF Pro → -apple-system → Inter Variable（自托管，latin 48KB）→ PingFang / 微软雅黑`。
  Apple 设备命中 SF Pro；其它平台命中 Inter；CJK 始终系统字体。
- 字阶：display（40–56px）/ title-1 34 / title-2 28 / title-3 22 / headline 17 / body 17 /
  subhead 15 / footnote 13 / caption 12。大标题 `letter-spacing` 收紧到 -0.022 ~ -0.03em。
- 正文行高 1.6–1.8；中文正文不做负字距。

### 2.3 形状、层级、动效

- 圆角：控件 10–12、卡片 16、模态 / 抽屉 / hero 22、胶囊 999。
- 层级靠「表面 + 填充 + 发丝线」，不用 1px 实边框包住一切；卡片阴影
  `--gh-shadow-card`，弹层 `--gh-shadow-lg/xl`。
- 动效：120ms 微反馈 / 220ms 常用 / 320ms 面板；`--gh-ease-standard`、`--gh-ease-out`；
  全局 `prefers-reduced-motion` 关闭动画。
- 滚动条：透明轨道 + 半透明滑块；骨架屏改用 1.6s 低频脉冲。

## 3. 组件（`components.css` + `components/ui/`）

| 组件 | 类 / 导出 | 规格 |
| --- | --- | --- |
| 按钮 | `.gh-btn` / `Button` | 胶囊；primary 填充、secondary 灰底、ghost 文字、danger 红淡底；sm 30 / md 36 / lg 46 |
| 输入 | `.gh-input` / `Input` | 填充式、10px 圆角、无边框、focus 4px 蓝环 |
| 徽章 | `.gh-badge` / `Badge` | 胶囊淡底，success / danger / warning / accent |
| 提示 | `.gh-alert` / `Alert` | 淡底 + 标题，不再使用 4px 左色条 |
| 分段控件 | `.gh-tabnav` / `SegmentedControl` | 填充轨道 + 白色滑块（替代下划线 Tab） |
| 卡片 | `.gh-box` | 16px 圆角 + 发丝线 + `--gh-shadow-card` |
| 列表行 | `.gh-list-item` | 内缩发丝线、hover 填充、44–56px |
| 弹层 | `.gh-popover` | 14px 圆角 + 毛玻璃 + 大阴影 |
| 对话框 | `.gh-dialog` | 22px 圆角；≤767px 自动变底部 sheet（带抓手） |
| 表格 | `.gh-table` / `.gh-table-wrap` | 卡片内表格、表头浅层、行 hover |
| 分页 | `.gh-pagination` | 胶囊按钮，激活用 `--gh-accent-button` |
| 正文字体 | `.article-content` | 17px/1.8，代码块 16px 圆角 |

交互与可访问性：所有可交互元素有 focus-visible 环；移动端触控目标 ≥44px；
`forced-colors` 下补实色边框；模态需要 `role="dialog"` + `aria-modal` + Esc 关闭。

## 4. 布局模式

- **外壳**：`layout.css` — 固定毛玻璃顶栏、`fixed` 源列表侧栏、`.gh-content` 偏移；
  ≥1280 常驻侧栏，≤1279 整高抽屉（右侧 20px 圆角 + 遮罩）。
- **认证页**：`Layout` 在 `/login`、`/register` 加 `gh-layout-root--auth`，隐藏侧栏/页脚，
  渐变背景 + 居中 420px 卡片。
- **首页**：`.gh-home` — 行 1 为 hero（纸页叠层 + 折线签名）+ 最新文章；行 2 为文章流 +
  快捷入口，右侧 340px 侧栏（身份 / 站点数据 / 数字健康 / 推荐功能）。
- **个人资料**：`.gh-profile` — 300px 身份 + 积分 + 称号，右侧分组设置
  （`.gh-settings-group` + `.gh-settings-list`）+ 分段控件。
- **管理端**：`AdminLayout` 顶栏 `.gh-admin-toolbar`（吸顶毛玻璃卡 + 22px 标题）；
  表格在 `.gh-table-wrap` 内横向滚动；功能开关为 iOS 51×28 开关。
- **网盘**：Finder 口径 — 工具栏（面包屑 / 视图分段 / 胶囊操作）、232px 源列表、
  白色文件卡（44px 行）、右侧检查器、移动端 sheet。
- **聊天**：iMessage 口径 — 300px 会话列表 + 会话区；气泡 18px 圆角、自己的为蓝底白字、
  对方为填充灰；日期分隔 11px；输入区毛玻璃 + 胶囊输入框。
- **游戏**：大厅便当卡（精选跨列 + 网格卡 + 即将上线占位）；单机/联机页统一外壳，
  **牌面 / 棋盘 / 3D 场景保留自身美术**（设计决策，非遗漏）。

## 5. 签名元素

全站只保留一个「张扬」点：**首页 hero 的纸页叠层 + 折线画入**（`--gh-accent` 18% 透明度，
700ms `stroke-dashoffset`，`prefers-reduced-motion` 下直接显示）。其余页面靠留白、字阶和
表面层级取胜，不再叠加装饰动画。

## 6. 目录与覆盖层说明

```
styles/
├── variables.css    令牌（唯一色彩/字阶来源）
├── base.css         reset、标题阶、focus、滚动条、骨架
├── components.css   共享组件
├── layout.css       外壳 / 抽屉 / 认证布局 / 页脚
├── pages.css        首页、文章、资料、计算器、编辑器等页面级样式
├── utilities.css    .u-* 工具类（替代静态内联样式）
├── apple-chrome.css 尚未就地重写的模块（积分/宠物/农场/股市/反代/AI/管理端密度）覆盖层
├── drive.css / chat*.css / games.css / 各游戏 CSS / 其它模块 CSS
└── responsive.css   断点、sheet、44px 触控、打印
```

`apple-chrome.css` 是**过渡层**：只覆盖外壳与控件，不覆盖游戏美术。把某个模块就地重写后，
请删除这里的对应覆盖块，避免双份选择器长期堆积。

## 7. 新增样式规范

1. 颜色/间距/圆角/阴影/动效一律用令牌，禁止写死 hex（游戏美术文件除外）。
2. 控件优先用 `.gh-btn` / `.gh-input` / `.gh-badge` / `.gh-box`，不要新造按钮变体。
3. 静态间距内联样式改用 `.u-*`（`.u-stack`、`.u-row`、`.u-gap-2`、`.u-mt-3`…）。
4. 新模态用 `.gh-dialog-overlay > .gh-dialog`；移动端自动成为 sheet。
5. 小节标题不要 `text-transform: uppercase`；用 12–13px / 600 的次级文本。
6. 列表分组用内缩发丝线（`.gh-list-item::after` 或 `.gh-settings-row::before`），不要整行描边。
7. 游戏美术文件（doudizhu/snake/minesweeper/jump/minecraft/gomoku/liar/uno/xiangqi/parkour/farm）
   可以保留自身配色，但新增的 UI chrome 仍应走令牌。

## 8. 验收

```bash
cd client && npx tsc --noEmit
cd client && npm run build
cd client && npx vitest run
node scripts/check-design-tokens.cjs          # 对比度 / 旧色板 / 大写标题
npm run dev                                   # 另开：server 3001 + client 5173
node scripts/screenshot-design-audit.cjs --tag review   # 32 路由 × 3 视口 × 明暗
```

截图产物在 `test-screenshots/design/<tag>/<theme>/<width>/`，`report.json` 汇总水平溢出与
console 错误。审计脚本通过 `channel: 'chrome'` 复用本机 Chrome，无需下载 Playwright 浏览器。
