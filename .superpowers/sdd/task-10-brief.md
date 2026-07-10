### Task 10: 更新页面样式

**Files:**
- Modify: `client/src/styles/pages.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 页面特定样式

- [ ] **Step 1: 更新页面样式文件**

```css
/* client/src/styles/pages.css */

/* Page container */
.page {
  padding-top: calc(var(--nav-height) + 24px);
  padding-bottom: 24px;
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--spacing-4);
}

/* Home section */
.home-section {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Posts page */
.posts-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-3) var(--spacing-4);
  margin-bottom: var(--spacing-4);
}

.posts-search-wrap {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex: 1;
}

.posts-search-input {
  flex: 1;
}

.posts-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.posts-card {
  padding: var(--spacing-4);
}

/* Drive page */
.drive-page {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  gap: var(--spacing-4);
  min-height: calc(100vh - var(--nav-height));
}

.drive-main {
  flex: 1;
  min-width: 0;
}

.drive-content-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.drive-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}

.drive-state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
}

.drive-state-icon {
  font-size: 3rem;
  margin-bottom: var(--spacing-4);
}

.drive-state-text {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

/* Spinner */
.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border-default);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Fade in animation */
.fade-in-stagger {
  animation: fadeIn 0.3s ease-out forwards;
  opacity: 0;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Wallpaper refresh button */
.wallpaper-refresh-btn {
  position: fixed;
  bottom: var(--spacing-4);
  right: var(--spacing-4);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--color-text-primary);
}

.wallpaper-refresh-btn:hover {
  background: rgba(255,255,255,0.1);
}

.wallpaper-refresh-btn.refreshing {
  animation: spin 1s linear infinite;
}

/* Menu open state */
body.menu-open {
  overflow: hidden;
}

/* Mobile menu button */
.mobile-menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: flex;
  }
  
  .navbar-links {
    display: none;
  }
  
  .navbar-links.open {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: var(--nav-height);
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--color-bg-primary);
    padding: var(--spacing-4);
    gap: var(--spacing-2);
  }
  
  .drive-page {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: 验证页面样式**

在浏览器中检查页面样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/pages.css
git commit -m "feat: update page styles for new design system"
```
