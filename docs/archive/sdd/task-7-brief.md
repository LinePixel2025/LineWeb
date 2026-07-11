### Task 7: AdminPage 分页组件化 + EditorPage 优化

**Files:**
- Modify: `client/src/pages/AdminPage.tsx:101-107`（分页区域）
- Modify: `client/src/pages/EditorPage.tsx:100-175`（表单布局）

**Interfaces:**
- Consumes: `Pagination` from `../components/Pagination`
- Produces: AdminPage 使用 Pagination 组件，EditorPage 表单纵向堆叠

- [ ] **Step 1: AdminPage 已使用 Pagination 组件，无需修改**

AdminPage.tsx 第 101-107 行已经使用了 `<Pagination>` 组件，无需修改。

- [ ] **Step 2: EditorPage 表单布局优化**

在 `client/src/pages/EditorPage.tsx` 中，将 Slug 和摘要的横向布局改为纵向。

找到第 113-130 行的 Slug + 摘要横向布局：
```tsx
<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
  <div className="editor-field" style={{ flex: 1, minWidth: 180 }}>
    ...
  </div>
  <div className="editor-field" style={{ flex: 2, minWidth: 240 }}>
    ...
  </div>
</div>
```

替换为纵向布局：
```tsx
<div className="editor-field">
  <label className="editor-label">Slug</label>
  <input
    className="lg-input"
    value={slug}
    onChange={e => setSlug(e.target.value)}
    placeholder={title ? toSlug(title) : 'article-slug'}
  />
</div>

<div className="editor-field">
  <label className="editor-label">摘要</label>
  <input
    className="lg-input"
    value={summary}
    onChange={e => setSummary(e.target.value)}
    placeholder="文章摘要（可选）"
  />
</div>
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add client/src/pages/EditorPage.tsx
git commit -m "feat(admin): EditorPage form vertical layout for mobile"
```

---

