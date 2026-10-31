import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import api from '../lib/api'
import Icon from '../components/ui/Icon'
import type { PersonalSpaceDto, PersonalSpaceUpdateInput } from '../types/personalSpace'

/* ============================================================
   工具与常量
   ============================================================ */

const SPACE_NAME_MAX = 30
const RUSTDESK_FIELD_MAX = 200
/** RustDesk 深链前缀：唤起本机客户端发起远程连接 */
const RUSTDESK_DEEP_LINK_PREFIX = 'rustdesk://connection/new/'

/** 提取接口错误里的中文信息（api 库 reject 的 Error.message 即 response.data.error） */
function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * 复制到剪贴板（失败返回 false，由调用方提示）。
 * 优先 async Clipboard API；生产为 IP 直连纯 HTTP（非安全上下文）时
 * navigator.clipboard 不存在或写入失败，降级 document.execCommand('copy')
 * （临时 textarea + Selection 方案），两者都失败才提示手动复制。
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 落到下方 execCommand 降级
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    // 移出可视区域但保持可聚焦选中（display:none 会导致选区失效）
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

/** Web 客户端地址是否合法（与服务端同规则：非空时必须 http/https 开头） */
function isValidWebClientUrl(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || /^https?:\/\//i.test(trimmed)
}

/** RustDesk 配置是否至少填了一项 */
function hasRustdeskConfig(input: Pick<PersonalSpaceDto, 'rustdeskIdServer' | 'rustdeskRelayServer' | 'rustdeskKey' | 'rustdeskWebClient'>): boolean {
  return [input.rustdeskIdServer, input.rustdeskRelayServer, input.rustdeskKey, input.rustdeskWebClient]
    .some((value) => value.trim() !== '')
}

/** 完整客户端配置文本（只包含已填写的项，供一键复制粘贴给其他设备） */
function buildClientConfigText(dto: PersonalSpaceDto): string {
  const lines: string[] = []
  if (dto.rustdeskIdServer) lines.push(`ID 服务器: ${dto.rustdeskIdServer}`)
  if (dto.rustdeskRelayServer) lines.push(`中继服务器: ${dto.rustdeskRelayServer}`)
  if (dto.rustdeskKey) lines.push(`Key: ${dto.rustdeskKey}`)
  if (dto.rustdeskWebClient) lines.push(`Web 客户端: ${dto.rustdeskWebClient}`)
  return lines.join('\n')
}

/* ============================================================
   页面
   ============================================================ */

/**
 * 个人空间：仅管理员可进的管理员私人服务页（路由能力 personal:manage）。
 * 数据按管理员互相隔离，服务端一管理员一行（GET 不存在时自动创建默认空间）。
 * 当前承载首个私人服务：RustDesk 远程桌面（配置卡片 + 快捷连接）。
 */
export default function PersonalSpacePage() {
  const [dto, setDto] = useState<PersonalSpaceDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  // RustDesk 配置表单（草稿，保存后才写入 dto）；空间名走独立的行内编辑（nameDraft）
  const [form, setForm] = useState<Omit<PersonalSpaceUpdateInput, 'spaceName'>>({
    rustdeskIdServer: '',
    rustdeskRelayServer: '',
    rustdeskKey: '',
    rustdeskWebClient: '',
  })
  // 空间名行内编辑
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // 快捷连接：被控端 ID
  const [connectId, setConnectId] = useState('')

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  const showToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    setToast({ text, tone })
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, 2_600)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await api.get<PersonalSpaceDto>('/personal-space')
      if (!mountedRef.current) return
      setDto(data)
      setForm({
        rustdeskIdServer: data.rustdeskIdServer,
        rustdeskRelayServer: data.rustdeskRelayServer,
        rustdeskKey: data.rustdeskKey,
        rustdeskWebClient: data.rustdeskWebClient,
      })
    } catch (err) {
      if (mountedRef.current) setLoadError(errMessage(err, '加载个人空间失败'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /**
   * 提交 PUT：spaceName 与 RustDesk 四字段整体保存，返回更新后的 DTO（失败返回 null 并提示）。
   * 只更新 dto 状态；RustDesk 表单草稿由调用方决定是否用返回值重置——
   * 行内改名成功后必须保留草稿（改的只是名字），否则未保存的配置输入会被静默丢弃。
   */
  const persist = useCallback(async (input: PersonalSpaceUpdateInput, successText: string): Promise<PersonalSpaceDto | null> => {
    setSaving(true)
    try {
      const data = await api.put<PersonalSpaceDto>('/personal-space', input)
      if (!mountedRef.current) return null
      setDto(data)
      showToast(successText, 'success')
      return data
    } catch (err) {
      showToast(errMessage(err, '保存失败，请稍后再试'), 'error')
      return null
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }, [showToast])

  /* ---------- 空间名行内编辑 ---------- */

  const startNameEdit = () => {
    if (!dto) return
    setNameDraft(dto.spaceName)
    setNameEditing(true)
  }

  const submitNameEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!dto || saving) return
    const name = nameDraft.trim()
    if (name.length < 1 || name.length > SPACE_NAME_MAX) {
      showToast(`空间名需为 1–${SPACE_NAME_MAX} 个字符`, 'error')
      return
    }
    const updated = await persist({
      spaceName: name,
      rustdeskIdServer: dto.rustdeskIdServer,
      rustdeskRelayServer: dto.rustdeskRelayServer,
      rustdeskKey: dto.rustdeskKey,
      rustdeskWebClient: dto.rustdeskWebClient,
    }, '空间名已更新')
    if (updated) setNameEditing(false)
  }

  /* ---------- RustDesk 配置 ---------- */

  const handleRustdeskSave = async () => {
    if (!dto || saving) return
    if (form.rustdeskWebClient.trim() !== '' && !isValidWebClientUrl(form.rustdeskWebClient)) {
      showToast('Web 客户端地址必须以 http:// 或 https:// 开头', 'error')
      return
    }
    const updated = await persist({ spaceName: dto.spaceName, ...form }, 'RustDesk 配置已保存')
    // 只有保存配置路径才用服务端返回值（trim / 规范化后）重置表单草稿
    if (updated) {
      setForm({
        rustdeskIdServer: updated.rustdeskIdServer,
        rustdeskRelayServer: updated.rustdeskRelayServer,
        rustdeskKey: updated.rustdeskKey,
        rustdeskWebClient: updated.rustdeskWebClient,
      })
    }
  }

  const openWebClient = () => {
    const url = dto?.rustdeskWebClient.trim() ?? ''
    if (!url || !/^https?:\/\//i.test(url)) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyText(text)
    showToast(ok ? `${label}已复制` : '复制失败，请手动选择文本复制', ok ? 'success' : 'error')
  }

  /* ---------- 快捷连接 ---------- */

  // 允许粘贴带空格的 ID（如 123 456 789），统一去掉空白后校验纯数字
  const normalizedConnectId = connectId.replace(/\s+/g, '')
  const connectIdValid = /^\d{1,20}$/.test(normalizedConnectId)
  const deepLink = `${RUSTDESK_DEEP_LINK_PREFIX}${normalizedConnectId}`

  const wakeRustdesk = () => {
    if (!connectIdValid) return
    // 自定义协议唤起本机 RustDesk 客户端（未安装时浏览器会弹协议选择/无反应）
    window.location.href = deepLink
  }

  /* ============================================================ */

  if (loading) {
    return (
      <div className="gh-page-container gh-ps-page">
        <div className="gh-ps-loading">
          <span className="gh-spinner" aria-hidden />
          <p>正在打开你的私人空间…</p>
        </div>
      </div>
    )
  }

  if (!dto) {
    return (
      <div className="gh-page-container gh-ps-page">
        <div className="gh-alert gh-alert--danger" role="alert">{loadError || '加载个人空间失败'}</div>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void load()}>
          重试
        </button>
      </div>
    )
  }

  const webClientReady = /^https?:\/\//i.test(dto.rustdeskWebClient.trim())
  const rustdeskConfigured = hasRustdeskConfig(dto)

  return (
    <div className="gh-page-container gh-ps-page">
      {toast && (
        <div className={`gh-ps-toast gh-ps-toast--${toast.tone}`} role="status">{toast.text}</div>
      )}

      <header className="gh-ps-head">
        <p className="gh-ps-eyebrow">LINEWEB PERSONAL</p>
        {nameEditing ? (
          <form className="gh-ps-name-edit" onSubmit={(e) => void submitNameEdit(e)}>
            <input
              className="gh-input gh-ps-name-input"
              value={nameDraft}
              maxLength={SPACE_NAME_MAX}
              autoFocus
              aria-label="空间名"
              onChange={(e) => setNameDraft(e.target.value)}
            />
            <button type="submit" className="gh-btn gh-btn--primary gh-btn--sm" disabled={saving}>保存</button>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setNameEditing(false)}>取消</button>
          </form>
        ) : (
          <h1 className="gh-ps-title">
            <Icon name="home" size={24} className="gh-ps-title-icon" />
            <span className="gh-ps-title-text">{dto.spaceName}</span>
            <button
              type="button"
              className="gh-ps-name-edit-btn"
              onClick={startNameEdit}
              title="重命名空间"
              aria-label="重命名空间"
            >
              <Icon name="edit" size={15} />
            </button>
          </h1>
        )}
        <p className="gh-ps-sub">
          仅管理员可见的私人空间，各位管理员的数据互相隔离。这里承载你的私人服务配置，不会对普通用户展示。
        </p>
      </header>

      {/* RustDesk 配置卡片 */}
      <section className="gh-ps-card">
        <header className="gh-ps-card-head">
          <h2 className="gh-ps-card-title">
            <span aria-hidden>🖥️</span> RustDesk 远程桌面
          </h2>
          <span className={`gh-ps-badge ${rustdeskConfigured ? 'gh-ps-badge--on' : 'gh-ps-badge--off'}`}>
            {rustdeskConfigured ? '已配置' : '未配置'}
          </span>
        </header>
        <p className="gh-ps-card-desc">
          保存自建 RustDesk 服务端信息（均可选）：配置好后可一键复制给其他设备、打开 Web 客户端，或直接输入被控 ID 唤起本机客户端发起连接。
        </p>

        <div className="gh-ps-grid">
          <label className="gh-ps-field">
            <span className="gh-ps-field-label">ID 服务器</span>
            <input
              className="gh-input"
              value={form.rustdeskIdServer}
              maxLength={RUSTDESK_FIELD_MAX}
              placeholder="如 rustdesk.example.com:21116"
              onChange={(e) => setForm((prev) => ({ ...prev, rustdeskIdServer: e.target.value }))}
            />
          </label>
          <label className="gh-ps-field">
            <span className="gh-ps-field-label">中继服务器</span>
            <input
              className="gh-input"
              value={form.rustdeskRelayServer}
              maxLength={RUSTDESK_FIELD_MAX}
              placeholder="如 rustdesk.example.com:21117"
              onChange={(e) => setForm((prev) => ({ ...prev, rustdeskRelayServer: e.target.value }))}
            />
          </label>
          <label className="gh-ps-field gh-ps-field--wide">
            <span className="gh-ps-field-label">公钥 Key</span>
            <input
              className="gh-input"
              value={form.rustdeskKey}
              maxLength={RUSTDESK_FIELD_MAX}
              placeholder="服务端公钥（id_ed25519.pub 的内容）"
              onChange={(e) => setForm((prev) => ({ ...prev, rustdeskKey: e.target.value }))}
            />
          </label>
          <label className="gh-ps-field gh-ps-field--wide">
            <span className="gh-ps-field-label">Web 客户端地址</span>
            <input
              className="gh-input"
              value={form.rustdeskWebClient}
              maxLength={RUSTDESK_FIELD_MAX}
              placeholder="以 http:// 或 https:// 开头"
              onChange={(e) => setForm((prev) => ({ ...prev, rustdeskWebClient: e.target.value }))}
            />
            <span className="gh-ps-field-hint">保存后可在下方一键打开浏览器版 RustDesk。</span>
          </label>
        </div>

        <div className="gh-ps-card-actions">
          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={saving} onClick={() => void handleRustdeskSave()}>
            {saving ? '保存中…' : '保存配置'}
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--sm"
            disabled={!webClientReady}
            title={webClientReady ? '在新窗口打开 Web 客户端' : '先在上方填写并保存 Web 客户端地址'}
            onClick={openWebClient}
          >
            打开 Web 客户端
          </button>
        </div>
      </section>

      {/* 配置摘要 + 一键复制（仅在已配置时展示） */}
      {rustdeskConfigured && (
        <section className="gh-ps-card">
          <header className="gh-ps-card-head">
            <h2 className="gh-ps-card-title"><span aria-hidden>📋</span> 配置摘要</h2>
          </header>
          <ul className="gh-ps-summary">
            {dto.rustdeskIdServer && (
              <li className="gh-ps-summary-row">
                <span className="gh-ps-summary-label">ID 服务器</span>
                <code className="gh-ps-summary-value">{dto.rustdeskIdServer}</code>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void handleCopy(dto.rustdeskIdServer, 'ID 服务器')}>
                  复制 ID 服务器
                </button>
              </li>
            )}
            {dto.rustdeskRelayServer && (
              <li className="gh-ps-summary-row">
                <span className="gh-ps-summary-label">中继服务器</span>
                <code className="gh-ps-summary-value">{dto.rustdeskRelayServer}</code>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void handleCopy(dto.rustdeskRelayServer, '中继服务器')}>
                  复制中继服务器
                </button>
              </li>
            )}
            {dto.rustdeskKey && (
              <li className="gh-ps-summary-row">
                <span className="gh-ps-summary-label">公钥 Key</span>
                <code className="gh-ps-summary-value">{dto.rustdeskKey}</code>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void handleCopy(dto.rustdeskKey, '公钥 Key')}>
                  复制 Key
                </button>
              </li>
            )}
            {dto.rustdeskWebClient && (
              <li className="gh-ps-summary-row">
                <span className="gh-ps-summary-label">Web 客户端</span>
                <code className="gh-ps-summary-value">{dto.rustdeskWebClient}</code>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void handleCopy(dto.rustdeskWebClient, 'Web 客户端地址')}>
                  复制地址
                </button>
              </li>
            )}
          </ul>
          <div className="gh-ps-card-actions">
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              onClick={() => void handleCopy(buildClientConfigText(dto), '完整客户端配置文本')}
              title="把全部已配置项复制成一段文本，方便粘贴到其他设备"
            >
              复制完整客户端配置文本
            </button>
          </div>
        </section>
      )}

      {/* 快捷连接 */}
      <section className="gh-ps-card">
        <header className="gh-ps-card-head">
          <h2 className="gh-ps-card-title"><span aria-hidden>🔗</span> 快捷连接</h2>
        </header>
        <p className="gh-ps-card-desc">
          输入被控端的 RustDesk ID（纯数字），生成 rustdesk:// 深链唤起本机客户端发起远程连接。需要本机已安装 RustDesk 客户端。
        </p>
        <div className="gh-ps-connect">
          <input
            className="gh-input gh-ps-connect-input"
            value={connectId}
            inputMode="numeric"
            placeholder="被控端 ID，如 123 456 789"
            aria-label="被控端 RustDesk ID"
            onChange={(e) => setConnectId(e.target.value)}
          />
          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={!connectIdValid} onClick={wakeRustdesk}>
            唤起本机 RustDesk
          </button>
          <button
            type="button"
            className="gh-btn gh-btn--secondary gh-btn--sm"
            disabled={!connectIdValid}
            onClick={() => void handleCopy(deepLink, '连接链接')}
          >
            复制连接链接
          </button>
        </div>
        {connectIdValid && (
          <p className="gh-ps-connect-link">
            将打开 <code>{deepLink}</code>
          </p>
        )}
      </section>

      {/* 更多服务占位 */}
      <section className="gh-ps-more">
        <p className="gh-ps-more-title">更多服务即将上线</p>
        <p className="gh-ps-more-sub">个人空间后续会加入更多管理员专属私人服务，敬请期待。</p>
      </section>
    </div>
  )
}
