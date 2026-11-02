import { useCallback, useEffect, useRef, useState } from 'react'
import PetSprite from './PetSprite'
import { resolveSpeciesPalette } from './petTheme'
import type { PetSpecies } from '../../types/pet'
import type { PetBattleEvent, PetBattleView } from '../../types/petBattle'

const EVENT_MS = 1150

interface DisplayState {
  meHp: number
  meMp: number
  oppHp: number
  oppMp: number
}

interface PetBattleStageProps {
  battle: PetBattleView
  myUserId: number
  busy: boolean
  onAction: (skillKey: string) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function effectClass(animation: string | undefined): string {
  if (!animation) return ''
  return ` gh-pb-fx--${animation.replace(/[^a-z0-9_-]/gi, '')}`
}

export default function PetBattleStage({ battle, myUserId, busy, onAction }: PetBattleStageProps) {
  const me = battle.me
  const opponent = battle.opponent
  const myTurn = battle.turnUserId === myUserId && !battle.finished

  const [display, setDisplay] = useState<DisplayState>(() => ({
    meHp: me.hp,
    meMp: me.mp,
    oppHp: opponent.hp,
    oppMp: opponent.mp,
  }))
  const [currentEvent, setCurrentEvent] = useState<PetBattleEvent | null>(null)
  const [playing, setPlaying] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const playedSeqRef = useRef(0)
  const queuedSeqRef = useRef(0)
  const queueRef = useRef<PetBattleEvent[]>([])
  const timerRef = useRef<number | null>(null)
  const battleIdRef = useRef<number | null>(null)
  const latestDisplayRef = useRef<DisplayState>({
    meHp: me.hp,
    meMp: me.mp,
    oppHp: opponent.hp,
    oppMp: opponent.mp,
  })
  // 每次渲染同步权威值：播放结束回到最新状态（避免用旧闭包里的 props）
  latestDisplayRef.current = {
    meHp: me.hp,
    meMp: me.mp,
    oppHp: opponent.hp,
    oppMp: opponent.mp,
  }

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const syncDisplay = useCallback(() => {
    setDisplay({ ...latestDisplayRef.current })
  }, [])

  /** 播放队列中的下一条事件，播完后再处理下一条 */
  const playNext = useCallback(() => {
    const next = queueRef.current.shift()
    if (!next) {
      timerRef.current = null
      setPlaying(false)
      setCurrentEvent(null)
      syncDisplay()
      return
    }
    setPlaying(true)
    setCurrentEvent(next)
    playedSeqRef.current = Math.max(playedSeqRef.current, next.seq)
    setDisplay((prev) => {
      const copy = { ...prev }
      const actorIsMe = next.actorId === myUserId
      if (next.kind === 'dot' || next.kind === 'stun') {
        if (actorIsMe) copy.meHp = next.hpAfter
        else copy.oppHp = next.hpAfter
      } else {
        if (next.targetId === myUserId) copy.meHp = next.hpAfter
        else copy.oppHp = next.hpAfter
        if (next.heal > 0) {
          if (actorIsMe) copy.meHp = clamp(copy.meHp + next.heal, 0, me.maxHp)
          else copy.oppHp = clamp(copy.oppHp + next.heal, 0, opponent.maxHp)
        }
        if (actorIsMe && typeof next.mpAfter === 'number') copy.meMp = next.mpAfter
      }
      return copy
    })
    timerRef.current = window.setTimeout(playNext, EVENT_MS)
  }, [me.maxHp, myUserId, opponent.maxHp, syncDisplay])

  // 切换对战：重置播放进度，历史日志不重播
  useEffect(() => {
    if (battleIdRef.current === battle.id) return
    battleIdRef.current = battle.id
    clearTimer()
    queueRef.current = []
    const lastSeq = battle.log.reduce((max, event) => Math.max(max, event.seq), 0)
    playedSeqRef.current = lastSeq
    queuedSeqRef.current = lastSeq
    setCurrentEvent(null)
    setPlaying(false)
    syncDisplay()
  }, [battle.id, battle.log, clearTimer, syncDisplay])

  // 新日志入队（queuedSeq 是入队水位，playedSeq 是播放水位，避免重复入队）
  useEffect(() => {
    const fresh = battle.log.filter((event) => event.seq > queuedSeqRef.current)
    if (fresh.length === 0) return
    queuedSeqRef.current = fresh[fresh.length - 1].seq
    queueRef.current.push(...fresh)
    if (timerRef.current === null && !playing) playNext()
  }, [battle.log, playNext, playing])

  // 队列空闲时跟随权威状态刷新血条（播放中不打断动画）
  useEffect(() => {
    if (playing || timerRef.current !== null || queueRef.current.length > 0) return
    syncDisplay()
  }, [me.hp, me.mp, opponent.hp, opponent.mp, playing, syncDisplay])

  useEffect(() => () => clearTimer(), [clearTimer])

  // 回合倒计时（250ms 刷新，避免 30 秒内秒数跳变不自然）
  useEffect(() => {
    if (!battle.turnDeadline || battle.finished) {
      setSecondsLeft(0)
      return undefined
    }
    const tick = () => {
      const remaining = new Date(battle.turnDeadline!).getTime() - Date.now()
      setSecondsLeft(Math.max(0, Math.ceil(remaining / 1000)))
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [battle.turnDeadline, battle.finished])

  const mePalette = resolveSpeciesPalette(me.species as PetSpecies)
  const oppPalette = resolveSpeciesPalette(opponent.species as PetSpecies)
  const activeIsMe = currentEvent?.actorId === myUserId
  const currentTargetIsMe = currentEvent?.targetId === myUserId
  const fxClass = effectClass(currentEvent?.animation)
  const meHpPct = me.maxHp > 0 ? clamp((display.meHp / me.maxHp) * 100, 0, 100) : 0
  const oppHpPct = opponent.maxHp > 0 ? clamp((display.oppHp / opponent.maxHp) * 100, 0, 100) : 0
  const meMpPct = me.maxMp > 0 ? clamp((display.meMp / me.maxMp) * 100, 0, 100) : 0
  const oppMpPct = opponent.maxMp > 0 ? clamp((display.oppMp / opponent.maxMp) * 100, 0, 100) : 0

  return (
    <div className="gh-pb-stage" style={{ ['--pb-me' as string]: mePalette.primary, ['--pb-opp' as string]: oppPalette.primary }}>
      <div className={`gh-pb-side gh-pb-side--opponent${currentEvent && !activeIsMe && currentEvent.kind !== 'end' ? ' gh-pb-side--acting' : ''}`}>
        <div className="gh-pb-avatar-wrap">
          <PetSprite
            species={opponent.species as PetSpecies}
            mood={70}
            size={190}
            className={`gh-pb-sprite gh-pb-sprite--opponent${currentEvent && !activeIsMe && currentEvent.kind !== 'end' ? ' gh-pb-sprite--attack' : ''}${currentEvent && currentEvent.kind !== 'end' && currentEvent.targetId !== myUserId && currentEvent.damage > 0 ? ' gh-pb-sprite--hit' : ''}`}
            animation={currentEvent && !activeIsMe ? currentEvent.animation : 'idle'}
          />
          {fxClass && !activeIsMe && currentEvent?.kind !== 'end' && (
            <span className={`gh-pb-fx${fxClass}`} aria-hidden />
          )}
          {currentEvent && currentEvent.damage > 0 && !currentTargetIsMe && currentEvent.kind !== 'end' && (
            <span key={currentEvent.seq} className={`gh-pb-float${currentEvent.crit ? ' gh-pb-float--crit' : ''}`}>
              -{currentEvent.damage}
            </span>
          )}
          {currentEvent && currentEvent.heal > 0 && !activeIsMe && (
            <span key={`heal-${currentEvent.seq}`} className="gh-pb-float gh-pb-float--heal">+{currentEvent.heal}</span>
          )}
        </div>
        <div className="gh-pb-info">
          <div className="gh-pb-name-row">
            <strong>{opponent.petName}</strong>
            <span>Lv.{opponent.level} · {opponent.speciesName}</span>
          </div>
          <div className="gh-pb-bar gh-pb-bar--hp">
            <i style={{ width: `${oppHpPct}%` }} />
            <span>{Math.round(display.oppHp)} / {opponent.maxHp}</span>
          </div>
          <div className="gh-pb-bar gh-pb-bar--mp">
            <i style={{ width: `${oppMpPct}%` }} />
            <span>{Math.round(display.oppMp)} / {opponent.maxMp}</span>
          </div>
          <div className="gh-pb-tags">
            {opponent.shield > 0 && <span className="gh-pb-tag gh-pb-tag--shield">护盾 {opponent.shield}</span>}
            {battle.opponentSkills.map((skill) => (
              <span key={skill.key} className={`gh-pb-tag${skill.cooldown > 0 ? ' gh-pb-tag--muted' : ''}`}>
                {skill.emoji} {skill.name}{skill.cooldown > 0 ? ` (${skill.cooldown})` : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="gh-pb-center">
        <span className="gh-pb-round">第 {battle.round} / 40 回合</span>
        <span className={`gh-pb-turn${myTurn ? ' gh-pb-turn--me' : ''}`}>
          {battle.finished ? '战斗结束' : myTurn ? '轮到你行动' : `等待 ${opponent.petName} 行动`}
        </span>
        {!battle.finished && (
          <span className={`gh-pb-clock${secondsLeft <= 5 ? ' gh-pb-clock--urgent' : ''}`}>
            {secondsLeft > 0 ? `${secondsLeft}s` : '超时判定中'}
          </span>
        )}
        <span className="gh-pb-vs" aria-hidden>VS</span>
      </div>

      <div className={`gh-pb-side gh-pb-side--me${currentEvent && activeIsMe && currentEvent.kind !== 'end' ? ' gh-pb-side--acting' : ''}`}>
        <div className="gh-pb-avatar-wrap">
          <PetSprite
            species={me.species as PetSpecies}
            equipped={undefined}
            mood={70}
            size={190}
            className={`gh-pb-sprite${currentEvent && activeIsMe && currentEvent.kind !== 'end' ? ' gh-pb-sprite--attack' : ''}${currentEvent && currentTargetIsMe && currentEvent.damage > 0 ? ' gh-pb-sprite--hit' : ''}`}
            animation={currentEvent && activeIsMe ? currentEvent.animation : 'idle'}
          />
          {fxClass && activeIsMe && currentEvent?.kind !== 'end' && (
            <span className={`gh-pb-fx${fxClass}`} aria-hidden />
          )}
          {currentEvent && currentEvent.damage > 0 && currentTargetIsMe && currentEvent.kind !== 'end' && (
            <span key={currentEvent.seq} className={`gh-pb-float${currentEvent.crit ? ' gh-pb-float--crit' : ''}`}>
              -{currentEvent.damage}
            </span>
          )}
          {currentEvent && currentEvent.heal > 0 && activeIsMe && (
            <span key={`heal-${currentEvent.seq}`} className="gh-pb-float gh-pb-float--heal">+{currentEvent.heal}</span>
          )}
        </div>
        <div className="gh-pb-info">
          <div className="gh-pb-name-row">
            <strong>{me.petName} · 我</strong>
            <span>Lv.{me.level} · {me.speciesName}</span>
          </div>
          <div className="gh-pb-bar gh-pb-bar--hp">
            <i style={{ width: `${meHpPct}%` }} />
            <span>{Math.round(display.meHp)} / {me.maxHp}</span>
          </div>
          <div className="gh-pb-bar gh-pb-bar--mp">
            <i style={{ width: `${meMpPct}%` }} />
            <span>{Math.round(display.meMp)} / {me.maxMp}</span>
          </div>
          <div className="gh-pb-tags">
            {me.shield > 0 && <span className="gh-pb-tag gh-pb-tag--shield">护盾 {me.shield}</span>}
            {me.buffs.map((buff) => (
              <span key={buff.type} className="gh-pb-tag gh-pb-tag--buff">
                {buff.type === 'atk_up' ? '攻击' : '防御'} +{buff.value}%（{buff.turns}）
              </span>
            ))}
            {me.statuses.map((status) => (
              <span key={status.type} className="gh-pb-tag gh-pb-tag--debuff">
                {status.type === 'burn' ? '燃烧' : status.type === 'poison' ? '中毒' : '眩晕'}（{status.turns}）
              </span>
            ))}
          </div>
        </div>
      </div>

      {battle.finished && (
        <div className="gh-pb-result" role="status">
          <strong>
            {battle.result === 'draw'
              ? '平局'
              : battle.winnerId === myUserId
                ? '你赢了！'
                : '你输了'}
          </strong>
          {battle.result !== 'draw' && (
            <span>
              {battle.winnerId === myUserId
                ? `从对手那里赢得 ${battle.rewardPoints} 积分${battle.drop ? `，并夺得「${battle.drop.name}」` : ''}`
                : `被拿走 ${battle.rewardPoints} 积分${battle.drop ? `，失去「${battle.drop.name}」` : ''}`}
            </span>
          )}
        </div>
      )}

      {!battle.finished && (
        <div className="gh-pb-skills">
          {me.skills.map((skill) => {
            const disabled = busy || playing || !myTurn || !skill.usable
            return (
              <button
                key={skill.key}
                type="button"
                className={`gh-pb-skill${skill.usable ? '' : ' gh-pb-skill--disabled'}`}
                disabled={disabled}
                title={skill.reason ?? `消耗 ${skill.mpCost} MP`}
                onClick={() => onAction(skill.key)}
              >
                <span className="gh-pb-skill-emoji" aria-hidden>{skill.emoji}</span>
                <span className="gh-pb-skill-name">{skill.name}</span>
                <span className="gh-pb-skill-meta">
                  {skill.mpCost > 0 ? `${skill.mpCost} MP` : '无消耗'}
                  {skill.cooldown > 0 ? ` · 冷却 ${skill.cooldown}` : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {currentEvent && (
        <div className="gh-pb-log-line" key={`log-${currentEvent.seq}`}>
          {currentEvent.text}
        </div>
      )}
    </div>
  )
}
