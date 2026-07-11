### Task 6: 表单/弹窗移动端优化 CSS

**Files:**
- Modify: `client/src/styles/responsive.css`（在 580px 媒体查询之后添加 768px 媒体查询）

**Interfaces:**
- Consumes: `.admin-modal`, `.admin-modal-overlay`, `.admin-modal-input`, `.admin-modal-footer`, `.lg-input`, `.editor-field`, `.editor-controls`, `.editor-actions` 类名
- Produces: 移动端全屏弹窗、纵向表单、输入框 16px 最小字号

- [ ] **Step 1: 在 responsive.css 末尾添加 768px 媒体查询**

在 `client/src/styles/responsive.css` 文件末尾添加：

```css
/* ============================================================
   Admin Mobile Forms & Modals (< 768px)
   ============================================================ */
@media (max-width: 767px) {
  /* Form fields: vertical stack */
  .editor-field {
    width: 100%;
  }

  .editor-field .lg-input,
  .admin-modal-input {
    font-size: 16px; /* prevent iOS zoom */
    min-height: 44px;
  }

  /* Editor controls: stack on mobile */
  .editor-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .editor-actions {
    flex-direction: column;
    gap: 8px;
  }

  .editor-actions .liquid-btn {
    width: 100%;
    justify-content: center;
  }

  /* Modal: near-fullscreen on mobile */
  .admin-modal-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .admin-modal {
    max-width: 100%;
    width: 100%;
    margin: 0;
    border-radius: var(--lg-radius-lg) var(--lg-radius-lg) 0 0;
    max-height: 90vh;
    overflow-y: auto;
  }

  .admin-modal-footer {
    flex-direction: column;
    gap: 8px;
  }

  .admin-modal-btn {
    width: 100%;
    justify-content: center;
    min-height: 44px;
  }

  /* Comment edit form */
  .comment-edit-form textarea {
    font-size: 16px;
    min-height: 80px;
  }

  .comment-edit-actions {
    display: flex;
    gap: 8px;
  }

  .comment-edit-actions .liquid-btn {
    flex: 1;
    justify-content: center;
  }

  /* Stat cards responsive */
  .api-stat-cards {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  /* Device monitor header */
  .api-header-controls {
    flex-direction: column;
    width: 100%;
    gap: 8px;
  }

  .api-refresh-btn {
    width: 100%;
    justify-content: center;
  }

  /* User admin inline edit */
  .admin-cell--actions .lg-input {
    font-size: 16px;
    min-height: 40px;
  }

  /* Toast: top position to avoid tab bar */
  .toast-container {
    bottom: auto;
    top: 16px;
  }
}
```

- [ ] **Step 2: 验证页面无 TypeScript 错误**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/styles/responsive.css
git commit -m "feat(admin): mobile form, modal, and toast optimization CSS"
```

---

