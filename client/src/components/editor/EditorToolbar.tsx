import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { useEffect, useState } from 'react'
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
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import type { ReactNode } from 'react'

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'quote' | 'code'

/* ---------------- toolbar button ---------------- */

interface BtnProps {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
  title?: string
}

function Btn({ icon, active, onClick, title }: BtnProps) {
  return (
    <button
      className={`lex-btn${active ? ' lex-btn--on' : ''}`}
      onClick={onClick}
      title={title}
      type="button"
      aria-label={title}
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

  useEffect(() => {
    const unsub = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => readState(editor, setBlockType, setFm))
    })
    return unsub
  }, [editor])

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

  const toggleLink = () => {
    if (fm.link) { editor.dispatchCommand(TOGGLE_LINK_COMMAND, null); return }
    const url = window.prompt('输入链接 URL：', 'https://')
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
  }

  return (
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
        <Btn icon="🔗" label="链接" active={fm.link} onClick={toggleLink} />
      </span>
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
  let node: import('lexical').LexicalNode | null = firstNode
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
