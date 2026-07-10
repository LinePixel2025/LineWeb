### Task 5: 更新组件样式

**Files:**
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 组件样式（按钮、卡片、导航栏）

- [ ] **Step 1: 更新组件样式文件**

```css
/* client/src/styles/components.css */

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  cursor: pointer;
  text-decoration: none;
}

.btn-primary {
  background: var(--color-accent);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
  color: #ffffff;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-secondary:hover {
  background: rgba(255,255,255,0.05);
  border-color: var(--color-border-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-primary);
}

.btn-ghost:hover {
  background: rgba(255,255,255,0.05);
}

.btn-glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
}

.btn-glass:hover {
  background: rgba(255,255,255,0.1);
}

/* Cards */
.card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  transition: all var(--transition-normal);
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.card-glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4);
}

.card-glass:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

/* Navbar */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  height: var(--nav-height);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--glass-border);
}

.navbar-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--spacing-4);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.navbar-logo {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-decoration: none;
}

.navbar-links {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.navbar-link {
  padding: 8px 16px;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: all var(--transition-fast);
}

.navbar-link:hover {
  color: var(--color-text-primary);
  background: var(--color-accent-soft);
}

.navbar-link.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* Theme Toggle */
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-toggle:hover {
  background: rgba(255,255,255,0.1);
}
```

- [ ] **Step 2: 验证组件样式**

在浏览器中检查组件样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/components.css
git commit -m "feat: update component styles for new design system"
```
