/**
 * 搜打撤 HUD：生命 / 能量 / 护甲耐久 / 背包与胸挂 / 技能冷却 / 倒计时 / 撤离进度。
 * 数据来自引擎快照（服务端校准后回填），不直接请求 API。
 */

import type { RaidSnapshot } from '../../lib/raid/engine'
import { RAID_ITEM_MAP, RAID_RARITY_LABELS, getRaidGear } from '../../lib/raid/raidRun'
import type { RaidEquippedGearSnapshot, RaidRun } from '../../types/petRaid'

interface RaidHudProps {
  run: RaidRun
  snapshot: RaidSnapshot
  busy: boolean
  errors: string[]
  onAbandon: () => void
  onSkill: (index: number) => void
  onHeal: () => void
  onRepair: () => void
}

const ROOM_LABELS: Record<string, string> = {
  start: '起点',
  combat: '战斗房间',
  elite: '精英房间',
  boss: '首领房间',
  loot: '物资房间',
  hazard: '危险房间',
  extract: '撤离区',
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function gearLabel(gear: RaidEquippedGearSnapshot): { helmet: string; armor: string; boots: string } {
  const helmet = gear.helmet ? getRaidGear(gear.helmet.key) : null
  const armor = gear.armor ? getRaidGear(gear.armor.key) : null
  const boots = gear.boots ? getRaidGear(gear.boots) : null
  return {
    helmet: helmet ? `${helmet.emoji} ${helmet.tier} 级头` : '无头盔',
    armor: armor ? `${armor.emoji} ${armor.tier} 级甲` : '无护甲',
    boots: boots ? `${boots.emoji} ${boots.tier} 级鞋` : '无战靴',
  }
}

function DurabilityBar({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="gh-raid-hud-durability">
      <span>{label}</span>
      <div className="gh-raid-hud-durability-bar">
        <i style={{ width: `${ratio * 100}%` }} className={ratio < 0.25 ? 'is-danger' : ratio < 0.5 ? 'is-warning' : ''} />
      </div>
      <b>{value}/{max}</b>
    </div>
  )
}

function ContainerGrid({
  title,
  items,
  capacity,
  emptyText,
}: {
  title: string
  items: RaidSnapshot['backpack']
  capacity: number
  emptyText: string
}) {
  return (
    <div className="gh-raid-hud-container">
      <div className="gh-raid-hud-container-head">
        <span>{title}</span>
        <b>{items.length}/{capacity}</b>
      </div>
      <div className="gh-raid-hud-slots">
        {Array.from({ length: Math.max(capacity, 1) }).map((_, index) => {
          const stack = items.find((item) => item.slotIndex === index)
          const def = stack ? RAID_ITEM_MAP.get(stack.itemKey) : null
          return (
            <span
              key={index}
              className={`gh-raid-hud-slot${stack ? ' gh-raid-hud-slot--filled' : ''}`}
              title={def ? `${def.name} ×${stack?.amount}` : ''}
            >
              {def ? def.emoji : ''}
              {stack && stack.amount > 1 ? <i>{stack.amount}</i> : null}
            </span>
          )
        })}
      </div>
      {items.length === 0 && <p className="gh-raid-hud-empty">{emptyText}</p>}
    </div>
  )
}

export default function RaidHud({ run, snapshot, busy, errors, onAbandon, onSkill, onHeal, onRepair }: RaidHudProps) {
  const labels = gearLabel(snapshot.gear)
  const hpRatio = snapshot.maxHp > 0 ? snapshot.hp / snapshot.maxHp : 0
  const mpRatio = snapshot.maxMp > 0 ? snapshot.mp / snapshot.maxMp : 0
  const helmetDur = snapshot.gear.helmet
  const armorDur = snapshot.gear.armor
  const helmetDef = getRaidGear(snapshot.gear.helmet?.key ?? null)?.maxDurability ?? 0
  const armorDef = getRaidGear(snapshot.gear.armor?.key ?? null)?.maxDurability ?? 0

  return (
    <div className="gh-raid-hud">
      <div className="gh-raid-hud-top">
        <div className="gh-raid-hud-map">
          <strong>{run.mapName}</strong>
          <span>{ROOM_LABELS[snapshot.roomKind] ?? '房间'}</span>
          {snapshot.roomCleared ? <em className="is-clear">已清场</em> : <em className="is-danger">交战中</em>}
        </div>
        <div className="gh-raid-hud-timer">
          <span>剩余</span>
          <strong className={snapshot.remainingMs < 60_000 ? 'is-danger' : ''}>{formatMs(snapshot.remainingMs)}</strong>
        </div>
        <div className="gh-raid-hud-stats">
          <span>击杀 <b>{snapshot.kills}</b></span>
          <span>攻击 <b>{snapshot.atk}</b></span>
          {run.insured && <span className="gh-raid-hud-badge">🛡 保险</span>}
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={onHeal}>
            💊 治疗
          </button>
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={onRepair}>
            🛠 维修
          </button>
          <button type="button" className="gh-btn gh-btn--ghost gh-btn--sm" disabled={busy} onClick={onAbandon}>
            放弃
          </button>
        </div>
      </div>

      <div className="gh-raid-hud-bars">
        <div className="gh-raid-hud-bar">
          <span>HP</span>
          <div className="gh-raid-hud-bar-track">
            <i className="is-hp" style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }} />
          </div>
          <b>{Math.round(snapshot.hp)}/{snapshot.maxHp}</b>
        </div>
        <div className="gh-raid-hud-bar">
          <span>MP</span>
          <div className="gh-raid-hud-bar-track">
            <i className="is-mp" style={{ width: `${Math.max(0, Math.min(100, mpRatio * 100))}%` }} />
          </div>
          <b>{Math.round(snapshot.mp)}/{snapshot.maxMp}</b>
        </div>
        {snapshot.shield > 0 && (
          <div className="gh-raid-hud-shield">🛡 护盾 {Math.round(snapshot.shield)}</div>
        )}
        {snapshot.atkBuffMs > 0 && <div className="gh-raid-hud-buff">🔥 攻击强化 {Math.ceil(snapshot.atkBuffMs / 1000)}s</div>}
      </div>

      <div className="gh-raid-hud-gear">
        <span title={labels.helmet}>{labels.helmet}</span>
        <span title={labels.armor}>{labels.armor}</span>
        <span title={labels.boots}>{labels.boots}</span>
        {helmetDur && <DurabilityBar label="头耐久" value={helmetDur.durability} max={helmetDur.maxDurability || helmetDef} />}
        {armorDur && <DurabilityBar label="甲耐久" value={armorDur.durability} max={armorDur.maxDurability || armorDef} />}
      </div>

      <div className="gh-raid-hud-skills">
        {snapshot.skills.length === 0 && <span className="gh-raid-hud-empty">宠物没有装备技能，只能普攻</span>}
        {snapshot.skills.map((skill, index) => {
          const onCooldown = skill.cooldownLeftMs > 0
          return (
            <button
              key={skill.key}
              type="button"
              className={`gh-raid-hud-skill${onCooldown || !skill.affordable ? ' is-disabled' : ''}`}
              disabled={busy || onCooldown || !skill.affordable}
              title={`${skill.name} · ${skill.mpCost} MP`}
              onClick={() => onSkill(index)}
            >
              <span className="gh-raid-hud-skill-key">{index + 1}</span>
              <span className="gh-raid-hud-skill-emoji">{skill.emoji}</span>
              <span className="gh-raid-hud-skill-name">{skill.name}</span>
              <span className="gh-raid-hud-skill-meta">
                {skill.mpCost > 0 ? `${skill.mpCost} MP` : '无消耗'}
                {onCooldown ? ` · ${Math.ceil(skill.cooldownLeftMs / 1000)}s` : ''}
              </span>
            </button>
          )
        })}
      </div>

      {snapshot.extracting && (
        <div className="gh-raid-hud-extract">
          <span>撤离读条</span>
          <div className="gh-raid-hud-bar-track">
            <i className="is-extract" style={{ width: `${snapshot.extractionProgress * 100}%` }} />
          </div>
          <b>{Math.round(snapshot.extractionProgress * 100)}%</b>
        </div>
      )}

      <div className="gh-raid-hud-containers">
        <ContainerGrid title="背包" items={snapshot.backpack} capacity={snapshot.capacities.backpack} emptyText="背包空着，去搜刮吧" />
        <ContainerGrid title="胸挂（消耗品）" items={snapshot.rig} capacity={snapshot.capacities.rig} emptyText="胸挂空着" />
        <ContainerGrid title="安全箱（阵亡保留）" items={snapshot.safe} capacity={snapshot.capacities.safe} emptyText="安全箱空着" />
      </div>

      <div className="gh-raid-hud-footer">
        <span>WASD 移动 · 鼠标瞄准射击 · E 交互 · 1/2/3 技能 · Q 治疗 · F 维修</span>
        {snapshot.toast && (
          <span className={`gh-raid-hud-toast is-${snapshot.toast.tone}`}>{snapshot.toast.text}</span>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="gh-raid-hud-errors">
          {errors.slice(0, 3).map((error, index) => (
            <li key={`${error}-${index}`}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function rarityLabel(rarity: string): string {
  return RAID_RARITY_LABELS[rarity as keyof typeof RAID_RARITY_LABELS] ?? '普通'
}
