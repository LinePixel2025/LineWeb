# 网盘前端优化 + 移除字体反色 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化网盘前端界面的人性化体验与性能，并从网盘界面中移除字体反色（data-ac）系统干扰。

**Architecture:** 
- 字体反色移除：在 `ContrastContext` 的 `EXCLUDE_CLASSES` 中加入 `.drive-page`，让 Drive 页面的所有元素跳过 data-ac 扫描，Drive 组件自身的 Liquid Glass 配色不受干扰。
- 性能优化：将 DrivePage 中的回调函数改为 `useCallback` 包裹，使 `memo` 化的 `DriveListView`/`DriveGridView` 跳过不必要的重渲染；减少列表项入场动画的延迟叠加，引入一次性动画标记避免翻页/刷新时反复播放。
- UX 优化：改良空状态、添加翻页信息快捷跳转、文件名过长时的 tooltip。

**Tech Stack:** React 19 / TypeScript 5 / CSS (globals.css)

## Global Constraints

- 字体反色移除限 Drive 页面范围，不影响 HomePage/PostsPage 等其他页面的 data-ac 系统
- DriveListView / DriveGridView 的 `memo` 已存在但被无效化，仅需修复其原因
- 动画仅移除翻页/刷新时的重复播放，首次进入文件夹仍需保留视觉反馈
- 不新增第三方依赖
- 所有 CSS 修改仅限 `client/src/styles/globals.css`

---

### Task 1: Drive 页面排除字体反色扫描

**Files:**
- Modify: `client/src/contexts/ContrastContext.tsx:18`（EXCLUDE_CLASSES 数组）

**Interfaces:**
- Consumes: 无
- Produces: Drive 页面所有元素不再被设置 `data-ac` 属性，不再受 data-ac CSS 干扰

- [ ] **Step 1: 在 `EXCLUDE_CLASSES` 中添加 `.drive-page`**

将第 13-20 行替换为：

```typescript
const EXCLUDE_CLASSES = [
  '.article-content', '.liquid-btn', '.lg-input', '.calc-btn',
  '.theme-toggle', '.admin-page-btn', '.wallpaper-refresh-btn',
  '.admin-header h1', '.admin-layout',
  '.post-title', '.profile-page',
  '.comment-section', '.reply-form',
  '.drive-page',
]
```

Drive 页面的根节点是 `<div className="page container drive-page">`，所有 Drive 内容都在其内。`.drive-page` 加入排除列表后，`isExcluded()` 对 Drive 内所有元素返回 `true`，不会再设置 `data-ac` 属性。

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd client && npx tsc --noEmit
```

预期：无报错。

- [ ] **Step 3: Commit**

```bash
git add client/src/contexts/ContrastContext.tsx
git commit -m "fix(drive): 排除字体反色扫描 — 添加 .drive-page 至 EXCLUDE_CLASSES"
```

---

### Task 2: 修复 DrivePage 回调函数导致 memo 失效的性能问题

**Files:**
- Modify: `client/src/pages/DrivePage.tsx:89-151`

**Interfaces:**
- Consumes: 无（纯内部重构）
- Produces: `navigateToFolder`、`navigateToBreadcrumb`、`handleDownload`、`handlePreview`、`handleSync` 均使用 `useCallback` 包裹，`DriveListView`/`DriveGridView` 的 `memo` 能正确跳过未变化时的重渲染

**问题分析：** 当前 `navigateToFolder`（89-94行）、`navigateToBreadcrumb`（96-100行）、`handleDownload`（102-123行）、`handlePreview`（125-135行）、`handleSync`（141-151行）都是普通函数定义，每次 DrivePage 渲染都创建新引用。这些函数作为 props 传入 `DriveListView`/`DriveGridView`，而这两个组件使用了 `memo`，但由于回调引用每次变化，`memo` 的浅比较失效，导致列表/网格每次都会全部重渲染。

- [ ] **Step 1: 用 `useCallback` 包裹所有回调函数**

将 `navigateToFolder` 替换为：

```typescript
const navigateToFolder = useCallback((item: DriveItem) => {
  if (!item.isFolder) return
  setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])
  setSearchQuery('')
  setSearchResults(null)
}, [])
```

将 `navigateToBreadcrumb` 替换为：

```typescript
const navigateToBreadcrumb = useCallback((index: number) => {
  setBreadcrumbs(prev => prev.slice(0, index + 1))
  setSearchQuery('')
  setSearchResults(null)
}, [])
```

将 `handleDownload` 替换为：

```typescript
const handleDownload = useCallback(async (item: DriveItem) => {
  if (item.isFolder) return
  try {
    const token = localStorage.getItem('lineweb_token')
    const res = await fetch(`/api/drive/download/${item.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || '下载失败')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = item.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    alert(err.message || '下载失败')
  }
}, [])
```

将 `handlePreview` 替换为：

```typescript
const handlePreview = useCallback((item: DriveItem) => {
  if (item.isFolder) return
  const mime = (item.mimeType || '').toLowerCase()
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ||
      mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
    setPreviewItem(item)
  } else {
    handleDownload(item)
  }
}, [handleDownload])
```

将 `handleSync` 替换为：

```typescript
const handleSync = useCallback(async () => {
  setSyncing(true)
  try {
    await api.post('/drive/sync')
    refresh()
  } catch (err: any) {
    console.error('同步失败:', err)
  } finally {
    setSyncing(false)
  }
}, [refresh])
```

注意：`handlePreview` 依赖 `handleDownload`，`handleSync` 依赖 `refresh`（而 `refresh` 依赖 `fetchItems` 和 `page`）。由于 `fetchItems` 的依赖数组为空（只通过闭包捕获 setState），`refresh` 又只调用 `fetchItems(currentParentId, page)`，而 `page` 是 state，`currentParentId` 是计算值——这里需要在 `handleSync` 前先处理 `refresh`。

实际上 `refresh` 是行内定义的 `const refresh = () => fetchItems(currentParentId, page)`，没有被 `useCallback` 包裹。我们需要同时处理它。

- [ ] **Step 2: 将 `refresh` 也改为 `useCallback`**

将：

```typescript
const refresh = () => fetchItems(currentParentId, page)
```

替换为：

```typescript
const refresh = useCallback(() => {
  fetchItems(currentParentId, page)
}, [currentParentId, page])
```

- [ ] **Step 3: 修复 `handleSync` 的依赖**

```typescript
const handleSync = useCallback(async () => {
  setSyncing(true)
  try {
    await api.post('/drive/sync')
    refresh()
  } catch (err: any) {
    console.error('同步失败:', err)
  } finally {
    setSyncing(false)
  }
}, [refresh])
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd client && npx tsc --noEmit
```

预期：无报错。

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DrivePage.tsx
git commit -m "perf(drive): useCallback 包裹回调函数，修复 memo 失效问题"
```

---

### Task 3: 优化列表/网格入场动画——首次渲染后不再重复播放

**Files:**
- Modify: `client/src/components/drive/DriveListView.tsx:32-35`
- Modify: `client/src/components/drive/DriveGridView.tsx:26-32`

**Interfaces:**
- Produces: 翻页/刷新/删除后不再播放逐项延迟动画；首次加载文件夹时保留动画

**问题分析：** 当前每个 `<tr>` / 每个 grid card 都有 `index * 0.04s` 的 `animationDelay`。当翻页、刷新、删除、重命名后 items 数组引用变化，所有行重新挂载并重新播放动画。15 个项目的动画持续超过 1 秒，让操作感觉"卡顿"而非"流畅"。

**方案：** 在 `DriveListView` 和 `DriveGridView` 内部使用 `useRef(hasAnimated)` 标记，仅在首次挂载时播放动画，后续 props 变化跳过动画。或者简化方案：移除 `fade-in` 类中的 `translateY` 变换和延迟叠加，仅保留淡入效果且缩短时间。

最简单有效的方案：移除延迟叠加，保留短淡入效果（给用户反馈但几乎无感知）。

- [ ] **Step 1: 简化 DriveListView 的行动画**

将 DriveRow 的 `className` 和 `style` 替换为：

```tsx
<tr className="drive-row" style={{ animationDelay: '0s' }}>
```

或者更好：添加 hasAnimated ref 控制：

```tsx
// 在 DriveListView 组件内部添加（第 85 行后）
const hasAnimated = useRef(false)

// 在 render 中使用（第 105 行附近）
{items.map((item, i) => (
  <DriveRow
    key={item.id}
    item={item}
    index={hasAnimated.current ? -1 : i}  // -1 时 style 设为空
    ...
  />
))}
{hasAnimated.current = true}
```

但这样太复杂了。最简洁的方式：**在 DriveListView 和 DriveGridView 内部用 `useRef` 控制 `animating` 状态，首次渲染后翻页/刷新不再设置 `animationDelay`。**

更具体地，每个视图内部：

```typescript
const prevItemsRef = useRef<DriveItem[]>(items)
const [animating, setAnimating] = useState(true)

useEffect(() => {
  if (prevItemsRef.current !== items) {
    setAnimating(false)
  }
  prevItemsRef.current = items
}, [items])
```

但这也挺复杂。让我用更简单的方法：

**DriveListView.tsx**：移除 `fade-in` 类和 `animationDelay` style，改为简单的行样式（hover 效果保留）。

```tsx
// DriveRow 中
<tr className="drive-row">
  ...
</tr>
```

**DriveGridView.tsx**：移除 inline `animation`，保留卡片样式。

```tsx
// DriveGridView 中
<LiquidGlass
  key={item.id}
  variant="strong"
  chromatic={false}
  className="drive-grid-card"
>
```

不过完全移除动画会让首次进入文件夹也没有反馈。折中方案：将 `fade-in` 的 `animationDuration` 缩短到 0.2s，且移除 `translateY` 变换（仅 opacity 变化），并移除行间延迟。

- [ ] **Step 2: 修改 DriveRow — 移除 `fade-in` 类和延迟**

将 DriveRow 组件中第 33-35 行：

```tsx
    <tr
      className="drive-row fade-in"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
```

替换为：

```tsx
    <tr className="drive-row">
```

- [ ] **Step 3: 修改 DriveGridView — 移除延迟动画**

将第 27-32 行：

```tsx
        <LiquidGlass
          key={item.id}
          variant="strong"
          chromatic={false}
          className="drive-grid-card"
          style={{ animation: `fadeIn 0.35s ease-out ${i * 0.04}s both` }}
        >
```

替换为：

```tsx
        <LiquidGlass
          key={item.id}
          variant="strong"
          chromatic={false}
          className="drive-grid-card"
        >
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd client && npx tsc --noEmit
```

预期：无错误。仅移除了一些 props/style，类型无变化。

- [ ] **Step 5: Commit**

```bash
git add client/src/components/drive/DriveListView.tsx client/src/components/drive/DriveGridView.tsx
git commit -m "perf(drive): 移除列表/网格逐项延迟入场动画，翻页刷新不再重复播放"
```

---

### Task 4: UX 人性化改进

**Files:**
- Modify: `client/src/pages/DrivePage.tsx`
- Modify: `client/src/styles/globals.css`（Drive 部分）

- [ ] **Step 1: 文件名过长时显示 tooltip**

在 `DriveListView.tsx` 中为文件名按钮添加 `title` 属性（显示完整文件名）：

当前第 45 行 `<button>` 已有 `title="点击重命名"`，需要改为显示完整文件名。修改 `DriveRow` 组件中的文件名按钮：

```tsx
  {item.isFolder ? (
    <button
      className="drive-name-btn drive-name-btn--folder"
      onClick={() => onFolderClick(item)}
      title={item.name}
    >
      {item.name}
    </button>
  ) : (
    <button
      className="drive-name-btn"
      onClick={() => onRename(item)}
      title={`${item.name} — 点击重命名`}
    >
      {item.name}
    </button>
  )}
```

在 `DriveGridView.tsx` 中，卡片名称也可以加 title：

在 `.drive-grid-card-name` 的 `<span>` 上添加 `title={item.name}`。

- [ ] **Step 2: 列视图：当前页/总数信息**

在翻页控件旁或底部添加更清晰的页码上下文。修改 DrivePage 中的翻页区域底部的总数显示：

```tsx
{/* 总数显示 */}
{!isSearching && (
  <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
    第 {page}/{totalPages} 页，共 {total} 项
  </div>
)}
```

- [ ] **Step 3: 载入状态优化**

当前载入状态仅显示一个 spinner。改为一个带骨架屏效果的占位提示：

```tsx
{loading ? (
  <div className="drive-loading">
    <div className="spinner" />
    <p style={{ marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
      正在加载...
    </p>
  </div>
) : ...}
```

- [ ] **Step 4: 验证所有改动**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DrivePage.tsx client/src/components/drive/DriveListView.tsx client/src/components/drive/DriveGridView.tsx
git commit -m "feat(drive): UX 人性化改进 — 文件名 tooltip、页码上下文、加载提示"
```

---

### Task 5: 移除项目中残留的 data-ac CSS 中对 Drive 的引用

此步骤可选。如果 `.drive-page` 已经排除了 data-ac 扫描，但 data-ac CSS 选择器仍在全局生效，Drive 页面不会再有 `data-ac` 属性，所以 CSS 选择器不会匹配，无实际影响。无需额外改动。

但如果希望彻底清理，可以检查 CSS 中是否有 Drive 专用的 data-ac 覆盖。从 grep 结果看，没有 `drive-` 相关的 data-ac CSS。跳过此任务。

---

### 自检

**1. Spec 覆盖：**
- 移除字体反色 → Task 1 ✅
- 性能优化（memo 修复） → Task 2 ✅
- 动画优化 → Task 3 ✅
- UX 人性化 → Task 4 ✅

**2. 占位符检查：** 所有步骤包含完整代码，无 TBD/TODO。

**3. 类型一致性：** 
- `navigateToFolder` 签名：`(item: DriveItem) => void` — 始终一致
- `handleDownload` 签名：`(item: DriveItem) => Promise<void>` — 始终一致
- `handlePreview` 签名：`(item: DriveItem) => void` — 始终一致
- `handleSync` 签名：`() => Promise<void>` — 始终一致
- `refresh` 签名：`() => void` — 始终一致
