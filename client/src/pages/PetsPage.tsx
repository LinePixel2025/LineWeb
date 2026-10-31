import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PetSprite from '../components/pets/PetSprite'
import { usePoints } from '../contexts/PointsContext'
import api from '../lib/api'
import type {
  PetCareActionInfo,
  PetCareResult,
  PetCatalog,
  PetDto,
  PetOutfitBuyResult,
  PetOutfitInfo,
  PetActionResult,
  PetSpecies,
  PetSpeciesInfo,
  PetTouchResult,
  PetUpdateResult,
  PetSummonResult,
  PetsView,
} from '../types/pet'

/* ============================================================
   工具
   ============================================================ */

/** 用一条计时器驱动倒计时（每分钟重算一次即可） */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/** 距离最早一项数值见底的小时数（优先 zeroAtMs，缺失时按衰减率估算） */
function hoursUntilZero(pet: PetDto, now: number): number | null {
  if (pet.zeroAtMs != null) {
    return Math.max(0, (pet.zeroAtMs - now) / 3_600_000)
  }
  const rates = pet.decayPerHour
  const candidates = [
    rates.hunger > 0 ? pet.hunger / rates.hunger : Infinity,
    rates.cleanliness > 0 ? pet.cleanliness / rates.cleanliness : Infinity,
    rates.mood > 0 ? pet.mood / rates.mood : Infinity,
  ].filter((value) => Number.isFinite(value))
  return candidates.length > 0 ? Math.max(0, Math.min(...candidates)) : null
}

function formatCountdown(hours: number): string {
  if (hours <= 0) return '已见底，宽限期内快照顾它！'
  if (hours < 1) return `约 ${Math.max(1, Math.round(hours * 60))} 分钟后见底`
  return `约 ${Math.round(hours)} 小时后见底`
}

/** 提取接口错误里的中文信息（api 库 reject 的 Error.message 即 response.data.error） */
function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/* ============================================================
   常量
   ============================================================ */

/** 照顾动作 → 立绘动画 */
const CARE_ANIMS: Record<PetCareActionInfo['key'], string> = {
  feed: 'eat',
  bathe: 'bath',
  play: 'play',
}

/** 抚摸随机小动画：爱心 / 歪头 / 蹦跳翻滚 */
const TOUCH_ANIMS = ['happy', 'sing', 'roll'] as const

/** 状态条低值警告文案 */
const STAT_WARN_TEXTS: Record<'hunger' | 'cleanliness' | 'mood', string> = {
  hunger: '快饿肚子啦',
  cleanliness: '身上脏兮兮',
  mood: '闷闷不乐',
}

const SLOT_LABELS: Record<'hat' | 'neck' | 'face', string> = {
  hat: '头部',
  neck: '颈部',
  face: '面部',
}

/** 立绘动画结束回到 idle 的时长（覆盖最长动画 2.1s） */
const ANIM_DURATION_MS = 2_200

/* ============================================================
   页面
   ============================================================ */

/**
 * 宠物：花积分召唤并照顾一只 2D 小宠物。
 * 数值衰减 / 花费结算全部由服务端完成（`/api/pets`），页面只负责展示、动画与乐观扣分。
 */
export default function PetsPage() {
  const { applyLocalDelta, refresh: refreshPoints } = usePoints()
  const [pet, setPet] = useState<PetDto | null>(null)
  const [catalog, setCatalog] = useState<PetCatalog | null>(null)
  const [points, setPoints] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)
  const [action, setAction] = useState('idle')
  /** gone 状态下是否展开重新召唤卡 */
  const [summonOpen, setSummonOpen] = useState(false)

  // 召唤表单
  const [selected, setSelected] = useState<PetSpecies>('cat')
  const [summonName, setSummonName] = useState('')
  // 改名行内编辑
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const mountedRef = useRef(true)
  const animTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (animTimerRef.current !== null) window.clearTimeout(animTimerRef.current)
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

  /** 播放动作动画，结束后回到 idle */
  const playAnimation = useCallback((key: string) => {
    setAction(key)
    if (animTimerRef.current !== null) window.clearTimeout(animTimerRef.current)
    animTimerRef.current = window.setTimeout(() => {
      animTimerRef.current = null
      setAction('idle')
    }, ANIM_DURATION_MS)
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setLoadError('')
    }
    try {
      const data = await api.get<PetsView>('/pets')
      if (!mountedRef.current) return
      setPet(data.pet)
      setCatalog(data.catalog)
      setPoints(data.points)
      // 轮询发现宠物回来了（或首次就是活的）时收起召唤卡
      if (data.pet && data.pet.status === 'alive') setSummonOpen(false)
    } catch (err) {
      if (!silent && mountedRef.current) setLoadError(errMessage(err, '加载宠物信息失败'))
    } finally {
      if (mountedRef.current && !silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // 静默轮询（30s，仅页面可见时）+ 恢复可见立即刷新
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const petAlive = !!pet && pet.status === 'alive'
  const petGone = !!pet && pet.status === 'gone'
  const alivePet = petAlive ? pet : null
  const now = useNow(petAlive)

  /* ---------- 操作 ---------- */

  const handleSummon = async () => {
    if (!catalog || busy) return
    const cost = catalog.costs.summon
    if (points < cost) {
      showToast('积分不足，先去赚点积分吧', 'error')
      return
    }
    setBusy('summon')
    applyLocalDelta(-cost)
    const name = summonName.trim()
    try {
      const result = await api.post<PetSummonResult>('/pets/summon', {
        species: selected,
        ...(name ? { name } : {}),
      })
      if (!mountedRef.current) return
      setPet(result.pet)
      setPoints(result.points)
      setSummonOpen(false)
      setSummonName('')
      showToast(`${result.pet.name} 来到你身边啦！`, 'success')
      void refreshPoints()
    } catch (err) {
      applyLocalDelta(cost)
      showToast(errMessage(err, '召唤失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleCare = async (care: PetCareActionInfo) => {
    if (!pet || busy) return
    if (pet.level < care.minLevel || points < care.cost) return
    setBusy(`care-${care.key}`)
    applyLocalDelta(-care.cost)
    playAnimation(CARE_ANIMS[care.key])
    try {
      const result = await api.post<PetCareResult>(`/pets/${care.key}`, {})
      if (!mountedRef.current) return
      setPet(result.pet)
      setPoints(result.points)
      void refreshPoints()
    } catch (err) {
      applyLocalDelta(care.cost)
      showToast(errMessage(err, '操作失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleTouch = async () => {
    if (!petAlive || busy) return
    setBusy('touch')
    playAnimation(TOUCH_ANIMS[Math.floor(Math.random() * TOUCH_ANIMS.length)])
    try {
      const result = await api.post<PetTouchResult>('/pets/touch', {})
      if (!mountedRef.current) return
      setPet(result.pet)
      if (result.gained) showToast('心情 +2，它很享受你的抚摸', 'success')
    } catch (err) {
      showToast(errMessage(err, '抚摸失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleTrick = async (trickKey: string) => {
    if (!pet || busy) return
    if (!pet.unlockedActions.includes(trickKey)) return
    setBusy(`trick-${trickKey}`)
    try {
      const result = await api.post<PetActionResult>('/pets/action', { action: trickKey })
      if (!mountedRef.current) return
      setPet(result.pet)
      playAnimation(result.animation || trickKey)
    } catch (err) {
      showToast(errMessage(err, '动作失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleUpgrade = async () => {
    if (!pet || busy) return
    const cost = pet.nextLevelCost
    if (cost == null) return
    if (points < cost) {
      showToast('积分不足，先去赚点积分吧', 'error')
      return
    }
    setBusy('upgrade')
    applyLocalDelta(-cost)
    try {
      const result = await api.post<PetCareResult>('/pets/upgrade', {})
      if (!mountedRef.current) return
      setPet(result.pet)
      setPoints(result.points)
      showToast(`升级成功！现在是 Lv.${result.pet.level}`, 'success')
      void refreshPoints()
    } catch (err) {
      applyLocalDelta(cost)
      showToast(errMessage(err, '升级失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleBuyOutfit = async (outfit: PetOutfitInfo) => {
    if (!pet || busy) return
    if (pet.level < outfit.minLevel) return
    if (points < outfit.price) {
      showToast('积分不足，先去赚点积分吧', 'error')
      return
    }
    setBusy(`buy-${outfit.key}`)
    applyLocalDelta(-outfit.price)
    try {
      const result = await api.post<PetOutfitBuyResult>('/pets/outfits/buy', { outfitKey: outfit.key })
      if (!mountedRef.current) return
      setPet(result.pet)
      setPoints(result.points)
      showToast(`已购入「${outfit.name}」，快给它穿上吧`, 'success')
      void refreshPoints()
    } catch (err) {
      applyLocalDelta(outfit.price)
      showToast(errMessage(err, '购买失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleEquip = async (outfit: PetOutfitInfo, equip: boolean) => {
    if (!pet || busy) return
    setBusy(`equip-${outfit.key}`)
    // 乐观更新同槽位穿戴；同 slot 自动替换以服务端响应为准
    setPet({ ...pet, equipped: { ...pet.equipped, [outfit.slot]: equip ? outfit.key : null } })
    try {
      const result = await api.post<PetUpdateResult>('/pets/outfits/equip', { outfitKey: outfit.key, equip })
      if (!mountedRef.current) return
      setPet(result.pet)
      showToast(equip ? `已穿上「${outfit.name}」` : `已脱下「${outfit.name}」`, 'success')
    } catch (err) {
      showToast(errMessage(err, '换装失败，请稍后再试'), 'error')
      void load(true) // 失败回滚：以服务端为准
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleRename = async () => {
    const name = renameValue.trim()
    if (!pet || !name) return
    setBusy('rename')
    try {
      const result = await api.post<PetUpdateResult>('/pets/rename', { name })
      if (!mountedRef.current) return
      setPet(result.pet)
      setRenaming(false)
      showToast('名字已更新', 'success')
    } catch (err) {
      showToast(errMessage(err, '改名失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  /* ---------- 派生数据 ---------- */

  const selectedInfo: PetSpeciesInfo | undefined = catalog?.species.find((item) => item.key === selected)
  const lowStat = !!alivePet && Math.min(alivePet.hunger, alivePet.cleanliness, alivePet.mood) < 20
  const warnStats = alivePet
    ? (['hunger', 'cleanliness', 'mood'] as const).filter((key) => alivePet[key] < 20)
    : []
  const untilZero = alivePet ? hoursUntilZero(alivePet, now) : null
  const showCountdown = petAlive && (alivePet?.zeroAtMs != null || warnStats.length > 0)
  const untilGoneHours = untilZero != null
    ? untilZero + (pet?.graceHours ?? 0)
    : null

  /* ---------- 渲染 ---------- */

  if (loading) {
    return (
      <div className="gh-page-container gh-pet-page">
        <div className="gh-pet-loading">
          <span className="gh-pet-loading-emoji" aria-hidden>🐾</span>
          <p>正在敲宠物小屋的门…</p>
        </div>
      </div>
    )
  }

  if (!catalog) {
    return (
      <div className="gh-page-container gh-pet-page">
        <div className="gh-alert gh-alert--danger" role="alert">{loadError || '加载宠物信息失败'}</div>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void load()}>
          重试
        </button>
      </div>
    )
  }

  const showSummonCard = !pet || (petGone && summonOpen)

  return (
    <div className="gh-page-container gh-pet-page">
      {toast && (
        <div className={`gh-pet-toast gh-pet-toast--${toast.tone}`} role="status">{toast.text}</div>
      )}

      <header className="gh-pet-head">
        <div>
          <p className="gh-pet-eyebrow">LINEWEB PET</p>
          <h1>🐾 我的宠物</h1>
          <p className="gh-pet-sub">
            召唤一只属于你的 2D 小宠物：喂食、洗澡、玩耍换好心情，赚积分给它换装升级。冷落太久它会离家出走哦。
          </p>
        </div>
        <div className="gh-pet-head-actions">
          <span className="gh-pet-points" title="当前积分">
            <span aria-hidden>🪙</span>
            {points}
          </span>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/points">积分中心</Link>
        </div>
      </header>

      {/* 离家出走预警：任一数值 < 20 */}
      {petAlive && untilGoneHours != null && warnStats.length > 0 && (
        <div className="gh-pet-warn" role="alert">
          <span aria-hidden>⚠️</span>
          再不照顾，宠物将在 {
            untilGoneHours < 1 ? '不足 1 小时' : `约 ${Math.ceil(untilGoneHours)} 小时`
          } 后离家出走（{warnStats.map((key) => STAT_WARN_TEXTS[key]).join('、')}）
        </div>
      )}

      {showSummonCard ? (
        <SummonCard
          catalog={catalog}
          selected={selected}
          onSelect={setSelected}
          name={summonName}
          onNameChange={setSummonName}
          points={points}
          busy={busy === 'summon'}
          resummon={petGone}
          onSummon={() => void handleSummon()}
        />
      ) : petGone && pet ? (
        <GoneCard pet={pet} onResummon={() => setSummonOpen(true)} />
      ) : pet && petAlive ? (
        <div className="gh-pet-layout">
          <section>
            <div className="gh-pet-stage">
              <span className="gh-pet-stage-frame" aria-hidden />
              <span className="gh-pet-stage-window" aria-hidden />
              <span className="gh-pet-stage-rug" aria-hidden />
              <button
                type="button"
                className="gh-pet-stage-hit"
                title={pet.touchReady ? '摸摸它' : '它刚被摸过，稍等一下再来'}
                disabled={!!busy}
                onClick={() => void handleTouch()}
              >
                <PetSprite
                  species={pet.species}
                  action={action}
                  equipped={pet.equipped}
                  size={200}
                  sad={lowStat}
                />
              </button>
              <span className="gh-pet-stage-hint">点击宠物摸摸它 · 每分钟最多涨一次心情</span>
            </div>

            <div className="gh-pet-dock">
              <div className="gh-pet-dock-group">
                <p className="gh-pet-dock-group-title">照顾</p>
                {catalog.careActions.map((care) => {
                  const levelLocked = pet.level < care.minLevel
                  const affordable = points >= care.cost
                  return (
                    <button
                      key={care.key}
                      type="button"
                      className={`gh-pet-dock-btn ${levelLocked ? 'gh-pet-dock-btn--locked' : ''}`}
                      title={care.description}
                      disabled={levelLocked || !affordable || !!busy}
                      onClick={() => void handleCare(care)}
                    >
                      <span className="gh-pet-dock-emoji" aria-hidden>{care.emoji}</span>
                      <strong>{care.name}</strong>
                      <span className="gh-pet-dock-meta">
                        {levelLocked ? `🔒 Lv.${care.minLevel}` : `-${care.cost} 积分`}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="gh-pet-dock-group">
                <p className="gh-pet-dock-group-title">小把戏（免费）</p>
                {catalog.tricks.map((trick) => {
                  const unlocked = pet.unlockedActions.includes(trick.key)
                  return (
                    <button
                      key={trick.key}
                      type="button"
                      className={`gh-pet-dock-btn gh-pet-dock-btn--trick ${unlocked ? '' : 'gh-pet-dock-btn--locked'}`}
                      title={trick.description}
                      disabled={!unlocked || !!busy}
                      onClick={() => void handleTrick(trick.key)}
                    >
                      <span className="gh-pet-dock-emoji" aria-hidden>{unlocked ? trick.emoji : '🔒'}</span>
                      <strong>{trick.name}</strong>
                      <span className="gh-pet-dock-meta">
                        {unlocked ? '表演' : `Lv.${trick.minLevel} 解锁`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className="gh-pet-side">
            {/* 名牌 */}
            <div className="gh-pet-panel">
              {renaming ? (
                <div className="gh-pet-rename-form">
                  <input
                    className="gh-pet-rename-input"
                    value={renameValue}
                    maxLength={12}
                    autoFocus
                    placeholder="1–12 个字"
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleRename() }}
                  />
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busy === 'rename' || !renameValue.trim()}
                    onClick={() => void handleRename()}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    onClick={() => setRenaming(false)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="gh-pet-name-row">
                  <h2 className="gh-pet-name">{pet.name}</h2>
                  <button
                    type="button"
                    className="gh-pet-rename-btn"
                    title="改名"
                    onClick={() => { setRenameValue(pet.name); setRenaming(true) }}
                  >
                    ✏️
                  </button>
                  <span className="gh-pet-level-badge">Lv.{pet.level} / {catalog.maxLevel}</span>
                </div>
              )}
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                disabled={pet.nextLevelCost == null || !!busy || points < (pet.nextLevelCost ?? 0)}
                onClick={() => void handleUpgrade()}
              >
                {pet.nextLevelCost == null
                  ? '已满级'
                  : `升级到 Lv.${pet.level + 1} · 🪙 ${pet.nextLevelCost}`}
              </button>
            </div>

            {/* 状态条 */}
            <div className="gh-pet-panel">
              <h3 className="gh-pet-panel-title">状态</h3>
              {(['hunger', 'cleanliness', 'mood'] as const).map((key) => {
                const value = pet[key]
                const labels = { hunger: '🍖 饱食度', cleanliness: '🧼 清洁', mood: '💛 心情' } as const
                return (
                  <div key={key} className="gh-pet-stat">
                    <div className="gh-pet-stat-head">
                      <span>{labels[key]}</span>
                      <span className="gh-pet-stat-num">{value}</span>
                    </div>
                    <div className="gh-pet-stat-bar">
                      <span
                        className={`gh-pet-stat-fill ${key === 'mood' ? 'gh-pet-stat-fill--mood' : ''} ${value < 20 ? 'gh-pet-stat-fill--low' : ''}`}
                        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                      />
                    </div>
                    {value < 20 && <span className="gh-pet-stat-warn">{STAT_WARN_TEXTS[key]}</span>}
                  </div>
                )
              })}
              {showCountdown && untilZero != null && (
                <p className={`gh-pet-stat-countdown ${untilZero < 1 ? 'gh-pet-stat-countdown--urgent' : ''}`}>
                  {formatCountdown(untilZero)}
                </p>
              )}
            </div>

            {/* 衣柜 */}
            <div className="gh-pet-panel">
              <h3 className="gh-pet-panel-title">衣柜</h3>
              {(['hat', 'neck', 'face'] as const).map((slot) => (
                <div key={slot} className="gh-pet-wardrobe-slot">
                  <h3>{SLOT_LABELS[slot]}</h3>
                  <div className="gh-pet-outfit-grid">
                    {catalog.outfits.filter((outfit) => outfit.slot === slot).map((outfit) => {
                      const owned = pet.ownedOutfits.includes(outfit.key)
                      const worn = pet.equipped[slot] === outfit.key
                      const levelLocked = pet.level < outfit.minLevel
                      return (
                        <div
                          key={outfit.key}
                          className={`gh-pet-outfit ${worn ? 'gh-pet-outfit--worn' : ''}`}
                        >
                          <span className="gh-pet-outfit-emoji" aria-hidden>{outfit.emoji}</span>
                          <strong className="gh-pet-outfit-name">{outfit.name}</strong>
                          <span className="gh-pet-outfit-desc">{outfit.description}</span>
                          {owned ? (
                            <button
                              type="button"
                              className={`gh-pet-outfit-btn ${worn ? '' : 'gh-pet-outfit-btn--primary'}`}
                              disabled={busy === `equip-${outfit.key}`}
                              onClick={() => void handleEquip(outfit, !worn)}
                            >
                              {worn ? '脱下' : '穿上'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="gh-pet-outfit-btn"
                              title={outfit.description}
                              disabled={levelLocked || points < outfit.price || !!busy}
                              onClick={() => void handleBuyOutfit(outfit)}
                            >
                              {levelLocked ? `🔒 Lv.${outfit.minLevel}` : `🪙 ${outfit.price} 购买`}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

/* ============================================================
   召唤卡
   ============================================================ */

function SummonCard({
  catalog,
  selected,
  onSelect,
  name,
  onNameChange,
  points,
  busy,
  resummon,
  onSummon,
}: {
  catalog: PetCatalog
  selected: PetSpecies
  onSelect: (species: PetSpecies) => void
  name: string
  onNameChange: (value: string) => void
  points: number
  busy: boolean
  resummon: boolean
  onSummon: () => void
}) {
  const affordable = points >= catalog.costs.summon
  return (
    <section className="gh-pet-summon">
      <h2>{resummon ? '重新召唤一位新伙伴' : '召唤一只小宠物'}</h2>
      <p className="gh-pet-summon-note">
        {resummon
          ? '已购的装扮会一直保留，重新召唤后还能穿上。'
          : '挑一只喜欢的伙伴起个名字，之后记得按时喂食、洗澡、陪它玩。'}
      </p>
      <div className="gh-pet-summon-grid">
        {catalog.species.map((species) => (
          <button
            key={species.key}
            type="button"
            className={`gh-pet-summon-card ${selected === species.key ? 'gh-pet-summon-card--active' : ''}`}
            onClick={() => onSelect(species.key)}
          >
            <PetSprite species={species.key} action="idle" size={110} />
            <strong>{species.emoji} {species.name}</strong>
            <span className="gh-pet-summon-card-desc">{species.description}</span>
          </button>
        ))}
      </div>
      <div className="gh-pet-summon-form">
        <input
          className="gh-pet-summon-input"
          value={name}
          maxLength={12}
          placeholder={selectedInfoPlaceholder(catalog, selected)}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && affordable && !busy) onSummon() }}
        />
        <span className="gh-pet-cost-badge" title="召唤花费">🪙 {catalog.costs.summon} 积分</span>
        <button
          type="button"
          className="gh-btn gh-btn--primary gh-btn--md"
          disabled={busy || !affordable}
          onClick={onSummon}
        >
          {busy ? '召唤中…' : affordable ? '召唤' : '积分不足'}
        </button>
      </div>
    </section>
  )
}

function selectedInfoPlaceholder(catalog: PetCatalog, selected: PetSpecies): string {
  return `给宠物起个名字（可留空，默认 ${catalog.species.find((item) => item.key === selected)?.defaultName ?? ''}）`
}

/* ============================================================
   离家出走空状态
   ============================================================ */

function GoneCard({ pet, onResummon }: { pet: PetDto; onResummon: () => void }) {
  return (
    <section className="gh-pet-gone">
      <div className="gh-pet-gone-silhouette" aria-hidden>
        <PetSprite species={pet.species} action="idle" equipped={pet.equipped} size={140} sad />
        <span className="gh-pet-gone-wind">💨</span>
      </div>
      <h2>你的宠物因太久没人照顾，离家出走了…</h2>
      <p>
        {pet.name} 走了。多关注它的饱食度、清洁和心情，就不会发生这种事。
        已购的装扮会一直保留，重新召唤后还能穿上。
      </p>
      <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={onResummon}>
        重新召唤
      </button>
    </section>
  )
}
