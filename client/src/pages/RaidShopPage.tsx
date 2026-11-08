import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { RAID_RARITY_LABELS } from '../lib/raid/raidRun'
import type {
  RaidGearSlot,
  RaidShopBuyResult,
  RaidShopGear,
  RaidShopItem,
  RaidShopView,
} from '../types/petRaid'

/* ============================================================
   常量
   ============================================================ */

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

/** 商店快捷购买数量 */
const SHOP_AMOUNTS: readonly number[] = [1, 5, 10]

const ITEM_KIND_LABELS: Record<string, string> = {
  material: '材料',
  consumable: '消耗品',
  treasure: '珍宝',
  gear_cache: '装备箱',
  skill_cache: '技能卷轴',
}

interface ToastState {
  tone: 'success' | 'danger'
  text: string
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

function shopGearStatText(gear: RaidShopGear): string {
  if (gear.slot === 'helmet' || gear.slot === 'armor') {
    return `减伤 ${gear.defense}% · 耐久上限 ${gear.maxDurability}`
  }
  if (gear.slot === 'boots') return `移动速度 +${gear.speedBonus}%`
  return `${gear.slots} 格容量`
}

/* ============================================================
   页面
   ============================================================ */

/**
 * 搜打撤官方商店（/raid/shop，2026-11-05 从仓库页「官方商店」Tab 迁出为独立页）。
 *
 * 口径（与服务端 raidShopService 对齐）：
 *   - 装备全档上架：1–3 级按目录价平价出售，4 级及以上按目录价 ×2，且需要相应仓库等级
 *     （4 级→Lv.3、5 级→Lv.4、6 级→Lv.5、t7/t8 巨型背包→Lv.6）；
 *   - 装备是「实例物品」：可重复购买，每次都是一行独立耐久的新实例，想变现去仓库页的装备区回收；
 *   - 消耗品按目录价 140% 出售，购买后直接进入仓库；
 *   - 回收价（玩家卖出的钱）见仓库页：材料 / 珍宝 100%、消耗品 60%、箱子 70%。
 */
export default function RaidShopPage() {
  const [shop, setShop] = useState<RaidShopView | null>(null)
  const [points, setPoints] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // 商店物品的快捷购买数量（按物品 key 记忆）
  const [shopAmounts, setShopAmounts] = useState<Record<string, number>>({})

  const loadShop = useCallback(async () => {
    setLoading(true)
    try {
      const view = await api.get<RaidShopView>('/pets/raid/shop')
      setShop(view)
      setPoints(view.points)
      setError(null)
    } catch (err) {
      setError(errMessage(err, '官方商店加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadShop()
  }, [loadShop])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

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
      return `已购买 ${result.emoji} ${result.name} ×${result.amount}（-${result.spent.toLocaleString('zh-CN')} 积分）`
    })
  }

  /* ---------- 渲染 ---------- */

  // 商店全档装备都上架：4 级及以上按目录价 ×2 且要相应仓库等级（locked 时置灰说明）
  const shopGearGroups = shop
    ? SLOT_ORDER
      .map((slot) => ({
        slot,
        gears: shop.gear.filter((gear) => gear.slot === slot),
      }))
      .filter((group) => group.gears.length > 0)
    : []

  if (loading && !shop) {
    return (
      <div className="gh-page-container gh-raid-storage-page">
        <div className="gh-raid-storage-loading">
          <span aria-hidden>🏪</span>
          <p>正在整理货架…</p>
        </div>
      </div>
    )
  }

  if (!shop) {
    return (
      <div className="gh-page-container gh-raid-storage-page">
        <div className="gh-raid-storage-error">
          <h1>商店暂时打不开</h1>
          <p>{error ?? '请稍后再试'}</p>
          <div className="gh-raid-storage-error-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets/raid">返回搜打撤</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void loadShop()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

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
          <p className="gh-raid-storage-eyebrow">RAID SHOP</p>
          <h1>🏪 搜打撤商店</h1>
          <p className="gh-raid-storage-sub">
            官方商店补齐装备与补给：出发前在这里采购，撤离赚了积分回来变现；
            装备与物品买后直接进仓库，再到仓库页取出或穿戴。
          </p>
        </div>
        <div className="gh-raid-storage-actions">
          <span className="gh-raid-storage-points" title="当前积分">
            🪙 {points.toLocaleString('zh-CN')}
          </span>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/raid">← 返回搜打撤</Link>
          <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/pets/raid/storage">📦 仓库 / 背包</Link>
        </div>
      </header>

      <section className="gh-raid-storage-shop-summary">
        <div>
          <strong>🏪 官方商店</strong>
          <p>
            装备全档上架：1–3 级按目录价平价出售，4 级及以上按目录价 ×2 且需要相应仓库等级
            （4 级→Lv.3、5 级→Lv.4、6 级→Lv.5、t7/t8 巨型背包→Lv.6）；
            消耗品按目录价 140% 出售。
          </p>
        </div>
        <span className="gh-raid-storage-points" title="当前积分">
          🪙 {points.toLocaleString('zh-CN')}
        </span>
      </section>

      <section className="gh-raid-storage-panel">
        <div className="gh-raid-storage-panel-head">
          <h2>装备（全档上架）</h2>
          <span>装备是实例物品，可重复购买（各自独立耐久）；买多了可在仓库页的装备区回收。</span>
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
                        {gear.ownedCount > 0 && (
                          <span className="gh-raid-storage-item-tag">已持有 {gear.ownedCount} 件</span>
                        )}
                        {gear.storageLevelRequired > 0 && (
                          <span className="gh-raid-storage-item-tag">
                            需仓库 Lv.{gear.storageLevelRequired}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary gh-btn--sm"
                        disabled={busy || gear.locked || !affordable}
                        title={
                          gear.locked
                            ? `仓库升到 Lv.${gear.storageLevelRequired} 后可购买`
                            : '重复购买就是多一件独立耐久的实例，可在仓库页的装备区回收'
                        }
                        onClick={() => void buyGear(gear)}
                      >
                        {gear.locked
                          ? `需仓库 Lv.${gear.storageLevelRequired}`
                          : affordable
                            ? `购买（${gear.price}）`
                            : '积分不足'}
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
    </div>
  )
}
