import DOMPurify from 'dompurify'
import katex from 'katex'
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked'
import markedKatex from 'marked-katex-extension'

/**
 * 站点通用的 Markdown 渲染（AI 回复 / Markdown 文件预览共用）。
 *
 * - 全量 GitHub Flavored Markdown（标题 / 列表 / 表格 / 引用 / 代码块 / 链接 / 图片）
 * - LaTeX 公式：$...$、$$...$$、\(...\)、\[...\]（KaTeX 渲染）
 * - 流式输出时未闭合的公式不会抛错（throwOnError: false 降级为红色原文）
 * - 最终统一过 DOMPurify（保留 KaTeX 所需的 style 属性与 MathML）
 *
 * 返回包裹在 <div class="gh-ai-markdown"> 内的 HTML 字符串，
 * 调用方用 dangerouslySetInnerHTML 渲染。
 */

interface MathToken extends Tokens.Generic {
  text: string
  displayMode: boolean
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** \( ... \)：行内公式（DeepSeek 常用写法） */
const inlineParenMath: TokenizerAndRendererExtension = {
  name: 'inlineKatexParen',
  level: 'inline',
  start(src) {
    const index = src.indexOf('\\(')
    return index === -1 ? undefined : index
  },
  tokenizer(src) {
    const match = /^\\\(([^\n]+?)\\\)/.exec(src)
    if (!match) return undefined
    return {
      type: 'inlineKatexParen',
      raw: match[0],
      text: match[1].trim(),
      displayMode: false,
    }
  },
  renderer(token) {
    return katex.renderToString((token as MathToken).text, {
      displayMode: (token as MathToken).displayMode,
      throwOnError: false,
      strict: false,
    })
  },
}

/** \[ ... \]：独立公式（DeepSeek 常用写法；行内出现时也按独立公式渲染） */
const bracketMath: TokenizerAndRendererExtension = {
  name: 'katexBracket',
  level: 'inline',
  start(src) {
    const index = src.indexOf('\\[')
    return index === -1 ? undefined : index
  },
  tokenizer(src) {
    const match = /^\\\[([\s\S]+?)\\\]/.exec(src)
    if (!match) return undefined
    return {
      type: 'katexBracket',
      raw: match[0],
      text: match[1].trim(),
      displayMode: true,
    }
  },
  renderer(token) {
    return katex.renderToString((token as MathToken).text, {
      displayMode: true,
      throwOnError: false,
      strict: false,
    })
  },
}

const marked = new Marked()

marked.use({
  gfm: true,
  // AI 回复里单个换行通常也是换行意图（与 GitHub 评论一致）
  breaks: true,
})

marked.use(
  markedKatex({
    throwOnError: false,
    strict: false,
    // 用标准模式：中文里紧跟公式的标点/空格能识别，同时避免「$5 到 $10」被误判为公式
  }),
)

marked.use({
  extensions: [inlineParenMath, bracketMath],
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : ''
      return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`
    },
    image({ href, title, text }) {
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : ''
      return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttr} loading="lazy" referrerpolicy="no-referrer">`
    },
  },
})

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false })
  return DOMPurify.sanitize(`<div class="gh-ai-markdown">${html}</div>`, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['target', 'loading', 'referrerpolicy'],
  })
}
