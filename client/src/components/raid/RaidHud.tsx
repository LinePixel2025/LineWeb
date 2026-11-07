/**
 * 搜打撤 HUD 浮层：生命 / 能量 / 护甲耐久 / 技能 / 容器 / 队友 / 提示。
 *
 * 口径：全部面板绝对定位在画布舞台内（由 RaidCanvas 提供 .gh-raid-overlay），
 * 面板本身 `pointer-events: none`，只有按钮可点——这样横屏时不会有一整块 UI 压在战斗区上，
 * 也不会挡住摇杆与瞄准手势。数据来自引擎快照（服务端校准后回填），不直接请求 API。
 */

import type { RaidSnapshot } from '../../lib/raid/engine'
import { RAID_ITEM_MAP, RAID_RARITY_LABELS, getRaidGear } from '../../lib/raid/raidRun'
import { onTap } from '../../lib/raid/tap'
import type { RaidEquippedGearSnapshot, RaidRun } from '../../types/petRaid'
import type { RaidSquadMember } from '../../types/raidSquad'

interface RaidHudProps {
  run: RaidRun
  snapshot: RaidSnapshot
  busy: boolean
  errors: string[]
  squad?: RaidSquadMember[] | null
  selfUserId: number
  onAbandon: () => void
  onSkill: (index: number) => void
  onHeal: () => void
  onRepair: () => void
  onOpenInventory: () => void
  onInteract: () => void
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

const SPECIES_EMOJI: Record<string, string> = {
  cat: '🐱', dog: '🐶', bird: '🐦', rabbit: '🐰', fox: '🦊', panda: '🐼',
}

const MEMBER_STATUS_LABELS: Record<string, string> = {
  lobby: '待命',
  active: '行动中',
  extracted: '已撤离',
  died: '阵亡',
  mia: '失联',
  abandoned: '已撤退',
  offline: '离线',
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
    helmet: helmet ? `${helmet.emoji} T${helmet.tier}` : '🪯 无头',
    armor: armor ? `${armor.emoji} T${armor.tier}` : '🦺 无甲',
    boots: boots ? `${boots.emoji} T${boots.tier}` : '👟 无靴',
  }
}

function DurabilityBar({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="gh-raid-dur">
      <span>{label}</span>
      <div className="gh-raid-dur-track">
        <i style={{ width: `${ratio * 100}%` }} className={ratio < 0.25 ? 'is-danger' : ratio < 0.5 ? 'is-warning' : ''} />
      </div>
      <b>{Math.round(value)}</b>
    </div>
  )
}

function ContainerGrid({
  title,
  items,
  capacity,
  tone,
  onOpen,
}: {
  title: string
  items: RaidSnapshot['backpack']
  capacity: number
  tone: 'backpack' | 'rig' | 'safe'
  onOpen?: () => void
}) {
  const full = items.length >= capacity && capacity > 0
  const total = items.reduce((sum, stack) => sum + stack.amount, 0)
  return (
    <div className={`gh-raid-ctainer gh-raid-ctainer--${tone}`}>
      <button type="button" className="gh-raid-ctainer-head" onClick={onOpen} title={`打开${title}整理物资`}>
        <span>{title}</span>
        <b className={full ? 'is-full' : ''}>{items.length}/{capacity}{total > items.length ? ` · ${total}件` : ''}</b>
      </button>
      <div className="gh-raid-slots">
        {Array.from({ length: Math.max(capacity, 1) }).map((_, index) => {
          const stack = items.find((item) => item.slotIndex === index)
          const def = stack ? RAID_ITEM_MAP.get(stack.itemKey) : null
          const rarity = def?.rarity ?? 'common'
          return (
            <span
              key={index}
              className={`gh-raid-slot${stack ? ' is-filled' : ''}`}
              data-rarity={rarity}
              title={def ? `${def.name} ×${stack?.amount}（${RAID_RARITY_LABELS[rarity]}）` : ''}
            >
              {def ? def.emoji : ''}
              {stack && stack.amount > 1 ? <i>{stack.amount}</i> : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function RaidHud({
  run,
  snapshot,
  busy,
  errors,
  squad,
  selfUserId,
  onAbandon,
  onSkill,
  onHeal,
  onRepair,
  onOpenInventory,
  onInteract,
}: RaidHudProps) {
  const labels = gearLabel(snapshot.gear)
  const hpRatio = snapshot.maxHp > 0 ? snapshot.hp / snapshot.maxHp : 0
  const mpRatio = snapshot.maxMp > 0 ? snapshot.mp / snapshot.maxMp : 0
  const helmetDur = snapshot.gear.helmet
  const armorDur = snapshot.gear.armor
  const helmetMax = getRaidGear(snapshot.gear.helmet?.key ?? null)?.maxDurability ?? 0
  const armorMax = getRaidGear(snapshot.gear.armor?.key ?? null)?.maxDurability ?? 0
  const teammates = (squad ?? []).filter((member) => member.userId !== selfUserId)
  const extractPct = Math.round(snapshot.extractionProgress * 100)
  const gimmick = snapshot.gimmick
  const gimmickSeconds = gimmick ? Math.max(0, Math.ceil(gimmick.nextStrikeInMs / 1000)) : 0
  const prompt = snapshot.extracting
    ? `撤离读条 ${extractPct}% · 读条完成自动撤离`
    : snapshot.canExtract
      ? '靠近撤离点按 E / 点「交互」开始撤离'
      : snapshot.nearContainer
        ? snapshot.nearContainer.opened
          ? '这个容器已搜过'
          : snapshot.roomCleared
            ? '按 E / 点「交互」搜索容器'
            : '清场后才能搜索'
        : ''

  return (
    <div className="gh-raid-hud">
      {/* 左上：生命 / 能量 / 护甲 */}
      <section className="gh-raid-pod gh-raid-pod--vitals">
        <div className="gh-raid-vitals">
          <div className={`gh-raid-hp-ring${hpRatio < 0.3 ? ' is-critical' : ''}`}>
            <svg viewBox="0 0 44 44" aria-hidden>
              <circle className="is-track" cx="22" cy="22" r="19" />
              <circle
                className="is-fill"
                cx="22"
                cy="22"
                r="19"
                strokeDasharray={`${Math.max(0, hpRatio) * 119.4} 119.4`}
              />
            </svg>
            <b>{Math.round(snapshot.hp)}</b>
            <span>HP</span>
          </div>
          <div className="gh-raid-vitals-right">
            <div className="gh-raid-meter">
              <span>MP</span>
              <div className="gh-raid-meter-track">
                <i className="is-mp" style={{ width: `${Math.max(0, Math.min(100, mpRatio * 100))}%` }} />
              </div>
              <b>{Math.round(snapshot.mp)}</b>
            </div>
            <div className="gh-raid-gearrow">
              <span title={labels.helmet}>{labels.helmet}</span>
              <span title={labels.armor}>{labels.armor}</span>
              <span title={labels.boots}>{labels.boots}</span>
            </div>
            {helmetDur && <DurabilityBar label="头" value={helmetDur.durability} max={helmetDur.maxDurability || helmetMax} />}
            {armorDur && <DurabilityBar label="甲" value={armorDur.durability} max={armorDur.maxDurability || armorMax} />}
            <div className="gh-raid-chips">
              {snapshot.shield > 0 && <em className="is-shield">🛡 {Math.round(snapshot.shield)}</em>}
              {snapshot.atkBuffMs > 0 && <em className="is-buff">🔥 {Math.ceil(snapshot.atkBuffMs / 1000)}s</em>}
              {run.insured && <em className="is-insure">保险</em>}
              <em className="is-kill">击杀 {snapshot.kills}</em>
            </div>
          </div>
        </div>
      </section>

      {/* 顶部中央：任务状态 + 计时 */}
      <section className="gh-raid-pod gh-raid-pod--mission">
        <div className="gh-raid-mission-row">
          <span className="gh-raid-room">{ROOM_LABELS[snapshot.roomKind] ?? '房间'}</span>
          <strong className={`gh-raid-timer${snapshot.remainingMs < 60_000 ? ' is-danger' : ''}`}>
            {formatMs(snapshot.remainingMs)}
          </strong>
          <span className={`gh-raid-state${snapshot.roomCleared ? ' is-clear' : ' is-danger'}`}>
            {snapshot.roomCleared ? '已清场' : '交战中'}
          </span>
        </div>
        {snapshot.extracting && (
          <div className="gh-raid-extract">
            <div className="gh-raid-extract-track">
              <i style={{ width: `${extractPct}%` }} />
            </div>
            <b>{extractPct}%</b>
          </div>
        )}
        {run.mode === 'pvp' && <span className="gh-raid-mission-note">PvP 匹配 · 爆率提升</span>}
        {gimmick && (
          <span className={`gh-raid-mission-note${gimmick.warningProgress !== null ? ' is-danger' : ''}`}>
            {gimmick.warningProgress !== null
              ? `⚠️ ${gimmick.label}已锁定 · 进掩体 ${gimmickSeconds}s`
              : `⛓️ ${gimmick.label} · ${gimmickSeconds}s 后锁定`}
          </span>
        )}
      </section>

      {/* 左侧：队友（无队友时不占位） */}
      {teammates.length > 0 && (
        <section className="gh-raid-pod gh-raid-pod--squad">
          <div className="gh-raid-pod-title"><span>SQUAD</span></div>
          {teammates.map((mate, index) => {
            const ratio = mate.maxHp > 0 ? mate.hp / mate.maxHp : 0
            return (
              <div key={mate.userId} className={`gh-raid-mate is-${mate.status}`}>
                <span className="gh-raid-mate-index" data-tone={index % 4}>{SPECIES_EMOJI[mate.species] ?? '🐾'}</span>
                <span className="gh-raid-mate-name">{mate.displayName || mate.name}</span>
                <div className="gh-raid-mate-hp">
                  <i style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />
                </div>
                <b>{MEMBER_STATUS_LABELS[mate.status] ?? mate.status}</b>
              </div>
            )
          })}
        </section>
      )}

      {/* 底部中央：交互提示 + 技能 + 道具 */}
      <section className="gh-raid-pod gh-raid-pod--action">
        {prompt && <div className="gh-raid-prompt">{prompt}</div>}
        <div className="gh-raid-skills">
          {snapshot.skills.length === 0 && <span className="gh-raid-skills-empty">未装备技能 · 只能普攻</span>}
          {snapshot.skills.map((skill, index) => {
            const cdRatio = skill.cooldownMs > 0 ? skill.cooldownLeftMs / skill.cooldownMs : 0
            const cooldown = skill.cooldownLeftMs > 0
            const lackMp = !cooldown && !skill.affordable
            const reason = cooldown
              ? `冷却 ${Math.ceil(skill.cooldownLeftMs / 1000)}s`
              : lackMp
                ? `需 ${skill.mpCost} MP`
                : busy
                  ? '同步中'
                  : ''
            const locked = Boolean(reason)
            return (
              <button
                key={skill.key}
                type="button"
                className={`gh-raid-skill${locked ? ' is-locked' : ''}${lackMp ? ' is-lack-mp' : ''}`}
                disabled={locked}
                title={`${skill.name} · ${skill.mpCost} MP · 冷却 ${Math.round(skill.cooldownMs / 1000)}s${reason ? ` · ${reason}` : ''}`}
                {...onTap(() => onSkill(index))}
              >
                <span className="gh-raid-skill-sweep" style={{ height: `${Math.min(100, cdRatio * 100)}%` }} />
                <span className="gh-raid-skill-emoji">{skill.emoji}</span>
                <span className="gh-raid-skill-cd">
                  {skill.cooldownLeftMs > 0 ? Math.ceil(skill.cooldownLeftMs / 1000) : index + 1}
                </span>
                <span className="gh-raid-skill-meta">
                  <i>{skill.name}</i>
                  <em className={lackMp ? 'is-danger' : ''}>{reason || `${skill.mpCost} MP`}</em>
                </span>
              </button>
            )
          })}
          <div className="gh-raid-quick">
            <button type="button" className="gh-raid-quick-btn is-heal" disabled={busy} {...onTap(onHeal)} title="治疗道具（Q）">
              <span aria-hidden>💊</span>
              <em>治疗</em>
            </button>
            <button type="button" className="gh-raid-quick-btn is-repair" disabled={busy} {...onTap(onRepair)} title="维修包（F）">
              <span aria-hidden>🛠</span>
              <em>维修</em>
            </button>
            <button type="button" className="gh-raid-quick-btn is-abandon" disabled={busy} {...onTap(onAbandon)} title="放弃行动">
              <span aria-hidden>⚑</span>
              <em>撤退</em>
            </button>
          </div>
        </div>
      </section>

      {/* 移动端背包入口：容量 + 一键打开整理面板 */}
      <button type="button" className="gh-raid-bag" {...onTap(onOpenInventory)} aria-label="打开战术背包">
        <span className="gh-raid-bag-icon" aria-hidden>🎒</span>
        <span className="gh-raid-bag-text">
          <b>战术背包</b>
          <em>背包 {snapshot.backpack.length}/{snapshot.capacities.backpack} · 安全箱 {snapshot.safe.length}/{snapshot.capacities.safe}</em>
        </span>
      </button>

      {/* 交互按钮：手机没有键盘，必须给「开箱 / 撤离 / 拾取」一个可点的入口 */}
      <button
        type="button"
        className={`gh-raid-interact${prompt ? ' is-hot' : ''}`}
        {...onTap(onInteract)}
        title="交互（E）：搜索容器 / 撤离"
        aria-label="交互"
      >
        <span aria-hidden>✋</span>
        <b>交互</b>
        <em>E</em>
      </button>

      {/* 底部左侧：三类容器 */}
      <section className="gh-raid-pod gh-raid-pod--loot">
        <ContainerGrid
          title="背包"
          items={snapshot.backpack}
          capacity={snapshot.capacities.backpack}
          tone="backpack"
          onOpen={onOpenInventory}
        />
        <ContainerGrid
          title="胸挂"
          items={snapshot.rig}
          capacity={snapshot.capacities.rig}
          tone="rig"
          onOpen={onOpenInventory}
        />
        <ContainerGrid
          title="安全箱"
          items={snapshot.safe}
          capacity={snapshot.capacities.safe}
          tone="safe"
          onOpen={onOpenInventory}
        />
      </section>

      {/* 右侧：事件流 + 报错 */}
      <section className="gh-raid-pod gh-raid-pod--log">
        {errors.slice(0, 2).map((error, index) => (
          <div key={`${error}-${index}`} className="gh-raid-log is-danger">{error}</div>
        ))}
        {snapshot.toast && (
          <div key={snapshot.toast.id} className={`gh-raid-log is-${snapshot.toast.tone}`}>
            {snapshot.toast.text}
          </div>
        )}
      </section>
    </div>
  )
}

export function rarityLabel(rarity: string): string {
  return RAID_RARITY_LABELS[rarity as keyof typeof RAID_RARITY_LABELS] ?? '普通'
}
