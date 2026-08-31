/**
 * 文本统计纯函数（与 server/src/lib/textStats.ts 算法保持一致）
 * 供编辑器状态栏的字数/阅读时长使用
 */

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function countParts(text: string) {
  const cjk = (text.match(CJK_RE) ?? []).length
  const latin = (text.match(/[a-zA-Z0-9]+/g) ?? []).length
  return { cjk, latin }
}

export function countWords(text: string): number {
  const { cjk, latin } = countParts(text)
  return cjk + latin
}

/** 估算阅读时长（分钟）：中文约 400 字/分钟、英文约 200 词/分钟，最少 1 分钟 */
export function calcReadingTime(html: string): number {
  const { cjk, latin } = countParts(stripHtml(html))
  return Math.max(1, Math.ceil(cjk / 400 + latin / 200))
}
