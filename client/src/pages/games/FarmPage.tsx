import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import UserTitleBadge from '../../components/UserTitleBadge'
import { usePoints } from '../../contexts/PointsContext'
import api from '../../lib/api'
import type {
  FarmCrop,
  FarmNeighbor,
  FarmPlot,
  FarmView,
  HarvestResult,
  NeighborFarmView,
  StealResult,
} from '../../types/farm'

type Tab = 'farm' | 'neighbors' | 'shop' | 'records'

const TAB_LABELS: Array<[Tab, string]> = [
  ['farm', '我的农场'],
  ['neighbors', '邻居农场'],
  ['shop', '种子商店'],
  ['records', '偷菜记录'],
]

function formatDuration(ms: number): string {
  if (ms <= 0) return '已成熟'
  const total = Math.ceil(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 生长阶段（0–3），决定作物的大小与形态 */
function growStage(progress: number, ready: boolean): number {
  if (ready) return 3
  if (progress >= 0.75) return 3
  if (progress >= 0.5) return 2
  if (progress >= 0.2) return 1
  return 0
}

const STAGE_LABELS = ['刚播种', '发芽了', '长势不错', '快成熟了', '可以收获']

/** 用一条计时器驱动所有倒计时，避免每个地块各开 interval */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/**
 * 开心农场：种菜 / 施肥 / 收获换积分，扩建农田，去邻居家偷菜（每日限量）。
 * 所有数值由服务端结算（`/api/farm`），页面只负责展示与倒计时。
 */
export default function FarmPage() {
  const { refresh: refreshPoints, applyLocalDelta } = usePoints()
  const [view, setView] = useState<FarmView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('farm')

  const [seedPickerPlot, setSeedPickerPlot] = useState<number | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [stealFlash, setStealFlash] = useState<string | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    // StrictMode 下 effect 会挂载 → 卸载 → 再挂载，必须在挂载时复位
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const now = useNow(!!view?.farm)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.get<FarmView>('/farm')
      if (mountedRef.current) setView(data)
      return data
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : '加载农场失败')
      return null
    } finally {
      if (mountedRef.current && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 静默轮询：作物成熟、被偷都会在 20 秒内反映出来
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [load])

  // 首次进入自动打开新手引导
  const tutorialCheckedRef = useRef(false)
  useEffect(() => {
    if (!view?.farm || tutorialCheckedRef.current) return
    tutorialCheckedRef.current = true
    if (!view.farm.tutorialDone) setTutorialOpen(true)
  }, [view?.farm])

  const run = useCallback(async (
    key: string,
    task: () => Promise<FarmView | null>,
    success?: string,
  ): Promise<FarmView | null> => {
    if (busy) return null
    setBusy(key)
    setError('')
    setNotice('')
    try {
      const next = await task()
      if (next) setView(next)
      if (success) setNotice(success)
      await refreshPoints()
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后再试')
      return null
    } finally {
      setBusy(null)
    }
  }, [busy, refreshPoints])

  const farm = view?.farm ?? null
  const plots = view?.plots ?? []

  const handleCreate = async (name: string) => {
    await run('create', () => api.post<FarmView>('/farm/create', { name }), '开荒成功！赠送的种子与肥料已放进仓库')
  }

  const handleRename = async () => {
    const name = renameValue.trim()
    if (!name) return
    const next = await run('rename', () => api.post<FarmView>('/farm/rename', { name }), '农场名字已更新')
    if (next) setRenameOpen(false)
  }

  const handleExpand = async () => {
    const next = view?.economy.expansions.find((row) => row.plotCount > (farm?.plotCount ?? 0))
    if (!next) return
    if (!window.confirm(`花 ${next.cost} 积分把农田扩建到 ${next.plotCount} 块？`)) return
    await run('expand', () => api.post<FarmView>('/farm/expand'), `农田扩建到 ${next.plotCount} 块`)
  }

  const handlePlant = async (plotIndex: number, cropKey: string) => {
    const next = await run(`plant-${plotIndex}`, () => api.post<FarmView>(`/farm/plots/${plotIndex}/plant`, { crop: cropKey }))
    if (next) setSeedPickerPlot(null)
  }

  const handleFertilize = async (plotIndex: number) => {
    await run(`fertilize-${plotIndex}`, () => api.post<FarmView>(`/farm/plots/${plotIndex}/fertilize`), '施肥完成，成熟时间缩短了一半')
  }

  const handleHarvest = async (plotIndex: number) => {
    if (busy) return
    setBusy(`harvest-${plotIndex}`)
    setError('')
    setNotice('')
    try {
      const result = await api.post<HarvestResult>(`/farm/plots/${plotIndex}/harvest`)
      setView(result.view)
      applyLocalDelta(result.points)
      setNotice(`收获 ${result.crop.name} ×${result.units}，获得 ${result.points} 积分`)
      setStealFlash(`+${result.points}`)
      window.setTimeout(() => setStealFlash(null), 1800)
      await refreshPoints()
    } catch (err) {
      setError(err instanceof Error ? err.message : '收获失败')
    } finally {
      setBusy(null)
    }
  }

  const handleClear = async (plotIndex: number) => {
    if (!window.confirm('铲掉这茬作物？种子不会返还。')) return
    await run(`clear-${plotIndex}`, () => api.post<FarmView>(`/farm/plots/${plotIndex}/clear`), '地块已清理')
  }

  const handleBuy = async (type: 'seed' | 'fertilizer', key: string, count: number, label: string) => {
    await run(
      `buy-${type}-${key}-${count}`,
      () => api.post<FarmView>('/farm/shop', { type, key, count }),
      `已购买 ${label} ×${count}`,
    )
  }

  const nextExpansion = farm
    ? view?.economy.expansions.find((row) => row.plotCount > farm.plotCount) ?? null
    : null

  if (loading && !view) {
    return (
      <div className="gh-page-container gh-farm-page">
        <div className="gh-farm-loading">
          <span className="gh-farm-loading-emoji" aria-hidden>🌱</span>
          <p>正在打开农场大门…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-farm-page">
      <div className={`gh-farm ${farm ? 'gh-farm--ready' : ''}`}>
        <section className="gh-farm-scene">
          <div className="gh-farm-sky" aria-hidden>
            <span className="gh-farm-sun" />
            <span className="gh-farm-cloud gh-farm-cloud--a" />
            <span className="gh-farm-cloud gh-farm-cloud--b" />
          </div>

          <header className="gh-farm-scene-head">
            <div className="gh-farm-scene-title">
              <p className="gh-farm-eyebrow">HAPPY FARM</p>
              <h1>
                {farm ? farm.name : '开心农场'}
                {farm && (
                  <button
                    type="button"
                    className="gh-farm-rename"
                    title="修改农场名字"
                    onClick={() => { setRenameValue(farm.name); setRenameOpen(true) }}
                  >
                    ✎
                  </button>
                )}
              </h1>
              <p className="gh-farm-sub">
                {farm
                  ? `共 ${farm.plotCount} 块地 · 已收获 ${farm.harvested} 次 · 收成 ${farm.harvestPoints} 积分 · 被偷走 ${farm.stolenPoints} 积分`
                  : '开一块属于自己的小农田：种菜、施肥、等收成换积分，还能去别人的农场偷菜。'}
              </p>
            </div>
            <div className="gh-farm-scene-actions">
              <span className="gh-farm-points" title="当前积分">
                <span aria-hidden>🪙</span>
                {view?.points ?? 0}
              </span>
              <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/games">返回大厅</Link>
              <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => setTutorialOpen(true)}>
                新手引导
              </button>
            </div>
          </header>

          {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
          {notice && <div className="gh-alert gh-alert--success" role="status">{notice}</div>}

          {!farm ? (
            <CreateFarmCard busy={busy === 'create'} onCreate={handleCreate} />
          ) : (
            <>
              <div className="gh-farm-toolbar">
                <div className="gh-farm-quota">
                  <span className="gh-farm-quota-icon" aria-hidden>🧺</span>
                  <div>
                    <strong>今日可偷 {view?.stealQuota.remaining ?? 0} / {view?.stealQuota.limit ?? 0} 次</strong>
                    <span>每日 0 点重置（Asia/Shanghai）</span>
                  </div>
                </div>
                <div className="gh-farm-toolbar-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busy === 'expand' || !nextExpansion}
                    onClick={() => void handleExpand()}
                  >
                    {nextExpansion ? `扩建到 ${nextExpansion.plotCount} 块 · ${nextExpansion.cost} 积分` : '已是最大面积'}
                  </button>
                  <Link className="gh-btn gh-btn--primary gh-btn--sm" to="/points">积分商店</Link>
                </div>
              </div>

              <div className="gh-farm-tabs">
                {TAB_LABELS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`gh-farm-tab ${tab === value ? 'gh-farm-tab--active' : ''}`}
                    onClick={() => { setTab(value); setError(''); setNotice('') }}
                  >
                    {label}
                    {value === 'neighbors' && <span className="gh-farm-tab-dot" aria-hidden />}
                  </button>
                ))}
              </div>

              {tab === 'farm' && (
                <FarmBoard
                  plots={plots}
                  now={now}
                  busy={busy}
                  onPlant={(index) => setSeedPickerPlot(index)}
                  onFertilize={(index) => void handleFertilize(index)}
                  onHarvest={(index) => void handleHarvest(index)}
                  onClear={(index) => void handleClear(index)}
                />
              )}

              {tab === 'neighbors' && (
                <NeighborsTab
                  quota={view?.stealQuota ?? { used: 0, limit: 0, remaining: 0 }}
                  busy={busy}
                  onNotice={(message) => { setNotice(message); setError('') }}
                  onError={(message) => { setError(message); setNotice('') }}
                  onStealDone={async (result: StealResult) => {
                    applyLocalDelta(result.points)
                    setStealFlash(`+${result.points}`)
                    window.setTimeout(() => setStealFlash(null), 1800)
                    await load(true)
                    await refreshPoints()
                  }}
                />
              )}

              {tab === 'shop' && (
                <ShopTab
                  view={view}
                  busy={busy}
                  onBuy={handleBuy}
                />
              )}

              {tab === 'records' && <RecordsTab view={view} />}
            </>
          )}
        </section>

        <aside className="gh-farm-aside">
          <div className="gh-farm-card">
            <h2 className="gh-farm-card-title">仓库</h2>
            {farm ? (
              <>
                <ul className="gh-farm-seed-list">
                  {(view?.inventory.seeds ?? []).length === 0 && (
                    <li className="gh-farm-empty-line">还没有种子，去商店买一些吧</li>
                  )}
                  {(view?.inventory.seeds ?? []).map((seed) => (
                    <li key={seed.key} className="gh-farm-seed-row">
                      <span className="gh-farm-seed-emoji" aria-hidden>{seed.emoji}</span>
                      <span className="gh-farm-seed-name">{seed.name}</span>
                      <span className="gh-farm-seed-count">×{seed.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="gh-farm-inventory-foot">
                  <span aria-hidden>💧</span>
                  肥料 ×{view?.inventory.fertilizer ?? 0}
                  <span className="gh-farm-hint">每次施肥缩短一半成熟时间</span>
                </div>
              </>
            ) : (
              <p className="gh-farm-empty-line">开荒后这里会显示种子与肥料</p>
            )}
          </div>

          <div className="gh-farm-card">
            <h2 className="gh-farm-card-title">今日动态</h2>
            {view ? (
              <>
                <div className="gh-farm-digest">
                  <div><span>偷菜次数</span><strong>{view.stealQuota.used} / {view.stealQuota.limit}</strong></div>
                  <div><span>被偷记录</span><strong>{view.recentSteals.received.length}</strong></div>
                </div>
                <ul className="gh-farm-recent">
                  {view.recentSteals.received.slice(0, 3).map((row) => (
                    <li key={row.id}>
                      <span aria-hidden>{row.crop?.emoji ?? '🥬'}</span>
                      {row.user.username} 偷走了你的{row.crop?.name ?? '作物'}
                      <span className="gh-farm-recent-points">-{row.points}</span>
                    </li>
                  ))}
                  {view.recentSteals.received.length === 0 && (
                    <li className="gh-farm-empty-line">暂时没人来偷菜</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="gh-farm-empty-line">开荒后开始记录</p>
            )}
          </div>

          <div className="gh-farm-card gh-farm-card--tips">
            <h2 className="gh-farm-card-title">小贴士</h2>
            <ul className="gh-farm-tips">
              <li>作物成熟后记得及时收获，收成 = 产量 × 单价。</li>
              <li>偷菜每天有限量，每茬作物每人只能偷一次。</li>
              <li>地主至少保留 1 份收成，所以快空的菜别惦记了。</li>
            </ul>
          </div>
        </aside>
      </div>

      {seedPickerPlot !== null && view && (
        <SeedPicker
          plotIndex={seedPickerPlot}
          seeds={view.inventory.seeds}
          busy={busy}
          onClose={() => setSeedPickerPlot(null)}
          onPlant={(cropKey) => void handlePlant(seedPickerPlot, cropKey)}
          onGoShop={() => { setSeedPickerPlot(null); setTab('shop') }}
        />
      )}

      {renameOpen && (
        <div className="gh-farm-modal-mask" role="dialog" aria-modal="true" aria-label="修改农场名字">
          <div className="gh-farm-modal gh-farm-modal--sm">
            <h2>修改农场名字</h2>
            <input
              className="gh-input"
              value={renameValue}
              maxLength={20}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="1–20 个字"
            />
            <div className="gh-farm-modal-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setRenameOpen(false)}>取消</button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                disabled={busy === 'rename' || !renameValue.trim()}
                onClick={() => void handleRename()}
              >
                {busy === 'rename' ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tutorialOpen && (
        <FarmTutorial
          onClose={() => setTutorialOpen(false)}
          onFinish={async () => {
            setTutorialOpen(false)
            if (!farm) return
            try {
              await api.post('/farm/tutorial-done')
              setView((prev) => (prev?.farm ? { ...prev, farm: { ...prev.farm, tutorialDone: true } } : prev))
            } catch {
              /* 引导状态写入失败不阻塞使用 */
            }
          }}
        />
      )}

      {stealFlash && (
        <div className="gh-farm-flash" role="status">
          {stealFlash} 积分
        </div>
      )}
    </div>
  )
}

/* ============================================================
   开荒
   ============================================================ */

function CreateFarmCard({ busy, onCreate }: { busy: boolean; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  return (
    <div className="gh-farm-create">
      <div className="gh-farm-create-art" aria-hidden>
        <span>🌱</span><span>🌾</span><span>🥕</span>
      </div>
      <h2>开一块自己的地</h2>
      <p>每位用户只能拥有一块农场。开荒即送 6 块地、种子与肥料，之后的收成、扩建都要靠自己赚积分。</p>
      <div className="gh-farm-create-form">
        <input
          className="gh-input"
          value={name}
          maxLength={20}
          placeholder="给农场起个名字（可留空）"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="gh-btn gh-btn--primary gh-btn--md" disabled={busy} onClick={() => void onCreate(name.trim())}>
          {busy ? '开荒中…' : '开始开荒'}
        </button>
      </div>
      <p className="gh-farm-create-note">首次进入会有一份新手引导，教你怎么种、怎么偷。</p>
    </div>
  )
}

/* ============================================================
   我的农田
   ============================================================ */

function FarmBoard({
  plots,
  now,
  busy,
  onPlant,
  onFertilize,
  onHarvest,
  onClear,
}: {
  plots: FarmPlot[]
  now: number
  busy: string | null
  onPlant: (index: number) => void
  onFertilize: (index: number) => void
  onHarvest: (index: number) => void
  onClear: (index: number) => void
}) {
  return (
    <div className="gh-farm-board">
      {plots.map((plot) => (
        <FarmPlotTile
          key={plot.index}
          plot={plot}
          now={now}
          busy={busy}
          onPlant={() => onPlant(plot.index)}
          onFertilize={() => onFertilize(plot.index)}
          onHarvest={() => onHarvest(plot.index)}
          onClear={() => onClear(plot.index)}
        />
      ))}
    </div>
  )
}

function FarmPlotTile({
  plot,
  now,
  busy,
  onPlant,
  onFertilize,
  onHarvest,
  onClear,
}: {
  plot: FarmPlot
  now: number
  busy: string | null
  onPlant: () => void
  onFertilize: () => void
  onHarvest: () => void
  onClear: () => void
}) {
  const crop = plot.crop
  const readyAt = plot.readyAt ? new Date(plot.readyAt).getTime() : 0
  const plantedAt = plot.plantedAt ? new Date(plot.plantedAt).getTime() : 0
  const remaining = crop ? Math.max(0, readyAt - now) : 0
  const ready = !!crop && remaining === 0
  const progress = crop
    ? Math.min(1, Math.max(0, (now - plantedAt) / Math.max(1, readyAt - plantedAt)))
    : 0
  const stage = crop ? growStage(progress, ready) : -1
  const planted = !!crop
  const tileBusy = busy === `plant-${plot.index}` || busy === `fertilize-${plot.index}`
    || busy === `harvest-${plot.index}` || busy === `clear-${plot.index}`

  return (
    <div
      className={`gh-farm-tile ${ready ? 'gh-farm-tile--ready' : ''} ${planted ? 'gh-farm-tile--planted' : ''}`}
      style={{ ['--farm-progress' as string]: `${Math.round(progress * 100)}%` }}
    >
      <div className="gh-farm-tile-top">
        <span className="gh-farm-tile-index">#{plot.index + 1}</span>
        {plot.fertilized > 0 && (
          <span className="gh-farm-tile-fertilized" title={`已施肥 ${plot.fertilized} 次`}>💧{plot.fertilized}</span>
        )}
        {plot.stolenCount > 0 && (
          <span className="gh-farm-tile-stolen" title={`被偷走 ${plot.stolenCount} 份`}>-{plot.stolenCount}</span>
        )}
      </div>

      <div className="gh-farm-tile-soil">
        {crop ? (
          <button
            type="button"
            className={`gh-farm-crop gh-farm-crop--s${stage}`}
            title={ready ? '点击收获' : `${crop.name} · ${STAGE_LABELS[stage]}`}
            disabled={tileBusy}
            onClick={ready ? onHarvest : undefined}
          >
            <span className="gh-farm-crop-emoji" aria-hidden>{crop.emoji}</span>
            {ready && <span className="gh-farm-crop-sparkle" aria-hidden>✨</span>}
          </button>
        ) : (
          <button type="button" className="gh-farm-empty-plot" disabled={tileBusy} onClick={onPlant}>
            <span aria-hidden>＋</span>
            <span>种点东西</span>
          </button>
        )}
      </div>

      <div className="gh-farm-tile-info">
        {crop ? (
          <>
            <strong className="gh-farm-tile-name">
              {crop.name}
              <span className="gh-farm-tile-units">×{plot.yieldUnits}</span>
            </strong>
            <span className={`gh-farm-tile-time ${ready ? 'gh-farm-tile-time--ready' : ''}`}>
              {ready ? '可以收获啦' : `${STAGE_LABELS[stage]} · ${formatDuration(remaining)}`}
            </span>
            <span className="gh-farm-tile-progress" aria-hidden>
              <span className="gh-farm-tile-progress-bar" />
            </span>
          </>
        ) : (
          <span className="gh-farm-tile-time">空地</span>
        )}
      </div>

      <div className="gh-farm-tile-actions">
        {!crop && (
          <button type="button" className="gh-farm-mini gh-farm-mini--primary" disabled={tileBusy} onClick={onPlant}>
            种植
          </button>
        )}
        {crop && !ready && (
          <button type="button" className="gh-farm-mini" disabled={tileBusy} onClick={onFertilize}>
            施肥
          </button>
        )}
        {crop && ready && (
          <button type="button" className="gh-farm-mini gh-farm-mini--primary" disabled={tileBusy} onClick={onHarvest}>
            {busy === `harvest-${plot.index}` ? '收获中…' : '收获'}
          </button>
        )}
        {crop && (
          <button type="button" className="gh-farm-mini gh-farm-mini--ghost" disabled={tileBusy} onClick={onClear}>
            铲除
          </button>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   种子选择
   ============================================================ */

function SeedPicker({
  plotIndex,
  seeds,
  busy,
  onClose,
  onPlant,
  onGoShop,
}: {
  plotIndex: number
  seeds: Array<{ key: string; name: string; emoji: string; count: number }>
  busy: string | null
  onClose: () => void
  onPlant: (cropKey: string) => void
  onGoShop: () => void
}) {
  return (
    <div className="gh-farm-modal-mask" role="dialog" aria-modal="true" aria-label="选择种子">
      <div className="gh-farm-modal">
        <div className="gh-farm-modal-head">
          <h2>第 {plotIndex + 1} 块地种什么？</h2>
          <button type="button" className="gh-farm-modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        {seeds.length === 0 ? (
          <div className="gh-farm-modal-empty">
            <p>仓库里还没有种子。</p>
            <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={onGoShop}>去种子商店看看</button>
          </div>
        ) : (
          <div className="gh-farm-seed-grid">
            {seeds.map((seed) => (
              <button
                key={seed.key}
                type="button"
                className="gh-farm-seed-card"
                disabled={busy === `plant-${plotIndex}`}
                onClick={() => onPlant(seed.key)}
              >
                <span className="gh-farm-seed-card-emoji" aria-hidden>{seed.emoji}</span>
                <span className="gh-farm-seed-card-name">{seed.name}</span>
                <span className="gh-farm-seed-card-count">×{seed.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   商店
   ============================================================ */

function ShopTab({
  view,
  busy,
  onBuy,
}: {
  view: FarmView | null
  busy: string | null
  onBuy: (type: 'seed' | 'fertilizer', key: string, count: number, label: string) => Promise<void>
}) {
  const catalog = view?.catalog ?? []
  const points = view?.points ?? 0
  return (
    <div className="gh-farm-shop">
      <div className="gh-farm-shop-head">
        <h2>种子与肥料</h2>
        <span className="gh-farm-shop-balance">可用积分 <strong>{points}</strong></span>
      </div>
      <div className="gh-farm-shop-grid">
        {catalog.map((crop: FarmCrop) => (
          <div key={crop.key} className="gh-farm-shop-card">
            <div className="gh-farm-shop-card-top">
              <span className="gh-farm-shop-emoji" aria-hidden>{crop.emoji}</span>
              <span className="gh-farm-shop-tier">T{crop.tier}</span>
            </div>
            <strong className="gh-farm-shop-name">{crop.name}</strong>
            <p className="gh-farm-shop-desc">{crop.description}</p>
            <dl className="gh-farm-shop-stats">
              <div><dt>成熟</dt><dd>{formatDuration(crop.growMs)}</dd></div>
              <div><dt>产量</dt><dd>×{crop.yieldUnits}</dd></div>
              <div><dt>单价</dt><dd>{crop.value}</dd></div>
            </dl>
            <div className="gh-farm-shop-buy">
              <span className="gh-farm-shop-cost">🪙 {crop.seedCost}</span>
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--sm"
                disabled={!!busy || points < crop.seedCost}
                onClick={() => void onBuy('seed', crop.key, 1, `${crop.name}种子`)}
              >
                买 1
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                disabled={!!busy || points < crop.seedCost * 5}
                onClick={() => void onBuy('seed', crop.key, 5, `${crop.name}种子`)}
              >
                买 5
              </button>
            </div>
          </div>
        ))}

        <div className="gh-farm-shop-card gh-farm-shop-card--fertilizer">
          <div className="gh-farm-shop-card-top">
            <span className="gh-farm-shop-emoji" aria-hidden>💧</span>
            <span className="gh-farm-shop-tier">加成</span>
          </div>
          <strong className="gh-farm-shop-name">肥料</strong>
          <p className="gh-farm-shop-desc">每施一次，剩余成熟时间减半（最多 2 次，最少留 10 秒）。</p>
          <dl className="gh-farm-shop-stats">
            <div><dt>单价</dt><dd>{view?.economy.fertilizerCost ?? 30}</dd></div>
            <div><dt>上限</dt><dd>每茬 {view?.economy.fertilizerMaxPerCrop ?? 2} 次</dd></div>
            <div><dt>库存</dt><dd>×{view?.inventory.fertilizer ?? 0}</dd></div>
          </dl>
          <div className="gh-farm-shop-buy">
            <span className="gh-farm-shop-cost">🪙 {view?.economy.fertilizerCost ?? 30}</span>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              disabled={!!busy || points < (view?.economy.fertilizerCost ?? 30)}
              onClick={() => void onBuy('fertilizer', 'fertilizer', 1, '肥料')}
            >
              买 1
            </button>
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--sm"
              disabled={!!busy || points < (view?.economy.fertilizerCost ?? 30) * 5}
              onClick={() => void onBuy('fertilizer', 'fertilizer', 5, '肥料')}
            >
              买 5
            </button>
          </div>
        </div>
      </div>
      <p className="gh-farm-shop-note">提示：种子与肥料消耗积分，积分来自游戏与农场收成，可在积分中心查看流水。</p>
    </div>
  )
}

/* ============================================================
   邻居与偷菜
   ============================================================ */

function NeighborsTab({
  quota,
  busy,
  onNotice,
  onError,
  onStealDone,
}: {
  quota: { used: number; limit: number; remaining: number }
  busy: string | null
  onNotice: (message: string) => void
  onError: (message: string) => void
  onStealDone: (result: StealResult) => Promise<void>
}) {
  const [neighbors, setNeighbors] = useState<FarmNeighbor[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<NeighborFarmView | null>(null)
  const [activeLoading, setActiveLoading] = useState(false)
  const [stealing, setStealing] = useState<string | null>(null)

  const loadNeighbors = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const params = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
      const data = await api.get<{ neighbors: FarmNeighbor[] }>(`/farm/neighbors${params}`)
      setNeighbors(data.neighbors)
    } catch (err) {
      onError(err instanceof Error ? err.message : '加载邻居农场失败')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => { void loadNeighbors() }, [loadNeighbors])

  const openNeighbor = async (userId: number) => {
    setActiveLoading(true)
    try {
      setActive(await api.get<NeighborFarmView>(`/farm/users/${userId}`))
    } catch (err) {
      onError(err instanceof Error ? err.message : '打开邻居农场失败')
    } finally {
      setActiveLoading(false)
    }
  }

  const steal = async (plotIndex: number) => {
    if (!active || stealing) return
    const key = `${active.owner.userId}-${plotIndex}`
    setStealing(key)
    try {
      const result = await api.post<StealResult>(`/farm/users/${active.owner.userId}/steal/${plotIndex}`)
      setActive((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          quota: result.quota,
          plots: prev.plots.map((plot) => (plot.index === plotIndex ? result.plot : plot)),
        }
      })
      onNotice(`偷到 ${result.crop.name} 一份，获得 ${result.points} 积分（今日还剩 ${result.quota.remaining} 次）`)
      await onStealDone(result)
    } catch (err) {
      onError(err instanceof Error ? err.message : '偷菜失败')
    } finally {
      setStealing(null)
    }
  }

  if (active) {
    return (
      <div className="gh-farm-neighbor-view">
        <div className="gh-farm-neighbor-head">
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => setActive(null)}>
            ← 返回邻居列表
          </button>
          <div className="gh-farm-neighbor-title">
            <strong>{active.farm.name}</strong>
            <span>地主：{active.owner.username}</span>
            <UserTitleBadge title={active.owner.title} />
          </div>
          <span className="gh-farm-neighbor-quota">今日剩余 {active.quota.remaining} / {active.quota.limit} 次</span>
        </div>
        <div className="gh-farm-neighbor-board">
          {active.plots.map((plot) => (
            <div key={plot.index} className={`gh-farm-neighbor-tile ${plot.ready ? 'gh-farm-neighbor-tile--ready' : ''}`}>
              <span className="gh-farm-neighbor-index">#{plot.index + 1}</span>
              <span className="gh-farm-neighbor-crop" aria-hidden>{plot.crop?.emoji ?? '🟫'}</span>
              <span className="gh-farm-neighbor-name">{plot.crop?.name ?? '空地'}</span>
              {plot.crop && (
                <span className="gh-farm-neighbor-meta">
                  {plot.ready ? `剩 ${plot.yieldUnits} 份` : `${Math.round(plot.progress * 100)}%`}
                  {plot.stolenCount > 0 && <em>被偷 {plot.stolenCount}</em>}
                </span>
              )}
              {plot.stealable ? (
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--sm"
                  disabled={stealing !== null || busy !== null}
                  onClick={() => void steal(plot.index)}
                >
                  {stealing === `${active.owner.userId}-${plot.index}` ? '偷菜中…' : '偷一份'}
                </button>
              ) : (
                <span className="gh-farm-neighbor-locked">
                  {plot.ready ? (plot.yieldUnits <= 1 ? '只剩最后一份' : '这茬偷过了') : '未成熟'}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="gh-farm-neighbor-note">
          偷菜规则：只有成熟的作物能偷；每茬作物每人限偷一次；地主至少保留 1 份收成；每天共 {active.quota.limit} 次。
        </p>
      </div>
    )
  }

  return (
    <div className="gh-farm-neighbors">
      <div className="gh-farm-neighbors-head">
        <div className="gh-farm-neighbors-search">
          <input
            className="gh-input"
            value={query}
            placeholder="搜索用户名"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void loadNeighbors(query) }}
          />
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void loadNeighbors(query)}>
            搜索
          </button>
        </div>
        <span className="gh-farm-neighbors-quota">今日剩余 {quota.remaining} / {quota.limit} 次</span>
      </div>

      {loading ? (
        <p className="gh-farm-empty-line">正在寻找邻居…</p>
      ) : neighbors.length === 0 ? (
        <p className="gh-farm-empty-line">还没有其他农场，等朋友们开荒后再来看看吧。</p>
      ) : (
        <div className="gh-farm-neighbor-grid">
          {neighbors.map((neighbor) => (
            <button
              key={neighbor.userId}
              type="button"
              className={`gh-farm-neighbor-card ${neighbor.stealableCount > 0 ? 'gh-farm-neighbor-card--hot' : ''}`}
              disabled={activeLoading}
              onClick={() => void openNeighbor(neighbor.userId)}
            >
              <div className="gh-farm-neighbor-card-top">
                <strong>{neighbor.farmName}</strong>
                {neighbor.stealableCount > 0 && (
                  <span className="gh-farm-neighbor-badge">可偷 {neighbor.stealableCount}</span>
                )}
              </div>
              <div className="gh-farm-neighbor-card-owner">
                <span>{neighbor.username}</span>
                <UserTitleBadge title={neighbor.title} />
              </div>
              <div className="gh-farm-neighbor-card-meta">
                <span>{neighbor.plotCount} 块地</span>
                <span>成熟 {neighbor.readyCount}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   偷菜记录
   ============================================================ */

function RecordsTab({ view }: { view: FarmView | null }) {
  const made = view?.recentSteals.made ?? []
  const received = view?.recentSteals.received ?? []
  const renderList = (rows: typeof made, empty: string, verb: string) => (
    rows.length === 0 ? (
      <p className="gh-farm-empty-line">{empty}</p>
    ) : (
      <ul className="gh-farm-record-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span className="gh-farm-record-emoji" aria-hidden>{row.crop?.emoji ?? '🥬'}</span>
            <div className="gh-farm-record-main">
              <strong>{row.crop?.name ?? '作物'} · {row.user.username}</strong>
              <span>{formatTime(row.createdAt)} · {verb}</span>
            </div>
            <span className="gh-farm-record-points">{row.points >= 0 ? '+' : ''}{row.points}</span>
          </li>
        ))}
      </ul>
    )
  )
  return (
    <div className="gh-farm-records">
      <div className="gh-farm-record-col">
        <h2>我偷到的</h2>
        {renderList(made, '还没偷过菜，去邻居农场看看', '偷菜所得')}
      </div>
      <div className="gh-farm-record-col">
        <h2>被偷记录</h2>
        {renderList(received, '暂时没人来偷菜', '被偷走的收成')}
      </div>
    </div>
  )
}

/* ============================================================
   新手引导
   ============================================================ */

const TUTORIAL_STEPS = [
  {
    icon: '🌱',
    title: '先种下第一颗种子',
    body: '点空地就能选种子播种。作物会随着时间长大，成熟后点「收获」就能换积分。',
  },
  {
    icon: '💧',
    title: '浇水施肥，早点收成',
    body: '肥料能把剩余成熟时间减半，每茬最多施两次。肥料可以在种子商店用积分购买。',
  },
  {
    icon: '🧺',
    title: '去邻居家偷菜',
    body: '邻居农场里成熟的作物可以偷一份，每天有次数限制，每茬每人只能偷一次，地主永远保留至少一份。',
  },
  {
    icon: '🚜',
    title: '扩建农田，赚得更多',
    body: '农田初始 6 块，最多 18 块。扩建要花积分，但更多地块意味着更稳定的收成。',
  },
] as const

function FarmTutorial({ onClose, onFinish }: { onClose: () => void; onFinish: () => Promise<void> }) {
  const [step, setStep] = useState(0)
  const current = TUTORIAL_STEPS[step]
  const last = step === TUTORIAL_STEPS.length - 1
  return (
    <div className="gh-farm-modal-mask" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="gh-farm-tutorial">
        <button type="button" className="gh-farm-modal-close" aria-label="关闭引导" onClick={onClose}>×</button>
        <div className="gh-farm-tutorial-art" aria-hidden>{current.icon}</div>
        <p className="gh-farm-tutorial-step">第 {step + 1} / {TUTORIAL_STEPS.length} 步</p>
        <h2>{current.title}</h2>
        <p className="gh-farm-tutorial-body">{current.body}</p>
        <div className="gh-farm-tutorial-dots" aria-hidden>
          {TUTORIAL_STEPS.map((_, index) => (
            <span key={index} className={index === step ? 'gh-farm-tutorial-dot gh-farm-tutorial-dot--active' : 'gh-farm-tutorial-dot'} />
          ))}
        </div>
        <div className="gh-farm-tutorial-actions">
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => void onFinish()}>跳过</button>
          {step > 0 && (
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setStep(step - 1)}>上一步</button>
          )}
          {last ? (
            <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => void onFinish()}>开始种菜</button>
          ) : (
            <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => setStep(step + 1)}>下一步</button>
          )}
        </div>
      </div>
    </div>
  )
}
