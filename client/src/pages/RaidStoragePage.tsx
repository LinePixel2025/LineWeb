import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import type {
  RaidLootRarity,
  RaidMarketListing,
  RaidMarketView,
  RaidRecycleResult,
  RaidStorageItem,
  RaidStorageView,
} from '../types/petRaid'

type Tab = 'storage' | 'market'

const RARITY_LABELS: Record<RaidLootRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  mythic: '神话',
}

/** 挂单价格区间（与服务端 RAID_MARKET_PRICE_* 常量保持一致） */
const PRICE_MIN_RATIO = 0.5
const PRICE_MAX_RATIO = 1.5
const PRICE_HARD_MAX = 1_000_000

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 挂单价区间：目录总价值（value × amount）的 50%–150%，含端点 */
function priceBounds(value: number, amount: number): { min: number; max: number } {
  const total = Math.max(0, value) * Math.max(0, amount)
  const min = Math.max(1, Math.floor(total * PRICE_MIN_RATIO))
  return { min, max: Math.max(min, Math.ceil(total * PRICE_MAX_RATIO)) }
}

/** 卖家手续费：ceil(price × 5%)，最低 1（与服务端 raidMarketFee 一致） */
function marketFee(price: number): number {
  if (price <= 0) return 0
  return Math.max(1, Math.ceil(price * 0.05))
}

interface Toast {
  tone: 'success' | 'danger'
  text: string
}

/**
 * 搜打撤仓库 + 交易行（/pets/raid/storage）。
 * 仓库：容量 / 保险箱 / 升级 / 回收材料折积分；交易行：仓库物品挂单买卖。
 */
export default function RaidStoragePage() {
  const [tab, setTab] = useState<Tab>('storage')
  const [storage, setStorage] = useState<RaidStorageView | null>(null)
  const [market, setMarket] = useState<RaidMarketView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // 回收对话框
  const [recycleItem, setRecycleItem] = useState<RaidStorageItem | null>(null)
  const [recycleAmount, setRecycleAmount] = useState('1')
  const [recycleError, setRecycleError] = useState<string | null>(null)
  // 上架对话框
  const [listItem, setListItem] = useState<RaidStorageItem | null>(null)
  const [listAmount, setListAmount] = useState('1')
  const [listPrice, setListPrice] = useState('')
  const [listError, setListError] = useState<string | null>(null)
  // 购买确认对话框
  const [buyListing, setBuyListing] = useState<RaidMarketListing | null>(null)
  const [buyError, setBuyError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [storageData, marketData] = await Promise.all([
        api.get<RaidStorageView>('/pets/raid/storage'),
        api.get<RaidMarketView>('/pets/raid/market'),
      ])
      setStorage(storageData)
      setMarket(marketData)
      setError(null)
    } catch (err) {
      setError(errMessage(err, '仓库加载失败'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const balance = storage?.balance ?? market?.balance ?? 0

  const run = async (fn: () => Promise<unknown>, successText: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await load(true)
      setToast({ tone: 'success', text: successText })
    } catch (err) {
      setToast({ tone: 'danger', text: errMessage(err, '操作失败') })
    } finally {
      setBusy(false)
    }
  }

  /* ---------- 回收 ---------- */

  const openRecycle = (item: RaidStorageItem) => {
    setRecycleItem(item)
    setRecycleAmount(String(item.freeAmount))
    setRecycleError(null)
  }

  const recycleCount = Math.max(0, Math.floor(Number(recycleAmount) || 0))
  const recyclePoints = recycleItem ? recycleItem.value * recycleCount : 0

  const submitRecycle = async () => {
    if (!recycleItem || busy) return
    const amount = Number.parseInt(recycleAmount, 10)
    if (!Number.isInteger(amount) || amount < 1) {
      setRecycleError('回收数量必须是正整数')
      return
    }
    if (amount > recycleItem.freeAmount) {
      setRecycleError(`可回收的只剩 ${recycleItem.freeAmount} 件`)
      return
    }
    setBusy(true)
    try {
      const result = await api.post<RaidRecycleResult>('/raid/storage/recycle', {
        itemKey: recycleItem.itemKey,
        amount,
      })
      setRecycleItem(null)
      await load(true)
      setToast({ tone: 'success', text: `回收成功 +${result.points} 积分` })
    } catch (err) {
      setRecycleError(errMessage(err, '回收失败'))
    } finally {
      setBusy(false)
    }
  }

  /* ---------- 上架 ---------- */

  const openList = (item: RaidStorageItem) => {
    setListItem(item)
    setListAmount('1')
    setListPrice(String(priceBounds(item.value, 1).min))
    setListError(null)
  }

  const listCount = Math.max(0, Math.floor(Number(listAmount) || 0))
  const listBounds = listItem ? priceBounds(listItem.value, listCount) : { min: 0, max: 0 }
  const listPriceNum = Number.parseInt(listPrice, 10)
  const listFee = Number.isInteger(listPriceNum) && listPriceNum > 0 ? marketFee(listPriceNum) : 0

  const changeListAmount = (raw: string) => {
    setListAmount(raw)
    if (listItem) {
      const amount = Number.parseInt(raw, 10)
      if (Number.isInteger(amount) && amount >= 1 && amount <= listItem.freeAmount) {
        setListPrice(String(priceBounds(listItem.value, amount).min))
      }
    }
  }

  const submitList = async () => {
    if (!listItem || busy) return
    const amount = Number.parseInt(listAmount, 10)
    const price = Number.parseInt(listPrice, 10)
    if (!Number.isInteger(amount) || amount < 1) {
      setListError('数量必须是正整数')
      return
    }
    if (amount > listItem.freeAmount) {
      setListError(`可上架的只剩 ${listItem.freeAmount} 件`)
      return
    }
    if (!Number.isInteger(price) || price < 1) {
      setListError('价格必须是大于 0 的整数')
      return
    }
    if (price > PRICE_HARD_MAX) {
      setListError(`价格不能超过 ${PRICE_HARD_MAX.toLocaleString('zh-CN')}`)
      return
    }
    const bounds = priceBounds(listItem.value, amount)
    if (price < bounds.min || price > bounds.max) {
      setListError(`价格需在 ${bounds.min}–${bounds.max} 积分之间（目录价值 ${listItem.value * amount} 的 50%–150%）`)
      return
    }
    setBusy(true)
    try {
      await api.post<RaidMarketListing>('/raid/market/list', {
        itemKey: listItem.itemKey,
        amount,
        price,
      })
      setListItem(null)
      await load(true)
      setToast({ tone: 'success', text: '已上架交易行' })
    } catch (err) {
      setListError(errMessage(err, '挂单失败'))
    } finally {
      setBusy(false)
    }
  }

  /* ---------- 购买 / 下架 ---------- */

  const openBuy = (listing: RaidMarketListing) => {
    setBuyListing(listing)
    setBuyError(null)
  }

  const submitBuy = async () => {
    if (!buyListing || busy) return
    setBusy(true)
    try {
      await api.post(`/raid/market/${buyListing.id}/buy`, {})
      setBuyListing(null)
      await load(true)
      setToast({ tone: 'success', text: '购买成功' })
    } catch (err) {
      setBuyError(errMessage(err, '购买失败'))
    } finally {
      setBusy(false)
    }
  }

  const delist = (listing: RaidMarketListing) => {
    if (!window.confirm(`确定下架「${listing.itemName}×${listing.amount}」？挂单会重新回到仓库。`)) return
    void run(() => api.delete(`/raid/market/${listing.id}`), '已下架')
  }

  const submitUpgrade = () => {
    void run(async () => {
      const next = await api.post<RaidStorageView>('/raid/storage/upgrade', {})
      setStorage(next)
    }, `仓库已升级到 Lv.${storage?.nextUpgrade?.level ?? '?'}`)
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

  if (error || !storage || !market) {
    return (
      <div className="gh-page-container gh-raid-storage-page">
        <div className="gh-raid-storage-error">
          <h1>仓库暂时打不开</h1>
          <p>{error ?? '请稍后再试'}</p>
          <div className="gh-raid-storage-error-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets/raid">返回搜打撤</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void load()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  const usedPct = Math.min(100, (storage.used / Math.max(1, storage.capacity)) * 100)
  const capacityTight = storage.used / Math.max(1, storage.capacity) > 0.8
  const next = storage.nextUpgrade

  return (
    <div className="gh-page-container gh-raid-storage-page">
      {toast && <div className={`gh-raid-storage-toast gh-raid-storage-toast--${toast.tone}`} role="status">{toast.text}</div>}

      <header className="gh-raid-storage-header">
        <div>
          <p className="gh-raid-storage-eyebrow">RAID WAREHOUSE</p>
          <h1>📦 搜打撤仓库</h1>
          <p className="gh-raid-storage-sub">撤离带出的材料入仓保管：回收折积分、升级扩容，或挂到交易行与其他玩家交易。</p>
        </div>
        <div className="gh-raid-storage-actions">
          <span className="gh-raid-storage-points" title="当前积分">🪙 {balance.toLocaleString('zh-CN')}</span>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/raid">← 返回搜打撤</Link>
        </div>
      </header>

      <div className="gh-raid-storage-tabs" role="tablist" aria-label="仓库与交易行">
        {([
          ['storage', '📦 仓库'],
          ['market', '🏪 交易行'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`gh-raid-storage-tab${tab === key ? ' gh-raid-storage-tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'storage' && (
        <div className="gh-raid-storage-body">
          <section className="gh-raid-storage-status">
            <div className="gh-raid-storage-status-head">
              <span className="gh-raid-storage-level">Lv.{storage.level}</span>
              <strong>仓库容量</strong>
              <span className="gh-raid-storage-capacity-text">
                {storage.used} / {storage.capacity} 格 · 空闲 {storage.free}
              </span>
            </div>
            <div className="gh-raid-storage-bar">
              <span
                className={capacityTight ? 'gh-raid-storage-bar-fill--warning' : undefined}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="gh-raid-storage-safe-note">
              🛡 对局中可存放 {storage.safeCapacity} 件保险箱物品，阵亡也保留
            </p>
          </section>

          {next ? (
            <section className="gh-raid-storage-upgrade">
              <div className="gh-raid-storage-upgrade-head">
                <strong>升级到 Lv.{next.level}</strong>
                <span>容量 {next.capacity} 格 · 保险箱 {next.safeCapacity} 件</span>
              </div>
              <div className="gh-raid-storage-reqs">
                <span className={next.pointsOk ? 'gh-raid-storage-req--ok' : 'gh-raid-storage-req--lack'}>
                  🪙 积分 {next.upgradePoints.toLocaleString('zh-CN')}
                  <small>余额 {balance.toLocaleString('zh-CN')}</small>
                </span>
                {next.items.map((req) => (
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
                disabled={busy || !next.pointsOk || !next.materialsOk}
                onClick={submitUpgrade}
              >
                {busy ? '升级中…' : next.pointsOk && next.materialsOk ? `升级（${next.upgradePoints} 积分 + 材料）` : '条件不足'}
              </button>
            </section>
          ) : (
            <section className="gh-raid-storage-upgrade gh-raid-storage-upgrade--max">
              <strong>🏆 仓库已满级</strong>
              <span>Lv.{storage.level} · 容量 {storage.capacity} 格 · 保险箱 {storage.safeCapacity} 件</span>
            </section>
          )}

          <section className="gh-raid-storage-panel">
            <h2>仓库物品 {storage.items.length} 种</h2>
            {storage.items.length === 0 ? (
              <div className="gh-raid-storage-empty">
                <span aria-hidden>🧰</span>
                <p>仓库还是空的。去搜打撤带回一些材料，或从交易行买点别人的存货吧。</p>
                <Link className="gh-btn gh-btn--primary gh-btn--sm" to="/pets/raid">🎯 去搜打撤</Link>
              </div>
            ) : (
              <div className="gh-raid-storage-grid">
                {storage.items.map((item) => (
                  <article key={item.itemKey} className={`gh-raid-storage-item gh-raid-storage-item--${item.rarity}`}>
                    <div className="gh-raid-storage-item-head">
                      <span className="gh-raid-storage-item-emoji" aria-hidden>{item.emoji}</span>
                      <div className="gh-raid-storage-item-titles">
                        <strong>{item.name}</strong>
                        <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${item.rarity}`}>
                          {RARITY_LABELS[item.rarity]}
                        </span>
                      </div>
                      <b className="gh-raid-storage-item-value">{item.value} 积分/件</b>
                    </div>
                    <div className="gh-raid-storage-item-meta">
                      <span>持有 {item.amount}</span>
                      {item.listedAmount > 0 && <span className="gh-raid-storage-item-listed">出售中 {item.listedAmount}</span>}
                      <span>可用 {item.freeAmount}</span>
                    </div>
                    <div className="gh-raid-storage-item-actions">
                      <button
                        type="button"
                        className="gh-btn gh-btn--ghost gh-btn--sm"
                        disabled={busy || item.freeAmount < 1}
                        onClick={() => openRecycle(item)}
                      >
                        ♻️ 回收
                      </button>
                      <button
                        type="button"
                        className="gh-btn gh-btn--secondary gh-btn--sm"
                        disabled={busy || item.freeAmount < 1}
                        onClick={() => openList(item)}
                      >
                        🏪 上架
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'market' && (
        <div className="gh-raid-storage-body">
          <section className="gh-raid-storage-panel">
            <h2>在售 {market.listings.length} 单</h2>
            {market.listings.length === 0 ? (
              <div className="gh-raid-storage-empty">
                <span aria-hidden>🏪</span>
                <p>交易行暂时没有挂单。把仓库里的材料上架，做个第一位卖家？</p>
              </div>
            ) : (
              <div className="gh-raid-market-grid">
                {market.listings.map((listing) => {
                  const affordable = balance >= listing.price
                  return (
                    <article key={listing.id} className={`gh-raid-market-card gh-raid-market-card--${listing.rarity}`}>
                      <div className="gh-raid-market-card-head">
                        <span className="gh-raid-market-card-emoji" aria-hidden>{listing.emoji}</span>
                        <div className="gh-raid-market-card-titles">
                          <strong>{listing.itemName}{listing.amount > 1 ? ` ×${listing.amount}` : ''}</strong>
                          <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${listing.rarity}`}>
                            {RARITY_LABELS[listing.rarity]}
                          </span>
                        </div>
                        <b className="gh-raid-market-card-price">{listing.price.toLocaleString('zh-CN')} 积分</b>
                      </div>
                      <div className="gh-raid-market-card-meta">
                        <span>单价 {listing.unitPrice} · 目录价 {listing.value}/件</span>
                        <span>{formatTime(listing.createdAt)}</span>
                      </div>
                      <div className="gh-raid-market-card-foot">
                        <span>卖家 {listing.isMine ? '我' : listing.sellerName}</span>
                        {listing.isMine ? (
                          <button
                            type="button"
                            className="gh-btn gh-btn--secondary gh-btn--sm"
                            disabled={busy}
                            onClick={() => delist(listing)}
                          >
                            下架
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="gh-btn gh-btn--primary gh-btn--sm"
                            disabled={busy || !affordable}
                            onClick={() => openBuy(listing)}
                          >
                            {affordable ? '购买' : '积分不足'}
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="gh-raid-storage-panel">
            <h2>我的挂单 {market.myListings.length}</h2>
            {market.myListings.length === 0 ? (
              <p className="gh-raid-storage-hint">还没有挂单。在仓库 Tab 对材料点「上架」即可寄售。</p>
            ) : (
              <div className="gh-raid-market-list">
                {market.myListings.map((listing) => (
                  <div key={listing.id} className="gh-raid-market-row">
                    <span className="gh-raid-market-row-name">
                      {listing.emoji} {listing.itemName}{listing.amount > 1 ? ` ×${listing.amount}` : ''}
                    </span>
                    <span className={`gh-raid-storage-rarity gh-raid-storage-rarity--${listing.rarity}`}>
                      {RARITY_LABELS[listing.rarity]}
                    </span>
                    <strong>{listing.price.toLocaleString('zh-CN')} 积分</strong>
                    <span>单价 {listing.unitPrice}</span>
                    <span>{formatTime(listing.createdAt)}</span>
                    <button
                      type="button"
                      className="gh-btn gh-btn--ghost gh-btn--sm"
                      disabled={busy}
                      onClick={() => delist(listing)}
                    >
                      下架
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="gh-raid-storage-panel">
            <h2>最近成交</h2>
            {market.trades.length === 0 ? (
              <p className="gh-raid-storage-hint">还没有成交记录。</p>
            ) : (
              <div className="gh-raid-market-list">
                {market.trades.map((trade) => (
                  <div key={trade.id} className="gh-raid-market-row">
                    <span className="gh-raid-market-row-name">
                      {trade.emoji} {trade.itemName}{trade.amount > 1 ? ` ×${trade.amount}` : ''}
                    </span>
                    <strong>{trade.price.toLocaleString('zh-CN')} 积分</strong>
                    <span>手续费 {trade.fee}</span>
                    <span>{trade.sellerName} → {trade.buyerName}</span>
                    <span>{formatTime(trade.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="gh-raid-storage-hint">成交收取 {Math.round(market.feeRate * 100)}% 手续费（卖家承担，最低 1 积分）。</p>
          </section>
        </div>
      )}

      {/* 回收确认 */}
      {recycleItem && (
        <div className="gh-raid-storage-modal" role="dialog" aria-modal="true" aria-label="回收物品">
          <div className="gh-raid-storage-modal-card">
            <h2>♻️ 回收 {recycleItem.emoji} {recycleItem.name}</h2>
            <p className="gh-raid-storage-modal-note">
              可回收 {recycleItem.freeAmount} 件（{recycleItem.listedAmount} 件正在出售中）· 单件回收价 {recycleItem.value} 积分
            </p>
            <label className="gh-raid-storage-field">
              <span>回收数量（1–{recycleItem.freeAmount}）</span>
              <div className="gh-raid-storage-field-row">
                <input
                  className="gh-input"
                  type="number"
                  min={1}
                  max={recycleItem.freeAmount}
                  value={recycleAmount}
                  onChange={(event) => setRecycleAmount(event.target.value)}
                />
                <button
                  type="button"
                  className="gh-btn gh-btn--ghost gh-btn--sm"
                  onClick={() => setRecycleAmount(String(recycleItem.freeAmount))}
                >
                  全部
                </button>
              </div>
            </label>
            <p className="gh-raid-storage-modal-preview">
              预计可得 <strong>{recyclePoints.toLocaleString('zh-CN')}</strong> 积分
            </p>
            {recycleError && <p className="gh-raid-storage-error-text">{recycleError}</p>}
            <div className="gh-raid-storage-modal-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setRecycleItem(null)}>
                取消
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy || recycleCount < 1 || recycleCount > recycleItem.freeAmount}
                onClick={() => void submitRecycle()}
              >
                {busy ? '回收中…' : '确认回收'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 上架 */}
      {listItem && (
        <div className="gh-raid-storage-modal" role="dialog" aria-modal="true" aria-label="上架交易行">
          <div className="gh-raid-storage-modal-card">
            <h2>🏪 上架 {listItem.emoji} {listItem.name}</h2>
            <p className="gh-raid-storage-modal-note">可上架 {listItem.freeAmount} 件（{listItem.listedAmount} 件已在售）</p>
            <label className="gh-raid-storage-field">
              <span>数量（1–{listItem.freeAmount}）</span>
              <input
                className="gh-input"
                type="number"
                min={1}
                max={listItem.freeAmount}
                value={listAmount}
                onChange={(event) => changeListAmount(event.target.value)}
              />
            </label>
            <label className="gh-raid-storage-field">
              <span>
                整单价格（{listItem.value}×{listCount}={listItem.value * listCount} 的 50%–150%：
                {listBounds.min}–{listBounds.max}）
              </span>
              <input
                className="gh-input"
                type="number"
                min={listBounds.min}
                max={listBounds.max}
                value={listPrice}
                onChange={(event) => setListPrice(event.target.value)}
              />
            </label>
            <p className="gh-raid-storage-modal-preview">
              手续费 5%（{listFee} 积分）· 成交到账{' '}
              <strong>{(Math.max(0, (Number.isInteger(listPriceNum) ? listPriceNum : 0)) - listFee).toLocaleString('zh-CN')}</strong> 积分
            </p>
            {listError && <p className="gh-raid-storage-error-text">{listError}</p>}
            <div className="gh-raid-storage-modal-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setListItem(null)}>
                取消
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy || listCount < 1 || listCount > listItem.freeAmount}
                onClick={() => void submitList()}
              >
                {busy ? '挂单中…' : '确认挂单'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 购买确认 */}
      {buyListing && (
        <div className="gh-raid-storage-modal" role="dialog" aria-modal="true" aria-label="购买确认">
          <div className="gh-raid-storage-modal-card">
            <h2>🛒 确认购买</h2>
            <p className="gh-raid-storage-modal-note">
              {buyListing.emoji} {buyListing.itemName}{buyListing.amount > 1 ? ` ×${buyListing.amount}` : ''}
            </p>
            <div className="gh-raid-storage-buy-summary">
              <div><span>卖家</span><strong>{buyListing.sellerName}</strong></div>
              <div><span>整单价格</span><strong>{buyListing.price.toLocaleString('zh-CN')} 积分</strong></div>
              <div><span>当前余额</span><strong>{balance.toLocaleString('zh-CN')} 积分</strong></div>
            </div>
            {balance < buyListing.price && <p className="gh-raid-storage-error-text">积分余额不足，无法购买。</p>}
            {buyError && <p className="gh-raid-storage-error-text">{buyError}</p>}
            <div className="gh-raid-storage-modal-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setBuyListing(null)}>
                取消
              </button>
              <button
                type="button"
                className="gh-btn gh-btn--primary gh-btn--md"
                disabled={busy || balance < buyListing.price}
                onClick={() => void submitBuy()}
              >
                {busy ? '购买中…' : '确认购买'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
