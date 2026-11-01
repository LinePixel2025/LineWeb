import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { useTheme } from '../contexts/ThemeContext'
import api from '../lib/api'
import type { ThemeBuyResult, ThemeCatalogItem, ThemeFilter, ThemeSort, ThemesView } from '../types/theme'

/** 试穿时长：60 秒后自动还原，避免用户忘了自己还在「试穿」状态里 */
const PREVIEW_MS = 60_000
/** 骨架卡片数量：与常见首屏列数（3 列 × 2 行）对齐，避免布局跳动 */
const SKELETON_COUNT = 6

const FILTERS: ReadonlyArray<readonly [ThemeFilter, string]> = [
  ['all', '全部'],
  ['owned', '已拥有'],
  ['affordable', '可购买'],
  ['rare', '稀有'],
  ['epic', '史诗'],
  ['legendary', '传说'],
]

/** 提取接口错误里的中文信息（api 库 reject 的 Error.message 即 response.data.error） */
function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatPoints(value: number): string {
  return value.toLocaleString('zh-CN')
}

function sortThemes(list: ThemeCatalogItem[], sort: ThemeSort): ThemeCatalogItem[] {
  return [...list].sort((a, b) => (sort === 'price-asc' ? a.price - b.price : b.price - a.price))
}

function stateLabel(theme: ThemeCatalogItem): string {
  if (theme.equipped) return '已佩戴'
  if (theme.owned) return '已拥有'
  return '未解锁'
}

function emptyTextFor(filter: ThemeFilter): string {
  if (filter === 'owned') return '还没有解锁付费主题：先在下方商店挑一套，试穿满意再买。'
  if (filter === 'affordable') return '当前积分还买不下任何主题，去积分中心或游戏大厅赚一点吧。'
  return '这个筛选下没有主题。'
}

/* ============================================================
   迷你站点预览：用主题自带的 4 个色板现场画一个「小 LineWeb」，
   不使用任何外链图片 —— 商店卡片本身就是主题的说明书。
   ============================================================ */

function ThemeMockup({ theme, large = false }: { theme: ThemeCatalogItem; large?: boolean }) {
  return (
    <div
      className={`gh-themes-mini ${large ? 'gh-themes-mini--large' : ''}`}
      style={{ background: theme.previewGradient } as CSSProperties}
      aria-hidden
    >
      <div className="gh-themes-mini-window" style={{ background: theme.swatches[0] } as CSSProperties}>
        <div className="gh-themes-mini-side" style={{ background: theme.swatches[1] } as CSSProperties}>
          <span className="gh-themes-mini-logo" style={{ background: theme.swatches[2] } as CSSProperties} />
          <span className="gh-themes-mini-nav" style={{ background: theme.swatches[3] } as CSSProperties} />
          <span className="gh-themes-mini-nav gh-themes-mini-nav--dim" style={{ background: theme.swatches[3] } as CSSProperties} />
          <span className="gh-themes-mini-nav gh-themes-mini-nav--dimmer" style={{ background: theme.swatches[3] } as CSSProperties} />
        </div>
        <div className="gh-themes-mini-body">
          <div className="gh-themes-mini-top" style={{ background: theme.swatches[1] } as CSSProperties}>
            <span className="gh-themes-mini-pill" style={{ background: theme.swatches[3] } as CSSProperties} />
            <span className="gh-themes-mini-dot" style={{ background: theme.swatches[2] } as CSSProperties} />
          </div>
          <div className="gh-themes-mini-content">
            <div className="gh-themes-mini-card" style={{ background: theme.swatches[1] } as CSSProperties}>
              <span className="gh-themes-mini-line" style={{ background: theme.swatches[3] } as CSSProperties} />
              <span className="gh-themes-mini-line gh-themes-mini-line--short" style={{ background: theme.swatches[3] } as CSSProperties} />
              <span className="gh-themes-mini-btn" style={{ background: theme.swatches[2] } as CSSProperties} />
            </div>
            <div className="gh-themes-mini-card gh-themes-mini-card--ghost" style={{ background: theme.swatches[1] } as CSSProperties}>
              <span className="gh-themes-mini-line gh-themes-mini-line--tiny" style={{ background: theme.swatches[3] } as CSSProperties} />
              <span className="gh-themes-mini-line gh-themes-mini-line--tiny" style={{ background: theme.swatches[3] } as CSSProperties} />
              <span className="gh-themes-mini-line gh-themes-mini-line--tiny gh-themes-mini-line--short" style={{ background: theme.swatches[3] } as CSSProperties} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   主题卡
   ============================================================ */

interface ThemeCardProps {
  theme: ThemeCatalogItem
  /** 正在进行的操作标识（`buy:<key>` / `equip:<key>` / `clear`），用于按钮 loading */
  busy: string | null
  onPreview: (theme: ThemeCatalogItem) => void
  onBuy: (theme: ThemeCatalogItem) => void
  onEquip: (theme: ThemeCatalogItem) => void
}

function ThemeCard({ theme, busy, onPreview, onBuy, onEquip }: ThemeCardProps) {
  const buying = busy === `buy:${theme.key}`
  const equipping = busy === `equip:${theme.key}`
  const anyBusy = busy !== null

  return (
    <article
      className={`gh-themes-card gh-themes-card--${theme.rarity}${theme.equipped ? ' gh-themes-card--equipped' : ''}`}
    >
      <ThemeMockup theme={theme} />
      <div className="gh-themes-card-body">
        <div className="gh-themes-card-head">
          <h3 className="gh-themes-card-name">{theme.name}</h3>
          <span className={`gh-themes-badge gh-themes-badge--${theme.rarity}`}>{theme.rarityLabel}</span>
        </div>
        <p className="gh-themes-card-tagline">{theme.tagline}</p>
        <p className="gh-themes-card-desc" title={theme.description}>{theme.description}</p>

        <div className="gh-themes-card-meta">
          <span className="gh-themes-price">
            {theme.isDefault ? '免费' : `${formatPoints(theme.price)} 积分`}
          </span>
          <span
            className={`gh-themes-state${theme.equipped ? ' gh-themes-state--equipped' : theme.owned ? ' gh-themes-state--owned' : ''}`}
          >
            {stateLabel(theme)}
          </span>
        </div>

        <div className="gh-themes-card-actions">
          {theme.owned ? (
            <>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                onClick={() => onEquip(theme)}
                disabled={theme.equipped || anyBusy}
              >
                {equipping ? '佩戴中…' : theme.equipped ? '当前佩戴' : '佩戴'}
              </button>
              {!theme.equipped && (
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => onPreview(theme)}>
                  试穿全站
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                onClick={() => onBuy(theme)}
                disabled={!theme.affordable || anyBusy}
                title={theme.affordable ? undefined : '积分不足'}
              >
                {buying ? '购买中…' : `购买 · ${formatPoints(theme.price)} 积分`}
              </button>
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => onPreview(theme)}>
                试穿全站
              </button>
            </>
          )}
        </div>
        {!theme.owned && !theme.affordable && (
          <p className="gh-themes-card-hint">
            积分不足 · <Link to="/points">去赚积分</Link>
          </p>
        )}
      </div>
    </article>
  )
}

/* ============================================================
   页面
   ============================================================ */

export default function ThemesPage() {
  const {
    themesView: view,
    siteTheme,
    previewTheme,
    activeTheme,
    applyTheme,
    clearTheme,
    startPreview,
    endPreview,
    refreshThemes,
  } = useTheme()

  const [loading, setLoading] = useState(!view)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<ThemeFilter>('all')
  const [sort, setSort] = useState<ThemeSort>('price-asc')
  /** 购买确认框里正在确认的主题 key（用 key 而不是对象，余额刷新后弹窗数据自动跟随） */
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  /** 试穿剩余秒数（驱动浮动条上的倒计时与进度条） */
  const [previewLeft, setPreviewLeft] = useState(0)

  const catalog = view?.catalog ?? []
  const balance = view?.balance ?? 0

  const paidThemes = useMemo(() => catalog.filter((item) => !item.isDefault), [catalog])
  const ownedThemes = useMemo(
    () => sortThemes(catalog.filter((item) => item.owned), 'price-asc'),
    [catalog],
  )

  const counts = useMemo(() => {
    const result = { all: paidThemes.length, owned: 0, affordable: 0, rare: 0, epic: 0, legendary: 0 }
    for (const item of paidThemes) {
      if (item.owned) result.owned += 1
      if (item.affordable) result.affordable += 1
      result[item.rarity] += 1
    }
    return result
  }, [paidThemes])

  const visibleThemes = useMemo(() => {
    const filtered = paidThemes.filter((item) => {
      if (filter === 'all') return true
      if (filter === 'owned') return item.owned
      if (filter === 'affordable') return item.affordable
      return item.rarity === filter
    })
    return sortThemes(filtered, sort)
  }, [paidThemes, filter, sort])

  const activeItem = catalog.find((item) => item.key === activeTheme) ?? null
  const previewItem = previewTheme ? catalog.find((item) => item.key === previewTheme) ?? null : null
  const confirmItem = confirmKey ? catalog.find((item) => item.key === confirmKey) ?? null : null

  /* ---------- 首次进入拉取视图 ---------- */
  useEffect(() => {
    let cancelled = false
    refreshThemes()
      .then(() => { if (!cancelled) setLoading(false) })
      .catch((err) => {
        if (cancelled) return
        setError(errMessage(err, '加载主题失败，请刷新重试'))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [refreshThemes])

  /* ---------- 试穿倒计时：到点自动还原 ---------- */
  useEffect(() => {
    if (!previewTheme) {
      setPreviewLeft(0)
      return undefined
    }
    const until = Date.now() + PREVIEW_MS
    setPreviewLeft(Math.ceil(PREVIEW_MS / 1000))
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000))
      setPreviewLeft(left)
      if (left <= 0) {
        window.clearInterval(timer)
        endPreview()
        setNotice('试穿时间到，已恢复当前主题')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [previewTheme, endPreview])

  /* ---------- 离开页面务必结束试穿，避免把「试穿」带进其它页面 ---------- */
  const endPreviewRef = useRef(endPreview)
  useEffect(() => { endPreviewRef.current = endPreview }, [endPreview])
  useEffect(() => () => { endPreviewRef.current() }, [])

  /* ---------- 购买 / 佩戴按钮逻辑 ---------- */
  const handleEndPreview = useCallback(() => {
    endPreview()
  }, [endPreview])

  const handlePreview = useCallback((theme: ThemeCatalogItem) => {
    // 试穿已佩戴的主题没有任何意义（页面对已佩戴卡片也不渲染试穿按钮）
    if (theme.key === siteTheme) return
    setError('')
    setNotice('')
    startPreview(theme.key)
  }, [siteTheme, startPreview])

  const handleEquip = useCallback(async (theme: ThemeCatalogItem) => {
    if (busy) return
    setBusy(`equip:${theme.key}`)
    setError('')
    setNotice('')
    try {
      await applyTheme(theme.key)
      await refreshThemes()
      setNotice(theme.isDefault ? '已恢复默认主题' : `已佩戴《${theme.name}》，全站立即生效`)
    } catch (err) {
      setError(errMessage(err, '佩戴失败，请稍后再试'))
    } finally {
      setBusy(null)
    }
  }, [applyTheme, busy, refreshThemes])

  const handleRestoreDefault = useCallback(async () => {
    if (busy) return
    setBusy('clear')
    setError('')
    setNotice('')
    try {
      await clearTheme()
      await refreshThemes()
      setNotice('已恢复默认主题')
    } catch (err) {
      setError(errMessage(err, '恢复默认主题失败，请稍后再试'))
    } finally {
      setBusy(null)
    }
  }, [busy, clearTheme, refreshThemes])

  const handleConfirmBuy = useCallback(async () => {
    if (!confirmItem || busy) return
    setBusy(`buy:${confirmItem.key}`)
    setError('')
    setNotice('')
    try {
      const result = await api.post<ThemeBuyResult>(`/themes/${encodeURIComponent(confirmItem.key)}/buy`)
      setConfirmKey(null)
      setNotice(`已解锁《${result.theme.name}》，花费 ${formatPoints(result.theme.price)} 积分，并已自动佩戴`)
      // 服务端已把新主题设为 equipped：refreshThemes 会同步余额、拥有列表与 <html> 属性
      await refreshThemes()
    } catch (err) {
      setError(errMessage(err, '购买失败，请稍后再试'))
    } finally {
      setBusy(null)
    }
  }, [busy, confirmItem, refreshThemes])

  /* ---------- 购买确认框：Esc 关闭 ---------- */
  useEffect(() => {
    if (!confirmKey) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmKey(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmKey])

  const previewPercent = Math.max(0, Math.min(100, Math.round((previewLeft * 1000 / PREVIEW_MS) * 100)))

  return (
    <div className="gh-page-container gh-themes-page">
      <header className="gh-themes-hero">
        <div className="gh-themes-hero-main">
          <p className="gh-themes-eyebrow">
            <Icon name="palette" size={14} />
            THEMES
          </p>
          <h1 className="gh-themes-title">LineWeb 主题</h1>
          <p className="gh-themes-sub">
            用积分兑换一套覆盖整站的主题：背景、卡片、侧边栏、按钮、强调色与阴影一起换。
            每套都可以先试穿 60 秒，满意再购买；购买后永久拥有，随时能切回默认主题。
          </p>
          <div className="gh-themes-hero-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/points">去赚积分</Link>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--md"
              onClick={handleRestoreDefault}
              disabled={activeTheme === 'default' || busy !== null}
            >
              {busy === 'clear' ? '恢复中…' : '恢复默认主题'}
            </button>
          </div>
        </div>
        <div className="gh-themes-hero-card">
          <span className="gh-themes-hero-label">我的积分</span>
          <strong className="gh-themes-hero-value">{formatPoints(balance)}</strong>
          <div className="gh-themes-current">
            <span className="gh-themes-current-name">
              {previewTheme ? '试穿中' : '当前主题'}
              <strong>{previewItem?.name ?? activeItem?.name ?? '默认主题'}</strong>
            </span>
            <span className="gh-themes-chips" aria-hidden>
              {(activeItem?.swatches ?? []).map((color, index) => (
                <span key={`${color}-${index}`} className="gh-themes-chip" style={{ background: color } as CSSProperties} />
              ))}
            </span>
          </div>
        </div>
      </header>

      {error && <div className="gh-alert gh-alert--danger gh-themes-alert" role="alert">{error}</div>}
      {notice && <div className="gh-alert gh-alert--success gh-themes-alert" role="status">{notice}</div>}

      <section className="gh-themes-owned" aria-labelledby="gh-themes-owned-title">
        <div className="gh-themes-section-head">
          <h2 id="gh-themes-owned-title">我的主题</h2>
          <p>已解锁 {ownedThemes.length} / {catalog.length} 套 · 点一下即可全站佩戴</p>
        </div>
        {loading && !view ? (
          <div className="gh-themes-owned-row" aria-hidden>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="gh-themes-owned-card gh-themes-owned-card--skeleton">
                <span className="gh-skeleton gh-themes-owned-swatch" />
                <span className="gh-skeleton gh-themes-skeleton-line" />
              </div>
            ))}
          </div>
        ) : (
          <div className="gh-themes-owned-row">
            {ownedThemes.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`gh-themes-owned-card${item.equipped ? ' gh-themes-owned-card--active' : ''}`}
                onClick={() => handleEquip(item)}
                disabled={item.equipped || busy !== null}
                aria-pressed={item.equipped}
              >
                <span className="gh-themes-owned-swatch" style={{ background: item.previewGradient } as CSSProperties} aria-hidden />
                <span className="gh-themes-owned-text">
                  <strong>{item.name}</strong>
                  <span>{item.equipped ? '佩戴中' : busy === `equip:${item.key}` ? '切换中…' : '点击佩戴'}</span>
                </span>
                {item.equipped && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="gh-themes-store" aria-labelledby="gh-themes-store-title">
        <div className="gh-themes-section-head">
          <h2 id="gh-themes-store-title">主题商店</h2>
          <p>稀有度只代表视觉分量，不影响功能；所有主题都覆盖整站视觉令牌。</p>
        </div>

        <div className="gh-themes-toolbar">
          <div className="gh-themes-filters" role="group" aria-label="筛选主题">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`gh-themes-filter${filter === value ? ' gh-themes-filter--active' : ''}`}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
                <span className="gh-themes-filter-count">{counts[value]}</span>
              </button>
            ))}
          </div>
          <label className="gh-themes-sort">
            <span>排序</span>
            <select
              className="gh-input gh-themes-select"
              value={sort}
              onChange={(event) => {
                const next = event.target.value
                if (next === 'price-asc' || next === 'price-desc') setSort(next)
              }}
            >
              <option value="price-asc">价格从低到高</option>
              <option value="price-desc">价格从高到低</option>
            </select>
          </label>
        </div>

        {loading && !view ? (
          <div className="gh-themes-grid" aria-hidden>
            {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
              <div key={index} className="gh-themes-card gh-themes-card--skeleton">
                <span className="gh-skeleton gh-themes-skeleton-cover" />
                <div className="gh-themes-card-body">
                  <span className="gh-skeleton gh-themes-skeleton-title" />
                  <span className="gh-skeleton gh-themes-skeleton-line" />
                  <span className="gh-skeleton gh-themes-skeleton-line gh-themes-skeleton-line--short" />
                  <span className="gh-skeleton gh-themes-skeleton-btn" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleThemes.length === 0 ? (
          <div className="gh-box gh-themes-empty">
            <p>{emptyTextFor(filter)}</p>
            {filter !== 'all' && (
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setFilter('all')}>
                查看全部主题
              </button>
            )}
          </div>
        ) : (
          <div className="gh-themes-grid">
            {visibleThemes.map((item) => (
              <ThemeCard
                key={item.key}
                theme={item}
                busy={busy}
                onPreview={handlePreview}
                onBuy={(theme) => { setError(''); setConfirmKey(theme.key) }}
                onEquip={handleEquip}
              />
            ))}
          </div>
        )}
      </section>

      {previewTheme && (
        <div className="gh-themes-trial" role="status">
          <span className="gh-themes-trial-swatch" style={{ background: previewItem?.previewGradient ?? 'transparent' } as CSSProperties} aria-hidden />
          <div className="gh-themes-trial-text">
            <strong>正在试穿《{previewItem?.name ?? previewTheme}》</strong>
            <span>
              {previewItem?.owned
                ? '这套主题已经拥有'
                : `试穿不消耗积分 · ${formatPoints(previewItem?.price ?? 0)} 积分即可永久拥有`}
              {' · '}
              {previewLeft} 秒后自动还原
            </span>
            <span className="gh-themes-trial-track" aria-hidden>
              <span className="gh-themes-trial-bar" style={{ width: `${previewPercent}%` } as CSSProperties} />
            </span>
          </div>
          <div className="gh-themes-trial-actions">
            {previewItem && !previewItem.owned && (
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                onClick={() => { setError(''); setConfirmKey(previewItem.key) }}
                disabled={!previewItem.affordable || busy !== null}
                title={previewItem.affordable ? undefined : '积分不足'}
              >
                立即购买
              </button>
            )}
            {previewItem?.owned && !previewItem.equipped && (
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                onClick={() => handleEquip(previewItem)}
                disabled={busy !== null}
              >
                {busy === `equip:${previewItem.key}` ? '佩戴中…' : '佩戴这套'}
              </button>
            )}
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={handleEndPreview}>
              还原
            </button>
          </div>
        </div>
      )}

      {confirmItem && (
        <div
          className="gh-themes-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmKey(null)
          }}
        >
          <div className="gh-themes-dialog" role="dialog" aria-modal="true" aria-labelledby="gh-themes-dialog-title">
            <ThemeMockup theme={confirmItem} large />
            <div className="gh-themes-dialog-body">
              <h2 id="gh-themes-dialog-title">解锁《{confirmItem.name}》</h2>
              <p className="gh-themes-dialog-desc">{confirmItem.description}</p>
              <dl className="gh-themes-dialog-rows">
                <div>
                  <dt>价格</dt>
                  <dd>{formatPoints(confirmItem.price)} 积分</dd>
                </div>
                <div>
                  <dt>当前余额</dt>
                  <dd>{formatPoints(balance)} 积分</dd>
                </div>
                <div>
                  <dt>购买后余额</dt>
                  <dd className={balance < confirmItem.price ? 'gh-themes-dialog-short' : ''}>
                    {formatPoints(balance - confirmItem.price)} 积分
                  </dd>
                </div>
              </dl>
              {balance < confirmItem.price && (
                <p className="gh-themes-dialog-hint">
                  积分不足，还差 {formatPoints(confirmItem.price - balance)} 积分 · <Link to="/points">去赚积分</Link>
                </p>
              )}
              <p className="gh-themes-dialog-note">购买后立即自动佩戴，永久拥有，可随时切回默认主题。</p>
              <div className="gh-themes-dialog-actions">
                <button
                  type="button"
                  className="gh-btn gh-btn--secondary gh-btn--md"
                  onClick={() => setConfirmKey(null)}
                  disabled={busy === `buy:${confirmItem.key}`}
                  autoFocus
                >
                  再想想
                </button>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--md"
                  onClick={handleConfirmBuy}
                  disabled={balance < confirmItem.price || busy !== null}
                >
                  {busy === `buy:${confirmItem.key}` ? '购买中…' : `确认购买 · ${formatPoints(confirmItem.price)} 积分`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
