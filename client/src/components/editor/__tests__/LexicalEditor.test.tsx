import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
