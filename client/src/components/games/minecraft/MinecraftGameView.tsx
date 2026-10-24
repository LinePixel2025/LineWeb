/**
 * 我的世界 —— 单机 / 联机共用的游戏视图（画布 + 操控 + HUD）
 *
 * 职责：输入采集（指针锁定 + 触屏）、物理推进（引擎纯函数）、three.js 场景驱动、
 * 快捷栏 / 物品栏 / 调试浮层 / 暂停菜单 / 触屏按钮。规则在 lib/games/minecraft.ts，
 * 渲染在 lib/games/minecraftScene.ts，页面（单机 / 联机）只负责网络与存档。
 *
 * 联机差异（通过 props 表达）：
 *   - remotePlayers：其他玩家的快照（WS 事件 / 轮询 sync 推给页面，页面再传下来）；
 *   - 远端编辑通过 ref 句柄 applyRemoteEdits 注入；
 *   - 联机不暂停物理（Esc 菜单只是松开鼠标），单机暂停时世界冻结。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  MC_BLOCK_NAMES,
  MC_DAY_LENGTH_MS,
  MC_DEFAULT_HOTBAR,
  MC_PALETTE_BLOCKS,
  MC_REACH,
  MC_WORLD_HEIGHT,
  MC_WORLD_SIZE,
  mcApplyEdits,
  mcBlockIndex,
  mcCreatePlayerState,
  mcEditIntersectsPlayer,
  mcEyePosition,
  mcIsBreakable,
  mcIsPlaceable,
  mcRaycastVoxel,
  mcSetBlock,
  mcStepPlayer,
  type McBlockEdit,
  type McPlayerInput,
  type McPlayerState,
  type McRayHit,
  type McWorld,
} from '../../../lib/games/minecraft'
import { mcBlockFaceTile, mcTileIconUrl } from '../../../lib/games/minecraftTextures'
import { MinecraftScene, type McRemotePlayerView } from '../../../lib/games/minecraftScene'

export interface MinecraftGameViewHandle {
  /** 应用远端（或存档）的方块修改：更新体素数据并重建受影响区块 */
  applyRemoteEdits: (edits: McBlockEdit[]) => void
  /** 当前玩家状态快照（联机位置上报用） */
  getPlayerState: () => McPlayerState | null
}

interface MinecraftGameViewProps {
  world: McWorld
  /** 初始玩家状态（出生点 / 存档恢复） */
  initialPlayer: { x: number; y: number; z: number; yaw?: number; pitch?: number; flying?: boolean }
  selfUserId: number
  /** 联机：其他玩家视图；单机传空数组 */
  remotePlayers?: McRemotePlayerView[]
  isOnline?: boolean
  dayEnabled: boolean
  onDayEnabledChange?: (enabled: boolean) => void
  /** 本地编辑落账（页面负责存档 / 上报服务端） */
  onLocalEdit: (edit: McBlockEdit) => void
  /** 暂停菜单的退出按钮 */
  exitLabel: string
  onExit: () => void
  /** 单机定期快照（约 5 秒一次：玩家 / 昼夜 / 快捷栏） */
  onSnapshot?: (snapshot: {
    player: McPlayerState
    dayTime: number
    dayEnabled: boolean
    hotbar: number[]
    hotbarIndex: number
  }) => void
  initialDayTime?: number
  initialHotbar?: number[]
  initialHotbarIndex?: number
}

const HOTBAR_SIZE = 9
const TOUCH_SENSITIVITY = 0.006
const MOUSE_SENSITIVITY = 0.0024

/** 由 yaw/pitch 求视线方向（与引擎朝向约定一致：yaw=0 面向 -Z） */
function dirFromYawPitch(yaw: number, pitch: number): { x: number; y: number; z: number } {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  }
}

/** 朝向的中文方位（yaw=0 = 北，yaw 增大向左转） */
function facingLabel(yaw: number): string {
  const labels = ['北', '西北', '西', '西南', '南', '东南', '东', '东北']
  const normalized = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return labels[Math.round(normalized / (Math.PI / 4)) % 8]
}

const MinecraftGameView = forwardRef<MinecraftGameViewHandle, MinecraftGameViewProps>(
  function MinecraftGameView(props, ref) {
    const {
      world,
      initialPlayer,
      selfUserId,
      remotePlayers = [],
      isOnline = false,
      dayEnabled,
      onDayEnabledChange,
      onLocalEdit,
      exitLabel,
      onExit,
      onSnapshot,
      initialDayTime = 60_000,
      initialHotbar,
      initialHotbarIndex = 0,
    } = props

    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const sceneRef = useRef<MinecraftScene | null>(null)
    const playerRef = useRef<McPlayerState>(
      mcCreatePlayerState({ x: initialPlayer.x, y: initialPlayer.y, z: initialPlayer.z }),
    )
    // 初始朝向 / 飞行只在挂载时生效一次
    const initializedRef = useRef(false)
    const keysRef = useRef(new Set<string>())
    const lastSpaceRef = useRef(0)
    const overlayRef = useRef<'none' | 'pause' | 'palette'>('none')
    const rafRef = useRef(0)
    const dayTimeRef = useRef(initialDayTime)
    const framesRef = useRef({ count: 0, lastStamp: 0, fps: 0 })
    const hotbarRef = useRef<number[]>(initialHotbar ?? MC_DEFAULT_HOTBAR)
    const hotbarIndexRef = useRef(initialHotbarIndex)
    const mouseHeldRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })
    const actionTimerRef = useRef<number | null>(null)
    const dirtyEditsRef = useRef(false)
    const touchRef = useRef({
      active: false,
      forward: 0,
      strafe: 0,
      jump: false,
      sneak: false,
      lastX: 0,
      lastY: 0,
    })
    /** 触屏连发定时器（挖 / 放长按） */
    const touchRepeatRef = useRef<number | null>(null)
    const isTouchDeviceRef = useRef(false)
    const remoteRef = useRef<McRemotePlayerView[]>(remotePlayers)

    const [overlay, setOverlay] = useState<'none' | 'pause' | 'palette'>('none')
    const [hotbar, setHotbar] = useState<number[]>(hotbarRef.current)
    const [hotbarIndex, setHotbarIndex] = useState(initialHotbarIndex)
    const [debug, setDebug] = useState(false)
    const [hud, setHud] = useState({ fps: 0, x: 0, y: 0, z: 0, facing: '北', flying: false, chunks: 0 })
    const [isTouch, setIsTouch] = useState(false)

    // 主循环 effect 依赖 [world] 不随 props 重跑：循环里读到的昼夜开关走 ref 镜像
    const dayEnabledRef = useRef(dayEnabled)

    const setOverlaySafe = useCallback((next: 'none' | 'pause' | 'palette') => {
      overlayRef.current = next
      setOverlay(next)
    }, [])

    const updateHotbar = useCallback((next: number[], nextIndex: number) => {
      hotbarRef.current = next
      hotbarIndexRef.current = nextIndex
      setHotbar(next)
      setHotbarIndex(nextIndex)
    }, [])

    // === 本地编辑（破坏 / 放置） ===

    const applyLocalEdit = useCallback(
      (x: number, y: number, z: number, block: number) => {
        mcSetBlock(world, x, y, z, block)
        sceneRef.current?.applyBlockEdit(x, y, z, block)
        onLocalEdit({ x, y, z, b: block })
        dirtyEditsRef.current = true
      },
      [world, onLocalEdit],
    )

    const raycastCenter = useCallback((): McRayHit | null => {
      const player = playerRef.current
      const dir = dirFromYawPitch(player.yaw, player.pitch)
      return mcRaycastVoxel(world, mcEyePosition(player), dir, MC_REACH, false)
    }, [world])

    const breakBlock = useCallback(() => {
      const hit = raycastCenter()
      if (!hit || !mcIsBreakable(hit.block)) return
      applyLocalEdit(hit.x, hit.y, hit.z, 0)
    }, [raycastCenter, applyLocalEdit])

    const placeBlock = useCallback(() => {
      const hit = raycastCenter()
      if (!hit) return
      const x = hit.x + hit.nx
      const y = hit.y + hit.ny
      const z = hit.z + hit.nz
      if (x < 0 || x >= MC_WORLD_SIZE || y < 0 || y >= MC_WORLD_HEIGHT || z < 0 || z >= MC_WORLD_SIZE) return
      const target = world.data[mcBlockIndex(x, y, z)]
      if (target !== 0 && target !== 10) return // 只能放进空气 / 水
      const block = hotbarRef.current[hotbarIndexRef.current]
      if (!mcIsPlaceable(block)) return
      const edit: McBlockEdit = { x, y, z, b: block }
      if (block !== 0 && mcEditIntersectsPlayer(edit, playerRef.current)) return
      applyLocalEdit(x, y, z, block)
    }, [raycastCenter, applyLocalEdit, world])

    // === 输入采集 ===

    useEffect(() => {
      // 触屏判定：粗指针（手机 / 平板）+ 多点触摸；带触摸屏的笔记本（pointer: fine）不算
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
      const multiTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
      isTouchDeviceRef.current = coarse && multiTouch
      setIsTouch(isTouchDeviceRef.current)
    }, [])

    /** 触屏长按连发（挖 / 放）：按下立即执行一次，随后每 250ms 重复，松开或开菜单即停 */
    const startTouchRepeat = useCallback(
      (action: () => void) => {
        if (overlayRef.current !== 'none') return
        action()
        if (touchRepeatRef.current !== null) window.clearInterval(touchRepeatRef.current)
        touchRepeatRef.current = window.setInterval(() => {
          if (overlayRef.current !== 'none') {
            if (touchRepeatRef.current !== null) {
              window.clearInterval(touchRepeatRef.current)
              touchRepeatRef.current = null
            }
            return
          }
          action()
        }, 250)
      },
      [],
    )

    const stopTouchRepeat = useCallback(() => {
      if (touchRepeatRef.current !== null) {
        window.clearInterval(touchRepeatRef.current)
        touchRepeatRef.current = null
      }
    }, [])

    // 卸载时清理连发定时器
    useEffect(() => stopTouchRepeat, [stopTouchRepeat])

    // 键盘
    useEffect(() => {
      const isInputActive = () => overlayRef.current === 'none'

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.code === 'F3') {
          event.preventDefault()
          setDebug((value) => !value)
          return
        }
        if (event.code === 'KeyE' && isInputActive()) {
          event.preventDefault()
          document.exitPointerLock?.()
          setOverlaySafe('palette')
          return
        }
        if (event.code === 'Escape' && overlayRef.current === 'palette') {
          setOverlaySafe('none')
          return
        }
        if (!isInputActive()) return
        if (event.code === 'Space') {
          event.preventDefault()
          const now = performance.now()
          if (now - lastSpaceRef.current < 300) {
            playerRef.current.flying = !playerRef.current.flying
            playerRef.current.vy = 0
            lastSpaceRef.current = 0
          } else {
            lastSpaceRef.current = now
          }
        }
        if (event.code.startsWith('Digit')) {
          const digit = Number.parseInt(event.code.slice(5), 10)
          if (digit >= 1 && digit <= HOTBAR_SIZE) updateHotbar(hotbarRef.current, digit - 1)
        }
        keysRef.current.add(event.code)
      }

      const onKeyUp = (event: KeyboardEvent) => {
        keysRef.current.delete(event.code)
      }

      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
      }
    }, [setOverlaySafe, updateHotbar])

    // 指针锁定 + 鼠标视角 + 按键挖掘 / 放置（桌面端）
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || isTouchDeviceRef.current) return

      const isLocked = () => document.pointerLockElement === canvas

      const onCanvasClick = () => {
        if (overlayRef.current === 'none' && !isLocked()) {
          canvas.requestPointerLock?.()
        }
      }

      const onPointerLockChange = () => {
        if (!isLocked()) {
          mouseHeldRef.current = { left: false, right: false }
          if (actionTimerRef.current !== null) {
            window.clearInterval(actionTimerRef.current)
            actionTimerRef.current = null
          }
          keysRef.current.clear()
          if (overlayRef.current === 'none') setOverlaySafe('pause')
        }
      }

      const onMouseMove = (event: MouseEvent) => {
        if (!isLocked()) return
        const player = playerRef.current
        // yaw 减小 = 向右转（forward = (−sin yaw, −cos yaw)，鼠标右移 movementX>0 应朝 +X 偏）
        player.yaw -= event.movementX * MOUSE_SENSITIVITY
        player.pitch = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, player.pitch - event.movementY * MOUSE_SENSITIVITY),
        )
      }

      const onMouseDown = (event: MouseEvent) => {
        if (!isLocked() || overlayRef.current !== 'none') return
        if (event.button === 0) {
          mouseHeldRef.current.left = true
          breakBlock()
          if (actionTimerRef.current === null) {
            actionTimerRef.current = window.setInterval(breakBlock, 250)
          }
        } else if (event.button === 2) {
          mouseHeldRef.current.right = true
          placeBlock()
          if (actionTimerRef.current === null) {
            actionTimerRef.current = window.setInterval(placeBlock, 250)
          }
        }
      }

      const onMouseUp = () => {
        mouseHeldRef.current = { left: false, right: false }
        if (actionTimerRef.current !== null) {
          window.clearInterval(actionTimerRef.current)
          actionTimerRef.current = null
        }
      }

      const onContextMenu = (event: Event) => event.preventDefault()

      const onWheel = (event: WheelEvent) => {
        if (!isLocked()) return
        event.preventDefault()
        const delta = event.deltaY > 0 ? 1 : -1
        const next = (hotbarIndexRef.current + delta + HOTBAR_SIZE) % HOTBAR_SIZE
        updateHotbar(hotbarRef.current, next)
      }

      canvas.addEventListener('click', onCanvasClick)
      document.addEventListener('pointerlockchange', onPointerLockChange)
      document.addEventListener('mousemove', onMouseMove)
      canvas.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mouseup', onMouseUp)
      canvas.addEventListener('contextmenu', onContextMenu)
      canvas.addEventListener('wheel', onWheel, { passive: false })
      return () => {
        canvas.removeEventListener('click', onCanvasClick)
        document.removeEventListener('pointerlockchange', onPointerLockChange)
        document.removeEventListener('mousemove', onMouseMove)
        canvas.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mouseup', onMouseUp)
        canvas.removeEventListener('contextmenu', onContextMenu)
        canvas.removeEventListener('wheel', onWheel)
      }
    }, [breakBlock, placeBlock, setOverlaySafe, updateHotbar])

    // 远端玩家列表同步进场景
    useEffect(() => {
      remoteRef.current = remotePlayers
      sceneRef.current?.setRemotePlayers(remotePlayers, selfUserId)
    }, [remotePlayers, selfUserId])

    // 昼夜开关（ref 镜像供主循环快照读取；场景同步与初始设置都在这里之后）
    useEffect(() => {
      dayEnabledRef.current = dayEnabled
      sceneRef.current?.setDayEnabled(dayEnabled)
    }, [dayEnabled])

    // === 主循环 ===

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (initializedRef.current) return
      initializedRef.current = true

      const scene = new MinecraftScene(canvas, world)
      scene.setDayEnabled(dayEnabled)
      scene.setRemotePlayers(remoteRef.current, selfUserId)
      sceneRef.current = scene

      const player = playerRef.current
      player.x = initialPlayer.x
      player.y = initialPlayer.y
      player.z = initialPlayer.z
      player.yaw = initialPlayer.yaw ?? 0
      player.pitch = initialPlayer.pitch ?? 0
      player.flying = initialPlayer.flying ?? false

      let last = performance.now()
      let hudAccumulator = 0
      let snapshotAccumulator = 0

      const collectInput = (): McPlayerInput => {
        if (overlayRef.current !== 'none') {
          return { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }
        }
        if (isTouchDeviceRef.current) {
          return {
            forward: touchRef.current.forward,
            strafe: touchRef.current.strafe,
            jump: touchRef.current.jump,
            sneak: touchRef.current.sneak || keysRef.current.has('ShiftLeft') || keysRef.current.has('ShiftRight'),
            sprint: false,
          }
        }
        const keys = keysRef.current
        const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
        const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
        return {
          forward,
          strafe,
          jump: keys.has('Space'),
          sneak: keys.has('ShiftLeft') || keys.has('ShiftRight'),
          sprint: keys.has('ControlLeft') || keys.has('ControlRight'),
        }
      }

      const loop = (now: number) => {
        rafRef.current = requestAnimationFrame(loop)
        const dt = Math.min((now - last) / 1000, 0.1)
        last = now

        // 单机暂停菜单冻结世界；联机永不停（输入归零即可）
        const physicsPaused = !isOnline && overlayRef.current === 'pause'
        if (!physicsPaused) {
          mcStepPlayer(world, player, collectInput(), dt)
          dayTimeRef.current = (dayTimeRef.current + dt * 1000) % MC_DAY_LENGTH_MS
        }

        scene.updateCamera(player.x, player.y + 1.62, player.z, player.yaw, player.pitch)
        scene.setSelection(overlayRef.current === 'none' ? raycastCenter() : null)
        scene.setUnderwater(player.eyeInWater)
        scene.tick(dt, dayTimeRef.current)
        scene.tickAvatars(dt)
        scene.render()

        // HUD / 快照节流
        framesRef.current.count += 1
        if (now - framesRef.current.lastStamp >= 500) {
          framesRef.current.fps = Math.round((framesRef.current.count * 1000) / (now - framesRef.current.lastStamp))
          framesRef.current.count = 0
          framesRef.current.lastStamp = now
        }
        hudAccumulator += dt
        if (hudAccumulator >= 0.25) {
          hudAccumulator = 0
          setHud({
            fps: framesRef.current.fps,
            x: player.x,
            y: player.y,
            z: player.z,
            facing: facingLabel(player.yaw),
            flying: player.flying,
            chunks: scene.pendingChunks,
          })
        }
        snapshotAccumulator += dt
        if (onSnapshot && snapshotAccumulator >= 5) {
          snapshotAccumulator = 0
          onSnapshot({
            player: { ...player },
            dayTime: dayTimeRef.current,
            dayEnabled: dayEnabledRef.current,
            hotbar: hotbarRef.current,
            hotbarIndex: hotbarIndexRef.current,
          })
        }
      }
      rafRef.current = requestAnimationFrame(loop)

      const onResize = () => scene.resize()
      window.addEventListener('resize', onResize)

      return () => {
        cancelAnimationFrame(rafRef.current)
        window.removeEventListener('resize', onResize)
        scene.dispose()
        sceneRef.current = null
        initializedRef.current = false
      }
      // 世界与初始状态在挂载期内不变（父组件换世界时会重建本组件），忽略深依赖
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [world])

    // ref 句柄
    useImperativeHandle(
      ref,
      () => ({
        applyRemoteEdits: (edits: McBlockEdit[]) => {
          const scene = sceneRef.current
          mcApplyEdits(world, edits)
          for (const edit of edits) {
            scene?.applyBlockEdit(edit.x, edit.y, edit.z, edit.b)
          }
        },
        getPlayerState: () => playerRef.current,
      }),
      [world],
    )

    // === 交互动作（菜单 / 物品栏 / 触屏） ===

    const resumeGame = useCallback(() => {
      setOverlaySafe('none')
      const canvas = canvasRef.current
      if (canvas && !isTouchDeviceRef.current) canvas.requestPointerLock?.()
    }, [setOverlaySafe])

    const closePalette = useCallback(
      (block: number) => {
        const next = hotbarRef.current.slice()
        next[hotbarIndexRef.current] = block
        updateHotbar(next, hotbarIndexRef.current)
        setOverlaySafe('none')
        const canvas = canvasRef.current
        if (canvas && !isTouchDeviceRef.current) canvas.requestPointerLock?.()
      },
      [setOverlaySafe, updateHotbar],
    )

    const selectHotbarSlot = useCallback(
      (index: number) => {
        updateHotbar(hotbarRef.current, index)
      },
      [updateHotbar],
    )

    // 触屏：左半虚拟摇杆 + 右半滑动视角 + 功能按钮
    const touchHandlers = {
      onJoystickDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        touchRef.current.active = true
      },
      onJoystickMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!touchRef.current.active) return
        const rect = event.currentTarget.getBoundingClientRect()
        const dx = event.clientX - (rect.left + rect.width / 2)
        const dy = event.clientY - (rect.top + rect.height / 2)
        const limit = Math.max(rect.width, rect.height) / 2
        touchRef.current.strafe = Math.max(-1, Math.min(1, dx / limit))
        touchRef.current.forward = Math.max(-1, Math.min(1, -dy / limit))
      },
      onJoystickUp: () => {
        touchRef.current.active = false
        touchRef.current.forward = 0
        touchRef.current.strafe = 0
      },
      onLookDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        touchRef.current.lastX = event.clientX
        touchRef.current.lastY = event.clientY
      },
      onLookMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const dx = event.clientX - touchRef.current.lastX
        const dy = event.clientY - touchRef.current.lastY
        touchRef.current.lastX = event.clientX
        touchRef.current.lastY = event.clientY
        // 与桌面鼠标同一约定：向右拖 = 向右转
        playerRef.current.yaw -= dx * TOUCH_SENSITIVITY
        playerRef.current.pitch = Math.max(
          -Math.PI / 2 + 0.01,
          Math.min(Math.PI / 2 - 0.01, playerRef.current.pitch - dy * TOUCH_SENSITIVITY),
        )
      },
      onJumpDown: () => {
        touchRef.current.jump = true
      },
      onJumpUp: () => {
        touchRef.current.jump = false
      },
      onSneakDown: () => {
        touchRef.current.sneak = true
      },
      onSneakUp: () => {
        touchRef.current.sneak = false
      },
      onFlyToggle: () => {
        playerRef.current.flying = !playerRef.current.flying
        playerRef.current.vy = 0
      },
      onBreakDown: () => startTouchRepeat(breakBlock),
      onPlaceDown: () => startTouchRepeat(placeBlock),
      onRepeatUp: stopTouchRepeat,
      onPalette: () => {
        stopTouchRepeat()
        setOverlaySafe('palette')
      },
    }

    return (
      <div className="gh-mc-stage">
        <canvas ref={canvasRef} className="gh-mc-canvas" />

        {/* 准星 */}
        <div className="gh-mc-crosshair" aria-hidden="true" />

        {/* 调试浮层（F3） */}
        {debug && (
          <div className="gh-mc-debug">
            <div>FPS {hud.fps}</div>
            <div>
              XYZ {hud.x.toFixed(1)} / {hud.y.toFixed(1)} / {hud.z.toFixed(1)}
            </div>
            <div>朝向 {hud.facing}{hud.flying ? ' · 飞行' : ''}</div>
            <div>待建区块 {hud.chunks}</div>
          </div>
        )}

        {/* 触屏控件 */}
        {isTouch && overlay === 'none' && (
          <>
            <div
              className="gh-mc-touch-joystick"
              onPointerDown={touchHandlers.onJoystickDown}
              onPointerMove={touchHandlers.onJoystickMove}
              onPointerUp={touchHandlers.onJoystickUp}
              onPointerCancel={touchHandlers.onJoystickUp}
            >
              <div className="gh-mc-touch-stick" />
            </div>
            <div
              className="gh-mc-touch-look"
              onPointerDown={touchHandlers.onLookDown}
              onPointerMove={touchHandlers.onLookMove}
            />
            <div className="gh-mc-touch-actions">
              <button type="button" className="gh-mc-touch-btn" onPointerDown={touchHandlers.onJumpDown} onPointerUp={touchHandlers.onJumpUp} onPointerLeave={touchHandlers.onJumpUp} onPointerCancel={touchHandlers.onJumpUp}>跳</button>
              <button type="button" className="gh-mc-touch-btn" onClick={touchHandlers.onFlyToggle}>飞</button>
              <button
                type="button"
                className="gh-mc-touch-btn"
                onPointerDown={touchHandlers.onBreakDown}
                onPointerUp={touchHandlers.onRepeatUp}
                onPointerLeave={touchHandlers.onRepeatUp}
                onPointerCancel={touchHandlers.onRepeatUp}
              >挖</button>
              <button
                type="button"
                className="gh-mc-touch-btn"
                onPointerDown={touchHandlers.onPlaceDown}
                onPointerUp={touchHandlers.onRepeatUp}
                onPointerLeave={touchHandlers.onRepeatUp}
                onPointerCancel={touchHandlers.onRepeatUp}
              >放</button>
              <button type="button" className="gh-mc-touch-btn" onPointerDown={touchHandlers.onSneakDown} onPointerUp={touchHandlers.onSneakUp} onPointerLeave={touchHandlers.onSneakUp} onPointerCancel={touchHandlers.onSneakUp} title="潜行 / 飞行下降">潜</button>
              <button type="button" className="gh-mc-touch-btn" onClick={touchHandlers.onPalette} title="方块物品栏">包</button>
              <button type="button" className="gh-mc-touch-btn gh-mc-touch-btn--wide" onClick={() => setOverlaySafe('pause')}>☰</button>
            </div>
          </>
        )}

        {/* 快捷栏 */}
        <div className="gh-mc-hotbar">
          {hotbar.map((block, index) => (
            <button
              key={index}
              type="button"
              className={`gh-mc-hotbar-slot${index === hotbarIndex ? ' gh-mc-hotbar-slot--active' : ''}`}
              onClick={() => selectHotbarSlot(index)}
              title={MC_BLOCK_NAMES[block] ?? '未知方块'}
            >
              {block !== 0 && <img src={mcTileIconUrl(mcBlockFaceTile(block, 2))} alt={MC_BLOCK_NAMES[block]} draggable={false} />}
              <span className="gh-mc-hotbar-num">{index + 1}</span>
            </button>
          ))}
        </div>

        {/* 物品栏（E） */}
        {overlay === 'palette' && (
          <div className="gh-mc-overlay" onClick={() => setOverlaySafe('none')}>
            <div className="gh-mc-palette" onClick={(event) => event.stopPropagation()}>
              <div className="gh-mc-palette-title">选择方块（放入第 {hotbarIndex + 1} 格）</div>
              <div className="gh-mc-palette-grid">
                {MC_PALETTE_BLOCKS.map((block) => (
                  <button
                    key={block}
                    type="button"
                    className="gh-mc-palette-item"
                    onClick={() => closePalette(block)}
                  >
                    <img src={mcTileIconUrl(mcBlockFaceTile(block, 2))} alt={MC_BLOCK_NAMES[block]} draggable={false} />
                    <span>{MC_BLOCK_NAMES[block]}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="gh-mc-palette-close" onClick={() => setOverlaySafe('none')}>
                关闭（E）
              </button>
            </div>
          </div>
        )}

        {/* 暂停菜单 */}
        {overlay === 'pause' && (
          <div className="gh-mc-overlay">
            <div className="gh-mc-pause">
              <div className="gh-mc-pause-title">游戏菜单</div>
              <button type="button" className="gh-mc-pause-btn gh-mc-pause-btn--primary" onClick={resumeGame}>
                回到游戏
              </button>
              {onDayEnabledChange && (
                <button type="button" className="gh-mc-pause-btn" onClick={() => onDayEnabledChange(!dayEnabled)}>
                  昼夜循环：{dayEnabled ? '开' : '关'}
                </button>
              )}
              <button type="button" className="gh-mc-pause-btn" onClick={() => setDebug((value) => !value)}>
                调试信息（F3）：{debug ? '开' : '关'}
              </button>
              <button type="button" className="gh-mc-pause-btn gh-mc-pause-btn--danger" onClick={onExit}>
                {exitLabel}
              </button>
              <div className="gh-mc-pause-help">
                WASD 移动 · 空格跳 / 双击空格飞行 · Shift 潜行 / 下降 · Ctrl 疾跑
                <br />
                左键挖掘 · 右键放置 · 滚轮 / 数字键切换快捷栏 · E 物品栏 · F3 调试
                <br />
                触屏：左下摇杆移动 · 右侧滑动视角 · 跳/飞/挖/放/潜/包（挖、放可长按连发）
              </div>
            </div>
          </div>
        )}
      </div>
    )
  },
)

export default MinecraftGameView
