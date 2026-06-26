import React, { useState, useEffect, useReducer, useRef, useCallback, type DragEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../lib/api'

/* ============================================================
   Types
   ============================================================ */

interface PageData {
  id: number; title: string; slug: string; schema: string
  published: boolean; featured: boolean; featureEmoji: string | null; featureDesc: string | null
}

interface ComponentSchema {
  id: string
  type: ComponentType
  props: Record<string, unknown>
  children: ComponentSchema[]
}

type ComponentType = 'heading' | 'paragraph' | 'image' | 'button' | 'divider'
  | 'list' | 'card' | 'columns' | 'spacer' | 'html'

interface PaletteItem {
  type: ComponentType; label: string; icon: string
  defaultProps: Record<string, unknown>
  defaultChildren?: ComponentSchema[]
}

interface EditorState {
  title: string; slug: string; published: boolean
  featured: boolean; featureEmoji: string; featureDesc: string
  components: ComponentSchema[]
  selectedId: string | null
  dragOverIndex: number | null; dropTargetId: string | null
  contextMenu: { x: number; y: number; componentId: string } | null
  saved: boolean; saving: boolean; loading: boolean
  step: 'module' | 'editor'
}

type EditorAction =
  | { type: 'SET_META'; title?: string; slug?: string; published?: boolean; featured?: boolean; featureEmoji?: string; featureDesc?: string }
  | { type: 'LOAD'; data: PageData }
  | { type: 'SET_STEP'; step: 'module' | 'editor' }
  | { type: 'ADD_COMPONENT'; component: ComponentSchema; index: number }
  | { type: 'ADD_CHILD_COMPONENT'; parentId: string; component: ComponentSchema }
  | { type: 'MOVE_COMPONENT'; fromIndex: number; toIndex: number }
  | { type: 'REMOVE_COMPONENT'; id: string }
  | { type: 'UPDATE_PROPS'; id: string; props: Record<string, unknown> }
  | { type: 'DUPLICATE_COMPONENT'; id: string }
  | { type: 'SELECT'; id: string | null }
  | { type: 'SET_DRAG_OVER'; index: number | null }
  | { type: 'SET_DROP_TARGET'; id: string | null }
  | { type: 'CONTEXT_MENU'; menu: EditorState['contextMenu'] }
  | { type: 'SET_SAVING'; saving: boolean }

/* ============================================================
   Palette
   ============================================================ */

const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'heading', label: '标题', icon: 'H', defaultProps: { level: 2, text: '标题文字' } },
  { type: 'paragraph', label: '段落', icon: '¶', defaultProps: { text: '这是一段演示文字。' } },
  { type: 'image', label: '图片', icon: '🖼', defaultProps: { src: '', alt: '', width: '100%' } },
  { type: 'button', label: '按钮', icon: '⊞', defaultProps: { text: '按钮', variant: 'primary', link: '' } },
  { type: 'divider', label: '分割线', icon: '—', defaultProps: {} },
  { type: 'spacer', label: '间距', icon: '⇕', defaultProps: { height: 32 } },
  { type: 'card', label: '玻璃卡片', icon: '▢', defaultProps: { padding: 24 }, defaultChildren: [] },
  { type: 'columns', label: '双栏布局', icon: '‖', defaultProps: { ratio: '1:1' }, defaultChildren: [
    { id: '', type: 'paragraph' as ComponentType, props: { text: '左栏' }, children: [] },
    { id: '', type: 'paragraph' as ComponentType, props: { text: '右栏' }, children: [] },
  ] },
  { type: 'list', label: '列表', icon: '☰', defaultProps: { items: ['项目一', '项目二', '项目三'], ordered: false } },
  { type: 'html', label: '自定义HTML', icon: '</>', defaultProps: { html: '<p style="color:var(--lg-text-secondary)">自定义内容</p>' } },
]

/* ============================================================
   Helpers
   ============================================================ */

let _nextId = 1
function genId(): string { return `comp_${Date.now()}_${_nextId++}` }

function deepCloneComponents(comps: ComponentSchema[]): ComponentSchema[] {
  return comps.map(c => ({ ...c, id: genId(), children: deepCloneComponents(c.children) }))
}

function makeComponent(item: PaletteItem): ComponentSchema {
  const children = item.defaultChildren
    ? item.defaultChildren.map(c => ({ ...c, id: genId(), props: { ...c.props }, children: [] as ComponentSchema[] }))
    : []
  return { id: genId(), type: item.type, props: { ...item.defaultProps }, children }
}

function addChildToTree(comps: ComponentSchema[], parentId: string, child: ComponentSchema): ComponentSchema[] {
  return comps.map(c => {
    if (c.id === parentId) return { ...c, children: [...c.children, child] }
    if (c.children.length > 0) return { ...c, children: addChildToTree(c.children, parentId, child) }
    return c
  })
}

function removeFromTree(comps: ComponentSchema[], targetId: string): ComponentSchema[] {
  const result: ComponentSchema[] = []
  for (const c of comps) {
    if (c.id === targetId) continue
    result.push(c.children.length > 0 ? { ...c, children: removeFromTree(c.children, targetId) } : c)
  }
  return result
}

function updateInTree(comps: ComponentSchema[], targetId: string, props: Record<string, unknown>): ComponentSchema[] {
  return comps.map(c =>
    c.id === targetId ? { ...c, props: { ...c.props, ...props } }
    : c.children.length > 0 ? { ...c, children: updateInTree(c.children, targetId, props) }
    : c
  )
}

function findInTree(comps: ComponentSchema[], targetId: string): ComponentSchema | null {
  for (const c of comps) {
    if (c.id === targetId) return c
    if (c.children.length > 0) { const f = findInTree(c.children, targetId); if (f) return f }
  }
  return null
}

/* ============================================================
   Reducer
   ============================================================ */

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_META': {
      const next = { ...state }
      if (action.title !== undefined) next.title = action.title
      if (action.slug !== undefined) next.slug = action.slug
      if (action.published !== undefined) next.published = action.published
      if (action.featured !== undefined) next.featured = action.featured
      if (action.featureEmoji !== undefined) next.featureEmoji = action.featureEmoji
      if (action.featureDesc !== undefined) next.featureDesc = action.featureDesc
      return next
    }
    case 'LOAD':
      return {
        ...state, loading: false,
        title: action.data.title, slug: action.data.slug,
        published: action.data.published, featured: action.data.featured,
        featureEmoji: action.data.featureEmoji || '', featureDesc: action.data.featureDesc || '',
        components: (() => { try { return JSON.parse(action.data.schema) } catch { return [] } })(),
        saved: true, step: 'editor',
      }
    case 'SET_STEP': return { ...state, step: action.step }
    case 'ADD_COMPONENT': {
      const comps = [...state.components]
      comps.splice(action.index, 0, action.component)
      return { ...state, components: comps, saved: false, selectedId: action.component.id }
    }
    case 'ADD_CHILD_COMPONENT':
      return { ...state, components: addChildToTree(state.components, action.parentId, action.component), saved: false, selectedId: action.component.id }
    case 'MOVE_COMPONENT': {
      const comps = [...state.components]
      const [moved] = comps.splice(action.fromIndex, 1)
      comps.splice(action.toIndex, 0, moved); return { ...state, components: comps, saved: false }
    }
    case 'REMOVE_COMPONENT':
      return { ...state, components: removeFromTree(state.components, action.id), selectedId: state.selectedId === action.id ? null : state.selectedId, saved: false }
    case 'UPDATE_PROPS':
      return { ...state, components: updateInTree(state.components, action.id, action.props), saved: false }
    case 'DUPLICATE_COMPONENT': {
      const idx = state.components.findIndex(c => c.id === action.id)
      if (idx === -1) return state
      const o = state.components[idx]
      const clone = { ...o, id: genId(), props: { ...o.props }, children: deepCloneComponents(o.children) }
      const comps = [...state.components]; comps.splice(idx + 1, 0, clone)
      return { ...state, components: comps, saved: false, selectedId: clone.id }
    }
    case 'SELECT': return { ...state, selectedId: action.id, contextMenu: null }
    case 'SET_DRAG_OVER': return { ...state, dragOverIndex: action.index }
    case 'SET_DROP_TARGET': return { ...state, dropTargetId: action.id }
    case 'CONTEXT_MENU': return { ...state, contextMenu: action.menu }
    case 'SET_SAVING': return { ...state, saving: action.saving }
    default: return state
  }
}

function defaultState(id?: string): EditorState {
  return {
    title: '', slug: id || '', published: false,
    featured: false, featureEmoji: '', featureDesc: '',
    components: [], selectedId: null,
    dragOverIndex: null, dropTargetId: null,
    contextMenu: null, saved: true, saving: false, loading: !!id,
    step: 'module',
  }
}

/* ============================================================
   Props Editor
   ============================================================ */

interface PropsEditorProps {
  comp: ComponentSchema
  onUpdate: (id: string, props: Record<string, unknown>) => void
  onAddChild: (parentId: string) => void
}

function PropsEditor({ comp, onUpdate, onAddChild }: PropsEditorProps) {
  const set = (key: string, value: unknown) => onUpdate(comp.id, { [key]: value })
  const T = (key: string, label: string, ph?: string) => (
    <div className="pe-field"><label className="pe-field-label">{label}</label><input className="lg-input" type="text" value={(comp.props[key] as string) || ''} onChange={e => set(key, e.target.value)} placeholder={ph} /></div>
  )
  const N = (key: string, label: string, min = 0) => (
    <div className="pe-field"><label className="pe-field-label">{label}</label><input className="lg-input" type="number" value={(comp.props[key] as number) ?? ''} onChange={e => set(key, parseInt(e.target.value) || min)} min={min} /></div>
  )
  const S = (key: string, label: string, opts: { value: string; label: string }[]) => (
    <div className="pe-field"><label className="pe-field-label">{label}</label><select className="lg-input" value={(comp.props[key] as string) || opts[0]?.value || ''} onChange={e => set(key, e.target.value)} style={{ cursor: 'pointer' }}>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
  )
  const TA = (key: string, label: string, rows = 4) => (
    <div className="pe-field"><label className="pe-field-label">{label}</label><textarea className="lg-input" style={{ fontFamily: 'var(--lg-font-mono)', fontSize: '0.82rem', resize: 'vertical', minHeight: 60 }} rows={rows} value={(comp.props[key] as string) || ''} onChange={e => set(key, e.target.value)} /></div>
  )

  const render = () => {
    switch (comp.type) {
      case 'heading': return <div className="pe-fields">{S('level', '级别', [{ value: '1', label: 'H1' }, { value: '2', label: 'H2' }, { value: '3', label: 'H3' }, { value: '4', label: 'H4' }])}{T('text', '文字内容')}</div>
      case 'paragraph': return <div className="pe-fields">{TA('text', '段落文字', 6)}</div>
      case 'image': return <div className="pe-fields">{T('src', '图片URL')}{T('alt', '替代文字')}{T('width', '宽度')}</div>
      case 'button': return <div className="pe-fields">{T('text', '按钮文字')}{S('variant', '样式', [{ value: 'primary', label: '主要' }, { value: 'glass', label: '玻璃' }, { value: 'ghost', label: '幽灵' }, { value: 'danger', label: '危险' }])}{T('link', '链接地址')}</div>
      case 'spacer': return <div className="pe-fields">{N('height', '高度 (px)', 4)}</div>
      case 'card': return <div className="pe-fields">{N('padding', '内边距 (px)', 0)}<div className="pe-hint">子组件在画布中管理</div></div>
      case 'columns': return <div className="pe-fields">{S('ratio', '比例', [{ value: '1:1', label: '1:1' }, { value: '1:2', label: '1:2' }, { value: '2:1', label: '2:1' }])}<div className="pe-hint">子组件在画布中管理</div></div>
      case 'list': return (
        <div className="pe-fields">
          <label className="pe-field-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!comp.props.ordered} onChange={e => set('ordered', e.target.checked)} style={{ accentColor: 'var(--lg-accent)' }} />有序列表
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {((comp.props.items as string[]) || ['']).map((item, ii) => (
              <input key={ii} className="lg-input" type="text" value={item} onChange={e => { const items = [...((comp.props.items as string[]) || [])]; items[ii] = e.target.value; set('items', items) }} placeholder={`项目 ${ii + 1}`} />
            ))}
            <button className="pe-add-item-btn" onClick={() => set('items', [...((comp.props.items as string[]) || []), ''])}>+ 添加项目</button>
          </div>
        </div>
      )
      case 'html': return <div className="pe-fields">{TA('html', 'HTML 代码', 8)}</div>
      case 'divider': return <div className="pe-hint">分割线无需额外配置</div>
      default: return <div className="pe-hint">无可配置属性</div>
    }
  }
  return (<>{render()}{(comp.type === 'card' || comp.type === 'columns') && <div className="pe-add-child-btn-wrap"><button className="pe-add-item-btn" onClick={() => onAddChild(comp.id)} style={{ width: '100%', textAlign: 'center' }}>+ 向此{comp.type === 'card' ? '卡片' : '布局'}添加组件</button></div>}</>)
}

/* ============================================================
   PreviewComponent — 纯渲染，所有事件通过 data 属性委托
   ============================================================ */

interface PreviewProps {
  comp: ComponentSchema
  selectedId: string | null
  dropTargetId: string | null
  onChildDragOver: (e: DragEvent<HTMLDivElement>, parentId: string) => void
  onChildDrop: (e: DragEvent<HTMLDivElement>, parentId: string) => void
}

const PreviewComponent = React.memo(function PreviewComponent({
  comp, selectedId, dropTargetId, onChildDragOver, onChildDrop,
}: PreviewProps) {
  const isSelected = selectedId === comp.id

  const renderInner = (): React.ReactNode => {
    switch (comp.type) {
      case 'heading': {
        const level = Math.min(4, Math.max(1, (comp.props.level as number) || 2))
        const text = (comp.props.text as string) || '标题'
        const s: React.CSSProperties = { margin: 0 }
        if (level === 1) return <h1 style={s}>{text}</h1>
        if (level === 2) return <h2 style={s}>{text}</h2>
        if (level === 3) return <h3 style={s}>{text}</h3>
        return <h4 style={s}>{text}</h4>
      }
      case 'paragraph': return <p style={{ margin: 0 }}>{(comp.props.text as string) || '段落文字'}</p>
      case 'image': {
        const src = comp.props.src as string
        return src
          ? <img src={src} alt={(comp.props.alt as string) || ''} style={{ maxWidth: '100%', borderRadius: 'var(--lg-radius-sm)', display: 'block' }} />
          : <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--lg-radius-sm)', padding: 32, textAlign: 'center', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>点击选择图片</div>
      }
      case 'button': {
        const variant = (comp.props.variant as string) || 'primary'
        return <div className="page-editor-btn-wrap"><span className={`liquid-btn ${variant} md`}>{(comp.props.text as string) || '按钮'}<span className="btn-flare" /></span></div>
      }
      case 'divider': return <hr style={{ border: 'none', borderTop: '1px solid var(--lg-glass-border)', margin: 0 }} />
      case 'spacer': return <div style={{ height: (comp.props.height as number) || 24 }} />
      case 'card':
        return (
          <div
            className={`lg-surface ${dropTargetId === comp.id ? 'page-editor-drop-active' : ''} ${isSelected ? 'page-editor-container-selected' : ''}`}
            data-component-id={comp.id}
            style={{ padding: (comp.props.padding as number) || 24, position: 'relative' }}
            onDragOver={(e) => onChildDragOver(e as unknown as DragEvent<HTMLDivElement>, comp.id)}
            onDrop={(e) => onChildDrop(e as unknown as DragEvent<HTMLDivElement>, comp.id)}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {comp.children.length > 0
                ? comp.children.map(child => (
                    <PreviewComponent key={child.id} comp={child} selectedId={selectedId} dropTargetId={dropTargetId}
                      onChildDragOver={onChildDragOver} onChildDrop={onChildDrop} />
                  ))
                : <span style={{ color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>拖入组件到此卡片</span>
              }
            </div>
            {dropTargetId === comp.id && <div className="page-editor-inner-drop-hint">释放以添加到卡片</div>}
          </div>
        )
      case 'columns':
        return (
          <div data-component-id={comp.id} style={{ display: 'flex', gap: 16, position: 'relative' }}
            className={isSelected ? 'page-editor-container-selected' : ''}
            onDragOver={(e) => onChildDragOver(e as unknown as DragEvent<HTMLDivElement>, comp.id)}
            onDrop={(e) => onChildDrop(e as unknown as DragEvent<HTMLDivElement>, comp.id)}
          >
            {comp.children.length > 0
              ? comp.children.map(child => (
                  <div key={child.id} style={{ flex: 1, minWidth: 0 }}>
                    <PreviewComponent comp={child} selectedId={selectedId} dropTargetId={dropTargetId}
                      onChildDragOver={onChildDragOver} onChildDrop={onChildDrop} />
                  </div>
                ))
              : <div style={{ flex: 1, color: 'var(--lg-text-tertiary)', fontSize: '0.85rem', textAlign: 'center', padding: 24 }}>空列</div>
            }
            {dropTargetId === comp.id && <div className="page-editor-inner-drop-hint">释放以添加到布局</div>}
          </div>
        )
      case 'list': {
        const items = (comp.props.items as string[]) || []
        const ordered = comp.props.ordered as boolean
        const Tag = ordered ? 'ol' : 'ul'
        return <Tag style={{ margin: 0, paddingLeft: 20 }}>{items.map((item, ii) => <li key={ii}>{item}</li>)}</Tag>
      }
      case 'html': return <div dangerouslySetInnerHTML={{ __html: (comp.props.html as string) || '' }} />
      default: return <div style={{ color: 'var(--lg-text-tertiary)' }}>未知组件</div>
    }
  }

  return (
    <div className={`page-editor-canvas-component ${isSelected ? 'page-editor-canvas-component--selected' : ''}`}
      data-component-id={comp.id}>
      {renderInner()}
    </div>
  )
})

/* ============================================================
   Main Component
   ============================================================ */

export default function PageEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEditMode = !!id

  const [state, dispatch] = useReducer(editorReducer, id, defaultState)
  const [error, setError] = useState('')
  const [pageError, setPageError] = useState('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragTypeRef = useRef<string | null>(null)
  const selected = (state.selectedId ? findInTree(state.components, state.selectedId) : null) || null

  // Load existing page in edit mode
  useEffect(() => {
    if (!isEditMode) return
    api.get<PageData>(`/pages/${id}`).then(data => dispatch({ type: 'LOAD', data })).catch(() => setPageError('无法加载页面'))
  }, [id])

  /* ---- Drag source (palette) ---- */

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, type: ComponentType) => {
    dragTypeRef.current = type
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', type)
  }, [])

  const handleDragEnd = useCallback(() => {
    dispatch({ type: 'SET_DRAG_OVER', index: null })
    dispatch({ type: 'SET_DROP_TARGET', id: null })
    dragTypeRef.current = null
  }, [])

  const createComp = useCallback((type: ComponentType): ComponentSchema | null => {
    const item = PALETTE_ITEMS.find(p => p.type === type)
    return item ? makeComponent(item) : null
  }, [])

  /* ---- Canvas root drop ---- */

  const handleCanvasDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    const dropIndex = Math.min(state.components.length, Math.max(0, Math.round((y / rect.height) * state.components.length)))
    dispatch({ type: 'SET_DRAG_OVER', index: dropIndex })
    dispatch({ type: 'SET_DROP_TARGET', id: null })
  }, [state.components.length])

  const handleCanvasDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const comp = createComp(e.dataTransfer.getData('text/plain') as ComponentType)
    if (!comp) return
    dispatch({ type: 'ADD_COMPONENT', component: comp, index: state.dragOverIndex ?? state.components.length })
    dispatch({ type: 'SET_DRAG_OVER', index: null }); dispatch({ type: 'SET_DROP_TARGET', id: null })
  }, [state.dragOverIndex, createComp])

  /* ---- Child container drop ---- */

  const handleChildDragOver = useCallback((e: DragEvent<HTMLDivElement>, parentId: string) => {
    e.preventDefault(); e.stopPropagation()
    dispatch({ type: 'SET_DROP_TARGET', id: parentId }); dispatch({ type: 'SET_DRAG_OVER', index: null })
  }, [])

  const handleChildDrop = useCallback((e: DragEvent<HTMLDivElement>, parentId: string) => {
    e.preventDefault(); e.stopPropagation()
    const comp = createComp(e.dataTransfer.getData('text/plain') as ComponentType)
    dispatch({ type: 'SET_DROP_TARGET', id: null }); dispatch({ type: 'SET_DRAG_OVER', index: null })
    if (comp) dispatch({ type: 'ADD_CHILD_COMPONENT', parentId, component: comp })
  }, [createComp])

  /* ---- Selection (event delegation on canvas) ---- */

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    // 查找最近的 data-component-id 祖先
    let target = e.target as HTMLElement | null
    let compId: string | null = null
    while (target && target !== e.currentTarget) {
      if (target.dataset.componentId) { compId = target.dataset.componentId; break }
      target = target.parentElement
    }
    if (compId) {
      dispatch({ type: 'SELECT', id: compId })
      dispatch({ type: 'CONTEXT_MENU', menu: null })
    } else {
      dispatch({ type: 'SELECT', id: null })
      dispatch({ type: 'CONTEXT_MENU', menu: null })
    }
  }, [])

  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    let target = e.target as HTMLElement | null
    let compId: string | null = null
    while (target && target !== e.currentTarget) {
      if (target.dataset.componentId) { compId = target.dataset.componentId; break }
      target = target.parentElement
    }
    if (compId) {
      e.preventDefault()
      dispatch({ type: 'CONTEXT_MENU', menu: { x: e.clientX, y: e.clientY, componentId: compId } })
    }
  }, [])

  useEffect(() => {
    if (!state.contextMenu) return
    const handler = () => dispatch({ type: 'CONTEXT_MENU', menu: null })
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [state.contextMenu])

  const handleDelete = useCallback(() => {
    if (!state.selectedId) return
    dispatch({ type: 'REMOVE_COMPONENT', id: state.selectedId })
    dispatch({ type: 'CONTEXT_MENU', menu: null })
  }, [state.selectedId])

  const handleDuplicate = useCallback(() => {
    if (!state.selectedId) return
    dispatch({ type: 'DUPLICATE_COMPONENT', id: state.selectedId })
    dispatch({ type: 'CONTEXT_MENU', menu: null })
  }, [state.selectedId])

  const handleMove = useCallback((dir: -1 | 1) => {
    if (!state.selectedId) return
    const idx = state.components.findIndex(c => c.id === state.selectedId)
    if (idx === -1) return
    const toIndex = Math.max(0, Math.min(state.components.length - 1, idx + dir))
    if (toIndex === idx) return
    dispatch({ type: 'MOVE_COMPONENT', fromIndex: idx, toIndex })
    dispatch({ type: 'CONTEXT_MENU', menu: null })
  }, [state.selectedId, state.components])

  const handleAddChild = useCallback((parentId: string) => {
    dispatch({ type: 'ADD_CHILD_COMPONENT', parentId, component: makeComponent(PALETTE_ITEMS[1]) })
  }, [])

  /* ---- Save / Publish ---- */

  const validate = (): boolean => {
    setError('')
    const errs: Record<string, string> = {}
    if (!state.title.trim()) errs.title = '请输入页面标题'
    if (!state.slug.trim()) errs.slug = '请输入 Slug'
    else if (!/^[a-z0-9-]+$/.test(state.slug)) errs.slug = 'Slug 只能包含小写字母、数字和连字符'
    if (state.featured) {
      if (!state.featureEmoji.trim()) errs.featureEmoji = '请选择图标'
      if (!state.featureDesc.trim()) errs.featureDesc = '请输入简介'
    }
    setValidationErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async (publish = false) => {
    if (!validate()) return
    dispatch({ type: 'SET_SAVING', saving: true })
    try {
      const body = {
        title: state.title.trim(), slug: state.slug.trim(),
        schema: JSON.stringify(state.components),
        published: publish ? true : state.published,
        featured: state.featured,
        featureEmoji: state.featured ? state.featureEmoji.trim() : null,
        featureDesc: state.featured ? state.featureDesc.trim() : null,
      }
      if (isEditMode) { await api.put(`/pages/${id}`, body) }
      else { await api.post('/pages', body) }
      dispatch({ type: 'SET_SAVING', saving: false })
      dispatch({ type: 'SET_META', published: body.published })
      navigate('/admin/pages')
    } catch (err: unknown) {
      dispatch({ type: 'SET_SAVING', saving: false })
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  /* ---- Render ---- */

  if (pageError) return <div className="admin-page"><div className="editor-error">{pageError}</div></div>
  if (state.loading) return <div className="admin-page"><div className="admin-spinner"><div className="spinner" /></div></div>

  const compCount = state.components.length

  /* ===== Module Setup Step ===== */

  if (state.step === 'module') {
    return (
      <div className="page-editor">
        <div className="page-editor-topbar">
          <div className="page-editor-topbar-left">
            <button className="page-editor-back-btn" onClick={() => navigate('/admin/pages')}>← 返回</button>
            <div className="page-editor-topbar-divider" />
            <span className="page-editor-step-label">新建页面 · 第 1 步</span>
          </div>
          <div className="page-editor-topbar-right">
            {error && <span className="page-editor-error-inline">{error}</span>}
            <button className="liquid-btn glass md" onClick={() => handleSave(false)} disabled={state.saving}>{state.saving ? '保存中…' : '保存草稿'}<span className="btn-flare" /></button>
            <button className="liquid-btn primary md" onClick={() => handleSave(true)} disabled={state.saving}>{state.saving ? '发布中…' : '发布'}<span className="btn-flare" /></button>
          </div>
        </div>
        {error && <div className="page-editor-error-banner"><span>{error}</span></div>}
        <div className="page-editor-module-setup">
          <div className="page-editor-module-setup-card">
            <div className="page-editor-module-setup-title">模块设定</div>
            <div className="page-editor-module-setup-desc">设置此页面在功能界面中的展示信息</div>
            <div className="pe-field">
              <label className="pe-field-label">页面标题</label>
              <input className="lg-input" type="text" value={state.title} onChange={e => dispatch({ type: 'SET_META', title: e.target.value })}
                placeholder={validationErrors.title ? '⚠ 必填' : '例如：关于我们'}
                style={validationErrors.title ? { border: '1px solid rgba(255,59,48,0.3)' } : undefined} />
              {validationErrors.title && <span className="pe-field-err">{validationErrors.title}</span>}
            </div>
            <div className="pe-field">
              <label className="pe-field-label">Slug（URL地址）</label>
              <input className="lg-input" type="text" value={state.slug} onChange={e => dispatch({ type: 'SET_META', slug: e.target.value })}
                placeholder={validationErrors.slug ? '⚠ 必填' : 'about-us'} disabled={isEditMode}
                style={validationErrors.slug ? { border: '1px solid rgba(255,59,48,0.3)' } : undefined} />
              {validationErrors.slug && <span className="pe-field-err">{validationErrors.slug}</span>}
              {!validationErrors.slug && <span className="pe-field-hint">全站唯一，只能使用小写字母、数字和连字符</span>}
            </div>
            <div className="pe-divider" />
            <label className="pe-toggle">
              <input type="checkbox" checked={state.featured} onChange={e => dispatch({ type: 'SET_META', featured: e.target.checked })} />
              <span className="pe-toggle-slider" /> <span className="pe-toggle-label">在功能界面展示此页面</span>
            </label>
            {state.featured && (
              <div className="pe-featured-fields" style={{ animation: 'fadeIn 0.3s ease both' }}>
                <div className="pe-field">
                  <label className="pe-field-label">图标（Emoji）</label>
                  <input className="lg-input" type="text" value={state.featureEmoji} onChange={e => dispatch({ type: 'SET_META', featureEmoji: e.target.value })}
                    placeholder={validationErrors.featureEmoji ? '⚠ 必填' : '例如：🌟'}
                    style={validationErrors.featureEmoji ? { border: '1px solid rgba(255,59,48,0.3)' } : undefined} />
                  {validationErrors.featureEmoji && <span className="pe-field-err">{validationErrors.featureEmoji}</span>}
                </div>
                <div className="pe-field">
                  <label className="pe-field-label">简介</label>
                  <input className="lg-input" type="text" value={state.featureDesc} onChange={e => dispatch({ type: 'SET_META', featureDesc: e.target.value })}
                    placeholder={validationErrors.featureDesc ? '⚠ 必填' : '例如：了解我们的故事和愿景'}
                    style={validationErrors.featureDesc ? { border: '1px solid rgba(255,59,48,0.3)' } : undefined} />
                  {validationErrors.featureDesc && <span className="pe-field-err">{validationErrors.featureDesc}</span>}
                </div>
              </div>
            )}
            <div className="pe-divider" />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="liquid-btn ghost md" onClick={() => navigate('/admin/pages')}>取消</button>
              <button className="liquid-btn primary md" onClick={() => dispatch({ type: 'SET_STEP', step: 'editor' })}>下一步：编辑页面内容</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ===== Editor Step ===== */

  return (
    <div className="page-editor">
      <div className="page-editor-topbar">
        <div className="page-editor-topbar-left">
          <button className="page-editor-back-btn" onClick={() => navigate('/admin/pages')}>← 返回</button>
          <div className="page-editor-topbar-divider" />
          <input className="page-editor-title-input" type="text" value={state.title}
            onChange={e => dispatch({ type: 'SET_META', title: e.target.value })}
            placeholder={validationErrors.title ? '⚠ 必填' : '页面标题'}
            style={validationErrors.title ? { border: '1px solid rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.06)' } : undefined} />
          {validationErrors.title && <span className="page-editor-err-badge">必填</span>}
          {state.featured && <span className="page-editor-module-badge">功能模块</span>}
        </div>
        <div className="page-editor-topbar-right">
          <button className="liquid-btn glass md" onClick={() => handleSave(false)} disabled={state.saving}>{state.saving ? '保存中…' : '保存草稿'}<span className="btn-flare" /></button>
          <button className="liquid-btn primary md" onClick={() => handleSave(true)} disabled={state.saving}>{state.saving ? '发布中…' : '发布'}<span className="btn-flare" /></button>
        </div>
      </div>

      {error && <div className="page-editor-error-banner"><span>{error}</span>{validationErrors.slug && <span> — {validationErrors.slug}</span>}</div>}

      <div className="page-editor-body">
        <aside className="page-editor-palette">
          <div className="page-editor-palette-header">控件仓库</div>
          <div className="page-editor-palette-grid">
            {PALETTE_ITEMS.map(item => (
              <div key={item.type} className="page-editor-palette-item" draggable
                onDragStart={e => handleDragStart(e, item.type)} onDragEnd={handleDragEnd}>
                <span className="page-editor-palette-icon">{item.icon}</span>
                <span className="page-editor-palette-label">{item.label}</span>
              </div>
            ))}
          </div>
        </aside>

        <main ref={canvasRef} className="page-editor-canvas" onClick={handleCanvasClick} onContextMenu={handleCanvasContextMenu}
          onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}>
          {compCount === 0 ? (
            <div className="page-editor-canvas-empty">
              <div className="page-editor-canvas-empty-icon">⊞</div>
              <div className="page-editor-canvas-empty-text">从左侧拖拽组件到此处</div>
              <div className="page-editor-canvas-empty-hint">或点击各组件配置属性</div>
            </div>
          ) : (
            <div className="page-editor-canvas-components">
              {state.components.map((comp, index) => (
                <div key={comp.id} className="page-editor-canvas-item-wrap">
                  {state.dragOverIndex === index && state.dropTargetId === null && (
                    <div className="page-editor-drop-indicator"><span>释放以在此处添加</span></div>
                  )}
                  <div className={`page-editor-canvas-item ${state.selectedId === comp.id ? 'page-editor-canvas-item--selected' : ''}`}>
                    <div className="page-editor-canvas-item-tools">
                      <span className="page-editor-canvas-item-type">{comp.type}</span>
                      <button className="page-editor-canvas-item-tool-btn" onClick={() => handleMove(-1)} disabled={index === 0} title="上移">↑</button>
                      <button className="page-editor-canvas-item-tool-btn" onClick={() => handleMove(1)} disabled={index === compCount - 1} title="下移">↓</button>
                      <button className="page-editor-canvas-item-tool-btn" onClick={() => dispatch({ type: 'DUPLICATE_COMPONENT', id: comp.id })} title="复制">⧉</button>
                      <button className="page-editor-canvas-item-tool-btn page-editor-canvas-item-tool-btn--danger" onClick={() => dispatch({ type: 'REMOVE_COMPONENT', id: comp.id })} title="删除">✕</button>
                    </div>
                    <PreviewComponent comp={comp} selectedId={state.selectedId} dropTargetId={state.dropTargetId}
                      onChildDragOver={handleChildDragOver} onChildDrop={handleChildDrop} />
                  </div>
                </div>
              ))}
              {state.dragOverIndex === compCount && state.dropTargetId === null && (
                <div className="page-editor-drop-indicator"><span>释放以在此处添加</span></div>
              )}
            </div>
          )}
          {compCount > 0 && (
            <div className="page-editor-canvas-footer" onDragOver={e => e.preventDefault()} onDrop={e => {
              e.preventDefault()
              const comp = createComp(e.dataTransfer.getData('text/plain') as ComponentType)
              if (comp) dispatch({ type: 'ADD_COMPONENT', component: comp, index: compCount })
            }}>
              <span className="page-editor-canvas-footer-text">拖拽组件到此追加</span>
            </div>
          )}
        </main>

        <aside className="page-editor-props">
          {selected ? (
            <>
              <div className="page-editor-props-header">属性配置<span className="page-editor-props-type">{selected.type}</span></div>
              <div className="page-editor-props-body">
                <PropsEditor comp={selected} onUpdate={(id, props) => dispatch({ type: 'UPDATE_PROPS', id, props })} onAddChild={handleAddChild} />
              </div>
            </>
          ) : (
            <>
              <div className="page-editor-props-header">页面设置</div>
              <div className="page-editor-props-body">
                <div className="pe-field">
                  <label className="pe-field-label">页面标题</label>
                  <input className="lg-input" type="text" value={state.title} onChange={e => dispatch({ type: 'SET_META', title: e.target.value })}
                    placeholder={validationErrors.title ? '⚠ 必填' : '页面标题'}
                    style={validationErrors.title ? { border: '1px solid rgba(255,59,48,0.3)' } : undefined} />
                  {validationErrors.title && <span className="pe-field-err">{validationErrors.title}</span>}
                </div>
                <div className="pe-field">
                  <label className="pe-field-label">Slug</label>
                  <input className="lg-input" type="text" value={state.slug} onChange={e => dispatch({ type: 'SET_META', slug: e.target.value })}
                    placeholder={validationErrors.slug ? '⚠ 必填' : 'my-page'} disabled={isEditMode}
                    style={validationErrors.slug ? { border: '1px solid rgba(255,59,48,0.3)' } : undefined} />
                  {validationErrors.slug && <span className="pe-field-err">{validationErrors.slug}</span>}
                  {!validationErrors.slug && <span className="pe-field-hint">只能使用小写字母、数字和连字符</span>}
                </div>
                <div className="pe-field">
                  <label className="pe-field-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={state.published} onChange={e => dispatch({ type: 'SET_META', published: e.target.checked })} style={{ accentColor: 'var(--lg-accent)' }} />已发布
                  </label>
                </div>
                <div className="pe-divider" style={{ margin: '12px 0' }} />
                <label className="pe-toggle">
                  <input type="checkbox" checked={state.featured} onChange={e => dispatch({ type: 'SET_META', featured: e.target.checked })} />
                  <span className="pe-toggle-slider" /><span className="pe-toggle-label">展示在功能界面</span>
                </label>
                {error && <div className="editor-error" style={{ marginTop: 12 }}>{error}</div>}
              </div>
            </>
          )}
        </aside>
      </div>

      {state.contextMenu && (
        <div className="page-editor-context-menu" style={{ left: state.contextMenu.x, top: state.contextMenu.y }} onClick={e => e.stopPropagation()}>
          <button className="page-editor-context-item" onClick={() => { dispatch({ type: 'SELECT', id: state.contextMenu!.componentId }); dispatch({ type: 'CONTEXT_MENU', menu: null }) }}>选择</button>
          <button className="page-editor-context-item" onClick={() => { handleDuplicate(); dispatch({ type: 'CONTEXT_MENU', menu: null }) }}>复制</button>
          <div className="page-editor-context-divider" />
          <button className="page-editor-context-item" onClick={() => { dispatch({ type: 'REMOVE_COMPONENT', id: state.contextMenu!.componentId }); dispatch({ type: 'CONTEXT_MENU', menu: null }) }}>删除</button>
        </div>
      )}
    </div>
  )
}
