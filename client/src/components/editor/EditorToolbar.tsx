import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $createParagraphNode,
  $createTextNode,
  $createLineBreakNode,
  $insertNodes,
  $getRoot,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { useEffect, useRef, useState } from 'react'
import { $findMatchingParent } from '@lexical/utils'
import {
  $isHeadingNode,
  $createHeadingNode,
  type HeadingTagType,
} from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
} from '@lexical/list'
import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text'
import { $createCodeNode, $isCodeNode } from '@lexical/code'
import { $createLinkNode, $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html'
import type { ReactNode } from 'react'
import { aiWritePolish, markdownToHtml, type PolishAction } from '../../lib/aiWrite'
import AiDraftDialog from './AiDraftDialog'

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'quote' | 'code'

/* ---------------- toolbar button ---------------- */

interface BtnProps {
  icon: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title?: string
}

function Btn({ icon, label, active, disabled, onClick, title }: BtnProps) {
  return (
    <button
      className={`lex-btn${active ? ' lex-btn--on' : ''}`}
      onClick={onClick}
      title={title}
      type="button"
      aria-label={title || label}
      disabled={disabled}
    >
      {icon}
    </button>
  )
}

/* ---------------- component ---------------- */

export default function EditorToolbar() {
  const [editor] = useLexicalComposerContext()
  const [blockType, setBlockType] = useState<BlockType>('paragraph')
  const [fm, setFm] = useState({ bold: false, italic: false, underline: false, strikethrough: false, link: false })

  const [menu, setMenu] = useState<'none' | 'ai' | 'link'>('none')
  const [linkUrl, setLinkUrl] = useState('https://')
  const [aiBusy, setAiBusy] = useState<PolishAction | null>(null)
  const [aiNote, setAiNote] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement>(null)
  const noteTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const unsub = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => readState(editor, setBlockType, setFm))
    })
    return unsub
  }, [editor])

  // 点击外部关闭弹出菜单
  useEffect(() => {
    if (menu === 'none') return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu('none')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const flashNote = (msg: string) => {
    setAiNote(msg)
    window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setAiNote(''), 5000)
  }

  /* ------------- commands (plain functions — editor is stable, useCallback is redundant) ------------- */

  const toParagraph = () => { editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createParagraphNode()) }) }

  const toggleHeading = (tag: HeadingTagType) => {
    if (blockType === tag) { toParagraph(); return }
    editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createHeadingNode(tag)) })
  }

  const toggleQuote = () => {
    if (blockType === 'quote') { toParagraph(); return }
    editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createQuoteNode()) })
  }

  const toggleCode = () => {
    if (blockType === 'code') { toParagraph(); return }
    editor.update(() => { const s = $getSelection(); if ($isRangeSelection(s)) $setBlocksType(s, () => $createCodeNode()) })
  }

  const toggleList = (t: 'bullet' | 'number') => {
    if (blockType === t) { editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined) }
    else { editor.dispatchCommand(t === 'bullet' ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined) }
  }

  /* ---------------- link (inline popover, no more window.prompt) ---------------- */

  const openLinkMenu = () => {
    if (fm.link) { editor.dispatchCommand(TOGGLE_LINK_COMMAND, null); return }
    setLinkUrl('https://')
    setMenu('link')
  }

  const applyLink = () => {
    const url = linkUrl.trim()
    if (!url || url === 'https://') { flashNote('请输入有效的链接地址'); return }
    editor.update(() => {
      const s = $getSelection()
      if ($isRangeSelection(s)) {
        if (s.isCollapsed()) {
          // 无选区时插入以 URL 为文本的链接节点
          const linkNode = $createLinkNode(url)
          linkNode.append($createTextNode(url))
          $insertNodes([linkNode])
        } else {
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
        }
      }
    })
    setMenu('none')
  }

  /* ---------------- AI actions ---------------- */

  const selectedText = (): string => {
    let text = ''
    editor.getEditorState().read(() => {
      const s = $getSelection()
      if ($isRangeSelection(s)) text = s.getTextContent()
    })
    return text.trim()
  }

  const runPolish = async (action: PolishAction) => {
    setMenu('none')
    const text = selectedText()
    if (!text) { flashNote('请先在正文中选中要处理的文字'); return }
    setAiBusy(action)
    try {
      const result = await aiWritePolish(text, action)
      const parts = result.split(/\n+/).map(s => s.trim()).filter(Boolean)
      editor.update(() => {
        const s = $getSelection()
        if ($isRangeSelection(s)) {
          const nodes: LexicalNode[] = []
          parts.forEach((p, i) => {
            if (i > 0) nodes.push($createLineBreakNode())
            nodes.push($createTextNode(p))
          })
          $insertNodes(nodes)
        }
      })
    } catch (err) {
      flashNote(err instanceof Error ? err.message : 'AI 处理失败')
    } finally {
      setAiBusy(null)
    }
  }

  const insertMarkdown = (md: string) => {
    editor.update(() => {
      const dom = new DOMParser().parseFromString(markdownToHtml(md), 'text/html')
      const nodes = $generateNodesFromDOM(editor, dom)
      if (nodes.length === 0) return
      const s = $getSelection()
      if ($isRangeSelection(s)) {
        $insertNodes(nodes)
      } else {
        // 无选区（如刚打开页面）时追加到文末
        const root = $getRoot()
        for (const n of nodes) root.append(n)
      }
    })
  }

  return (
    <div className="lex-tb-wrap">
      <div className="lex-tb" role="toolbar" aria-label="编辑器工具栏">
        <span className="lex-grp">
          <Btn icon="↩" label="撤销" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)} title="撤销 (Ctrl+Z)" />
          <Btn icon="↪" label="重做" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)} title="重做 (Ctrl+Shift+Z)" />
        </span>
        <span className="lex-div" />
        <span className="lex-grp">
          <Btn icon={<>H<sub>1</sub></>} label="标题 1" active={blockType === 'h1'} onClick={() => toggleHeading('h1')} />
          <Btn icon={<>H<sub>2</sub></>} label="标题 2" active={blockType === 'h2'} onClick={() => toggleHeading('h2')} />
          <Btn icon={<>H<sub>3</sub></>} label="标题 3" active={blockType === 'h3'} onClick={() => toggleHeading('h3')} />
        </span>
        <span className="lex-div" />
        <span className="lex-grp">
          <Btn icon={<b>B</b>} label="粗体" active={fm.bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} title="粗体 (Ctrl+B)" />
          <Btn icon={<i>I</i>} label="斜体" active={fm.italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} title="斜体 (Ctrl+I)" />
          <Btn icon={<u>U</u>} label="下划线" active={fm.underline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} title="下划线 (Ctrl+U)" />
          <Btn icon={<s>S</s>} label="删除线" active={fm.strikethrough} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} />
        </span>
        <span className="lex-div" />
        <span className="lex-grp">
          <Btn icon="•" label="无序列表" active={blockType === 'bullet'} onClick={() => toggleList('bullet')} />
          <Btn icon="1." label="有序列表" active={blockType === 'number'} onClick={() => toggleList('number')} />
        </span>
        <span className="lex-div" />
        <span className="lex-grp">
          <Btn icon="❝" label="引用" active={blockType === 'quote'} onClick={toggleQuote} />
          <Btn icon="⟨/⟩" label="代码块" active={blockType === 'code'} onClick={toggleCode} />
          <span className="lex-menu-anchor" ref={menu === 'link' ? menuRef : undefined}>
            <Btn icon="🔗" label="链接" active={fm.link || menu === 'link'} onClick={openLinkMenu} />
            {menu === 'link' && (
              <div className="gh-popover lex-link-pop">
                <input
                  className="gh-input"
                  autoFocus
                  value={linkUrl}
                  placeholder="输入链接地址"
                  onChange={e => setLinkUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } }}
                />
                <div className="lex-link-actions">
                  <button type="button" className="gh-btn gh-btn--sm gh-btn--primary" onClick={applyLink}>确定</button>
                  <button type="button" className="gh-btn gh-btn--sm gh-btn--ghost" onClick={() => setMenu('none')}>取消</button>
                </div>
              </div>
            )}
          </span>
        </span>
        <span className="lex-div" />
        <span className="lex-grp" ref={menu === 'ai' ? menuRef : undefined}>
          <Btn
            icon={aiBusy ? '…' : '✨ AI'}
            label="AI 助手"
            active={menu === 'ai'}
            disabled={aiBusy !== null}
            onClick={() => setMenu(m => m === 'ai' ? 'none' : 'ai')}
          />
          {menu === 'ai' && (
            <div className="gh-popover lex-ai-menu">
              <button type="button" className="gh-popover-item" onClick={() => runPolish('polish')}>✍️ 润色选中文字</button>
              <button type="button" className="gh-popover-item" onClick={() => runPolish('expand')}>📈 扩写选中文字</button>
              <button type="button" className="gh-popover-item" onClick={() => runPolish('fix')}>🧹 纠正错别字/语法</button>
              <div className="gh-popover-divider" />
              <button type="button" className="gh-popover-item" onClick={() => { setMenu('none'); setDraftOpen(true) }}>🤖 AI 起稿…</button>
            </div>
          )}
        </span>
      </div>

      {aiNote && <div className="lex-note" role="status">{aiNote}</div>}

      <AiDraftDialog
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        onInsert={md => { insertMarkdown(md); flashNote('AI 草稿已插入正文（Ctrl+Z 可撤销）') }}
      />
    </div>
  )
}

/* ---------------- single-pass readState ---------------- */

function readState(editor: LexicalEditor, setBlockType: (b: BlockType) => void, setFm: React.Dispatch<React.SetStateAction<{ bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean; link: boolean }>>) {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return

  setFm({ bold: selection.hasFormat('bold'), italic: selection.hasFormat('italic'), underline: selection.hasFormat('underline'), strikethrough: selection.hasFormat('strikethrough'), link: false })

  // Single ancestor walk for link + block type
  const firstNode = selection.anchor.getNode()
  let node: LexicalNode | null = firstNode
  let isLink = false
  let blockFound: BlockType = 'paragraph'
  let doneLink = false
  let doneBlock = false

  while (node && !(doneLink && doneBlock)) {
    if (!doneLink && $isLinkNode(node)) { isLink = true; doneLink = true }
    if (!doneBlock) {
      const parent = node.getParent()
      if (!parent || $isRootOrShadowRoot(parent)) {
        if ($isHeadingNode(node)) blockFound = node.getTag() as BlockType
        else if ($isListNode(node)) blockFound = node.getListType() === 'number' ? 'number' : 'bullet'
        else if ($isQuoteNode(node)) blockFound = 'quote'
        else if ($isCodeNode(node)) blockFound = 'code'
        doneBlock = true
      }
    }
    node = node.getParent?.() ?? null
  }

  setFm(prev => {
    const next = { bold: selection.hasFormat('bold'), italic: selection.hasFormat('italic'), underline: selection.hasFormat('underline'), strikethrough: selection.hasFormat('strikethrough'), link: isLink }
    if (prev.bold === next.bold && prev.italic === next.italic && prev.underline === next.underline && prev.strikethrough === next.strikethrough && prev.link === next.link) return prev
    return next
  })
  setBlockType(blockFound)
}
