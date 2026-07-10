# Task 2: 创建useResponsive响应式布局hook

## 项目上下文
这是网盘前端界面重构项目的第二步。项目采用React 19 + TypeScript + Vite技术栈。Task 1已完成DriveContext状态管理。

## 任务目标
创建useResponsive hook，用于检测当前设备类型和屏幕尺寸，支持响应式布局。

## 文件列表
- Create: `client/src/hooks/useResponsive.ts`
- Test: `client/src/hooks/__tests__/useResponsive.test.ts`

## 接口定义
Produces: `useResponsive` hook - 返回当前设备类型和屏幕尺寸

## 详细步骤

### Step 1: 创建useResponsive.ts

创建 `client/src/hooks/useResponsive.ts` 文件：

```typescript
import { useState, useEffect } from 'react'

export type DeviceType = 'desktop' | 'tablet' | 'mobile'

export interface ResponsiveInfo {
  deviceType: DeviceType
  isDesktop: boolean
  isTablet: boolean
  isMobile: boolean
  width: number
  height: number
}

const BREAKPOINTS = {
  desktop: 1024,
  tablet: 768
}

export function useResponsive(): ResponsiveInfo {
  const [size, setSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768
  })

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const deviceType: DeviceType = 
    size.width >= BREAKPOINTS.desktop ? 'desktop' :
    size.width >= BREAKPOINTS.tablet ? 'tablet' :
    'mobile'

  return {
    deviceType,
    isDesktop: deviceType === 'desktop',
    isTablet: deviceType === 'tablet',
    isMobile: deviceType === 'mobile',
    width: size.width,
    height: size.height
  }
}
```

### Step 2: 创建测试文件

创建 `client/src/hooks/__tests__/useResponsive.test.ts` 文件，包含以下测试用例：
- 宽度 >= 1024 返回 desktop
- 宽度 768-1023 返回 tablet
- 宽度 < 768 返回 mobile
- 窗口 resize 时更新状态

### Step 3: 运行测试验证

Run: `cd client && npm test -- --watchAll=false useResponsive.test.ts`
Expected: 所有测试通过

### Step 4: 提交代码

```bash
git add client/src/hooks/useResponsive.ts client/src/hooks/__tests__/useResponsive.test.ts
git commit -m "feat(drive): add useResponsive hook for responsive layout"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 响应式断点：桌面端≥1024px、平板端768-1023px、移动端<768px

## 注意事项
- 使用 useState + useEffect 监听窗口 resize
- 断点值必须与设计文档一致：desktop: 1024, tablet: 768
- SSR 兼容：typeof window !== 'undefined' 检查