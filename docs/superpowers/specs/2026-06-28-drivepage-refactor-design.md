# DrivePage 重构设计文档

> **设计目标：** 将网盘前端页面重构为符合 Apple Liquid Glass 设计语言的简洁、易用的文件管理器，支持列表/网格双视图。

**范围：** 纯前端重构。后端 API 不修改。所有功能（上传、下载、预览、重命名、删除、搜索、文件夹导航）保留。

---

## 架构

组件拆分：将当前 703 行的单文件 DrivePage 拆分为 `components/drive/` 文件夹下的专注组件，遵循项目中 `comments/` 的组织模式。

DrivePage 保留所有状态管理（状态父组件），子组件为无状态展示组件，通过 props 接收数据和回调。

**组件树：**

```
DrivePage (pages/DrivePage.tsx) — 状态管理中心
├── DriveToolbar — 标题行 + 搜索 + 视图切换 + 面包屑
├── DriveListView — 列表视图（精简三列）
├── DriveGridView — 网格卡片视图
├── UploadZone — 拖拽/选择上传区域
├── DriveDialogs — 弹窗集合（新建文件夹/重命名/确认删除）
└── DrivePreview — 图片/视频预览 Lightbox
```

**数据流：**
- DrivePage 管理：`items`, `loading`, `error`, `viewMode`, `searchQuery`, `searchResults`, `breadcrumbs`, 各弹窗状态
- 子组件通过 props 接收数据，通过回调（`onPreview`, `onDownload`, `onRename`, `onDelete`, `onNavigate` 等）通知 DrivePage

---

## 文件清单

| 文件 | 类型 | 职责 |
|------|------|------|
| `pages/DrivePage.tsx` | 修改 | 精简为主状态容器，导入子组件 |
| `components/drive/DriveToolbar.tsx` | 新建 | 标题 + 搜索 + 视图切换 + 面包屑导航 |
| `components/drive/DriveListView.tsx` | 新建 | 表格列表视图（名称/大小/日期） |
| `components/drive/DriveGridView.tsx` | 新建 | 网格卡片视图 |
| `components/drive/UploadZone.tsx` | 新建 | 上传拖拽区域 |
| `components/drive/DriveDialogs.tsx` | 新建 | 新建文件夹/重命名/删除对话框 |
| `components/drive/DrivePreview.tsx` | 新建 | 图片/视频预览 Lightbox |
| `styles/globals.css` | 修改 | 清理旧 drive-* 类，添加新的 CSS |

---

## UI 详细设计

### 通用设计语言
- 所有容器使用 `LiquidGlass` 组件（variant 视角色而定）
- 按钮使用 `LiquidButton`（variant: `primary` / `glass` / `ghost` / `danger`）
- 输入框使用 `lg-input` 类
- 全部 CSS 写入 `globals.css`，零 inline style
- 深色/亮色主题跟随系统 CSS 变量

### DriveToolbar
- 整体使用 `LiquidGlass variant="blur"` 包裹
- 布局：两行
  - 第一行：左「☁ 网盘」标题 + 右「📁 新建文件夹」「⬆ 上传文件」按钮
  - 第二行：左搜索框 + 右「☰ 列表」「▦ 网格」视图切换按钮
  - 第三行：面包屑导航，可点击 hover 变 accent
- 视图切换：两个胶囊图标按钮，选中态高亮 accent

### DriveListView
- 三列：「名称」「大小」「修改时间」（类型通过文件图标体现）
- 每行高度 52px，`border-bottom` 分隔，悬停轻微高亮
- 文件名：文件夹可点击（导航），文件点击触发重命名
- **桌面**：操作按钮（预览/下载/删除）悬停出现，渐入动画
- **移动**：操作按钮始终显示
- 行动画：`fadeIn` 逐行错开 0.04s

### DriveGridView
- 自适应网格：`grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`
- 每个卡片：`LiquidGlass variant="strong"`，圆角 14px，间距 14px
- 卡片内容：文件图标（大号 emoji）/ 图片缩略图 + 文件名 + 大小 + 日期
- 文件夹双击进入，文件单击预览/下载
- 桌面 hover 显示操作按钮，移动端始终显示

### UploadZone
- 默认为一个「⬆ 上传文件」按钮（`LiquidButton variant="primary"`）
- 点击后展开为拖拽上传区域 + 选择文件按钮
- 拖拽区域有虚线边框，拖入时高亮（accent 边框 + 背景微光）
- 上传进度条显示当前文件进度
- 支持多文件上传，单个文件最大 500MB

### DriveDialogs
- 三个弹窗：新建文件夹、重命名、确认删除
- 统一使用 `LiquidGlass variant="strong" chromatic={false}`
- `dialog-overlay` 遮罩背景半透明，点击关闭
- 最大宽度 400px，padding 28px，居中
- 输入框用 `lg-input`，按钮用 `LiquidButton`

### DrivePreview
- 图片预览：全屏暗色遮罩（`rgba(0,0,0,0.85)`），图片居中有圆角
- 视频预览：同样遮罩，HTML5 `<video>` 播放器
- 右上角关闭按钮 ✕
- 点击遮罩区域关闭

### 空状态 / 加载 / 错误
- 空状态：`LiquidGlass variant="blur"` 卡片，☁️ 图标 + 提示文案
- 加载：居中 spinner
- 错误：`LiquidGlass variant="blur"` 卡片 + 错误信息 + 重试按钮

---

## 移动端适配

- 视窗 <768px：
  - 网格卡片列数改为 `repeat(2, 1fr)`
  - 列表行操作按钮始终显示
  - 搜索框宽度 100%
  - 圆角保持，边距微调
  - 标题行和操作按钮改为垂直堆叠

---

## API 接口

本重构不修改任何后端 API。DrivePage 使用的接口与当前一致：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/drive/files?parentId=X` | 列出文件 |
| GET | `/drive/search?q=X` | 搜索文件 |
| POST | `/drive/folders` | 创建文件夹 |
| POST | `/drive/upload` | 上传文件 |
| GET | `/drive/download/:id` | 下载/预览文件 |
| PUT | `/drive/files/:id` | 重命名 |
| DELETE | `/drive/files/:id` | 删除 |

---

## 排除范围

- 不修改后端路由/API
- 不修改数据库模型
- 不修改认证/权限逻辑
- 不引入新 npm 依赖
- 不做虚拟滚动（数据量通常在百级以下）
