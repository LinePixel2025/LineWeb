### Task 4: 更新玻璃质感样式

**Files:**
- Modify: `client/src/styles/glass.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 玻璃质感组件样式

- [ ] **Step 1: 更新玻璃质感样式文件**

```css
/* client/src/styles/glass.css */
.lg-surface {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  transition: background var(--transition-normal), border-color var(--transition-normal);
}

.lg-surface:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--color-border-hover);
}

.lg-surface-strong {
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.lg-input {
  width: 100%;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 0.95rem;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.lg-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.lg-input::placeholder {
  color: var(--color-text-tertiary);
}

.lg-glass-input {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.lg-glass-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
```

- [ ] **Step 2: 验证玻璃质感样式**

在浏览器中检查玻璃质感样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/glass.css
git commit -m "feat: update glass styles for new design system"
```
