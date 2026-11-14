/**
 * 网页反代 — 字节跳动 WAF JS 挑战的服务端求解
 *
 * 抖音等站点边缘（TLB）对疑似爬虫的请求返回 "Please wait" 挑战页：
 * 浏览器需加载 out-sha256.js，暴力搜索 i∈[0,1e6] 使
 *   SHA256(prefix || utf8(i)) 的 hex == expect，
 * 再把 `_wafchallengeid = base64(JSON.stringify({...challenge, d: base64(i)}))`
 * 写进 document.cookie 并 reload。
 *
 * 反代下这条链路必断：挑战 Cookie 写进引导脚本的「虚拟罐」，而 reload 是文档导航，
 * 虚拟罐只在 fetch/XHR 上经 x-lw-cookie 发送，导航请求不带它 → 上游永远收不到解答 → 死循环。
 *
 * 解法：服务端直接解 PoW（Node SHA-256，服务端在 0..1e6 内预选了 i，毫秒级命中），
 * 把 `_wafchallengeid` 写进服务端 Cookie 罐再重取上游，绕开浏览器挑战。
 * 老旧 WebView 跑不动挑战 JS 时也由此受益。纯函数，便于自检。
 */

import { createHash } from 'crypto'

/** WAF 挑战 Cookie 名 */
export const WAF_COOKIE_NAME = '_wafchallengeid'
const MAX_POW_ITERATIONS = 1_000_000

/** 是否为字节 WAF JS 挑战页（Please wait + sha256 PoW） */
export function isWafChallenge(html: string): boolean {
  if (!html) return false
  if (html.includes(WAF_COOKIE_NAME) && html.includes('waf-jschallenge')) return true
  if (html.includes('Please wait') && html.includes('readygo') && html.includes('s256')) return true
  return false
}

/** 从挑战页提取 base64 挑战串 cs（`cs="..."`） */
export function extractWafChallenge(html: string): string | null {
  const match = /\bcs\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(html)
  return match ? match[1] : null
}

/**
 * 解 PoW，返回 `_wafchallengeid` 的 Cookie 值；无解 / 非法返回 null。
 * 与 out-sha256.js 的 s256 语义一致：SHA256(prefix字节 || utf8(String(i))) 的小写 hex。
 */
export function solveWafChallenge(cs: string): string | null {
  let challenge: { v?: { a?: string; c?: string }; [key: string]: unknown }
  try {
    challenge = JSON.parse(Buffer.from(cs, 'base64').toString('utf8'))
  } catch {
    return null
  }
  const a = challenge?.v?.a
  const c = challenge?.v?.c
  if (typeof a !== 'string' || typeof c !== 'string') return null
  let prefix: Buffer
  let expect: string
  try {
    prefix = Buffer.from(a, 'base64')
    expect = Buffer.from(c, 'base64').toString('hex')
  } catch {
    return null
  }
  if (prefix.length === 0 || expect.length !== 64) return null
  for (let i = 0; i <= MAX_POW_ITERATIONS; i += 1) {
    const hash = createHash('sha256').update(prefix).update(Buffer.from(String(i), 'utf8')).digest('hex')
    if (hash === expect) {
      // 浏览器侧 c.d = btoa(String(i)) 后 JSON.stringify；保持键序 v,s,d
      const solved = { ...challenge, d: Buffer.from(String(i)).toString('base64') }
      return Buffer.from(JSON.stringify(solved)).toString('base64')
    }
  }
  return null
}
