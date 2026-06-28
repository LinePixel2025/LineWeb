# 网盘前端翻页功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给网盘前端界面加上翻页功能，每页最多显示 15 个文件。

**Architecture:** 后端 `/api/drive/files` 路由增加 `page`/`limit` 查询参数支持，返回 `{ data, total, page, pageCount }` 格式的分页响应。前端 `DrivePage` 增加页码状态、翻页控件，列表/网格视图仅渲染当前页数据。

**Tech Stack:** Express 4 / Prisma 6 / React 19 / TypeScript 5

## Global Constraints

- 每页固定显示 15 个文件（前端传 `limit=15`）
- 后端复用已有的 `parsePagination` 工具函数（`server/src/lib/utils.ts`）
- 搜索不翻页（搜索已有 `take: 50` 硬限制）
- 翻页 UI 复用现有 `.admin-pagination` / `.admin-page-btn` CSS 类
- 进入子文件夹时重置到第 1 页
- 现有 DriveFile schema 无需变更

---

### Task 1: 后端 `/files` 路由增加分页支持

**Files:**
- Modify: `server/src/routes/drive.ts:46-76`

**Interfaces:**
- Consumes: `parsePagination`（已导入 at line 4）
- Produces: `GET /api/drive/files?parentId=X&page=1&limit=15` → `{ data: DriveFile[], total: number, page: number, pageCount: number }`

- [ ] **Step 1: 修改 `/files` 路由，增加分页查询**

将第 47-75 行替换为：

```typescript
/* ---------- 获取文件列表（支持分页） ---------- */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const parentIdStr = req.query.parentId as string | undefined
    const parentId = parentIdStr ? parseId(parentIdStr) : null
    const { page, limit, skip } = parsePagination(req.query)

    const where: any = { parentId }

    const [data, total] = await Promise.all([
      prisma.driveFile.findMany({
        where,
        select: {
          id: true,
          name: true,
          isFolder: true,
          parentId: true,
          size: true,
          mimeType: true,
          createdAt: true,
          updatedAt: true,
          uploadedBy: { select: { id: true, username: true } },
        },
        orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.driveFile.count({ where }),
    ])

    res.json({ data, total, page, pageCount: Math.ceil(total / limit) })
  } catch (err) {
    console.error('获取文件列表失败:', err)
    res.status(500).json({ error: '获取文件列表失败' })
  }
})
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd server && npx tsc --noEmit
```

预期：无报错。`parsePagination` 已导入，`Promise.all` 类型推断正确。

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/drive.ts
git commit -m "feat(drive): 后端 /files 路由增加分页支持"
```

---

### Task 2: 前端类型定义增加分页响应类型

**Files:**
- Modify: `client/src/types/drive.ts`（在 `DriveItem` 之后新增接口）

**Interfaces:**
- Consumes: 无
- Produces: `DriveListResponse` 类型供 DrivePage 使用

- [ ] **Step 1: 新增 `DriveListResponse` 类型**

在 `client/src/types/drive.ts` 文件末尾（`getMimeDisplay` 函数之后）添加：

```typescript
export interface DriveListResponse {
  data: DriveItem[]
  total: number
  page: number
  pageCount: number
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types/drive.ts
git commit -m "feat(drive): 添加分页响应 DriveListResponse 类型"
```

---

### Task 3: 前端 DrivePage 增加翻页状态与逻辑

**Files:**
- Modify: `client/src/pages/DrivePage.tsx`

**Interfaces:**
- Consumes: `DriveListResponse`（Task 2）、`api.get<T>()`
- Produces: 在列表/网格下方渲染翻页控件

- [ ] **Step 1: 新增页码状态，修改 `fetchItems` 支持分页**

替换 `DrivePage` 组件内的状态定义和 `fetchItems`：

```typescript
// 把原有
const [items, setItems] = useState<DriveItem[]>([])
// 替换为
const [items, setItems] = useState<DriveItem[]>([])
const [page, setPage] = useState(1)
const [totalPages, setTotalPages] = useState(1)
const [total, setTotal] = useState(0)

// 把原有 fetchItems 替换为
const fetchItems = useCallback(async (parentId: number | null, targetPage?: number) => {
  setLoading(true)
  setError('')
  try {
    const p = targetPage ?? ((parentId !== currentParentId) ? 1 : page)
    const params = new URLSearchParams()
    if (parentId !== null) params.set('parentId', String(parentId))
    params.set('page', String(p))
    params.set('limit', '15')
    const res = await api.get<DriveListResponse>(`/drive/files?${params}`)
    setItems(res.data)
    setTotal(res.total)
    setPage(res.page)
    setTotalPages(res.pageCount)
  } catch (err: any) {
    setError(err instanceof ApiError ? err.message : '加载失败')
    setItems([])
  } finally {
    setLoading(false)
  }
}, [])
```

注意：需要在文件顶部导入类型 `DriveListResponse`：
```typescript
import type { DriveItem, Breadcrumb, DriveListResponse } from '../types/drive'
```

- [ ] **Step 2: 修改 `useEffect` 调用，确保导航到文件夹时重置页码**

将第 49-51 行的 useEffect 替换为：

```typescript
useEffect(() => {
  setPage(1)
  fetchItems(currentParentId, 1)
}, [currentParentId, fetchItems])
```

- [ ] **Step 3: 在内容区域下方添加翻页控件**

在 `DrivePage` 的 JSX 中，在 `</LiquidGlass>` 关闭标签之前（第 203 行附近）、列表/网格的条件渲染之后，添加翻页 UI：

找到：
```tsx
          <DriveListView ... />
        ) : (
          <DriveGridView ... />
        )}
      </LiquidGlass>
```

替换为：
```tsx
          <DriveListView ... />
        ) : (
          <DriveGridView ... />
        )}

        {/* Pagination */}
        {!isSearching && totalPages > 1 && (
          <div className="admin-pagination">
            {(() => {
              const total = totalPages
              const current = page
              const pages: (number | 0)[] = []
              const start = Math.max(1, current - 2)
              const end = Math.min(total, current + 2)

              if (start > 1) {
                pages.push(1)
                if (start > 2) pages.push(0) // ellipsis
              }
              for (let i = start; i <= end; i++) pages.push(i)
              if (end < total) {
                if (end < total - 1) pages.push(0) // ellipsis
                pages.push(total)
              }

              return pages.map((p, i) =>
                p === 0 ? (
                  <span key={`ellipsis-${i}`} className="admin-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={`admin-page-btn${p === current ? ' admin-page-btn--active' : ''}`}
                    onClick={() => {
                      setPage(p)
                      fetchItems(currentParentId, p)
                    }}
                  >
                    {p}
                  </button>
                )
              )
            })()}
          </div>
        )}

        {/* Item count */}
        {!isSearching && (
          <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
            共 {total} 项
          </div>
        )}
      </LiquidGlass>
```

- [ ] **Step 4: 验证 TypeScript 编译通过**

```bash
cd client && npx tsc --noEmit
```

预期：无报错。`DriveListResponse` 已导入并在 `api.get<DriveListResponse>()` 中使用。

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DrivePage.tsx client/src/types/drive.ts
git commit -m "feat(drive): 前端翻页状态管理 + 翻页控件"
```

---

### Task 4: 清理列表视图中的旧数量显示

**Files:**
- Modify: `client/src/components/drive/DriveListView.tsx:119`

- [ ] **Step 1: 移除 `DriveListView` 底部的 `共 N 项` 显示**

将第 119 行：
```tsx
      <div className="drive-count">共 {items.length} 项</div>
```

替换为空行或被注释掉（在 DrivePage 中已显示总数，这里不再需要单独显示当前页数量）。可以选择完全删除该行，或改为更轻量的提示（如仅显示当前页范围）。

删除这行：
```tsx
      {/* 总数显示已移到 DrivePage 中 */}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/drive/DriveListView.tsx
git commit -m "chore(drive): 移除列表视图旧数量显示，已移到 DrivePage"
```

---

### Task 5: 搜索时隐藏翻页并恢复搜索结果样式

**注意：** 搜索功能在 Task 3 中已经通过 `!isSearching` 条件正确隐藏了翻页控件，因为搜索返回的是全量结果（最多 50 条），不需要分页。

搜索状态由 `searchResults !== null` 驱动，翻页控件仅在 `!isSearching` 时显示，所以无需额外改动。

- [ ] **Step 1: 验证搜索状态下的行为**

确认搜索时：
- `isSearching = searchResults !== null` → `true`
- 翻页控件通过 `{!isSearching && totalPages > 1 && (` 被隐藏
- 搜索结果仍然显示在列表/网格中

无需代码修改。

- [ ] **Step 2: 最终提交（如有改动）**

无改动则跳过。
