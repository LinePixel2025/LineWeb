/**
 * 文本统计纯函数 — 供文章列表 excerpt / 阅读时长计算使用
 * （无数据库依赖，可独立测试）
 */

/** 去除 HTML 标签并转义常见实体，归一化空白 */
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

/** 统计"字数"：中日韩字符逐字计数，连续的英文/数字串计为 1 词 */
export function countWords(text: string): { cjk: number; latin: number; total: number } {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[a-zA-Z0-9]+/g) ?? []).length
  return { cjk, latin, total: cjk + latin }
}

/**
 * 估算阅读时长（分钟）：中文约 400 字/分钟、英文约 200 词/分钟，最少 1 分钟
 */
export function calcReadingTime(html: string): number {
  const { cjk, latin } = countWords(stripHtml(html))
  return Math.max(1, Math.ceil(cjk / 400 + latin / 200))
}

/**
 * 生成列表摘要：优先用 summary，否则从正文去标签截取
 */
export function buildExcerpt(summary: string | null | undefined, contentHtml: string, maxLen = 120): string {
  const source = summary && summary.trim() ? summary.trim() : stripHtml(contentHtml)
  if (!source) return ''
  if (source.length <= maxLen) return source
  return source.slice(0, maxLen).trimEnd() + '…'
}
