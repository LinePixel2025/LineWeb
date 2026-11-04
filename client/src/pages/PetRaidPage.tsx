/**
 * 宠物搜打撤 v2（/pets/raid）：大厅 + 元气骑士式实时战斗 + 结算。
 *
 * 客户端职责：实时表现与本地预测；服务端按 seed 重算地图校验事件，并作为背包 / HP / 撤离的权威。
 * 撤离后战利品留在背包 / 胸挂 / 安全箱，必须到仓库页手动存入（不会自动出售）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { RaidEvent } from '../lib/raid/raidRun'
import { getRaidGear } from '../lib/raid/raidRun'
import type { RaidEngine, RaidSnapshot } from '../lib/raid/engine'
import { useRaidSquad } from '../lib/raid/squad'
import { onTap } from '../lib/raid/tap'
import RaidCanvas from '../components/raid/RaidCanvas'
import { useRaidPvp } from '../lib/raid/pvp'
import RaidHud from '../components/raid/RaidHud'
import RaidInventory from '../components/raid/RaidInventory'
import RaidResultDialog from '../components/raid/RaidResultDialog'
import RaidSquadPanel from '../components/raid/RaidSquadPanel'
import type {
  RaidContract,
  RaidEventBatchResult,
  RaidOverview,
  RaidRun,
  RaidSettlement,
} from '../types/petRaid'
import type { RaidSquadWorldDelta } from '../types/raidSquad'

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  return `${minutes} 分钟`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const RESULT_LABELS: Record<string, string> = {
  extracted: '撤离成功',
  died: '阵亡',
  mia: '失联',
  abandoned: '放弃',
}

function initialSnapshot(run: RaidRun): RaidSnapshot {
  return {
    hp: run.hp,
    mp: run.mp,
    maxHp: run.maxHp,
    maxMp: run.maxMp,
    atk: run.atk,
    kills: run.kills,
    roomId: run.currentRoom,
    roomKind: run.map.rooms[run.currentRoom]?.kind ?? 'combat',
    roomCleared: false,
    remainingMs: Math.max(0, new Date(run.expiresAt).getTime() - Date.now()),
    extractionProgress: run.extractionStartedAt ? 1 : 0,
    gear: run.gear,
    helmetDefense: 0,
    armorDefense: 0,
    backpack: run.backpack,
    rig: run.rig,
    safe: run.safe,
    capacities: run.capacities,
    skills: run.skills.map((skill) => ({
      key: skill.key,
      name: skill.name,
      emoji: skill.emoji,
      mpCost: skill.mpCost,
      cooldownMs: skill.cooldownMs,
      cooldownLeftMs: 0,
      affordable: run.mp >= skill.mpCost,
    })),
    toast: null,
    nearContainer: null,
    canExtract: false,
    extracting: Boolean(run.extractionStartedAt),
    dead: run.hp <= 0,
    shield: 0,
    atkBuffMs: 0,
  }
}

export default function PetRaidPage() {
  const { user } = useAuth()
  const selfUserId = user?.id ?? 0
  const [overview, setOverview] = useState<RaidOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [insured, setInsured] = useState(true)
  const [squadMapKey, setSquadMapKey] = useState('')
  const [engineReady, setEngineReady] = useState(0)
  const [gameRun, setGameRun] = useState<RaidRun | null>(null)
  const [run, setRun] = useState<RaidRun | null>(null)
  const [snapshot, setSnapshot] = useState<RaidSnapshot | null>(null)
  const [settlement, setSettlement] = useState<RaidSettlement | null>(null)
  const [actionErrors, setActionErrors] = useState<string[]>([])
  const [inventoryOpen, setInventoryOpen] = useState(false)
  // 撤退确认弹窗：Android WebView 无 WebChromeClient 时 window.confirm 恒返回 false（撤退静默失效），
  // 真全屏下 confirm 还会先退全屏——改为舞台内自绘确认浮层（原生全屏只渲染 stage 子树，必须挂在那里）
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)

  const engineRef = useRef<RaidEngine | null>(null)
  const runRef = useRef<RaidRun | null>(null)
  const pendingRef = useRef<RaidEvent[]>([])
  // PvP：大厅排队 + 对局内位置心跳与开火（伤害仍由服务端重算）
  const pvp = useRaidPvp({
    inMatch: Boolean(gameRun),
    getPosition: () => {
      const engine = engineRef.current
      if (!engine) return null
      return { x: engine.player.x, y: engine.player.y, angle: engine.player.angle, roomId: engine.roomId }
    },
  })
  const sendingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // B / I 打开战术背包；背包打开时本地引擎冻结（单人局不担心被偷袭）
  useEffect(() => {
    if (!gameRun) {
      setInventoryOpen(false)
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'b' || event.key === 'B' || event.key === 'i' || event.key === 'I') {
        event.preventDefault()
        setInventoryOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gameRun])

  const moveItem = useCallback(
    (from: 'backpack' | 'rig' | 'safe', to: 'backpack' | 'rig' | 'safe', slotIndex: number, amount?: number): boolean =>
      engineRef.current?.moveItem(from, to, slotIndex, amount) ?? false,
    [],
  )

  const dropItem = useCallback(
    (from: 'backpack' | 'rig' | 'safe', slotIndex: number, amount?: number): boolean =>
      engineRef.current?.dropItem(from, slotIndex, amount) ?? false,
    [],
  )

  // 进入对局后压缩页面头部与全站公告条：把可玩区域尽量留在首屏（平板横屏尤其关键）
  useEffect(() => {
    document.body.classList.toggle('lineweb-raid-playing', Boolean(gameRun))
    return () => document.body.classList.remove('lineweb-raid-playing')
  }, [gameRun])

  const loadOverview = useCallback(async (): Promise<RaidOverview | null> => {
    try {
      const data = await api.get<RaidOverview>('/pets/raid')
      if (!mountedRef.current) return null
      setOverview(data)
      if (data.run) {
        runRef.current = data.run
        setRun(data.run)
        setGameRun((current) => (current && current.id === data.run?.id ? current : data.run))
        setSnapshot((current) => current ?? initialSnapshot(data.run as RaidRun))
        // 版本冲突自愈：重新拉到的服务端状态必须回灌引擎（击杀 / 容器 / 背包都以服务端为准）
        engineRef.current?.applyServerRun(data.run)
      } else {
        runRef.current = null
        setRun(null)
      }
      setError('')
      return data
    } catch (err) {
      if (mountedRef.current) setError(errMessage(err, '加载搜打撤失败'))
      return null
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadOverview().finally(() => {
      if (mountedRef.current) setLoading(false)
    })
  }, [loadOverview])

  /* ---------- 好友组队 ---------- */

  const handleWorld = useCallback((delta: RaidSquadWorldDelta): void => {
    engineRef.current?.applyWorldDelta(delta)
  }, [])

  // 出击成功（本端或队友端收到 started）后重拉概览：本人若有新对局会自动进入战斗画面
  const handleStarted = useCallback((): void => {
    void loadOverview()
  }, [loadOverview])

  const squad = useRaidSquad({ selfUserId, onWorld: handleWorld, onStarted: handleStarted })

  useEffect(() => {
    if (!squadMapKey && overview?.maps.length) setSquadMapKey(overview.maps[0].key)
  }, [overview, squadMapKey])

  // 队友位置喂给引擎（同房间的画成幽灵，小地图上按房间标点）
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setTeammates(squad.members
      .filter((member) => member.userId !== selfUserId)
      .map((member) => ({
        userId: member.userId,
        name: member.displayName || member.name,
        species: member.species,
        x: member.x,
        y: member.y,
        angle: member.angle,
        hp: member.hp,
        maxHp: member.maxHp,
        roomId: member.roomId,
        kills: member.kills,
        status: member.status,
      })))
  }, [engineReady, squad.members, selfUserId])

  /* ---------- 事件上报 ---------- */

  const sendPending = useCallback(async (): Promise<void> => {
    if (sendingRef.current) return
    const current = runRef.current
    if (!current || pendingRef.current.length === 0) return
    sendingRef.current = true
    const batch = pendingRef.current.splice(0, pendingRef.current.length)
    const engine = engineRef.current
    try {
      const result = await api.post<RaidEventBatchResult>('/pets/raid/events', {
        version: current.version,
        events: batch,
        // 组队时把本端位置带上去（纯表现，服务端不落库）
        me: engine ? {
          x: engine.player.x,
          y: engine.player.y,
          angle: engine.player.angle,
          roomId: engine.roomId,
        } : undefined,
      })
      if (!mountedRef.current) return
      squad.applyEventBatchSquad(result.squad)
      if (result.settlement) {
        runRef.current = null
        setRun(null)
        setGameRun(null)
        setSnapshot(null)
        setSettlement(result.settlement)
        pendingRef.current = []
        void loadOverview()
        return
      }
      if (result.run) {
        runRef.current = result.run
        setRun(result.run)
        engineRef.current?.applyServerRun(result.run)
        setActionErrors(result.errors)
      }
    } catch (err) {
      // 版本冲突 / 网络失败：把事件放回队列，下一轮用新版本重试（版本冲突时先刷新）
      pendingRef.current.unshift(...batch)
      const message = errMessage(err, '同步失败')
      if (message.includes('版本') || message.includes('结束')) {
        pendingRef.current = []
        void loadOverview()
      } else {
        setActionErrors([message])
      }
    } finally {
      sendingRef.current = false
      if (mountedRef.current && pendingRef.current.length > 0) {
        window.setTimeout(() => {
          void sendPending()
        }, 500)
      }
    }
  }, [loadOverview, squad.applyEventBatchSquad])

  const flushEvents = useCallback((events: RaidEvent[]): void => {
    if (events.length > 0) pendingRef.current.push(...events)
    void sendPending()
  }, [sendPending])

  /* ---------- 大厅操作 ---------- */

  const startRaid = useCallback(async (mapKey: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setActionErrors([])
    try {
      const next = await api.post<RaidRun>('/pets/raid/start', { mapKey, insured })
      if (!mountedRef.current) return
      runRef.current = next
      setRun(next)
      setGameRun(next)
      setSnapshot(initialSnapshot(next))
      setSettlement(null)
      pendingRef.current = []
      void loadOverview()
    } catch (err) {
      setActionErrors([errMessage(err, '开始行动失败')])
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [busy, insured, loadOverview])

  /** HUD「撤退」按钮：只打开确认浮层（不再用 window.confirm，见 exitConfirmOpen 注释） */
  const abandon = useCallback((): void => {
    setExitConfirmOpen(true)
  }, [])

  /** 浮层里点「放弃撤离」后才真正请求放弃 */
  const confirmAbandon = useCallback(async (): Promise<void> => {
    if (busy) return
    setExitConfirmOpen(false)
    setBusy(true)
    try {
      pendingRef.current = []
      const result = await api.post<RaidSettlement>('/pets/raid/abandon')
      if (!mountedRef.current) return
      setSettlement(result)
      runRef.current = null
      setRun(null)
      setGameRun(null)
      setSnapshot(null)
      void loadOverview()
    } catch (err) {
      setActionErrors([errMessage(err, '放弃失败')])
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [busy, loadOverview])

  const claimContract = useCallback(async (contract: RaidContract): Promise<void> => {
    if (busy || contract.claimed) return
    setBusy(true)
    try {
      const result = await api.post<{ points: number; contracts: RaidContract[] }>(
        `/pets/raid/contracts/${contract.key}/claim`,
        {},
      )
      if (!mountedRef.current) return
      setOverview((current) => current
        ? { ...current, points: current.points + result.points, contracts: result.contracts }
        : current)
    } catch (err) {
      setActionErrors([errMessage(err, '领取失败')])
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [busy])

  const closeSettlement = useCallback((): void => {
    setSettlement(null)
    setActionErrors([])
    void loadOverview()
  }, [loadOverview])

  if (loading) {
    return (
      <div className="gh-raid-page">
        <div className="gh-raid-loading">正在加载搜打撤…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="gh-raid-page">
        <div className="gh-alert gh-alert--danger">{error}</div>
        <button type="button" className="gh-btn gh-btn--secondary" onClick={() => void loadOverview()}>
          重试
        </button>
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="gh-raid-page">
        <div className="gh-raid-loading">暂无数据</div>
      </div>
    )
  }

  const loadout = overview.loadout
  const noBackpack = !loadout || loadout.capacities.backpack <= 0

  return (
    <div className={`gh-raid-page${gameRun ? ' is-in-game' : ''}`}>
      <header className="gh-raid-header">
        <div>
          <p className="gh-raid-eyebrow">宠物搜打撤 · 三角洲 × 元气骑士</p>
          <h1>搜打撤行动</h1>
          <p className="gh-raid-sub">
            实时房间制搜刮、会移动的敌人、手动释放技能。撤离后物资留在背包里，回仓库手动入库——仓库满了不会自动卖掉。
          </p>
        </div>
        <div className="gh-raid-header-actions">
          <span className="gh-raid-points">💰 {overview.points} 积分</span>
          <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/pets/raid/storage">
            仓库 / 背包
          </Link>
          <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/raid/shop">
            商店
          </Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets">
            宠物之家
          </Link>
        </div>
      </header>

      {!overview.pet && (
        <div className="gh-alert gh-alert--warning">
          还没有可出击的宠物，先去 <Link to="/pets">宠物之家</Link> 召唤一只吧。
        </div>
      )}

      {!gameRun && overview.pet && noBackpack && (
        <div className="gh-alert gh-alert--warning">
          还没有装备背包，进入对局后什么都装不下。先去 <Link to="/raid/shop">商店</Link>{' '}
          买一个背包（1 级背包 300 积分），再到 <Link to="/pets/raid/storage">仓库 → 装备</Link> 装上。
        </div>
      )}

      {actionErrors.length > 0 && !gameRun && (
        <div className="gh-alert gh-alert--danger">
          {actionErrors.map((message, index) => (
            <div key={`${message}-${index}`}>{message}</div>
          ))}
        </div>
      )}

      {gameRun ? (
        <section className="gh-raid-game">
          <RaidCanvas
            key={gameRun.id}
            initialRun={gameRun}
            species={overview.pet?.species ?? 'cat'}
            paused={Boolean(settlement) || inventoryOpen}
            onEngineReady={(engine) => {
              engineRef.current = engine
              setEngineReady((value) => value + 1)
            }}
            onSnapshot={(next) => setSnapshot(next)}
            onFlush={flushEvents}
          >
            {run && snapshot && (
              <RaidHud
                run={run}
                snapshot={snapshot}
                busy={busy}
                errors={actionErrors}
                squad={squad.members}
                selfUserId={selfUserId}
                onAbandon={abandon}
                onSkill={(index) => engineRef.current?.castSkill(index)}
                onHeal={() => engineRef.current?.useConsumable('heal')}
                onRepair={() => engineRef.current?.useConsumable('repair')}
                onOpenInventory={() => setInventoryOpen(true)}
                onInteract={() => engineRef.current?.interact()}
              />
            )}
            {/* PvP 敌对面板：同房间的对手与敌方佣兵都可以点「开火」（伤害由服务端重算） */}
            {run?.mode === 'pvp' && pvp.state && (
              <div className="gh-raid-pvp-hud">
                <div className="gh-raid-pvp-hud-head">
                  <span aria-hidden>⚔️</span>
                  <strong>{pvp.state.faction === 'A' ? '蓝队' : '红队'}</strong>
                  <span>剩余 {Math.max(1, Math.ceil(pvp.state.remainingMs / 60000))} 分钟</span>
                </div>
                {pvp.state.hostiles.length === 0 && pvp.state.mercs.length === 0 ? (
                  <p>本局对手已全部撤离或阵亡。</p>
                ) : (
                  <ul>
                    {pvp.state.hostiles.map((peer) => {
                      const sameRoom = peer.live?.roomId === run.currentRoom
                      return (
                        <li key={`peer-${peer.userId}`}>
                          <span className={sameRoom ? 'is-near' : undefined}>
                            🔴 {peer.username}
                            {peer.live ? (sameRoom ? ' · 同房间' : ` · 房间 ${peer.live.roomId + 1}`) : ' · 位置未知'}
                          </span>
                          <button
                            type="button"
                            className="gh-btn gh-btn--danger gh-btn--sm"
                            disabled={!sameRoom}
                            title={sameRoom ? '开火（伤害由服务端按你的攻击力与对方护甲结算）' : '不在同一个房间，打不到'}
                            onClick={() => void pvp.strike(peer.userId)}
                          >
                            开火
                          </button>
                        </li>
                      )
                    })}
                    {pvp.state.mercs.map((merc) => (
                      <li key={merc.id}>
                        <span>🤖 {merc.name} · {merc.hp}/{merc.maxHp}</span>
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--sm"
                          disabled={merc.hp <= 0}
                          onClick={() => void pvp.strikeMerc(merc.id)}
                        >
                          {merc.hp > 0 ? '开火' : '已倒下'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {/* 背包面板挂在舞台内部：原生全屏时 Fullscreen API 只渲染该子树 */}
            {inventoryOpen && snapshot && (
              <RaidInventory
                snapshot={snapshot}
                busy={busy}
                onMove={moveItem}
                onDrop={dropItem}
                onClose={() => setInventoryOpen(false)}
              />
            )}
            {/* 撤退确认浮层同样必须挂在舞台子树内：原生全屏时 window 层的弹窗不会渲染（见 exitConfirmOpen 注释） */}
            {exitConfirmOpen && (
              <div className="gh-raid-exit-confirm" role="dialog" aria-modal="true" aria-label="确认放弃行动">
                <div className="gh-raid-exit-confirm-panel">
                  <strong>放弃本次行动？</strong>
                  <p>背包与胸挂里的物品会丢失，安全箱保留。</p>
                  <div className="gh-raid-exit-confirm-actions">
                    <button
                      type="button"
                      className="gh-btn gh-btn--secondary gh-btn--sm"
                      {...onTap(() => setExitConfirmOpen(false))}
                    >
                      继续行动
                    </button>
                    <button
                      type="button"
                      className="gh-btn gh-btn--danger gh-btn--sm"
                      disabled={busy}
                      {...onTap(() => void confirmAbandon())}
                    >
                      放弃撤离
                    </button>
                  </div>
                </div>
              </div>
            )}
          </RaidCanvas>
          {squad.inSquad && squad.members.length > 1 && (
            <p className="gh-raid-squadline">
              {squad.members.map((member) => (
                <span key={member.userId} className={`is-${member.status}${member.userId === selfUserId ? ' is-me' : ''}`}>
                  {member.displayName || member.name}：{member.status === 'active' ? `HP ${Math.round(member.hp)}` : '已离场'}
                </span>
              ))}
            </p>
          )}
        </section>
      ) : (
        <div className="gh-raid-lobby">
          <RaidSquadPanel
            squad={squad.squad}
            friends={squad.friends}
            incoming={squad.incoming}
            outgoing={squad.outgoing}
            selfUserId={selfUserId}
            busy={squad.busy}
            error={squad.error}
            failed={squad.failed}
            maps={overview.maps}
            selectedMapKey={squadMapKey}
            insured={insured}
            insuranceCost={loadout?.insuranceCost ?? 0}
            onInvite={(userId) => void squad.invite(userId)}
            onRespond={(inviteId, accept) => void squad.respond(inviteId, accept)}
            onCancel={(inviteId) => void squad.cancel(inviteId)}
            onLeave={() => void squad.leave()}
            onKick={(userId) => void squad.kick(userId)}
            onStart={(mapKey) => void squad.start(mapKey, insured)}
          />

          <section className="gh-raid-stats">
            <div><span>总场次</span><b>{overview.stats.total}</b></div>
            <div><span>成功撤离</span><b>{overview.stats.extracted}</b></div>
            <div><span>阵亡</span><b>{overview.stats.died}</b></div>
            <div><span>失联</span><b>{overview.stats.mia}</b></div>
            <div><span>总击杀</span><b>{overview.stats.kills}</b></div>
            <div><span>最佳带出</span><b>{overview.stats.bestLootValue}</b></div>
          </section>

          <section className="gh-raid-contracts">
            <div className="gh-raid-section-head">
              <h2>每日契约</h2>
              <span>每天 0 点刷新 · 手动领取</span>
            </div>
            <div className="gh-raid-contract-grid">
              {overview.contracts.map((contract) => {
                const done = contract.progress >= contract.target
                return (
                  <article key={contract.key} className={`gh-raid-contract${contract.claimed ? ' is-claimed' : done ? ' is-done' : ''}`}>
                    <div className="gh-raid-contract-head">
                      <strong>{contract.name}</strong>
                      <span>+{contract.rewardPoints} 积分</span>
                    </div>
                    <p>{contract.description}</p>
                    <div className="gh-raid-contract-progress">
                      <i style={{ width: `${Math.min(100, (contract.progress / contract.target) * 100)}%` }} />
                    </div>
                    <div className="gh-raid-contract-foot">
                      <span>{Math.min(contract.progress, contract.target)} / {contract.target}</span>
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary gh-btn--sm"
                        disabled={busy || contract.claimed || !done}
                        onClick={() => void claimContract(contract)}
                      >
                        {contract.claimed ? '已领取' : done ? '领取' : '进行中'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          {loadout && (
            <section className="gh-raid-loadout">
              <div className="gh-raid-section-head">
                <h2>出击装配</h2>
                <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/raid/storage">整理装备</Link>
              </div>
              <div className="gh-raid-loadout-grid">
                <div className="gh-raid-loadout-gear">
                  {(['helmet', 'armor', 'boots', 'backpack', 'rig'] as const).map((slot) => {
                    const instance = loadout.gear[slot]
                    const def = typeof instance === 'string'
                      ? getRaidGear(instance)
                      : instance
                        ? getRaidGear(instance.key)
                        : null
                    const label = { helmet: '头盔', armor: '护甲', boots: '战靴', backpack: '背包', rig: '胸挂' }[slot]
                    return (
                      <div key={slot} className={`gh-raid-loadout-slot${def ? ' is-filled' : ''}`}>
                        <span>{label}</span>
                        <b>{def ? `${def.emoji} ${def.name}` : '未装备'}</b>
                        {instance && typeof instance === 'object' && (
                          <em>{instance.durability}/{instance.maxDurability} 耐久</em>
                        )}
                        {def?.slots ? <em>{def.slots} 格</em> : null}
                        {def?.speedBonus ? <em>速度 +{def.speedBonus}%</em> : null}
                      </div>
                    )
                  })}
                </div>
                <div className="gh-raid-loadout-side">
                  <p>背包 {loadout.backpackUnits} 件 · 胸挂 {loadout.rigUnits} 件 · 安全箱 {loadout.safeUnits} 件</p>
                  <p>仓库 Lv.{loadout.storageLevel} · 保险 {loadout.insuranceCost > 0 ? `${loadout.insuranceCost} 积分（装备价值 15%）` : '无需保险'}</p>
                  <div className="gh-raid-loadout-skills">
                    {loadout.skills.length === 0
                      ? <span>未装备技能（只能普攻）</span>
                      : loadout.skills.map((skill) => <span key={skill.key}>{skill.emoji} {skill.name}</span>)}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="gh-raid-maps">
            <div className="gh-raid-section-head">
              <h2>选择行动区域</h2>
              <label className="gh-raid-insurance">
                <input
                  type="checkbox"
                  checked={insured}
                  disabled={!loadout || loadout.insuranceCost <= 0}
                  onChange={(event) => setInsured(event.target.checked)}
                />
                行动保险 {loadout && loadout.insuranceCost > 0 ? `（${loadout.insuranceCost} 积分，阵亡保住装备）` : '（当前没有可保装备）'}
              </label>
            </div>
            <div className="gh-raid-map-grid">
              {overview.maps.map((map) => {
                const canAfford = overview.points >= map.entryCost + (insured && loadout ? loadout.insuranceCost : 0)
                return (
                  <article
                    key={map.key}
                    className={`gh-raid-map-card${squadMapKey === map.key ? ' is-squad-target' : ''}`}
                    data-map={map.key}
                    style={{ '--map-color': map.color } as CSSProperties}
                  >
                    <div className="gh-raid-map-head">
                      <span className="gh-raid-map-emoji">{map.emoji}</span>
                      <div>
                        <h3>{map.name}</h3>
                        <span className="gh-raid-map-difficulty">{map.difficulty}</span>
                      </div>
                    </div>
                    <p className="gh-raid-map-desc">{map.description}</p>
                    <div className="gh-raid-map-meta">
                      <span>推荐 Lv.{map.recommendLevel}</span>
                      <span>战利品 T{map.lootTier}</span>
                      <span>{formatDuration(map.durationMs)}</span>
                      <span>{map.entryCost > 0 ? `门票 ${map.entryCost}` : '免费'}</span>
                    </div>
                    <div className="gh-raid-map-foot">
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary"
                        disabled={busy || !overview.pet || !canAfford}
                        onClick={() => void startRaid(map.key)}
                      >
                        {busy ? '出击中…' : canAfford ? '单人进入行动' : '积分不足'}
                      </button>
                      <button
                        type="button"
                        className={`gh-btn gh-btn--ghost${squadMapKey === map.key ? ' is-active' : ''}`}
                        onClick={() => setSquadMapKey(map.key)}
                        title="作为好友组队出击的目标地图"
                      >
                        {squadMapKey === map.key ? '组队目标 ✓' : '设为组队目标'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          {/* 玩家匹配（PvPvE）：3v3，不够人由 AI 佣兵补位；同 seed 里两队互为敌人 */}
          <section className="gh-raid-pvp-lobby">
            <div className="gh-raid-section-head">
              <h2>玩家匹配（PvP）</h2>
              <span>爆率提升 · 非洲之心仅此模式掉落 · 3v3 不足自动补 AI 佣兵</span>
            </div>
            {pvp.error && <div className="gh-alert gh-alert--danger">{pvp.error}</div>}
            {pvp.queue?.matched ? (
              <div className="gh-raid-pvp-status">
                <p>
                  已成局（{pvp.queue.matchId}）· 你是 <strong>{pvp.queue.faction === 'A' ? '蓝队' : '红队'}</strong> ·
                  队友 {pvp.queue.teammates.map((mate) => mate.username).join('、') || '无'} ·
                  对手 {pvp.queue.hostiles.map((peer) => peer.username).join('、') || '全是佣兵'}
                </p>
                <span>对局开始后会自动进入行动，和队友共用同一张地图。</span>
              </div>
            ) : pvp.queue?.queueing ? (
              <div className="gh-raid-pvp-status">
                <p>
                  正在匹配… 队列第 {pvp.queue.position} 位 · 已等待 {Math.floor(pvp.queue.waitingMs / 1000)} 秒 ·
                  满 {pvp.queue.teamSize * 2} 人立即开局，超过 {Math.floor(pvp.queue.fillMs / 1000)} 秒缺位由佣兵补上
                </p>
                <button type="button" className="gh-btn gh-btn--ghost" disabled={pvp.busy} onClick={() => void pvp.cancel()}>
                  取消匹配
                </button>
              </div>
            ) : (
              <div className="gh-raid-pvp-status">
                <p>
                  选择地图后进入匹配。PvP 里阵亡按普通阵亡结算：背包与胸挂会掉在原地，
                  可以被对手舔走，安全箱保留 —— 想稳赚就别带太贵的装备。
                </p>
                <div className="gh-raid-pvp-actions">
                  <select
                    className="gh-raid-pvp-select"
                    value={squadMapKey || overview.maps[0]?.key || ''}
                    onChange={(event) => setSquadMapKey(event.target.value)}
                  >
                    {overview.maps.map((map) => (
                      <option key={map.key} value={map.key}>
                        {map.emoji} {map.name}（T{map.lootTier} · 入场 {map.entryCost}）
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary"
                    disabled={pvp.busy || !overview.pet}
                    onClick={() => void pvp.enqueue(squadMapKey || overview.maps[0]?.key || 'wasteland')}
                  >
                    {pvp.busy ? '匹配中…' : '进入 PvP 匹配'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="gh-raid-history">
            <div className="gh-raid-section-head">
              <h2>最近战绩</h2>
              <span>最近 20 场</span>
            </div>
            {overview.history.length === 0 ? (
              <p className="gh-raid-empty">还没有行动记录，选一张地图出发吧。</p>
            ) : (
              <ul className="gh-raid-history-list">
                {overview.history.map((entry) => (
                  <li key={entry.id} className={`gh-raid-history-row is-${entry.result}`}>
                    <span className="gh-raid-history-map">{entry.mapEmoji} {entry.mapName}</span>
                    <span className={`gh-raid-history-result is-${entry.result}`}>{RESULT_LABELS[entry.result] ?? entry.result}</span>
                    <span>击杀 {entry.kills}</span>
                    <span>带出 {entry.lootValue}</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {settlement && <RaidResultDialog settlement={settlement} onClose={closeSettlement} />}
    </div>
  )
}
