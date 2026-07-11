# 移动端管理界面优化设计文档

## 概述

优化 LineWeb 管理后台在移动端（<768px）的使用体验。核心改动是将移动端导航从汉堡菜单侧边栏改为底部标签栏，并全面优化表格、表单、弹窗在小屏上的布局和触控交互。

**排除范围**：PageEditor（拖拽式可视化编辑器，746 行）不在本次优化范围内。

## 当前问题

1. **侧边栏 CSS 缺失**：`AdminLayout.tsx` 实现了完整的移动端侧边栏 JS 逻辑（切换、遮罩、锁定滚动、点击外部关闭），但 CSS 层缺失以下媒体查询：
   - `.admin-topbar-toggle` 汉堡按钮被 `display: none` 隐藏，无媒体查询显示
   - `.admin-sidebar--open` 类在 JSX 中使用但无对应 CSS 规则
   - `.admin-layout-overlay` 被 `display: none` 隐藏，无媒体查询显示
   - `.admin-sidebar` 无 `transform: translateX(-100%)` 移动端默认定位
   - `.admin-main` 无 `margin-left: 0` 移动端覆盖

2. **表格布局**：已有 580px 断点的卡片布局，但操作按钮溢出、状态标签不清晰、分页触控区域偏小

3. **表单体验**：标签和输入框横向排列在小屏上挤压，弹窗尺寸不适配移动端

## 设计方案

### 方案选择：底部标签栏 + 侧边栏混合

- 移动端（<768px）：底部 3 个固定 Tab + "更多"半屏弹窗
- 桌面端（≥768px）：保持现有侧边栏不变
- 使用 CSS 媒体查询控制显示/隐藏，非 JS 监听

### 1. 导航架构

#### 底部标签栏（移动端 <768px）

固定在屏幕底部，3 个 Tab：

| Tab | 路由 | 图标 |
|-----|------|------|
| 文章 | `/admin` | 文档图标 |
| 评论 | `/admin/comments` | 评论图标 |
| 更多 | 弹出菜单 | 菜单图标 |

- 标签栏高度：56px
- 安全区域适配：`padding-bottom: env(safe-area-inset-bottom)`
- 触控目标：每个 Tab 最小 44px
- 视觉风格：Liquid Glass 毛玻璃背景（`backdrop-filter: blur`），与主站导航一致
- 活跃 Tab 高亮：主题色图标 + 文字

#### "更多"弹出菜单

- 从底部滑出的半屏弹窗（约 60% 屏幕高度）
- Liquid Glass 毛玻璃背景
- 包含：写文章、页面管理、用户管理、API 密钥、设备监控
- 每项为可点击列表项，带图标，点击后跳转并关闭弹窗
- 点击弹窗外部区域关闭

#### 桌面端（≥768px）

- 侧边栏保持不变
- 底部标签栏 `display: none`
- 现有的汉堡按钮折叠逻辑保留

### 2. AdminLayout 组件改造

#### 组件结构

```
AdminLayout
├── AdminTopbar（顶部栏，保留标题）
├── AdminSidebar（桌面端侧边栏，≥768px 显示）
├── AdminBottomTabBar（移动端底部标签栏，<768px 显示）
├── AdminMoreMenu（"更多"弹出菜单，半屏弹窗）
└── children（页面内容）
```

#### 实现策略

- **CSS 媒体查询**控制导航模式切换，避免 JS 监听导致的闪烁
- `.admin-sidebar` 在 `<768px` 时 `display: none`
- `.admin-bottom-tab-bar` 在 `≥768px` 时 `display: none`
- 现有 `mobileOpen` 状态和汉堡按钮逻辑保留，但仅在桌面端折叠模式下生效
- 新增组件文件：`client/src/components/admin/AdminMobileNav.tsx`

#### CSS 架构

新增样式写入 `client/src/styles/globals.css`，遵循现有命名规范：
- `.admin-bottom-tab-bar` — 底部标签栏容器
- `.admin-tab-item` — 单个 Tab 项
- `.admin-tab-item--active` — 活跃状态
- `.admin-more-menu` — 更多菜单弹窗
- `.admin-more-menu-overlay` — 弹窗遮罩

### 3. 表格/列表移动端优化

#### 表格卡片布局增强（580px 断点）

现有 `.admin-table` 卡片布局的改进：
- 卡片标题加粗，元信息弱化颜色
- 操作按钮改为纵向全宽排列，避免挤压
- 状态标签（已发布/草稿）使用 pill 样式（圆角胶囊），更醒目
- 卡片之间间距统一为 12px

#### 分页组件

- 按钮最小 44px 触控区域
- 移动端简化为：上一页 / 当前页码 / 下一页
- 页码文字更大（≥16px）

#### 空状态

- 移动端居中显示
- 图标 + 文字 + 按钮纵向排列

### 4. 表单/弹窗移动端优化

#### 表单布局

- 标签和输入框改为纵向堆叠（标签在上，输入框在下）
- 输入框高度 ≥ 44px，字号 ≥ 16px（防止 iOS 自动缩放）
- 下拉选择器在移动端使用原生 `<select>` 样式

#### 弹窗/模态框

- 移动端改为全屏或近全屏（留 16px 边距）
- 关闭按钮固定在顶部，内容区可滚动
- 删除确认弹窗保持居中，按钮改为纵向排列

#### 编辑器页面（EditorPage）

- 标题输入框全宽
- Slug 输入框在标题下方
- Lexical 编辑器工具栏在移动端简化：保留加粗、斜体、链接、代码，隐藏其他
- 保存/发布按钮固定在底部

#### Toast 通知

- 移动端从顶部滑入，避免被底部标签栏遮挡

### 5. 断点统一

| 断点 | 用途 |
|------|------|
| `768px` | 移动端导航切换（底部标签栏 ↔ 侧边栏） |
| `580px` | 表格卡片布局 |
| `(hover: none) and (pointer: coarse)` | 触控目标增强 |

### 6. 优化范围

| 页面 | 主要优化点 |
|------|-----------|
| AdminPage（文章列表） | 卡片布局、操作按钮纵向、分页简化 |
| EditorPage（写文章） | 表单纵向堆叠、工具栏简化、底部固定按钮 |
| CommentAdminPage（评论） | 卡片布局、评论回复表单优化 |
| PageList（页面列表） | 卡片布局、操作按钮 |
| UserAdminPage（用户） | 卡片布局、表单纵向堆叠 |
| ApiAdminPage（API密钥） | 卡片布局、密钥显示/复制优化 |
| DeviceMonitorPage（设备） | 统计卡片响应式、表格卡片布局 |

**排除**：PageEditor（拖拽式编辑器）

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `client/src/components/AdminLayout.tsx` | 修改 | 集成底部标签栏，调整移动端逻辑 |
| `client/src/components/admin/AdminMobileNav.tsx` | 新建 | 底部标签栏 + 更多菜单组件 |
| `client/src/styles/globals.css` | 修改 | 新增底部标签栏、更多菜单、表格增强等样式 |
| `client/src/pages/AdminPage.tsx` | 修改 | 卡片布局优化、分页简化 |
| `client/src/pages/EditorPage.tsx` | 修改 | 表单纵向堆叠、工具栏简化、底部固定按钮 |
| `client/src/pages/admin/CommentAdminPage.tsx` | 修改 | 卡片布局优化 |
| `client/src/pages/admin/PageList.tsx` | 修改 | 卡片布局优化 |
| `client/src/pages/admin/UserAdminPage.tsx` | 修改 | 卡片布局、表单纵向堆叠 |
| `client/src/pages/admin/ApiAdminPage.tsx` | 修改 | 卡片布局、密钥显示优化 |
| `client/src/pages/admin/DeviceMonitorPage.tsx` | 修改 | 统计卡片响应式、表格卡片布局 |

## 设计约束

- CSS 媒体查询驱动，非 JS 监听，避免布局闪烁
- 遵循现有 Liquid Glass 设计系统，不引入新依赖
- 所有触控目标 ≥ 44px
- 输入框字号 ≥ 16px（防止 iOS 自动缩放）
- 不影响桌面端现有体验
