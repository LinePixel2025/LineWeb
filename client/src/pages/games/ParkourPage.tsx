import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  createParkourRun,
  parkourScore,
  type ParkourRunState,
} from '../../lib/games/parkour'
import { useGameStats } from '../../contexts/GameStatsContext'
import type {
  ParkourEndResult,
  ParkourGameViewProps,
} from '../../components/games/parkour/ParkourGameView'

type GameViewComponent = ComponentType<ParkourGameViewProps>
type Phase = 'intro' | 'loading' | 'playing' | 'paused' | 'ended'

const INTRO_FEATURES = [
  ['换道', 'A / D 或 ← / →，三条霓虹车道自由切换'],
  ['跳跃', 'Space / W / ↑，越过低路障与坑洞'],
  ['滑铲', '按住 S / ↓，从悬空广告牌下方穿过'],
  ['冲刺', '拾取金色箭头，4 秒无敌加速'],
] as const

function seed32(): number {
  try {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return buffer[0] || 1
  } catch {
    return Math.floor(Math.random() * 0xffff_ffff) || 1
  }
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

function causeLabel(cause: ParkourEndResult['cause']): string {
  if (cause === 'pit') return '坠入坑洞'
  if (cause === 'hit') return '撞上障碍'
  return '本局结束'
}

interface ParkourBestView {
  distanceM: number
  coins: number
  score: number
  maxCombo: number
  runs: number
}

interface ParkourSaveView {
  best: ParkourBestView
  newDistance: boolean
  newScore: boolean
  newCoins: boolean
  newCombo: boolean
}

/** 霓虹跑酷单机页：3D 无尽跑酷 + 账号纪录；three.js 场景在点击开始时动态加载 */
export default function ParkourPage() {
  const [phase, setPhase] = useState<Phase>('intro')
  const { getStat, recordResult } = useGameStats()
  const stat = getStat('parkour', 'solo')
  const best: ParkourBestView = {
    distanceM: stat?.bestDistance ?? 0,
    coins: stat?.bestCoins ?? 0,
    score: stat?.bestScore ?? 0,
    maxCombo: stat?.bestCombo ?? 0,
    runs: stat?.games ?? 0,
  }
  const [result, setResult] = useState<ParkourEndResult | null>(null)
  const [saveInfo, setSaveInfo] = useState<ParkourSaveView | null>(null)
  const [gameView, setGameView] = useState<GameViewComponent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runVersion, setRunVersion] = useState(0)
  const runRef = useRef<ParkourRunState | null>(null)
  const gameViewRef = useRef<GameViewComponent | null>(null)
  const runEndedRef = useRef(false)

  const startRun = useCallback(async (): Promise<void> => {
    setError(null)
    setPhase('loading')
    try {
      if (!gameViewRef.current) {
        const mod = await import('../../components/games/parkour/ParkourGameView')
        gameViewRef.current = mod.default
        setGameView(() => mod.default)
      }
      const run = createParkourRun({ seed: seed32(), mode: 'endless' })
      runRef.current = run
      runEndedRef.current = false
      setResult(null)
      setSaveInfo(null)
      setRunVersion((value) => value + 1)
      setPhase('playing')
    } catch (err) {
      setError(err instanceof Error ? err.message : '3D 场景加载失败，请重试')
      setPhase('intro')
    }
  }, [])

  const handleEnd = useCallback((end: ParkourEndResult): void => {
    if (runEndedRef.current) return
    runEndedRef.current = true
    const save: ParkourSaveView = {
      best: {
        distanceM: Math.max(best.distanceM, end.distanceM),
        coins: Math.max(best.coins, end.coins),
        score: Math.max(best.score, end.score),
        maxCombo: Math.max(best.maxCombo, end.maxCombo),
        runs: best.runs + 1,
      },
      newDistance: end.distanceM > best.distanceM,
      newScore: end.score > best.score,
      newCoins: end.coins > best.coins,
      newCombo: end.maxCombo > best.maxCombo,
    }
    setSaveInfo(save)
    recordResult({
      game: 'parkour',
      variant: 'solo',
      score: end.score,
      distanceM: end.distanceM,
      coins: end.coins,
      maxCombo: end.maxCombo,
    })
    setResult(end)
    setPhase('ended')
  }, [best, recordResult])

  const togglePause = useCallback((): void => {
    setPhase((current) => {
      if (current === 'playing') return 'paused'
      if (current === 'paused') return 'playing'
      return current
    })
  }, [])

  const exitRun = useCallback((): void => {
    if (phase === 'playing' || phase === 'paused') {
      if (!window.confirm('退出本局？本次成绩不会计入纪录。')) return
    }
    runRef.current = null
    setResult(null)
    setSaveInfo(null)
    setPhase('intro')
  }, [phase])

  useEffect(() => {
    if (phase !== 'paused' && phase !== 'ended') return undefined
    const handler = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return
      }
      if (event.code !== 'KeyR' || event.repeat) return
      event.preventDefault()
      void startRun()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, startRun])

  const run = runRef.current
  const GameView = gameView
  const inGame = phase === 'playing' || phase === 'paused' || phase === 'ended'

  if (inGame && run && GameView) {
    return createPortal(
      <div className="gh-pk-full">
        <div className="gh-pk-topbar">
          <button type="button" className="gh-pk-topbar-btn" onClick={exitRun}>
            ← 退出
          </button>
          <div className="gh-pk-topbar-title">
            <span className="gh-pk-live-dot" aria-hidden />
            霓虹跑酷 · 无尽模式
          </div>
          <button
            type="button"
            className="gh-pk-topbar-btn"
            onClick={togglePause}
            disabled={phase === 'ended'}
          >
            {phase === 'playing' ? '暂停' : phase === 'paused' ? '继续' : '已结束'}
          </button>
        </div>

        <GameView
          key={runVersion}
          run={run}
          mode="single"
          playerColorIndex={0}
          paused={phase !== 'playing'}
          onEnd={handleEnd}
          onPauseToggle={togglePause}
        />

        {phase === 'paused' && (
          <div className="gh-pk-overlay" role="dialog" aria-modal="true" aria-label="游戏暂停">
            <div className="gh-pk-overlay-card">
              <p className="gh-pk-overlay-eyebrow">PAUSED</p>
              <h2>霓虹暂歇</h2>
              <p className="gh-pk-overlay-sub">
                当前 {Math.floor(run.distanceM)}m · {run.coins} 金币 · {formatNumber(parkourScore(run))} 分待结算
              </p>
              <div className="gh-pk-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={togglePause}>
                  继续奔跑
                </button>
                <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void startRun()}>
                  重新开始
                </button>
                <button type="button" className="gh-btn gh-btn--danger gh-btn--md" onClick={exitRun}>
                  退出本局
                </button>
              </div>
              <p className="gh-pk-overlay-hint">按 Esc / P 继续，按 R 重新开始</p>
            </div>
          </div>
        )}

        {phase === 'ended' && result && saveInfo && (
          <div className="gh-pk-overlay" role="dialog" aria-modal="true" aria-label="本局结算">
            <div className="gh-pk-overlay-card gh-pk-overlay-card--result">
              <p className="gh-pk-overlay-eyebrow">RUN COMPLETE</p>
              <h2>{causeLabel(result.cause)}</h2>
              <div className="gh-pk-result-distance">
                <strong>{Math.floor(result.distanceM)}</strong>
                <span>m</span>
              </div>
              <div className="gh-pk-result-grid">
                <div><span>金币</span><strong>{result.coins}</strong></div>
                <div><span>得分</span><strong>{formatNumber(result.score)}</strong></div>
                <div><span>最高连击</span><strong>×{result.maxCombo}</strong></div>
                <div><span>历史最远</span><strong>{Math.floor(saveInfo.best.distanceM)}m</strong></div>
              </div>
              {(saveInfo.newDistance || saveInfo.newScore || saveInfo.newCoins || saveInfo.newCombo) && (
                <p className="gh-pk-new-record">
                  {saveInfo.newDistance ? '新距离纪录！' : '刷新纪录！'}
                  {saveInfo.newScore ? ' 最高分' : ''}
                  {saveInfo.newCoins ? ' 最多金币' : ''}
                  {saveInfo.newCombo ? ' 最高连击' : ''}
                </p>
              )}
              <div className="gh-pk-overlay-actions">
                <button type="button" className="gh-btn gh-btn--primary gh-btn--lg" onClick={() => void startRun()}>
                  再来一次 <kbd>R</kbd>
                </button>
                <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games">
                  返回大厅
                </Link>
                <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games/parkour/online">
                  好友竞速
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>,
      document.body,
    )
  }

  return (
    <div className="gh-page-container gh-games-page gh-pk-page">
      <header className="gh-games-header">
        <div className="gh-games-header-copy">
          <p className="gh-g2048-eyebrow">
            <Link to="/games">← 游戏大厅</Link>
          </p>
          <h1 className="gh-games-title">霓虹跑酷</h1>
          <p className="gh-games-subtitle">
            第三人称三车道 3D 跑酷：在霓虹都市的夜色里换道、跳跃、滑铲，穿过列车与路障，
            收集金币和护盾 / 磁铁 / 冲刺道具。跑得越远，速度越快。
          </p>
        </div>
        <div className="gh-pk-header-actions">
          <span className="gh-pk-badge-3d">3D</span>
          <Link className="gh-btn gh-btn--secondary gh-btn--md" to="/games/parkour/online">
            好友竞速
          </Link>
        </div>
      </header>

      {error && <div className="gh-pk-error" role="alert">{error}</div>}

      <section className="gh-pk-hero" aria-label="霓虹跑酷 3D 场景预览">
        <div className="gh-pk-hero-sky" aria-hidden />
        <div className="gh-pk-hero-skyline" aria-hidden />
        <div className="gh-pk-hero-road" aria-hidden>
          <span /><span /><span />
        </div>
        <div className="gh-pk-hero-copy">
          <span className="gh-pk-hero-tag">NEON DISTRICT · 2088</span>
          <h2>把城市甩在身后</h2>
          <p>三车道、一次失误、无限加速。护盾救你一次，冲刺让你反超。</p>
          <div className="gh-pk-hero-actions">
            <button
              type="button"
              className="gh-btn gh-btn--primary gh-btn--lg"
              onClick={() => void startRun()}
              disabled={phase === 'loading'}
            >
              {phase === 'loading' ? '正在构建霓虹都市…' : '开始奔跑'}
            </button>
            <span className="gh-pk-hero-hint">首次开始会加载 3D 场景</span>
          </div>
        </div>
        <div className="gh-pk-hero-runner" aria-hidden>
          <span className="gh-pk-hero-runner-head" />
          <span className="gh-pk-hero-runner-body" />
          <span className="gh-pk-hero-runner-leg gh-pk-hero-runner-leg--a" />
          <span className="gh-pk-hero-runner-leg gh-pk-hero-runner-leg--b" />
        </div>
      </section>

      <div className="gh-pk-intro-grid">
        <section className="gh-pk-panel">
          <h2>账号纪录</h2>
          <div className="gh-pk-records">
            <div><span>最远距离</span><strong>{best.runs > 0 ? `${Math.floor(best.distanceM)}m` : '—'}</strong></div>
            <div><span>最高得分</span><strong>{best.runs > 0 ? formatNumber(best.score) : '—'}</strong></div>
            <div><span>最多金币</span><strong>{best.runs > 0 ? best.coins : '—'}</strong></div>
            <div><span>最高连击</span><strong>{best.runs > 0 ? `×${best.maxCombo}` : '—'}</strong></div>
          </div>
          <p className="gh-pk-panel-note">已完成 {best.runs} 局 · 纪录随账号保存</p>

          <h2>操作</h2>
          <ul className="gh-pk-list">
            <li><kbd>A</kbd>/<kbd>D</kbd> 或 <kbd>←</kbd>/<kbd>→</kbd> 换道；<kbd>Space</kbd>/<kbd>W</kbd>/<kbd>↑</kbd> 跳跃</li>
            <li>按住 <kbd>S</kbd>/<kbd>↓</kbd> 滑铲；空中滑铲会快速下坠</li>
            <li>手机：左右滑动换道、上滑跳跃、下滑滑铲，也可用屏幕四按钮</li>
            <li><kbd>Esc</kbd>/<kbd>P</kbd> 暂停，<kbd>R</kbd> 重开</li>
          </ul>
        </section>

        <aside className="gh-pk-panel gh-pk-panel--rules">
          <h2>生存守则</h2>
          <ul className="gh-pk-list">
            <li><strong>列车</strong>占满一条车道，必须换道；<strong>低路障</strong>跳过；<strong>悬空牌</strong>滑过；<strong>坑洞</strong>跳过去。</li>
            <li>一次撞击或掉坑就结束；<strong>护盾</strong>能抵挡一次撞击，但不能救掉坑。</li>
            <li><strong>磁铁</strong> 8 秒吸金币；<strong>冲刺</strong> 4 秒无敌加速，可以直接飞越坑洞。</li>
            <li>连续吃金币提高连击；撞障碍会清零。得分 = 距离 + 金币 × 10 + 最高连击 × 20。</li>
            <li>好友竞速为 2–6 人同 seed 的 800m 幽灵赛道，先冲线者胜。</li>
          </ul>
          <div className="gh-pk-feature-grid">
            {INTRO_FEATURES.map(([title, description]) => (
              <div key={title} className="gh-pk-feature">
                <strong>{title}</strong>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
