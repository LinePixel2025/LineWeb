### Task 8: PageList / UserAdminPage / CommentAdminPage 分页组件化

**Files:**
- Modify: `client/src/pages/admin/PageList.tsx:99-135`（内联分页 → Pagination 组件）
- Modify: `client/src/pages/admin/UserAdminPage.tsx:184-209`（内联分页 → Pagination 组件）
- Modify: `client/src/pages/admin/CommentAdminPage.tsx`（无分页，仅检查）

**Interfaces:**
- Consumes: `Pagination` from `../../components/Pagination`
- Produces: PageList、UserAdminPage 使用 Pagination 组件替代内联分页逻辑

- [ ] **Step 1: PageList 使用 Pagination 组件**

在 `client/src/pages/admin/PageList.tsx` 顶部添加 import：
```tsx
import Pagination from '../../components/Pagination'
```

找到第 99-135 行的内联分页逻辑：
```tsx
{data && data.totalPages > 1 && (
  <div className="admin-pagination">
    {(() => {
      ...
    })()}
  </div>
)}
```

替换为：
```tsx
{data && data.totalPages > 1 && (
  <Pagination
    page={page}
    totalPages={data.totalPages}
    onPageChange={setPage}
  />
)}
```

- [ ] **Step 2: UserAdminPage 使用 Pagination 组件**

在 `client/src/pages/admin/UserAdminPage.tsx` 顶部添加 import：
```tsx
import Pagination from '../../components/Pagination'
```

找到第 184-209 行的内联分页逻辑：
```tsx
{totalPages > 1 && (
  <div className="admin-pagination">
    {(() => {
      ...
    })()}
  </div>
)}
```

替换为：
```tsx
{totalPages > 1 && (
  <Pagination
    page={page}
    totalPages={totalPages}
    onPageChange={setPage}
  />
)}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add client/src/pages/admin/PageList.tsx client/src/pages/admin/UserAdminPage.tsx
git commit -m "refactor(admin): use Pagination component in PageList and UserAdminPage"
```

---

