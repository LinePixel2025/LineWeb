import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import UserTitleBadge from '../components/UserTitleBadge'
import { RAID_RARITY_LABELS } from '../lib/raid/raidRun'
import type {
  RaidCollectionList,
  RaidCollectionSummary,
  RaidCollectionView,
  RaidCollectResult,
  RaidCollectible,
} from '../types/petRaid'

/**
 * 搜打撤藏品室（/pets/raid/collection 与 /pets/raid/collection/:userId）。
 *
 * 自己的房间可以改名 / 写简介 / 设私密 / 布展 / 把仓库藏品收入；
 * 别人的房间只读展示，私密房间由服务端返回 404。
 */
export default function RaidCollectionPage() {
  const params = useParams<{ userId?: string }>()
  const { user } = useAuth()
  const meId = user?.id ?? 0
  const targetId = params.userId ? Number.parseInt(params.userId, 10) : meId
  const isVisit = Boolean(params.userId) && targetId !== meId
  const validTarget = Number.isFinite(targetId) && targetId > 0

  const [view, setView] = useState<RaidCollectionView | null>(null)
  const [rooms, setRooms] = useState<RaidCollectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftIntro, setDraftIntro] = useState('')
  const [draftPublic, setDraftPublic] = useState(true)
  const [slotDraft, setSlotDraft] = useState<string[]>(Array.from({ length: 12 }, () => ''))
  const [displayEditing, setDisplayEditing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!validTarget) return
    if (!silent) setLoading(true)
    try {
      const url = isVisit
        ? `/pets/raid/collections/${targetId}`
        : '/pets/raid/collection'
      const data = await api.get<RaidCollectionView>(url)
      setView(data)
      setDraftTitle(data.room.title)
      setDraftIntro(data.room.intro)
      setDraftPublic(data.room.isPublic)
      setSlotDraft(Array.from({ length: 12 }, (_, slot) => data.slots[slot]?.itemKey ?? ''))
      if (!silent) setError(null)
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : '藏品室加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [isVisit, targetId, validTarget])

  const loadRooms = useCallback(async () => {
    try {
      const data = await api.get<RaidCollectionList>('/pets/raid/collections')
      setRooms(data.rooms ?? [])
    } catch {
      // 巡礼列表失败不影响主视图
    }
  }, [])

  useEffect(() => {
    void load()
    void loadRooms()
  }, [load, loadRooms])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const ownedOptions = useMemo(
    () => (view?.items ?? []).map((item) => ({ key: item.itemKey, label: `${item.emoji} ${item.name}` })),
    [view],
  )

  const saveRoom = async () => {
    if (busy) return
    setBusy(true)
    try {
      const data = await api.put<RaidCollectionView>('/pets/raid/collection', {
        title: draftTitle.trim(),
        intro: draftIntro.trim(),
        isPublic: draftPublic,
      })
      setView(data)
      setEditing(false)
      setToast('藏品室信息已更新')
      void loadRooms()
    } catch (err) {
      setToast(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const saveDisplay = async () => {
    if (busy) return
    setBusy(true)
    try {
      const slots = slotDraft
        .map((itemKey, slot) => {
          const trimmed = itemKey.trim()
          const existing = view?.slots[slot]
          // 只改布展时保留原展位备注；移动 / 更换藏品才清空
          const note = existing?.itemKey === trimmed ? existing.note : ''
          return { slot, itemKey: trimmed, note }
        })
        .filter((entry) => entry.itemKey.length > 0)
      const data = await api.put<RaidCollectionView>('/pets/raid/collection/display', { slots })
      setView(data)
      setDisplayEditing(false)
      setToast('布展已保存')
      void loadRooms()
    } catch (err) {
      setToast(err instanceof Error ? err.message : '布展保存失败')
    } finally {
      setBusy(false)
    }
  }

  const collect = async (itemKey: string) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.post<RaidCollectResult>('/pets/raid/collection/collect', { itemKey })
      setView(result.view)
      setSlotDraft(Array.from({ length: 12 }, (_, slot) => result.view.slots[slot]?.itemKey ?? ''))
      void loadRooms()
      setToast(
        result.duplicate
          ? `重复藏品已折算 ${result.points.toLocaleString('zh-CN')} 积分`
          : `「${result.item.name}」已收入藏品室`,
      )
    } catch (err) {
      setToast(err instanceof Error ? err.message : '收入藏品室失败')
    } finally {
      setBusy(false)
    }
  }

  if (!validTarget) {
    return (
      <div className="gh-page-container gh-raid-collection-page">
        <div className="gh-alert gh-alert--danger">无效的用户 ID</div>
        <Link className="gh-btn gh-btn--secondary" to="/pets/raid">返回搜打撤</Link>
      </div>
    )
  }

  if (loading && !view) {
    return (
      <div className="gh-page-container gh-raid-collection-page">
        <div className="gh-raid-collection-loading"><span className="gh-spinner" /> 正在打开藏品室…</div>
      </div>
    )
  }

  if (error || !view) {
    return (
      <div className="gh-page-container gh-raid-collection-page">
        <div className="gh-alert gh-alert--danger" role="alert">{error ?? '藏品室加载失败'}</div>
        <div className="gh-raid-collection-error-actions">
          <button type="button" className="gh-btn gh-btn--secondary" onClick={() => void load()}>重试</button>
          <Link className="gh-btn gh-btn--ghost" to="/pets/raid">返回搜打撤</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-raid-collection-page">
      {toast && <div className="gh-raid-collection-toast" role="status">{toast}</div>}

      <header className="gh-raid-collection-head">
        <div>
          <p className="gh-raid-collection-eyebrow">RAID COLLECTION</p>
          <h1>{view.exists ? view.room.title : `${view.owner.username} 的藏品室`}</h1>
          <p className="gh-raid-collection-sub">
            {view.room.intro || '把从搜打撤里摸出来的藏品摆在这里，其他玩家可以来参观。'}
          </p>
          <div className="gh-raid-collection-owner">
            <span className="gh-raid-collection-owner-avatar" aria-hidden>🏛️</span>
            <span>{view.owner.username}</span>
            {view.owner.title && <UserTitleBadge title={view.owner.title} size="sm" />}
            {!view.room.isPublic && <span className="gh-raid-collection-private">私密</span>}
            <span className="gh-raid-collection-visits">👁 {view.room.visits.toLocaleString('zh-CN')} 次参观</span>
          </div>
        </div>
        <div className="gh-raid-collection-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/pets/raid/storage">📦 搜打撤仓库</Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/raid">← 返回搜打撤</Link>
          {!isVisit && (
            <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => setEditing((value) => !value)}>
              {editing ? '收起编辑' : '编辑藏品室'}
            </button>
          )}
        </div>
      </header>

      {!view.exists && (
        <div className="gh-box gh-raid-collection-empty">
          <p>这间藏品室还没有开张。先去搜打撤里摸一件藏品，再把它收入这里吧。</p>
          <Link className="gh-btn gh-btn--primary gh-btn--sm" to="/pets/raid/storage">去仓库看看</Link>
        </div>
      )}

      {!isVisit && editing && (
        <section className="gh-box gh-raid-collection-editor">
          <h2>藏品室设置</h2>
          <label className="gh-form-field">
            房间名
            <input className="gh-input" value={draftTitle} maxLength={20} onChange={(e) => setDraftTitle(e.target.value)} />
          </label>
          <label className="gh-form-field">
            简介
            <textarea className="gh-input" rows={2} value={draftIntro} maxLength={80} onChange={(e) => setDraftIntro(e.target.value)} />
          </label>
          <label className="gh-raid-collection-check">
            <input type="checkbox" checked={draftPublic} onChange={(e) => setDraftPublic(e.target.checked)} />
            公开（其他玩家可以参观）
          </label>
          <div className="gh-raid-collection-editor-actions">
            <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy} onClick={() => void saveRoom()}>
              保存设置
            </button>
            <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => setEditing(false)}>取消</button>
          </div>
        </section>
      )}

      <section className="gh-box gh-raid-collection-room">
        <div className="gh-raid-collection-section-head">
          <h2>展位</h2>
          <span>收集进度 {view.stats.total} / {view.stats.catalogTotal} · {view.stats.completionPct}%</span>
          {!isVisit && view.exists && (
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              onClick={() => setDisplayEditing((value) => !value)}
            >
              {displayEditing ? '取消布展' : '布展'}
            </button>
          )}
        </div>
        <div className="gh-raid-collection-grid">
          {view.slots.map((item, slot) => (
            <div key={slot} className={`gh-raid-collection-slot${item ? ` gh-raid-collection-slot--${item.rarity}` : ''}`}>
              {item ? (
                <CollectibleCard item={item} compact />
              ) : (
                <div className="gh-raid-collection-slot-empty">
                  <span aria-hidden>＋</span>
                  <small>未展出</small>
                </div>
              )}
            </div>
          ))}
        </div>
        {!isVisit && displayEditing && (
          <div className="gh-raid-collection-display-editor">
            {slotDraft.map((itemKey, slot) => (
              <label key={slot} className="gh-raid-collection-slot-pick">
                <span>展位 {slot + 1}</span>
                <select
                  className="gh-input"
                  value={itemKey}
                  onChange={(event) => {
                    const next = [...slotDraft]
                    next[slot] = event.target.value
                    setSlotDraft(next)
                  }}
                >
                  <option value="">空</option>
                  {ownedOptions.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
            ))}
            <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" disabled={busy} onClick={() => void saveDisplay()}>
              保存布展
            </button>
          </div>
        )}
      </section>

      {!isVisit && view.warehouseCandidates.length > 0 && (
        <section className="gh-box gh-raid-collection-warehouse">
          <div className="gh-raid-collection-section-head">
            <h2>仓库里待入藏的藏品</h2>
            <span>收入后不可回收 / 不可取出</span>
          </div>
          <div className="gh-raid-collection-candidates">
            {view.warehouseCandidates.map((candidate) => (
              <div key={candidate.itemKey} className={`gh-raid-collection-candidate gh-raid-collection-slot--${candidate.rarity}`}>
                <span className="gh-raid-collection-candidate-emoji" aria-hidden>{candidate.emoji}</span>
                <div>
                  <strong>{candidate.name}</strong>
                  <small>
                    持有 {candidate.amount}
                    {candidate.duplicate ? ` · 重复折算 ${candidate.duplicatePoints} 积分` : ' · 首次收录'}
                  </small>
                </div>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--sm"
                  disabled={busy}
                  onClick={() => void collect(candidate.itemKey)}
                >
                  收入藏品室
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="gh-box gh-raid-collection-catalog">
        <div className="gh-raid-collection-section-head">
          <h2>藏品图鉴</h2>
          <span>未获得的藏品显示为剪影；完成收集会点亮整间藏品室</span>
        </div>
        <div className="gh-raid-collection-catalog-grid">
          {view.catalog.map((entry) => (
            <article
              key={entry.itemKey}
              className={`gh-raid-collection-catalog-card gh-raid-collection-slot--${entry.rarity}${entry.owned ? '' : ' is-locked'}`}
            >
              <span className="gh-raid-collection-catalog-emoji" aria-hidden>{entry.owned ? entry.emoji : '❔'}</span>
              <strong>{entry.owned ? entry.name : '未收录'}</strong>
              <small>{entry.owned ? entry.description : '在搜打撤对局中低概率发现'}</small>
              <span className="gh-raid-collection-rarity">{RAID_RARITY_LABELS[entry.rarity as keyof typeof RAID_RARITY_LABELS] ?? entry.rarity}</span>
            </article>
          ))}
        </div>
      </section>

      {rooms.length > 0 && (
        <section className="gh-box gh-raid-collection-tour">
          <div className="gh-raid-collection-section-head">
            <h2>藏品室巡礼</h2>
            <span>去别人的藏品室看看</span>
          </div>
          <div className="gh-raid-collection-tour-grid">
            {rooms.map((room) => (
              <Link key={room.userId} className="gh-raid-collection-tour-card" to={`/pets/raid/collection/${room.userId}`}>
                <div className="gh-raid-collection-tour-covers">
                  {room.cover.length > 0
                    ? room.cover.map((cover) => <span key={cover.itemKey} aria-hidden>{cover.emoji}</span>)
                    : <span aria-hidden>🏛️</span>}
                </div>
                <strong>{room.title}</strong>
                <small>{room.username} · {room.total} 件藏品 · {room.visits} 次参观</small>
                {room.intro && <p>{room.intro}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function CollectibleCard({ item, compact = false }: { item: RaidCollectible; compact?: boolean }) {
  return (
    <div className={`gh-raid-collection-item${compact ? ' is-compact' : ''}`} title={item.description}>
      <span className="gh-raid-collection-item-emoji" aria-hidden>{item.emoji}</span>
      <strong>{item.name}</strong>
      {!compact && <small>{item.description}</small>}
      <span className="gh-raid-collection-rarity">
        {RAID_RARITY_LABELS[item.rarity as keyof typeof RAID_RARITY_LABELS] ?? item.rarity}
      </span>
    </div>
  )
}