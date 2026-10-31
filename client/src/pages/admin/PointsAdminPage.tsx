import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../lib/api'
import UserTitleBadge from '../../components/UserTitleBadge'
import { usePoints } from '../../contexts/PointsContext'
import type {
  AdminPointsResponse,
  AvatarFrameStyle,
  AdminPointsUser,
  AdminShopItem,
  CheckinRule,
  FarmPointRule,
  GamePointRule,
  LeaderTitleDto,
  LeaderTitleRule,
  PointsConfig,
  ShopItemType,
  ShopRarity,
  TitleEffectStyle,
} from '../../types/points'
import { TITLE_EFFECTS } from '../../types/points'

/** 与服务端 gameStatsRules 的 GAME_KEYS 对齐（展示名在客户端维护） */
const GAME_LABELS: Array<{ key: string; label: string }> = [
  { key: '2048', label: '2048' },
  { key: 'doudizhu', label: '斗地主' },
  { key: 'snake', label: '贪吃蛇' },
  { key: 'minesweeper', label: '扫雷' },
  { key: 'jump', label: '跳一跳' },
  { key: 'gomoku', label: '五子棋' },
  { key: 'liar', label: '骗子酒馆' },
  { key: 'uno', label: 'UNO' },
  { key: 'xiangqi', label: '中国象棋' },
  { key: 'parkour', label: '霓虹跑酷' },
]

const RARITY_LABELS: Record<ShopRarity, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

const SHOP_TYPE_LABELS: Record<ShopItemType, string> = {
  title: '称号',
  avatar_frame: '头像框',
  emoji: '表情包',
}

/** 头像框样式白名单（与服务端 AVATAR_FRAME_STYLES 一致） */
const AVATAR_FRAME_OPTIONS: ReadonlyArray<readonly [AvatarFrameStyle, string]> = [
  ['gold', '鎏金'],
  ['neon', '霓虹'],
  ['sakura', '樱花'],
  ['galaxy', '星河'],
]

/** 传说称号特效白名单（与服务端 TITLE_EFFECT_STYLES 一致） */
const TITLE_EFFECT_OPTIONS: ReadonlyArray<readonly [TitleEffectStyle, string]> = [
  ['classic', '经典流光'],
  ['stardust', '星尘'],
  ['flame', '烈焰'],
  ['aurora', '极光'],
  ['thunder', '雷霆'],
]

const RULE_FIELDS: Array<{ key: keyof GamePointRule; label: string; hint?: string }> = [
  { key: 'win', label: '胜利' },
  { key: 'loss', label: '失败', hint: '负数扣分' },
  { key: 'draw', label: '平局' },
  { key: 'participation', label: '参与分', hint: '无胜负的游戏' },
  { key: 'scoreDivisor', label: '表现除数', hint: '0 = 关闭；分数 ÷ 除数' },
  { key: 'scoreBonusMax', label: '表现上限' },
  { key: 'dailyCap', label: '每日上限', hint: '只限制正收益，0 = 不限' },
  { key: 'dailyLossCap', label: '每日输分上限', hint: '只限制扣分，按绝对值，0 = 不限' },
]

interface ShopForm {
  key: string
  type: ShopItemType
  name: string
  description: string
  cost: number
  rarity: ShopRarity
  icon: string
  color: string
  pack: string
  frame: AvatarFrameStyle
  effect: TitleEffectStyle
  isActive: boolean
  sortOrder: number
}

const EMPTY_SHOP_FORM: ShopForm = {
  key: '',
  type: 'title',
  name: '',
  description: '',
  cost: 100,
  rarity: 'common',
  icon: '🏷️',
  color: '#57606a',
  pack: 'nailong',
  frame: 'gold',
  effect: 'classic',
  isActive: true,
  sortOrder: 100,
}

type Tab = 'rules' | 'shop' | 'users'

/**
 * 积分体系管理：游戏/农场规则、积分商店（称号与表情包）、用户调分。
 * 需要 points:manage 能力（管理员默认拥有）。
 */
export default function PointsAdminPage() {
  const { refresh: refreshPoints } = usePoints()
  const [tab, setTab] = useState<Tab>('rules')
  const [data, setData] = useState<AdminPointsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [config, setConfig] = useState<PointsConfig | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<AdminPointsResponse>('/admin/points')
      setData(res)
      setConfig(res.config)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载积分配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saveConfig = async () => {
    if (!config || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await api.put<{ config: typeof config }>('/admin/points/config', config)
      setConfig(res.config)
      setData((prev) => (prev ? { ...prev, config: res.config } : prev))
      setNotice('积分规则已保存，下一局结算立即生效。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <div>
          <h1 className="gh-page-title">积分体系</h1>
          <p className="gh-page-subtitle">
            所有游戏共用一套积分：胜利加分、失败扣分，可兑换称号与表情包。称号只在站内显示，不会同步到聊天。
          </p>
        </div>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void load()} disabled={loading}>
          刷新
        </button>
      </div>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
      {notice && <div className="gh-alert gh-alert--success" role="status">{notice}</div>}

      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
          <div className="gh-spinner" />
        </div>
      ) : !data ? null : (
        <>
          <div className="gh-points-stats">
            <div className="gh-points-stat">
              <span className="gh-points-stat-label">注册用户</span>
              <strong>{data.stats.users}</strong>
            </div>
            <div className="gh-points-stat">
              <span className="gh-points-stat-label">积分总余额</span>
              <strong>{data.stats.totalPoints}</strong>
            </div>
            <div className="gh-points-stat">
              <span className="gh-points-stat-label">今日游戏发放</span>
              <strong>{data.stats.todayGamePoints}</strong>
              <span className="gh-text-tertiary">{data.stats.todayGameResults} 局</span>
            </div>
            <div className="gh-points-stat">
              <span className="gh-points-stat-label">农场 / 偷菜</span>
              <strong>{data.stats.farms} / {data.stats.totalSteals}</strong>
            </div>
          </div>

          <div className="gh-tabnav">
            {([
              ['rules', '规则配置'],
              ['shop', `积分商店（${data.items.length}）`],
              ['users', '用户调分'],
            ] as Array<[Tab, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`gh-tabnav-item ${tab === value ? 'gh-tabnav-item--active' : ''}`}
                onClick={() => { setTab(value); setNotice(''); setError('') }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'rules' && config && (
            <RulesPanel
              config={config}
              saving={saving}
              onChange={setConfig}
              onSave={() => void saveConfig()}
              leaderTitles={data.leaderTitles}
              onLeaderEffectChanged={(message) => { setNotice(message); void load() }}
              onError={setError}
            />
          )}

          {tab === 'shop' && (
            <ShopPanel
              items={data.items}
              emojiPacks={data.emojiPacks}
              onChanged={(message) => { setNotice(message); void load() }}
              onError={setError}
            />
          )}

          {tab === 'users' && (
            <UsersPanel
              onAdjusted={(message) => { setNotice(message); void load(); void refreshPoints() }}
              onError={setError}
            />
          )}
        </>
      )}
    </div>
  )
}

/* ============================================================
   规则配置
   ============================================================ */

function RulesPanel({
  config,
  saving,
  onChange,
  onSave,
  leaderTitles,
  onLeaderEffectChanged,
  onError,
}: {
  config: PointsConfig
  saving: boolean
  onChange: (next: PointsConfig) => void
  onSave: () => void
  leaderTitles: Array<LeaderTitleDto & { holderName: string }>
  onLeaderEffectChanged: (message: string) => void
  onError: (message: string) => void
}) {
  const updateGame = (game: string, key: keyof GamePointRule, value: number) => {
    onChange({
      ...config,
      games: {
        ...config.games,
        [game]: { ...config.games[game], [key]: value },
      },
    })
  }

  const updateFarm = (key: keyof FarmPointRule, value: number) => {
    onChange({ ...config, farm: { ...config.farm, [key]: value } })
  }

  const updateCheckin = (key: keyof CheckinRule, value: number) => {
    onChange({ ...config, checkin: { ...config.checkin, [key]: value } })
  }

  const updateLeader = (key: keyof LeaderTitleRule, value: number) => {
    onChange({ ...config, leaderTitle: { ...config.leaderTitle, [key]: value } })
  }

  return (
    <div className="gh-points-rules">
      <section className="gh-box gh-points-rules-card">
        <div className="gh-points-rules-head">
          <div>
            <h2>游戏积分规则</h2>
            <p className="gh-text-tertiary">
              单机由客户端上报、联机由服务端结算，两侧共用同一套数值。每日上限只截断正收益、每日输分上限只截断扣分，达到任一上限仍可继续游戏（只是不再计分）。
            </p>
          </div>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存规则'}
          </button>
        </div>

        <div className="gh-points-rule-scroll">
          <table className="gh-table gh-points-rule-table">
            <thead>
              <tr>
                <th>游戏</th>
                {RULE_FIELDS.map((field) => (
                  <th key={field.key} title={field.hint}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GAME_LABELS.map(({ key, label }) => {
                const rule = config.games[key]
                if (!rule) return null
                return (
                  <tr key={key}>
                    <td className="gh-points-rule-game">{label}</td>
                    {RULE_FIELDS.map((field) => (
                      <td key={field.key}>
                        <input
                          className="gh-input gh-points-rule-input"
                          type="number"
                          value={rule[field.key]}
                          onChange={(event) => updateGame(key, field.key, Number(event.target.value) || 0)}
                          aria-label={`${label} ${field.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gh-box gh-points-rules-card">
        <h2>农场参数</h2>
        <div className="gh-points-farm-fields">
          <label className="gh-form-field">
            偷菜所得比例（0.1–1）
            <input
              className="gh-input"
              type="number"
              step="0.05"
              min="0.1"
              max="1"
              value={config.farm.stealRatio}
              onChange={(event) => updateFarm('stealRatio', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">小偷所得 = 作物单位价值 × 比例（至少 1 分）</span>
          </label>
          <label className="gh-form-field">
            每日偷菜次数上限（小偷）
            <input
              className="gh-input"
              type="number"
              min="0"
              max="100"
              value={config.farm.stealDailyLimit}
              onChange={(event) => updateFarm('stealDailyLimit', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">0 = 禁止偷菜</span>
          </label>
          <label className="gh-form-field">
            偷菜成功率（0–1）
            <input
              className="gh-input"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={config.farm.stealSuccessRate}
              onChange={(event) => updateFarm('stealSuccessRate', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">失败不消耗次数、不减少对方收成</span>
          </label>
          <label className="gh-form-field">
            每人每天被偷上限
            <input
              className="gh-input"
              type="number"
              min="0"
              max="100"
              value={config.farm.victimDailyStealLimit}
              onChange={(event) => updateFarm('victimDailyStealLimit', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">0 = 全天不可被偷</span>
          </label>
          <label className="gh-form-field">
            每日掉落种子上限
            <input
              className="gh-input"
              type="number"
              min="0"
              max="10"
              value={config.farm.seedDropMax}
              onChange={(event) => updateFarm('seedDropMax', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">每天随机掉落 1–N 个随机种子；0 = 关闭</span>
          </label>
          <label className="gh-form-field">
            商人每日商品数量
            <input
              className="gh-input"
              type="number"
              min="0"
              max="6"
              value={config.farm.merchantCount}
              onChange={(event) => updateFarm('merchantCount', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">0 = 关闭商人</span>
          </label>
          <label className="gh-form-field">
            商人最低折扣（0.1–0.9）
            <input
              className="gh-input"
              type="number"
              step="0.05"
              min="0.1"
              max="0.9"
              value={config.farm.merchantDiscountMin}
              onChange={(event) => updateFarm('merchantDiscountMin', Number(event.target.value) || 0)}
            />
          </label>
          <label className="gh-form-field">
            商人最高折扣（0.1–0.9）
            <input
              className="gh-input"
              type="number"
              step="0.05"
              min="0.1"
              max="0.9"
              value={config.farm.merchantDiscountMax}
              onChange={(event) => updateFarm('merchantDiscountMax', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">0.4 = 4 折；实际折扣在最低–最高之间随机</span>
          </label>
          <label className="gh-form-field">
            开荒赠送积分
            <input
              className="gh-input"
              type="number"
              min="0"
              max="10000"
              value={config.farm.welcomePoints}
              onChange={(event) => updateFarm('welcomePoints', Number(event.target.value) || 0)}
            />
          </label>
        </div>
        <div style={{ marginTop: 'var(--gh-space-4)' }}>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存规则'}
          </button>
        </div>
      </section>

      <section className="gh-box gh-points-rules-card">
        <h2>签到与榜一奖励</h2>
        <div className="gh-points-farm-fields">
          <label className="gh-form-field">
            签到基础积分
            <input
              className="gh-input"
              type="number"
              min="0"
              max="1000"
              value={config.checkin.basePoints}
              onChange={(event) => updateCheckin('basePoints', Number(event.target.value) || 0)}
            />
          </label>
          <label className="gh-form-field">
            连签每天递增
            <input
              className="gh-input"
              type="number"
              min="0"
              max="500"
              value={config.checkin.streakStep}
              onChange={(event) => updateCheckin('streakStep', Number(event.target.value) || 0)}
            />
          </label>
          <label className="gh-form-field">
            连签递增上限
            <input
              className="gh-input"
              type="number"
              min="0"
              max="10000"
              value={config.checkin.streakMaxBonus}
              onChange={(event) => updateCheckin('streakMaxBonus', Number(event.target.value) || 0)}
            />
          </label>
          <label className="gh-form-field">
            榜一称号奖励积分
            <input
              className="gh-input"
              type="number"
              min="0"
              max="10000"
              value={config.leaderTitle.rewardPoints}
              onChange={(event) => updateLeader('rewardPoints', Number(event.target.value) || 0)}
            />
            <span className="gh-text-tertiary">同一用户同一游戏每天最多发一次，0 = 不发</span>
          </label>
        </div>
        <div style={{ marginTop: 'var(--gh-space-4)' }}>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存规则'}
          </button>
        </div>
      </section>

      <LeaderTitlesPanel leaderTitles={leaderTitles} onChanged={onLeaderEffectChanged} onError={onError} />
    </div>
  )
}

/* ============================================================
   榜一传说称号（自动授予，特效可调）
   ============================================================ */

function LeaderTitlesPanel({
  leaderTitles,
  onChanged,
  onError,
}: {
  leaderTitles: Array<LeaderTitleDto & { holderName: string }>
  onChanged: (message: string) => void
  onError: (message: string) => void
}) {
  const [busyId, setBusyId] = useState<number | null>(null)

  const changeEffect = async (row: LeaderTitleDto & { holderName: string }, effect: TitleEffectStyle) => {
    if (busyId !== null) return
    setBusyId(row.id)
    try {
      await api.patch<{ ok: boolean; leaderTitle: LeaderTitleDto }>(`/admin/points/leader-titles/${row.id}`, { effect })
      const label = TITLE_EFFECT_OPTIONS.find(([value]) => value === effect)?.[1] ?? effect
      onChanged(`已将「${row.gameName}」榜一称号特效设为 ${label}`)
    } catch (err) {
      onError(err instanceof Error ? err.message : '更新榜一称号特效失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="gh-box gh-points-rules-card">
      <h2>榜一传说称号</h2>
      <p className="gh-text-tertiary">
        榜一称号由系统自动授予：每个游戏当前单机纪录保持者一位，被超过即自动转移；此处调整特效后立即对持有者生效。
      </p>
      {leaderTitles.length === 0 ? (
        <p className="gh-text-tertiary" style={{ padding: '8px 0' }}>
          还没有产生榜一称号，玩家在单机模式取得第一名后自动生成。
        </p>
      ) : (
        <div className="gh-table-wrap">
          <table className="gh-table">
            <thead>
              <tr>
                <th>游戏</th>
                <th>称号</th>
                <th>持有者</th>
                <th>授予时间</th>
                <th>特效</th>
              </tr>
            </thead>
            <tbody>
              {leaderTitles.map((row) => {
                const effect = (TITLE_EFFECTS as readonly string[]).includes(row.effect)
                  ? (row.effect as TitleEffectStyle)
                  : 'classic'
                return (
                  <tr key={row.id}>
                    <td>{row.gameName}</td>
                    <td><UserTitleBadge title={row} size="sm" /></td>
                    <td>{row.holderName}</td>
                    <td>{new Date(row.awardedAt).toLocaleString('zh-CN')}</td>
                    <td>
                      <select
                        className="gh-input"
                        value={effect}
                        disabled={busyId === row.id}
                        onChange={(event) => void changeEffect(row, event.target.value as TitleEffectStyle)}
                        aria-label={`${row.gameName} 榜一称号特效`}
                      >
                        {TITLE_EFFECT_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ============================================================
   积分商店
   ============================================================ */

function ShopPanel({
  items,
  emojiPacks,
  onChanged,
  onError,
}: {
  items: AdminShopItem[]
  emojiPacks: string[]
  onChanged: (message: string) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState<AdminShopItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<ShopForm>(EMPTY_SHOP_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_SHOP_FORM)
    setFormOpen(true)
  }

  const openEdit = (item: AdminShopItem) => {
    setEditing(item)
    setForm({
      key: item.key,
      type: item.type,
      name: item.name,
      description: item.description ?? '',
      cost: item.cost,
      rarity: item.rarity,
      icon: typeof item.payload.icon === 'string' ? item.payload.icon : '',
      color: typeof item.payload.color === 'string' ? item.payload.color : '#57606a',
      pack: typeof item.payload.pack === 'string' ? item.payload.pack : emojiPacks[0] ?? 'nailong',
      frame: (AVATAR_FRAME_OPTIONS.some(([value]) => value === item.payload.frame)
        ? item.payload.frame
        : 'gold') as AvatarFrameStyle,
      effect: (TITLE_EFFECT_OPTIONS.some(([value]) => value === item.payload.effect)
        ? item.payload.effect
        : 'classic') as TitleEffectStyle,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    })
    setFormOpen(true)
  }

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const payload = form.type === 'emoji'
        ? { pack: form.pack }
        : form.type === 'avatar_frame'
          ? { frame: form.frame, color: form.color }
          : { icon: form.icon, color: form.color, effect: form.effect }
      if (editing) {
        await api.patch(`/admin/points/shop/${editing.id}`, {
          name: form.name,
          description: form.description || null,
          cost: form.cost,
          rarity: form.rarity,
          payload,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
        })
        onChanged(`已更新「${form.name}」`)
      } else {
        await api.post('/admin/points/shop', {
          key: form.key,
          type: form.type,
          name: form.name,
          description: form.description || undefined,
          cost: form.cost,
          rarity: form.rarity,
          payload,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
        })
        onChanged(`已创建「${form.name}」`)
      }
      setFormOpen(false)
      setEditing(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存商品失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: AdminShopItem) => {
    if (busyId !== null) return
    // 商品删除为真删除：拥有记录与佩戴引用一并清除，不可恢复
    const ownerNote = item.ownerCount > 0
      ? `已有 ${item.ownerCount} 位用户拥有，删除后他们将失去该称号，此操作不可恢复。`
      : '此操作不可恢复。'
    if (!window.confirm(`删除「${item.name}」？${ownerNote}`)) return
    setBusyId(item.id)
    try {
      const res = await api.delete<{ ok: boolean; deleted: boolean; removedOwners?: number; clearedEquipped?: number }>(`/admin/points/shop/${item.id}`)
      const removed = res.removedOwners ?? 0
      const cleared = res.clearedEquipped ?? 0
      onChanged(removed === 0 && cleared === 0
        ? `已删除「${item.name}」`
        : `已删除「${item.name}」，清除 ${removed} 条拥有记录、${cleared} 处佩戴引用`)
    } catch (err) {
      onError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="gh-box gh-points-shop-admin">
      <div className="gh-points-rules-head">
        <div>
          <h2>积分商店</h2>
          <p className="gh-text-tertiary">
            称号会显示在排行榜、积分榜与农场邻居列表；表情包商品会解锁聊天表情商店的对应整套表情。
          </p>
        </div>
        <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={openCreate}>
          新建商品
        </button>
      </div>

      <div className="gh-box gh-table-wrap">
        <table className="gh-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>价格</th>
              <th>稀有度</th>
              <th>状态</th>
              <th>拥有</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="gh-points-shop-name">
                    <span>
                      {item.type === 'title'
                        ? (typeof item.payload.icon === 'string' ? item.payload.icon : '🏷️')
                        : item.type === 'avatar_frame' ? '🖼️' : '🙂'}
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <div className="gh-text-tertiary gh-points-shop-key">{item.key}</div>
                    </div>
                  </div>
                </td>
                <td>{SHOP_TYPE_LABELS[item.type] ?? item.type}</td>
                <td>{item.cost}</td>
                <td>{RARITY_LABELS[item.rarity] ?? item.rarity}</td>
                <td>
                  <span className={`gh-badge ${item.isActive ? 'gh-badge--success' : ''}`}>
                    {item.isActive ? '上架' : '下架'}
                  </span>
                </td>
                <td>{item.ownerCount}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => openEdit(item)}>
                    编辑
                  </button>{' '}
                  <button
                    type="button"
                    className="gh-btn gh-btn--danger gh-btn--sm"
                    disabled={busyId === item.id}
                    onClick={() => void remove(item)}
                  >
                    {busyId === item.id ? '处理中…' : '删除'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="gh-dialog-overlay" role="presentation" onClick={() => !saving && setFormOpen(false)}>
          <div className="gh-dialog gh-points-shop-dialog" role="dialog" aria-modal="true" aria-label={editing ? '编辑商品' : '新建商品'} onClick={(event) => event.stopPropagation()}>
            <h3 className="gh-dialog-title">{editing ? `编辑「${editing.name}」` : '新建商品'}</h3>
            <div className="gh-points-shop-form">
              {!editing && (
                <>
                  <label className="gh-form-field">
                    Key（小写字母/数字/下划线）
                    <input
                      className="gh-input gh-input--full"
                      value={form.key}
                      onChange={(event) => setForm({ ...form, key: event.target.value })}
                      placeholder="title_mayor"
                    />
                  </label>
                  <label className="gh-form-field">
                    类型
                    <select
                      className="gh-input gh-input--full"
                      value={form.type}
                      onChange={(event) => setForm({ ...form, type: event.target.value as ShopItemType })}
                    >
                      <option value="title">称号</option>
                      <option value="avatar_frame">头像框</option>
                      <option value="emoji">表情包</option>
                    </select>
                  </label>
                </>
              )}
              <label className="gh-form-field">
                名称
                <input
                  className="gh-input gh-input--full"
                  value={form.name}
                  maxLength={30}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="gh-form-field">
                描述
                <input
                  className="gh-input gh-input--full"
                  value={form.description}
                  maxLength={200}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <div className="gh-points-shop-form-row">
                <label className="gh-form-field">
                  价格
                  <input
                    className="gh-input"
                    type="number"
                    min="0"
                    max="100000"
                    value={form.cost}
                    onChange={(event) => setForm({ ...form, cost: Number(event.target.value) || 0 })}
                  />
                </label>
                <label className="gh-form-field">
                  稀有度
                  <select
                    className="gh-input"
                    value={form.rarity}
                    onChange={(event) => setForm({ ...form, rarity: event.target.value as ShopRarity })}
                  >
                    {(Object.keys(RARITY_LABELS) as ShopRarity[]).map((key) => (
                      <option key={key} value={key}>{RARITY_LABELS[key]}</option>
                    ))}
                  </select>
                </label>
                <label className="gh-form-field">
                  排序
                  <input
                    className="gh-input"
                    type="number"
                    min="0"
                    max="100000"
                    value={form.sortOrder}
                    onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) || 0 })}
                  />
                </label>
              </div>

              {form.type === 'title' ? (
                <div className="gh-points-shop-form-row">
                  <label className="gh-form-field">
                    图标（1–2 个 emoji）
                    <input
                      className="gh-input"
                      value={form.icon}
                      maxLength={4}
                      onChange={(event) => setForm({ ...form, icon: event.target.value })}
                    />
                  </label>
                  <label className="gh-form-field">
                    颜色
                    <input
                      className="gh-input gh-points-color-input"
                      type="color"
                      value={form.color}
                      onChange={(event) => setForm({ ...form, color: event.target.value })}
                    />
                  </label>
                </div>
              ) : form.type === 'avatar_frame' ? (
                <div className="gh-points-shop-form-row">
                  <label className="gh-form-field">
                    头像框样式
                    <select
                      className="gh-input"
                      value={form.frame}
                      onChange={(event) => setForm({ ...form, frame: event.target.value as AvatarFrameStyle })}
                    >
                      {AVATAR_FRAME_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="gh-form-field">
                    预览色
                    <input
                      className="gh-input gh-points-color-input"
                      type="color"
                      value={form.color}
                      onChange={(event) => setForm({ ...form, color: event.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <label className="gh-form-field">
                  解锁的表情包
                  <select
                    className="gh-input gh-input--full"
                    value={form.pack}
                    onChange={(event) => setForm({ ...form, pack: event.target.value })}
                  >
                    {emojiPacks.map((pack) => (
                      <option key={pack} value={pack}>{pack}</option>
                    ))}
                  </select>
                </label>
              )}

              {form.type === 'title' && form.rarity === 'legendary' && (
                <div className="gh-points-shop-form-row">
                  <label className="gh-form-field">
                    传说特效
                    <select
                      className="gh-input"
                      value={form.effect}
                      onChange={(event) => setForm({ ...form, effect: event.target.value as TitleEffectStyle })}
                    >
                      {TITLE_EFFECT_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="gh-form-field">
                    预览
                    <div style={{ paddingTop: '4px' }}>
                      <UserTitleBadge
                        size="md"
                        title={{
                          name: form.name.trim() || '称号预览',
                          color: form.color,
                          icon: form.icon,
                          rarity: 'legendary',
                          effect: form.effect,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <label className="gh-points-checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                />
                上架（用户可见可购买）
              </label>
            </div>
            <div className="gh-dialog-actions">
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setFormOpen(false)} disabled={saving}>
                取消
              </button>
              <button type="button" className="gh-btn gh-btn--primary gh-btn--md" onClick={() => void submit()} disabled={saving || !form.name.trim()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/* ============================================================
   用户调分
   ============================================================ */

function UsersPanel({ onAdjusted, onError }: { onAdjusted: (message: string) => void; onError: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminPointsUser[]>([])
  const [loading, setLoading] = useState(false)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await api.get<{ users: AdminPointsUser[] }>(`/admin/points/users${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      setUsers(res.users ?? [])
    } catch (err) {
      onError(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => { void load('') }, [load])

  const adjust = async (user: AdminPointsUser) => {
    const raw = amounts[user.id] ?? ''
    const amount = Number(raw)
    if (!Number.isInteger(amount) || amount === 0) {
      onError('请输入非 0 的整数积分变动')
      return
    }
    setBusyId(user.id)
    try {
      await api.post(`/admin/points/users/${user.id}/adjust`, { amount, note: notes[user.id] || undefined })
      onAdjusted(`已为 ${user.username} ${amount > 0 ? '增加' : '扣除'} ${Math.abs(amount)} 积分`)
      setAmounts((prev) => ({ ...prev, [user.id]: '' }))
      setNotes((prev) => ({ ...prev, [user.id]: '' }))
      void load(query)
    } catch (err) {
      onError(err instanceof Error ? err.message : '调整失败')
    } finally {
      setBusyId(null)
    }
  }

  const quickAmounts = useMemo(() => [100, -100, 500, -500], [])

  return (
    <section className="gh-box gh-points-users">
      <div className="gh-points-rules-head">
        <div>
          <h2>用户积分</h2>
          <p className="gh-text-tertiary">手动加分/扣分会计入流水；扣分最多扣到 0，余额不会为负。</p>
        </div>
        <form
          className="gh-points-users-search"
          onSubmit={(event) => { event.preventDefault(); void load(query.trim()) }}
        >
          <input
            className="gh-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户名"
          />
          <button type="submit" className="gh-btn gh-btn--secondary gh-btn--md" disabled={loading}>
            {loading ? '搜索中…' : '搜索'}
          </button>
        </form>
      </div>

      <div className="gh-box gh-table-wrap">
        <table className="gh-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>余额</th>
              <th>累计获得</th>
              <th>佩戴称号</th>
              <th>调整</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.username}</strong>
                  <div className="gh-text-tertiary">#{user.id} · {user.role} · {user.status}</div>
                </td>
                <td>{user.points}</td>
                <td>{user.pointsEarned}</td>
                <td>{user.equippedTitle?.name ?? '—'}</td>
                <td>
                  <div className="gh-points-users-adjust">
                    <div className="gh-points-users-quick">
                      {quickAmounts.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`gh-btn gh-btn--sm ${value > 0 ? 'gh-btn--secondary' : 'gh-btn--danger'}`}
                          onClick={() => setAmounts((prev) => ({ ...prev, [user.id]: String(value) }))}
                        >
                          {value > 0 ? `+${value}` : value}
                        </button>
                      ))}
                    </div>
                    <input
                      className="gh-input gh-points-users-amount"
                      type="number"
                      placeholder="±积分"
                      value={amounts[user.id] ?? ''}
                      onChange={(event) => setAmounts((prev) => ({ ...prev, [user.id]: event.target.value }))}
                    />
                    <input
                      className="gh-input gh-points-users-note"
                      placeholder="备注（可选）"
                      value={notes[user.id] ?? ''}
                      maxLength={100}
                      onChange={(event) => setNotes((prev) => ({ ...prev, [user.id]: event.target.value }))}
                    />
                    <button
                      type="button"
                      className="gh-btn gh-btn--primary gh-btn--sm"
                      disabled={busyId === user.id}
                      onClick={() => void adjust(user)}
                    >
                      {busyId === user.id ? '提交中…' : '调整'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && !loading && (
          <p className="gh-text-tertiary" style={{ padding: '16px' }}>没有找到用户。</p>
        )}
      </div>
    </section>
  )
}
