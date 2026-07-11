### Task 9: ApiAdminPage / DeviceMonitorPage 移动端优化

**Files:**
- Modify: `client/src/pages/admin/ApiAdminPage.tsx`（弹窗已使用 admin-modal 类，CSS 层处理）
- Modify: `client/src/pages/admin/DeviceMonitorPage.tsx:27-31`（统计卡片响应式）

**Interfaces:**
- Consumes: 已有的 `.api-stat-cards`, `.api-header-controls` 类名
- Produces: DeviceMonitorPage 统计卡片在移动端单列布局

- [ ] **Step 1: DeviceMonitorPage 统计卡片添加响应式类**

在 `client/src/pages/admin/DeviceMonitorPage.tsx` 中，找到第 27-31 行的 stats 数组定义后的渲染（约 107 行）：

```tsx
<div className="api-stat-cards">
```

这个类名已经在 CSS 中有 `api-stat-cards`，需要确认 responsive.css 中有对应的移动端样式。在 Task 6 中已添加 `.api-stat-cards { grid-template-columns: 1fr; }`，所以此处无需修改。

ApiAdminPage 的弹窗使用 `.admin-modal` 类，Task 6 的 CSS 已处理移动端全屏弹窗，无需修改页面代码。

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/pages/admin/DeviceMonitorPage.tsx
git commit -m "feat(admin): DeviceMonitorPage responsive stat cards"
```

---

