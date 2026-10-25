import DOMPurify from 'dompurify'

/**
 * 站点通用的轻量 Markdown 渲染（AI 回复用）。
 *
 * 从 AiAssistant 抽出共享（原实现保留）：先整体 HTML 转义，再白名单式地
 * 还原代码块 / 行内代码 / 加粗 / 斜体 / 链接 / 标题 / 列表，最后过 DOMPurify。
 * 返回包裹在 <div class="gh-ai-markdown"> 内的 HTML 字符串，
 * 调用方用 dangerouslySetInnerHTML 渲染。
 */
export function renderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  const codeBlocks: string[] = []
  let processed = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length
    const languageClass = lang ? ` class="language-${lang}"` : ''
    codeBlocks.push(`<pre><code${languageClass}>${code}</code></pre>`)
    return `%%CODEBLOCK_${index}%%`
  })

  processed = processed
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  const lines = processed.split('\n')
  let html = ''
  let inUl = false
  let inOl = false

  for (const line of lines) {
    const codeBlockMatch = line.match(/^%%CODEBLOCK_(\d+)%%$/)
    if (codeBlockMatch) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (inOl) { html += '</ol>\n'; inOl = false }
      html += `${codeBlocks[parseInt(codeBlockMatch[1], 10)]}\n`
      continue
    }

    if (/^#{1,4}\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (inOl) { html += '</ol>\n'; inOl = false }
      const level = line.match(/^#{1,4}/)![0].length
      html += `<h${level}>${line.replace(/^#+\s/, '')}</h${level}>\n`
      continue
    }

    if (/^\s*[-*]\s/.test(line)) {
      if (inOl) { html += '</ol>\n'; inOl = false }
      if (!inUl) { html += '<ul>\n'; inUl = true }
      html += `<li>${line.replace(/^\s*[-*]\s/, '')}</li>\n`
      continue
    }

    if (/^\s*\d+\.\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false }
      if (!inOl) { html += '<ol>\n'; inOl = true }
      html += `<li>${line.replace(/^\s*\d+\.\s/, '')}</li>\n`
      continue
    }

    if (inUl) { html += '</ul>\n'; inUl = false }
    if (inOl) { html += '</ol>\n'; inOl = false }
    html += line.trim() === '' ? '<br>\n' : `<p>${line}</p>\n`
  }

  if (inUl) html += '</ul>\n'
  if (inOl) html += '</ol>\n'

  return DOMPurify.sanitize(`<div class="gh-ai-markdown">${html}</div>`)
}
