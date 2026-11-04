import type { MouseEvent, TouchEvent } from 'react'

/**
 * 触屏 HUD 按钮的点击助手。
 *
 * 为什么不能只用 onClick：一根手指按住虚拟摇杆、另一根手指点技能键时，
 * 浏览器正处于多点触控手势中，不会把 click 合成到那个按钮上（click 目标会退化成
 * 两个触点的公共祖先），于是「移动中放技能 / 切画质 / 开背包」全部失灵。
 *
 * 这里同时接 touchend，并对紧随其后仍可能到达的 click 按元素去重：
 * 触屏一次、鼠标一次，都不会重复触发；键盘 Enter/Space 走 click，同样有效。
 */
const CLICK_DEDUPE_MS = 700
const lastTouchByElement = new WeakMap<Element, number>()

/** 手指抬起时仍在按钮范围内才算一次点击（滑出去就取消，与原生按钮行为一致） */
function isInsideTarget(event: TouchEvent<HTMLElement>): boolean {
  const touch = event.changedTouches[0]
  if (!touch) return true
  const rect = event.currentTarget.getBoundingClientRect()
  return (
    touch.clientX >= rect.left
    && touch.clientX <= rect.right
    && touch.clientY >= rect.top
    && touch.clientY <= rect.bottom
  )
}

export interface TapHandlers {
  onClick: (event: MouseEvent<HTMLElement>) => void
  onTouchEnd: (event: TouchEvent<HTMLElement>) => void
}

export function onTap(action: () => void): TapHandlers {
  return {
    onClick: (event) => {
      const firedAt = lastTouchByElement.get(event.currentTarget)
      if (firedAt !== undefined && Date.now() - firedAt < CLICK_DEDUPE_MS) return
      action()
    },
    onTouchEnd: (event) => {
      if (!isInsideTarget(event)) return
      lastTouchByElement.set(event.currentTarget, Date.now())
      action()
    },
  }
}
