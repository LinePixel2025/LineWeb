import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { usePoints } from '../contexts/PointsContext'
import api from '../lib/api'
import type {
  LotteryDrawResponse,
  LotteryHistoryItem,
  LotteryPrizeGroup,
  LotteryPrizeType,
  LotteryRarity,
  LotteryRarityMeta,
  LotteryResultItem,
  LotteryView,
} from '../types/lottery'

/* ============================================================
   常量 / 工具
   ============================================================ */

const RARITY_ORDER: readonly LotteryRarity[] = ['common', 'rare', 'epic', 'legendary']

/** 服务端未下发 rarities（旧数据 / 滚动发布）时的兜底，颜色与设计系统一致 */
const RARITY_FALLBACK: Readonly<Record<LotteryRarity, LotteryRarityMeta>> = {
  common: { key: 'common', label: '普通', color: '#8e8e93', description: '日常补给。' },
  rare: { key: 'rare', label: '稀有', color: '#0a84ff', description: '稳健回报。' },
  epic: { key: 'epic', label: '史诗', color: '#bf5af2', description: '高阶奖励。' },
  legendary: { key: 'legendary', label: '传说', color: '#d4a72c', description: '顶级奖励。' },
}

const TYPE_HINTS: Readonly<Record<LotteryPrizeType, string>> = {
  points: '积分已到账',
  seed: '已放入农场仓库',
  fertilizer: '已放入农场仓库',
  outfit: '已放入宠物衣柜',
}

function formatNumber(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString('zh-CN')
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function metaFor(view: LotteryView | null, rarity: LotteryRarity): LotteryRarityMeta {
  return view?.rarities.find((item) => item.key === rarity) ?? RARITY_FALLBACK[rarity]
}

function bestRarityOf(results: readonly LotteryResultItem[]): LotteryRarity {
  let best: LotteryRarity = 'common'
  for (const item of results) {
    if (RARITY_ORDER.indexOf(item.rarity) > RARITY_ORDER.indexOf(best)) best = item.rarity
  }
  return best
}

function amountLabel(item: { type: LotteryPrizeType; amount: number }): string {
  return item.type === 'points' ? `+${formatNumber(item.amount)}` : `×${formatNumber(item.amount)}`
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** 抽奖成功后先乐观更新页面，紧接着的静默刷新会以服务端数据校准 */
function applyDrawToView(
  view: LotteryView,
  data: LotteryDrawResponse,
  tempBase: number,
  nowIso: string,
): LotteryView {
  const stats = { ...view.stats }
  for (const item of data.results) stats[item.rarity] += 1

  const resultCount = Math.max(1, data.results.length)
  const perDraw = data.cost === 0 ? 0 : Math.floor(data.cost / resultCount)
  const remainder = data.cost - perDraw * resultCount
  const fresh: LotteryHistoryItem[] = data.results.map((item, index) => ({
    // 临时负数 id 只用于乐观渲染，下一次静默刷新会替换成服务端自增 id
    id: -(tempBase * 100 + index),
    prizeKey: item.prizeKey,
    prizeType: item.type,
    prizeName: item.name,
    rarity: item.rarity,
    amount: item.amount,
    payload: item.payload,
    cost: perDraw + (index === 0 ? remainder : 0),
    createdAt: nowIso,
  }))

  return {
    ...view,
    balance: data.balance,
    pity: data.pity,
    dailyFreeAvailable: data.dailyFreeUsed ? false : view.dailyFreeAvailable,
    totalDraws: view.totalDraws + data.results.length,
    stats,
    history: [...fresh, ...view.history].slice(0, 30),
  }
}

/* ============================================================
   图标（全部 inline SVG，主视觉不使用 emoji）
   ============================================================ */

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function PrizeTypeIcon({ type }: { type: LotteryPrizeType }) {
  if (type === 'points') {
    return (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="8.4" />
        <path
          d="M12 6.9l1.4 2.9 3.2.4-2.3 2.2.6 3.2L12 14.1l-2.9 1.5.6-3.2-2.3-2.2 3.2-.4L12 6.9z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    )
  }
  if (type === 'seed') {
    return (
      <svg {...ICON_PROPS}>
        <path d="M12 20v-7.2" />
        <path d="M12 13.2c0-3.3 2.3-5.9 5.4-6.4.3 3.4-2.1 6.4-5.4 6.4z" />
        <path d="M12 15.4c-2.8 0-5-2-5.4-4.7 2.9-.2 5.4 2 5.4 4.7z" />
      </svg>
    )
  }
  if (type === 'fertilizer') {
    return (
      <svg {...ICON_PROPS}>
        <path d="M12 3.4c3.1 3.7 5.3 6.6 5.3 9.3A5.3 5.3 0 0 1 12 18a5.3 5.3 0 0 1-5.3-5.3c0-2.7 2.2-5.6 5.3-9.3z" />
        <path d="M9.7 12.7c0 1.3 1 2.3 2.3 2.3" />
      </svg>
    )
  }
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 4.4a2 2 0 1 1 2 2c-.9.4-1.3 1-1.3 1.9" />
      <path d="M12 8.3 4.8 13.1a1.6 1.6 0 0 0 .9 2.9h12.6a1.6 1.6 0 0 0 .9-2.9L12 8.3z" />
      <path d="M9.5 16v3.2h5V16" />
    </svg>
  )
}

/* ============================================================
   抽奖机（原创 SVG）
   ============================================================ */

interface CapsuleSpec {
  cx: number
  cy: number
  r: number
  rarity: LotteryRarity
}

const MACHINE_CAPSULES: readonly CapsuleSpec[] = [
  { cx: 132, cy: 116, r: 10, rarity: 'common' },
  { cx: 178, cy: 103, r: 11, rarity: 'rare' },
  { cx: 224, cy: 116, r: 10, rarity: 'common' },
  { cx: 246, cy: 150, r: 11, rarity: 'epic' },
  { cx: 226, cy: 186, r: 10, rarity: 'common' },
  { cx: 180, cy: 196, r: 11, rarity: 'legendary' },
  { cx: 134, cy: 186, r: 10, rarity: 'rare' },
  { cx: 114, cy: 150, r: 11, rarity: 'common' },
  { cx: 154, cy: 142, r: 9, rarity: 'epic' },
  { cx: 204, cy: 142, r: 9, rarity: 'common' },
  { cx: 204, cy: 170, r: 9, rarity: 'rare' },
  { cx: 154, cy: 170, r: 9, rarity: 'common' },
]

const MACHINE_LIGHTS: ReadonlyArray<[number, number]> = [
  [180, 44],
  [253.6, 78.4],
  [284, 148],
  [253.6, 217.6],
  [180, 252],
  [106.4, 217.6],
  [76, 148],
  [106.4, 78.4],
]

function LotteryMachine({ spinning }: { spinning: boolean }) {
  return (
    <div className={`gh-lottery-machine-wrap${spinning ? ' gh-lottery-machine-wrap--spinning' : ''}`}>
      <span className="gh-lottery-machine-halo" aria-hidden="true" />
      <svg className="gh-lottery-machine" viewBox="0 0 360 420" role="img" aria-label="积分抽奖机">
        <defs>
          <linearGradient id="lw-lot-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3a3a78" />
            <stop offset="48%" stopColor="#1d1d45" />
            <stop offset="100%" stopColor="#0d0d24" />
          </linearGradient>
          <radialGradient id="lw-lot-glass" cx="38%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#dcf5ff" stopOpacity="0.95" />
            <stop offset="38%" stopColor="#6bb8ff" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#09152f" stopOpacity="0.94" />
          </radialGradient>
          <linearGradient id="lw-lot-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff4b0" />
            <stop offset="45%" stopColor="#f4c542" />
            <stop offset="100%" stopColor="#a97a0a" />
          </linearGradient>
          <linearGradient id="lw-lot-metal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8686cf" />
            <stop offset="50%" stopColor="#ececff" />
            <stop offset="100%" stopColor="#6363a2" />
          </linearGradient>
          <linearGradient id="lw-lot-sign" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2e2e63" />
            <stop offset="50%" stopColor="#4b3b96" />
            <stop offset="100%" stopColor="#262650" />
          </linearGradient>
          <radialGradient id="lw-lot-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cff" stopOpacity="0.45" />
            <stop offset="58%" stopColor="#3d7bff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#3d7bff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="180" cy="394" rx="124" ry="15" fill="#000" opacity="0.24" />
        <ellipse
          cx="180"
          cy="148"
          rx="132"
          ry="122"
          fill="url(#lw-lot-halo)"
          className="gh-lottery-machine-halo-svg"
        />

        <g className="gh-lottery-machine-sign">
          <rect x="101" y="10" width="158" height="38" rx="19" fill="url(#lw-lot-sign)" stroke="#6a5acd" strokeWidth="1.5" />
          <text x="180" y="35" textAnchor="middle" className="gh-lottery-machine-sign-text">LUCKY DRAW</text>
        </g>

        <rect x="52" y="130" width="256" height="226" rx="32" fill="url(#lw-lot-body)" stroke="#5a5a9c" strokeWidth="2" />
        <circle cx="180" cy="148" r="94" fill="url(#lw-lot-glass)" stroke="#8fd3ff" strokeWidth="2.5" />
        <circle cx="180" cy="148" r="94" fill="none" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="7" />

        <g className="gh-lottery-machine-reel">
          {MACHINE_CAPSULES.map((capsule, index) => (
            <g key={`${capsule.cx}-${capsule.cy}`} className={`gh-lottery-capsule gh-lottery-capsule--${capsule.rarity}`}>
              <circle cx={capsule.cx} cy={capsule.cy} r={capsule.r} />
              <circle
                cx={capsule.cx - capsule.r * 0.3}
                cy={capsule.cy - capsule.r * 0.32}
                r={capsule.r * 0.32}
                className="gh-lottery-capsule-shine"
              />
              {index % 3 === 0 && (
                <path
                  d={`M${capsule.cx - capsule.r * 0.55} ${capsule.cy + capsule.r * 0.15} h${capsule.r * 1.1}`}
                  className="gh-lottery-capsule-band"
                />
              )}
            </g>
          ))}
        </g>

        <ellipse cx="143" cy="105" rx="42" ry="17" fill="#fff" opacity="0.2" transform="rotate(-22 143 105)" />

        <rect x="137" y="286" width="86" height="54" rx="16" fill="#08081a" stroke="#4b4b88" strokeWidth="2" />
        <rect x="151" y="303" width="58" height="8" rx="4" fill="url(#lw-lot-gold)" opacity="0.9" />
        <rect x="151" y="318" width="58" height="6" rx="3" fill="#2f2f63" />

        <g className="gh-lottery-machine-lever">
          <rect x="302" y="196" width="10" height="64" rx="5" fill="url(#lw-lot-metal)" />
          <circle cx="307" cy="196" r="15" fill="url(#lw-lot-gold)" stroke="#fff3b0" strokeWidth="2" />
          <circle cx="302.5" cy="191" r="4" fill="#fffbe0" opacity="0.85" />
        </g>
        <circle cx="307" cy="264" r="9" fill="#22224a" stroke="#6a6aa8" strokeWidth="2" />

        <g className="gh-lottery-machine-lights">
          {MACHINE_LIGHTS.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4.2" className="gh-lottery-machine-light" />
          ))}
        </g>

        <path d="M64 344h232l16 34H48z" fill="url(#lw-lot-body)" stroke="#4b4b88" strokeWidth="2" />
        <rect x="56" y="378" width="248" height="20" rx="10" fill="#0b0b1e" />
        <text x="180" y="410" textAnchor="middle" className="gh-lottery-machine-base-text">LINEWEB LOTTERY</text>
      </svg>
    </div>
  )
}

/* ============================================================
   结果卡 / 奖池卡 / 历史行
   ============================================================ */

function ResultCard({
  item,
  meta,
  index,
}: {
  item: LotteryResultItem
  meta: LotteryRarityMeta
  index: number
}) {
  const style: CSSProperties = { animationDelay: `${index * 70}ms` }
  return (
    <article className={`gh-lottery-result-card gh-lottery-rarity--${item.rarity}`} style={style}>
      {item.rarity === 'legendary' && (
        <span className="gh-lottery-result-sparks" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </span>
      )}
      <span className="gh-lottery-result-rarity">{meta.label}</span>
      <span className={`gh-lottery-result-icon gh-lottery-type-icon--${item.type}`}>
        <PrizeTypeIcon type={item.type} />
      </span>
      <h3>{item.name}</h3>
      <p className="gh-lottery-result-amount">{amountLabel(item)}</p>
      {item.converted ? (
        <p className="gh-lottery-result-converted">已折算 {formatNumber(item.convertedPoints)} 积分</p>
      ) : (
        <p className="gh-lottery-result-kind">{TYPE_HINTS[item.type]}</p>
      )}
    </article>
  )
}

function PoolGroup({ group }: { group: LotteryPrizeGroup }) {
  return (
    <article className={`gh-lottery-pool-card gh-lottery-rarity--${group.rarity}`}>
      <header className="gh-lottery-pool-card-head">
        <span className="gh-lottery-pool-dot" aria-hidden="true" />
        <h3>{group.label}</h3>
        <span className="gh-lottery-pool-chance">{group.chancePct}%</span>
      </header>
      <p className="gh-lottery-pool-desc">{group.description}</p>
      <ul className="gh-lottery-pool-list">
        {group.items.map((item) => (
          <li key={item.key} className="gh-lottery-pool-item">
            <span className={`gh-lottery-type-icon gh-lottery-type-icon--${item.type}`}>
              <PrizeTypeIcon type={item.type} />
            </span>
            <span className="gh-lottery-pool-item-copy">
              <strong>{item.name}</strong>
              <small>{item.description}</small>
            </span>
            <span className="gh-lottery-pool-amount">{item.amountText}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

function HistoryRow({ item, meta }: { item: LotteryHistoryItem; meta: LotteryRarityMeta }) {
  return (
    <li className={`gh-lottery-history-row gh-lottery-rarity--${item.rarity}`}>
      <time className="gh-lottery-history-time" dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      <span className={`gh-lottery-type-icon gh-lottery-type-icon--${item.prizeType}`}>
        <PrizeTypeIcon type={item.prizeType} />
      </span>
      <span className="gh-lottery-history-name">
        {item.prizeName}
        <small>{amountLabel({ type: item.prizeType, amount: item.amount })}</small>
      </span>
      <span className="gh-lottery-history-rarity">{meta.label}</span>
      <span className={`gh-lottery-history-cost${item.cost === 0 ? ' gh-lottery-history-cost--free' : ''}`}>
        {item.cost === 0 ? '免费' : `-${formatNumber(item.cost)}`}
      </span>
    </li>
  )
}

/* ============================================================
   页面
   ============================================================ */

/**
 * 积分抽奖：服务端扣费 + 发奖 + 写记录在同一事务内完成，
 * 页面只负责动画、结果展示与把服务端 DTO 渲染成奖池 / 历史。
 */
export default function LotteryPage() {
  const { refresh: refreshPoints } = usePoints()
  const [view, setView] = useState<LotteryView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<1 | 10 | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<LotteryDrawResponse | null>(null)
  const [resultOpen, setResultOpen] = useState(false)
  const [poolOpen, setPoolOpen] = useState(true)

  const mountedRef = useRef(true)
  // 状态更新是异步的：用 ref 兜住同一帧内的连点，避免重复扣费
  const drawLockRef = useRef(false)
  // 乐观历史记录的临时 id 基数（每次抽奖自增，避免连续抽奖时 key 重复）
  const tempHistoryRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadView = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.get<LotteryView>('/lottery')
      if (!mountedRef.current) return
      setView(data)
      if (!silent) setError('')
    } catch (err) {
      if (!mountedRef.current) return
      if (!silent) setError(errMessage(err, '加载抽奖信息失败'))
    } finally {
      if (mountedRef.current && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadView()
  }, [loadView])

  // 结果面板打开时锁滚动 + Esc 关闭
  useEffect(() => {
    if (!resultOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setResultOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [resultOpen])

  const closeResult = useCallback(() => setResultOpen(false), [])

  const pityPct = useMemo(() => {
    if (!view) return 0
    return Math.min(100, Math.round((view.pity.value / Math.max(1, view.pity.limit)) * 100))
  }, [view])

  const handleDraw = useCallback(async (count: 1 | 10) => {
    if (!view || busy || spinning || drawLockRef.current) return

    const free = count === 1 && view.dailyFreeAvailable
    const cost = free ? 0 : count === 1 ? view.costs.single : view.costs.ten
    if (view.balance < cost) {
      setError(`积分不足，还差 ${formatNumber(cost - view.balance)} 积分。去积分中心赚点积分再来吧。`)
      setNotice('')
      return
    }

    drawLockRef.current = true
    setBusy(count)
    setError('')
    setNotice('')
    setResultOpen(false)
    setSpinning(true)
    const startedAt = performance.now()

    try {
      const data = await api.post<LotteryDrawResponse>('/lottery/draw', { count })
      const spinMs = prefersReducedMotion() ? 0 : 1200
      const elapsed = performance.now() - startedAt
      if (elapsed < spinMs) await delay(spinMs - elapsed)
      if (!mountedRef.current) return

      setResult(data)
      setResultOpen(true)
      const tempBase = tempHistoryRef.current + 1
      tempHistoryRef.current = tempBase
      const nowIso = new Date().toISOString()
      setView((prev) => (prev ? applyDrawToView(prev, data, tempBase, nowIso) : prev))
      setNotice(data.dailyFreeUsed ? '本次使用每日免费抽，奖励已发放。' : `本次消耗 ${formatNumber(data.cost)} 积分，奖励已发放。`)
      // 乐观更新只负责秒开；历史 / 统计以服务端为准
      void loadView(true)
      void refreshPoints()
    } catch (err) {
      if (!mountedRef.current) return
      setError(errMessage(err, '抽奖失败，请稍后再试'))
    } finally {
      drawLockRef.current = false
      if (mountedRef.current) {
        setSpinning(false)
        setBusy(null)
      }
    }
  }, [view, busy, spinning, loadView, refreshPoints])

  /* ---------- 加载 / 失败 ---------- */

  if (!view && loading) {
    return (
      <div className="gh-page-container gh-lottery-page">
        <div className="gh-lottery-loading">
          <span className="gh-lottery-loading-ring" aria-hidden="true" />
          <p>正在启动抽奖机…</p>
        </div>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="gh-page-container gh-lottery-page">
        <div className="gh-alert gh-alert--danger" role="alert">{error || '加载抽奖信息失败'}</div>
        <div className="gh-lottery-retry">
          <button type="button" className="gh-btn gh-btn--secondary" onClick={() => void loadView()}>
            重试
          </button>
          <Link className="gh-btn gh-btn--ghost" to="/points">去积分中心</Link>
        </div>
      </div>
    )
  }

  const bestMeta = result ? metaFor(view, bestRarityOf(result.results)) : null
  const resultCount = result?.results.length ?? 0
  const insufficient = error.includes('积分不足')
  const tenSaved = view.costs.single * view.tenCount - view.costs.ten

  return (
    <div className="gh-page-container gh-lottery-page">
      <header className="gh-lottery-head">
        <div className="gh-lottery-head-copy">
          <p className="gh-lottery-eyebrow">LINEWEB LOTTERY</p>
          <h1 className="gh-lottery-title">积分抽奖</h1>
          <p className="gh-lottery-sub">
            花积分转动抽奖机：种子、肥料、积分与宠物装扮随机掉落。每日首抽免费，十连 9 折，
            连续 {view.pity.limit} 抽未出史诗则保底史诗及以上。
          </p>
        </div>
        <div className="gh-lottery-head-side">
          <div className="gh-lottery-balance" title="当前积分余额">
            <span className="gh-lottery-balance-label">我的积分</span>
            <strong className="gh-lottery-balance-value">{formatNumber(view.balance)}</strong>
            <Link className="gh-lottery-balance-link" to="/points">积分中心</Link>
          </div>
          <div className="gh-lottery-pity-card">
            <div className="gh-lottery-pity-head">
              <span>史诗保底</span>
              <span>{view.pity.value} / {view.pity.limit}</span>
            </div>
            <div
              className="gh-lottery-pity-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={view.pity.limit}
              aria-valuenow={view.pity.value}
              aria-label="保底进度"
            >
              <span className="gh-lottery-pity-fill" style={{ width: `${pityPct}%` }} />
            </div>
            <p>距保底还差 <strong>{view.pity.remaining}</strong> 抽</p>
          </div>
        </div>
      </header>

      {error && (
        <div className="gh-lottery-alert" role="alert">
          <span className="gh-lottery-alert-icon" aria-hidden="true">!</span>
          <p>{error}</p>
          {insufficient && <Link className="gh-lottery-alert-link" to="/points">去赚积分</Link>}
        </div>
      )}
      {notice && <div className="gh-lottery-notice" role="status">{notice}</div>}

      <section className="gh-lottery-hero">
        <LotteryMachine spinning={spinning} />

        <div className="gh-lottery-console">
          <div className="gh-lottery-console-head">
            <span className={`gh-lottery-free-chip${view.dailyFreeAvailable ? ' gh-lottery-free-chip--active' : ''}`}>
              <span className="gh-lottery-free-dot" aria-hidden="true" />
              {view.dailyFreeAvailable ? '今日免费抽可用' : '今日免费已用完 · 明日 0 点刷新'}
            </span>
            <h2>转动命运的齿轮</h2>
            <p>
              单抽 {view.costs.single} 积分，十连 {view.costs.ten} 积分（省 {tenSaved}）。
              种子与肥料会直接进入农场仓库；没有农场时自动为你开一块 6 格小农场。
            </p>
          </div>

          <div className="gh-lottery-actions">
            <button
              type="button"
              className="gh-lottery-draw-btn gh-lottery-draw-btn--single"
              disabled={busy !== null}
              onClick={() => void handleDraw(1)}
            >
              <span className="gh-lottery-draw-glow" aria-hidden="true" />
              <span className="gh-lottery-draw-main">
                {busy === 1 ? '抽奖中…' : view.dailyFreeAvailable ? '今日免费抽' : '单抽一次'}
              </span>
              <span className="gh-lottery-draw-sub">
                {view.dailyFreeAvailable ? '免费 1 次 · 每日 0 点刷新' : `${view.costs.single} 积分`}
              </span>
            </button>
            <button
              type="button"
              className="gh-lottery-draw-btn gh-lottery-draw-btn--ten"
              disabled={busy !== null}
              onClick={() => void handleDraw(10)}
            >
              <span className="gh-lottery-draw-glow" aria-hidden="true" />
              <span className="gh-lottery-draw-main">
                {busy === 10 ? '十连抽奖中…' : '十连抽 · 9 折'}
              </span>
              <span className="gh-lottery-draw-sub">
                {view.costs.ten} 积分 · 省 {tenSaved} 积分
              </span>
            </button>
          </div>

          <p className="gh-lottery-free-note">
            {view.dailyFreeAvailable
              ? '免费抽仅限单抽；十连不消耗免费次数，同样累计保底。'
              : '今日免费抽已用完，明日 0 点（Asia/Shanghai）刷新。'}
          </p>

          <dl className="gh-lottery-quick-stats">
            <div>
              <dt>累计抽奖</dt>
              <dd>{formatNumber(view.totalDraws)}</dd>
            </div>
            <div>
              <dt>史诗及以上</dt>
              <dd>{formatNumber(view.stats.epic + view.stats.legendary)}</dd>
            </div>
            <div>
              <dt>传说</dt>
              <dd>{formatNumber(view.stats.legendary)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="gh-lottery-stats" aria-label="抽奖统计">
        {RARITY_ORDER.map((rarity) => {
          const meta = metaFor(view, rarity)
          const count = view.stats[rarity]
          const pct = view.totalDraws > 0 ? Math.round((count / view.totalDraws) * 100) : 0
          return (
            <div key={rarity} className={`gh-lottery-stat gh-lottery-rarity--${rarity}`}>
              <span className="gh-lottery-stat-dot" aria-hidden="true" />
              <span className="gh-lottery-stat-label">{meta.label}</span>
              <strong className="gh-lottery-stat-value">{formatNumber(count)}</strong>
              <span className="gh-lottery-stat-pct">{view.totalDraws > 0 ? `${pct}%` : '—'}</span>
            </div>
          )
        })}
      </section>

      <section className="gh-lottery-section">
        <div className="gh-lottery-section-head">
          <div>
            <h2>奖池一览</h2>
            <p>概率由服务端权重实时下发，按稀有度分组展示；单项权重不对外暴露。</p>
          </div>
          <button
            type="button"
            className="gh-lottery-collapse"
            onClick={() => setPoolOpen((open) => !open)}
            aria-expanded={poolOpen}
          >
            {poolOpen ? '收起' : '展开'}
          </button>
        </div>
        {poolOpen && (
          <div className="gh-lottery-pool-grid">
            {view.prizes.map((group) => <PoolGroup key={group.rarity} group={group} />)}
          </div>
        )}
      </section>

      <section className="gh-lottery-section">
        <div className="gh-lottery-section-head">
          <div>
            <h2>最近抽奖</h2>
            <p>最近 30 条记录，免费抽标注「免费」；记录只追加、不可删除。</p>
          </div>
          <span className="gh-lottery-history-total">累计 {formatNumber(view.totalDraws)} 抽</span>
        </div>
        {view.history.length === 0 ? (
          <div className="gh-lottery-empty">
            <span className="gh-lottery-empty-mark" aria-hidden="true" />
            <p>还没有抽奖记录，先用今日免费抽试试手气吧。</p>
          </div>
        ) : (
          <ul className="gh-lottery-history">
            {view.history.map((item) => (
              <HistoryRow key={item.id} item={item} meta={metaFor(view, item.rarity)} />
            ))}
          </ul>
        )}
      </section>

      {resultOpen && result && bestMeta && createPortal(
        <div
          className="gh-lottery-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gh-lottery-result-title"
        >
          <button
            type="button"
            className="gh-lottery-modal-backdrop"
            aria-label="关闭抽奖结果"
            onClick={closeResult}
          />
          <div className={`gh-lottery-modal-panel gh-lottery-rarity--${bestRarityOf(result.results)}`}>
            <header className="gh-lottery-modal-head">
              <p className="gh-lottery-modal-eyebrow">
                {resultCount === 10 ? 'TEN DRAW' : 'SINGLE DRAW'}
              </p>
              <h2 id="gh-lottery-result-title">
                {resultCount === 10 ? '十连抽结果' : '单抽结果'}
              </h2>
              <p>
                最高品质 <strong>{bestMeta.label}</strong>
                {result.dailyFreeUsed ? ' · 本次免费' : ` · 消耗 ${formatNumber(result.cost)} 积分`}
              </p>
            </header>

            <div className={`gh-lottery-results-grid${resultCount === 1 ? ' gh-lottery-results-grid--single' : ''}`}>
              {result.results.map((item, index) => (
                <ResultCard
                  key={`${item.prizeKey}-${index}`}
                  item={item}
                  meta={metaFor(view, item.rarity)}
                  index={index}
                />
              ))}
            </div>

            <footer className="gh-lottery-modal-foot">
              <span>当前余额 <strong>{formatNumber(result.balance)}</strong> 积分</span>
              <div className="gh-lottery-modal-actions">
                <button type="button" className="gh-btn gh-btn--secondary" onClick={closeResult} autoFocus>
                  收下奖励
                </button>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary"
                  disabled={busy !== null}
                  onClick={() => {
                    closeResult()
                    void handleDraw(resultCount === 10 ? 10 : 1)
                  }}
                >
                  再抽一次
                </button>
              </div>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
