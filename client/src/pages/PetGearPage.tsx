import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PetSprite from '../components/pets/PetSprite'
import { resolveSpeciesMeta, resolveSpeciesPalette } from '../components/pets/petTheme'
import { usePoints } from '../contexts/PointsContext'
import api from '../lib/api'
import type {
  PetCombatStats,
  PetEquipmentInfo,
  PetSkillInfo,
} from '../types/pet'
import type { PetGearStatDelta, PetGearView } from '../types/petBattle'

const SLOT_META: Record<'weapon' | 'armor' | 'accessory', { label: string; icon: string }> = {
  weapon: { label: '武器', icon: '⚔️' },
  armor: { label: '护甲', icon: '🛡️' },
  accessory: { label: '饰品', icon: '💍' },
}

const STAT_LABELS: Array<{ key: keyof PetCombatStats; label: string; icon: string }> = [
  { key: 'maxHp', label: '生命', icon: '❤️' },
  { key: 'maxMp', label: '魔力', icon: '🔷' },
  { key: 'atk', label: '攻击', icon: '⚔️' },
  { key: 'def', label: '防御', icon: '🛡️' },
  { key: 'spd', label: '速度', icon: '💨' },
  { key: 'crit', label: '暴击', icon: '🎯' },
]

const RARITY_LABELS: Record<string, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

const SKILL_KIND_LABELS: Record<string, string> = {
  damage: '攻击',
  heal: '治疗',
  buff: '增益',
  shield: '护盾',
  cleanse: '净化',
}

type GearTab = 'equipment' | 'skills' | 'shop'

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function deltaText(delta: PetGearStatDelta): string {
  const parts: string[] = []
  if (delta.atk) parts.push(`攻${delta.atk > 0 ? '+' : ''}${delta.atk}`)
  if (delta.def) parts.push(`防${delta.def > 0 ? '+' : ''}${delta.def}`)
  if (delta.maxHp) parts.push(`血${delta.maxHp > 0 ? '+' : ''}${delta.maxHp}`)
  if (delta.spd) parts.push(`速${delta.spd > 0 ? '+' : ''}${delta.spd}`)
  if (delta.crit) parts.push(`暴${delta.crit > 0 ? '+' : ''}${delta.crit}`)
  return parts.length > 0 ? parts.join(' · ') : '无属性变化'
}

function itemBonusText(item: PetEquipmentInfo): string {
  const parts: string[] = []
  if (item.atk) parts.push(`攻 +${item.atk}`)
  if (item.def) parts.push(`防 +${item.def}`)
  if (item.hp) parts.push(`血 +${item.hp}`)
  if (item.spd) parts.push(`速 +${item.spd}`)
  if (item.crit) parts.push(`暴 +${item.crit}`)
  return parts.length > 0 ? parts.join(' · ') : '无属性加成'
}

export default function PetGearPage() {
  const { refresh: refreshPoints } = usePoints()
  const [view, setView] = useState<PetGearView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [tab, setTab] = useState<GearTab>('equipment')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.get<PetGearView>('/pets/gear')
      setView(data)
      setError(null)
    } catch (err) {
      setError(errMessage(err, '装备页加载失败'))
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

  const catalog = view?.catalog
  const equipmentCatalog = useMemo(() => catalog?.equipment ?? [], [catalog])
  const skillCatalog = useMemo(() => catalog?.skills ?? [], [catalog])
  const loadout = view?.pet.loadout
  const ownedEquipment = useMemo(() => new Set(view?.pet.ownedEquipment ?? []), [view])
  const ownedSkills = useMemo(() => new Set(view?.pet.ownedSkills ?? []), [view])

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

  const toggleEquipment = (item: PetEquipmentInfo) => {
    const equipped = loadout?.[item.slot] === item.key
    void run(
      () => api.post('/pets/gear/equip', { itemType: 'equipment', key: item.key, equip: !equipped }),
      equipped ? `已卸下${item.name}` : `已装备${item.name}`,
    )
  }

  const toggleSkill = (skill: PetSkillInfo) => {
    const equipped = loadout?.skills.includes(skill.key) ?? false
    void run(
      () => api.post('/pets/gear/equip', { itemType: 'skill', key: skill.key, equip: !equipped }),
      equipped ? `已卸下${skill.name}` : `已装备${skill.name}`,
    )
  }

  const buyEquipment = (item: PetEquipmentInfo) => {
    void run(() => api.post(`/pets/shop/equipment/${item.key}/buy`), `购买了${item.name}`)
  }

  const buySkill = (skill: PetSkillInfo) => {
    void run(() => api.post(`/pets/shop/skills/${skill.key}/buy`), `学会了${skill.name}`)
  }

  if (loading && !view) {
    return (
      <div className="gh-page-container gh-pet-gear-page">
        <div className="gh-pet-loading">
          <span className="gh-pet-loading-emoji" aria-hidden>🎒</span>
          <p>正在整理装备…</p>
        </div>
      </div>
    )
  }

  if (error || !view) {
    return (
      <div className="gh-page-container gh-pet-gear-page">
        <div className="gh-pet-error-box">
          <h1>装备页暂时打不开</h1>
          <p>{error ?? '请稍后再试'}</p>
          <div className="gh-pet-error-actions">
            <Link className="gh-btn gh-btn--primary gh-btn--md" to="/pets">返回宠物页</Link>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void load()}>
              再试一次
            </button>
          </div>
        </div>
      </div>
    )
  }

  const pet = view.pet
  const meta = resolveSpeciesMeta(pet.species, { name: pet.speciesName, emoji: pet.speciesEmoji })
  const palette = resolveSpeciesPalette(pet.species)
  const stats = view.stats.current
  const equipmentStats = new Map(view.stats.equipment.map((item) => [item.key, item]))
  const maxSkills = catalog?.maxEquippedSkills ?? 3

  return (
    <div className="gh-page-container gh-pet-gear-page">
      {toast && <div className={`gh-pet-toast gh-pet-toast--${toast.tone}`} role="status">{toast.text}</div>}

      <header className="gh-pet-gear-top">
        <Link to="/pets" className="gh-pet-home-back">
          <span aria-hidden>←</span>
          返回宠物页
        </Link>
        <div className="gh-pet-gear-links">
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/battle">⚔️ 对战</Link>
          <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/pets/market">🏪 交易行</Link>
        </div>
      </header>

      <section className="gh-pet-gear-hero" style={{ ['--pet-gear-accent' as string]: palette.primary }}>
        <div className="gh-pet-gear-avatar">
          <PetSprite species={pet.species} equipped={pet.equipped} mood={pet.mood} size={180} />
        </div>
        <div className="gh-pet-gear-summary">
          <small>{pet.speciesEmoji} {meta.name} · Lv.{pet.level}</small>
          <h1>{pet.name}</h1>
          <p className="gh-text-tertiary">装备与技能只影响 PvP 对战；穿戴中的装备可以在战斗后被对手夺走。</p>
          <div className="gh-pet-gear-stats">
            {STAT_LABELS.map((item) => (
              <div key={item.key} className="gh-pet-gear-stat">
                <span aria-hidden>{item.icon}</span>
                <small>{item.label}</small>
                <strong>{stats[item.key]}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="gh-pet-gear-wallet">
          <small>积分余额</small>
          <strong>{view.points.toLocaleString('zh-CN')}</strong>
        </div>
      </section>

      <nav className="gh-pet-gear-tabs" aria-label="装备与商店">
        {([
          ['equipment', `装备 ${(['weapon', 'armor', 'accessory'] as const).filter((slot) => loadout?.[slot]).length}/3`],
          ['skills', `技能 ${loadout?.skills.length ?? 0}/${maxSkills}`],
          ['shop', '商店'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`gh-pet-gear-tab${tab === key ? ' gh-pet-gear-tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'equipment' && (
        <section className="gh-pet-gear-panel">
          <div className="gh-pet-gear-slots">
            {(['weapon', 'armor', 'accessory'] as const).map((slot) => {
              const key = loadout?.[slot] ?? null
              const item = key ? equipmentCatalog.find((row) => row.key === key) ?? null : null
              return (
                <div key={slot} className={`gh-pet-gear-slot${item ? ' gh-pet-gear-slot--filled' : ''}`}>
                  <span className="gh-pet-gear-slot-icon" aria-hidden>{SLOT_META[slot].icon}</span>
                  <small>{SLOT_META[slot].label}</small>
                  {item ? (
                    <>
                      <strong>{item.emoji} {item.name}</strong>
                      <span className="gh-pet-gear-slot-bonus">{itemBonusText(item)}</span>
                      <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => toggleEquipment(item)}>
                        卸下
                      </button>
                    </>
                  ) : (
                    <span className="gh-text-tertiary">空槽位</span>
                  )}
                </div>
              )
            })}
          </div>

          <h2 className="gh-pet-gear-section-title">我的装备</h2>
          {equipmentCatalog.filter((item) => ownedEquipment.has(item.key)).length === 0 ? (            <p className="gh-text-tertiary">还没有装备，去商店或交易行看看吧。</p>
          ) : (
            <div className="gh-pet-gear-grid">
              {equipmentCatalog
                .filter((item) => ownedEquipment.has(item.key))
                .map((item) => {
                  const equipped = loadout?.[item.slot] === item.key
                  const delta = equipmentStats.get(item.key)?.delta
                  return (
                    <article key={item.key} className={`gh-pet-gear-card gh-pet-gear-card--${item.rarity}${equipped ? ' gh-pet-gear-card--equipped' : ''}`}>
                      <header>
                        <span>{item.emoji}</span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{RARITY_LABELS[item.rarity] ?? item.rarity} · {SLOT_META[item.slot].label}{item.bound ? ' · 绑定' : ''}</small>
                        </div>
                        {equipped && <em>穿戴中</em>}
                      </header>
                      <p>{item.description}</p>
                      <div className="gh-pet-gear-card-stats">
                        {item.atk > 0 && <span>攻 +{item.atk}</span>}
                        {item.def > 0 && <span>防 +{item.def}</span>}
                        {item.hp > 0 && <span>血 +{item.hp}</span>}
                        {item.spd > 0 && <span>速 +{item.spd}</span>}
                        {item.crit > 0 && <span>暴 +{item.crit}</span>}
                      </div>
                      {equipped
                        ? <small className="gh-pet-gear-card-delta">当前加成：{itemBonusText(item)}</small>
                        : delta && <small className="gh-pet-gear-card-delta">换上后：{deltaText(delta)}</small>}
                      <button
                        type="button"
                        className={`gh-btn ${equipped ? 'gh-btn--secondary' : 'gh-btn--primary'} gh-btn--sm`}
                        disabled={busy}
                        onClick={() => toggleEquipment(item)}
                      >
                        {equipped ? '卸下' : '装备'}
                      </button>
                    </article>
                  )
                })}
            </div>
          )}
        </section>
      )}

      {tab === 'skills' && (
        <section className="gh-pet-gear-panel">
          <p className="gh-text-tertiary">最多同时装备 {maxSkills} 个技能；战斗中按 MP 与冷却使用，基础普攻永远可用。</p>
          <h2 className="gh-pet-gear-section-title">技能槽</h2>
          <div className="gh-pet-skill-slots">
            {Array.from({ length: maxSkills }).map((_, index) => {
              const key = loadout?.skills[index]
              const skill = key ? skillCatalog.find((row) => row.key === key) ?? null : null
              return (
                <div key={index} className={`gh-pet-skill-slot${skill ? ' gh-pet-skill-slot--filled' : ''}`}>
                  <span aria-hidden>✦</span>
                  {skill ? (
                    <>
                      <strong>{skill.emoji} {skill.name}</strong>
                      <small>{skill.mpCost} MP · 冷却 {skill.cooldown} 回合</small>
                      <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={() => toggleSkill(skill)}>
                        卸下
                      </button>
                    </>
                  ) : (
                    <span className="gh-text-tertiary">空技能槽</span>
                  )}
                </div>
              )
            })}
          </div>

          <h2 className="gh-pet-gear-section-title">已学会技能</h2>
          {skillCatalog.filter((skill) => ownedSkills.has(skill.key)).length === 0 ? (
            <p className="gh-text-tertiary">还没有技能，去技能商店学习吧。</p>
          ) : (
            <div className="gh-pet-skill-grid">
              {skillCatalog
                .filter((skill) => ownedSkills.has(skill.key))
                .map((skill) => {
                  const equipped = loadout?.skills.includes(skill.key) ?? false
                  return (
                    <article key={skill.key} className={`gh-pet-skill-card${equipped ? ' gh-pet-skill-card--equipped' : ''}`}>
                      <header>
                        <span>{skill.emoji}</span>
                        <div>
                          <strong>{skill.name}</strong>
                          <small>{SKILL_KIND_LABELS[skill.kind] ?? skill.kind} · {skill.mpCost} MP · 冷却 {skill.cooldown}</small>
                        </div>
                        {equipped && <em>已装备</em>}
                      </header>
                      <p>{skill.description}</p>
                      <button
                        type="button"
                        className={`gh-btn ${equipped ? 'gh-btn--secondary' : 'gh-btn--primary'} gh-btn--sm`}
                        disabled={busy}
                        onClick={() => toggleSkill(skill)}
                      >
                        {equipped ? '卸下' : '装备'}
                      </button>
                    </article>
                  )
                })}
            </div>
          )}
        </section>
      )}

      {tab === 'shop' && (
        <section className="gh-pet-gear-panel">
          <h2 className="gh-pet-gear-section-title">装备商店</h2>
          <div className="gh-pet-shop-grid">
            {(catalog?.shopEquipment ?? []).map((item) => {
              const owned = ownedEquipment.has(item.key)
              const locked = pet.level < item.minLevel
              return (
                <article key={item.key} className={`gh-pet-shop-card gh-pet-shop-card--${item.rarity}`}>
                  <header>
                    <span>{item.emoji}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{SLOT_META[item.slot].label} · Lv.{item.minLevel}+</small>
                    </div>
                    <b>{item.price} 分</b>
                  </header>
                  <p>{item.description}</p>
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busy || owned || locked || view.points < item.price}
                    onClick={() => buyEquipment(item)}
                  >
                    {owned ? '已拥有' : locked ? `需要 Lv.${item.minLevel}` : view.points < item.price ? '积分不足' : '购买'}
                  </button>
                </article>
              )
            })}
          </div>

          <h2 className="gh-pet-gear-section-title">技能商店</h2>
          <div className="gh-pet-shop-grid">
            {(catalog?.shopSkills ?? []).map((skill) => {
              const owned = ownedSkills.has(skill.key)
              const locked = pet.level < skill.minLevel
              return (
                <article key={skill.key} className="gh-pet-shop-card gh-pet-shop-card--skill">
                  <header>
                    <span>{skill.emoji}</span>
                    <div>
                      <strong>{skill.name}</strong>
                      <small>{SKILL_KIND_LABELS[skill.kind] ?? skill.kind} · Lv.{skill.minLevel}+</small>
                    </div>
                    <b>{skill.price} 分</b>
                  </header>
                  <p>{skill.description}</p>
                  <small className="gh-text-tertiary">{skill.mpCost} MP · 冷却 {skill.cooldown} 回合</small>
                  <button
                    type="button"
                    className="gh-btn gh-btn--primary gh-btn--sm"
                    disabled={busy || owned || locked || view.points < skill.price}
                    onClick={() => buySkill(skill)}
                  >
                    {owned ? '已学会' : locked ? `需要 Lv.${skill.minLevel}` : view.points < skill.price ? '积分不足' : '学习'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
