import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import UserTitleBadge from '../components/UserTitleBadge'
import UserAvatar from '../components/UserAvatar'
import { usePoints } from '../contexts/PointsContext'
import { useFeature } from '../contexts/FeatureContext'
import api from '../lib/api'
import { PREMIUM_AVATAR_FRAMES } from '../types/points'
import type {
  CheckinResult,
  LeaderTitleDto,
  PointsLeaderboardEntry,
  PointsLeaderboardMetric,
  PointsLeaderboardResponse,
  PointsLedgerResponse,
  ShopItem,
  ShopItemType,
  ShopResponse,
} from '../types/points'

type Tab = 'shop' | 'leaderboard' | 'ledger'

const SHOP_TYPES: ReadonlyArray<readonly [ShopItemType, string]> = [
  ['title', '称号'],
  ['avatar_frame', '头像框'],
  ['emoji', '表情包'],
]

const SHOP_TYPE_LABELS: Record<ShopItemType, string> = {
  title: '称号',
  avatar_frame: '头像框',
  emoji: '表情包',
}

const RARITY_LABELS: Record<string, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

const REASON_LABELS: Record<string, string> = {
  game_result: '游戏结算',
  farm_harvest: '农场收获',
  farm_steal: '偷菜所得',
  farm_welcome: '开荒礼包',
  farm_shop: '购买种子 / 肥料',
  farm_merchant: '商人特价',
  farm_expand: '农田扩建',
  shop_purchase: '积分商店',
  checkin: '每日签到',
  leader_bonus: '榜首奖励',
  stock_buy: '股市买入',
  stock_sell: '股市卖出',
  stock_dividend: '股市分红（旧）',
  pet_summon: '召唤宠物',
  pet_feed: '宠物喂食',
  pet_bathe: '宠物洗澡',
  pet_play: '宠物玩耍',
  pet_upgrade: '宠物升级',
  pet_outfit: '购买装扮',
  pet_switch: '更换宠物',
  pet_equipment_buy: '购买装备',
  pet_skill_buy: '学习技能',
  pet_battle_win: '宠物对战胜利',
  pet_battle_lose: '宠物对战失败',
  pet_market_buy: '交易行买入',
  pet_market_sell: '交易行卖出',
  lottery_draw: '抽奖消耗',
  lottery_prize: '抽奖奖励',
  theme_purchase: '购买主题',
  redpacket_send: '发出红包',
  redpacket_receive: '领取红包',
  redpacket_refund: '红包退回',
  admin_adjust: '管理员调整',
}

const GAME_LABELS: Record<string, string> = {
  '2048': '2048',
  doudizhu: '斗地主',
  snake: '贪吃蛇',
  minesweeper: '扫雷',
  jump: '跳一跳',
  gomoku: '五子棋',
  liar: '骗子酒馆',
  uno: 'UNO',
  xiangqi: '中国象棋',
  parkour: '霓虹跑酷',
  farm: '开心农场',
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 商店 / 已购列表里的头像框预览。
 * 炸裂系列需要额外渲染 .gh-avatar-frame-fx（余烬 / 闪弧 / 星芒），
 * 否则预览只剩外圈，和真正佩戴后的效果对不上。
 */
function FramePreview({ frame, size }: { frame: string; size: string }) {
  const premium = (PREMIUM_AVATAR_FRAMES as readonly string[]).includes(frame)
  return (
    <span
      className={`gh-avatar-frame gh-avatar-frame--${frame}`}
      style={{ '--avatar-size': size } as CSSProperties}
    >
      <span className="gh-points-frame-preview">🧑</span>
      {premium && (
        <span className="gh-avatar-frame-fx" aria-hidden>
          <i /><i /><i /><i />
        </span>
      )}
    </span>
  )
}

/**
 * 积分中心：余额 / 排行榜 / 商店（称号 + 表情包） / 流水。
 * 所有游戏的胜负与农场收益都会写进同一份台账，因此这里只有一个余额。
 */
export default function PointsPage() {
  const { profile, refresh } = usePoints()
  const { isEnabled } = useFeature()
  const [tab, setTab] = useState<Tab>('shop')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  return (
    <div className="gh-page-container gh-points-page">
      <header className="gh-points-hero">
        <div className="gh-points-hero-main">
          <p className="gh-points-hero-eyebrow">POINTS</p>
          <h1 className="gh-points-hero-title">积分中心</h1>
          <p className="gh-points-hero-sub">
            所有游戏共用一套积分：赢一局加分、输一局扣分，种菜与偷菜同样计入。积攒积分可兑换站内称号与聊天表情包。
          </p>
          <div className="gh-points-hero-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/games">
              去赚积分
            </Link>
            {isEnabled('farm') && (
              <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games/farm">
                🌱 去农场
              </Link>
            )}
          </div>
        </div>
        <div className="gh-points-hero-card">
          <span className="gh-points-hero-label">我的积分</span>
          <strong className="gh-points-hero-value">{profile?.balance ?? 0}</strong>
          <div className="gh-points-hero-meta">
            <span>累计获得 {profile?.earned ?? 0}</span>
            <span>全站第 {profile?.rank ?? '—'} 名</span>
          </div>
          {(profile?.title || profile?.equippedLeaderTitle) && (
            <div className="gh-points-hero-title-badge">
              <span className="gh-text-tertiary">当前称号</span>
              <UserTitleBadge title={profile.title ?? profile.equippedLeaderTitle} size="md" />
            </div>
          )}
          {profile?.avatarFrame && (
            <div className="gh-points-hero-title-badge">
              <span className="gh-text-tertiary">当前头像框</span>
              <FramePreview frame={profile.avatarFrame.frame} size="24px" />
              <span>{profile.avatarFrame.name}</span>
            </div>
          )}
        </div>
      </header>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
      {notice && <div className="gh-alert gh-alert--success" role="status">{notice}</div>}

      <CheckinCard
        onNotice={(message) => { setNotice(message); setError('') }}
        onError={(message) => { setError(message); setNotice('') }}
      />

      <div className="gh-tabnav">
        {([
          ['shop', '积分商店'],
          ['leaderboard', '积分排行榜'],
          ['ledger', '积分流水'],
        ] as Array<[Tab, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`gh-tabnav-item ${tab === value ? 'gh-tabnav-item--active' : ''}`}
            onClick={() => { setTab(value); setError(''); setNotice('') }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'shop' && (
        <ShopTab
          profileTitleId={profile?.title?.id ?? null}
          leaderTitles={profile?.leaderTitles ?? []}
          equippedLeaderTitleId={profile?.equippedLeaderTitle?.id ?? null}
          onNotice={(message) => { setNotice(message); setError(''); void refresh() }}
          onError={(message) => { setError(message); setNotice('') }}
        />
      )}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'ledger' && <LedgerTab />}
    </div>
  )
}

/* ============================================================
   每日签到
   ============================================================ */

/**
 * 签到卡：显示连签天数与今日 / 明日奖励，点击签到后刷新全站积分。
 * 已签到时按钮置灰，连签进度不受影响。
 */
function CheckinCard({
  onNotice,
  onError,
}: {
  onNotice: (message: string) => void
  onError: (message: string) => void
}) {
  const { profile, refresh } = usePoints()
  const [busy, setBusy] = useState(false)
  const status = profile?.checkin

  if (!status) return null

  const claim = async () => {
    if (busy || status.checkedInToday) return
    setBusy(true)
    try {
      const result = await api.post<CheckinResult>('/points/checkin')
      onNotice(`签到成功：${result.note}，获得 ${result.awarded} 积分`)
      await refresh()
    } catch (err) {
      onError(err instanceof Error ? err.message : '签到失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`gh-points-checkin ${status.checkedInToday ? 'gh-points-checkin--done' : ''}`}>
      <div className="gh-points-checkin-main">
        <span className="gh-points-checkin-icon" aria-hidden>📅</span>
        <div className="gh-points-checkin-text">
          <h2>每日签到</h2>
          <p>
            {status.checkedInToday
              ? `今天已签到，连续签到 ${status.streak} 天`
              : status.streak > 0
                ? `已连续签到 ${status.streak} 天，今天签到可继续累积`
                : '连续签到越久，每天拿到的积分越多'}
          </p>
        </div>
      </div>
      <div className="gh-points-checkin-stats">
        <div className="gh-points-checkin-stat">
          <span>连签</span>
          <strong>{status.streak} 天</strong>
        </div>
        <div className="gh-points-checkin-stat">
          <span>{status.checkedInToday ? '今日已得' : '今日可得'}</span>
          <strong>{status.checkedInToday ? status.todayPoints : status.nextPoints}</strong>
        </div>
        <div className="gh-points-checkin-stat">
          <span>明天可得</span>
          <strong>{status.nextPoints}</strong>
        </div>
      </div>
      <button
        type="button"
        className={`gh-btn gh-btn--md ${status.checkedInToday ? 'gh-btn--secondary' : 'gh-btn--primary'}`}
        disabled={busy || status.checkedInToday}
        onClick={() => void claim()}
      >
        {status.checkedInToday ? '今日已签到' : busy ? '签到中…' : `签到 +${status.nextPoints}`}
      </button>
    </section>
  )
}

/* ============================================================
   商店
   ============================================================ */

function ShopTab({
  profileTitleId,
  leaderTitles,
  equippedLeaderTitleId,
  onNotice,
  onError,
}: {
  profileTitleId: number | null
  leaderTitles: LeaderTitleDto[]
  equippedLeaderTitleId: number | null
  onNotice: (message: string) => void
  onError: (message: string) => void
}) {
  const [data, setData] = useState<ShopResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<ShopItemType>('title')
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.get<ShopResponse>('/points/shop'))
    } catch (err) {
      onError(err instanceof Error ? err.message : '加载积分商店失败')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => { void load() }, [load])

  const items = useMemo(() => (data?.items ?? []).filter((item) => item.type === type), [data, type])
  const ownedTitles = useMemo(
    () => (data?.items ?? []).filter((item) => item.type === 'title' && item.owned),
    [data],
  )
  const ownedFrames = useMemo(
    () => (data?.items ?? []).filter((item) => item.type === 'avatar_frame' && item.owned),
    [data],
  )

  const buy = async (item: ShopItem) => {
    if (busyId !== null) return
    if (!window.confirm(`花 ${item.cost} 积分购买「${item.name}」？`)) return
    setBusyId(item.id)
    try {
      await api.post(`/points/shop/${item.id}/buy`)
      const hint = item.type === 'title'
        ? '，可在下方佩戴'
        : item.type === 'avatar_frame'
          ? '，已自动佩戴到你的头像上'
          : '，聊天表情商店已解锁'
      onNotice(`已购买「${item.name}」${hint}`)
      await load()
    } catch (err) {
      onError(err instanceof Error ? err.message : '购买失败')
    } finally {
      setBusyId(null)
    }
  }

  const equip = async (item: ShopItem) => {
    if (busyId !== null) return
    setBusyId(item.id)
    try {
      await api.post(item.type === 'avatar_frame'
        ? `/points/shop/${item.id}/equip-frame`
        : `/points/shop/${item.id}/equip`)
      onNotice(`已佩戴「${item.name}」`)
      await load()
    } catch (err) {
      onError(err instanceof Error ? err.message : '佩戴失败')
    } finally {
      setBusyId(null)
    }
  }

  const unequipTitle = async () => {
    if (busyId !== null) return
    setBusyId(-1)
    try {
      await api.delete('/points/equipped-title')
      onNotice('已取消佩戴称号')
      await load()
    } catch (err) {
      onError(err instanceof Error ? err.message : '取消佩戴失败')
    } finally {
      setBusyId(null)
    }
  }

  const equipLeader = async (item: LeaderTitleDto) => {
    if (busyId !== null) return
    setBusyId(item.id)
    try {
      await api.post(`/points/leader-titles/${item.id}/equip`)
      onNotice(`已佩戴传说称号「${item.name}」`)
      await load()
    } catch (err) {
      onError(err instanceof Error ? err.message : '佩戴失败')
    } finally {
      setBusyId(null)
    }
  }

  const unequipFrame = async () => {
    if (busyId !== null) return
    setBusyId(-1)
    try {
      await api.delete('/points/equipped-frame')
      onNotice('已卸下头像框')
      await load()
    } catch (err) {
      onError(err instanceof Error ? err.message : '取消佩戴失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="gh-points-shop">
      <div className="gh-points-shop-head">
        <div className="gh-points-shop-balance">
          <span className="gh-text-tertiary">可用积分</span>
          <strong>{data?.balance ?? 0}</strong>
        </div>
        <div className="gh-points-shop-type">
          {SHOP_TYPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`gh-points-shop-type-btn ${type === value ? 'gh-points-shop-type-btn--active' : ''}`}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="gh-points-loading"><div className="gh-spinner" /></div>
      ) : items.length === 0 ? (
        <div className="gh-box gh-points-empty">商店暂时没有上架的{SHOP_TYPE_LABELS[type]}。</div>
      ) : (
        <div className="gh-points-shop-grid">
          {items.map((item) => {
            const affordable = (data?.balance ?? 0) >= item.cost
            const icon = typeof item.payload.icon === 'string' ? item.payload.icon : ''
            const frame = typeof item.payload.frame === 'string' ? item.payload.frame : ''
            return (
              <article
                key={item.id}
                className={`gh-points-shop-card gh-points-shop-card--${item.rarity} ${item.owned ? 'gh-points-shop-card--owned' : ''}`}
              >
                <div className="gh-points-shop-card-top">
                  <span className="gh-points-shop-card-icon" aria-hidden>
                    {item.type === 'title' && (icon || '🏷️')}
                    {item.type === 'emoji' && '🙂'}
                    {item.type === 'avatar_frame' && (
                      <FramePreview frame={frame} size="40px" />
                    )}
                  </span>
                  <span className={`gh-points-rarity gh-points-rarity--${item.rarity}`}>
                    {RARITY_LABELS[item.rarity] ?? item.rarity}
                  </span>
                </div>
                <h3 className={`gh-points-shop-card-name ${item.type === 'title' && item.rarity === 'legendary' ? 'gh-points-shop-name--legendary' : ''}`}>
                  {item.type === 'title' ? (
                    <span style={{ color: typeof item.payload.color === 'string' ? item.payload.color : undefined }}>
                      {item.name}
                    </span>
                  ) : item.name}
                </h3>
                <p className="gh-points-shop-card-desc">{item.description || '—'}</p>
                <div className="gh-points-shop-card-foot">
                  <span className="gh-points-shop-card-cost">{item.cost} 积分</span>
                  {item.owned ? (
                    item.equipped ? (
                      <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" disabled>
                        佩戴中
                      </button>
                    ) : item.type === 'emoji' ? (
                      <span className="gh-badge gh-badge--success">已解锁</span>
                    ) : (
                      <button
                        type="button"
                        className="gh-btn gh-btn--primary gh-btn--sm"
                        disabled={busyId !== null}
                        onClick={() => void equip(item)}
                      >
                        {busyId === item.id ? '佩戴中…' : '佩戴'}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busyId !== null || !affordable}
                      title={affordable ? undefined : '积分不足'}
                      onClick={() => void buy(item)}
                    >
                      {busyId === item.id ? '购买中…' : affordable ? '购买' : '积分不足'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {ownedTitles.length > 0 && (
        <section className="gh-box gh-points-titles">
          <div className="gh-points-titles-head">
            <h2>我的称号</h2>
            {(profileTitleId !== null || equippedLeaderTitleId !== null) && (
              <button
                type="button"
                className="gh-btn gh-btn--ghost gh-btn--sm"
                disabled={busyId !== null}
                onClick={() => void unequipTitle()}
              >
                取消佩戴
              </button>
            )}
          </div>
          <div className="gh-points-titles-list">
            {ownedTitles.map((item) => (
              <div key={item.id} className={`gh-points-title-row ${item.equipped ? 'gh-points-title-row--active' : ''}`}>
                <UserTitleBadge
                  title={{
                    id: item.id,
                    name: item.name,
                    color: typeof item.payload.color === 'string' ? item.payload.color : '#57606a',
                    icon: typeof item.payload.icon === 'string' ? item.payload.icon : '',
                    effect: typeof item.payload.effect === 'string' ? item.payload.effect : undefined,
                    rarity: item.rarity,
                  }}
                  size="md"
                />
                {item.equipped ? (
                  <span className="gh-badge gh-badge--success">佩戴中</span>
                ) : (
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyId !== null}
                    onClick={() => void equip(item)}
                  >
                    佩戴
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {leaderTitles.length > 0 && (
        <section className="gh-box gh-points-titles">
          <div className="gh-points-titles-head">
            <h2>榜一传说称号</h2>
            {equippedLeaderTitleId !== null && (
              <button
                type="button"
                className="gh-btn gh-btn--ghost gh-btn--sm"
                disabled={busyId !== null}
                onClick={() => void unequipTitle()}
              >
                取消佩戴
              </button>
            )}
          </div>
          <p className="gh-text-tertiary" style={{ fontSize: '0.78rem', margin: '0 0 10px' }}>
            单机排行榜第一名自动获得，被超越后自动消失；佩戴后会显示在顶栏、聊天与排行榜。
          </p>
          <div className="gh-points-titles-list">
            {leaderTitles.map((item) => (
              <div key={item.id} className={`gh-points-title-row ${equippedLeaderTitleId === item.id ? 'gh-points-title-row--active' : ''}`}>
                <UserTitleBadge title={item} size="md" />
                {equippedLeaderTitleId === item.id ? (
                  <span className="gh-badge gh-badge--success">佩戴中</span>
                ) : (
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyId !== null}
                    onClick={() => void equipLeader(item)}
                  >
                    佩戴
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {ownedFrames.length > 0 && (
        <section className="gh-box gh-points-titles">
          <div className="gh-points-titles-head">
            <h2>我的头像框</h2>
            {data?.equippedAvatarFrameId != null && (
              <button
                type="button"
                className="gh-btn gh-btn--ghost gh-btn--sm"
                disabled={busyId !== null}
                onClick={() => void unequipFrame()}
              >
                卸下
              </button>
            )}
          </div>
          <div className="gh-points-titles-list">
            {ownedFrames.map((item) => {
              const frame = typeof item.payload.frame === 'string' ? item.payload.frame : ''
              return (
                <div key={item.id} className={`gh-points-title-row ${item.equipped ? 'gh-points-title-row--active' : ''}`}>
                  <FramePreview frame={frame} size="32px" />
                  <span>{item.name}</span>
                  {item.equipped ? (
                    <span className="gh-badge gh-badge--success">佩戴中</span>
                  ) : (
                    <button
                      type="button"
                      className="gh-btn gh-btn--secondary gh-btn--sm"
                      disabled={busyId !== null}
                      onClick={() => void equip(item)}
                    >
                      佩戴
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

/* ============================================================
   排行榜
   ============================================================ */

function LeaderboardTab() {
  const [metric, setMetric] = useState<PointsLeaderboardMetric>('balance')
  const [data, setData] = useState<PointsLeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.get<PointsLeaderboardResponse>(`/points/leaderboard?metric=${metric}&limit=50`)
      .then((res) => { if (!cancelled) setData(res) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载排行榜失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [metric])

  const entries = data?.entries ?? []

  return (
    <div className="gh-points-board">
      <div className="gh-points-board-head">
        <div className="gh-points-shop-type">
          <button
            type="button"
            className={`gh-points-shop-type-btn ${metric === 'balance' ? 'gh-points-shop-type-btn--active' : ''}`}
            onClick={() => setMetric('balance')}
          >
            按余额
          </button>
          <button
            type="button"
            className={`gh-points-shop-type-btn ${metric === 'earned' ? 'gh-points-shop-type-btn--active' : ''}`}
            onClick={() => setMetric('earned')}
          >
            按累计获得
          </button>
        </div>
        <span className="gh-text-tertiary">{data?.total ?? 0} 人上榜</span>
      </div>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}

      {loading && !data ? (
        <div className="gh-points-loading"><div className="gh-spinner" /></div>
      ) : entries.length === 0 ? (
        <div className="gh-box gh-points-empty">还没有人获得积分，去玩一局吧。</div>
      ) : (
        <div className="gh-box gh-table-wrap">
          <table className="gh-table gh-points-board-table">
            <thead>
              <tr>
                <th>#</th>
                <th>玩家</th>
                <th>称号</th>
                <th style={{ textAlign: 'right' }}>余额</th>
                <th style={{ textAlign: 'right' }}>累计获得</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.userId} className={entry.isMe ? 'gh-points-row--me' : undefined}>
                  <td className="gh-points-rank">
                    {entry.rank === 1 ? '👑' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank}
                  </td>
                  <td>
                    <span className="gh-points-player">
                      <UserAvatar
                        userId={entry.userId}
                        username={entry.username}
                        size="sm"
                        frame={entry.avatarFrame?.frame ?? null}
                      />
                      {entry.username}
                      {entry.isMe && <span className="gh-badge gh-badge--accent">我</span>}
                    </span>
                  </td>
                  <td>{entry.title ? <UserTitleBadge title={entry.title} /> : <span className="gh-text-tertiary">—</span>}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{entry.balance}</td>
                  <td style={{ textAlign: 'right' }}>{entry.earned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.me && !entries.some((entry: PointsLeaderboardEntry) => entry.isMe) && (
        <div className="gh-points-board-me">
          <span>我的名次</span>
          <strong>#{data.me.rank}</strong>
          <span>{data.me.username}</span>
          <strong>{metric === 'earned' ? data.me.earned : data.me.balance} 积分</strong>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   流水
   ============================================================ */

function LedgerTab() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PointsLedgerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.get<PointsLedgerResponse>(`/points/ledger?limit=20&page=${page}`)
      .then((res) => { if (!cancelled) setData(res) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载流水失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const entries = data?.entries ?? []

  return (
    <div className="gh-points-ledger">
      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
      {loading && !data ? (
        <div className="gh-points-loading"><div className="gh-spinner" /></div>
      ) : entries.length === 0 ? (
        <div className="gh-box gh-points-empty">还没有积分记录。</div>
      ) : (
        <>
          <div className="gh-box gh-table-wrap">
            <table className="gh-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>来源</th>
                  <th>说明</th>
                  <th style={{ textAlign: 'right' }}>变动</th>
                  <th style={{ textAlign: 'right' }}>余额</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="gh-text-tertiary gh-points-ledger-time">{formatTime(entry.createdAt)}</td>
                    <td>
                      {REASON_LABELS[entry.reason] ?? entry.reason}
                      {entry.game && (
                        <span className="gh-text-tertiary"> · {GAME_LABELS[entry.game] ?? entry.game}</span>
                      )}
                    </td>
                    <td className="gh-text-secondary">{entry.note || '—'}</td>
                    <td
                      style={{ textAlign: 'right', fontWeight: 600 }}
                      className={entry.amount > 0 ? 'gh-points-amount--plus' : 'gh-points-amount--minus'}
                    >
                      {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                    </td>
                    <td style={{ textAlign: 'right' }}>{entry.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="gh-points-pager">
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              上一页
            </button>
            <span className="gh-text-tertiary">第 {page} / {totalPages} 页 · 共 {data?.total ?? 0} 条</span>
            <button
              type="button"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  )
}
