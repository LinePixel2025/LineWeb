---
name: font-contrast-policy
description: 字体反色（data-ac 系统）只在明确要求时添加
metadata:
  type: feedback
---

用户要求：在后续开发中，不要自动给每个字体/元素添加字体反色（ContrastContext 的 `data-ac` 属性系统）。只有在被明确要求"添加字体反色"时，才去实现或扩展该功能。

**Why:** 用户希望保持精简，不默认对全站元素应用反色逻辑，避免不必要的 DOM 属性污染和性能开销。

**How to apply:** 新建页面或组件时，不添加 `data-ac` 相关属性。仅在用户明确说"给这个加上字体反色"时才去做。现有的 `globals.css` 中的 `[data-ac]` 样式和 `ContrastContext.tsx` 保持不变，不要主动扩展。
