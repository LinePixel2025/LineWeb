/**
 * 网页反代 — 老旧设备 ES5 转译（Babel）
 *
 * 站点自身的 bundle 是 ES2017+（async/await、可选链、class fields），老引擎直接
 * SyntaxError 白屏。legacy 模式下把外部 JS 与内联脚本转译成 ES5。
 *
 * 为什么用 Babel 而非 esbuild：esbuild 无法把 async/await 降到 ES5（需要 generator，
 * 而 ES5 没有）。Babel preset-env + regenerator-runtime 可以完整降级。
 *
 * 性能：按内容 sha1 做 LRU 缓存（站点 JS 高度重复），单文件上限 4MB，
 * 转译失败回退原文（现代设备无回归，老设备尽力而为）。
 */

import Babel from '@babel/standalone'
import { createHash } from 'crypto'

const CACHE_MAX_ENTRIES = 300
const CACHE_MAX_BYTES = 96 * 1024 * 1024
/** 单文件转译上限（超过原样回传） */
export const MAX_TRANSPILE_BYTES = 4 * 1024 * 1024

interface CacheEntry {
  code: string
  bytes: number
}

/** Map 保持插入顺序 → delete + set 实现 LRU 刷新 */
const cache = new Map<string, CacheEntry>()
let cacheBytes = 0

function evictIfNeeded(): void {
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    const entry = cache.get(oldest)
    cache.delete(oldest)
    if (entry) cacheBytes -= entry.bytes
  }
}

/**
 * 把 JS 源码转译成 ES5。失败 / 超大 / 空输入原样返回。
 * modules:false 保留经典脚本语义；type=module 的 ESM 不在本次范围（老引擎本就不支持）。
 */
export function transpileToEs5(source: string): string {
  if (!source || source.length > MAX_TRANSPILE_BYTES) return source
  const hash = createHash('sha1').update(source).digest('hex')
  const hit = cache.get(hash)
  if (hit) {
    cache.delete(hash)
    cache.set(hash, hit)
    return hit.code
  }
  let code: string
  try {
    // @babel/standalone 自包含（预打包），避免 preset-env 的 polyfill-provider
    // 在 tsx CJS 环境下 createRequire(import.meta.url) 崩溃
    const result = Babel.transform(source, {
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      compact: false,
      presets: [
        ['env', {
          targets: { chrome: '30', safari: '8', android: '4.4', ie: '11' },
          modules: false,
          useBuiltIns: false,
          bugfixes: true,
        }],
      ],
    })
    code = result?.code ?? source
  } catch {
    // 转译失败（含无法解析的语法）→ 回退原文
    return source
  }
  const bytes = code.length
  cache.set(hash, { code, bytes })
  cacheBytes += bytes
  evictIfNeeded()
  return code
}

/** 测试 / 运维：缓存条目数 */
export function transpileCacheSize(): number {
  return cache.size
}
