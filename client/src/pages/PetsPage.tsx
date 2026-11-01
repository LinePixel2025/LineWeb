import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PetSprite from '../components/pets/PetSprite'
import PetHomeCard from '../components/pets/PetHomeCard'
import { resolveSpeciesMeta, resolveSpeciesPalette } from '../components/pets/petTheme'
import { usePoints } from '../contexts/PointsContext'
import api from '../lib/api'
import type {
  PetCareActionInfo,
  PetCareResult,
  PetCatalog,
  PetDto,
  PetHomesResult,
  PetOutfitBuyResult,
  PetOutfitInfo,
  PetActionResult,
  PetSpecies,
  PetSpeciesInfo,
  PetSummonResult,
  PetTouchResult,
  PetUpdateResult,
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
  feed: 'feed',
  bathe: 'bathe',
  play: 'play',
}

/** 抚摸随机小动画：都是「开心」向的短动作 */
const TOUCH_ANIMS = ['touch', 'happy', 'pat'] as const

const STAT_LABELS: Record<'hunger' | 'cleanliness' | 'mood', string> = {
  hunger: '饱食度',
  cleanliness: '清洁度',
  mood: '心情',
}

const STAT_ICONS: Record<'hunger' | 'cleanliness' | 'mood', string> = {
  hunger: '🍖',
  cleanliness: '🧼',
  mood: '💛',
}

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

const SLOT_ICONS: Record<'hat' | 'neck' | 'face', string> = {
  hat: '🎩',
  neck: '🧣',
  face: '👓',
}

/** 对话气泡：动作台词 */
interface BubbleLine {
  emoji: string
  text: string
}

const ACTION_QUOTES: Record<string, BubbleLine> = {
  feed: { emoji: '🍖', text: '好吃！还想再来一碗～' },
  bathe: { emoji: '🫧', text: '泡泡软软的，好舒服呀。' },
  play: { emoji: '🎾', text: '接住球啦！再来一次！' },
  touch: { emoji: '💗', text: '最喜欢你摸摸我啦～' },
  pat: { emoji: '💗', text: '被摸得好舒服～' },
  happy: { emoji: '💛', text: '今天心情超好！' },
  dance: { emoji: '🎵', text: '跟着节拍摇起来～' },
  roll: { emoji: '🌀', text: '咕噜咕噜…转得有点晕啦。' },
  sing: { emoji: '🎤', text: '啦啦啦～这首歌送给你。' },
  flip: { emoji: '🤸', text: '看我的空中转体！' },
  spin: { emoji: '🌪️', text: '原地小旋风——转！' },
  magic: { emoji: '✨', text: '见证奇迹的时刻！' },
  firework: { emoji: '🎆', text: '满级庆祝，砰！' },
  stretch: { emoji: '💤', text: '伸——个——大懒腰…好舒服。' },
  beg: { emoji: '🥺', text: '拜托拜托，就一小口嘛。' },
  highfive: { emoji: '✋', text: '击掌！今天也要加油呀。' },
  moonwalk: { emoji: '🕺', text: '看我的太空步，酷不酷？' },
  playdead: { emoji: '💫', text: '我…倒下了…（偷偷睁眼）' },
  cheer: { emoji: '🎉', text: '好耶！一起欢呼吧！' },
}

/** 无动作时的气泡文案：按最低状态给一句关心 / 心情话 */
function petBubbleLine(pet: PetDto): BubbleLine {
  if (pet.hunger < 20) return { emoji: '🍖', text: '肚子咕咕叫…可以喂我一点吗？' }
  if (pet.cleanliness < 20) return { emoji: '🧼', text: '毛毛有点脏了，想洗个热水澡…' }
  if (pet.mood < 20) return { emoji: '💛', text: '有点无聊，陪我玩一会儿嘛。' }
  if (pet.hunger < 45) return { emoji: '🍗', text: '好像有点饿了，待会儿喂我嘛。' }
  if (pet.cleanliness < 45) return { emoji: '🫧', text: '身上痒痒的，想搓搓泡泡。' }
  if (pet.mood < 45) return { emoji: '🐾', text: '摸摸头会变开心哦。' }
  return { emoji: '✨', text: '今天也安静地陪着你～' }
}

/** 立绘动画结束回到 idle 的时长（覆盖最长动画 2.4s） */
const ANIM_DURATION_MS = 2_500

type PetTab = 'mine' | 'switch' | 'homes'

const TABS: Array<{ key: PetTab; label: string }> = [
  { key: 'mine', label: '我的宠物' },
  { key: 'switch', label: '换宠物' },
  { key: 'homes', label: '宠物之家' },
]

/* ============================================================
   页面
   ============================================================ */

/**
 * 宠物：花积分召唤并照顾一只 2D 小宠物。
 * 数值衰减 / 花费结算全部由服务端完成（`/api/pets`），页面只负责展示、动画与乐观扣分。
 *
 * 三个 Tab 共用同一份 `/api/pets` 数据：
 *   - 我的宠物：状态 / 照顾 / 特技 / 衣柜
 *   - 换宠物：花 100 积分换物种（等级与装扮保留）
 *   - 宠物之家：搜索并串门别人的宠物
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
  const [tab, setTab] = useState<PetTab>('mine')
  /** gone 状态下是否展开重新召唤卡 */
  const [summonOpen, setSummonOpen] = useState(false)
  /** 换宠物确认框里待确认的物种 */
  const [switchTarget, setSwitchTarget] = useState<PetSpecies | null>(null)

  // 召唤表单
  const [selected, setSelected] = useState<PetSpecies>('cat')
  const [summonName, setSummonName] = useState('')
  // 改名行内编辑
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  // 宠物之家列表
  const [homes, setHomes] = useState<PetHomesResult['homes']>([])
  const [homesQuery, setHomesQuery] = useState('')
  const [homesLoading, setHomesLoading] = useState(false)
  const [homesError, setHomesError] = useState('')
  const [homesLoaded, setHomesLoaded] = useState(false)

  const mountedRef = useRef(true)
  const animTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const homesReqRef = useRef(0)

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

  /* ---------- 宠物之家列表 ---------- */

  const loadHomes = useCallback(async (query: string) => {
    const reqId = homesReqRef.current + 1
    homesReqRef.current = reqId
    setHomesLoading(true)
    setHomesError('')
    try {
      const trimmed = query.trim()
      const data = await api.get<PetHomesResult>(
        trimmed ? `/pets/homes?query=${encodeURIComponent(trimmed)}` : '/pets/homes',
      )
      if (!mountedRef.current || homesReqRef.current !== reqId) return
      setHomes(data.homes)
      setHomesLoaded(true)
    } catch (err) {
      if (!mountedRef.current || homesReqRef.current !== reqId) return
      setHomesError(errMessage(err, '加载宠物之家失败'))
    } finally {
      if (mountedRef.current && homesReqRef.current === reqId) setHomesLoading(false)
    }
  }, [])

  // 首次切到「宠物之家」时拉一次列表（避免进页面就打两个接口）
  useEffect(() => {
    if (tab === 'homes' && !homesLoaded && !homesLoading) void loadHomes('')
  }, [tab, homesLoaded, homesLoading, loadHomes])

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

  const confirmSwitch = async () => {
    if (!pet || !switchTarget || busy) return
    const cost = switchCost
    if (points < cost) {
      showToast('积分不足，先去赚点积分吧', 'error')
      return
    }
    const target = switchTarget
    setBusy('switch')
    applyLocalDelta(-cost)
    try {
      const result = await api.post<PetCareResult>('/pets/switch', { species: target })
      if (!mountedRef.current) return
      setPet(result.pet)
      setPoints(result.points)
      setSwitchTarget(null)
      showToast(`${result.pet.name} 换好新模样啦！`, 'success')
      void refreshPoints()
    } catch (err) {
      applyLocalDelta(cost)
      showToast(errMessage(err, '换宠物失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  /* ---------- 派生数据 ---------- */

  const speciesInfo = alivePet ? catalog?.species.find((item) => item.key === alivePet.species) : undefined
  const warnStats = alivePet
    ? (['hunger', 'cleanliness', 'mood'] as const).filter((key) => alivePet[key] < 20)
    : []
  const untilZero = alivePet ? hoursUntilZero(alivePet, now) : null
  const showCountdown = petAlive && (alivePet?.zeroAtMs != null || warnStats.length > 0)
  const untilGoneHours = untilZero != null
    ? untilZero + (pet?.graceHours ?? 0)
    : null

  // 对话气泡：动作中显示台词，闲置时按状态给一句短文案
  const bubble: BubbleLine = alivePet
    ? (ACTION_QUOTES[action] ?? petBubbleLine(alivePet))
    : { emoji: '🐾', text: '它会回来的。' }
  const levelPercent = pet && catalog ? Math.round((pet.level / catalog.maxLevel) * 100) : 0
  const unlockedTricks = pet && catalog
    ? catalog.tricks.filter((trick) => pet.unlockedActions.includes(trick.key)).length
    : 0
  const switchCost = catalog?.switchCost ?? catalog?.costs.switch ?? 100
  const switchPreview = switchTarget ? catalog?.species.find((item) => item.key === switchTarget) : undefined
  const switchSuggestName = switchPreview
    ? resolveSpeciesMeta(switchPreview.key, switchPreview).defaultName
    : ''

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

      <nav className="gh-pet-tabs" role="tablist" aria-label="宠物页切换">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`gh-pet-tab ${tab === item.key ? 'gh-pet-tab--active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'mine' && (
        <>
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
                  <div className="gh-pet-stage-scene" aria-hidden>
                    <span className="gh-pet-stage-wall" />
                    <span className="gh-pet-stage-window"><i /></span>
                    <span className="gh-pet-stage-frame" />
                    <span className="gh-pet-stage-shelf"><i /><i /><i /></span>
                    <span className="gh-pet-stage-floor" />
                    <span className="gh-pet-stage-beam" />
                    <span className="gh-pet-stage-rug" />
                    <span className="gh-pet-stage-plant"><i /><i /><i /><i /></span>
                    <span className="gh-pet-stage-ball"><i /></span>
                    <span className="gh-pet-stage-mote gh-pet-stage-mote--1" />
                    <span className="gh-pet-stage-mote gh-pet-stage-mote--2" />
                    <span className="gh-pet-stage-mote gh-pet-stage-mote--3" />
                    <span className="gh-pet-stage-mote gh-pet-stage-mote--4" />
                    <span className="gh-pet-stage-mote gh-pet-stage-mote--5" />
                  </div>
                  <div className="gh-pet-bubble" role="status" aria-live="polite" key={bubble.text}>
                    <span className="gh-pet-bubble-emoji" aria-hidden>{bubble.emoji}</span>
                    {bubble.text}
                  </div>
                  <button
                    type="button"
                    className="gh-pet-stage-hit"
                    title={pet.touchReady ? '摸摸它' : '它刚被摸过，稍等一下再来'}
                    disabled={!!busy}
                    onClick={() => void handleTouch()}
                  >
                    <PetSprite
                      species={pet.species}
                      animation={action}
                      equipped={pet.equipped}
                      mood={pet.mood}
                      size={200}
                      interactive
                    />
                  </button>
                  <span className="gh-pet-stage-hint">点击宠物摸摸它 · 每分钟最多涨一次心情</span>
                </div>

                <div className="gh-pet-dock">
                  <section className="gh-pet-dock-group">
                    <div className="gh-pet-dock-group-head">
                      <p className="gh-pet-dock-group-title">
                        <span className="gh-pet-dock-dot" aria-hidden />
                        照顾
                      </p>
                      <span className="gh-pet-dock-group-note">恢复状态 · {catalog.careActions.length} 个</span>
                    </div>
                    <div className="gh-pet-dock-grid">
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
                  </section>
                  <section className="gh-pet-dock-group gh-pet-dock-group--tricks">
                    <div className="gh-pet-dock-group-head">
                      <p className="gh-pet-dock-group-title">
                        <span className="gh-pet-dock-dot" aria-hidden />
                        小把戏
                      </p>
                      <span className="gh-pet-dock-group-note">
                        免费表演 · 已解锁 {unlockedTricks} / {catalog.tricks.length}
                      </span>
                    </div>
                    <div className="gh-pet-dock-grid">
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
                  </section>
                </div>
              </section>

              <aside className="gh-pet-side">
                {/* 名牌 + 等级 */}
                <div className="gh-pet-panel gh-pet-panel--profile">
                  <div className="gh-pet-profile-top">
                    <span className="gh-pet-species-chip">
                      <span aria-hidden>{speciesInfo?.emoji ?? '🐾'}</span>
                      {speciesInfo?.name ?? '宠物'}
                    </span>
                    <span className="gh-pet-level-badge">Lv.{pet.level} / {catalog.maxLevel}</span>
                  </div>
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
                    </div>
                  )}
                  <div className="gh-pet-level-track" aria-hidden>
                    <span className="gh-pet-level-fill" style={{ width: `${levelPercent}%` }} />
                  </div>
                  <span className="gh-pet-level-hint">
                    {pet.nextLevelCost == null
                      ? '已经满级，全部动作解锁'
                      : `成长进度 ${pet.level} / ${catalog.maxLevel} · 升级解锁更多动作`}
                  </span>
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm gh-pet-upgrade-btn"
                    disabled={pet.nextLevelCost == null || !!busy || points < (pet.nextLevelCost ?? 0)}
                    onClick={() => void handleUpgrade()}
                  >
                    {pet.nextLevelCost == null
                      ? '已满级'
                      : `升级到 Lv.${pet.level + 1} · 🪙 ${pet.nextLevelCost}`}
                  </button>
                  <Link
                    className="gh-btn gh-btn--secondary gh-btn--sm gh-pet-upgrade-btn"
                    to={pet.ownerId != null ? `/pets/home/${pet.ownerId}` : '/pets'}
                  >
                    去我的宠物之家 · 人气 {pet.pats ?? 0}
                  </Link>
                </div>

                {/* 状态条 */}
                <div className="gh-pet-panel gh-pet-panel--stats">
                  <div className="gh-pet-panel-head">
                    <h3 className="gh-pet-panel-title">状态</h3>
                    <span className="gh-pet-panel-hint">随时间缓慢下降</span>
                  </div>
                  {(['hunger', 'cleanliness', 'mood'] as const).map((key) => {
                    const value = pet[key]
                    return (
                      <div key={key} className="gh-pet-stat">
                        <div className="gh-pet-stat-head">
                          <span className="gh-pet-stat-label">
                            <span className="gh-pet-stat-icon" aria-hidden>{STAT_ICONS[key]}</span>
                            {STAT_LABELS[key]}
                          </span>
                          <span className="gh-pet-stat-num">
                            {value}
                            <em> / 100</em>
                          </span>
                        </div>
                        <div className="gh-pet-stat-bar">
                          <span
                            className={`gh-pet-stat-fill gh-pet-stat-fill--${key} ${value < 20 ? 'gh-pet-stat-fill--low' : ''}`}
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
                <div className="gh-pet-panel gh-pet-panel--wardrobe">
                  <div className="gh-pet-panel-head">
                    <h3 className="gh-pet-panel-title">衣柜</h3>
                    <span className="gh-pet-panel-hint">已购 {pet.ownedOutfits.length} / {catalog.outfits.length}</span>
                  </div>
                  {(['hat', 'neck', 'face'] as const).map((slot) => (
                    <div key={slot} className="gh-pet-wardrobe-slot">
                      <p className="gh-pet-wardrobe-slot-head">
                        <span aria-hidden>{SLOT_ICONS[slot]}</span>
                        {SLOT_LABELS[slot]}
                      </p>
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
                              <div className="gh-pet-outfit-top">
                                <span className="gh-pet-outfit-emoji" aria-hidden>{outfit.emoji}</span>
                                {worn && <span className="gh-pet-outfit-worn">穿着中</span>}
                              </div>
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
        </>
      )}

      {tab === 'switch' && (
        <section className="gh-pet-switch">
          <div className="gh-pet-section-head">
            <h2>换一只宠物</h2>
            <p>
              同一个伙伴换个模样：等级、饱食度、清洁、心情和已购装扮都会保留，只花 {switchCost} 积分。
            </p>
          </div>
          {petGone ? (
            <div className="gh-pet-switch-empty">
              宠物已经离家出走了，先去「我的宠物」重新召唤，才能给它换模样。
            </div>
          ) : !petAlive ? (
            <div className="gh-pet-switch-empty">
              还没有宠物可以换模样，先去「我的宠物」召唤一只吧。
            </div>
          ) : (
            <div className="gh-pet-switch-grid">
              {catalog.species.map((info) => (
                <SwitchCard
                  key={info.key}
                  info={info}
                  current={pet?.species === info.key}
                  cost={switchCost}
                  disabled={!!busy || points < switchCost}
                  onPick={() => setSwitchTarget(info.key)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'homes' && (
        <section className="gh-pet-homes">
          <div className="gh-pet-section-head">
            <h2>宠物之家</h2>
            <p>去别人家串门：撸一撸、留句话，人气最高的宠物会排在前面。</p>
          </div>
          <form
            className="gh-pet-homes-search"
            onSubmit={(e) => {
              e.preventDefault()
              void loadHomes(homesQuery)
            }}
          >
            <input
              className="gh-pet-homes-input"
              value={homesQuery}
              maxLength={30}
              placeholder="搜索用户名或宠物名"
              onChange={(e) => setHomesQuery(e.target.value)}
            />
            <button type="submit" className="gh-btn gh-btn--primary gh-btn--sm" disabled={homesLoading}>
              {homesLoading ? '搜索中…' : '搜索'}
            </button>
          </form>

          {homesLoading && !homesLoaded ? (
            <div className="gh-pet-homes-skeleton" aria-hidden>
              <span /><span /><span /><span /><span /><span />
            </div>
          ) : homesError ? (
            <div className="gh-pet-homes-empty" role="alert">
              <span className="gh-pet-homes-empty-emoji" aria-hidden>🐾</span>
              {homesError}
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--sm"
                onClick={() => void loadHomes(homesQuery)}
              >
                重试
              </button>
            </div>
          ) : homes.length === 0 ? (
            <div className="gh-pet-homes-empty">
              <span className="gh-pet-homes-empty-emoji" aria-hidden>🏠</span>
              {homesLoaded && homesQuery.trim()
                ? '没有找到匹配的宠物之家，换个关键词试试。'
                : '还没有人养宠物，快去召唤第一只吧。'}
            </div>
          ) : (
            <div className="gh-pet-homes-grid">
              {homes.map((home) => (
                <PetHomeCard key={home.userId} home={home} />
              ))}
            </div>
          )}
        </section>
      )}

      {switchTarget && switchPreview && pet && (
        <SwitchConfirm
          currentName={pet.name}
          nextInfo={switchPreview}
          cost={switchCost}
          busy={busy === 'switch'}
          onCancel={() => { if (busy !== 'switch') setSwitchTarget(null) }}
          onConfirm={() => void confirmSwitch()}
        />
      )}
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
      <div className="gh-pet-summon-head">
        <span className="gh-pet-summon-eyebrow">
          <span aria-hidden>🐾</span>
          {resummon ? 'WELCOME BACK' : 'NEW COMPANION'}
        </span>
        <h2>{resummon ? '重新召唤一位新伙伴' : '召唤一只小宠物'}</h2>
        <p className="gh-pet-summon-note">
          {resummon
            ? '已购的装扮会一直保留，重新召唤后还能穿上。'
            : '挑一只喜欢的伙伴起个名字，之后记得按时喂食、洗澡、陪它玩。'}
        </p>
      </div>
      <div className="gh-pet-summon-grid">
        {catalog.species.map((species) => {
          const active = selected === species.key
          return (
            <button
              key={species.key}
              type="button"
              className={`gh-pet-summon-card ${active ? 'gh-pet-summon-card--active' : ''}`}
              onClick={() => onSelect(species.key)}
            >
              {active && <span className="gh-pet-summon-check" aria-hidden>✓</span>}
              <PetSprite species={species.key} animation={active ? 'happy' : 'idle'} mood={85} size={110} />
              <strong>{species.emoji} {species.name}</strong>
              <span className="gh-pet-summon-card-desc">{species.description}</span>
            </button>
          )
        })}
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
        <PetSprite species={pet.species} animation="idle" equipped={pet.equipped} mood={0} size={140} />
        <span className="gh-pet-gone-wind">💨</span>
      </div>
      <div className="gh-pet-gone-trail" aria-hidden>
        <span>🐾</span>
        <span>🐾</span>
        <span>🐾</span>
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

/* ============================================================
   换宠物
   ============================================================ */

function SwitchCard({
  info,
  current,
  cost,
  disabled,
  onPick,
}: {
  info: PetSpeciesInfo
  current: boolean
  cost: number
  disabled: boolean
  onPick: () => void
}) {
  const palette = resolveSpeciesPalette(info.key, info.palette)
  const meta = resolveSpeciesMeta(info.key, info)
  return (
    <button
      type="button"
      className={`gh-pet-switch-card ${current ? 'gh-pet-switch-card--current' : ''}`}
      disabled={disabled || current}
      onClick={onPick}
    >
      <span
        className="gh-pet-switch-preview"
        style={{ background: `radial-gradient(70% 70% at 50% 20%, ${palette.primary}3d, transparent 72%)` }}
      >
        <PetSprite species={info.key} animation={current ? 'happy' : 'idle'} mood={85} size={128} />
      </span>
      <strong>{meta.emoji} {meta.name}</strong>
      <span className="gh-pet-switch-default">默认名 · {meta.defaultName}</span>
      <span className="gh-pet-switch-personality">{info.personality ?? info.description}</span>
      <span className="gh-pet-switch-meta">
        {current ? <span className="gh-pet-switch-current">当前模样</span> : <>🪙 {cost} 积分</>}
      </span>
    </button>
  )
}

function SwitchConfirm({
  currentName,
  nextInfo,
  cost,
  busy,
  onCancel,
  onConfirm,
}: {
  currentName: string
  nextInfo: PetSpeciesInfo
  cost: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const meta = resolveSpeciesMeta(nextInfo.key, nextInfo)
  return (
    <div
      className="gh-pet-modal"
      role="dialog"
      aria-modal="true"
      aria-label="确认换宠物"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="gh-pet-modal-card">
        <h3>换成{meta.name}吗？</h3>
        <p>
          {currentName} 会保留当前等级、饱食度、清洁、心情和全部已购装扮，只花 {cost} 积分换个模样。
          如果它还用着默认名，名字会一起换成「{meta.defaultName}」。
        </p>
        <div className="gh-pet-modal-actions">
          <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" disabled={busy} onClick={onCancel}>
            再想想
          </button>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" disabled={busy} onClick={onConfirm}>
            {busy ? '换装中…' : `确认替换 · 🪙 ${cost}`}
          </button>
        </div>
      </div>
    </div>
  )
}
