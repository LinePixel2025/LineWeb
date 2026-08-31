import { useEffect, useRef, useState } from 'react'
import { GitHubButton } from '../ui'
import { streamAiDraft, type DraftLength, type DraftTone } from '../../lib/aiWrite'

const TONES: { value: DraftTone | ''; label: string }[] = [
  { value: '', label: '默认文风' },
  { value: 'formal', label: '正式严谨' },
  { value: 'casual', label: '轻松口语' },
  { value: 'tech', label: '技术向' },
  { value: 'story', label: '叙事生动' },
]

const LENGTHS: { value: DraftLength | ''; label: string }[] = [
  { value: '', label: '篇幅适中' },
  { value: 'short', label: '短篇（约 800 字）' },
  { value: 'medium', label: '中篇（约 1500 字）' },
  { value: 'long', label: '长篇（约 3000 字）' },
]

type Phase = 'form' | 'streaming' | 'done'

export default function AiDraftDialog({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  onInsert: (markdown: string) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [outline, setOutline] = useState('')
  const [tone, setTone] = useState<DraftTone | ''>('')
  const [length, setLength] = useState<DraftLength | ''>('')
  const [phase, setPhase] = useState<Phase>('form')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const previewRef = useRef<HTMLPreElement>(null)

  // 关闭时重置（生成中关闭则中断流）
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      abortRef.current = null
      setPhase('form')
      setDraft('')
      setError('')
    }
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  const start = async () => {
    if (!prompt.trim()) { setError('请输入文章主题或写作要求'); return }
    setError('')
    setDraft('')
    setPhase('streaming')
    const controller = new AbortController()
    abortRef.current = controller
    await streamAiDraft(
      {
        prompt: prompt.trim(),
        outline: outline.trim() || undefined,
        tone: tone || undefined,
        length: length || undefined,
      },
      {
        signal: controller.signal,
        onDelta: t => setDraft(prev => {
          const next = prev + t
          // 流式滚动到底部
          requestAnimationFrame(() => {
            if (previewRef.current) previewRef.current.scrollTop = previewRef.current.scrollHeight
          })
          return next
        }),
        onDone: () => { abortRef.current = null; setPhase('done') },
        onError: msg => {
          abortRef.current = null
          setPhase('form')
          setError(msg)
        },
      },
    )
  }

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('done')
  }

  const handleClose = () => {
    abortRef.current?.abort()
    onClose()
  }

  const insert = () => {
    if (draft.trim()) {
      onInsert(draft)
      onClose()
    }
  }

  return (
    <div className="gh-dialog-overlay" onMouseDown={handleClose}>
      <div className="gh-dialog ai-draft-dialog" onMouseDown={e => e.stopPropagation()}>
        <h3 className="gh-dialog-title">🤖 AI 起稿</h3>

        {phase === 'form' && (
          <>
            <label className="ai-field">
              <span className="ai-field-label">主题与要求 <span className="ai-required">*</span></span>
              <textarea
                className="gh-input"
                rows={3}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="例如：介绍 Rust 所有权机制，面向有 C++ 经验的开发者"
                maxLength={2000}
              />
            </label>
            <label className="ai-field">
              <span className="ai-field-label">大纲（可选）</span>
              <textarea
                className="gh-input"
                rows={3}
                value={outline}
                onChange={e => setOutline(e.target.value)}
                placeholder="每行一条要点，AI 会据此组织章节"
                maxLength={2000}
              />
            </label>
            <div className="ai-field-row">
              <label className="ai-field">
                <span className="ai-field-label">文风</span>
                <select className="gh-input" value={tone} onChange={e => setTone(e.target.value as DraftTone | '')}>
                  {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="ai-field">
                <span className="ai-field-label">篇幅</span>
                <select className="gh-input" value={length} onChange={e => setLength(e.target.value as DraftLength | '')}>
                  {LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>
            </div>
            {error && <div className="ai-error" role="alert">{error}</div>}
            <div className="gh-dialog-actions">
              <GitHubButton type="button" variant="ghost" onClick={handleClose}>取消</GitHubButton>
              <GitHubButton type="button" variant="primary" onClick={start}>开始生成</GitHubButton>
            </div>
          </>
        )}

        {phase !== 'form' && (
          <>
            <pre ref={previewRef} className="ai-draft-preview">{draft || '正在连接 AI…'}</pre>
            {error && <div className="ai-error" role="alert">{error}</div>}
            <div className="gh-dialog-actions">
              {phase === 'streaming' ? (
                <GitHubButton type="button" variant="secondary" onClick={stop}>停止生成</GitHubButton>
              ) : (
                <>
                  <GitHubButton type="button" variant="ghost" onClick={start} disabled={!draft}>重新生成</GitHubButton>
                  <GitHubButton type="button" variant="primary" onClick={insert} disabled={!draft.trim()}>插入正文</GitHubButton>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
