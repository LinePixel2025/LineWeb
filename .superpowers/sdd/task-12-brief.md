### Task 12: 更新globals.css导入

**Files:**
- Modify: `client/src/styles/globals.css`

**Interfaces:**
- Consumes: 所有CSS文件
- Produces: 统一的样式入口

- [ ] **Step 1: 更新globals.css文件**

```css
/* client/src/styles/globals.css */
/* Line Web — Modern Design System */

/* Import modular CSS files */
@import './variables.css';
@import './base.css';
@import './glass.css';
@import './components.css';
@import './pages.css';
@import './responsive.css';
```

- [ ] **Step 2: 验证样式导入**

在浏览器中检查所有样式是否正确导入。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/globals.css
git commit -m "feat: update globals.css imports"
```
