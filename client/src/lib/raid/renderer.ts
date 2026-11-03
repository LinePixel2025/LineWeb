/**
 * 搜打撤实时战斗渲染器（Canvas 2D）。
 *
 * 口径：
 *   - 只渲染当前房间（元气骑士式房间相机），地图材质来自 lib/raid/mapArt.ts 的程序化纹理；
 *   - 特效 / 飘字 / 命中标记 / 队友幽灵都画在世界层，小地图与交互提示改由 DOM 浮层承载
 *     （`renderMinimap` 单独导出给 HUD 的小地图 canvas 用），避免和屏幕控件互相遮挡。
 */

import {
  RAID_EXTRACT_CHANNEL_MS,
  RAID_ITEM_MAP,
  RAID_TILE_DOOR,
  RAID_TILE_HAZARD,
  RAID_TILE_WALL,
  raidTileIndex,
  type RaidMapNode,
  type RaidRoomNode,
} from './raidRun'
import type { RaidEffect, RaidEngine, RaidFloatText, RaidTeammate } from './engine'
import { getMapArt, hashTile, drawProp, buildTextures, pickProp, type RaidMapArt } from './mapArt'

const SPECIES_COLORS: Record<string, { body: string; ear: string; accent: string }> = {
  cat: { body: '#f6c177', ear: '#e0883a', accent: '#fff7ed' },
  dog: { body: '#c99a6e', ear: '#9a6b45', accent: '#fff7ed' },
  bird: { body: '#7dd3fc', ear: '#38bdf8', accent: '#f0f9ff' },
  rabbit: { body: '#f5d0fe', ear: '#d8b4fe', accent: '#fdf4ff' },
  fox: { body: '#fb923c', ear: '#ea580c', accent: '#fff7ed' },
  panda: { body: '#e5e7eb', ear: '#4b5563', accent: '#f9fafb' },
}

const TEAMMATE_RING = ['#34d399', '#fbbf24', '#f472b6', '#60a5fa']

const RARITY_RING: Record<string, string> = {
  common: '#e5e7eb',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fb923c',
  mythic: '#f87171',
}

export interface RaidRenderMetrics {
  tile: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export interface RaidRenderOptions {
  /** 低性能模式：关掉光晕 / 粒子 / 环境浮尘，只保留可读性必需的元素 */
  lowPerf?: boolean
}

export function computeMetrics(
  map: RaidMapNode,
  room: RaidRoomNode | null,
  width: number,
  height: number,
): RaidRenderMetrics {
  const w = room?.w ?? 17
  const h = room?.h ?? 13
  const tile = Math.min(width / w, height / h)
  return {
    tile,
    offsetX: (width - tile * w) / 2 - (room?.x ?? 0) * tile,
    offsetY: (height - tile * h) / 2 - (room?.y ?? 0) * tile,
    width,
    height,
  }
}

function worldToScreen(metrics: RaidRenderMetrics, x: number, y: number): { x: number; y: number } {
  return {
    x: metrics.offsetX + x * metrics.tile,
    y: metrics.offsetY + y * metrics.tile,
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
  size: number,
): void {
  // 彩色 emoji 不受 fillStyle 影响；无彩色字体时退回可见的浅色单色字形
  ctx.fillStyle = '#f8fafc'
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, x, y)
}

function enemyEmoji(kind: string): string {
  if (kind === 'boss') return '👑'
  if (kind === 'elite') return '🦾'
  if (kind === 'scout') return '🥷'
  return '🪖'
}

/* ============================================================
   环境粒子（每个引擎实例一份，按主题参数生成）
   ============================================================ */

interface AmbientMote {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
}

interface AmbientState {
  artKey: string
  motes: AmbientMote[]
  last: number
}

const ambientRegistry = new WeakMap<RaidEngine, AmbientState>()

function updateAmbient(engine: RaidEngine, room: RaidRoomNode, art: RaidMapArt, now: number): AmbientMote[] {
  const count = art.ambient.count
  let state = ambientRegistry.get(engine)
  if (!state || state.artKey !== art.key || state.motes.length !== count) {
    const motes: AmbientMote[] = []
    for (let i = 0; i < count; i += 1) {
      motes.push({
        x: room.x + 1 + Math.random() * (room.w - 2),
        y: room.y + 1 + Math.random() * (room.h - 2),
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: 0.03 + Math.random() * 0.05,
        phase: Math.random() * Math.PI * 2,
      })
    }
    state = { artKey: art.key, motes, last: now }
    ambientRegistry.set(engine, state)
  }
  const dt = Math.min(0.1, Math.max(0, (now - state.last) / 1000))
  state.last = now
  for (const mote of state.motes) {
    const drift = art.ambient.speed * dt
    if (art.ambient.kind === 'drop' || art.ambient.kind === 'ash') {
      mote.y += drift * 3
      if (mote.y > room.y + room.h - 1) mote.y = room.y + 1
    } else if (art.ambient.kind === 'ember' || art.ambient.kind === 'spark') {
      mote.y -= drift * 2.4
      if (mote.y < room.y + 1) mote.y = room.y + room.h - 1
    } else {
      mote.x += mote.vx * drift
      mote.y += mote.vy * drift
    }
    mote.x = Math.min(room.x + room.w - 1, Math.max(room.x + 1, mote.x))
    mote.phase += dt
  }
  return state.motes
}

/* ============================================================
   主渲染
   ============================================================ */

export function renderRaid(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
  now: number,
  options: RaidRenderOptions = {},
): void {
  const lowPerf = Boolean(options.lowPerf)
  const room = engine.room
  const art = getMapArt(engine.map.key)
  const metrics = computeMetrics(engine.map, room, width, height)

  ctx.clearRect(0, 0, width, height)
  ctx.save()

  // 主题底：房间之外的空间用主题暗色 + 极淡的强调色渐变
  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, art.wallFace)
  bg.addColorStop(1, '#05070c')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  if (!room) {
    ctx.restore()
    return
  }

  // 屏幕震动：只在还有剩余时长时偏移
  if (!lowPerf && engine.shakeMs > 0) {
    const amp = engine.shakeAmp * metrics.tile * (engine.shakeMs / 220)
    ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp)
  }

  const tile = metrics.tile
  const textures = buildTextures(art, tile)
  const roomRect = {
    x: metrics.offsetX + room.x * tile,
    y: metrics.offsetY + room.y * tile,
    w: room.w * tile,
    h: room.h * tile,
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(roomRect.x, roomRect.y, roomRect.w, roomRect.h)
  ctx.clip()

  drawFloor(ctx, engine, room, art, metrics, textures, lowPerf, now)
  drawWalls(ctx, engine, room, art, metrics, textures, now)
  drawExtractBeacon(ctx, engine, metrics, art, now, lowPerf)
  drawContainers(ctx, engine, metrics, art, now, lowPerf)
  drawPickups(ctx, engine, metrics, now, lowPerf)
  if (!lowPerf) drawAmbient(ctx, engine, room, art, metrics, now)
  drawTeam( ctx, engine, metrics, now, lowPerf)
  drawEnemies(ctx, engine, metrics, art, now, lowPerf)
  drawBullets(ctx, engine, metrics, lowPerf)
  drawPlayer(ctx, engine, metrics, art, now, lowPerf)
  if (!lowPerf) {
    drawParticles(ctx, engine, metrics)
    drawEffects(ctx, engine.effects, metrics, now)
  }
  drawHitMarkers(ctx, engine, metrics)
  drawFloats(ctx, engine.floats, metrics)
  drawRoomLight(ctx, roomRect, art, metrics, engine, now, lowPerf)

  ctx.restore()

  // 屏幕后处理：暗角 + 受击红闪 + 低血脉动 + 撤离进度环
  drawVignette(ctx, width, height, art)
  drawScreenFlash(ctx, engine, width, height, now)
  drawHurtCompass(ctx, engine, width, height)

  ctx.restore()
}

/* ---------- 地面 ---------- */

function drawFloor(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  room: RaidRoomNode,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  textures: ReturnType<typeof buildTextures>,
  lowPerf: boolean,
  now: number,
): void {
  const tile = metrics.tile
  for (let ty = room.y + 1; ty < room.y + room.h - 1; ty += 1) {
    for (let tx = room.x + 1; tx < room.x + room.w - 1; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      const screen = worldToScreen(metrics, tx, ty)
      if (value === RAID_TILE_HAZARD) {
        const pulse = lowPerf ? 0.34 : 0.28 + 0.12 * Math.sin(now / 300 + tx * 1.7 + ty)
        ctx.fillStyle = art.hazard.base
        ctx.fillRect(screen.x, screen.y, tile, tile)
        ctx.strokeStyle = art.hazard.glow
        ctx.globalAlpha = pulse
        ctx.lineWidth = Math.max(1, tile * 0.06)
        ctx.beginPath()
        ctx.moveTo(screen.x + tile * 0.15, screen.y + tile * 0.82)
        ctx.lineTo(screen.x + tile * 0.85, screen.y + tile * 0.18)
        ctx.stroke()
        ctx.globalAlpha = 1
        continue
      }
      const source = (tx + ty) % 2 === 0 ? textures.floorA : textures.floorB
      ctx.drawImage(source, screen.x, screen.y, tile, tile)
      ctx.strokeStyle = art.grout
      ctx.lineWidth = 1
      ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, tile - 1, tile - 1)
      if (!lowPerf) {
        // 确定性污渍：同一张地图永远长在同一处，不会闪
        const stain = hashTile(engine.seed, tx, ty, 5)
        if (stain > 0.86) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
          ctx.beginPath()
          ctx.ellipse(screen.x + tile * 0.5, screen.y + tile * 0.55, tile * 0.3, tile * 0.16, stain * 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }

  if (lowPerf) return
  // 装饰物（放在敌人之下，避免挡住角色）
  for (let ty = room.y + 2; ty < room.y + room.h - 2; ty += 1) {
    for (let tx = room.x + 2; tx < room.x + room.w - 2; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      if (value !== 1) continue
      const prop = pickProp(art, engine.seed, room.id, tx, ty)
      if (!prop) continue
      const screen = worldToScreen(metrics, tx + 0.5, ty + 0.5)
      drawProp(ctx, prop.kind, screen.x, screen.y, tile, art, prop.variant, prop.scale, now)
    }
  }
}

/* ---------- 墙体与门 ---------- */

function drawWalls(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  room: RaidRoomNode,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  textures: ReturnType<typeof buildTextures>,
  now: number,
): void {
  const tile = metrics.tile
  for (let ty = room.y; ty < room.y + room.h; ty += 1) {
    for (let tx = room.x; tx < room.x + room.w; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      if (value !== RAID_TILE_WALL && value !== RAID_TILE_DOOR) continue
      const screen = worldToScreen(metrics, tx, ty)
      if (value === RAID_TILE_DOOR) {
        drawDoor(ctx, engine, screen, tile, art, now)
        continue
      }
      ctx.drawImage(textures.wall, screen.x, screen.y, tile, tile)
      // 只有朝房间内侧的墙才画压顶高光，否则整面墙会糊成一片
      const facesRoom =
        engine.map.tiles[raidTileIndex(engine.map.width, tx, ty - 1)] === 1 ||
        engine.map.tiles[raidTileIndex(engine.map.width, tx, ty + 1)] === 1 ||
        engine.map.tiles[raidTileIndex(engine.map.width, tx - 1, ty)] === 1 ||
        engine.map.tiles[raidTileIndex(engine.map.width, tx + 1, ty)] === 1
      if (facesRoom) {
        ctx.fillStyle = art.wallTop
        ctx.fillRect(screen.x, screen.y, tile, Math.max(2, tile * 0.2))
        ctx.fillStyle = art.wallEdge
        ctx.fillRect(screen.x, screen.y, tile, Math.max(1, tile * 0.06))
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
        if (engine.map.tiles[raidTileIndex(engine.map.width, tx, ty - 1)] === 1) {
          ctx.fillRect(screen.x, screen.y + tile - Math.max(1, tile * 0.08), tile, Math.max(1, tile * 0.08))
        }
      }
    }
  }
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  screen: { x: number; y: number },
  tile: number,
  art: RaidMapArt,
  now: number,
): void {
  const open = engine.roomCleared
  ctx.fillStyle = open ? 'rgba(12, 18, 30, 0.35)' : art.door.locked
  ctx.fillRect(screen.x, screen.y, tile, tile)
  ctx.strokeStyle = open ? art.door.open : art.door.frame
  ctx.lineWidth = Math.max(1.5, tile * 0.08)
  ctx.strokeRect(screen.x + tile * 0.14, screen.y + tile * 0.14, tile * 0.72, tile * 0.72)
  if (open) {
    // 解锁：流动的光闸，比一个「开」字更容易在激战中读到
    const sweep = (now / 900) % 1
    ctx.fillStyle = art.accentSoft
    ctx.fillRect(screen.x + tile * 0.14, screen.y + tile * 0.14 + sweep * tile * 0.6, tile * 0.72, tile * 0.1)
    ctx.strokeStyle = art.door.open
    ctx.beginPath()
    ctx.moveTo(screen.x + tile * 0.32, screen.y + tile * 0.62)
    ctx.lineTo(screen.x + tile * 0.5, screen.y + tile * 0.36)
    ctx.lineTo(screen.x + tile * 0.68, screen.y + tile * 0.62)
    ctx.stroke()
    return
  }
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = Math.max(1.5, tile * 0.09)
  ctx.beginPath()
  ctx.arc(screen.x + tile * 0.5, screen.y + tile * 0.44, tile * 0.13, Math.PI, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(screen.x + tile * 0.5, screen.y + tile * 0.44)
  ctx.lineTo(screen.x + tile * 0.5, screen.y + tile * 0.66)
  ctx.stroke()
}

/* ---------- 撤离点 ---------- */

function drawExtractBeacon(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  lowPerf: boolean,
): void {
  const extract = engine.extractPoint
  if (!extract) return
  const screen = worldToScreen(metrics, extract.x + 0.5, extract.y + 0.5)
  const tile = metrics.tile
  const pulse = lowPerf ? 1 : 1 + 0.1 * Math.sin(now / 260)
  const radius = tile * 1.15 * pulse

  if (!lowPerf) {
    const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius)
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.42)')
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  // 停机坪：同心圆 + 旋转箭头，一眼能认出「站这里撤离」
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)'
  ctx.lineWidth = Math.max(1.5, tile * 0.07)
  ctx.beginPath()
  ctx.arc(screen.x, screen.y, tile * 0.85, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(screen.x, screen.y, tile * 0.55, 0, Math.PI * 2)
  ctx.stroke()
  const spin = lowPerf ? 0 : now / 1400
  ctx.save()
  ctx.translate(screen.x, screen.y)
  ctx.rotate(spin)
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.9)'
  for (let i = 0; i < 4; i += 1) {
    ctx.rotate(Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, -tile * 0.62)
    ctx.lineTo(tile * 0.1, -tile * 0.76)
    ctx.lineTo(-tile * 0.1, -tile * 0.76)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.restore()
  drawEmoji(ctx, '🚁', screen.x, screen.y, tile * 0.7)
}

/* ---------- 容器 / 掉落 ---------- */

function drawContainers(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  lowPerf: boolean,
): void {
  const tile = metrics.tile
  for (const container of engine.containers) {
    const screen = worldToScreen(metrics, container.x, container.y)
    const size = tile * 0.78
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + size * 0.5, size * 0.5, size * 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = container.opened ? 'rgba(71, 85, 105, 0.55)' : '#3f3a2c'
    roundedRect(ctx, screen.x - size / 2, screen.y - size / 2, size, size, size * 0.16)
    ctx.fill()
    ctx.strokeStyle = container.opened ? 'rgba(148, 163, 184, 0.6)' : art.accent
    ctx.lineWidth = Math.max(1.5, size * 0.06)
    ctx.stroke()
    if (!container.opened && !lowPerf) {
      // 未搜索的容器呼吸发光，替代原来满屏的黄色方块
      const glow = 0.25 + 0.2 * Math.sin(now / 420 + container.x)
      ctx.strokeStyle = `rgba(250, 204, 21, ${glow})`
      ctx.lineWidth = Math.max(2, size * 0.1)
      roundedRect(ctx, screen.x - size * 0.62, screen.y - size * 0.62, size * 1.24, size * 1.24, size * 0.2)
      ctx.stroke()
    }
    drawEmoji(ctx, container.opened ? '📭' : '📦', screen.x, screen.y, size * 0.62)
  }
}

function drawPickups(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
  lowPerf: boolean,
): void {
  const tile = metrics.tile
  for (const pickup of engine.pickups) {
    const def = RAID_ITEM_MAP.get(pickup.itemKey)
    if (!def) continue
    const bob = lowPerf ? 0 : Math.sin(now / 320 + pickup.x * 3) * tile * 0.08
    const screen = worldToScreen(metrics, pickup.x, pickup.y)
    const color = RARITY_RING[def.rarity] ?? '#94a3b8'
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)'
    ctx.beginPath()
    ctx.arc(screen.x, screen.y - bob * 0.4, tile * 0.34, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, tile * 0.06)
    ctx.stroke()
    if (!lowPerf && (def.rarity === 'legendary' || def.rarity === 'mythic')) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 240)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y - bob * 0.4, tile * 0.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    drawEmoji(ctx, def.emoji, screen.x, screen.y - bob * 0.5, tile * 0.44)
  }
}

/* ---------- 角色：队友 / 敌人 / 自己 ---------- */

function drawTeam(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
  lowPerf: boolean,
): void {
  const tile = metrics.tile
  for (let index = 0; index < engine.teammates.length; index += 1) {
    const mate = engine.teammates[index] as RaidTeammate | undefined
    if (!mate || mate.roomId !== engine.roomId) continue
    if (mate.status !== 'active') continue
    const screen = worldToScreen(metrics, mate.x, mate.y)
    const colors = SPECIES_COLORS[mate.species] ?? SPECIES_COLORS.cat!
    const ring = TEAMMATE_RING[index % TEAMMATE_RING.length] ?? '#34d399'
    const radius = tile * 0.34

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + radius * 0.9, radius * 0.9, radius * 0.32, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.translate(screen.x, screen.y)
    ctx.rotate(mate.angle)
    ctx.beginPath()
    ctx.ellipse(0, 0, radius * 1.02, radius * 0.88, 0, 0, Math.PI * 2)
    ctx.fillStyle = colors.body
    ctx.globalAlpha = 0.92
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = ring
    ctx.lineWidth = Math.max(1.5, tile * 0.05)
    ctx.stroke()
    ctx.restore()
    if (!lowPerf) {
      const ping = 0.3 + 0.25 * Math.sin(now / 380 + index)
      ctx.strokeStyle = ring
      ctx.globalAlpha = ping
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * 1.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = 'rgba(226, 232, 240, 0.95)'
    ctx.font = `${Math.max(10, tile * 0.22)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(shortName(mate.name), screen.x, screen.y - radius * 1.7)
    // 队友血条：只画一条，够用于判断是否需要救援
    const barW = radius * 2
    const ratio = mate.maxHp > 0 ? Math.max(0, mate.hp / mate.maxHp) : 0
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
    ctx.fillRect(screen.x - barW / 2, screen.y + radius * 1.3, barW, Math.max(2, tile * 0.06))
    ctx.fillStyle = ratio > 0.5 ? ring : ratio > 0.25 ? '#fbbf24' : '#f87171'
    ctx.fillRect(screen.x - barW / 2, screen.y + radius * 1.3, barW * ratio, Math.max(2, tile * 0.06))
  }
}

function shortName(name: string): string {
  return name.length > 6 ? `${name.slice(0, 5)}…` : name
}

function drawEnemies(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  lowPerf: boolean,
): void {
  const tile = metrics.tile
  for (const enemy of engine.enemies) {
    if (enemy.dead) continue
    const screen = worldToScreen(metrics, enemy.x, enemy.y)
    const radius = Math.max(8, enemy.source.radius * tile)

    // 开火预警：远程单位蓄力时画一条到玩家的虚线 + 准星，玩家才来得及走位
    if (!lowPerf && enemy.telegraph > 0.05 && enemy.source.ranged) {
      const playerScreen = worldToScreen(metrics, engine.player.x, engine.player.y)
      ctx.save()
      ctx.globalAlpha = 0.18 + enemy.telegraph * 0.32
      ctx.strokeStyle = '#fca5a5'
      ctx.lineWidth = Math.max(1, tile * 0.03)
      ctx.setLineDash([tile * 0.2, tile * 0.2])
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(playerScreen.x, playerScreen.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(playerScreen.x, playerScreen.y, radius * (1.4 - enemy.telegraph), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + radius * 0.92, radius * 0.85, radius * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()

    // 首领落地光环，精英用一圈细边，普通怪不加装饰（同屏怪多时省性能）
    if (!lowPerf && (enemy.source.kind === 'boss' || enemy.source.kind === 'elite')) {
      const aura = 0.25 + 0.15 * Math.sin(now / 400 + enemy.source.level)
      ctx.strokeStyle = enemy.source.kind === 'boss' ? `rgba(251, 191, 36, ${aura})` : `rgba(249, 115, 22, ${aura})`
      ctx.lineWidth = Math.max(2, radius * 0.18)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * 1.35, 0, Math.PI * 2)
      ctx.stroke()
    }

    const lunge = enemy.lunge > 0 ? enemy.lunge / 0.26 : 0
    ctx.save()
    ctx.translate(screen.x, screen.y)
    if (lunge > 0) ctx.scale(1 + lunge * 0.18, 1 - lunge * 0.1)
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fillStyle = enemy.hitFlash > 0 ? 'rgba(254, 226, 226, 0.95)' : 'rgba(127, 29, 29, 0.6)'
    ctx.fill()
    ctx.strokeStyle = enemy.source.kind === 'boss' ? '#fbbf24' : '#f87171'
    ctx.lineWidth = Math.max(1.5, radius * 0.12)
    ctx.stroke()
    drawEmoji(ctx, enemyEmoji(enemy.source.kind), 0, 0, radius * 1.2)
    ctx.restore()

    const barW = radius * 2.3
    const ratio = Math.max(0, enemy.hp / enemy.maxHp)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(screen.x - barW / 2, screen.y - radius - tile * 0.3, barW, Math.max(3, tile * 0.07))
    ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#f87171'
    ctx.fillRect(screen.x - barW / 2, screen.y - radius - tile * 0.3, barW * ratio, Math.max(3, tile * 0.07))
    // 蓄力条叠在血条上，视觉上和血量共用一条宽度
    if (enemy.telegraph > 0.05) {
      ctx.fillStyle = art.accent
      ctx.globalAlpha = 0.55
      ctx.fillRect(screen.x - barW / 2, screen.y - radius - tile * 0.42, barW * enemy.telegraph, Math.max(2, tile * 0.045))
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)'
    ctx.font = `${Math.max(9, tile * 0.2)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(`${enemy.source.name} Lv.${enemy.source.level}`, screen.x, screen.y - radius - tile * 0.5)
  }
}

function drawBullets(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  lowPerf: boolean,
): void {
  const tile = metrics.tile
  for (const bullet of engine.bullets) {
    const screen = worldToScreen(metrics, bullet.x, bullet.y)
    const radius = Math.max(2, bullet.radius * tile)
    const speed = Math.hypot(bullet.vx, bullet.vy) || 1
    const tx = -bullet.vx / speed
    const ty = -bullet.vy / speed
    // 拖尾：按元素上色，比原来一个圆点亮得多
    if (!lowPerf) {
      const trail = ctx.createLinearGradient(screen.x, screen.y, screen.x + tx * radius * 6, screen.y + ty * radius * 6)
      trail.addColorStop(0, bullet.color)
      trail.addColorStop(1, 'rgba(15, 23, 42, 0)')
      ctx.strokeStyle = trail
      ctx.lineWidth = radius * 1.5
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(screen.x + tx * radius * 6, screen.y + ty * radius * 6)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = bullet.color
    if (!lowPerf) {
      ctx.shadowColor = bullet.color
      ctx.shadowBlur = 10
    }
    ctx.fill()
    ctx.shadowBlur = 0
    if (bullet.skill) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
      ctx.lineWidth = Math.max(1, radius * 0.4)
      ctx.stroke()
    }
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  lowPerf: boolean,
): void {
  const screen = worldToScreen(metrics, engine.player.x, engine.player.y)
  const tile = metrics.tile
  const colors = SPECIES_COLORS[engine.species] ?? SPECIES_COLORS.cat!
  const radius = tile * 0.36
  const angle = engine.player.angle
  const hpRatio = engine.maxHp > 0 ? engine.hp / engine.maxHp : 0

  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
  ctx.beginPath()
  ctx.ellipse(screen.x, screen.y + radius * 0.95, radius, radius * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()

  // 增伤光环：双层旋转刻痕
  if (engine.player.atkBuffUntil > now) {
    ctx.save()
    ctx.translate(screen.x, screen.y)
    ctx.rotate(now / 700)
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.85)'
    ctx.lineWidth = Math.max(1.5, tile * 0.05)
    ctx.beginPath()
    ctx.arc(0, 0, radius * 1.7, 0, Math.PI * 1.2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, radius * 1.7, Math.PI * 1.4, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  // 护盾：六边形晶格罩
  if (engine.player.shield > 0) {
    const shieldRatio = Math.min(1, engine.player.shield / Math.max(1, engine.maxHp * 0.3))
    ctx.save()
    ctx.translate(screen.x, screen.y)
    ctx.strokeStyle = `rgba(147, 197, 253, ${0.5 + shieldRatio * 0.45})`
    ctx.lineWidth = Math.max(2, tile * 0.06)
    ctx.beginPath()
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + now / 2600
      const x = Math.cos(a) * radius * 1.7
      const y = Math.sin(a) * radius * 1.7
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = 'rgba(96, 165, 250, 0.14)'
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.translate(screen.x, screen.y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.ellipse(0, 0, radius * 1.05, radius * 0.9, 0, 0, Math.PI * 2)
  ctx.fillStyle = colors.body
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)'
  ctx.lineWidth = Math.max(1.5, radius * 0.12)
  ctx.stroke()
  // 耳朵
  ctx.beginPath()
  ctx.moveTo(-radius * 0.55, -radius * 0.5)
  ctx.lineTo(-radius * 0.95, -radius * 1.35)
  ctx.lineTo(-radius * 0.1, -radius * 0.8)
  ctx.closePath()
  ctx.fillStyle = colors.ear
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(radius * 0.55, -radius * 0.5)
  ctx.lineTo(radius * 0.95, -radius * 1.35)
  ctx.lineTo(radius * 0.1, -radius * 0.8)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(radius * 0.42, -radius * 0.12, radius * 0.12, 0, Math.PI * 2)
  ctx.arc(radius * 0.42, radius * 0.22, radius * 0.12, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()
  // 枪管 + 枪口准星
  ctx.fillStyle = '#94a3b8'
  ctx.fillRect(radius * 0.8, -radius * 0.1, radius * 0.75, radius * 0.2)
  ctx.fillStyle = art.accent
  ctx.fillRect(radius * 1.42, -radius * 0.05, radius * 0.14, radius * 0.1)
  ctx.restore()

  // 低血时的角色描边泛红，比只读数字更直观
  if (hpRatio < 0.3 && !lowPerf) {
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.4 + 0.3 * Math.sin(now / 220)})`
    ctx.lineWidth = Math.max(2, tile * 0.06)
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius * 1.35, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(226, 232, 240, 0.95)'
  ctx.font = `${Math.max(10, tile * 0.22)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('你', screen.x, screen.y + radius * 2)
}

/* ---------- 特效 / 飘字 / 命中标记 ---------- */

function drawEffects(
  ctx: CanvasRenderingContext2D,
  effects: readonly RaidEffect[],
  metrics: RaidRenderMetrics,
  now: number,
): void {
  const tile = metrics.tile
  for (const effect of effects) {
    const t = Math.min(1, effect.age / effect.life)
    const fade = 1 - t
    const screen = worldToScreen(metrics, effect.x, effect.y)
    const radius = effect.radius * tile

    if (effect.kind === 'cast' || effect.kind === 'ring') {
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.age * 3)
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade * 0.9
      ctx.lineWidth = Math.max(1.5, tile * 0.05)
      ctx.beginPath()
      ctx.arc(0, 0, radius * (0.4 + t * 0.7), 0, Math.PI * 2)
      ctx.stroke()
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * radius * 0.42, Math.sin(a) * radius * 0.42)
        ctx.lineTo(Math.cos(a) * radius * 0.62, Math.sin(a) * radius * 0.62)
        ctx.stroke()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'cone') {
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.angle)
      const gradient = ctx.createLinearGradient(0, 0, radius, 0)
      gradient.addColorStop(0, effect.accent)
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = gradient
      ctx.globalAlpha = fade * 0.75
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, radius * (0.6 + t * 0.5), -0.45, 0.45)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'slash') {
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.angle)
      ctx.strokeStyle = effect.accent
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(2, tile * 0.1 * fade)
      ctx.beginPath()
      ctx.arc(0, 0, radius, -0.7, 0.7)
      ctx.stroke()
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'bolt') {
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(2, tile * 0.08)
      ctx.beginPath()
      const steps = 5
      for (let i = 0; i <= steps; i += 1) {
        const x = screen.x + (effect.tx - screen.x) * (i / steps) + (i === 0 || i === steps ? 0 : (Math.random() - 0.5) * tile * 0.5)
        const y = screen.y + (effect.ty - screen.y) * (i / steps) + (i === 0 || i === steps ? 0 : (Math.random() - 0.5) * tile * 0.5)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'mist') {
      ctx.globalAlpha = fade * 0.5
      ctx.fillStyle = effect.color
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + effect.age
        ctx.beginPath()
        ctx.arc(screen.x + Math.cos(a) * radius * t, screen.y + Math.sin(a) * radius * t, radius * 0.3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    } else if (effect.kind === 'aura' || effect.kind === 'shield') {
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(2, tile * 0.07)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * (1 - t * 0.35), 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = effect.accent
      ctx.globalAlpha = fade * 0.18
      ctx.fill()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'heal') {
      ctx.fillStyle = effect.color
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2
        const rise = t * radius
        ctx.globalAlpha = fade
        ctx.beginPath()
        ctx.arc(
          screen.x + Math.cos(a) * radius * 0.55,
          screen.y + Math.sin(a) * radius * 0.35 - rise,
          Math.max(1.5, tile * 0.06),
          0,
          Math.PI * 2,
        )
        ctx.fill()
      }
      ctx.globalAlpha = 1
    } else if (effect.kind === 'death') {
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(2, tile * 0.09 * fade)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * (0.3 + t), 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = effect.accent
      ctx.globalAlpha = fade * 0.28
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * (0.2 + t * 0.8), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'muzzle') {
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.angle)
      ctx.fillStyle = effect.color
      ctx.globalAlpha = fade
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(radius * 1.2, -radius * 0.45)
      ctx.lineTo(radius * 1.6, 0)
      ctx.lineTo(radius * 1.2, radius * 0.45)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'door' || effect.kind === 'pickup') {
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(1.5, tile * 0.06)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * (0.5 + t), 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
      if (effect.kind === 'pickup') {
        ctx.fillStyle = effect.accent
        ctx.globalAlpha = fade * 0.8
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, radius * 0.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
    } else {
      ctx.fillStyle = effect.color
      ctx.globalAlpha = fade
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, Math.max(1.5, radius * (1 - t)), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
): void {
  const tile = metrics.tile
  for (const particle of engine.particles) {
    const screen = worldToScreen(metrics, particle.x, particle.y)
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife)
    ctx.fillStyle = particle.color
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, Math.max(1, particle.size * tile), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawHitMarkers(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
): void {
  const tile = metrics.tile
  for (const marker of engine.hitMarkers) {
    const screen = worldToScreen(metrics, marker.x, marker.y)
    const t = marker.age / 0.32
    const len = tile * (marker.crit ? 0.3 : 0.2)
    const gap = tile * 0.14 + t * tile * 0.12
    ctx.strokeStyle = marker.crit ? '#fde68a' : '#f8fafc'
    ctx.globalAlpha = 1 - t
    ctx.lineWidth = Math.max(1.5, tile * (marker.crit ? 0.06 : 0.04))
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.PI / 4 + (i / 2) * Math.PI
      ctx.beginPath()
      ctx.moveTo(screen.x + Math.cos(angle) * gap, screen.y + Math.sin(angle) * gap)
      ctx.lineTo(screen.x + Math.cos(angle) * (gap + len), screen.y + Math.sin(angle) * (gap + len))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

function drawFloats(
  ctx: CanvasRenderingContext2D,
  floats: readonly RaidFloatText[],
  metrics: RaidRenderMetrics,
): void {
  const tile = metrics.tile
  for (const float of floats) {
    const t = float.age / float.life
    const screen = worldToScreen(metrics, float.x, float.y)
    const size = Math.max(11, tile * 0.26 * float.size)
    ctx.globalAlpha = 1 - t * t
    ctx.font = `700 ${size}px "Inter", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = Math.max(2, size * 0.16)
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)'
    ctx.strokeText(float.text, screen.x, screen.y - t * tile * 0.5)
    ctx.fillStyle = float.color
    ctx.fillText(float.text, screen.x, screen.y - t * tile * 0.5)
    ctx.globalAlpha = 1
  }
}

function drawAmbient(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  room: RaidRoomNode,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  now: number,
): void {
  const motes = updateAmbient(engine, room, art, now)
  const tile = metrics.tile
  ctx.fillStyle = art.ambient.color
  for (const mote of motes) {
    const screen = worldToScreen(metrics, mote.x, mote.y)
    const size = Math.max(1, mote.size * tile * (art.ambient.kind === 'spore' ? 1.4 : 1))
    ctx.globalAlpha = art.ambient.kind === 'mote'
      ? 0.3 + 0.25 * Math.sin(mote.phase * 2)
      : 0.55
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/* ---------- 光照 / 屏幕后处理 ---------- */

function drawRoomLight(
  ctx: CanvasRenderingContext2D,
  roomRect: { x: number; y: number; w: number; h: number },
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  engine: RaidEngine,
  now: number,
  lowPerf: boolean,
): void {
  const center = worldToScreen(metrics, engine.player.x, engine.player.y)
  const radius = Math.max(roomRect.w, roomRect.h) * 0.7
  // 以玩家为中心的战术手电：房间暗角由此产生，而不是全屏压黑
  const light = ctx.createRadialGradient(center.x, center.y, radius * 0.18, center.x, center.y, radius)
  light.addColorStop(0, 'rgba(0, 0, 0, 0)')
  light.addColorStop(0.55, `rgba(2, 6, 20, ${0.18 + art.vignette * 0.1})`)
  light.addColorStop(1, `rgba(2, 6, 20, ${0.42 + art.vignette * 0.4})`)
  ctx.fillStyle = light
  ctx.fillRect(roomRect.x, roomRect.y, roomRect.w, roomRect.h)
  if (!lowPerf) {
    ctx.fillStyle = art.light
    ctx.globalAlpha = 0.6 + 0.12 * Math.sin(now / 1600)
    ctx.fillRect(roomRect.x, roomRect.y, roomRect.w, roomRect.h)
    ctx.globalAlpha = 1
  }
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  art: RaidMapArt,
): void {
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.32,
    width / 2, height / 2, Math.min(width, height) * 0.82,
  )
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, `rgba(0, 0, 0, ${art.vignette})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

function drawScreenFlash(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
  now: number,
): void {
  if (engine.hurtFlash > 0) {
    const edge = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.2,
      width / 2, height / 2, Math.max(width, height) * 0.72,
    )
    edge.addColorStop(0, 'rgba(248, 113, 113, 0)')
    edge.addColorStop(1, `rgba(220, 38, 38, ${0.55 * engine.hurtFlash})`)
    ctx.fillStyle = edge
    ctx.fillRect(0, 0, width, height)
  }
  const hpRatio = engine.maxHp > 0 ? engine.hp / engine.maxHp : 1
  if (hpRatio < 0.25 && !engine.ended) {
    // 濒死：红色呼吸边光，提醒该喝药或撤
    const pulse = 0.12 + 0.1 * Math.sin(now / 320)
    const edge = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.34,
      width / 2, height / 2, Math.max(width, height) * 0.7,
    )
    edge.addColorStop(0, 'rgba(0, 0, 0, 0)')
    edge.addColorStop(1, `rgba(190, 18, 60, ${pulse})`)
    ctx.fillStyle = edge
    ctx.fillRect(0, 0, width, height)
  }
}

function drawHurtCompass(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
): void {
  if (engine.hurtDirs.length === 0) return
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.42
  for (const dir of engine.hurtDirs) {
    const alpha = Math.max(0, dir.age / 1.6) * 0.75
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(dir.angle)
    ctx.fillStyle = `rgba(248, 113, 113, ${alpha})`
    ctx.beginPath()
    ctx.moveTo(radius, 0)
    ctx.lineTo(radius - Math.min(28, radius * 0.12), -Math.min(16, radius * 0.07))
    ctx.lineTo(radius - Math.min(28, radius * 0.12), Math.min(16, radius * 0.07))
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

/* ============================================================
   小地图（DOM 浮层里的独立 canvas，位置由 CSS 控制，不再占用战斗画面）
   ============================================================ */

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  now: number,
  width: number,
  height: number,
): void {
  const art = getMapArt(engine.map.key)
  const map = engine.map
  // 竖屏会隐藏小地图浮层（rect 为 0），此时不画，否则格子算出负半径
  if (width < 40 || height < 40) return
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = art.minimap.bg
  ctx.fillRect(0, 0, width, height)

  const pad = 6
  const cellW = (width - pad * 2) / map.cols
  const cellH = (height - pad * 2) / map.rows
  const cell = Math.max(4, Math.min(cellW, cellH))
  const originX = (width - cell * map.cols) / 2
  const originY = (height - cell * map.rows) / 2

  ctx.strokeStyle = art.minimap.grid
  ctx.lineWidth = 1
  // 走廊：先把相邻房间连起来，形状才像「地图」而不是格子
  for (const room of map.rooms) {
    for (const neighbor of room.neighbors) {
      const other = map.rooms[neighbor]
      if (!other || other.id < room.id) continue
      ctx.beginPath()
      ctx.moveTo(originX + (room.col + 0.5) * cell, originY + (room.row + 0.5) * cell)
      ctx.lineTo(originX + (other.col + 0.5) * cell, originY + (other.row + 0.5) * cell)
      ctx.stroke()
    }
  }

  for (const room of map.rooms) {
    const x = originX + room.col * cell + cell * 0.14
    const y = originY + room.row * cell + cell * 0.14
    const size = cell * 0.72
    const isCurrent = room.id === engine.roomId
    const cleared = engine.clearedRooms.has(room.id)
    const base = room.kind === 'extract'
      ? '#38bdf8'
      : room.kind === 'boss'
        ? '#f87171'
        : room.kind === 'elite'
          ? '#fbbf24'
          : room.kind === 'loot'
            ? art.accent
            : room.kind === 'hazard'
              ? '#c084fc'
              : art.minimap.room
    ctx.fillStyle = base
    ctx.globalAlpha = isCurrent ? 1 : cleared ? 0.6 : 0.28
    ctx.fillRect(x, y, size, size)
    ctx.globalAlpha = 1
    if (isCurrent) {
      ctx.strokeStyle = art.minimap.current
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 1, y - 1, size + 2, size + 2)
      // 当前位置脉冲点
      ctx.fillStyle = art.minimap.current
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 320)
      ctx.beginPath()
      ctx.arc(x + size / 2, y + size / 2, Math.max(1.6, size * 0.16), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  // 撤离点标记
  for (const extract of map.extracts) {
    const room = map.rooms[extract.roomId]
    if (!room) continue
    const x = originX + room.col * cell + cell * 0.5
    const y = originY + room.row * cell + cell * 0.5
    ctx.strokeStyle = '#bae6fd'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.2, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 队友位置（同房间才有意义，但小地图上标房间即可）
  for (let index = 0; index < engine.teammates.length; index += 1) {
    const mate = engine.teammates[index]
    if (!mate || mate.status !== 'active') continue
    const room = map.rooms[mate.roomId]
    if (!room) continue
    ctx.fillStyle = TEAMMATE_RING[index % TEAMMATE_RING.length] ?? '#34d399'
    ctx.beginPath()
    ctx.arc(originX + room.col * cell + cell * 0.28, originY + room.row * cell + cell * 0.3, Math.max(1.6, cell * 0.1), 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 供测试 / 调试使用 */
export function tileScreenPosition(
  map: RaidMapNode,
  room: RaidRoomNode | null,
  width: number,
  height: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return worldToScreen(computeMetrics(map, room, width, height), x, y)
}
