import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import DOMPurify from 'dompurify'
import api from '../lib/api'
import LiquidButton from '../components/glass/LiquidButton'

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
  const [page, setPage] = useState<PageSchema | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) return
    api.get<PageSchema>(`/pages/slug/${slug}`)
      .then(setPage)
      .catch(() => setError('页面不存在'))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div className="page container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '120px' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="page container" style={{ textAlign: 'center', paddingTop: '120px' }}>
        <h2 style={{ marginBottom: 16 }}>页面未找到</h2>
        <p className="text-secondary" style={{ marginBottom: 24 }}>{error || '该页面不存在或尚未发布'}</p>
        <Link to="/features" className="liquid-btn glass md" target="_blank" rel="noopener noreferrer">
          ← 返回功能界面
          <span className="btn-flare" />
        </Link>
      </div>
    )
  }

  let components: ComponentData[] = []
  try { components = JSON.parse(page.schema) } catch { components = [] }

  return (
    <div className="page container" style={{ maxWidth: '800px', paddingTop: 'calc(var(--lg-nav-height) + 60px)' }}>
      <div style={{ marginBottom: 32 }}>
        <Link to="/features" className="text-tertiary" style={{ fontSize: '0.85rem' }} target="_blank" rel="noopener noreferrer">
          ← 返回功能界面
        </Link>
      </div>
      <h1 style={{ marginBottom: 32 }}>{page.title}</h1>
      <RenderComponents components={components} />
    </div>
  )
}

function RenderComponents({ components }: { components: ComponentData[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {components.map(comp => <RenderComponent key={comp.id} comp={comp} />)}
    </div>
  )
}

function RenderComponent({ comp }: { comp: ComponentData }) {
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
        ? <img src={src} alt={(comp.props.alt as string) || ''} style={{ maxWidth: '100%', borderRadius: 'var(--lg-radius-md)' }} />
        : null
    }
    case 'button': {
      const variant = ((comp.props.variant as string) || 'primary') as 'primary' | 'glass' | 'ghost' | 'danger'
      const link = comp.props.link as string
      const text = (comp.props.text as string) || '按钮'
      if (link) {
        return <LiquidButton href={link} variant={variant} size="md">{text}</LiquidButton>
      }
      return <LiquidButton variant={variant} size="md">{text}</LiquidButton>
    }
    case 'divider':
      return <hr style={{ border: 'none', borderTop: '1px solid var(--lg-glass-border)', margin: 0 }} />
    case 'spacer':
      return <div style={{ height: (comp.props.height as number) || 24 }} />
    case 'card':
      return (
        <div className="lg-surface" style={{ padding: (comp.props.padding as number) || 24 }}>
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
      return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize((comp.props.html as string) || '') }} />
    default:
      return null
  }
}
