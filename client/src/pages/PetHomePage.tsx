import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PetSprite from '../components/pets/PetSprite'
import { moodLabel, resolveSpeciesMeta, resolveSpeciesPalette } from '../components/pets/petTheme'
import UserAvatar from '../components/UserAvatar'
import api from '../lib/api'
import type {
  PetGuestbookAddResult,
  PetGuestbookDeleteResult,
  PetHomeDetail,
  PetPatResult,
} from '../types/pet'

/** Asia/Shanghai 口径的短时间（留言列表只展示「月-日 时:分」） */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** 按 code point 计数，emoji 也只算 1 个字（与服务端 sanitizeGuestbookContent 口径一致） */
function charCount(text: string): number {
  return Array.from(text).length
}

const GUESTBOOK_MAX = 60

/**
 * 别人的宠物之家（/pets/home/:userId）。
 *
 * 只读展示 + 两个交互：撸一撸（每天 3 次，服务端记 PetVisit）与留言（每天 5 条）。
 * 心情 / 人气全部以服务端结算结果为准，页面不做本地估算。
 */
export default function PetHomePage() {
  const params = useParams<{ userId: string }>()
  const targetUserId = Number.parseInt(params.userId ?? '', 10)

  const [detail, setDetail] = useState<PetHomeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)
  const [patBusy, setPatBusy] = useState(false)
  const [patPulse, setPatPulse] = useState(0)
  const [spriteAnimation, setSpriteAnimation] = useState('idle')
  const [guestText, setGuestText] = useState('')
  const [guestBusy, setGuestBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const mountedRef = useRef(true)
  const toastTimerRef = useRef<number | null>(null)
  const animTimerRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
      if (animTimerRef.current !== null) window.clearTimeout(animTimerRef.current)
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

  const playAnimation = useCallback((key: string) => {
    setSpriteAnimation(key)
    if (animTimerRef.current !== null) window.clearTimeout(animTimerRef.current)
    animTimerRef.current = window.setTimeout(() => {
      animTimerRef.current = null
      setSpriteAnimation('idle')
    }, 2_200)
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      setError('这个宠物之家暂时没有小宠物')
      setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const data = await api.get<PetHomeDetail>(`/pets/homes/${targetUserId}`)
      if (!mountedRef.current) return
      setDetail(data)
    } catch (err) {
      if (!mountedRef.current) return
      // 轮询失败时不要因为一次网络抖动就把整页换成「没有宠物」；
      // 只有明确 404（宠物已经走了）才切换错误态。
      const status = (err as { status?: number }).status
      if (!silent || status === 404) setError(errMessage(err, '这个宠物之家暂时没有小宠物'))
    } finally {
      if (mountedRef.current && !silent) setLoading(false)
    }
  }, [targetUserId])

  useEffect(() => { void load() }, [load])

  // 页面可见时 30 秒刷新一次（别人可能刚摸过它）；不可见时跳过，避免无谓请求
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const palette = useMemo(
    () => (detail ? resolveSpeciesPalette(detail.publicPet.species) : null),
    [detail],
  )
  const speciesMeta = detail
    ? resolveSpeciesMeta(detail.publicPet.species, { name: detail.publicPet.speciesName })
    : null

  const handlePat = async () => {
    if (!detail || patBusy) return
    if (detail.isSelf) return
    if (detail.viewer.patsRemaining <= 0) return
    setPatBusy(true)
    playAnimation('pat')
    setPatPulse((value) => value + 1)
    try {
      const result = await api.post<PetPatResult>(`/pets/homes/${detail.owner.userId}/pat`, {})
      if (!mountedRef.current) return
      setDetail((prev) => prev && {
        ...prev,
        publicPet: { ...prev.publicPet, pats: result.popularity, mood: result.mood },
        viewer: { ...prev.viewer, patsToday: result.pats, patsRemaining: result.remaining },
      })
      showToast(result.remaining > 0
        ? `撸到了！今天还能撸 ${result.remaining} 次`
        : '今天的次数用完啦，明天再来', 'success')
    } catch (err) {
      showToast(errMessage(err, '撸宠失败，请稍后再试'), 'error')
      void load(true)
    } finally {
      if (mountedRef.current) setPatBusy(false)
    }
  }

  const handleGuestSubmit = async () => {
    if (!detail || guestBusy) return
    const text = guestText.trim()
    if (!text) {
      showToast('写点什么再提交吧', 'error')
      return
    }
    if (charCount(text) > GUESTBOOK_MAX) {
      showToast(`留言最多 ${GUESTBOOK_MAX} 个字`, 'error')
      return
    }
    setGuestBusy(true)
    try {
      const result = await api.post<PetGuestbookAddResult>(
        `/pets/homes/${detail.owner.userId}/guestbook`,
        { content: text },
      )
      if (!mountedRef.current) return
      setDetail((prev) => prev && { ...prev, guestbook: result.guestbook })
      setGuestText('')
      showToast('留言成功，它一定很开心', 'success')
      // 重新取一次详情，让「今日还能不能留言」与排名跟服务端对齐
      void load(true)
    } catch (err) {
      showToast(errMessage(err, '留言失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setGuestBusy(false)
    }
  }

  const handleDeleteGuest = async (entryId: number) => {
    if (deletingId != null) return
    setDeletingId(entryId)
    try {
      await api.delete<PetGuestbookDeleteResult>(`/pets/guestbook/${entryId}`)
      if (!mountedRef.current) return
      setDetail((prev) => prev && {
        ...prev,
        guestbook: prev.guestbook.filter((entry) => entry.id !== entryId),
      })
      showToast('留言已删除', 'success')
      void load(true)
    } catch (err) {
      showToast(errMessage(err, '删除失败，请稍后再试'), 'error')
    } finally {
      if (mountedRef.current) setDeletingId(null)
    }
  }

  /* ---------- 渲染 ---------- */

  if (loading) {
    return (
      <div className="gh-page-container gh-pet-home-page">
        <div className="gh-pet-loading">
          <span className="gh-pet-loading-emoji" aria-hidden>🏠</span>
          <p>正在前往宠物之家…</p>
        </div>
      </div>
    )
  }

  if (error || !detail || !speciesMeta || !palette) {
    return (
      <div className="gh-page-container gh-pet-home-page">
        <div className="gh-pet-home-missing">
          <span className="gh-pet-home-missing-emoji" aria-hidden>🐾</span>
          <h1>{error || '这个宠物之家暂时没有小宠物'}</h1>
          <p>也许它还没有被召唤，或者已经离家出走了。去别家逛逛吧。</p>
          <div className="gh-pet-home-missing-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets">返回宠物页</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void load()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  const { publicPet, owner, viewer, guestbook, rank, isSelf } = detail
  const remaining = Math.max(0, viewer.patsRemaining)
  const guestCount = charCount(guestText)
  const patDisabled = patBusy || isSelf || remaining <= 0

  return (
    <div className="gh-page-container gh-pet-home-page">
      {toast && <div className={`gh-pet-toast gh-pet-toast--${toast.tone}`} role="status">{toast.text}</div>}

      <header className="gh-pet-home-top">
        <Link to="/pets" className="gh-pet-home-back">
          <span aria-hidden>←</span>
          返回宠物页
        </Link>
        <span className="gh-pet-home-top-note">宠物之家 · 串门撸宠</span>
      </header>

      <section
        className="gh-pet-home-hero"
        style={{ ['--pet-home-accent' as string]: palette.primary }}
      >
        <div className="gh-pet-home-scene" aria-hidden>
          <span
            className="gh-pet-home-glow"
            style={{ background: `radial-gradient(circle, ${palette.primary}66, transparent 68%)` }}
          />
          <span className="gh-pet-home-orb gh-pet-home-orb--1" />
          <span className="gh-pet-home-orb gh-pet-home-orb--2" />
          <span className="gh-pet-home-spark gh-pet-home-spark--1">✦</span>
          <span className="gh-pet-home-spark gh-pet-home-spark--2">✧</span>
          <span className="gh-pet-home-spark gh-pet-home-spark--3">✦</span>
          {patPulse > 0 && (
            <span className="gh-pet-home-floats" key={patPulse}>
              <span className="gh-pet-home-float gh-pet-home-float--1">💗</span>
              <span className="gh-pet-home-float gh-pet-home-float--2">💗</span>
              <span className="gh-pet-home-float gh-pet-home-float--3">💛</span>
              <span className="gh-pet-home-float gh-pet-home-float--4">💗</span>
            </span>
          )}
          <div className="gh-pet-home-pet">
            <PetSprite
              species={publicPet.species}
              equipped={publicPet.equipped}
              mood={publicPet.mood}
              animation={spriteAnimation}
              size={260}
              interactive
            />
          </div>
        </div>

        <div className="gh-pet-home-info">
          <div className="gh-pet-home-owner">
            <UserAvatar userId={owner.userId} username={owner.username} size="md" />
            <div>
              <p className="gh-pet-home-owner-name">{owner.username}</p>
              <p className="gh-pet-home-owner-note">的宠物之家</p>
            </div>
            {isSelf && <span className="gh-pet-home-self-badge">这是你的宠物之家</span>}
          </div>

          <h1 className="gh-pet-home-name">{publicPet.name}</h1>
          <div className="gh-pet-home-chips">
            <span className="gh-pet-home-chip">{speciesMeta.emoji} {speciesMeta.name}</span>
            <span className="gh-pet-home-chip">Lv.{publicPet.level}</span>
            <span className="gh-pet-home-chip gh-pet-home-chip--mood">{moodLabel(publicPet.mood)}</span>
          </div>

          <div className="gh-pet-home-metrics">
            <div className="gh-pet-home-metric">
              <span className="gh-pet-home-metric-value">❤️ {publicPet.pats}</span>
              <span className="gh-pet-home-metric-label">人气值</span>
            </div>
            <div className="gh-pet-home-metric">
              <span className="gh-pet-home-metric-value">#{rank}</span>
              <span className="gh-pet-home-metric-label">人气排名</span>
            </div>
            <div className="gh-pet-home-metric">
              <span className="gh-pet-home-metric-value">{Math.round(publicPet.mood)}</span>
              <span className="gh-pet-home-metric-label">心情</span>
            </div>
          </div>

          <div className="gh-pet-home-actions">
            {isSelf ? (
              <>
                <p className="gh-pet-home-actions-note">这是你的宠物之家，撸宠请去别人家～</p>
                <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets">回到我的宠物</Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--md gh-pet-home-pat"
                  disabled={patDisabled}
                  onClick={() => void handlePat()}
                >
                  {patBusy ? '撸一撸…' : remaining > 0 ? `撸一撸（今天还剩 ${remaining} 次）` : '今天已经撸够啦'}
                </button>
                <p className="gh-pet-home-actions-note">
                  每撸一次，它的人气和心情都会 +1 · 每天最多 3 次
                </p>
              </>
            )}
          </div>

          <p className="gh-pet-home-tip">
            串门小贴士：撸宠会记在它的每日访客里，留言每天最多 5 条，只有作者本人能删除。
          </p>
        </div>
      </section>

      <section className="gh-pet-home-guestbook">
        <div className="gh-pet-home-guestbook-head">
          <h2>留言板</h2>
          <span className="gh-pet-home-guestbook-note">
            {guestbook.length > 0 ? `最近 ${guestbook.length} 条` : '还没有人留言'}
          </span>
        </div>

        {!isSelf && viewer.canGuestbook && (
          <form
            className="gh-pet-home-guest-form"
            onSubmit={(e) => {
              e.preventDefault()
              void handleGuestSubmit()
            }}
          >
            <textarea
              className="gh-pet-home-guest-input"
              value={guestText}
              rows={2}
              maxLength={GUESTBOOK_MAX}
              placeholder="和它打个招呼吧（最多 60 字）"
              onChange={(e) => setGuestText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void handleGuestSubmit()
                }
              }}
            />
            <div className="gh-pet-home-guest-bar">
              <span className={`gh-pet-home-guest-count ${guestCount > GUESTBOOK_MAX ? 'gh-pet-home-guest-count--over' : ''}`}>
                {guestCount} / {GUESTBOOK_MAX}
              </span>
              <button
                type="submit"
                className="gh-btn gh-btn--primary gh-btn--sm"
                disabled={guestBusy || !guestText.trim()}
              >
                {guestBusy ? '发送中…' : '留言'}
              </button>
            </div>
          </form>
        )}

        {isSelf && (
          <p className="gh-pet-home-guest-self-note">
            这是你自己的宠物之家，留言板留给来串门的朋友们。
          </p>
        )}

        {!isSelf && !viewer.canGuestbook && (
          <p className="gh-pet-home-guest-self-note">
            今天的留言次数用完啦（每天 5 条），明天再来和它说话吧。
          </p>
        )}

        {guestbook.length === 0 ? (
          <div className="gh-pet-home-guest-empty">
            <span aria-hidden>💬</span>
            <p>这里还很安静，来当第一个留言的人吧。</p>
          </div>
        ) : (
          <ul className="gh-pet-home-guest-list">
            {guestbook.map((entry) => (
              <li key={entry.id} className="gh-pet-home-guest-item">
                <div className="gh-pet-home-guest-head">
                  <UserAvatar userId={entry.author.userId} username={entry.author.username} size="sm" />
                  <span className="gh-pet-home-guest-author">{entry.author.username}</span>
                  <span className="gh-pet-home-guest-time">{formatTime(entry.createdAt)}</span>
                  {entry.isMine && (
                    <button
                      type="button"
                      className="gh-pet-home-guest-del"
                      title="删除我的留言"
                      disabled={deletingId === entry.id}
                      onClick={() => void handleDeleteGuest(entry.id)}
                    >
                      {deletingId === entry.id ? '删除中…' : '删除'}
                    </button>
                  )}
                </div>
                <p className="gh-pet-home-guest-content">{entry.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
