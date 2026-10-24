/**
 * 我的世界（单机）—— 三维体素沙盒
 *
 * 页面只负责：主菜单（新世界 / 继续存档）、localStorage 存读档、把世界交给
 * 共享的 MinecraftGameView（操控 / HUD / 渲染都在那里）。规则引擎在
 * lib/games/minecraft.ts，服务端不参与单机模式（纯前端玩法）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  MC_DEFAULT_HOTBAR,
  mcApplyEdits,
  mcCreateWorld,
  mcEditKey,
  mcSpawnForSeed,
  type McBlockEdit,
  type McPlayerState,
  type McWorld,
} from '../../lib/games/minecraft'
import MinecraftGameView, { type MinecraftGameViewHandle } from '../../components/games/minecraft/MinecraftGameView'

/** 存档结构（localStorage；edits 为「键 → 方块」的稀疏修改） */
interface McSaveData {
  version: 1
  seed: number
  player: { x: number; y: number; z: number; yaw: number; pitch: number; flying: boolean }
  dayTime: number
  dayEnabled: boolean
  hotbar: number[]
  hotbarIndex: number
  edits: McBlockEdit[]
}

const SAVE_KEY = 'lineweb-mc-sp-v1'

function loadSave(): McSaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as McSaveData
    if (parsed?.version !== 1 || typeof parsed.seed !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeSave(save: McSaveData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save))
    return true
  } catch {
    return false
  }
}

/** 把存档稀疏修改应用回世界（联机引擎的 mcApplyEdits 口径一致） */
function editsFromSave(save: McSaveData): McBlockEdit[] {
  return (save.edits ?? []).filter(
    (edit) =>
      Number.isInteger(edit?.x)
      && Number.isInteger(edit?.y)
      && Number.isInteger(edit?.z)
      && Number.isInteger(edit?.b),
  )
}

export default function MinecraftPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'menu' | 'loading' | 'playing'>('menu')
  const [hasSave, setHasSave] = useState<McSaveData | null>(null)
  const [seedInput, setSeedInput] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [menuError, setMenuError] = useState<string | null>(null)

  const worldRef = useRef<McWorld | null>(null)
  const initialPlayerRef = useRef<{ x: number; y: number; z: number; yaw?: number; pitch?: number; flying?: boolean } | null>(null)
  const editsRef = useRef<Map<string, number>>(new Map())
  const dayTimeRef = useRef(60_000)
  const dayEnabledRef = useRef(true)
  const hotbarRef = useRef<number[]>(MC_DEFAULT_HOTBAR)
  const hotbarIndexRef = useRef(0)
  const gameViewRef = useRef<MinecraftGameViewHandle | null>(null)

  const [dayEnabled, setDayEnabled] = useState(true)

  useEffect(() => {
    setHasSave(loadSave())
  }, [])

  /** 开始一局：seed 为 null 表示「读档」，否则开新世界 */
  const startGame = useCallback((seed: number | null) => {
    setMenuError(null)

    if (seed === null) {
      const save = loadSave()
      if (!save) {
        setMenuError('存档不存在或已损坏')
        setHasSave(null)
        return
      }
      setPhase('loading')
      // 让「正在生成世界」先渲染一帧再做 150ms 级别的世界生成
      window.setTimeout(() => {
        const world = mcCreateWorld(save.seed)
        const edits = editsFromSave(save)
        mcApplyEdits(world, edits)
        editsRef.current = new Map(edits.map((edit) => [mcEditKey(edit.x, edit.y, edit.z), edit.b]))
        worldRef.current = world
        initialPlayerRef.current = save.player
        dayTimeRef.current = save.dayTime ?? 60_000
        dayEnabledRef.current = save.dayEnabled ?? true
        setDayEnabled(dayEnabledRef.current)
        hotbarRef.current = save.hotbar?.length === 9 ? save.hotbar : MC_DEFAULT_HOTBAR
        hotbarIndexRef.current = save.hotbarIndex ?? 0
        setPhase('playing')
      }, 30)
      return
    }

    setPhase('loading')
    window.setTimeout(() => {
      const world = mcCreateWorld(seed)
      editsRef.current = new Map()
      worldRef.current = world
      initialPlayerRef.current = mcSpawnForSeed(seed)
      dayTimeRef.current = 60_000
      dayEnabledRef.current = true
      setDayEnabled(true)
      hotbarRef.current = MC_DEFAULT_HOTBAR
      hotbarIndexRef.current = 0
      setPhase('playing')
    }, 30)
  }, [])

  /** 落一笔本地修改（GameView 回调） */
  const handleLocalEdit = useCallback((edit: McBlockEdit) => {
    editsRef.current.set(mcEditKey(edit.x, edit.y, edit.z), edit.b)
  }, [])

  /** GameView 每 ~5 秒推一次快照：写存档 */
  const handleSnapshot = useCallback(
    (snapshot: { player: McPlayerState; dayTime: number; dayEnabled: boolean; hotbar: number[]; hotbarIndex: number }) => {
      const world = worldRef.current
      if (!world) return
      dayTimeRef.current = snapshot.dayTime
      dayEnabledRef.current = snapshot.dayEnabled
      hotbarRef.current = snapshot.hotbar
      hotbarIndexRef.current = snapshot.hotbarIndex
      const save: McSaveData = {
        version: 1,
        seed: world.seed,
        player: {
          x: snapshot.player.x,
          y: snapshot.player.y,
          z: snapshot.player.z,
          yaw: snapshot.player.yaw,
          pitch: snapshot.player.pitch,
          flying: snapshot.player.flying,
        },
        dayTime: snapshot.dayTime,
        dayEnabled: snapshot.dayEnabled,
        hotbar: snapshot.hotbar,
        hotbarIndex: snapshot.hotbarIndex,
        edits: Array.from(editsRef.current.entries()).map(([key, b]) => {
          const [x, y, z] = key.split(',').map(Number)
          return { x, y, z, b }
        }),
      }
      writeSave(save)
    },
    [],
  )

  /** 退出到主菜单（写一次最终存档） */
  const exitToMenu = useCallback(() => {
    const world = worldRef.current
    const player = gameViewRef.current?.getPlayerState()
    if (world && player) {
      handleSnapshot({
        player,
        dayTime: dayTimeRef.current,
        dayEnabled: dayEnabledRef.current,
        hotbar: hotbarRef.current,
        hotbarIndex: hotbarIndexRef.current,
      })
    }
    worldRef.current = null
    initialPlayerRef.current = null
    setHasSave(loadSave())
    setPhase('menu')
  }, [handleSnapshot])

  const deleteSave = useCallback(() => {
    localStorage.removeItem(SAVE_KEY)
    setHasSave(null)
  }, [])

  const parseSeedInput = useCallback((): number => {
    const raw = seedInput.trim()
    if (!raw) return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) return Math.abs(Math.floor(numeric)) >>> 0
    // 字符串种子：确定性哈希成 32 位
    let hash = 0
    for (let i = 0; i < raw.length; i += 1) {
      hash = (Math.imul(hash, 31) + raw.charCodeAt(i)) >>> 0
    }
    return hash
  }, [seedInput])

  // === 主菜单 ===

  if (phase === 'menu') {
    return (
      <div className="gh-page-container gh-games-page gh-mc-page">
        <div className="gh-mc-menu">
          <div className="gh-mc-menu-card">
            <h1 className="gh-mc-menu-title">⛏️ 我的世界</h1>
            <p className="gh-mc-menu-subtitle">三维体素沙盒 · 挖掘、建造、飞行探索一片 192×192 的程序化世界</p>

            {menuError && <div className="gh-alert gh-alert--danger">{menuError}</div>}

            {hasSave && (
              <button type="button" className="gh-mc-menu-btn gh-mc-menu-btn--primary" onClick={() => startGame(null)}>
                继续上次的世界（seed {hasSave.seed}）
              </button>
            )}

            <div className="gh-mc-menu-new">
              <input
                className="gh-mc-menu-input"
                placeholder="世界种子（留空随机，支持文字）"
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                maxLength={32}
              />
              <button type="button" className="gh-mc-menu-btn gh-mc-menu-btn--primary" onClick={() => startGame(parseSeedInput())}>
                创建新世界
              </button>
            </div>

            {hasSave && (
              <button type="button" className="gh-mc-menu-btn gh-mc-menu-btn--danger" onClick={deleteSave}>
                删除存档
              </button>
            )}

            <div className="gh-mc-menu-links">
              <Link to="/games" className="gh-mc-menu-link">← 返回游戏大厅</Link>
              <Link to="/games/minecraft/online" className="gh-mc-menu-link">好友联机 →</Link>
            </div>

            <button type="button" className="gh-mc-menu-btn" onClick={() => setShowHelp((value) => !value)}>
              {showHelp ? '收起操作说明' : '操作说明'}
            </button>
            {showHelp && (
              <div className="gh-mc-menu-help">
                <div><strong>移动</strong>：WASD · 空格跳跃 · 双击空格切换飞行 · Ctrl 疾跑 · Shift 潜行 / 飞行下降</div>
                <div><strong>操作方块</strong>：左键挖掘（基岩不可挖）· 右键放置 · 触挖到方块会高亮黑框</div>
                <div><strong>物品</strong>：滚轮 / 数字键 1-9 切换快捷栏 · E 打开方块物品栏替换当前格</div>
                <div><strong>其他</strong>：F3 调试信息（坐标 / FPS / 朝向）· Esc 暂停菜单 · 昼夜 10 分钟循环</div>
                <div><strong>存档</strong>：自动保存到浏览器（seed + 修改 + 位置），同一浏览器随时继续</div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'loading' || !worldRef.current || !initialPlayerRef.current) {
    return (
      <div className="gh-page-container gh-games-page gh-mc-page">
        <div className="gh-mc-loading">
          <div className="gh-spinner" />
          <p>正在生成世界…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gh-page-container gh-mc-full">
      <MinecraftGameView
        key={`sp-${worldRef.current.seed}`}
        ref={gameViewRef}
        world={worldRef.current}
        initialPlayer={initialPlayerRef.current}
        selfUserId={0}
        dayEnabled={dayEnabled}
        onDayEnabledChange={(enabled) => {
          dayEnabledRef.current = enabled
          setDayEnabled(enabled)
        }}
        onLocalEdit={handleLocalEdit}
        onSnapshot={handleSnapshot}
        exitLabel="保存并回到主菜单"
        onExit={exitToMenu}
      />
      <button type="button" className="gh-mc-back" onClick={() => navigate('/games')} title="返回游戏大厅">
        ←
      </button>
    </div>
  )
}
