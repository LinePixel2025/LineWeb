import { marked } from 'marked'
import api from './api'

/**
 * 写作 AI 前端封装 — 全部走服务端 /api/ai/write/*，
 * 由服务端读取「AI 设置」页填写的 API Key / baseUrl / model。
 */

export type PolishAction = 'polish' | 'expand' | 'fix'
export type DraftTone = 'formal' | 'casual' | 'tech' | 'story'
export type DraftLength = 'short' | 'medium' | 'long'

/** AI 生成摘要 */
export async function aiWriteSummary(contentHtml: string): Promise<string> {
  const res = await api.post<{ summary: string }>('/ai/write/summary', { content: contentHtml })
  return res.summary
}

/** AI 润色/扩写/纠错 */
export async function aiWritePolish(text: string, action: PolishAction): Promise<string> {
  const res = await api.post<{ text: string }>('/ai/write/polish', { text, action })
  return res.text
}

/** AI 标题建议 */
export async function aiWriteTitles(contentHtml: string, summary?: string): Promise<string[]> {
  const res = await api.post<{ titles: string[] }>('/ai/write/titles', { content: contentHtml, summary })
  return res.titles
}

export interface DraftInput {
  prompt: string
  outline?: string
  tone?: DraftTone
  length?: DraftLength
}

export interface DraftStreamHandlers {
  onDelta: (text: string) => void
  onDone: (model: string) => void
  onError: (message: string) => void
  signal?: AbortSignal
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'lineweb_token'

/** AI 流式起稿（SSE）。用户点停止时 abort，视为正常结束。 */
export async function streamAiDraft(input: DraftInput, handlers: DraftStreamHandlers): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/ai/write/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
      signal: handlers.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError('网络请求失败，请稍后重试')
    return
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    handlers.onError(data.error || `请求失败 (${res.status})`)
    return
  }
  if (!res.body) {
    handlers.onError('当前浏览器不支持流式输出')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 事件以空行分隔
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6)) as {
              delta?: string; done?: boolean; model?: string; error?: string
            }
            if (payload.error) { handlers.onError(payload.error); return }
            if (payload.done) { handlers.onDone(payload.model || ''); return }
            if (payload.delta) handlers.onDelta(payload.delta)
          } catch {
            /* 忽略不完整 JSON 行 */
          }
        }
      }
    }
    handlers.onError('连接意外中断')
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    handlers.onError('读取流式响应失败')
  }
}

/** AI 输出的 Markdown 转 HTML（供 Lexical 导入） */
export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false })
}
