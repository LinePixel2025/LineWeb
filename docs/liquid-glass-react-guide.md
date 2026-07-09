# Liquid Glass React 开发指南

## 项目概述

**liquid-glass-react** 是一个实现了 Apple Liquid Glass 效果的 React 组件库。该库提供了高质量的玻璃折射、模糊、色差和弹性动画效果，完全使用 SVG 滤镜和 CSS 实现，无需 WebGL。

### 核心特性

- ✅ **真实的边缘折射和弯曲效果**
- ✅ **多种折射模式** (standard / polar / prominent / shader)
- ✅ **可配置的模糊级别**
- ✅ **支持任意子元素**
- ✅ **可配置的内边距**
- ✅ **正确的悬停和点击效果**
- ✅ **边缘和高光跟随底层光线**（类似 Apple 的实现）
- ✅ **可配置的色差效果**
- ✅ **可配置的弹性**（模拟 Apple 的"液态"感觉）

### 浏览器兼容性

| 浏览器 | 支持程度 |
|--------|----------|
| Chrome/Edge (Chromium) | ✅ 完全支持 |
| Safari | ⚠️ 部分支持（位移效果不可见） |
| Firefox | ⚠️ 部分支持（位移效果不可见） |

---

## 安装

```bash
npm install liquid-glass-react
# 或
yarn add liquid-glass-react
# 或
pnpm add liquid-glass-react
```

### 前置要求

- React 18.0.0 或更高版本
- React DOM 18.0.0 或更高版本

---

## 基本用法

### 1. 最简单的使用方式

```tsx
import LiquidGlass from 'liquid-glass-react'

function App() {
  return (
    <LiquidGlass>
      <div className="p-6">
        <h2>你的内容</h2>
        <p>这里会显示液态玻璃效果</p>
      </div>
    </LiquidGlass>
  )
}
```

### 2. 按钮示例

```tsx
import LiquidGlass from 'liquid-glass-react'

function GlassButton() {
  return (
    <LiquidGlass
      displacementScale={64}
      blurAmount={0.1}
      saturation={130}
      aberrationIntensity={2}
      elasticity={0.35}
      cornerRadius={100}
      padding="8px 16px"
      onClick={() => console.log('点击了！')}
    >
      <span className="text-white font-medium">点击我</span>
    </LiquidGlass>
  )
}
```

### 3. 使用鼠标容器

当希望玻璃效果响应更大区域的鼠标移动时（如父容器），使用 `mouseContainer` 属性：

```tsx
import { useRef } from 'react'
import LiquidGlass from 'liquid-glass-react'

function App() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={containerRef} className="w-full h-screen bg-image">
      <LiquidGlass
        mouseContainer={containerRef}
        elasticity={0.3}
        style={{ position: 'fixed', top: '50%', left: '50%' }}
      >
        <div className="p-6">
          <h2>玻璃效果会响应容器内的鼠标移动</h2>
        </div>
      </LiquidGlass>
    </div>
  )
}
```

---

## API 参考

### LiquidGlass 组件属性

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `children` | `React.ReactNode` | - | 要渲染在玻璃容器内的内容 |
| `displacementScale` | `number` | `70` | 控制位移效果的强度 |
| `blurAmount` | `number` | `0.0625` | 控制模糊/磨砂级别 |
| `saturation` | `number` | `140` | 控制玻璃效果的颜色饱和度 |
| `aberrationIntensity` | `number` | `2` | 控制色差强度 |
| `elasticity` | `number` | `0.15` | 控制"液态"弹性感觉（0 = 刚性，值越高越有弹性） |
| `cornerRadius` | `number` | `999` | 边框半径（像素） |
| `className` | `string` | `""` | 额外的 CSS 类 |
| `padding` | `string` | - | CSS 内边距值 |
| `style` | `React.CSSProperties` | - | 额外的内联样式 |
| `overLight` | `boolean` | `false` | 玻璃是否在浅色背景上 |
| `onClick` | `() => void` | - | 点击事件处理函数 |
| `mouseContainer` | `React.RefObject<HTMLElement \| null> \| null` | `null` | 跟踪鼠标移动的容器元素（默认为玻璃组件本身） |
| `mode` | `"standard" \| "polar" \| "prominent" \| "shader"` | `"standard"` | 折射模式，不同视觉效果。`shader` 最准确但不太稳定。 |
| `globalMousePos` | `{ x: number; y: number }` | - | 全局鼠标位置坐标，用于手动控制 |
| `mouseOffset` | `{ x: number; y: number }` | - | 鼠标位置偏移量，用于微调定位 |

---

## 折射模式详解

### 1. Standard（标准）
默认模式，提供平衡的折射效果，适用于大多数场景。

```tsx
<LiquidGlass mode="standard">
  {/* 内容 */}
</LiquidGlass>
```

### 2. Polar（极坐标）
使用极坐标系计算折射，产生圆形/放射状的折射效果。

```tsx
<LiquidGlass mode="polar">
  {/* 内容 */}
</LiquidGlass>
```

### 3. Prominent（突出）
增强的折射效果，边缘更加明显。

```tsx
<LiquidGlass mode="prominent">
  {/* 内容 */}
</LiquidGlass>
```

### 4. Shader（着色器）- 实验性
使用 Canvas 2D 着色器生成位移贴图，最准确但可能不太稳定。

```tsx
<LiquidGlass mode="shader">
  {/* 内容 */}
</LiquidGlass>
```

---

## 高级用法

### 1. 固定定位的浮动卡片

```tsx
import LiquidGlass from 'liquid-glass-react'

function FloatingCard() {
  return (
    <LiquidGlass
      displacementScale={100}
      blurAmount={0.5}
      saturation={140}
      aberrationIntensity={2}
      elasticity={0}
      cornerRadius={32}
      style={{
        position: 'fixed',
        top: '25%',
        left: '40%',
      }}
    >
      <div className="w-72 p-4">
        <h3 className="text-xl font-semibold mb-4">用户信息</h3>
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-black/10 rounded-full flex items-center justify-center text-white font-semibold">
              JD
            </div>
            <div>
              <p className="font-medium">John Doe</p>
              <p className="text-sm text-white/70">软件工程师</p>
            </div>
          </div>
        </div>
      </div>
    </LiquidGlass>
  )
}
```

### 2. 响应滚动位置变化

```tsx
import { useState, useRef, useEffect } from 'react'
import LiquidGlass from 'liquid-glass-react'

function ScrollAwareGlass() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [isOverLight, setIsOverLight] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const scrollTop = container.scrollTop
      setScroll(scrollTop)
      // 检测是否滚动到亮色区域
      setIsOverLight(scrollTop > 230 && scrollTop < 500)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div ref={containerRef} className="h-screen overflow-auto">
      {/* 背景内容 */}
      <div className="h-[200vh] bg-gradient-to-b from-white to-gray-200" />
      
      {/* 玻璃效果 */}
      <LiquidGlass
        overLight={isOverLight}
        displacementScale={80}
        blurAmount={0.3}
        style={{
          position: 'fixed',
          top: '30%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        <div className="p-6">
          <h2>滚动感知的玻璃效果</h2>
          <p>当前滚动位置: {scroll}px</p>
        </div>
      </LiquidGlass>
    </div>
  )
}
```

### 3. 多个玻璃效果叠加

```tsx
import LiquidGlass from 'liquid-glass-react'

function LayeredGlass() {
  return (
    <div className="relative h-screen bg-gradient-to-br from-blue-900 to-purple-900">
      {/* 底层玻璃 */}
      <LiquidGlass
        displacementScale={50}
        blurAmount={0.2}
        cornerRadius={20}
        style={{
          position: 'absolute',
          top: '20%',
          left: '10%',
          width: '300px',
        }}
      >
        <div className="p-4">
          <h3>底层玻璃</h3>
        </div>
      </LiquidGlass>

      {/* 上层玻璃 */}
      <LiquidGlass
        displacementScale={70}
        blurAmount={0.4}
        cornerRadius={16}
        style={{
          position: 'absolute',
          top: '30%',
          left: '20%',
          width: '250px',
        }}
      >
        <div className="p-4">
          <h3>上层玻璃</h3>
        </div>
      </LiquidGlass>
    </div>
  )
}
```

### 4. 手动控制鼠标位置

```tsx
import { useState } from 'react'
import LiquidGlass from 'liquid-glass-react'

function ManualControl() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })
  }

  return (
    <div 
      className="h-screen"
      onMouseMove={handleMouseMove}
    >
      <LiquidGlass
        globalMousePos={mousePos}
        elasticity={0.3}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div className="p-6">
          <h2>手动控制的玻璃效果</h2>
          <p>鼠标位置: ({mousePos.x}, {mousePos.y})</p>
        </div>
      </LiquidGlass>
    </div>
  )
}
```

---

## 性能优化建议

### 1. 避免不必要的重渲染

```tsx
import { memo } from 'react'
import LiquidGlass from 'liquid-glass-react'

// 使用 memo 包装包含玻璃效果的组件
const MemoizedGlassCard = memo(function GlassCard({ data }) {
  return (
    <LiquidGlass displacementScale={60}>
      <div>{data.title}</div>
    </LiquidGlass>
  )
})
```

### 2. 合理使用 displacementScale

- 较低的值（30-50）：性能更好，效果更微妙
- 中等的值（60-80）：平衡性能和效果
- 较高的值（90-120）：效果更强烈，但可能影响性能

### 3. 移动端优化

```tsx
import { useState, useEffect } from 'react'
import LiquidGlass from 'liquid-glass-react'

function ResponsiveGlass() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <LiquidGlass
      // 移动端使用较低的值以提高性能
      displacementScale={isMobile ? 40 : 70}
      blurAmount={isMobile ? 0.05 : 0.0625}
      // 移动端减少或禁用弹性效果
      elasticity={isMobile ? 0 : 0.15}
    >
      <div className="p-4">
        <h2>响应式玻璃效果</h2>
      </div>
    </LiquidGlass>
  )
}
```

---

## 样式定制

### 1. 自定义背景

```tsx
<LiquidGlass
  style={{
    background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
  }}
>
  <div>自定义背景</div>
</LiquidGlass>
```

### 2. 自定义阴影

```tsx
<LiquidGlass
  style={{
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)',
  }}
>
  <div>自定义阴影</div>
</LiquidGlass>
```

### 3. 组合 CSS 类

```tsx
<LiquidGlass className="my-custom-class hover:scale-105 transition-transform">
  <div>组合样式</div>
</LiquidGlass>
```

---

## 与 LineWeb 项目集成可行性分析

### 当前状态

LineWeb 项目已经：

1. ✅ 在 `package.json` 中声明了 `liquid-glass-react` 依赖（版本 1.1.1）
2. ✅ 已安装在 `client/node_modules` 中
3. ✅ 有自己的 LiquidGlass 组件实现（`client/src/components/glass/LiquidGlass.tsx`）

### 现有实现 vs liquid-glass-react 对比

| 特性 | LineWeb 现有实现 | liquid-glass-react |
|------|-----------------|-------------------|
| **折射效果** | ❌ 无（仅 CSS 模糊） | ✅ SVG 滤镜实现真实折射 |
| **色差效果** | ⚠️ 简单边框模拟 | ✅ 完整的 RGB 通道分离 |
| **弹性动画** | ❌ 无 | ✅ 可配置的弹性效果 |
| **折射模式** | ❌ 无 | ✅ 4 种模式 |
| **鼠标跟随** | ✅ 镜面高光 | ✅ 完整的位移和缩放 |
| **性能** | ✅ 轻量级 | ⚠️ 较重（SVG 滤镜） |
| **浏览器兼容** | ✅ 全平台 | ⚠️ Chromium 最佳 |

### 集成方案

#### 方案 1：完全替换（推荐用于关键组件）

**优点：**
- 获得真实的折射效果
- 更接近 Apple Liquid Glass 的视觉效果
- 更丰富的配置选项

**缺点：**
- 需要修改现有组件的使用方式
- 可能影响性能（特别是在移动端）
- Safari/Firefox 用户体验不完整

**实施步骤：**

```tsx
// 1. 在需要的页面导入
import LiquidGlass from 'liquid-glass-react'

// 2. 替换现有组件
// 旧代码：
// <LiquidGlass variant="strong">
//   <div>内容</div>
// </LiquidGlass>

// 新代码：
<LiquidGlass
  displacementScale={70}
  blurAmount={0.0625}
  saturation={140}
  aberrationIntensity={2}
  cornerRadius={20}
>
  <div>内容</div>
</LiquidGlass>
```

#### 方案 2：混合使用（推荐用于渐进增强）

**优点：**
- 保持现有功能的稳定性
- 可以逐步引入新效果
- 可以针对不同组件选择最合适的方案

**实施步骤：**

```tsx
// 创建一个包装组件，根据条件选择实现
import OriginalLiquidGlass from '@/components/glass/LiquidGlass'
import AdvancedLiquidGlass from 'liquid-glass-react'

interface AdaptiveGlassProps {
  children: React.ReactNode
  useAdvanced?: boolean
  // ... 其他属性
}

function AdaptiveGlass({ children, useAdvanced = false, ...props }: AdaptiveGlassProps) {
  if (useAdvanced) {
    return (
      <AdvancedLiquidGlass
        displacementScale={70}
        blurAmount={0.0625}
        {...props}
      >
        {children}
      </AdvancedLiquidGlass>
    )
  }

  return (
    <OriginalLiquidGlass {...props}>
      {children}
    </OriginalLiquidGlass>
  )
}
```

#### 方案 3：仅用于特定场景（最保守）

**优点：**
- 最小化风险
- 可以在受控环境中测试
- 不影响现有功能

**适用场景：**
- 登录/注册弹窗
- 卡片详情页
- 特定的交互组件

```tsx
// 仅在特定页面使用
import LiquidGlass from 'liquid-glass-react'

function LoginPage() {
  return (
    <div className="login-page">
      <LiquidGlass
        displacementScale={60}
        blurAmount={0.3}
        cornerRadius={16}
        mode="standard"
      >
        <LoginForm />
      </LiquidGlass>
    </div>
  )
}
```

### 推荐集成策略

#### 阶段 1：评估和测试（1-2 天）

1. 创建一个测试页面，对比两种实现的效果
2. 在不同浏览器和设备上测试
3. 评估性能影响

```tsx
// client/src/pages/GlassTestPage.tsx
import { useState } from 'react'
import OriginalLiquidGlass from '@/components/glass/LiquidGlass'
import AdvancedLiquidGlass from 'liquid-glass-react'

export default function GlassTestPage() {
  const [useAdvanced, setUseAdvanced] = useState(false)

  return (
    <div className="p-8">
      <button onClick={() => setUseAdvanced(!useAdvanced)}>
        切换到{useAdvanced ? '原始' : '高级'}实现
      </button>

      <div className="mt-8 grid grid-cols-2 gap-8">
        <div>
          <h3>卡片示例</h3>
          {useAdvanced ? (
            <AdvancedLiquidGlass
              displacementScale={70}
              blurAmount={0.3}
              cornerRadius={16}
            >
              <div className="p-6">高级实现</div>
            </AdvancedLiquidGlass>
          ) : (
            <OriginalLiquidGlass variant="strong">
              <div className="p-6">原始实现</div>
            </OriginalLiquidGlass>
          )}
        </div>
      </div>
    </div>
  )
}
```

#### 阶段 2：渐进式集成（3-5 天）

1. 创建适配器组件
2. 在非关键页面开始使用
3. 收集用户反馈

#### 阶段 3：全面部署（1 周）

1. 根据反馈优化配置
2. 逐步替换关键组件
3. 性能监控和优化

### 注意事项

1. **性能监控**
   - 使用 React DevTools Profiler 监控渲染性能
   - 在移动端测试帧率
   - 监控内存使用

2. **降级方案**
   - 为 Safari/Firefox 提供 CSS-only 降级
   - 检测设备性能，自动禁用复杂效果

```tsx
function useGlassCapabilities() {
  const [capabilities, setCapabilities] = useState({
    supportsDisplacement: true,
    isMobile: false,
    isLowEnd: false,
  })

  useEffect(() => {
    const isChromium = !!window.chrome
    const isMobile = window.innerWidth <= 768
    // 简单的性能检测
    const isLowEnd = navigator.hardwareConcurrency <= 2

    setCapabilities({
      supportsDisplacement: isChromium,
      isMobile,
      isLowEnd,
    })
  }, [])

  return capabilities
}
```

3. **样式兼容**
   - 确保新组件的样式与现有设计系统一致
   - 测试亮色/暗色主题
   - 验证响应式布局

### 结论

**推荐采用方案 2（混合使用）**，原因：

1. ✅ 可以逐步引入新功能，降低风险
2. ✅ 保持现有功能的稳定性
3. ✅ 可以根据不同场景选择最合适的实现
4. ✅ 便于 A/B 测试和性能对比

**预计工作量：** 1-2 周（包括测试和优化）

**预期收益：**
- 显著提升视觉效果的真实感
- 更接近 Apple Liquid Glass 的设计语言
- 增强用户体验的沉浸感

---

## 常见问题

### Q1: 为什么 Safari/Firefox 中看不到折射效果？

A: 这是因为 SVG `feDisplacementMap` 滤镜在这些浏览器中的支持不完整。可以使用 `overLight` 属性或其他 CSS 效果作为降级方案。

### Q2: 如何优化移动端性能？

A: 
- 降低 `displacementScale` 值（建议 40-50）
- 减小 `aberrationIntensity`（建议 1-2）
- 禁用 `elasticity`（设为 0）
- 使用 `mode="standard"` 而非 `"shader"`

### Q3: 可以同时使用多个 LiquidGlass 组件吗？

A: 可以，但要注意性能。建议在同一页面上不超过 3-5 个活跃的玻璃效果。

### Q4: 如何与 Tailwind CSS 配合使用？

A: 直接在 `className` 属性中使用 Tailwind 类：

```tsx
<LiquidGlass className="p-6 rounded-2xl shadow-2xl">
  <div className="text-white">内容</div>
</LiquidGlass>
```

---

## 参考链接

- [GitHub 仓库](https://github.com/rdev/liquid-glass-react)
- [在线演示](https://liquid-glass.maxrovensky.com)
- [Apple Liquid Glass 设计指南](https://developer.apple.com/design/human-interface-guidelines/liquid-glass)

---

*文档版本: 1.0.0*  
*最后更新: 2026-07-09*