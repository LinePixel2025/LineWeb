import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import PetSprite from '../components/pets/PetSprite'
import api from '../lib/api'
import type { PetSpecies } from '../types/pet'
import type {
  RaidActionResponse,
  RaidCell,
  RaidContract,
  RaidDirection,
  RaidHistoryEntry,
  RaidLootItem,
  RaidMapInfo,
  RaidOverview,
  RaidSettlement,
  RaidState,
} from '../types/petRaid'

const DIR_LABEL: Record<RaidDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

const RARITY_LABEL: Record<RaidLootItem['rarity'], string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

const RESULT_LABEL: Record<string, string> = {
  extracted: '撤离成功',
  died: '阵亡',
  mia: '失联',
  abandoned: '放弃行动',
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00'
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function cellIcon(cell: RaidCell): string {
  if (!cell.revealed && !cell.current) return '·'
  if (cell.current) return '🐾'
  switch (cell.kind) {
    case 'spawn': return '🏠'
    case 'loot': return cell.searched ? '📭' : '📦'
    case 'enemy': return cell.enemy?.emoji ?? '🥷'
    case 'boss': return cell.enemy?.emoji ?? '👹'
    case 'extract': return '🚁'
    case 'hazard': return '☢️'
    default: return ''
  }
}

function cellTitle(cell: RaidCell): string {
  if (!cell.revealed && !cell.current) return '未探索区域'
  if (cell.current) return '你在这里'
  switch (cell.kind) {
    case 'spawn': return '出生点'
    case 'loot': return cell.searched ? '已搜空的容器' : '物资容器'
    case 'enemy': return `${cell.enemy?.name ?? '敌人'}（Lv.${cell.enemy?.level ?? '?'}）`
    case 'boss': return `首领 ${cell.enemy?.name ?? ''}（Lv.${cell.enemy?.level ?? '?'}）`
    case 'extract': return '撤离点'
    case 'hazard': return '危险区'
    default: return '空地'
  }
}

export default function PetRaidPage() {
  const [overview, setOverview] = useState<RaidOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [insurance, setInsurance] = useState(true)
  const [settlement, setSettlement] = useState<RaidSettlement | null>(null)
  const [combat, setCombat] = useState<RaidActionResponse['combat']>(null)
  const [flashLoot, setFlashLoot] = useState<RaidLootItem[]>([])
  const [now, setNow] = useState(() => Date.now())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.get<RaidOverview>('/pets/raid')
      if (mountedRef.current) {
        setOverview(data)
        setError('')
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : '加载搜打撤失败')
    } finally {
      if (mountedRef.current && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 倒计时；有对局时每 15 秒静默同步一次（主要用于超时判 MIA）
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!overview?.active) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [overview?.active, load])

  const raid = overview?.raid ?? null
  const remainingMs = raid ? Math.max(0, new Date(raid.expiresAt).getTime() - now) : 0
  const currentCell = raid ? raid.cells[raid.player.y * raid.width + raid.player.x] : null

  const adjacent = useMemo(() => {
    if (!raid) return new Set<number>()
    const result = new Set<number>()
    const { x, y } = raid.player
    if (x > 0) result.add(y * raid.width + x - 1)
    if (x < raid.width - 1) result.add(y * raid.width + x + 1)
    if (y > 0) result.add((y - 1) * raid.width + x)
    if (y < raid.height - 1) result.add((y + 1) * raid.width + x)
    return result
  }, [raid])

  const perform = useCallback(async (
    type: 'move' | 'search' | 'extract' | 'medkit' | 'safe' | 'unsafe' | 'abandon',
    payload: { dir?: RaidDirection; lootId?: string } = {},
  ) => {
    if (!raid || busy) return
    setBusy(type)
    setError('')
    setNotice('')
    try {
      const response = await api.post<RaidActionResponse>('/pets/raid/action', {
        type,
        ...payload,
        version: raid.version,
      })
      if (response.gained.length > 0) {
        setFlashLoot(response.gained)
        window.setTimeout(() => setFlashLoot([]), 2600)
      }
      if (response.combat) setCombat(response.combat)
      if (response.settlement) {
        setSettlement(response.settlement)
        setOverview((prev) => (prev ? { ...prev, active: false, raid: null } : prev))
        void load(true)
      } else if (response.raid) {
        setOverview((prev) => (prev ? { ...prev, active: true, raid: response.raid } : prev))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '行动失败')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }, [raid, busy, load])

  const startRaid = useCallback(async (mapKey: string) => {
    if (busy) return
    setBusy(`start-${mapKey}`)
    setError('')
    setNotice('')
    try {
      const data = await api.post<RaidOverview>('/pets/raid/start', { mapKey, insured: insurance })
      setOverview(data)
      setNotice('已进入地图：搜索物资、避开或击败敌人，然后到撤离点撤离。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '进入地图失败')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }, [busy, insurance])

  const claimContract = useCallback(async (contract: RaidContract) => {
    if (busy) return
    setBusy(`contract-${contract.key}`)
    setError('')
    try {
      const data = await api.post<RaidOverview>(`/pets/raid/contracts/${contract.key}/claim`)
      setOverview(data)
      setNotice(`契约「${contract.name}」奖励 ${contract.rewardPoints} 积分已到账`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '领取失败')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }, [busy])

  // 键盘操作：WASD / 方向键移动，F 搜索，E 撤离
  useEffect(() => {
    if (!raid) return undefined
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const key = event.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') { event.preventDefault(); void perform('move', { dir: 'up' }) }
      else if (key === 's' || key === 'arrowdown') { event.preventDefault(); void perform('move', { dir: 'down' }) }
      else if (key === 'a' || key === 'arrowleft') { event.preventDefault(); void perform('move', { dir: 'left' }) }
      else if (key === 'd' || key === 'arrowright') { event.preventDefault(); void perform('move', { dir: 'right' }) }
      else if (key === 'f') { event.preventDefault(); void perform('search') }
      else if (key === 'e') { event.preventDefault(); void perform('extract') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [raid, perform])

  const handleCell = (cell: RaidCell) => {
    if (!raid || !adjacent.has(cell.index)) return
    const { x, y } = raid.player
    if (cell.x === x - 1) void perform('move', { dir: 'left' })
    else if (cell.x === x + 1) void perform('move', { dir: 'right' })
    else if (cell.y === y - 1) void perform('move', { dir: 'up' })
    else if (cell.y === y + 1) void perform('move', { dir: 'down' })
  }

  if (loading && !overview) {
    return (
      <div className="gh-page-container gh-raid-page">
        <div className="gh-raid-loading">
          <span aria-hidden>🎒</span>
          <p>正在整理行动装备…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-raid-page">
      <header className="gh-raid-header">
        <div>
          <p className="gh-raid-eyebrow">PET EXTRACTION</p>
          <h1>宠物搜打撤</h1>
          <p className="gh-raid-sub">
            带宠物进入封锁区：搜物资、打敌人、活着撤离。阵亡会丢掉随身战利品，装备有概率掉落；保险箱和行动保险能保底。
          </p>
        </div>
        <div className="gh-raid-header-actions">
          <span className="gh-raid-points" title="当前积分">🪙 {overview?.points ?? 0}</span>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets">返回宠物</Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/gear">🎒 装备</Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/battle">⚔️ 对战</Link>
        </div>
      </header>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
      {notice && <div className="gh-alert gh-alert--success" role="status">{notice}</div>}

      {!overview?.pet ? (
        <div className="gh-raid-empty">
          <span aria-hidden>🐾</span>
          <h2>先召唤一只宠物</h2>
          <p>搜打撤需要宠物出战。去宠物页召唤或重新召唤一只，再回来带队进入封锁区。</p>
          <Link className="gh-btn gh-btn--primary" to="/pets">去宠物页</Link>
        </div>
      ) : raid ? (
        <div className="gh-raid-game">
          <section className="gh-raid-hud">
            <div className="gh-raid-hud-main">
              <span className="gh-raid-map-badge" style={{ background: `${raid.difficulty === 'extreme' ? '#5b4b8a' : raid.difficulty === 'hard' ? '#8a5a44' : '#3d7ea6'}` }}>
                {raid.mapEmoji} {raid.mapName}
              </span>
              <span className={`gh-raid-timer ${remainingMs < 120_000 ? 'gh-raid-timer--danger' : ''}`}>
                ⏱ {formatDuration(remainingMs)}
              </span>
              <span className="gh-raid-turn">行动点 {raid.turn} / {raid.maxTurns}</span>
              <span className="gh-raid-kills">击杀 {raid.kills}</span>
              {raid.insured && <span className="gh-badge gh-badge--success">已投保</span>}
            </div>
            <div className="gh-raid-bars">
              <div className="gh-raid-bar gh-raid-bar--hp">
                <span style={{ width: `${Math.max(0, Math.min(100, (raid.hp / Math.max(1, raid.maxHp)) * 100))}%` }} />
                <strong>HP {raid.hp} / {raid.maxHp}</strong>
              </div>
              <div className="gh-raid-bar gh-raid-bar--mp">
                <span style={{ width: `${Math.max(0, Math.min(100, (raid.mp / Math.max(1, raid.maxMp)) * 100))}%` }} />
                <strong>MP {raid.mp} / {raid.maxMp}</strong>
              </div>
            </div>
          </section>

          <div className="gh-raid-layout">
            <section className="gh-raid-board-wrap">
              <div
                className="gh-raid-board"
                style={{ '--raid-cols': raid.width } as CSSProperties}
                role="grid"
                aria-label={`${raid.mapName} 地图`}
              >
                {raid.cells.map((cell) => {
                  const isAdjacent = adjacent.has(cell.index)
                  const classes = [
                    'gh-raid-cell',
                    `gh-raid-cell--${cell.kind}`,
                    cell.current ? 'gh-raid-cell--current' : '',
                    isAdjacent ? 'gh-raid-cell--adjacent' : '',
                    !cell.revealed && !cell.current ? 'gh-raid-cell--fog' : '',
                    cell.searched ? 'gh-raid-cell--searched' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <button
                      key={cell.index}
                      type="button"
                      role="gridcell"
                      className={classes}
                      title={cellTitle(cell)}
                      disabled={!isAdjacent || busy !== null}
                      onClick={() => handleCell(cell)}
                    >
                      <span className="gh-raid-cell-icon" aria-hidden>{cellIcon(cell)}</span>
                      {cell.enemy && (cell.revealed || cell.current) && (
                        <span className="gh-raid-cell-level">Lv.{cell.enemy.level}</span>
                      )}
                      {cell.kind === 'extract' && !cell.current && (cell.revealed || cell.current) && (
                        <span className="gh-raid-cell-tag">撤离</span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="gh-raid-controls">
                <div className="gh-raid-dpad" aria-label="移动">
                  <button type="button" className="gh-raid-dpad-btn gh-raid-dpad-btn--up" disabled={busy !== null} onClick={() => void perform('move', { dir: 'up' })}>↑</button>
                  <button type="button" className="gh-raid-dpad-btn gh-raid-dpad-btn--left" disabled={busy !== null} onClick={() => void perform('move', { dir: 'left' })}>←</button>
                  <button type="button" className="gh-raid-dpad-btn gh-raid-dpad-btn--down" disabled={busy !== null} onClick={() => void perform('move', { dir: 'down' })}>↓</button>
                  <button type="button" className="gh-raid-dpad-btn gh-raid-dpad-btn--right" disabled={busy !== null} onClick={() => void perform('move', { dir: 'right' })}>→</button>
                </div>
                <div className="gh-raid-actions">
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busy !== null || currentCell?.kind !== 'loot' || currentCell?.searched}
                    onClick={() => void perform('search')}
                  >
                    {busy === 'search' ? '搜索中…' : currentCell?.searched ? '已搜空' : '🔍 搜索容器 (F)'}
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busy !== null || currentCell?.kind !== 'extract'}
                    onClick={() => void perform('extract')}
                  >
                    {raid.extracting > 0 ? `🚁 撤离读条 ${raid.extracting + 1}` : '🚁 撤离 (E)'}
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--ghost gh-btn--sm"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm('放弃本次行动？随身战利品会丢失，保险箱物品保留。')) void perform('abandon')
                    }}
                  >
                    放弃
                  </button>
                </div>
                <p className="gh-raid-keyhint">WASD / 方向键移动 · F 搜索 · E 撤离</p>
              </div>
            </section>

            <aside className="gh-raid-side">
              <div className="gh-raid-pet-card">
                <PetSprite
                  species={overview.pet.species as PetSpecies}
                  equipped={overview.pet.equipped}
                  mood={70}
                  size={112}
                />
                <div>
                  <strong>{overview.pet.name}</strong>
                  <span>Lv.{overview.pet.level} · {overview.pet.species}</span>
                  <span className="gh-raid-pet-stats">
                    ATK {raid.stats.atk} · DEF {raid.stats.def} · SPD {raid.stats.spd} · CRIT {raid.stats.crit}%
                  </span>
                </div>
              </div>

              <div className="gh-raid-panel">
                <div className="gh-raid-panel-head">
                  <strong>随身战利品</strong>
                  <span>{raid.loot.length} 件 · 价值 {raid.totalLootValue}</span>
                </div>
                {raid.loot.length === 0 ? (
                  <p className="gh-raid-empty-line">还没有搜到东西</p>
                ) : (
                  <ul className="gh-raid-loot-list">
                    {raid.loot.map((item) => (
                      <li key={item.id} className={`gh-raid-loot gh-raid-loot--${item.rarity}`}>
                        <span className="gh-raid-loot-emoji" aria-hidden>{item.emoji}</span>
                        <span className="gh-raid-loot-main">
                          <strong>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</strong>
                          <small>{RARITY_LABEL[item.rarity]} · {item.kind === 'equipment' || item.kind === 'skill' || item.kind === 'seed' ? '可带出' : `${item.value} 积分`}</small>
                        </span>
                        <span className="gh-raid-loot-actions">
                          {item.kind === 'medkit' && (
                            <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy !== null || raid.hp >= raid.maxHp} onClick={() => void perform('medkit', { lootId: item.id })}>
                              使用
                            </button>
                          )}
                          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy !== null || raid.safe.length >= raid.safeCapacity} onClick={() => void perform('safe', { lootId: item.id })}>
                            保险箱
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="gh-raid-panel">
                <div className="gh-raid-panel-head">
                  <strong>保险箱</strong>
                  <span>{raid.safe.length} / {raid.safeCapacity}</span>
                </div>
                {raid.safe.length === 0 ? (
                  <p className="gh-raid-empty-line">阵亡 / 失联时只有保险箱里的东西能带出来</p>
                ) : (
                  <ul className="gh-raid-loot-list">
                    {raid.safe.map((item) => (
                      <li key={item.id} className={`gh-raid-loot gh-raid-loot--${item.rarity}`}>
                        <span className="gh-raid-loot-emoji" aria-hidden>{item.emoji}</span>
                        <span className="gh-raid-loot-main">
                          <strong>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</strong>
                          <small>已保护 · 价值 {item.value}</small>
                        </span>
                        <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy !== null} onClick={() => void perform('unsafe', { lootId: item.id })}>
                          取回
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="gh-raid-panel gh-raid-log">
                <div className="gh-raid-panel-head">
                  <strong>行动日志</strong>
                  <span>第 {raid.turn} 回合</span>
                </div>
                <ul>
                  {raid.log.slice().reverse().map((entry) => (
                    <li key={entry.id} className={`gh-raid-log-${entry.kind}`}>
                      <span className="gh-raid-log-turn">T{entry.turn}</span>
                      <span>{entry.text}</span>
                      {entry.detail && entry.detail.length > 0 && (
                        <ul className="gh-raid-log-detail">
                          {entry.detail.map((line, index) => <li key={index}>{line}</li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <div className="gh-raid-lobby">
          <section className="gh-raid-stats">
            <div><span>总行动</span><strong>{overview.stats.totalRaids}</strong></div>
            <div><span>成功撤离</span><strong>{overview.stats.extracted}</strong></div>
            <div><span>阵亡</span><strong>{overview.stats.died}</strong></div>
            <div><span>失联</span><strong>{overview.stats.mia}</strong></div>
            <div><span>累计击杀</span><strong>{overview.stats.kills}</strong></div>
            <div><span>最高带出</span><strong>{overview.stats.bestValue}</strong></div>
          </section>

          <section className="gh-raid-contracts">
            <div className="gh-raid-section-head">
              <h2>每日契约</h2>
              <span>每天 0 点刷新 · 完成后手动领取</span>
            </div>
            <div className="gh-raid-contract-grid">
              {overview.contracts.map((contract) => {
                const done = contract.progress >= contract.target
                return (
                  <article key={contract.key} className={`gh-raid-contract ${done ? 'gh-raid-contract--done' : ''}`}>
                    <div>
                      <strong>{contract.name}</strong>
                      <p>{contract.description}</p>
                    </div>
                    <div className="gh-raid-contract-progress">
                      <span style={{ width: `${Math.min(100, (contract.progress / Math.max(1, contract.target)) * 100)}%` }} />
                      <small>{contract.progress} / {contract.target}</small>
                    </div>
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={contract.claimed || !done || busy !== null}
                      onClick={() => void claimContract(contract)}
                    >
                      {contract.claimed ? '已领取' : done ? `领取 ${contract.rewardPoints} 积分` : `奖励 ${contract.rewardPoints} 积分`}
                    </button>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="gh-raid-maps">
            <div className="gh-raid-section-head">
              <h2>选择行动地图</h2>
              <label className="gh-raid-insurance">
                <input type="checkbox" checked={insurance} onChange={(event) => setInsurance(event.target.checked)} />
                <span>
                  行动保险
                  <small>按装备价值 15% 扣积分（最低 20）；阵亡 / 失联时装备不掉落</small>
                </span>
              </label>
            </div>
            <div className="gh-raid-map-grid">
              {overview.maps.map((map) => {
                const locked = overview.pet ? overview.pet.level + 2 < map.recommendLevel : true
                return (
                  <article key={map.key} className={`gh-raid-map-card gh-raid-map-card--${map.difficulty}`} style={{ '--raid-map-color': map.color } as CSSProperties}>
                    <div className="gh-raid-map-card-head">
                      <span className="gh-raid-map-emoji" aria-hidden>{map.emoji}</span>
                      <div>
                        <h3>{map.name}</h3>
                        <span className="gh-raid-map-diff">
                          {map.difficulty === 'normal' ? '常规' : map.difficulty === 'hard' ? '高危' : '绝密'}
                          {' · '}建议 Lv.{map.recommendLevel}
                        </span>
                      </div>
                    </div>
                    <p>{map.description}</p>
                    <dl className="gh-raid-map-meta">
                      <div><dt>门票</dt><dd>{map.entryCost > 0 ? `${map.entryCost} 积分` : '免费'}</dd></div>
                      <div><dt>行动点</dt><dd>{map.maxTurns}</dd></div>
                      <div><dt>敌人</dt><dd>{map.enemyCount}{map.bossCount > 0 ? ' + 首领' : ''}</dd></div>
                      <div><dt>物资</dt><dd>Tier {map.lootTier}</dd></div>
                    </dl>
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busy !== null || locked}
                      onClick={() => void startRaid(map.key)}
                    >
                      {busy === `start-${map.key}` ? '进入中…' : locked ? `需要 Lv.${map.recommendLevel}` : '进入地图'}
                    </button>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="gh-raid-history">
            <div className="gh-raid-section-head">
              <h2>最近战绩</h2>
              <span>最多保留 20 条</span>
            </div>
            {overview.history.length === 0 ? (
              <p className="gh-raid-empty-line">还没有行动记录，选一张地图开始第一次搜打撤吧。</p>
            ) : (
              <ul className="gh-raid-history-list">
                {overview.history.map((entry) => (
                  <HistoryRow key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {flashLoot.length > 0 && (
        <div className="gh-raid-flash" role="status">
          <strong>获得战利品</strong>
          <ul>
            {flashLoot.map((item) => (
              <li key={item.id} className={`gh-raid-loot--${item.rarity}`}>
                {item.emoji} {item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {combat && !settlement && (
        <div className="gh-dialog-overlay" role="presentation">
          <div className="gh-dialog gh-raid-combat" role="dialog" aria-modal="true" aria-label="战斗结果">
            <h2 className="gh-dialog-title">{combat.won ? '战斗胜利' : '战斗失败'}</h2>
            <p className="gh-text-secondary">对手：{combat.enemyName}</p>
            <ul className="gh-raid-combat-log">
              {combat.events.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
            <div className="gh-dialog-actions">
              <button type="button" className="gh-btn gh-btn--primary" onClick={() => setCombat(null)}>继续</button>
            </div>
          </div>
        </div>
      )}

      {settlement && (
        <div className="gh-dialog-overlay" role="presentation">
          <div className={`gh-dialog gh-raid-settlement gh-raid-settlement--${settlement.result}`} role="dialog" aria-modal="true" aria-label="行动结算">
            <h2 className="gh-dialog-title">{RESULT_LABEL[settlement.result] ?? '行动结束'}</h2>
            <p className="gh-raid-settlement-points">
              带出价值 <strong>{settlement.points}</strong> 积分
              {settlement.gearLost.length > 0 && ` · 丢失装备 ${settlement.gearLost.length} 件`}
            </p>
            {settlement.loot.length === 0 ? (
              <p className="gh-raid-empty-line">没有战利品带出</p>
            ) : (
              <ul className="gh-raid-settlement-loot">
                {settlement.loot.map((item) => (
                  <li key={item.id} className={`gh-raid-loot--${item.rarity}`}>
                    {item.emoji} {item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}
                    <span>{item.value}</span>
                  </li>
                ))}
              </ul>
            )}
            {settlement.gearLost.length > 0 && (
              <p className="gh-raid-settlement-gear">
                装备掉落：{settlement.gearLost.join('、')}（可在装备页重新购买或交易行入手）
              </p>
            )}
            <div className="gh-dialog-actions">
              <button
                type="button"
                className="gh-btn gh-btn--primary"
                onClick={() => { setSettlement(null); setCombat(null); void load(true) }}
              >
                返回行动大厅
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryRow({ entry }: { entry: RaidHistoryEntry }) {
  const tone = entry.result === 'extracted' ? 'success' : entry.result === 'abandoned' ? 'muted' : 'danger'
  return (
    <li className={`gh-raid-history-row gh-raid-history-row--${tone}`}>
      <span className={`gh-raid-history-result gh-raid-history-result--${entry.result}`}>
        {RESULT_LABEL[entry.result] ?? entry.result}
      </span>
      <span className="gh-raid-history-map">{entry.mapName}</span>
      <span>{entry.kills} 击杀</span>
      <span>{entry.moves} 行动点</span>
      <span className={entry.points > 0 ? 'gh-text-success' : ''}>+{entry.points} 积分</span>
      <span className="gh-raid-history-time">{formatTime(entry.createdAt)}</span>
    </li>
  )
}
