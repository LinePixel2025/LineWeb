import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LexicalEditor from '../LexicalEditor'

function ControlledEditor({ initialHtml }: { initialHtml: string }) {
  const [content, setContent] = useState(initialHtml)

  return (
    <>
      <button type="button" onClick={() => setContent('<p>Parent update</p>')}>
        Update parent
      </button>
      <LexicalEditor initialHtml={content} onChange={setContent} />
    </>
  )
}

describe('LexicalEditor', () => {
  it('keeps the editor mounted when generated HTML is written back by the parent', async () => {
    render(<ControlledEditor initialHtml="<p>Existing content</p>" />)

    const editable = await screen.findByRole('textbox')
    const editorRoot = editable.closest('.lex-editor')

    fireEvent.click(screen.getByRole('button', { name: 'Update parent' }))

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBe(editable)
    })
    expect(editable.closest('.lex-editor')).toBe(editorRoot)
  })

  it('does not remount when a blank editor receives its first generated HTML', async () => {
    // 回归：过去 key 由 initialHtml 派生，新建文章敲第一个字就重建 Composer，
    // 表现为焦点丢失、滚动位置归零。
    const { rerender } = render(<LexicalEditor initialHtml="" onChange={() => {}} />)

    const editable = await screen.findByRole('textbox')
    act(() => { rerender(<LexicalEditor initialHtml='<p class="lex-p">a</p>' onChange={() => {}} />) })

    expect(screen.getByRole('textbox')).toBe(editable)
  })

  it('rebuilds the composer when resetKey changes (draft restore)', async () => {
    const { rerender } = render(<LexicalEditor initialHtml="<p>a</p>" resetKey={0} />)

    const editable = await screen.findByRole('textbox')
    // 新挂载的 Composer 会异步更新 Placeholder，用异步 act 一并 flush
    await act(async () => { rerender(<LexicalEditor initialHtml="<p>a</p>" resetKey={1} />) })

    expect(screen.getByRole('textbox')).not.toBe(editable)
  })

  it('does not append an empty paragraph to non-empty initial HTML', async () => {
    render(<LexicalEditor initialHtml="<p>Only paragraph</p>" />)

    const editable = await screen.findByRole('textbox')
    await waitFor(() => {
      expect(editable.querySelectorAll('p')).toHaveLength(1)
    })
    expect(editable).toHaveTextContent('Only paragraph')
  })

  it('renders an editable paragraph for empty content', async () => {
    render(<LexicalEditor />)

    const editable = await screen.findByRole('textbox')
    expect(editable).toHaveAttribute('contenteditable', 'true')
    expect(editable.querySelector('p')).toBeInTheDocument()
  })
})
