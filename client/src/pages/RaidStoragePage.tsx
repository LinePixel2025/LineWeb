import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import {
  RAID_CONTAINER_LABELS,
  RAID_ITEM_MAP,
  RAID_RARITY_LABELS,
  raidSellPrice,
} from '../lib/raid/raidRun'
import type {
  RaidBagItem,
  RaidContainerKind,
  RaidContainerView,
  RaidDepositAllResult,
  RaidGearInfo,
  RaidGearSlot,
  RaidOpenCacheResult,
  RaidRecycleAllResult,
  RaidRecycleResult,
  RaidShopBuyResult,
  RaidShopGear,
  RaidShopItem,
  RaidShopView,
  RaidStorageItem,
  RaidStorageView,
} from '../types/petRaid'

/* ============================================================
   常量
   ============================================================ */

type TabKey = 'storage' | 'bag' | 'gear' | 'shop'
type SellFrom = 'warehouse' | RaidContainerKind

const TABS: ReadonlyArray<{ key: TabKey; icon: string; label: string }> = [
  { key: 'storage', icon: '📦', label: '仓库' },
  { key: 'bag', icon: '🎒', label: '背包' },
  { key: 'gear', icon: '🪖', label: '装备' },
  { key: 'shop', icon: '🏪', label: '官方商店' },
]

const SLOT_ORDER: readonly RaidGearSlot[] = ['helmet', 'armor', 'boots', 'backpack', 'rig']

const SLOT_LABELS: Record<RaidGearSlot, string> = {
  helmet: '头盔',
  armor: '护甲',
  boots: '战靴',
  backpack: '背包',
  rig: '胸挂',
}

const SLOT_ICONS: Record<RaidGearSlot, string> = {
  helmet: '🪖',
  armor: '🦺',
  boots: '🥾',
  backpack: '🎒',
  rig: '🎽',
}

const CONTAINER_ORDER: readonly RaidContainerKind[] = ['backpack', 'rig', 'safe']

const CONTAINER_HINTS: Record<RaidContainerKind, string> = {
  backpack: '任意物品都能塞进背包，格数由已装备的背包决定。',
  rig: '快取位，任意物品都能放，格数由已装备的胸挂决定。',
  safe: '安全箱里的物品阵亡也会保留，格数随仓库等级提升。',
}

/** 仓库容量使用率超过该比例时提示清理 */
const CAPACITY_WARNING_RATIO = 0.8

/** 商店快捷购买数量 */
const SHOP_AMOUNTS: readonly number[] = [1, 5, 10]

const ITEM_KIND_LABELS: Record<string, string> = {
  material: '材料',
  consumable: '消耗品',
  treasure: '珍宝',
  gear_cache: '装备箱',
  skill_cache: '技能卷轴',
}

const REPAIR_KIT_KEYS: Partial<Record<RaidGearSlot, string>> = {
  helmet: 'helmet_repair',
  armor: 'armor_repair',
}

interface ToastState {
  tone: 'success' | 'danger'
  text: string
}

interface SellTarget {
  from: SellFrom
  slotIndex?: number
  itemKey: string
  name: string
  emoji: string
  available: number
  sellUnit: number
}

/* ============================================================
   纯函数
   ============================================================ */

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function rarityLabel(rarity: string): string {
  return RAID_RARITY_LABELS[rarity as keyof typeof RAID_RARITY_LABELS] ?? '普通'
}

function itemKindLabel(kind: string): string {
  return ITEM_KIND_LABELS[kind] ?? '物品'
}

/** 装备箱 / 技能卷轴可以在仓库里直接开启 */
function isOpenable(item: { kind: string }): boolean {
  return item.kind === 'gear_cache' || item.kind === 'skill_cache'
}

function repairKitFor(slot: RaidGearSlot): { key: string; label: string; amount: number } | null {
  const key = REPAIR_KIT_KEYS[slot]
  if (!key) return null
  const def = RAID_ITEM_MAP.get(key)
  if (!def) return null
  return { key, label: def.name, amount: def.repairAmount ?? 0 }
}

function countItem(items: readonly RaidStorageItem[], itemKey: string): number {
  return items.find((item) => item.itemKey === itemKey)?.amount ?? 0
}

function containerPct(view: RaidContainerView): number {
  if (view.capacity <= 0) return 0
  return Math.min(100, Math.round((view.usedSlots / view.capacity) * 100))
}

function durabilityPct(gear: RaidGearInfo): number {
  if (gear.maxDurability <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((gear.durability / gear.maxDurability) * 100)))
}

/** 装备属性摘要（槽位不同，展示口径不同） */
function gearStatText(gear: RaidGearInfo): string {
  if (gear.slot === 'helmet' || gear.slot === 'armor') {
    return `减伤 ${gear.defense}% · 耐久 ${gear.durability}/${gear.maxDurability}`
  }
  if (gear.slot === 'boots') return `移动速度 +${gear.speedBonus}%`
  return `${gear.slots} 格容量`
}

function shopGearStatText(gear: RaidShopGear): string {
  if (gear.slot === 'helmet' || gear.slot === 'armor') {
    return `减伤 ${gear.defense}% · 耐久上限 ${gear.maxDurability}`
  }
  if (gear.slot === 'boots') return `移动速度 +${gear.speedBonus}%`
  return `${gear.slots} 格容量`
}

function sellFromLabel(from: SellFrom): string {
  return from === 'warehouse' ? '仓库' : RAID_CONTAINER_LABELS[from]
}

/* ============================================================
   页面
   ============================================================ */

/**
 * 搜打撤仓库 / 背包 / 装备 / 官方商店（/pets/raid/storage）。
 *
 * 数据口径：
 *   - 仓库页只负责「入仓 / 回收 / 升级」，交易行已删除，回收即卖给系统；
 *   - 背包页展示撤离后留在背包 / 胸挂 / 安全箱里的物品，存入仓库或直接卖出；
 *   - 装备页负责穿戴 / 卸下 / 维修，仓库里的装备箱与技能卷轴在仓库页开启；
 *   - 商店只出售 1–3 级装备与补给，4–6 级装备只能靠搜打撤掉落。
 */
export default function RaidStoragePage() {
  const [tab, setTab] = useState<TabKey>('storage')
  const [storage, setStorage] = useState<RaidStorageView | null>(null)
  const [shop, setShop] = useState<RaidShopView | null>(null)
  const [points, setPoints] = useState(0)
  const [loading, setLoading] = useState(true)
  const [shopLoading, setShopLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shopError, setShopError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // 卖出 / 回收对话框
  const [sellTarget, setSellTarget] = useState<SellTarget | null>(null)
  const [sellAmount, setSellAmount] = useState('1')
  const [sellError, setSellError] = useState<string | null>(null)
  const [recycleAllOpen, setRecycleAllOpen] = useState(false)
  const [recycleAllKeepMaterials, setRecycleAllKeepMaterials] = useState(true)
  const [recycleAllError, setRecycleAllError] = useState<string | null>(null)

  // 商店物品的快捷购买数量（按物品 key 记忆）
  const [shopAmounts, setShopAmounts] = useState<Record<string, number>>({})

  const applyStorage = useCallback((view: RaidStorageView) => {
    setStorage(view)
    setPoints(view.points)
  }, [])

  const loadStorage = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const view = await api.get<RaidStorageView>('/pets/raid/storage')
      setStorage(view)
      setPoints(view.points)
      if (!silent) setError(null)
    } catch (err) {
      // 静默刷新失败时保留旧数据，避免把已经加载好的页面打回错误页
      if (!silent) setError(errMessage(err, '仓库加载失败'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const loadShop = useCallback(async () => {
    setShopLoading(true)
    try {
      const view = await api.get<RaidShopView>('/pets/raid/shop')
      setShop(view)
      setPoints(view.points)
      setShopError(null)
    } catch (err) {
      setShopError(errMessage(err, '官方商店加载失败'))
    } finally {
      setShopLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStorage()
    void loadShop()
  }, [loadStorage, loadShop])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  // 卖出对话框支持 Esc 关闭（请求进行中不打断）
  useEffect(() => {
    if (!sellTarget) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setSellTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sellTarget])

  /** 商店数据静默刷新：开启装备箱后可能新增装备，需要同步「已拥有」标记 */
  const refreshShop = useCallback(async () => {
    try {
      const view = await api.get<RaidShopView>('/pets/raid/shop')
      setShop(view)
      setPoints(view.points)
      setShopError(null)
    } catch {
      // 商店刷新失败不阻塞主流程；用户切到商店 Tab 时仍可手动重试
    }
  }, [])

  /** 统一动作入口：请求期间锁住所有按钮，成功 / 失败都用 toast 反馈 */
  const runAction = async (fallback: string, action: () => Promise<string | null>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const message = await action()
      if (message) setToast({ tone: 'success', text: message })
    } catch (err) {
      setToast({ tone: 'danger', text: errMessage(err, fallback) })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /* ---------- 仓库：回收 / 升级 / 开箱 ---------- */

  /** 一键回收整个仓库（可选保留升级材料，服务端按官方价逐行结算） */
  const submitRecycleAll = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await api.post<RaidRecycleAllResult>('/pets/raid/storage/recycle-all', {
        keepUpgradeItems: recycleAllKeepMaterials,
      })
      setStorage(result.view)
      setPoints(result.balance)
      setRecycleAllOpen(false)
      setRecycleAllError(null)
      setToast({
        tone: 'success',
        text: `已一键回收 ${result.count} 件物品，+${result.points.toLocaleString('zh-CN')} 积分`,
      })
    } catch (err) {
      setRecycleAllError(errMessage(err, '一键回收失败'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const openSellFromWarehouse = (item: RaidStorageItem) => {
    setSellTarget({
      from: 'warehouse',
      itemKey: item.itemKey,
      name: item.name,
      emoji: item.emoji,
      available: item.amount,
      sellUnit: item.sellUnit,
    })
    setSellAmount(String(item.amount))
    setSellError(null)
  }

  const openSellFromBag = (container: RaidContainerKind, item: RaidBagItem) => {
    setSellTarget({
      from: container,
      slotIndex: item.slotIndex,
      itemKey: item.itemKey,
      name: item.name,
      emoji: item.emoji,
      available: item.amount,
      sellUnit: item.sellUnit,
    })
    setSellAmount(String(item.amount))
    setSellError(null)
  }

  /** 从仓库取出 1 件到背包 / 胸挂（消耗品才能进胸挂） */
  const withdrawToContainer = (item: RaidStorageItem, container: RaidContainerKind): void => {
    void runAction('取出失败', async () => {
      const view = await api.post<RaidStorageView>('/pets/raid/storage/withdraw', {
        container,
        itemKey: item.itemKey,
        amount: 1,
      })
      applyStorage(view)
      return `已取出 1 件${item.name}到${RAID_CONTAINER_LABELS[container]}`
    })
  }

  const submitSell = async () => {
    const target = sellTarget
    if (!target || busyRef.current) return
    const amount = Number(sellAmount)
    if (!Number.isInteger(amount) || amount < 1) {
      setSellError('卖出数量必须是正整数')
      return
    }
    if (amount > target.available) {
      setSellError(`最多只能卖出 ${target.available} 件`)
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      const body: { from: SellFrom; itemKey: string; amount: number; slotIndex?: number } = {
        from: target.from,
        itemKey: target.itemKey,
        amount,
      }
      if (target.from !== 'warehouse' && target.slotIndex !== undefined) {
        body.slotIndex = target.slotIndex
      }
      const result = await api.post<RaidRecycleResult>('/pets/raid/storage/recycle', body)
      setStorage(result.view)
      setPoints(result.balance)
      setSellTarget(null)
      setSellError(null)
      setToast({
        tone: 'success',
        text: `已卖出 ${target.emoji} ${target.name} ×${amount}，+${result.points.toLocaleString('zh-CN')} 积分`,
      })
    } catch (err) {
      setSellError(errMessage(err, '卖出失败'))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const upgradeStorage = async () => {
    await runAction('仓库升级失败', async () => {
      const view = await api.post<RaidStorageView>('/pets/raid/storage/upgrade', {})
      applyStorage(view)
      return `仓库已升级到 Lv.${view.level}（容量 ${view.capacity} 件）`
    })
  }

  const openCache = async (item: RaidStorageItem) => {
    await runAction('开启失败', async () => {
      const result = await api.post<RaidOpenCacheResult>('/pets/raid/gear/open-cache', {
        itemKey: item.itemKey,
      })
      applyStorage(result.view)
      await refreshShop()
      const kind = result.type === 'gear' ? '装备' : '技能'
      return result.duplicatePoints > 0
        ? `开启「${item.name}」：重复获得 ${result.emoji} ${result.name}，折算 ${result.duplicatePoints.toLocaleString('zh-CN')} 积分`
        : `开启「${item.name}」：获得${kind} ${result.emoji} ${result.name}`
    })
  }

  /* ---------- 背包：存入仓库 ---------- */

  const depositSlot = async (container: RaidContainerKind, item: RaidBagItem) => {
    await runAction('存入仓库失败', async () => {
      const view = await api.post<RaidStorageView>('/pets/raid/storage/deposit', {
        container,
        slotIndex: item.slotIndex,
        amount: item.amount,
      })
      applyStorage(view)
      return `已存入 ${item.emoji} ${item.name} ×${item.amount}`
    })
  }

  const depositAll = async () => {
    await runAction('一键存入失败', async () => {
      const result = await api.post<RaidDepositAllResult>('/pets/raid/storage/deposit-all', {})
      applyStorage(result)
      if (result.remainingUnits > 0) {
        return `已存入 ${result.movedUnits} 件，还有 ${result.remainingUnits} 件没装下（仓库已满）`
      }
      return `已全部存入仓库（${result.movedUnits} 件）`
    })
  }

  /* ---------- 装备：穿戴 / 卸下 / 维修 ---------- */

  const equipGear = async (slot: RaidGearSlot, gearKey: string | null, name: string) => {
    await runAction('装备操作失败', async () => {
      const view = await api.post<RaidStorageView>('/pets/raid/gear/equip', { slot, gearKey })
      applyStorage(view)
      return gearKey ? `已穿戴 ${name}` : `已卸下 ${name}`
    })
  }

  const repairGear = async (gear: RaidGearInfo) => {
    await runAction('维修失败', async () => {
      const view = await api.post<RaidStorageView>('/pets/raid/gear/repair', {
        gearKey: gear.gearKey,
      })
      applyStorage(view)
      const next = view.gear.find((row) => row.gearKey === gear.gearKey)
      return next
        ? `维修完成：${gear.name} 耐久 ${gear.durability} → ${next.durability} / ${next.maxDurability}`
        : `维修完成：${gear.name}`
    })
  }

  /* ---------- 商店：购买 ---------- */

  const chooseShopAmount = (itemKey: string, amount: number) => {
    if (!Number.isInteger(amount) || amount < 1) return
    setShopAmounts((prev) => ({ ...prev, [itemKey]: amount }))
  }

  const buyGear = async (gear: RaidShopGear) => {
    await runAction('购买失败', async () => {
      const result = await api.post<RaidShopBuyResult>('/pets/raid/shop/buy', {
        kind: 'gear',
        key: gear.key,
      })
      setShop(result.view)
      setPoints(result.balance)
      // 新装备会出现在仓库的装备列表里，静默同步一次
      await loadStorage(true)
      return `已购买 ${result.emoji} ${result.name}（-${result.spent.toLocaleString('zh-CN')} 积分）`
    })
  }

  const buyItem = async (item: RaidShopItem, amount: number) => {
    if (busyRef.current) return
    if (!Number.isInteger(amount) || amount < 1) {
      setToast({ tone: 'danger', text: '购买数量必须是正整数' })
      return
    }
    const total = item.price * amount
    if (total > points) {
      setToast({ tone: 'danger', text: `积分不足，需要 ${total.toLocaleString('zh-CN')} 积分` })
      return
    }
    await runAction('购买失败', async () => {
      const result = await api.post<RaidShopBuyResult>('/pets/raid/shop/buy', {
        kind: 'item',
        key: item.key,
        amount,
      })
      setShop(result.view)
      setPoints(result.balance)
      await loadStorage(true)
      return `已购买 ${result.emoji} ${result.name} ×${result.amount}（-${result.spent.toLocaleString('zh-CN')} 积分）`
    })
  }

  /* ---------- 渲染 ---------- */

  if (loading && !storage) {
    return (
      <div className="gh-page-container gh-raid-storage-page">
        <div className="gh-raid-storage-loading">
          <span aria-hidden>📦</span>
          <p>正在清点仓库…</p>
        </div>
      </div>
    )
  }

  if (!storage) {
    return (
      <div className="gh-page-container gh-raid-storage-page">
        <div className="gh-raid-storage-error">
          <h1>仓库暂时打不开</h1>
          <p>{error ?? '请稍后再试'}</p>
          <div className="gh-raid-storage-error-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets/raid">返回搜打撤</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void loadStorage()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  const usedPct = Math.min(100, Math.round((storage.used / Math.max(1, storage.capacity)) * 100))
  const capacityWarning = storage.used / Math.max(1, storage.capacity) > CAPACITY_WARNING_RATIO
  const totalContainerUnits =
    storage.containers.backpack.usedUnits +
    storage.containers.rig.usedUnits +
    storage.containers.safe.usedUnits
  const upgrade = storage.upgrade

  const sellCount = Number(sellAmount)
  const sellValid = Boolean(
    sellTarget &&
      Number.isInteger(sellCount) &&
      sellCount >= 1 &&
      sellCount <= sellTarget.available,
  )
  const sellEstimate =
    sellTarget && sellValid ? raidSellPrice(sellTarget.itemKey, sellCount) : 0

  // 「我的装备」按槽位分组，只展示未穿戴的备用件
  const gearGroups = SLOT_ORDER
    .map((slot) => ({
      slot,
      gears: storage.gear.filter((gear) => gear.slot === slot && !gear.equipped),
    }))
    .filter((group) => group.gears.length > 0)

  const shopGearGroups = shop
    ? SLOT_ORDER
      .map((slot) => ({
        slot,
        gears: shop.gear.filter((gear) => gear.slot === slot && gear.tier <= 3),
      }))
      .filter((group) => group.gears.length > 0)
    : []

  return (
    <div className="gh-page-container gh-raid-storage-page">
      {toast && (
        <div
          className={`gh-raid-storage-toast gh-raid-storage-toast--${toast.tone}`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </div>
      )}

      <header className="gh-raid-storage-header">
        <div>
          <p className="gh-raid-storage-eyebrow">RAID WAREHOUSE</p>
          <h1>📦 搜打撤仓库</h1>
          <p className="gh-raid-storage-sub">
            撤离带出的物资先留在背包、胸挂与安全箱里，存入仓库后可回收折积分、升级扩容；
            官方商店补齐装备与补给，装备箱和技能卷轴直接在仓库里开启。
          </p>
        </div>
        <div className="gh-raid-storage-actions">
          <span className="gh-raid-storage-points" title="当前积分">
            🪙 {points.toLocaleString('zh-CN')}
          </span>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/raid">← 返回搜打撤</Link>
        </div>
      </header>

      <div className="gh-raid-storage-tabs" role="tablist" aria-label="仓库、背包、装备与官方商店">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={`gh-raid-storage-tab${tab === entry.key ? ' gh-raid-storage-tab--active' : ''}`}
            onClick={() => setTab(entry.key)}
          >
            <span aria-hidden>{entry.icon}</span> {entry.label}
          </button>
        ))}
      </div>

      {/* ==================== 仓库 ==================== */}
      {tab === 'storage' && (
        <div className="gh-raid-storage-body">
          <section className="gh-raid-storage-status" aria-label="仓库容量">
            <div className="gh-raid-storage-status-head">
              <span className="gh-raid-storage-level">Lv.{storage.level}</span>
              <strong>仓库容量</strong>
              <span className="gh-raid-storage-capacity-text">
                {storage.used} / {storage.capacity} 件 · 空闲 {storage.free}
              </span>
            </div>
            <div
              className="gh-raid-storage-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={storage.capacity}
              aria-valuenow={storage.used}
              aria-label="仓库容量使用率"
            >
              <span
                className={capacityWarning ? 'gh-raid-storage-bar-fill--warning' : undefined}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="gh-raid-storage-safe-note">
              🛡 安全箱 {storage.safeCapacity} 格（随仓库等级提升），阵亡也能保住里面的物品。
            </p>
            {capacityWarning && (
              <p className="gh-raid-storage-warn">
                容量已用 {usedPct}%，建议先回收低价值材料，或升级仓库扩容。
              </p>
            )}
          </section>

          {upgrade ? (
            <section className="gh-raid-storage-upgrade">
              <div className="gh-raid-storage-upgrade-head">
                <strong>升级到 Lv.{upgrade.level}</strong>
                <span>容量 {upgrade.capacity} 件 · 安全箱 {upgrade.safeCapacity} 格</span>
              </div>
              <div className="gh-raid-storage-reqs">
                <span className={upgrade.pointsOk ? 'gh-raid-storage-req--ok' : 'gh-raid-storage-req--lack'}>
                  🪙 {upgrade.upgradePoints.toLocaleString('zh-CN')} 积分
                  <small>余额 {points.toLocaleString('zh-CN')}</small>
                </span>
                {upgrade.items.map((req) => (
                  <span
                    key={req.itemKey}
                    className={req.have >= req.count ? 'gh-raid-storage-req--ok' : 'gh-raid-storage-req--lack'}
                  >
                    {req.emoji} {req.name} {req.have}/{req.count}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--sm"
                disabled={busy || !upgrade.pointsOk || !upgrade.materialsOk}
                onClick={() => void upgradeStorage()}
              >
                {busy
                  ? '升级中…'
                  : upgrade.pointsOk && upgrade.materialsOk
                    ? '升级仓库'
                    : '积分 / 材料不足'}
              </button>
            </section>
          ) : (
            <section className="gh-raid-storage-upgrade gh-raid-storage-upgrade--max">
              <strong>🏆 仓库已满级</strong>
              <span>Lv.{storage.level} · 容量 {storage.capacity} 件 · 安全箱 {storage.safeCapacity} 格</span>
            </section>
          )}

          <section className="gh-raid-storage-panel">
            <div className="gh-raid-storage-panel-head">
              <h2>仓库物品 <span>{storage.items.length} 种</span></h2>
              <div className="gh-raid-storage-panel-tools">
                <span>回收价：材料 / 珍宝 100%、消耗品 60%、装备箱 / 技能卷轴 70%</span>
                {storage.items.length > 0 && (
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setRecycleAllOpen(true)
                      setRecycleAllError(null)
                    }}
                  >
                    ♻️ 一键回收
                  </button>
                )}
              </div>
            </div>
            {storage.items.length === 0 ? (
              <div className="gh-raid-storage-empty">
                <span aria-hidden>🧰</span>
                <p>仓库还是空的。去搜打撤带点物资回来，或在官方商店买些补给。</p>
                <div className="gh-raid-storage-empty-actions">
                  <Link className="gh-btn gh-btn--primary gh-btn--sm" to="/pets/raid">🎯 去搜打撤</Link>
                  <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setTab('shop')}>
                    🏪 逛官方商店
                  </button>
                </div>
              </div>
            ) : (
              <div className="gh-raid-storage-grid">
                {storage.items.map((item) => (
                  <article
                    key={item.itemKey}
                    className={`gh-raid-storage-item gh-raid-storage-item--${item.rarity}`}
                    title={item.description}
                  >
                    <div className="gh-raid-storage-item-head">
                      <span className="gh-raid-storage-item-emoji" aria-hidden>{item.emoji}</span>
                      <div className="gh-raid-storage-item-titles">
                        <strong>{item.name}</strong>
                        <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${item.rarity}`}>
                          {rarityLabel(item.rarity)}
                        </span>
                      </div>
                      <b className="gh-raid-storage-item-value">
                        {item.sellUnit.toLocaleString('zh-CN')} 积分/件
                      </b>
                    </div>
                    <div className="gh-raid-storage-item-meta">
                      <span>持有 {item.amount}</span>
                      <span>目录价 {item.value.toLocaleString('zh-CN')}</span>
                      <span>{itemKindLabel(item.kind)}</span>
                      {isOpenable(item) && <span className="gh-raid-storage-item-tag">可开启</span>}
                    </div>
                    <div className="gh-raid-storage-item-actions">
                      <button
                        type="button"
                        className="gh-btn gh-btn--secondary gh-btn--sm"
                        disabled={busy || storage.backpackSlots <= 0}
                        title={storage.backpackSlots <= 0 ? '先装备背包' : '取出 1 件到背包'}
                        onClick={() => withdrawToContainer(item, 'backpack')}
                      >
                        🎒 取到背包
                      </button>
                      {item.kind === 'consumable' && (
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--sm"
                          disabled={busy || storage.rigSlots <= 0}
                          title={storage.rigSlots <= 0 ? '先装备胸挂' : '取出 1 件到胸挂'}
                          onClick={() => withdrawToContainer(item, 'rig')}
                        >
                          🎽 取到胸挂
                        </button>
                      )}
                      <button
                        type="button"
                        className="gh-btn gh-btn--ghost gh-btn--sm"
                        disabled={busy}
                        onClick={() => openSellFromWarehouse(item)}
                      >
                        ♻️ 回收
                      </button>
                      {isOpenable(item) && (
                        <button
                          type="button"
                          className="gh-btn gh-btn--secondary gh-btn--sm"
                          disabled={busy}
                          onClick={() => void openCache(item)}
                        >
                          🎁 开启
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================== 背包 / 胸挂 / 安全箱 ==================== */}
      {tab === 'bag' && (
        <div className="gh-raid-storage-body">
          <section className="gh-raid-storage-bag-head">
            <div>
              <h2>随身容器</h2>
              <p>撤离成功后战利品留在容器里，必须先存入仓库；阵亡只会保住安全箱。</p>
            </div>
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--sm"
              disabled={busy || totalContainerUnits === 0}
              onClick={() => void depositAll()}
            >
              {busy ? '存入中…' : `全部存入仓库（${totalContainerUnits} 件）`}
            </button>
          </section>

          {totalContainerUnits === 0 && (
            <p className="gh-raid-storage-hint">
              容器里还没有物品。撤离成功后带出的战利品会先留在这里，等你手动存入仓库。
            </p>
          )}

          <div className="gh-raid-storage-bag-grid">
            {CONTAINER_ORDER.map((kind) => {
              const container = storage.containers[kind]
              const locked = container.capacity <= 0
              return (
                <section
                  key={kind}
                  className={`gh-raid-storage-container${locked ? ' gh-raid-storage-container--locked' : ''}`}
                >
                  <div className="gh-raid-storage-container-head">
                    <strong>{container.label}</strong>
                    <span className="gh-raid-storage-capacity-text">
                      {locked
                        ? '未装备'
                        : `${container.usedSlots} / ${container.capacity} 格 · ${container.usedUnits} 件`}
                    </span>
                  </div>
                  <div className="gh-raid-storage-bar gh-raid-storage-bar--slim">
                    <span style={{ width: `${containerPct(container)}%` }} />
                  </div>
                  <p className="gh-raid-storage-container-hint">{CONTAINER_HINTS[kind]}</p>

                  {locked ? (
                    <div className="gh-raid-storage-container-empty">
                      <span aria-hidden>
                        {kind === 'backpack' ? '🎒' : kind === 'rig' ? '🎽' : '🛡️'}
                      </span>
                      {kind === 'safe' ? (
                        <p>安全箱暂不可用，请稍后再试</p>
                      ) : (
                        <>
                          <p>还没装备{container.label}，去装备页装备</p>
                          <button
                            type="button"
                            className="gh-btn gh-btn--secondary gh-btn--sm"
                            onClick={() => setTab('gear')}
                          >
                            去装备页
                          </button>
                        </>
                      )}
                    </div>
                  ) : container.items.length === 0 ? (
                    <p className="gh-raid-storage-container-empty gh-raid-storage-container-empty--plain">
                      这里是空的。
                    </p>
                  ) : (
                    <div className="gh-raid-storage-container-items">
                      {container.items.map((item) => (
                        <article
                          key={`${kind}-${item.slotIndex}`}
                          className={`gh-raid-storage-bag-item gh-raid-storage-bag-item--${item.rarity}`}
                          title={item.description}
                        >
                          <div className="gh-raid-storage-bag-item-head">
                            <span className="gh-raid-storage-bag-slot">#{item.slotIndex + 1}</span>
                            <span className="gh-raid-storage-bag-emoji" aria-hidden>{item.emoji}</span>
                            <div className="gh-raid-storage-bag-titles">
                              <strong>{item.name} ×{item.amount}</strong>
                              <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${item.rarity}`}>
                                {rarityLabel(item.rarity)}
                              </span>
                            </div>
                          </div>
                          <div className="gh-raid-storage-bag-item-actions">
                            <button
                              type="button"
                              className="gh-btn gh-btn--secondary gh-btn--sm"
                              disabled={busy}
                              onClick={() => void depositSlot(kind, item)}
                            >
                              存入仓库
                            </button>
                            <button
                              type="button"
                              className="gh-btn gh-btn--ghost gh-btn--sm"
                              disabled={busy}
                              onClick={() => openSellFromBag(kind, item)}
                            >
                              卖出
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      )}

      {/* ==================== 装备 ==================== */}
      {tab === 'gear' && (
        <div className="gh-raid-storage-body">
          <section className="gh-raid-storage-panel">
            <div className="gh-raid-storage-panel-head">
              <h2>当前装备</h2>
              <span>头盔与护甲有耐久，耐久归零后不再提供减伤；维修会永久降低耐久上限。</span>
            </div>
            <div className="gh-raid-storage-slots">
              {SLOT_ORDER.map((slot) => {
                const gear = storage.equipped[slot]
                const kit = repairKitFor(slot)
                const kitCount = kit ? countItem(storage.items, kit.key) : 0
                const pct = gear ? durabilityPct(gear) : 0
                const canRepair = Boolean(
                  gear && kit && gear.durability < gear.maxDurability && kitCount > 0,
                )
                return (
                  <article key={slot} className="gh-raid-storage-slot">
                    <div className="gh-raid-storage-slot-head">
                      <span className="gh-raid-storage-slot-icon" aria-hidden>{SLOT_ICONS[slot]}</span>
                      <strong>{SLOT_LABELS[slot]}</strong>
                      {gear && (
                        <span className="gh-raid-storage-slot-tier">
                          {rarityLabel(gear.rarity)} · {gear.tier} 级
                        </span>
                      )}
                    </div>

                    {gear ? (
                      <>
                        <div className="gh-raid-storage-slot-gear">
                          <span className="gh-raid-storage-slot-emoji" aria-hidden>{gear.emoji}</span>
                          <div className="gh-raid-storage-slot-titles">
                            <strong>{gear.name}</strong>
                            <p>
                              {slot === 'helmet' || slot === 'armor'
                                ? `减伤 ${gear.defense}%`
                                : gearStatText(gear)}
                            </p>
                          </div>
                        </div>

                        {(slot === 'helmet' || slot === 'armor') && (
                          <div className="gh-raid-storage-durability">
                            <div className="gh-raid-storage-bar gh-raid-storage-bar--slim">
                              <span
                                className={pct <= 25 ? 'gh-raid-storage-bar-fill--danger' : undefined}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span>耐久 {gear.durability} / {gear.maxDurability}</span>
                          </div>
                        )}

                        <div className="gh-raid-storage-slot-actions">
                          <button
                            type="button"
                            className="gh-btn gh-btn--secondary gh-btn--sm"
                            disabled={busy}
                            onClick={() => void equipGear(slot, null, gear.name)}
                          >
                            卸下
                          </button>
                          {kit && (
                            <button
                              type="button"
                              className="gh-btn gh-btn--ghost gh-btn--sm"
                              disabled={busy || !canRepair}
                              title={
                                kitCount < 1
                                  ? `仓库里没有${kit.label}`
                                  : gear.durability >= gear.maxDurability
                                    ? '耐久已满，不需要维修'
                                    : `消耗 1 个${kit.label}，耐久上限降低 5%`
                              }
                              onClick={() => void repairGear(gear)}
                            >
                              {gear.durability >= gear.maxDurability
                                ? '耐久已满'
                                : kitCount < 1
                                  ? `缺少${kit.label}`
                                  : `维修（1 ${kit.label}）`}
                            </button>
                          )}
                        </div>
                        {kit && gear.durability < gear.maxDurability && (
                          <p className="gh-raid-storage-slot-hint">
                            维修恢复 {kit.amount} 点耐久，耐久上限降至 95%（不低于初始 30%）。
                            仓库现有 {kitCount} 个{kit.label}。
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="gh-raid-storage-slot-empty">
                        <p>未装备</p>
                        {(slot === 'backpack' || slot === 'rig') && (
                          <span>不装备会让对应容器容量为 0。</span>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>

          <section className="gh-raid-storage-panel">
            <div className="gh-raid-storage-panel-head">
              <h2>我的装备</h2>
              <span>按槽位分组展示未穿戴的备用件，点击「穿戴」即可替换当前装备。</span>
            </div>
            {gearGroups.length === 0 ? (
              <div className="gh-raid-storage-empty">
                <span aria-hidden>🎽</span>
                <p>没有多余的装备。商店只卖 1–3 级装备，更高级的只能靠搜打撤掉落或开箱。</p>
                <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => setTab('shop')}>
                  🏪 去官方商店
                </button>
              </div>
            ) : (
              <div className="gh-raid-storage-gear-groups">
                {gearGroups.map((group) => (
                  <div key={group.slot} className="gh-raid-storage-gear-group">
                    <h3 className="gh-raid-storage-gear-group-title">
                      <span aria-hidden>{SLOT_ICONS[group.slot]}</span> {SLOT_LABELS[group.slot]}
                      <small>{group.gears.length} 件</small>
                    </h3>
                    <div className="gh-raid-storage-gear-grid">
                      {group.gears.map((gear) => (
                        <article
                          key={gear.gearKey}
                          className={`gh-raid-storage-gear-card gh-raid-storage-gear-card--${gear.rarity}`}
                          title={gear.description}
                        >
                          <div className="gh-raid-storage-gear-card-head">
                            <span className="gh-raid-storage-gear-card-emoji" aria-hidden>{gear.emoji}</span>
                            <div className="gh-raid-storage-gear-card-titles">
                              <strong>{gear.name}</strong>
                              <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${gear.rarity}`}>
                                {rarityLabel(gear.rarity)} · {gear.tier} 级
                              </span>
                            </div>
                            <b className="gh-raid-storage-gear-card-price">
                              {gear.price.toLocaleString('zh-CN')} 积分
                            </b>
                          </div>
                          <div className="gh-raid-storage-gear-card-meta">
                            <span>{gearStatText(gear)}</span>
                          </div>
                          <button
                            type="button"
                            className="gh-btn gh-btn--primary gh-btn--sm"
                            disabled={busy}
                            onClick={() => void equipGear(gear.slot, gear.gearKey, gear.name)}
                          >
                            穿戴
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ==================== 官方商店 ==================== */}
      {tab === 'shop' && (
        <div className="gh-raid-storage-body">
          {shopLoading && !shop ? (
            <div className="gh-raid-storage-inline-loading">
              <span aria-hidden>🏪</span>
              <p>正在整理货架…</p>
            </div>
          ) : !shop ? (
            <div className="gh-raid-storage-empty">
              <span aria-hidden>🏪</span>
              <p>{shopError ?? '官方商店暂时打不开'}</p>
              <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => void loadShop()}>
                再试一次
              </button>
            </div>
          ) : (
            <>
              <section className="gh-raid-storage-shop-summary">
                <div>
                  <strong>🏪 官方商店</strong>
                  <p>只出售 1–3 级装备与补给；4–6 级装备只能在搜打撤里搜到或开箱。</p>
                </div>
                <span className="gh-raid-storage-points" title="当前积分">
                  🪙 {points.toLocaleString('zh-CN')}
                </span>
              </section>

              <section className="gh-raid-storage-panel">
                <div className="gh-raid-storage-panel-head">
                  <h2>装备（1–3 级）</h2>
                  <span>同一件装备只能持有一件，购买后为满耐久。</span>
                </div>
                <div className="gh-raid-storage-shop-groups">
                  {shopGearGroups.map((group) => (
                    <div key={group.slot} className="gh-raid-storage-shop-group">
                      <h3 className="gh-raid-storage-shop-group-title">
                        <span aria-hidden>{SLOT_ICONS[group.slot]}</span> {SLOT_LABELS[group.slot]}
                      </h3>
                      <div className="gh-raid-storage-shop-grid">
                        {group.gears.map((gear) => {
                          const affordable = points >= gear.price
                          return (
                            <article
                              key={gear.key}
                              className={`gh-raid-storage-shop-card gh-raid-storage-shop-card--${gear.rarity}`}
                              title={gear.description}
                            >
                              <div className="gh-raid-storage-shop-card-head">
                                <span className="gh-raid-storage-shop-card-emoji" aria-hidden>{gear.emoji}</span>
                                <div className="gh-raid-storage-shop-card-titles">
                                  <strong>{gear.name}</strong>
                                  <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${gear.rarity}`}>
                                    {rarityLabel(gear.rarity)} · {gear.tier} 级
                                  </span>
                                </div>
                                <b className="gh-raid-storage-shop-card-price">
                                  {gear.price.toLocaleString('zh-CN')} 积分
                                </b>
                              </div>
                              <p className="gh-raid-storage-shop-card-desc">{gear.description}</p>
                              <div className="gh-raid-storage-shop-card-meta">
                                <span>{shopGearStatText(gear)}</span>
                                {gear.owned && <span className="gh-raid-storage-item-tag">已拥有</span>}
                              </div>
                              <button
                                type="button"
                                className="gh-btn gh-btn--primary gh-btn--sm"
                                disabled={busy || gear.owned || !affordable}
                                onClick={() => void buyGear(gear)}
                              >
                                {gear.owned ? '已拥有' : affordable ? `购买（${gear.price}）` : '积分不足'}
                              </button>
                            </article>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="gh-raid-storage-panel">
                <div className="gh-raid-storage-panel-head">
                  <h2>补给与箱子</h2>
                  <span>消耗品按目录价 140% 出售，购买后直接进入仓库；装备箱与技能卷轴可回仓库页开启。</span>
                </div>
                <div className="gh-raid-storage-shop-grid">
                  {shop.items.map((item) => {
                    const amount = shopAmounts[item.key] ?? 1
                    const total = item.price * amount
                    const affordable = points >= total
                    return (
                      <article
                        key={item.key}
                        className={`gh-raid-storage-shop-card gh-raid-storage-shop-card--${item.rarity}`}
                        title={item.description}
                      >
                        <div className="gh-raid-storage-shop-card-head">
                          <span className="gh-raid-storage-shop-card-emoji" aria-hidden>{item.emoji}</span>
                          <div className="gh-raid-storage-shop-card-titles">
                            <strong>{item.name}</strong>
                            <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${item.rarity}`}>
                              {rarityLabel(item.rarity)}
                            </span>
                          </div>
                          <b className="gh-raid-storage-shop-card-price">
                            {item.price.toLocaleString('zh-CN')} 积分
                          </b>
                        </div>
                        <p className="gh-raid-storage-shop-card-desc">{item.description}</p>
                        <div className="gh-raid-storage-shop-card-meta">
                          <span>{itemKindLabel(item.kind)}</span>
                          <span>单格上限 {item.stackMax}</span>
                        </div>
                        <div className="gh-raid-storage-shop-buy">
                          <div
                            className="gh-raid-storage-qty"
                            role="group"
                            aria-label={`${item.name} 购买数量`}
                          >
                            {SHOP_AMOUNTS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                className={`gh-raid-storage-qty-btn${amount === option ? ' gh-raid-storage-qty-btn--active' : ''}`}
                                aria-pressed={amount === option}
                                disabled={busy}
                                onClick={() => chooseShopAmount(item.key, option)}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="gh-btn gh-btn--primary gh-btn--sm"
                            disabled={busy || !affordable}
                            onClick={() => void buyItem(item, amount)}
                          >
                            {affordable
                              ? `购买 ×${amount}（${total.toLocaleString('zh-CN')}）`
                              : '积分不足'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* ==================== 卖出 / 回收对话框 ==================== */}
      {sellTarget && (
        <div className="gh-dialog-overlay" role="dialog" aria-modal="true" aria-label="卖出物品">
          <div className="gh-dialog">
            <h2 className="gh-dialog-title">♻️ 卖出 {sellTarget.emoji} {sellTarget.name}</h2>
            <p className="gh-raid-storage-hint">
              从{sellFromLabel(sellTarget.from)}卖出 · 可卖 {sellTarget.available} 件 · 单件回收价{' '}
              {sellTarget.sellUnit.toLocaleString('zh-CN')} 积分
            </p>
            <label className="gh-raid-storage-field">
              <span>卖出数量（1–{sellTarget.available}）</span>
              <div className="gh-raid-storage-field-row">
                <input
                  className="gh-input"
                  type="number"
                  min={1}
                  max={sellTarget.available}
                  step={1}
                  value={sellAmount}
                  onChange={(event) => {
                    setSellAmount(event.target.value)
                    setSellError(null)
                  }}
                />
                <button
                  type="button"
                  className="gh-btn gh-btn--ghost gh-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setSellAmount(String(sellTarget.available))
                    setSellError(null)
                  }}
                >
                  全部
                </button>
              </div>
            </label>
            <p className="gh-raid-storage-sell-preview">
              预计获得 <strong>{sellEstimate.toLocaleString('zh-CN')}</strong> 积分
            </p>
            {sellError && <p className="gh-raid-storage-error-text">{sellError}</p>}
            <div className="gh-dialog-actions">
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--md"
                disabled={busy}
                onClick={() => setSellTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy || !sellValid}
                onClick={() => void submitSell()}
              >
                {busy ? '处理中…' : '确认卖出'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ==================== 一键回收确认对话框 ==================== */}
      {recycleAllOpen && (
        <div className="gh-dialog-overlay" role="dialog" aria-modal="true" aria-label="一键回收仓库">
          <div className="gh-dialog">
            <h2 className="gh-dialog-title">♻️ 一键回收整个仓库</h2>
            <p className="gh-raid-storage-hint">
              按「材料 / 珍宝 100%、消耗品 60%、箱子 70%」的官方回收价一次性卖出全部仓库物品，
              交易不可撤销。
            </p>
            <label className="gh-raid-storage-field">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={recycleAllKeepMaterials}
                  onChange={(event) => setRecycleAllKeepMaterials(event.target.checked)}
                />
                保留仓库升级材料（下次升级还要用）
              </span>
            </label>
            {recycleAllError && <p className="gh-raid-storage-error-text">{recycleAllError}</p>}
            <div className="gh-dialog-actions">
              <button
                type="button"
                className="gh-btn gh-btn--secondary gh-btn--md"
                disabled={busy}
                onClick={() => setRecycleAllOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy}
                onClick={() => void submitRecycleAll()}
              >
                {busy ? '回收中…' : '确认回收'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
