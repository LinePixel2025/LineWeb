### Task 11: 更新响应式样式

**Files:**
- Modify: `client/src/styles/responsive.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 响应式样式

- [ ] **Step 1: 更新响应式样式文件**

```css
/* client/src/styles/responsive.css */

/* Mobile First */
@media (max-width: 768px) {
  :root {
    --spacing-4: 12px;
    --spacing-6: 16px;
    --spacing-8: 24px;
  }
  
  h1 {
    font-size: 1.75rem;
  }
  
  h2 {
    font-size: 1.25rem;
  }
  
  h3 {
    font-size: 1.125rem;
  }
  
  .container {
    padding: 0 var(--spacing-3);
  }
  
  .posts-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .posts-search-wrap {
    flex-direction: column;
  }
  
  .posts-toolbar-divider {
    display: none;
  }
}

/* Tablet */
@media (min-width: 769px) and (max-width: 1024px) {
  .container {
    padding: 0 var(--spacing-6);
  }
  
  .drive-page {
    grid-template-columns: 200px 1fr;
  }
}

/* Desktop */
@media (min-width: 1025px) {
  .container {
    padding: 0 var(--spacing-8);
  }
}

/* Large Desktop */
@media (min-width: 1400px) {
  :root {
    --max-width: 1320px;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: 验证响应式样式**

在浏览器中检查响应式样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/responsive.css
git commit -m "feat: update responsive styles for new design system"
```
