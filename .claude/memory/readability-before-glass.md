---
name: readability-before-glass
description: 在所有液态玻璃效果中，可读性优先于视觉效果
metadata:
  type: feedback
---

在每次应用 Liquid Glass 效果时，必须优先保证可读性。具体做法：

1. **三层玻璃结构（已验证方案）**：
   - `::before`（z-index: -1）: `blur(14px) saturate(180%)` 毛玻璃底衬 — 提供可读性基础
   - 元素自身（z-index: 0）: SVG `url(#lg-core)` 折射滤镜 — 提供液态视觉效果
   - `::after`（z-index: 1）: `radial-gradient` 镜面高光 — 提供光泽感
   - 禁止引入任何不透明填充（白底/黑底），玻璃通透感必须保留

2. **导航栏特殊处理**：
   - `::before` blur 层和 `::after` 折射层必须分开，禁止层叠冲突
   - `::after` 层 `bottom: 2px` 避免折射扭曲底部边框
   - 边框（border-bottom）放在元素自身，不受位移滤镜影响

3. **输入框/按钮**通常不需要三层结构，用折射 + tint 即可（因为尺寸小，背景容易透出）

4. **强光场景（首页 Bing 壁纸）**：文字用白色 (`white` / `rgba(255,255,255,0.78)`)，标题用白色渐变

5. **任何时候如果玻璃效果导致文字模糊或断裂**，应先加强模糊底衬，而不是加不透明背景

**Why:** 用户明确要求液态玻璃效果不是毛玻璃，需要真正的 SVG feDisplacementMap 折射；但同时明确指出白底方案不可接受，要求用可调模糊度的毛玻璃底层来提升可读性。
**How to apply:** 始终使用 `.lg-surface` / `.lg-surface-strong` / `.lg-underlay` 标准类名，不要 inline 覆盖它们的 backdrop-filter 结构。
