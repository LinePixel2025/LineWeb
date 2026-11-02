import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePoints } from '../contexts/PointsContext'
import api from '../lib/api'
import type { PetEquipmentInfo, PetSkillInfo } from '../types/pet'
import type {
  PetGearView,
  PetMarketItem,
  PetMarketListing,
  PetMarketView,
} from '../types/petBattle'

type MarketFilter = 'all' | 'equipment' | 'skill'

const RARITY_LABELS: Record<string, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  damage: '攻击',
  heal: '治疗',
  buff: '增益',
  shield: '护盾',
  cleanse: '净化',
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function PetMarketPage() {
  const { refresh: refreshPoints } = usePoints()
  const [market, setMarket] = useState<PetMarketView | null>(null)
  const [gear, setGear] = useState<PetGearView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [filter, setFilter] = useState<MarketFilter>('all')
  const [search, setSearch] = useState('')
  const [sellOpen, setSellOpen] = useState(false)
  const [sellType, setSellType] = useState<'equipment' | 'skill'>('equipment')
  const [sellKey, setSellKey] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellError, setSellError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [marketData, gearData] = await Promise.all([
        api.get<PetMarketView>('/pets/market'),
        api.get<PetGearView>('/pets/gear'),
      ])
      setMarket(marketData)
      setGear(gearData)
      setError(null)
    } catch (err) {
      setError(errMessage(err, '交易行加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const itemMap = useMemo(() => {
    const map = new Map<string, PetMarketItem>()
    for (const item of market?.items ?? []) map.set(`${item.itemType}:${item.key}`, item)
    return map
  }, [market])

  const listings = useMemo(() => {
    const rows = market?.listings ?? []
    const keyword = search.trim()
    return rows
      .filter((row) => filter === 'all' || row.itemType === filter)
      .filter((row) => !keyword || row.name.includes(keyword) || row.sellerName.includes(keyword))
  }, [market, filter, search])

  const listedKeys = useMemo(() => {
    const set = new Set<string>()
    for (const row of market?.myListings ?? []) set.add(`${row.itemType}:${row.itemKey}`)
    return set
  }, [market])

  const tradableEquipment = useMemo(() => {
    const pet = gear?.pet
    if (!pet) return [] as PetEquipmentInfo[]
    const equipped = new Set(
      Object.values(pet.loadout ?? {}).filter((value): value is string => typeof value === 'string'),
    )
    return (gear?.catalog.equipment ?? []).filter(
      (item) =>
        pet.ownedEquipment?.includes(item.key)
        && !item.bound
        && !equipped.has(item.key)
        && !listedKeys.has(`equipment:${item.key}`),
    )
  }, [gear, listedKeys])

  const tradableSkills = useMemo(() => {
    const pet = gear?.pet
    if (!pet) return [] as PetSkillInfo[]
    const equipped = new Set(pet.loadout?.skills ?? [])
    return (gear?.catalog.skills ?? []).filter(
      (skill) =>
        pet.ownedSkills?.includes(skill.key)
        && !equipped.has(skill.key)
        && !listedKeys.has(`skill:${skill.key}`),
    )
  }, [gear, listedKeys])

  const sellRef = useMemo(() => {
    if (!sellKey) return 0
    return itemMap.get(`${sellType}:${sellKey}`)?.refPrice ?? 0
  }, [sellKey, sellType, itemMap])

  const minPrice = Math.max(1, Math.floor(sellRef * 0.5))
  const maxPrice = Math.max(minPrice, Math.ceil(sellRef * 1.5))

  const run = async (fn: () => Promise<unknown>, successText: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await load(true)
      await refreshPoints()
      setToast({ tone: 'success', text: successText })
    } catch (err) {
      setToast({ tone: 'danger', text: errMessage(err, '操作失败') })
    } finally {
      setBusy(false)
    }
  }

  const buy = (listing: PetMarketListing) => {
    void run(() => api.post(`/pets/market/${listing.id}/buy`), `买下了${listing.name}`)
  }

  const cancel = (listing: PetMarketListing) => {
    void run(() => api.delete(`/pets/market/${listing.id}`), `已下架${listing.name}`)
  }

  const openSell = () => {
    const first = tradableEquipment[0]
    setSellType('equipment')
    setSellKey(first?.key ?? '')
    setSellPrice(first ? String(itemMap.get(`equipment:${first.key}`)?.refPrice ?? first.price) : '')
    setSellError(null)
    setSellOpen(true)
  }

  const changeSellType = (type: 'equipment' | 'skill') => {
    setSellType(type)
    const first = type === 'equipment' ? tradableEquipment[0] : tradableSkills[0]
    setSellKey(first?.key ?? '')
    setSellPrice(first ? String(itemMap.get(`${type}:${first.key}`)?.refPrice ?? first.price) : '')
  }

  const changeSellKey = (key: string) => {
    setSellKey(key)
    const ref = itemMap.get(`${sellType}:${key}`)?.refPrice
    if (ref) setSellPrice(String(ref))
  }

  const submitSell = async () => {
    setSellError(null)
    const price = Number.parseInt(sellPrice, 10)
    if (!sellKey) {
      setSellError('请选择要出售的物品')
      return
    }
    if (!Number.isFinite(price) || price < minPrice || price > maxPrice) {
      setSellError(`价格需在参考价 ${minPrice}–${maxPrice} 积分之间`)
      return
    }
    if (busy) return
    setBusy(true)
    try {
      await api.post('/pets/market/list', { itemType: sellType, key: sellKey, price })
      setSellOpen(false)
      await load(true)
      setToast({ tone: 'success', text: '已挂到交易行' })
    } catch (err) {
      setSellError(errMessage(err, '挂单失败'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !market) {
    return (
      <div className="gh-page-container gh-pet-market-page">
        <div className="gh-pet-loading">
          <span className="gh-pet-loading-emoji" aria-hidden>🏪</span>
          <p>正在赶往交易行…</p>
        </div>
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="gh-page-container gh-pet-market-page">
        <div className="gh-pet-market-error">
          <h1>交易行暂时关门了</h1>
          <p>{error ?? '请稍后再试'}</p>
          <div className="gh-pet-market-error-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets">返回宠物页</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void load()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-pet-market-page">
      {toast && <div className={`gh-pet-toast gh-pet-toast--${toast.tone}`} role="status">{toast.text}</div>}

      <header className="gh-pet-gear-top">
        <Link to="/pets" className="gh-pet-home-back">
          <span aria-hidden>←</span>
          返回宠物页
        </Link>
        <div className="gh-pet-gear-links">
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/gear">🎒 装备与技能</Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/battle">⚔️ 对战</Link>
        </div>
      </header>

      <section className="gh-pet-market-hero">
        <div>
          <h1>🏪 宠物交易行</h1>
          <p>玩家之间自由挂单买卖装备与技能。成交会推动参考价，价格随市场变化。</p>
        </div>
        <div className="gh-pet-market-wallet">
          <small>积分余额</small>
          <strong>{market.balance.toLocaleString('zh-CN')}</strong>
          <span>手续费 {Math.round(market.feeRate * 100)}%（卖家承担）</span>
        </div>
        <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={openSell}>
          ＋ 出售物品
        </button>
      </section>

      <section className="gh-pet-market-toolbar">
        <div className="gh-pet-market-filters">
          {([
            ['all', '全部'],
            ['equipment', '装备'],
            ['skill', '技能'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`gh-pet-market-filter${filter === key ? ' gh-pet-market-filter--active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="gh-input"
          type="search"
          placeholder="搜索物品或卖家"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </section>

      <section className="gh-pet-market-panel">
        <h2>在售 {listings.length} 件</h2>
        {listings.length === 0 ? (
          <p className="gh-text-tertiary">暂时没有符合条件的挂单，试试自己挂一件？</p>
        ) : (
          <div className="gh-pet-market-grid">
            {listings.map((listing) => {
              const affordable = market.balance >= listing.price
              return (
                <article key={listing.id} className={`gh-pet-market-card gh-pet-market-card--${listing.rarity}`}>
                  <header>
                    <span className="gh-pet-market-emoji">{listing.emoji}</span>
                    <div>
                      <strong>{listing.name}</strong>
                      <small>{RARITY_LABELS[listing.rarity] ?? listing.rarity}{listing.slot ? ` · ${listing.slot}` : ''}</small>
                    </div>
                    <b>{listing.price.toLocaleString('zh-CN')} 分</b>
                  </header>
                  <div className="gh-pet-market-meta">
                    <span>参考价 {listing.refPrice}</span>
                    <span className={listing.changePct >= 0 ? 'gh-stock-up' : 'gh-stock-down'}>
                      挂单价 {listing.changePct >= 0 ? '+' : ''}{listing.changePct.toFixed(1)}%
                    </span>
                    <span>战力 {listing.power}</span>
                  </div>
                  <div className="gh-pet-market-seller">
                    <span>卖家 {listing.isMine ? '我' : listing.sellerName}</span>
                    <span>{formatTime(listing.createdAt)}</span>
                  </div>
                  {listing.isMine ? (
                    <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" disabled={busy} onClick={() => cancel(listing)}>
                      下架
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busy || !affordable}
                      onClick={() => buy(listing)}
                    >
                      {affordable ? '购买' : '积分不足'}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="gh-pet-market-panel">
        <h2>我的挂单 {market.myListings.length}</h2>
        {market.myListings.length === 0 ? (
          <p className="gh-text-tertiary">还没有挂单。</p>
        ) : (
          <div className="gh-pet-market-list">
            {market.myListings.map((listing) => (
              <div key={listing.id} className="gh-pet-market-row">
                <span>{listing.emoji} {listing.name}</span>
                <span>{listing.itemType === 'equipment' ? '装备' : '技能'}</span>
                <strong>{listing.price.toLocaleString('zh-CN')} 分</strong>
                <span>参考 {listing.refPrice}</span>
                <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => cancel(listing)}>
                  下架
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="gh-pet-market-panel">
        <h2>最近成交</h2>
        {market.trades.length === 0 ? (
          <p className="gh-text-tertiary">还没有成交记录。</p>
        ) : (
          <div className="gh-pet-market-list">
            {market.trades.map((trade) => (
              <div key={trade.id} className="gh-pet-market-row">
                <span>{trade.emoji} {trade.name}</span>
                <span>{trade.sellerName} → {trade.buyerName}</span>
                <strong>{trade.price.toLocaleString('zh-CN')} 分</strong>
                <span>手续费 {trade.fee}</span>
                <span>{formatTime(trade.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {sellOpen && (
        <div className="gh-pet-modal" role="dialog" aria-modal="true" aria-label="出售物品">
          <div className="gh-pet-modal-card">
            <h2>出售物品</h2>
            <div className="gh-pet-market-sell-type">
              <button
                type="button"
                className={`gh-pet-market-filter${sellType === 'equipment' ? ' gh-pet-market-filter--active' : ''}`}
                onClick={() => changeSellType('equipment')}
              >
                装备
              </button>
              <button
                type="button"
                className={`gh-pet-market-filter${sellType === 'skill' ? ' gh-pet-market-filter--active' : ''}`}
                onClick={() => changeSellType('skill')}
              >
                技能
              </button>
            </div>
            <label className="gh-pet-market-field">
              <span>选择物品</span>
              <select className="gh-input" value={sellKey} onChange={(event) => changeSellKey(event.target.value)}>
                {(sellType === 'equipment' ? tradableEquipment : tradableSkills).length === 0 && (
                  <option value="">没有可出售的物品</option>
                )}
                {(sellType === 'equipment' ? tradableEquipment : tradableSkills).map((item) => (
                  <option key={item.key} value={item.key}>{item.emoji} {item.name}</option>
                ))}
              </select>
            </label>
            <label className="gh-pet-market-field">
              <span>售价（参考价 {sellRef}，允许 {minPrice}–{maxPrice}）</span>
              <input
                className="gh-input"
                type="number"
                min={minPrice}
                max={maxPrice}
                value={sellPrice}
                onChange={(event) => setSellPrice(event.target.value)}
              />
            </label>
            {sellError && <p className="gh-pet-market-error-text">{sellError}</p>}
            <div className="gh-pet-modal-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setSellOpen(false)}>
                取消
              </button>
              <button type="button" className="gh-btn gh-btn--primary gh-btn--md" disabled={busy || !sellKey} onClick={() => void submitSell()}>
                {busy ? '挂单中…' : '确认挂单'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
