import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PetBattleStage from '../components/pets/PetBattleStage'
import { usePoints } from '../contexts/PointsContext'
import api from '../lib/api'
import type { PetBattleOverview, PetBattleSummary, PetBattleView } from '../types/petBattle'

const OVERVIEW_POLL_MS = 5_000
const BATTLE_POLL_MS = 1_500
const PRESENCE_MS = 10_000

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function PetBattlePage() {
  const { refresh: refreshPoints } = usePoints()
  const [overview, setOverview] = useState<PetBattleOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [battleId, setBattleId] = useState<number | null>(null)
  const [battle, setBattle] = useState<PetBattleView | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const finishedNotifiedRef = useRef<number | null>(null)

  /** 只接受同一场对战中版本不倒退的响应（轮询与行动响应可能交错到达） */
  const applyBattle = useCallback((data: PetBattleView) => {
    setBattle((prev) => {
      if (!prev || prev.id !== data.id) return data
      return data.version >= prev.version ? data : prev
    })
  }, [])

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.get<PetBattleOverview>('/pets/battle/overview')
      setOverview(data)
      if (data.active) setBattleId((current) => current ?? data.active!.id)
      setError(null)
    } catch (err) {
      setError(errMessage(err, '竞技场加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  // 竞技场概览轮询（不在对局中时）
  useEffect(() => {
    if (battleId) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadOverview(true)
    }, OVERVIEW_POLL_MS)
    return () => window.clearInterval(timer)
  }, [battleId, loadOverview])

  // 对局轮询
  useEffect(() => {
    if (!battleId || battle?.finished) return undefined
    let stopped = false
    const tick = async () => {
      try {
        const data = await api.get<PetBattleView>(`/pets/battle/${battleId}`)
        if (!stopped) applyBattle(data)
      } catch (err) {
        if (!stopped) setToast({ tone: 'danger', text: errMessage(err, '对局同步失败') })
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick()
    }, BATTLE_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [battleId, battle?.finished])

  // 心跳（90 秒无心跳判负）
  useEffect(() => {
    if (!battleId || battle?.finished) return undefined
    const ping = () => {
      void api.post(`/pets/battle/${battleId}/presence`).catch(() => {})
    }
    ping()
    const timer = window.setInterval(ping, PRESENCE_MS)
    return () => window.clearInterval(timer)
  }, [battleId, battle?.finished])

  // 对局结束：刷新概览与积分（只提示一次）
  useEffect(() => {
    if (!battle?.finished) return
    if (finishedNotifiedRef.current === battle.id) return
    finishedNotifiedRef.current = battle.id
    void refreshPoints()
    void loadOverview(true)
    if (battle.result === 'draw') {
      setToast({ tone: 'success', text: '双方打成平局，没有积分与装备变动' })
    } else if (battle.winnerId === battle.me.userId) {
      setToast({
        tone: 'success',
        text: `你赢了！赢得 ${battle.rewardPoints} 积分${battle.drop ? `，并夺得「${battle.drop.name}」` : ''}`,
      })
    } else {
      setToast({
        tone: 'danger',
        text: `你输了，被拿走 ${battle.rewardPoints} 积分${battle.drop ? `，失去「${battle.drop.name}」` : ''}`,
      })
    }
  }, [battle, loadOverview, refreshPoints])

  const run = async <T,>(fn: () => Promise<T>, successText?: string): Promise<T | null> => {
    if (busy) return null
    setBusy(true)
    try {
      const result = await fn()
      if (successText) setToast({ tone: 'success', text: successText })
      await loadOverview(true)
      return result
    } catch (err) {
      setToast({ tone: 'danger', text: errMessage(err, '操作失败') })
      return null
    } finally {
      setBusy(false)
    }
  }

  const invite = (targetUserId: number, username: string) => {
    void run(() => api.post('/pets/battle/invite', { targetUserId }), `已向 ${username} 发出对战邀请`)
  }

  const respond = async (id: number, accept: boolean) => {
    const result = await run(
      () => api.post<PetBattleSummary>(`/pets/battle/${id}/respond`, { accept }),
      accept ? '已应战，准备开始' : '已拒绝邀请',
    )
    if (accept && result) {
      setBattleId(id)
      setBattle(null)
      finishedNotifiedRef.current = null
    }
  }

  const cancel = (id: number) => {
    void run(() => api.post(`/pets/battle/${id}/cancel`), '已取消邀请')
  }

  const action = async (skillKey: string) => {
    if (!battle) return
    try {
      const data = await api.post<PetBattleView>(`/pets/battle/${battle.id}/action`, {
        skillKey,
        version: battle.version,
      })
      setBattle(data)
    } catch (err) {
      setToast({ tone: 'danger', text: errMessage(err, '行动失败') })
      try {
        const fresh = await api.get<PetBattleView>(`/pets/battle/${battle.id}`)
        applyBattle(fresh)
      } catch {
        // 交给轮询恢复
      }
    }
  }

  const forfeit = async () => {
    if (!battle) return
    await run(() => api.post(`/pets/battle/${battle.id}/forfeit`), '已认输')
  }

  const leaveBattle = () => {
    setBattleId(null)
    setBattle(null)
    finishedNotifiedRef.current = null
    void loadOverview(true)
  }

  if (loading && !overview && !battle) {
    return (
      <div className="gh-page-container gh-pet-battle-page">
        <div className="gh-pet-loading">
          <span className="gh-pet-loading-emoji" aria-hidden>⚔️</span>
          <p>正在进入竞技场…</p>
        </div>
      </div>
    )
  }

  if (error && !overview && !battle) {
    return (
      <div className="gh-page-container gh-pet-battle-page">
        <div className="gh-pet-market-error">
          <h1>竞技场暂时关闭</h1>
          <p>{error}</p>
          <div className="gh-pet-market-error-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets">返回宠物页</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void loadOverview()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (battleId && !battle && !error) {
    return (
      <div className="gh-page-container gh-pet-battle-page">
        <div className="gh-pet-loading">
          <span className="gh-pet-loading-emoji" aria-hidden>⚔️</span>
          <p>正在同步对战…</p>
        </div>
      </div>
    )
  }

  if (battle) {
    return (
      <div className="gh-page-container gh-pet-battle-page">
        {toast && <div className={`gh-pet-toast gh-pet-toast--${toast.tone}`} role="status">{toast.text}</div>}
        <header className="gh-pet-gear-top">
          <button type="button" className="gh-pet-home-back" onClick={leaveBattle}>
            <span aria-hidden>←</span>
            返回竞技场
          </button>
          <div className="gh-pet-gear-links">
            <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/gear">🎒 装备</Link>
            <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/market">🏪 交易行</Link>
          </div>
        </header>

        <section className="gh-pet-battle-head">
          <div>
            <h1>宠物对战</h1>
            <p className="gh-text-tertiary">
              {battle.status === 'pending'
                ? '等待对方应战…'
                : battle.finished
                  ? '本场对战已结束'
                  : `第 ${battle.round} 回合 · 每回合 30 秒`}
            </p>
          </div>
          {!battle.finished && battle.status === 'active' && (
            <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => void forfeit()}>
              认输
            </button>
          )}
        </section>

        {battle.status === 'pending' ? (
          <section className="gh-pet-battle-waiting">
            <span aria-hidden>⏳</span>
            <h3>已向 {battle.opponent.username} 发出对战邀请</h3>
            <p>邀请 10 分钟内有效。对方应战后即可开始实时回合制对战。</p>
          </section>
        ) : (
          <PetBattleStage battle={battle} myUserId={battle.me.userId} busy={busy} onAction={(key) => void action(key)} />
        )}

        <section className="gh-pet-battle-log">
          <h2>战斗记录</h2>
          {battle.log.length === 0 ? (
            <p className="gh-text-tertiary">还没有行动。</p>
          ) : (
            <ol>
              {[...battle.log].reverse().slice(0, 30).map((event) => (
                <li key={event.seq} className={`gh-pet-battle-log-item gh-pet-battle-log-item--${event.kind}`}>
                  <span>#{event.seq}</span>
                  <p>{event.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    )
  }

  const incoming = overview?.incoming ?? []
  const outgoing = overview?.outgoing ?? []
  const history = overview?.history ?? []

  return (
    <div className="gh-page-container gh-pet-battle-page">
      {toast && <div className={`gh-pet-toast gh-pet-toast--${toast.tone}`} role="status">{toast.text}</div>}

      <header className="gh-pet-gear-top">
        <Link to="/pets" className="gh-pet-home-back">
          <span aria-hidden>←</span>
          返回宠物页
        </Link>
        <div className="gh-pet-gear-links">
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/gear">🎒 装备与技能</Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/market">🏪 交易行</Link>
        </div>
      </header>

      <section className="gh-pet-battle-hero">
        <div>
          <h1>⚔️ 宠物竞技场</h1>
          <p>邀请其他玩家实时对战。胜者从败者积分里拿走 {Math.round((overview?.stakeRule.rate ?? 0.08) * 100)}%（{overview?.stakeRule.min ?? 10}–{overview?.stakeRule.max ?? 300} 分），并随机夺得败者 1 件已穿戴装备。</p>
          <p className="gh-text-tertiary">同一对手每天最多 3 场；每人每天最多被夺走 1 件装备。</p>
        </div>
        <div className="gh-pet-battle-record">
          <strong>{overview?.record.wins ?? 0}</strong><small>胜</small>
          <strong>{overview?.record.losses ?? 0}</strong><small>负</small>
          <strong>{overview?.record.draws ?? 0}</strong><small>平</small>
        </div>
      </section>

      {incoming.length > 0 && (
        <section className="gh-pet-battle-panel">
          <h2>收到的邀请</h2>
          <div className="gh-pet-battle-invites">
            {incoming.map((invite) => (
              <div key={invite.id} className="gh-pet-battle-invite">
                <div>
                  <strong>{invite.challenger.username}</strong>
                  <span>{invite.challenger.petName} Lv.{invite.challenger.level} → 你的 {invite.opponent.petName} Lv.{invite.opponent.level}</span>
                </div>
                <div className="gh-pet-battle-invite-actions">
                  <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy} onClick={() => void respond(invite.id, true)}>
                    应战
                  </button>
                  <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" disabled={busy} onClick={() => void respond(invite.id, false)}>
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="gh-pet-battle-panel">
          <h2>我发出的邀请</h2>
          <div className="gh-pet-battle-invites">
            {outgoing.map((invite) => (
              <div key={invite.id} className="gh-pet-battle-invite">
                <div>
                  <strong>{invite.opponent.username}</strong>
                  <span>等待对方应战 · {formatTime(invite.createdAt)}</span>
                </div>
                <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => cancel(invite.id)}>
                  取消
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="gh-pet-battle-panel">
        <h2>可挑战的玩家</h2>
        {(overview?.opponents ?? []).length === 0 ? (
          <p className="gh-text-tertiary">还没有其他在世宠物，去宠物之家逛逛吧。</p>
        ) : (
          <div className="gh-pet-battle-opponents">
            {(overview?.opponents ?? []).map((opponent) => (
              <div key={opponent.userId} className="gh-pet-battle-opponent">
                <div className="gh-pet-battle-opponent-main">
                  <strong>{opponent.username}</strong>
                  <span>{opponent.petName} · Lv.{opponent.level} · {opponent.speciesName}</span>
                </div>
                <span className="gh-pet-battle-remain">今日还可挑战 {opponent.remainingToday} 次</span>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--sm"
                  disabled={busy || opponent.remainingToday <= 0}
                  onClick={() => invite(opponent.userId, opponent.username)}
                >
                  发起挑战
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="gh-pet-battle-panel">
        <div className="gh-pet-battle-panel-head">
          <h2>对战记录</h2>
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? '收起' : `展开最近 ${history.length} 场`}
          </button>
        </div>
        {showHistory && (
          history.length === 0 ? (
            <p className="gh-text-tertiary">还没有对战记录。</p>
          ) : (
            <div className="gh-pet-battle-history">
              {history.map((row) => {
                const win = row.winnerId === row.challenger.userId
                  ? row.challenger.username
                  : row.opponent.username
                return (
                  <div key={row.id} className="gh-pet-battle-history-row">
                    <span>{formatTime(row.createdAt)}</span>
                    <span>{row.challenger.username} vs {row.opponent.username}</span>
                    <strong>{row.result === 'draw' ? '平局' : `${win} 胜`}</strong>
                    <span>{row.result === 'draw' ? '—' : `积分 ${row.rewardPoints}`}</span>
                    <span>{row.drop ? `掉落 ${row.drop.name}` : '无掉落'}</span>
                  </div>
                )
              })}
            </div>
          )
        )}
      </section>
    </div>
  )
}
