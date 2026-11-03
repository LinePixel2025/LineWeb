/**
 * MediaQueryList 兼容封装。
 *
 * 旧 Safari / iOS（< 14）只有 `addListener`，没有 `addEventListener`；
 * 旧 Android WebView 同样可能缺失。直接调用 `mql.addEventListener` 会抛
 * `TypeError: undefined is not a function`，在 useEffect 里等于整页白屏。
 */
export function onMediaQueryChange(
  query: string,
  handler: (matches: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia(query)
  const listener = (event: MediaQueryListEvent): void => handler(Boolean(event.matches))
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', listener)
    return () => mql.removeEventListener('change', listener)
  }
  // Safari < 14 / 旧 WebView 的退化接口
  const legacy = mql as MediaQueryList & {
    addListener?: (cb: (event: MediaQueryListEvent) => void) => void
    removeListener?: (cb: (event: MediaQueryListEvent) => void) => void
  }
  legacy.addListener?.(listener)
  return () => legacy.removeListener?.(listener)
}
