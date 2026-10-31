import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import DOMPurify from 'dompurify'
import { usePageBySlug } from '../hooks/useQueries'
import { Button } from '../components/ui'

interface PageSchema {
  id: number
  title: string
  slug: string
  schema: string
}

interface ComponentData {
  id: string
  type: string
  props: Record<string, unknown>
  children: ComponentData[]
}

export default function DynamicPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: page, isLoading: loading, isError } = usePageBySlug(slug)
  const error = isError ? '页面不存在' : ''

  if (loading) {
    return (
      <div className="gh-page-container">
        <div className="gh-loading-row"><div className="gh-spinner" /></div>
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="gh-page-container">
        <div className="gh-empty-card gh-post-notfound">
          <h2>页面未找到</h2>
          <p className="gh-text-secondary">{error || '该页面不存在或尚未发布'}</p>
          <Button href="/features" variant="secondary">&larr; 返回功能界面</Button>
        </div>
      </div>
    )
  }

  let components: ComponentData[] = []
  try { components = JSON.parse(page.schema) } catch { components = [] }

  return (
    <div className="gh-page-container gh-dynamic-page">
      <div className="gh-dynamic-back">
        <Link to="/features" className="gh-post-back">&larr; 返回功能界面</Link>
      </div>

      <div className="gh-page-header">
        <h1 className="gh-page-title">{page.title}</h1>
      </div>

      <RenderComponents components={components} />
    </div>
  )
}

function RenderComponents({ components }: { components: ComponentData[] }) {
  return (
    <div className="gh-dynamic-html u-stack u-gap-4">
      {components.map(comp => <RenderComponent key={comp.id} comp={comp} />)}
    </div>
  )
}

function RenderComponent({ comp }: { comp: ComponentData }) {
  const sanitizedHtml = useMemo(
    () => comp.type === 'html' ? DOMPurify.sanitize((comp.props.html as string) || '') : '',
    [comp.type, comp.props.html],
  )

  switch (comp.type) {
    case 'heading': {
      const level = Math.min(4, Math.max(1, (comp.props.level as number) || 2))
      const text = (comp.props.text as string) || ''
      const s: React.CSSProperties = { margin: 0 }
      if (level === 1) return <h1 style={s}>{text}</h1>
      if (level === 2) return <h2 style={s}>{text}</h2>
      if (level === 3) return <h3 style={s}>{text}</h3>
      return <h4 style={s}>{text}</h4>
    }
    case 'paragraph':
      return <p style={{ margin: 0, lineHeight: 1.8 }}>{(comp.props.text as string) || ''}</p>
    case 'image': {
      const src = comp.props.src as string
      return src
        ? <img src={src} alt={(comp.props.alt as string) || ''} loading="lazy" style={{ maxWidth: '100%', borderRadius: 'var(--gh-radius)' }} />
        : null
    }
    case 'button': {
      const variant = ((comp.props.variant as string) || 'primary') as 'primary' | 'secondary' | 'danger' | 'ghost'
      const link = comp.props.link as string
      const text = (comp.props.text as string) || '按钮'
      if (link) {
        return <Button href={link} variant={variant}>{text}</Button>
      }
      return <Button variant={variant}>{text}</Button>
    }
    case 'divider':
      return <hr style={{ border: 'none', borderTop: '1px solid var(--gh-border)', margin: 0 }} />
    case 'spacer':
      return <div style={{ height: (comp.props.height as number) || 24 }} />
    case 'card':
      return (
        <div className="gh-box" style={{ padding: (comp.props.padding as number) || 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {comp.children.length > 0
              ? comp.children.map(child => <RenderComponent key={child.id} comp={child} />)
              : null
            }
          </div>
        </div>
      )
    case 'columns': {
      return (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {comp.children.map(child => (
            <div key={child.id} style={{ flex: '1 1 200px', minWidth: 0 }}>
              <RenderComponent comp={child} />
            </div>
          ))}
        </div>
      )
    }
    case 'list': {
      const items = (comp.props.items as string[]) || []
      const ordered = comp.props.ordered as boolean
      const Tag = ordered ? 'ol' : 'ul'
      return <Tag style={{ margin: 0, paddingLeft: 20 }}>{items.map((item, ii) => <li key={ii}>{item}</li>)}</Tag>
    }
    case 'html':
      return <div className="article-content gh-dynamic-html" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
    default:
      return null
  }
}
