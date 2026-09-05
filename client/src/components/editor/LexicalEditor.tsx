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

export interface LexicalEditorProps {
  initialHtml?: string
  onChange?: (html: string) => void
  placeholder?: string
  /**
   * 仅在「外部整体替换正文」时递增（如恢复本地草稿），迫使 Composer 重建。
   * 不能由 initialHtml 派生 key：编辑器自身的 onChange 回写会让 key 翻转，
   * 新建文章敲第一个字就会重挂载，导致丢焦点、滚动位置归零。
   */
  resetKey?: number
}

/* 高度等布局全部交给 CSS（.lex-* / .article-editor-work）控制，组件不设内联尺寸 */
export default function LexicalEditor({
  initialHtml = '',
  onChange,
  placeholder = '开始写作...',
  resetKey = 0,
}: LexicalEditorProps) {
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
    <LexicalComposer key={`article-${resetKey}`} initialConfig={config}>
      <div className="lex-editor">
        <EditorToolbar />
        <div className="lex-body">
          <RichTextPlugin
            contentEditable={<ContentEditable className="lex-content" />}
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
