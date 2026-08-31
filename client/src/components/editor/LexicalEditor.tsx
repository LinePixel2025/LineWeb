import { useEffect, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { TRANSFORMERS } from '@lexical/markdown'
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html'
import { $createParagraphNode, $getRoot } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { CodeHighlightNode, CodeNode } from '@lexical/code'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode, AutoLinkNode } from '@lexical/link'
import EditorToolbar from './EditorToolbar'
import CodeHighlightPlugin from './CodeHighlightPlugin'
import type { InitialConfigType } from '@lexical/react/LexicalComposer'

const theme = {
  paragraph: 'lex-p',
  heading: { h1: 'lex-h1', h2: 'lex-h2', h3: 'lex-h3' },
  text: { bold: 'lex-bold', italic: 'lex-italic', underline: 'lex-uline', strikethrough: 'lex-strike' },
  list: { ul: 'lex-ul', ol: 'lex-ol', listitem: 'lex-li', nested: { listitem: 'lex-li-nested' } },
  quote: 'lex-quote',
  code: 'lex-code',
  link: 'lex-link',
}

/* ===========================================================
   OnChange — 每次编辑器变化时输出 HTML 给父组件
   =========================================================== */

function OnChangePlugin({ onChange }: { onChange: (html: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const fn = useRef(onChange)
  fn.current = onChange

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        fn.current($generateHtmlFromNodes(editor, null))
      })
    })
  }, [editor])

  return null
}

/* ===========================================================
   LexicalEditor — 主组件
   =========================================================== */

export default function LexicalEditor({
  initialHtml = '',
  onChange,
  placeholder = '开始写作...',
  height = 420,
}: {
  initialHtml?: string
  onChange?: (html: string) => void
  placeholder?: string
  height?: number | string
}) {
  // editorState 工厂：LexicalComposer 创建时执行一次。
  // 工厂接收 editor 作为参数，此时处于 editor.update() 上下文。
  const editorState: InitialConfigType['editorState'] = initialHtml
    ? (editor) => {
        const root = $getRoot()
        root.clear()
        const dom = new DOMParser().parseFromString(initialHtml, 'text/html')
        const nodes = $generateNodesFromDOM(editor, dom)
        for (const n of nodes) root.append(n)
        if (nodes.length === 0) root.append($createParagraphNode())
      }
    : undefined

  const config: InitialConfigType = {
    namespace: 'ArticleEditor',
    theme,
    onError: (e: Error) => console.error('Lexical:', e),
    editorState,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode, AutoLinkNode],
  }

  return (
    <LexicalComposer key={initialHtml ? 'inited' : 'blank'} initialConfig={config}>
      <div className="lex-editor">
        <EditorToolbar />
        <div className="lex-body" style={{ minHeight: height }}>
          <RichTextPlugin
            contentEditable={<ContentEditable className="lex-content" style={{ minHeight: height }} />}
            placeholder={<div className="lex-placeholder">{placeholder}</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        {onChange && <OnChangePlugin onChange={onChange} />}
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <CodeHighlightPlugin />
        {/* Markdown 快捷语法：输入 # 、- 、1. 、> 等即时转换 */}
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      </div>
    </LexicalComposer>
  )
}
