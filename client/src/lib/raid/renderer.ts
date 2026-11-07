/**
 * 搜打撤实时战斗渲染器（Canvas 2D）。
 *
 * 性能口径（2026-11 重写）：
 *   - 地板 / 墙体 / 污渍 / 装饰物 / 背景整套静态场景按「房间 + 瓦片尺寸 + 门锁状态」
 *     缓存到离屏 canvas，每帧只 drawImage 一次；旧设备不再逐格重画 200+ 个图元。
 *   - 屏幕暗角、玩家手电、背景渐变全部缓存；每帧只做一次贴图。
 *   - emoji 字形缓存成小 canvas，避免每帧 fillText 触发字体栅格化（旧 WebView 很贵）。
 *   - quality: high / balanced / low。low 只减粒子、环境浮尘、屏幕震动，
 *     **技能特效和命中反馈始终保留**，低端机也能看清技能释放。
 *   - 不使用 shadowBlur / filter / roundRect 等旧 WebView 缺失或昂贵的特性。
 *
 * 视觉口径：只渲染当前房间；地面与墙体带体积感，门洞整段 3 格都画出口箭头
 * （引擎同步支持从任意一格换房），角色与敌人改为矢量绘制，不再依赖 emoji 字体。
 */

import {
  RAID_GEAR_MAP,
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

const SPECIES_COLORS: Record<string, { body: string; belly: string; ear: string; accent: string }> = {
  cat: { body: '#f0b35f', belly: '#ffe2b0', ear: '#d97a2b', accent: '#fff7ed' },
  dog: { body: '#b9855c', belly: '#e8c8a4', ear: '#8a5a38', accent: '#fff7ed' },
  bird: { body: '#62c7ef', belly: '#c7efff', ear: '#2f9fd0', accent: '#f0f9ff' },
  rabbit: { body: '#eec4fa', belly: '#fbe8ff', ear: '#cf9be8', accent: '#fdf4ff' },
  fox: { body: '#f07f2c', belly: '#ffd0a1', ear: '#c85a12', accent: '#fff7ed' },
  panda: { body: '#d9dde4', belly: '#f4f6f9', ear: '#3f4650', accent: '#f9fafb' },
}

/** 眼睛基色：和宠物页立绘保持同一套气质（熊猫单独走白眼球 + 黑瞳） */
const SPECIES_EYE: Record<string, string> = {
  cat: '#8a5316',
  dog: '#6b4423',
  bird: '#1f6f9c',
  rabbit: '#a4586f',
  fox: '#9a5626',
  panda: '#3a3a44',
}

/** 未知物种兜底：cat 的配色与轮廓 */
function normalizePetSpecies(raw: string): string {
  return raw in SPECIES_COLORS ? raw : 'cat'
}

function shadeColor(hex: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = parseInt(match[1] as string, 16)
  const target = amount >= 0 ? 255 : 0
  const ratio = Math.abs(amount)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  const mix = (channel: number): number => Math.round(channel + (target - channel) * ratio)
  return `#${[mix(r), mix(g), mix(b)].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
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

export type RaidRenderQuality = 'high' | 'balanced' | 'low'

export interface RaidRenderOptions {
  /** 低性能模式：兼容旧调用；等价于 quality: 'low' */
  lowPerf?: boolean
  quality?: RaidRenderQuality
  /** 设备像素比（缓存贴图按它生成，避免高 DPI 发虚） */
  dpr?: number
}

export function computeMetrics(
  map: RaidMapNode,
  room: RaidRoomNode | null,
  width: number,
  height: number,
): RaidRenderMetrics {
  const w = room?.w ?? 17
  const h = room?.h ?? 13
  const tile = Math.max(1, Math.min(width / w, height / h))
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

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  return { canvas, ctx }
}

function paletteFor(species: string): { body: string; belly: string; ear: string; accent: string } {
  return SPECIES_COLORS[species] ?? SPECIES_COLORS.cat!
}

/* ============================================================
   emoji 字形缓存：旧 WebView 每次 fillText 彩色 emoji 都很贵
   ============================================================ */

const emojiCache = new Map<string, HTMLCanvasElement>()

function emojiSprite(emoji: string, size: number, dpr: number): HTMLCanvasElement | null {
  const px = Math.max(8, Math.round(size))
  const ratio = Math.max(1, Math.min(3, dpr))
  const key = `${emoji}|${px}|${ratio}`
  const cached = emojiCache.get(key)
  if (cached) return cached
  const made = createCanvas(px * ratio, px * ratio)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.scale(ratio, ratio)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${px}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.fillStyle = '#f8fafc'
  ctx.fillText(emoji, px / 2, px / 2 + px * 0.04)
  if (emojiCache.size > 96) {
    const first = emojiCache.keys().next().value
    if (first) emojiCache.delete(first)
  }
  emojiCache.set(key, canvas)
  return canvas
}

function drawEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
  size: number,
  dpr: number,
): void {
  const sprite = emojiSprite(emoji, size, dpr)
  if (sprite) {
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size)
    return
  }
  // 极端兜底：离屏 canvas 创建失败时退回 fillText
  ctx.fillStyle = '#f8fafc'
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, x, y)
}

/* ============================================================
   静态场景缓存
   ============================================================ */

interface SceneCache {
  key: string
  canvas: HTMLCanvasElement
}

const sceneCache = new WeakMap<RaidEngine, SceneCache>()

interface OverlayCache {
  key: string
  canvas: HTMLCanvasElement | null
}

let lightCache: OverlayCache = { key: '', canvas: null }
let vignetteCache: OverlayCache = { key: '', canvas: null }

function buildVignette(width: number, height: number, art: RaidMapArt, dpr: number): HTMLCanvasElement | null {
  const made = createCanvas(width * dpr, height * dpr)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.scale(dpr, dpr)
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.34,
    width / 2, height / 2, Math.min(width, height) * 0.84,
  )
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(0.72, `rgba(2, 6, 18, ${art.vignette * 0.42})`)
  vignette.addColorStop(1, `rgba(2, 6, 18, ${art.vignette})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
  return canvas
}

function buildLight(radius: number, art: RaidMapArt, dpr: number): HTMLCanvasElement | null {
  const size = Math.max(32, radius * 2)
  const made = createCanvas(size * dpr, size * dpr)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.scale(dpr, dpr)
  const center = size / 2
  const light = ctx.createRadialGradient(center, center, radius * 0.2, center, center, radius)
  light.addColorStop(0, 'rgba(0, 0, 0, 0)')
  light.addColorStop(0.58, `rgba(2, 6, 20, ${0.16 + art.vignette * 0.1})`)
  light.addColorStop(1, `rgba(2, 6, 20, ${0.4 + art.vignette * 0.42})`)
  ctx.fillStyle = light
  ctx.fillRect(0, 0, size, size)
  return canvas
}

/* ============================================================
   环境粒子
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
   静态场景绘制（只在换房 / 尺寸变化时执行）
   ============================================================ */

function buildScene(
  engine: RaidEngine,
  room: RaidRoomNode,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  width: number,
  height: number,
  dpr: number,
  low: boolean,
): HTMLCanvasElement | null {
  const made = createCanvas(width * dpr, height * dpr)
  if (!made) return null
  const { canvas, ctx } = made
  ctx.scale(dpr, dpr)

  // 房间之外：主题暗色 + 斜向光带，避免纯黑显得未完成
  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, art.wallFace)
  bg.addColorStop(0.55, '#070b12')
  bg.addColorStop(1, '#04060a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = art.accent
  ctx.lineWidth = Math.max(20, width * 0.04)
  ctx.beginPath()
  ctx.moveTo(-width * 0.1, height * 0.85)
  ctx.lineTo(width * 1.1, -height * 0.2)
  ctx.stroke()
  ctx.restore()

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

  drawFloorStatic(ctx, engine, room, art, metrics, textures, low)
  // 先染色/徽标再画墙：日蚀要塞的室内隔断会自然遮住房间水印，不会出现文字压墙
  drawRoomTint(ctx, room, metrics)
  drawWallsStatic(ctx, engine, room, art, metrics, textures, low)

  ctx.restore()
  return canvas
}

/** 房间类型徽标（烙进静态场景缓存：大图标 + 文字，一眼可读） */
const ROOM_BADGES: Record<string, { glyph: string; label: string }> = {
  start: { glyph: '🏠', label: '起点' },
  combat: { glyph: '⚔️', label: '战斗区' },
  elite: { glyph: '🛡️', label: '精英区' },
  boss: { glyph: '👑', label: '首领房' },
  loot: { glyph: '📦', label: '物资房' },
  hazard: { glyph: '☢️', label: '危险区' },
  extract: { glyph: '🚁', label: '撤离区' },
}

/** 房间类型染色 + 墙脚内阴影 + 类型徽标：让战斗房、撤离区、首领房一眼可区分 */
function drawRoomTint(
  ctx: CanvasRenderingContext2D,
  room: RaidRoomNode,
  metrics: RaidRenderMetrics,
): void {
  const tile = metrics.tile
  const x = metrics.offsetX + (room.x + 1) * tile
  const y = metrics.offsetY + (room.y + 1) * tile
  const w = (room.w - 2) * tile
  const h = (room.h - 2) * tile
  const tint: Record<string, string> = {
    combat: 'rgba(248, 113, 113, 0.06)',
    elite: 'rgba(251, 146, 60, 0.08)',
    boss: 'rgba(248, 113, 113, 0.1)',
    loot: 'rgba(250, 204, 21, 0.07)',
    hazard: 'rgba(192, 132, 252, 0.08)',
    extract: 'rgba(56, 189, 248, 0.09)',
    start: 'rgba(148, 163, 184, 0.05)',
  }
  const color = tint[room.kind]
  if (color) {
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
  }
  // 房间类型徽标：大号半透明水印烙在地板上（随场景缓存，零逐帧成本）
  const badge = ROOM_BADGES[room.kind]
  if (badge && w > tile * 4 && h > tile * 3) {
    const cx = x + w / 2
    const cy = y + h / 2
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const glyphSize = Math.min(tile * 3.2, w * 0.34, h * 0.42)
    ctx.globalAlpha = 0.16
    ctx.font = `${glyphSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    ctx.fillText(badge.glyph, cx, cy - glyphSize * 0.18)
    ctx.globalAlpha = 0.3
    ctx.fillStyle = '#e2e8f0'
    ctx.font = `600 ${Math.max(11, tile * 0.52)}px "SF Pro SC", "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.fillText(badge.label, cx, cy + glyphSize * 0.52)
    ctx.restore()
    ctx.globalAlpha = 1
  }
  // 四面墙脚压暗，提升房间的体积感
  const depth = Math.min(tile * 1.4, w * 0.18, h * 0.22)
  const edges: Array<[number, number, number, number, number, number]> = [
    [x, y, x + w, y, 0, 0],
    [x, y + h, x + w, y + h, 0, 1],
    [x, y, x, y + h, 1, 0],
    [x + w, y, x + w, y + h, 1, 0],
  ]
  for (const [x0, y0, x1, y1] of edges) {
    const vertical = x0 === x1
    const gradient = vertical
      ? ctx.createLinearGradient(x0 === x ? x : x - depth, 0, x0 === x ? x + depth : x, 0)
      : ctx.createLinearGradient(0, y0 === y ? y : y - depth, 0, y0 === y ? y + depth : y)
    const inner = vertical
      ? (x0 === x ? 0 : 1)
      : (y0 === y ? 0 : 1)
    gradient.addColorStop(inner, 'rgba(0, 0, 0, 0.34)')
    gradient.addColorStop(1 - inner, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    if (vertical) ctx.fillRect(x0 === x ? x : x - depth, y, depth, h)
    else ctx.fillRect(x, y0 === y ? y : y - depth, w, depth)
  }
}

function drawFloorStatic(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  room: RaidRoomNode,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  textures: ReturnType<typeof buildTextures>,
  low: boolean,
): void {
  const tile = metrics.tile
  // 房间底：先铺一层暗色，砖缝之外不会露出背景光带
  const roomBase = worldToScreen(metrics, room.x, room.y)
  ctx.fillStyle = '#070b12'
  ctx.fillRect(roomBase.x, roomBase.y, room.w * tile, room.h * tile)

  for (let ty = room.y + 1; ty < room.y + room.h - 1; ty += 1) {
    for (let tx = room.x + 1; tx < room.x + room.w - 1; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      const screen = worldToScreen(metrics, tx, ty)
      if (value === RAID_TILE_HAZARD) {
        ctx.fillStyle = art.hazard.base
        ctx.fillRect(screen.x, screen.y, tile, tile)
        ctx.strokeStyle = art.hazard.glow
        ctx.globalAlpha = 0.42
        ctx.lineWidth = Math.max(1, tile * 0.07)
        for (let i = -1; i <= 1; i += 1) {
          ctx.beginPath()
          ctx.moveTo(screen.x + tile * (0.08 + i * 0.3), screen.y + tile * 0.9)
          ctx.lineTo(screen.x + tile * (0.58 + i * 0.3), screen.y + tile * 0.1)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        continue
      }
      const source = (tx + ty) % 2 === 0 ? textures.floorA : textures.floorB
      ctx.drawImage(source, screen.x, screen.y, tile, tile)
      // 砖缝 + 内侧高光：静态缓存里做，不占每帧预算
      ctx.strokeStyle = art.grout
      ctx.lineWidth = 1
      ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, tile - 1, tile - 1)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
      ctx.fillRect(screen.x + 1, screen.y + 1, tile - 2, Math.max(1, tile * 0.06))
      if (!low) {
        const stain = hashTile(engine.seed, tx, ty, 5)
        if (stain > 0.82) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
          ctx.beginPath()
          ctx.ellipse(screen.x + tile * 0.5, screen.y + tile * 0.55, tile * 0.32, tile * 0.16, stain * 3, 0, Math.PI * 2)
          ctx.fill()
        } else if (stain < 0.08) {
          // 少量发光地缝：让地面不是一整片死色
          ctx.strokeStyle = art.accentSoft
          ctx.lineWidth = Math.max(1, tile * 0.035)
          ctx.beginPath()
          ctx.moveTo(screen.x + tile * 0.2, screen.y + tile * 0.75)
          ctx.lineTo(screen.x + tile * 0.45, screen.y + tile * 0.42)
          ctx.lineTo(screen.x + tile * 0.72, screen.y + tile * 0.62)
          ctx.stroke()
        }
      }
    }
  }

  // 装饰物进静态缓存：低画质也保留，只在换房时画一次，不占每帧预算
  for (let ty = room.y + 2; ty < room.y + room.h - 2; ty += 1) {
    for (let tx = room.x + 2; tx < room.x + room.w - 2; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      if (value !== 1) continue
      const prop = pickProp(art, engine.seed, room.id, tx, ty)
      if (!prop) continue
      const screen = worldToScreen(metrics, tx + 0.5, ty + 0.5)
      // 静态帧时间固定，装饰物不闪烁
      drawProp(ctx, prop.kind, screen.x, screen.y, tile, art, prop.variant, prop.scale, 0)
    }
  }
}

function drawWallsStatic(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  room: RaidRoomNode,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  textures: ReturnType<typeof buildTextures>,
  low: boolean,
): void {
  const tile = metrics.tile
  for (let ty = room.y; ty < room.y + room.h; ty += 1) {
    for (let tx = room.x; tx < room.x + room.w; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      if (value !== RAID_TILE_WALL) continue
      const screen = worldToScreen(metrics, tx, ty)
      ctx.drawImage(textures.wall, screen.x, screen.y, tile, tile)

      const inner =
        engine.map.tiles[raidTileIndex(engine.map.width, tx, ty - 1)] === 1 ||
        engine.map.tiles[raidTileIndex(engine.map.width, tx, ty + 1)] === 1 ||
        engine.map.tiles[raidTileIndex(engine.map.width, tx - 1, ty)] === 1 ||
        engine.map.tiles[raidTileIndex(engine.map.width, tx + 1, ty)] === 1
      if (!inner) continue
      // 立体墙：顶部亮边 + 底部阴影 + 内侧竖向接缝
      ctx.fillStyle = art.wallTop
      ctx.fillRect(screen.x, screen.y, tile, Math.max(2, tile * 0.24))
      ctx.fillStyle = art.wallEdge
      ctx.fillRect(screen.x, screen.y, tile, Math.max(1, tile * 0.055))
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
      ctx.fillRect(screen.x, screen.y + tile - Math.max(1, tile * 0.1), tile, Math.max(1, tile * 0.1))
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.fillRect(screen.x + tile - Math.max(1, tile * 0.05), screen.y, Math.max(1, tile * 0.05), tile)
      if (!low) {
        // 铆钉 / 螺栓：每块墙最多 2 颗，静态缓存不心疼
        const rivet = hashTile(engine.seed, tx, ty, 23)
        if (rivet > 0.55) {
          ctx.fillStyle = art.wallEdge
          ctx.globalAlpha = 0.55
          const r = Math.max(1, tile * 0.035)
          ctx.beginPath()
          ctx.arc(screen.x + tile * 0.18, screen.y + tile * 0.52, r, 0, Math.PI * 2)
          ctx.arc(screen.x + tile * 0.82, screen.y + tile * 0.52, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }
  }
  // 门框（门扇开合动画由动态层画）
  for (let ty = room.y; ty < room.y + room.h; ty += 1) {
    for (let tx = room.x; tx < room.x + room.w; tx += 1) {
      if (engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)] !== RAID_TILE_DOOR) continue
      const screen = worldToScreen(metrics, tx, ty)
      ctx.fillStyle = 'rgba(2, 6, 18, 0.55)'
      ctx.fillRect(screen.x, screen.y, tile, tile)
      ctx.strokeStyle = art.door.frame
      ctx.lineWidth = Math.max(2, tile * 0.1)
      ctx.strokeRect(screen.x + tile * 0.12, screen.y + tile * 0.12, tile * 0.76, tile * 0.76)
    }
  }
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
  const quality: RaidRenderQuality = options.quality ?? (options.lowPerf ? 'low' : 'high')
  const low = quality === 'low'
  const dpr = Math.max(1, Math.min(3, options.dpr ?? 1))
  const room = engine.room
  const art = getMapArt(engine.map.key)
  const metrics = computeMetrics(engine.map, room, width, height)

  if (!room) {
    ctx.clearRect(0, 0, width, height)
    return
  }

  // —— 静态场景：key 命中时整屏一次 drawImage ——
  const sceneKey = `${art.key}|${room.id}|${Math.round(metrics.tile * 2)}|${engine.roomCleared ? 1 : 0}|${low ? 0 : 1}|${Math.round(dpr * 100)}|${Math.round(width)}x${Math.round(height)}`
  let scene = sceneCache.get(engine)
  if (!scene || scene.key !== sceneKey) {
    const canvas = buildScene(engine, room, art, metrics, width, height, dpr, low)
    if (canvas) {
      scene = { key: sceneKey, canvas }
      sceneCache.set(engine, scene)
    } else {
      scene = undefined
    }
  }
  ctx.clearRect(0, 0, width, height)
  if (scene) {
    ctx.drawImage(scene.canvas, 0, 0, width, height)
  } else {
    // 极端兜底：离屏 canvas 不可用时直接画地面与墙体
    const textures = buildTextures(art, metrics.tile)
    drawFloorStatic(ctx, engine, room, art, metrics, textures, low)
    drawWallsStatic(ctx, engine, room, art, metrics, textures, low)
  }

  const roomRect = {
    x: metrics.offsetX + room.x * metrics.tile,
    y: metrics.offsetY + room.y * metrics.tile,
    w: room.w * metrics.tile,
    h: room.h * metrics.tile,
  }

  ctx.save()
  // 屏幕震动：低画质关闭，避免旧设备持续重绘整屏
  if (!low && engine.shakeMs > 0) {
    const amp = engine.shakeAmp * metrics.tile * (engine.shakeMs / 220)
    ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp)
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(roomRect.x, roomRect.y, roomRect.w, roomRect.h)
  ctx.clip()

  drawDoors(ctx, engine, art, metrics, now, low)
  // 出口箭头即使低画质也保留：这是玩家能不能继续推进的关键信息
  drawExitGuides(ctx, engine, art, metrics, now, low)
  drawExtractBeacon(ctx, engine, metrics, art, now, low, dpr)
  drawBarrageScorches(ctx, engine, metrics, now, low)
  drawBarrageWarning(ctx, engine, metrics, art, now, low)
  drawContainers(ctx, engine, metrics, art, now, low, dpr)
  drawPickups(ctx, engine, metrics, now, low, dpr)
  drawGroundLoot(ctx, engine, metrics, now, low, dpr)
  if (!low) drawAmbient(ctx, engine, room, art, metrics, now)
  drawTeam(ctx, engine, metrics, now, low)
  drawEnemies(ctx, engine, metrics, art, now, low)
  drawBullets(ctx, engine, metrics, low)
  drawAimReticle(ctx, engine, metrics, art)
  drawPlayer(ctx, engine, metrics, art, now, low, dpr)
  drawEffects(ctx, engine.effects, metrics, now, low)
  if (!low) drawParticles(ctx, engine, metrics)
  drawHitMarkers(ctx, engine, metrics)
  drawFloats(ctx, engine.floats, metrics)
  drawSkillBanner(ctx, engine, metrics)
  drawRoomLight(ctx, roomRect, art, metrics, engine, now, low, dpr)

  ctx.restore()
  ctx.restore()

  // —— 屏幕后处理：缓存暗角 + 受击红闪 + 低血脉动 + 技能染色 ——
  drawVignette(ctx, width, height, art, dpr)
  drawScreenFlash(ctx, engine, width, height, now)
  drawHurtCompass(ctx, engine, width, height)
  drawSkillFlash(ctx, engine, width, height)
}

/* ---------- 门 / 出口 ---------- */

function drawDoors(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
): void {
  const room = engine.room
  if (!room) return
  const tile = metrics.tile
  const open = engine.roomCleared
  for (let ty = room.y; ty < room.y + room.h; ty += 1) {
    for (let tx = room.x; tx < room.x + room.w; tx += 1) {
      if (engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)] !== RAID_TILE_DOOR) continue
      const screen = worldToScreen(metrics, tx, ty)
      if (open) {
        // 解锁：门扇打开，留下流动光闸
        ctx.fillStyle = 'rgba(12, 18, 30, 0.18)'
        ctx.fillRect(screen.x + tile * 0.1, screen.y + tile * 0.1, tile * 0.8, tile * 0.8)
        const sweep = low ? 0.5 : (now / 900) % 1
        ctx.fillStyle = art.accentSoft
        ctx.fillRect(screen.x + tile * 0.12, screen.y + tile * 0.12 + sweep * tile * 0.6, tile * 0.76, tile * 0.1)
        ctx.fillStyle = art.door.open
        ctx.beginPath()
        ctx.moveTo(screen.x + tile * 0.24, screen.y + tile * 0.24)
        ctx.lineTo(screen.x + tile * 0.4, screen.y + tile * 0.24)
        ctx.lineTo(screen.x + tile * 0.4, screen.y + tile * 0.76)
        ctx.lineTo(screen.x + tile * 0.24, screen.y + tile * 0.76)
        ctx.closePath()
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(screen.x + tile * 0.76, screen.y + tile * 0.24)
        ctx.lineTo(screen.x + tile * 0.6, screen.y + tile * 0.24)
        ctx.lineTo(screen.x + tile * 0.6, screen.y + tile * 0.76)
        ctx.lineTo(screen.x + tile * 0.76, screen.y + tile * 0.76)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.fillStyle = art.door.locked
        ctx.fillRect(screen.x + tile * 0.14, screen.y + tile * 0.14, tile * 0.72, tile * 0.72)
        ctx.strokeStyle = art.door.frame
        ctx.lineWidth = Math.max(1.5, tile * 0.06)
        ctx.strokeRect(screen.x + tile * 0.2, screen.y + tile * 0.2, tile * 0.6, tile * 0.6)
        // 锁扣
        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = Math.max(1.5, tile * 0.08)
        ctx.beginPath()
        ctx.arc(screen.x + tile * 0.5, screen.y + tile * 0.46, tile * 0.12, Math.PI, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(screen.x + tile * 0.5, screen.y + tile * 0.46)
        ctx.lineTo(screen.x + tile * 0.5, screen.y + tile * 0.64)
        ctx.stroke()
      }
    }
  }
}

interface ExitGuide {
  x: number
  y: number
  dx: number
  dy: number
}

/** 当前房间所有可通行出口（门洞 3 格都算），引擎支持从任意一格换房 */
function roomExits(engine: RaidEngine): ExitGuide[] {
  const room = engine.room
  if (!room) return []
  const out: ExitGuide[] = []
  for (const door of engine.map.doors) {
    // 每扇门在两侧房间各有一个端点；只取落在当前房间矩形内的那个
    if (door.x < room.x || door.x >= room.x + room.w || door.y < room.y || door.y >= room.y + room.h) continue
    const targetId = door.roomA === room.id ? door.roomB : door.roomB === room.id ? door.roomA : null
    if (targetId === null) continue
    const target = engine.map.rooms[targetId]
    if (!target) continue
    const dx = Math.sign(target.col - room.col)
    const dy = Math.sign(target.row - room.row)
    if (dx !== 0) {
      for (let offset = -1; offset <= 1; offset += 1) {
        out.push({ x: door.x, y: door.y + offset, dx, dy: 0 })
      }
    } else if (dy !== 0) {
      for (let offset = -1; offset <= 1; offset += 1) {
        out.push({ x: door.x + offset, y: door.y, dx: 0, dy })
      }
    }
  }
  return out
}

function drawExitGuides(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  art: RaidMapArt,
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
): void {
  const exits = roomExits(engine)
  if (exits.length === 0) return
  const tile = metrics.tile
  const open = engine.roomCleared
  const pulse = low ? 0.8 : 0.55 + 0.35 * Math.sin(now / 380)
  for (const exit of exits) {
    const screen = worldToScreen(metrics, exit.x + 0.5, exit.y + 0.5)
    ctx.save()
    ctx.translate(screen.x, screen.y)
    ctx.rotate(Math.atan2(exit.dy, exit.dx))
    ctx.fillStyle = open ? art.door.open : 'rgba(148, 163, 184, 0.4)'
    ctx.globalAlpha = open ? pulse : 0.42
    for (let i = 0; i < 2; i += 1) {
      const shift = open && !low ? ((now / 700 + i * 0.5) % 1) * tile * 0.14 : 0
      ctx.beginPath()
      ctx.moveTo(-tile * 0.14 + shift, -tile * 0.16)
      ctx.lineTo(tile * 0.06 + shift, 0)
      ctx.lineTo(-tile * 0.14 + shift, tile * 0.16)
      ctx.lineTo(-tile * 0.05 + shift, 0)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    if (open) {
      ctx.strokeStyle = art.door.open
      ctx.globalAlpha = pulse * 0.5
      ctx.lineWidth = Math.max(1, tile * 0.04)
      ctx.strokeRect(screen.x - tile * 0.42, screen.y - tile * 0.42, tile * 0.84, tile * 0.84)
      ctx.globalAlpha = 1
    }
  }
}

/* ---------- 撤离点 ---------- */

function drawExtractBeacon(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  low: boolean,
  dpr: number,
): void {
  const extract = engine.extractPoint
  if (!extract) return
  const screen = worldToScreen(metrics, extract.x + 0.5, extract.y + 0.5)
  const tile = metrics.tile
  const pulse = low ? 1 : 1 + 0.08 * Math.sin(now / 260)
  const radius = tile * 1.2 * pulse

  if (!low) {
    const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius)
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.45)')
    gradient.addColorStop(0.55, 'rgba(56, 189, 248, 0.16)')
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)'
  ctx.lineWidth = Math.max(1.5, tile * 0.07)
  ctx.beginPath()
  ctx.arc(screen.x, screen.y, tile * 0.9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(screen.x, screen.y, tile * 0.58, 0, Math.PI * 2)
  ctx.stroke()
  // 四向箭头
  const spin = low ? 0 : now / 1400
  ctx.save()
  ctx.translate(screen.x, screen.y)
  ctx.rotate(spin)
  ctx.fillStyle = 'rgba(224, 242, 254, 0.9)'
  for (let i = 0; i < 4; i += 1) {
    ctx.rotate(Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, -tile * 0.72)
    ctx.lineTo(tile * 0.12, -tile * 0.56)
    ctx.lineTo(-tile * 0.12, -tile * 0.56)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  drawEmoji(ctx, '🚁', screen.x, screen.y, tile * 0.62, dpr)
  // 停机坪 H 标识
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.55)'
  ctx.lineWidth = Math.max(1.5, tile * 0.055)
  ctx.beginPath()
  ctx.moveTo(screen.x - tile * 0.34, screen.y - tile * 0.26)
  ctx.lineTo(screen.x - tile * 0.34, screen.y + tile * 0.26)
  ctx.moveTo(screen.x + tile * 0.34, screen.y - tile * 0.26)
  ctx.lineTo(screen.x + tile * 0.34, screen.y + tile * 0.26)
  ctx.moveTo(screen.x - tile * 0.34, screen.y)
  ctx.lineTo(screen.x + tile * 0.34, screen.y)
  ctx.stroke()
}

/* ---------- 轨道炮火：焦痕 + 锁定预警 ---------- */

function drawBarrageScorches(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
): void {
  if (engine.barrageScorches.length === 0) return
  const tile = metrics.tile
  for (const scorch of engine.barrageScorches) {
    if (scorch.roomId !== engine.roomId) continue
    const age = (now - scorch.at) / 12000
    if (age >= 1) continue
    const screen = worldToScreen(metrics, scorch.x, scorch.y)
    ctx.save()
    ctx.globalAlpha = (1 - age) * 0.5
    ctx.fillStyle = '#1c1917'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y, tile * 0.62, tile * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
    if (!low) {
      ctx.globalAlpha = (1 - age) * 0.35
      ctx.strokeStyle = '#f97316'
      ctx.lineWidth = Math.max(1, tile * 0.035)
      ctx.beginPath()
      ctx.ellipse(screen.x, screen.y, tile * 0.5, tile * 0.3, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawBarrageWarning(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  low: boolean,
): void {
  const warning = engine.barrageWarning
  if (!warning || warning.roomId !== engine.roomId) return
  const tile = metrics.tile
  const progress = Math.max(0, Math.min(1, (now - warning.startedAt) / Math.max(1, warning.endsAt - warning.startedAt)))
  const pulse = low ? 0.8 : 0.55 + 0.35 * Math.sin(now / 120)
  warning.shells.forEach((shell, index) => {
    const screen = worldToScreen(metrics, shell.x, shell.y)
    const radius = warning.radius * tile
    ctx.save()
    ctx.translate(screen.x, screen.y)
    ctx.globalAlpha = 0.14 + progress * 0.3
    ctx.fillStyle = index === 0 ? '#ef4444' : '#f97316'
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = index === 0 ? '#fca5a5' : '#fdba74'
    ctx.lineWidth = Math.max(1.5, tile * (index === 0 ? 0.08 : 0.05))
    ctx.setLineDash([tile * 0.24, tile * 0.18])
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    // 收缩读条：外圈实线走完即炮击
    ctx.globalAlpha = pulse
    ctx.strokeStyle = art.accent
    ctx.lineWidth = Math.max(2, tile * 0.09)
    ctx.beginPath()
    ctx.arc(0, 0, radius * (1 - progress * 0.18), -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
    ctx.stroke()
    // 十字准星
    ctx.globalAlpha = 0.75
    ctx.strokeStyle = '#fecaca'
    ctx.lineWidth = Math.max(1, tile * 0.04)
    for (const angle of [0, Math.PI / 2]) {
      ctx.beginPath()
      ctx.moveTo(Math.cos(angle) * radius * 0.18, Math.sin(angle) * radius * 0.18)
      ctx.lineTo(Math.cos(angle) * radius * 0.86, Math.sin(angle) * radius * 0.86)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-Math.cos(angle) * radius * 0.18, -Math.sin(angle) * radius * 0.18)
      ctx.lineTo(-Math.cos(angle) * radius * 0.86, -Math.sin(angle) * radius * 0.86)
      ctx.stroke()
    }
    if (index === 0 && radius > tile * 0.9) {
      ctx.globalAlpha = 0.9
      ctx.fillStyle = '#fecaca'
      ctx.font = `700 ${Math.max(10, tile * 0.32)}px "Inter", "PingFang SC", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('轨道锁定', 0, -radius - tile * 0.2)
    }
    ctx.restore()
  })
}

/* ---------- 容器 / 掉落 ---------- */

function drawContainers(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  low: boolean,
  dpr: number,
): void {
  const tile = metrics.tile
  for (const container of engine.containers) {
    const screen = worldToScreen(metrics, container.x, container.y)
    const size = tile * 0.8
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + size * 0.5, size * 0.52, size * 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
    if (!container.opened && !low) {
      const glow = 0.22 + 0.18 * Math.sin(now / 420 + container.x)
      ctx.strokeStyle = `rgba(250, 204, 21, ${glow})`
      ctx.lineWidth = Math.max(2, size * 0.1)
      roundedRect(ctx, screen.x - size * 0.62, screen.y - size * 0.62, size * 1.24, size * 1.24, size * 0.2)
      ctx.stroke()
    }
    // 箱体：顶盖 + 箱身 + 锁扣
    const w = size
    const h = size * 0.82
    const top = screen.y - h / 2
    const left = screen.x - w / 2
    ctx.fillStyle = container.opened ? 'rgba(51, 65, 85, 0.62)' : '#4a3d28'
    roundedRect(ctx, left, top, w, h, size * 0.12)
    ctx.fill()
    ctx.strokeStyle = container.opened ? 'rgba(148, 163, 184, 0.55)' : art.accent
    ctx.lineWidth = Math.max(1.5, size * 0.05)
    ctx.stroke()
    ctx.fillStyle = container.opened ? 'rgba(30, 41, 59, 0.8)' : '#5f4d31'
    ctx.fillRect(left + w * 0.08, top + h * 0.26, w * 0.84, Math.max(2, h * 0.1))
    ctx.fillRect(left + w * 0.08, top + h * 0.58, w * 0.84, Math.max(2, h * 0.1))
    ctx.fillStyle = container.opened ? '#94a3b8' : '#facc15'
    ctx.fillRect(screen.x - size * 0.06, top + h * 0.3, size * 0.12, h * 0.24)
    drawEmoji(ctx, container.opened ? '📭' : '📦', screen.x, screen.y, size * 0.5, dpr)
  }
}

function drawPickups(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
  dpr: number,
): void {
  const tile = metrics.tile
  for (const pickup of engine.pickups) {
    const def = RAID_ITEM_MAP.get(pickup.itemKey)
    if (!def) continue
    const bob = low ? 0 : Math.sin(now / 320 + pickup.x * 3) * tile * 0.08
    const screen = worldToScreen(metrics, pickup.x, pickup.y)
    const color = RARITY_RING[def.rarity] ?? '#94a3b8'
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)'
    ctx.beginPath()
    ctx.arc(screen.x, screen.y - bob * 0.4, tile * 0.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, tile * 0.06)
    ctx.stroke()
    if (!low && (def.rarity === 'legendary' || def.rarity === 'mythic')) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.28 + 0.22 * Math.sin(now / 240)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y - bob * 0.4, tile * 0.52, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    drawEmoji(ctx, def.emoji, screen.x, screen.y - bob * 0.5, tile * 0.42, dpr)
  }
}

/** 丢弃在地面的物品（自己 / 队友丢的，走过自动捡起）：虚线圈区别于容器掉落实线圈 */
function drawGroundLoot(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
  dpr: number,
): void {
  const tile = metrics.tile
  for (const item of engine.groundLoot) {
    if (item.roomId !== engine.roomId) continue
    const def = RAID_ITEM_MAP.get(item.itemKey)
    if (!def) continue
    const bob = low ? 0 : Math.sin(now / 360 + item.x * 2.6) * tile * 0.07
    const screen = worldToScreen(metrics, item.x, item.y)
    const color = RARITY_RING[def.rarity] ?? '#94a3b8'
    ctx.fillStyle = 'rgba(15, 23, 42, 0.66)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + tile * 0.2, tile * 0.3, tile * 0.12, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, tile * 0.05)
    ctx.setLineDash([tile * 0.14, tile * 0.1])
    ctx.beginPath()
    ctx.arc(screen.x, screen.y - bob * 0.4, tile * 0.34, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    drawEmoji(ctx, def.emoji, screen.x, screen.y - bob * 0.5, tile * 0.4, dpr)
  }
}

/* ---------- 角色：队友 / 敌人 / 自己 ---------- */

function drawTeam(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
): void {
  const tile = metrics.tile
  for (let index = 0; index < engine.teammates.length; index += 1) {
    const mate = engine.teammates[index] as RaidTeammate | undefined
    if (!mate || mate.roomId !== engine.roomId) continue
    if (mate.status !== 'active') continue
    const screen = worldToScreen(metrics, mate.x, mate.y)
    const colors = paletteFor(mate.species)
    const ring = TEAMMATE_RING[index % TEAMMATE_RING.length] ?? '#34d399'
    const radius = tile * 0.34

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + radius * 0.95, radius * 0.9, radius * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()
    drawPetBody(ctx, screen.x, screen.y, radius, mate.angle, colors, ring, {
      species: mate.species,
      moving: true,
      stepPhase: now / 95 + index * 1.7,
      now,
      low,
    })
    if (!low) {
      const ping = 0.3 + 0.25 * Math.sin(now / 380 + index)
      ctx.strokeStyle = ring
      ctx.globalAlpha = ping
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * 1.55, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = 'rgba(226, 232, 240, 0.95)'
    ctx.font = `600 ${Math.max(10, tile * 0.2)}px "Inter", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(shortName(mate.name), screen.x, screen.y - radius * 1.9)
    const barW = radius * 2
    const ratio = mate.maxHp > 0 ? Math.max(0, mate.hp / mate.maxHp) : 0
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(screen.x - barW / 2, screen.y + radius * 1.35, barW, Math.max(2, tile * 0.07))
    ctx.fillStyle = ring
    ctx.fillRect(screen.x - barW / 2, screen.y + radius * 1.35, barW * ratio, Math.max(2, tile * 0.07))
  }
}

function shortName(name: string): string {
  return name.length > 6 ? `${name.slice(0, 5)}…` : name
}

/** 宠物局内模型参数：物种 / 装备 / 行走相位 / 后坐力 / 画质 */
interface RaidPetDrawOptions {
  species: string
  gear?: RaidEngine['gear'] | null
  moving?: boolean
  stepPhase?: number
  recoil?: number
  now: number
  low: boolean
  alpha?: number
}

const PET_OUTLINE = 'rgba(15, 23, 42, 0.62)'

function petStroke(radius: number): number {
  return Math.max(1, radius * 0.09)
}

function gearTint(key: string | null | undefined): string {
  const def = key ? RAID_GEAR_MAP.get(key) : null
  return def ? RARITY_RING[def.rarity] ?? '#94a3b8' : '#94a3b8'
}

function drawPetEars(
  ctx: CanvasRenderingContext2D,
  species: string,
  radius: number,
  colors: { body: string; belly: string; ear: string; accent: string },
  headX: number,
  twitch: number,
): void {
  const dark = shadeColor(colors.ear, -0.18)
  const inner = shadeColor(colors.ear, 0.42)
  const stroke = petStroke(radius)
  for (const side of [-1, 1] as const) {
    const baseY = side * radius * 0.42
    if (species === 'dog') {
      ctx.save()
      ctx.translate(headX - radius * 0.16, baseY + twitch * side * 0.4)
      ctx.rotate(side * 0.38)
      ctx.beginPath()
      ctx.ellipse(0, 0, radius * 0.17, radius * 0.31, 0, 0, Math.PI * 2)
      ctx.fillStyle = dark
      ctx.fill()
      ctx.strokeStyle = PET_OUTLINE
      ctx.lineWidth = stroke
      ctx.stroke()
      ctx.restore()
      continue
    }
    if (species === 'rabbit') {
      ctx.save()
      ctx.translate(headX - radius * 0.08, baseY)
      ctx.rotate(side * 0.16)
      ctx.beginPath()
      ctx.ellipse(0, 0, radius * 0.13, radius * 0.38, 0, 0, Math.PI * 2)
      ctx.fillStyle = colors.body
      ctx.fill()
      ctx.strokeStyle = PET_OUTLINE
      ctx.lineWidth = stroke
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse(0, 0, radius * 0.06, radius * 0.28, 0, 0, Math.PI * 2)
      ctx.fillStyle = inner
      ctx.fill()
      ctx.restore()
      continue
    }
    if (species === 'panda') {
      ctx.beginPath()
      ctx.arc(headX - radius * 0.08, baseY, radius * 0.2, 0, Math.PI * 2)
      ctx.fillStyle = dark
      ctx.fill()
      ctx.strokeStyle = PET_OUTLINE
      ctx.lineWidth = stroke
      ctx.stroke()
      continue
    }
    if (species === 'bird') continue
    // 猫 / 狐：尖耳；狐耳更大、耳尖压深
    const big = species === 'fox' ? 1.22 : 1.08
    ctx.beginPath()
    ctx.moveTo(headX - radius * 0.24, baseY * 0.72)
    ctx.lineTo(headX - radius * 0.04, baseY + side * radius * 0.5 * big)
    ctx.lineTo(headX + radius * 0.24, baseY * 0.82)
    ctx.closePath()
    ctx.fillStyle = colors.body
    ctx.fill()
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = stroke
    ctx.stroke()
    if (species === 'fox') {
      // 狐耳深色耳尖
      ctx.beginPath()
      ctx.moveTo(headX - radius * 0.16, baseY * 0.72)
      ctx.lineTo(headX - radius * 0.06, baseY + side * radius * 0.48 * big)
      ctx.lineTo(headX + radius * 0.04, baseY * 0.8)
      ctx.closePath()
      ctx.fillStyle = dark
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(headX - radius * 0.16, baseY * 0.82)
    ctx.lineTo(headX - radius * 0.04, baseY + side * radius * 0.32 * big)
    ctx.lineTo(headX + radius * 0.13, baseY * 0.9)
    ctx.closePath()
    ctx.fillStyle = inner
    ctx.globalAlpha = 0.85
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function drawPetTail(
  ctx: CanvasRenderingContext2D,
  species: string,
  radius: number,
  colors: { body: string; belly: string; ear: string; accent: string },
  swing: number,
): void {
  const dark = shadeColor(colors.ear, -0.12)
  const stroke = Math.max(1.4, radius * 0.14)
  ctx.lineCap = 'round'
  if (species === 'fox') {
    ctx.beginPath()
    ctx.moveTo(-radius * 0.72, radius * 0.05)
    ctx.quadraticCurveTo(
      -radius * 1.5,
      radius * (0.28 + swing),
      -radius * 1.25,
      -radius * (0.48 - swing),
    )
    ctx.quadraticCurveTo(-radius * 0.95, -radius * 0.2, -radius * 0.72, radius * 0.05)
    ctx.closePath()
    ctx.fillStyle = dark
    ctx.fill()
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = petStroke(radius)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(-radius * 1.24, -radius * (0.42 - swing), radius * 0.2, radius * 0.28, 0.5, 0, Math.PI * 2)
    ctx.fillStyle = colors.accent
    ctx.fill()
    return
  }
  if (species === 'rabbit') {
    ctx.beginPath()
    ctx.arc(-radius * 0.95, radius * 0.05 + swing * radius * 0.2, radius * 0.19, 0, Math.PI * 2)
    ctx.fillStyle = colors.belly
    ctx.fill()
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = petStroke(radius)
    ctx.stroke()
    return
  }
  if (species === 'bird') {
    ctx.beginPath()
    ctx.moveTo(-radius * 0.72, -radius * 0.06)
    ctx.lineTo(-radius * 1.35, -radius * (0.4 + swing * 0.5))
    ctx.lineTo(-radius * 1.18, radius * 0.02)
    ctx.lineTo(-radius * 1.35, radius * (0.36 + swing * 0.5))
    ctx.closePath()
    ctx.fillStyle = shadeColor(colors.body, -0.12)
    ctx.fill()
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = petStroke(radius)
    ctx.stroke()
    return
  }
  // 猫 / 狗 / 熊猫：圆润或上翘的尾巴
  ctx.strokeStyle = species === 'panda' ? shadeColor(colors.ear, -0.05) : colors.ear
  ctx.lineWidth = stroke
  ctx.beginPath()
  ctx.moveTo(-radius * 0.72, radius * 0.02)
  if (species === 'dog') {
    ctx.quadraticCurveTo(-radius * 1.22, -radius * (0.18 + swing), -radius * 1.08, -radius * 0.55)
  } else if (species === 'panda') {
    ctx.quadraticCurveTo(-radius * 1.15, radius * 0.1, -radius * 1.05, radius * (0.3 + swing))
  } else {
    ctx.quadraticCurveTo(-radius * 1.3, radius * (0.18 + swing), -radius * 1.18, -radius * 0.42)
  }
  ctx.stroke()
  if (species === 'cat') {
    // 环纹
    ctx.strokeStyle = dark
    ctx.lineWidth = Math.max(1, radius * 0.06)
    ctx.beginPath()
    ctx.arc(-radius * 1.05, -radius * 0.1, radius * 0.16, -1.9, -0.4)
    ctx.stroke()
  }
}

function drawPetMarkings(
  ctx: CanvasRenderingContext2D,
  species: string,
  radius: number,
  colors: { body: string; belly: string; ear: string; accent: string },
): void {
  const dark = shadeColor(colors.body, -0.24)
  if (species === 'cat') {
    ctx.strokeStyle = shadeColor(colors.ear, -0.12)
    ctx.lineWidth = Math.max(1, radius * 0.06)
    ctx.lineCap = 'round'
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath()
      ctx.moveTo(-radius * (0.42 - i * 0.2), -radius * 0.5)
      ctx.lineTo(-radius * (0.32 - i * 0.2), -radius * 0.2)
      ctx.stroke()
    }
  } else if (species === 'dog') {
    ctx.fillStyle = shadeColor(colors.ear, 0.05)
    ctx.beginPath()
    ctx.ellipse(-radius * 0.25, radius * 0.32, radius * 0.16, radius * 0.1, -0.4, 0, Math.PI * 2)
    ctx.fill()
  } else if (species === 'panda') {
    ctx.fillStyle = colors.ear
    ctx.beginPath()
    ctx.ellipse(-radius * 0.1, -radius * 0.45, radius * 0.28, radius * 0.16, 0.2, 0, Math.PI * 2)
    ctx.ellipse(-radius * 0.1, radius * 0.45, radius * 0.28, radius * 0.16, -0.2, 0, Math.PI * 2)
    ctx.fill()
  } else if (species === 'fox') {
    ctx.fillStyle = colors.accent
    ctx.beginPath()
    ctx.ellipse(radius * 0.1, radius * 0.12, radius * 0.45, radius * 0.34, 0, 0, Math.PI * 2)
    ctx.globalAlpha = 0.9
    ctx.fill()
    ctx.globalAlpha = 1
  } else if (species === 'bird') {
    ctx.fillStyle = shadeColor(colors.body, -0.16)
    ctx.beginPath()
    ctx.ellipse(-radius * 0.18, -radius * 0.42, radius * 0.34, radius * 0.17, -0.5, 0, Math.PI * 2)
    ctx.ellipse(-radius * 0.18, radius * 0.42, radius * 0.34, radius * 0.17, 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.2)'
  ctx.lineWidth = Math.max(1, radius * 0.04)
  ctx.beginPath()
  ctx.ellipse(-radius * 0.5, radius * 0.2, radius * 0.3, radius * 0.1, 0.2, 0, Math.PI)
  ctx.stroke()
  void dark
}

function drawPetFace(
  ctx: CanvasRenderingContext2D,
  species: string,
  radius: number,
  colors: { body: string; belly: string; ear: string; accent: string },
  headX: number,
  blink: boolean,
  low: boolean,
): void {
  const eyeColor = SPECIES_EYE[species] ?? '#3f4650'
  const stroke = petStroke(radius)
  // 面部浅色区（狐 / 狗 / 熊猫 / 兔）
  if (species === 'fox') {
    ctx.beginPath()
    ctx.moveTo(headX + radius * 0.02, -radius * 0.38)
    ctx.quadraticCurveTo(headX + radius * 0.58, -radius * 0.12, headX + radius * 0.02, radius * 0.38)
    ctx.quadraticCurveTo(headX - radius * 0.16, 0, headX + radius * 0.02, -radius * 0.38)
    ctx.closePath()
    ctx.fillStyle = '#fffaf2'
    ctx.fill()
  } else if (species === 'dog') {
    ctx.beginPath()
    ctx.ellipse(headX + radius * 0.34, 0, radius * 0.25, radius * 0.19, 0, 0, Math.PI * 2)
    ctx.fillStyle = colors.belly
    ctx.fill()
  } else if (species === 'panda') {
    ctx.fillStyle = '#1f2937'
    ctx.beginPath()
    ctx.ellipse(headX + radius * 0.04, -radius * 0.22, radius * 0.17, radius * 0.21, -0.2, 0, Math.PI * 2)
    ctx.ellipse(headX + radius * 0.04, radius * 0.22, radius * 0.17, radius * 0.21, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  // 眼睛（放回头部中段，避免被伸出的枪遮住）
  for (const side of [-1, 1] as const) {
    const ex = headX + radius * 0.14
    const ey = side * radius * 0.22
    if (blink) {
      ctx.strokeStyle = '#1f2937'
      ctx.lineWidth = Math.max(1, radius * 0.045)
      ctx.beginPath()
      ctx.moveTo(ex - radius * 0.07, ey)
      ctx.lineTo(ex + radius * 0.07, ey)
      ctx.stroke()
      continue
    }
    ctx.beginPath()
    ctx.arc(ex, ey, radius * 0.105, 0, Math.PI * 2)
    ctx.fillStyle = species === 'panda' ? '#fffdf9' : eyeColor
    ctx.fill()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)'
    ctx.lineWidth = Math.max(1, radius * 0.025)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(ex + radius * 0.012, ey, radius * 0.055, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()
    if (!low) {
      ctx.beginPath()
      ctx.arc(ex + radius * 0.035, ey - radius * 0.035, radius * 0.022, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fill()
    }
  }
  // 口鼻 / 喙
  if (species === 'bird') {
    ctx.beginPath()
    ctx.moveTo(headX + radius * 0.48, -radius * 0.08)
    ctx.lineTo(headX + radius * 0.7, 0)
    ctx.lineTo(headX + radius * 0.48, radius * 0.08)
    ctx.closePath()
    ctx.fillStyle = '#e79a2c'
    ctx.fill()
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = Math.max(1, radius * 0.035)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(headX + radius * 0.48, -radius * 0.045)
    ctx.lineTo(headX + radius * 0.57, radius * 0.02)
    ctx.lineTo(headX + radius * 0.48, radius * 0.07)
    ctx.closePath()
    ctx.fillStyle = species === 'panda' ? '#1f2937' : shadeColor(colors.ear, -0.25)
    ctx.fill()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)'
    ctx.lineWidth = Math.max(1, radius * 0.02)
    ctx.stroke()
  }
  if (species === 'rabbit') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = Math.max(1, radius * 0.04)
    ctx.beginPath()
    ctx.moveTo(headX + radius * 0.52, radius * 0.07)
    ctx.lineTo(headX + radius * 0.52, radius * 0.16)
    ctx.stroke()
  }
  if (species === 'cat' || species === 'fox') {
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)'
    ctx.lineWidth = Math.max(0.8, radius * 0.022)
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath()
        ctx.moveTo(headX + radius * 0.52, side * radius * 0.1)
        ctx.lineTo(headX + radius * (0.78 + i * 0.03), side * radius * (0.18 + i * 0.08))
        ctx.stroke()
      }
    }
  }
  void stroke
}

function drawPetGear(
  ctx: CanvasRenderingContext2D,
  radius: number,
  gear: RaidEngine['gear'] | null | undefined,
  headX: number,
  low: boolean,
  layer: 'back' | 'body' | 'head',
): void {
  if (!gear) return
  const stroke = petStroke(radius)
  const backpack = gear.backpack ? RAID_GEAR_MAP.get(gear.backpack) : null
  if (layer === 'back' && backpack) {
    const tier = Math.min(8, Math.max(1, backpack.tier))
    const packW = radius * (0.5 + tier * 0.045)
    const packH = radius * (0.5 + tier * 0.04)
    roundedRect(ctx, -radius * 0.95 - packW * 0.42, -packH * 0.5, packW, packH, radius * 0.16)
    ctx.fillStyle = gearTint(backpack.key)
    ctx.globalAlpha = 0.92
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = stroke
    ctx.stroke()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.32)'
    ctx.lineWidth = Math.max(1, radius * 0.04)
    ctx.beginPath()
    ctx.moveTo(-radius * 0.95 - packW * 0.3, -packH * 0.5)
    ctx.lineTo(-radius * 0.95 - packW * 0.3, packH * 0.5)
    ctx.stroke()
  }
  const armor = gear.armor ? RAID_GEAR_MAP.get(gear.armor.key) : null
  if (layer === 'body' && armor) {
    ctx.beginPath()
    ctx.moveTo(-radius * 0.18, -radius * 0.56)
    ctx.lineTo(radius * 0.42, -radius * 0.42)
    ctx.lineTo(radius * 0.5, 0)
    ctx.lineTo(radius * 0.42, radius * 0.42)
    ctx.lineTo(-radius * 0.18, radius * 0.56)
    ctx.lineTo(-radius * 0.42, 0)
    ctx.closePath()
    ctx.fillStyle = gearTint(armor.key)
    ctx.globalAlpha = 0.8
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = stroke
    ctx.stroke()
    if (gear.armor && gear.armor.maxDurability > 0
      && gear.armor.durability / gear.armor.maxDurability < 0.35) {
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)'
      ctx.lineWidth = Math.max(1, radius * 0.035)
      ctx.beginPath()
      ctx.moveTo(-radius * 0.1, -radius * 0.3)
      ctx.lineTo(radius * 0.02, -radius * 0.08)
      ctx.lineTo(-radius * 0.06, radius * 0.12)
      ctx.lineTo(radius * 0.08, radius * 0.32)
      ctx.stroke()
    }
  }
  const rig = gear.rig ? RAID_GEAR_MAP.get(gear.rig) : null
  if (layer === 'body' && rig) {
    ctx.fillStyle = gearTint(rig.key)
    ctx.globalAlpha = 0.75
    for (const side of [-1, 1] as const) {
      roundedRect(
        ctx,
        radius * 0.05,
        side * radius * 0.24 - radius * 0.09,
        radius * 0.34,
        radius * 0.18,
        radius * 0.05,
      )
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = PET_OUTLINE
      ctx.lineWidth = Math.max(1, radius * 0.03)
      ctx.stroke()
      ctx.globalAlpha = 0.75
    }
    ctx.globalAlpha = 1
  }
  const helmet = gear.helmet ? RAID_GEAR_MAP.get(gear.helmet.key) : null
  if (layer === 'head' && helmet) {
    // 俯视头盔：盖住后脑，前脸（眼睛/口鼻）保持露出
    ctx.beginPath()
    ctx.ellipse(headX - radius * 0.4, 0, radius * 0.32, radius * 0.44, 0, 0, Math.PI * 2)
    ctx.fillStyle = gearTint(helmet.key)
    ctx.globalAlpha = 0.92
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = PET_OUTLINE
    ctx.lineWidth = stroke
    ctx.stroke()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)'
    ctx.lineWidth = Math.max(1, radius * 0.045)
    ctx.beginPath()
    ctx.moveTo(headX - radius * 0.68, -radius * 0.26)
    ctx.lineTo(headX - radius * 0.14, -radius * 0.3)
    ctx.stroke()
    if (!low) {
      ctx.fillStyle = 'rgba(226, 240, 255, 0.55)'
      roundedRect(ctx, headX - radius * 0.56, -radius * 0.14, radius * 0.2, radius * 0.1, radius * 0.04)
      ctx.fill()
    }
  }
  // 战靴：脚部护片（没有战靴时保留自然爪子）
  if (layer === 'body' && gear.boots) {
    ctx.fillStyle = gearTint(gear.boots)
    ctx.globalAlpha = 0.85
    for (const side of [-1, 1] as const) {
      roundedRect(ctx, radius * 0.36, side * radius * 0.5 - radius * 0.08, radius * 0.26, radius * 0.16, radius * 0.05)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.globalAlpha = 1
  }
}

function drawPetWeapon(
  ctx: CanvasRenderingContext2D,
  radius: number,
  colors: { body: string; belly: string; ear: string; accent: string },
  recoil: number,
): void {
  // 枪持在身体一侧（俯视时从肩侧探出），避免覆盖眼睛与口鼻
  ctx.save()
  ctx.translate(0, -radius * 0.46)
  const kick = recoil * radius * 0.12
  ctx.fillStyle = '#64748b'
  ctx.fillRect(radius * 0.7 - kick, -radius * 0.13, radius * 0.72, radius * 0.26)
  ctx.fillStyle = '#475569'
  ctx.fillRect(radius * 0.58 - kick, -radius * 0.07, radius * 0.2, radius * 0.14)
  ctx.fillStyle = '#cbd5e1'
  ctx.fillRect(radius * 0.82 - kick, -radius * 0.045, radius * 0.62, radius * 0.09)
  ctx.fillStyle = '#94a3b8'
  ctx.fillRect(radius * 0.92 - kick, -radius * 0.17, radius * 0.24, radius * 0.06)
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(radius * 0.98 - kick, -radius * 0.15, radius * 0.08, radius * 0.04)
  ctx.fillStyle = colors.accent
  ctx.fillRect(radius * 1.46 - kick, -radius * 0.07, radius * 0.15, radius * 0.14)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(radius * 0.84 - kick, radius * 0.14, radius * 0.08, radius * 0.16)
  ctx.restore()
}

/** 宠物局内模型：物种轮廓 + 装备外观 + 行走 / 待机 / 后坐力动画 */
function drawPetBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  angle: number,
  colors: { body: string; belly: string; ear: string; accent: string },
  ring?: string,
  options?: RaidPetDrawOptions,
): void {
  const species = normalizePetSpecies(options?.species ?? 'cat')
  const gear = options?.gear ?? null
  const moving = options?.moving ?? false
  const phase = options?.stepPhase ?? 0
  const recoil = options?.recoil ?? 0
  const low = options?.low ?? false
  const now = options?.now ?? 0
  const walk = moving ? Math.sin(phase) : 0
  const bob = moving
    ? Math.abs(walk) * radius * 0.045
    : Math.sin(now / 900) * radius * 0.014
  const swing = Math.sin(now / 320 + phase * 0.5) * (moving ? 0.16 : 0.08)
  const twitch = Math.sin(now / 680 + phase * 0.4) * radius * 0.035
  const blink = (now + species.charCodeAt(0) * 97) % 3800 > 3660
  const bodyDark = shadeColor(colors.body, -0.26)
  const bodyLight = shadeColor(colors.body, 0.18)
  const headX = radius * 0.48
  const stroke = petStroke(radius)

  ctx.save()
  ctx.translate(x, y + bob)
  ctx.rotate(angle)
  if (options?.alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, options.alpha))
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  drawPetGear(ctx, radius, gear, headX, low, 'back')
  drawPetTail(ctx, species, radius, colors, swing)

  // 腿 / 爪：行走时交替前后，静止时收在身侧
  const legOffset = walk * radius * 0.13
  const legColor = species === 'panda' ? colors.ear : shadeColor(colors.body, -0.18)
  for (const side of [-1, 1] as const) {
    for (const front of [false, true] as const) {
      const lx = (front ? 1 : -1) * radius * (0.42 + legOffset * (side === 1 ? 1 : -1))
      const ly = side * radius * 0.52
      ctx.beginPath()
      ctx.ellipse(lx, ly, radius * 0.14, radius * 0.1, side * 0.2, 0, Math.PI * 2)
      ctx.fillStyle = front ? legColor : bodyDark
      ctx.fill()
      ctx.strokeStyle = PET_OUTLINE
      ctx.lineWidth = Math.max(1, radius * 0.035)
      ctx.stroke()
    }
  }

  // 身体
  ctx.beginPath()
  ctx.ellipse(-radius * 0.02, radius * 0.05, radius * 0.96, radius * 0.82, 0, 0, Math.PI * 2)
  ctx.fillStyle = colors.body
  ctx.fill()
  ctx.strokeStyle = PET_OUTLINE
  ctx.lineWidth = stroke
  ctx.stroke()
  // 腹部 / 胸毛
  ctx.beginPath()
  ctx.ellipse(radius * 0.1, radius * 0.13, radius * 0.58, radius * 0.46, 0, 0, Math.PI * 2)
  ctx.fillStyle = colors.belly
  ctx.globalAlpha = 0.72
  ctx.fill()
  ctx.globalAlpha = 1
  // 顶部高光
  if (!low) {
    ctx.beginPath()
    ctx.ellipse(-radius * 0.1, -radius * 0.3, radius * 0.52, radius * 0.2, -0.18, 0, Math.PI * 2)
    ctx.fillStyle = bodyLight
    ctx.globalAlpha = 0.42
    ctx.fill()
    ctx.globalAlpha = 1
  }
  drawPetMarkings(ctx, species, radius, colors)
  drawPetGear(ctx, radius, gear, headX, low, 'body')
  // 狗的垂耳要盖在头两侧，放在头之后画才不会被大头盖住；其余物种耳朵在头后
  const earsBeforeHead = species !== 'dog'
  if (earsBeforeHead) drawPetEars(ctx, species, radius, colors, headX, twitch)

  // 头
  ctx.beginPath()
  ctx.arc(headX, 0, radius * 0.6, 0, Math.PI * 2)
  ctx.fillStyle = colors.body
  ctx.fill()
  ctx.strokeStyle = PET_OUTLINE
  ctx.lineWidth = stroke
  ctx.stroke()
  if (!low) {
    ctx.beginPath()
    ctx.arc(headX - radius * 0.12, -radius * 0.2, radius * 0.28, 0, Math.PI * 2)
    ctx.fillStyle = bodyLight
    ctx.globalAlpha = 0.28
    ctx.fill()
    ctx.globalAlpha = 1
  }
  if (species === 'bird') {
    // 羽冠
    ctx.fillStyle = shadeColor(colors.body, -0.05)
    for (let i = 0; i < 3; i += 1) {
      ctx.save()
      ctx.translate(headX - radius * 0.12, 0)
      ctx.rotate((i - 1) * 0.45)
      ctx.beginPath()
      ctx.ellipse(-radius * 0.26, 0, radius * 0.08, radius * 0.28, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
  drawPetFace(ctx, species, radius, colors, headX, blink, low)
  if (!earsBeforeHead) drawPetEars(ctx, species, radius, colors, headX, twitch)
  drawPetGear(ctx, radius, gear, headX, low, 'head')
  drawPetWeapon(ctx, radius, colors, recoil)

  if (ring) {
    ctx.strokeStyle = ring
    ctx.lineWidth = Math.max(1.5, radius * 0.08)
    ctx.beginPath()
    ctx.ellipse(0, 0, radius * 1.18, radius * 0.98, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawEnemies(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  low: boolean,
): void {
  const tile = metrics.tile
  for (const enemy of engine.enemies) {
    if (enemy.dead) continue
    const screen = worldToScreen(metrics, enemy.x, enemy.y)
    const radius = Math.max(8, enemy.source.radius * tile)
    const kind = enemy.source.kind

    // 开火预警：远程单位蓄力时画虚线 + 准星
    if (!low && enemy.telegraph > 0.05 && enemy.source.ranged) {
      const playerScreen = worldToScreen(metrics, engine.player.x, engine.player.y)
      ctx.save()
      ctx.globalAlpha = 0.18 + enemy.telegraph * 0.34
      ctx.strokeStyle = '#fca5a5'
      ctx.lineWidth = Math.max(1, tile * 0.03)
      ctx.setLineDash([tile * 0.2, tile * 0.2])
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(playerScreen.x, playerScreen.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(playerScreen.x, playerScreen.y, radius * (1.5 - enemy.telegraph), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // 精英冲锋预警（chargeTelegraph 1 → 0）：与射击预警同款虚线 + 收缩准星，
    // 线的方向就是起跳后要冲的方向，玩家可以据此走位
    if (!low && enemy.chargeTelegraph > 0.05) {
      const playerScreen = worldToScreen(metrics, engine.player.x, engine.player.y)
      ctx.save()
      ctx.globalAlpha = 0.18 + enemy.chargeTelegraph * 0.34
      ctx.strokeStyle = '#fb923c'
      ctx.lineWidth = Math.max(1, tile * 0.035)
      ctx.setLineDash([tile * 0.16, tile * 0.16])
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(playerScreen.x, playerScreen.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(playerScreen.x, playerScreen.y, radius * (1.6 - enemy.chargeTelegraph), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
    ctx.beginPath()
    ctx.ellipse(screen.x, screen.y + radius * 0.95, radius * 0.9, radius * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()

    if (!low) {
      const aura = 0.25 + 0.15 * Math.sin(now / 400 + enemy.source.level)
      if (kind === 'boss' || kind === 'elite') {
        ctx.strokeStyle = kind === 'boss' ? `rgba(251, 191, 36, ${aura})` : `rgba(249, 115, 22, ${aura})`
        ctx.lineWidth = Math.max(2, radius * 0.16)
        ctx.beginPath()
        ctx.arc(screen.x, screen.y, radius * 1.4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const lunge = enemy.lunge > 0 ? enemy.lunge / 0.26 : 0
    // 精英冲锋冲刺中的拉伸变形：和近战突进同款手法，读起来是「整只怪压过来」
    const dash = enemy.chargeDash > 0 ? enemy.chargeDash / 0.35 : 0
    ctx.save()
    ctx.translate(screen.x, screen.y)
    if (lunge > 0) ctx.scale(1 + lunge * 0.18, 1 - lunge * 0.1)
    else if (dash > 0) ctx.scale(1 + dash * 0.3, 1 - dash * 0.12)
    drawEnemyBody(ctx, radius, kind, enemy.hitFlash > 0, now)
    ctx.restore()

    const barW = radius * 2.3
    const ratio = Math.max(0, enemy.hp / enemy.maxHp)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(screen.x - barW / 2, screen.y - radius - tile * 0.3, barW, Math.max(3, tile * 0.07))
    ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#f87171'
    ctx.fillRect(screen.x - barW / 2, screen.y - radius - tile * 0.3, barW * ratio, Math.max(3, tile * 0.07))
    if (enemy.telegraph > 0.05) {
      ctx.fillStyle = art.accent
      ctx.globalAlpha = 0.6
      ctx.fillRect(screen.x - barW / 2, screen.y - radius - tile * 0.42, barW * enemy.telegraph, Math.max(2, tile * 0.045))
      ctx.globalAlpha = 1
    }
    // 精英冲锋读条（预警剩余）：与射击预警同位，颜色区分
    if (enemy.chargeTelegraph > 0.05) {
      ctx.fillStyle = '#fb923c'
      ctx.globalAlpha = 0.75
      ctx.fillRect(
        screen.x - barW / 2,
        screen.y - radius - tile * 0.42,
        barW * enemy.chargeTelegraph,
        Math.max(2, tile * 0.045),
      )
      ctx.globalAlpha = 1
    }
    ctx.fillStyle = 'rgba(248, 250, 252, 0.9)'
    ctx.font = `600 ${Math.max(9, tile * 0.19)}px "Inter", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(`${enemy.source.name} Lv.${enemy.source.level}`, screen.x, screen.y - radius - tile * 0.5)
  }
}

function drawEnemyBody(
  ctx: CanvasRenderingContext2D,
  radius: number,
  kind: string,
  hitFlash: boolean,
  now: number,
): void {
  const boss = kind === 'boss'
  const elite = kind === 'elite'
  const scout = kind === 'scout'
  const body = hitFlash ? '#ffe4e6' : boss ? '#7f1d1d' : elite ? '#78350f' : scout ? '#3f3f46' : '#7f2f2f'
  const edge = boss ? '#fbbf24' : elite ? '#fb923c' : scout ? '#a1a1aa' : '#f87171'

  if (boss) {
    // 首领：六边形重甲 + 旋转尖刺
    ctx.save()
    ctx.rotate(now / 2600)
    ctx.fillStyle = 'rgba(251, 191, 36, 0.18)'
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * radius * 1.1, Math.sin(a) * radius * 1.1)
      ctx.lineTo(Math.cos(a + 0.24) * radius * 1.48, Math.sin(a + 0.24) * radius * 1.48)
      ctx.lineTo(Math.cos(a + 0.48) * radius * 1.1, Math.sin(a + 0.48) * radius * 1.1)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
    ctx.beginPath()
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6
      const x = Math.cos(a) * radius
      const y = Math.sin(a) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = body
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = Math.max(2, radius * 0.1)
    ctx.stroke()
    // 王冠
    ctx.fillStyle = edge
    ctx.beginPath()
    ctx.moveTo(-radius * 0.55, -radius * 0.72)
    ctx.lineTo(-radius * 0.3, -radius * 1.12)
    ctx.lineTo(-radius * 0.08, -radius * 0.82)
    ctx.lineTo(radius * 0.14, -radius * 1.18)
    ctx.lineTo(radius * 0.36, -radius * 0.82)
    ctx.lineTo(radius * 0.58, -radius * 1.1)
    ctx.lineTo(radius * 0.62, -radius * 0.66)
    ctx.closePath()
    ctx.fill()
  } else if (elite) {
    // 精英：宽肩重甲
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.moveTo(-radius * 1.15, -radius * 0.2)
    ctx.lineTo(-radius * 0.8, -radius * 0.95)
    ctx.lineTo(radius * 0.8, -radius * 0.95)
    ctx.lineTo(radius * 1.15, -radius * 0.2)
    ctx.lineTo(radius * 0.85, radius * 0.9)
    ctx.lineTo(-radius * 0.85, radius * 0.9)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = Math.max(1.5, radius * 0.09)
    ctx.stroke()
    ctx.fillStyle = 'rgba(251, 146, 60, 0.85)'
    ctx.fillRect(-radius * 0.7, -radius * 0.62, radius * 0.45, radius * 0.16)
    ctx.fillRect(radius * 0.25, -radius * 0.62, radius * 0.45, radius * 0.16)
  } else if (scout) {
    // 斥候：瘦长兜帽
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.ellipse(0, 0, radius * 0.8, radius, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = Math.max(1.5, radius * 0.08)
    ctx.stroke()
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.beginPath()
    ctx.ellipse(0, -radius * 0.28, radius * 0.52, radius * 0.42, 0, Math.PI, Math.PI * 2)
    ctx.fill()
  } else {
    // 士兵：圆形装甲
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = Math.max(1.5, radius * 0.1)
    ctx.stroke()
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)'
    ctx.fillRect(-radius * 0.6, -radius * 0.22, radius * 1.2, radius * 0.3)
    ctx.fillStyle = '#fca5a5'
    ctx.fillRect(-radius * 0.45, -radius * 0.16, radius * 0.9, Math.max(1, radius * 0.1))
  }
  // 统一的红色目光
  ctx.fillStyle = boss ? '#fde68a' : '#fecaca'
  ctx.beginPath()
  ctx.arc(-radius * 0.26, radius * 0.16, Math.max(1.5, radius * 0.07), 0, Math.PI * 2)
  ctx.arc(radius * 0.26, radius * 0.16, Math.max(1.5, radius * 0.07), 0, Math.PI * 2)
  ctx.fill()
  // 武器
  ctx.fillStyle = '#cbd5e1'
  ctx.fillRect(radius * 0.7, -radius * 0.08, radius * 0.6, Math.max(1.5, radius * 0.12))
}

function drawBullets(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  low: boolean,
): void {
  const tile = metrics.tile
  ctx.lineCap = 'round'
  for (const bullet of engine.bullets) {
    const screen = worldToScreen(metrics, bullet.x, bullet.y)
    const radius = Math.max(2, bullet.radius * tile)
    const speed = Math.hypot(bullet.vx, bullet.vy) || 1
    const tx = -bullet.vx / speed
    const ty = -bullet.vy / speed
    if (!low) {
      // 拖尾：两层线，外层淡、内层亮，不用 shadowBlur
      ctx.strokeStyle = bullet.color
      ctx.globalAlpha = 0.25
      ctx.lineWidth = radius * 2.6
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(screen.x + tx * radius * 7, screen.y + ty * radius * 7)
      ctx.stroke()
      ctx.globalAlpha = 0.8
      ctx.lineWidth = radius * 1.1
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(screen.x + tx * radius * 5, screen.y + ty * radius * 5)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    // 弹头：外圈 + 亮芯
    ctx.fillStyle = bullet.color
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.beginPath()
    ctx.arc(screen.x + tx * radius * 0.2, screen.y + ty * radius * 0.2, radius * 0.42, 0, Math.PI * 2)
    ctx.fill()
    if (bullet.skill) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
      ctx.lineWidth = Math.max(1, radius * 0.35)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * 1.4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.lineCap = 'butt'
}

function drawAimReticle(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
): void {
  const aim = engine.input
  if (aim.aimX === 0 && aim.aimY === 0) return
  const screen = worldToScreen(metrics, aim.aimX, aim.aimY)
  const tile = metrics.tile
  const size = Math.max(5, tile * 0.14)
  ctx.save()
  ctx.globalAlpha = 0.62
  ctx.strokeStyle = art.accent
  ctx.lineWidth = Math.max(1, tile * 0.03)
  ctx.beginPath()
  ctx.arc(screen.x, screen.y, size, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(screen.x + Math.cos(a) * (size + tile * 0.05), screen.y + Math.sin(a) * (size + tile * 0.05))
    ctx.lineTo(screen.x + Math.cos(a) * (size + tile * 0.16), screen.y + Math.sin(a) * (size + tile * 0.16))
    ctx.stroke()
  }
  ctx.fillStyle = art.accent
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(screen.x, screen.y, Math.max(1.2, tile * 0.025), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  art: RaidMapArt,
  now: number,
  low: boolean,
  dpr: number,
): void {
  const screen = worldToScreen(metrics, engine.player.x, engine.player.y)
  const tile = metrics.tile
  const colors = paletteFor(engine.species)
  const radius = tile * 0.37
  const angle = engine.player.angle
  const hpRatio = engine.maxHp > 0 ? engine.hp / engine.maxHp : 0

  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
  ctx.beginPath()
  ctx.ellipse(screen.x, screen.y + radius * 0.98, radius, radius * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()

  // 增伤光环：双层旋转刻痕
  if (engine.player.atkBuffUntil > now) {
    ctx.save()
    ctx.translate(screen.x, screen.y)
    ctx.rotate(now / 700)
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.9)'
    ctx.lineWidth = Math.max(1.5, tile * 0.055)
    ctx.beginPath()
    ctx.arc(0, 0, radius * 1.8, 0, Math.PI * 1.2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, radius * 1.8, Math.PI * 1.4, Math.PI * 2)
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
      const x = Math.cos(a) * radius * 1.75
      const y = Math.sin(a) * radius * 1.75
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = 'rgba(96, 165, 250, 0.15)'
    ctx.fill()
    ctx.restore()
  }

  // 走动 / 待机动画由宠物模型内部处理，外部只负责阴影与枪口准星
  drawPetBody(ctx, screen.x, screen.y, radius, angle, colors, undefined, {
    species: engine.species,
    gear: engine.gear,
    moving: engine.playerMoving,
    stepPhase: engine.playerStepPhase,
    recoil: engine.playerRecoil,
    now,
    low,
  })

  // 枪口准星
  const muzzleX = screen.x + Math.cos(angle) * radius * 1.56
  const muzzleY = screen.y + Math.sin(angle) * radius * 1.56
  ctx.strokeStyle = art.accent
  ctx.globalAlpha = 0.7
  ctx.lineWidth = Math.max(1, tile * 0.03)
  ctx.beginPath()
  ctx.arc(muzzleX, muzzleY, radius * 0.16, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1

  if (hpRatio < 0.3 && !low) {
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.4 + 0.3 * Math.sin(now / 220)})`
    ctx.lineWidth = Math.max(2, tile * 0.06)
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius * 1.4, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(226, 232, 240, 0.95)'
  ctx.font = `600 ${Math.max(10, tile * 0.21)}px "Inter", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('你', screen.x, screen.y + radius * 2.05)
}

/* ---------- 特效 / 飘字 / 命中标记 ---------- */

/** 特效渐变缓存：cone / pillar 每帧新建 CanvasGradient 在平板上是可测的开销，按 ctx + 参数缓存 */
const effectGradientCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>()
function cachedGradient(
  ctx: CanvasRenderingContext2D,
  key: string,
  build: () => CanvasGradient,
): CanvasGradient {
  let store = effectGradientCache.get(ctx)
  if (!store) {
    store = new Map()
    effectGradientCache.set(ctx, store)
  }
  const hit = store.get(key)
  if (hit) return hit
  const made = build()
  if (store.size > 64) store.clear()
  store.set(key, made)
  return made
}

function drawEffects(
  ctx: CanvasRenderingContext2D,
  effects: readonly RaidEffect[],
  metrics: RaidRenderMetrics,
  now: number,
  low: boolean,
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
      ctx.globalAlpha = fade * 0.95
      ctx.lineWidth = Math.max(1.5, tile * 0.05)
      ctx.beginPath()
      ctx.arc(0, 0, radius * (0.4 + t * 0.7), 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = effect.accent
      ctx.globalAlpha = fade * 0.65
      ctx.beginPath()
      ctx.arc(0, 0, radius * (0.2 + t * 0.45), 0, Math.PI * 2)
      ctx.stroke()
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2
        ctx.strokeStyle = effect.accent
        ctx.globalAlpha = fade * 0.8
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * radius * 0.42, Math.sin(a) * radius * 0.42)
        ctx.lineTo(Math.cos(a) * radius * (0.66 + t * 0.2), Math.sin(a) * radius * (0.66 + t * 0.2))
        ctx.stroke()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'nova') {
      // 技能起手 / 爆发：亮色能量环 + 放射线
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade * 0.9
      ctx.lineWidth = Math.max(2, tile * 0.08)
      ctx.beginPath()
      ctx.arc(0, 0, radius * (0.25 + t * 0.95), 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = effect.accent
      ctx.globalAlpha = fade * 0.75
      ctx.lineWidth = Math.max(1, tile * 0.035)
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + effect.age * 1.5
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * radius * 0.3, Math.sin(a) * radius * 0.3)
        ctx.lineTo(Math.cos(a) * radius * (0.7 + t * 0.5), Math.sin(a) * radius * (0.7 + t * 0.5))
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'shards') {
      // 冰晶 / 圣光碎片：固定角度外扩
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.angle)
      ctx.fillStyle = effect.color
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 + effect.id * 0.7
        const dist = radius * (0.25 + t * 0.9)
        const x = Math.cos(a) * dist
        const y = Math.sin(a) * dist
        ctx.globalAlpha = fade
        ctx.beginPath()
        ctx.moveTo(x, y - tile * 0.14)
        ctx.lineTo(x + tile * 0.07, y)
        ctx.lineTo(x, y + tile * 0.14)
        ctx.lineTo(x - tile * 0.07, y)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'pillar') {
      // 光柱：角色脚下的垂直能量，增益 / 治疗 / 护盾都靠它读出来
      const width = radius * 0.9
      const height = radius * 5
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = cachedGradient(ctx, `pillar|${effect.color}|${effect.accent}|${Math.round(height)}`, () => {
        const grad = ctx.createLinearGradient(0, 0, 0, -height)
        grad.addColorStop(0, effect.color)
        grad.addColorStop(0.55, effect.accent)
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
        return grad
      })
      ctx.globalAlpha = fade * 0.34
      ctx.beginPath()
      ctx.moveTo(-width / 2, 0)
      ctx.lineTo(-width * 0.16, -height)
      ctx.lineTo(width * 0.16, -height)
      ctx.lineTo(width / 2, 0)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = fade * 0.7
      ctx.strokeStyle = effect.accent
      ctx.lineWidth = Math.max(1.5, tile * 0.04)
      ctx.beginPath()
      ctx.ellipse(0, 0, width * 0.5, width * 0.18, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'beam') {
      const targetScreen = { x: metrics.offsetX + effect.tx * tile, y: metrics.offsetY + effect.ty * tile }
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade * 0.32
      ctx.lineWidth = Math.max(4, tile * 0.16)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(targetScreen.x, targetScreen.y)
      ctx.stroke()
      ctx.globalAlpha = fade
      ctx.strokeStyle = effect.accent
      ctx.lineWidth = Math.max(1.5, tile * 0.05)
      ctx.beginPath()
      ctx.moveTo(screen.x, screen.y)
      ctx.lineTo(targetScreen.x, targetScreen.y)
      ctx.stroke()
      // 闪电分叉
      ctx.strokeStyle = effect.color
      ctx.lineWidth = Math.max(1, tile * 0.035)
      for (let i = 1; i < 4; i += 1) {
        const t0 = i / 4
        const bx = screen.x + (targetScreen.x - screen.x) * t0
        const by = screen.y + (targetScreen.y - screen.y) * t0
        const off = (i % 2 === 0 ? 1 : -1) * tile * 0.22
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx + off, by - tile * 0.16)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'cone') {
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.angle)
      ctx.fillStyle = cachedGradient(ctx, `cone|${effect.accent}|${Math.round(radius)}`, () => {
        const gradient = ctx.createLinearGradient(0, 0, radius, 0)
        gradient.addColorStop(0, effect.accent)
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
        return gradient
      })
      ctx.globalAlpha = fade * 0.8
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, radius * (0.6 + t * 0.55), -0.5, 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(1.5, tile * 0.04)
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(i * 0.32) * radius * (0.7 + t * 0.4), Math.sin(i * 0.32) * radius * (0.7 + t * 0.4))
        ctx.stroke()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'slash') {
      ctx.save()
      ctx.translate(screen.x, screen.y)
      ctx.rotate(effect.angle)
      ctx.strokeStyle = effect.accent
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(2, tile * 0.12 * fade)
      ctx.beginPath()
      ctx.arc(0, 0, radius, -0.75, 0.75)
      ctx.stroke()
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade * 0.6
      ctx.lineWidth = Math.max(1, tile * 0.05)
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.8, -0.6, 0.9)
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
      ctx.globalAlpha = fade * 0.55
      ctx.fillStyle = effect.color
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 + effect.age
        ctx.beginPath()
        ctx.arc(screen.x + Math.cos(a) * radius * t, screen.y + Math.sin(a) * radius * t, radius * 0.32, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    } else if (effect.kind === 'aura' || effect.kind === 'shield') {
      ctx.strokeStyle = effect.color
      ctx.globalAlpha = fade
      ctx.lineWidth = Math.max(2, tile * 0.075)
      ctx.beginPath()
      ctx.arc(screen.x, screen.y, radius * (1 - t * 0.3), 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = effect.accent
      ctx.globalAlpha = fade * 0.2
      ctx.fill()
      ctx.globalAlpha = 1
    } else if (effect.kind === 'heal') {
      ctx.fillStyle = effect.color
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2
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
      ctx.globalAlpha = fade * 0.3
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
      ctx.lineTo(radius * 1.3, -radius * 0.5)
      ctx.lineTo(radius * 1.9, 0)
      ctx.lineTo(radius * 1.3, radius * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = effect.accent
      ctx.globalAlpha = fade * 0.8
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(radius * 0.9, -radius * 0.24)
      ctx.lineTo(radius * 1.2, 0)
      ctx.lineTo(radius * 0.9, radius * 0.24)
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
    ctx.lineWidth = Math.max(1.5, tile * (marker.crit ? 0.06 : 0.045))
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
    ctx.font = `800 ${size}px "Inter", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = Math.max(2, size * 0.18)
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)'
    ctx.strokeText(float.text, screen.x, screen.y - t * tile * 0.5)
    ctx.fillStyle = float.color
    ctx.fillText(float.text, screen.x, screen.y - t * tile * 0.5)
    ctx.globalAlpha = 1
  }
}

function drawSkillBanner(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
): void {
  const banner = engine.skillBanner
  if (!banner) return
  const t = banner.age / banner.life
  const screen = worldToScreen(metrics, engine.player.x, engine.player.y)
  const rise = metricTile(metrics) * (0.9 + t * 1.1)
  const size = Math.max(14, metricTile(metrics) * 0.34)
  ctx.save()
  ctx.globalAlpha = Math.max(0, 1 - t * t)
  ctx.font = `800 ${size}px "Inter", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(3, size * 0.2)
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)'
  ctx.strokeText(banner.text, screen.x, screen.y - rise)
  ctx.fillStyle = banner.color
  ctx.fillText(banner.text, screen.x, screen.y - rise)
  ctx.restore()
}

function metricTile(metrics: RaidRenderMetrics): number {
  return metrics.tile
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
  low: boolean,
  dpr: number,
): void {
  const center = worldToScreen(metrics, engine.player.x, engine.player.y)
  const radius = Math.max(roomRect.w, roomRect.h) * 0.72
  const key = `${art.key}|${Math.round(roomRect.w)}x${Math.round(roomRect.h)}|${Math.round(radius)}|${Math.round(dpr * 100)}`
  if (lightCache.key !== key || !lightCache.canvas) {
    lightCache = { key, canvas: buildLight(radius, art, dpr) }
  }
  if (lightCache.canvas) {
    ctx.drawImage(lightCache.canvas, center.x - radius, center.y - radius, radius * 2, radius * 2)
  }
  if (!low) {
    ctx.fillStyle = art.light
    ctx.globalAlpha = 0.55 + 0.1 * Math.sin(now / 1600)
    ctx.fillRect(roomRect.x, roomRect.y, roomRect.w, roomRect.h)
    ctx.globalAlpha = 1
  }
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  art: RaidMapArt,
  dpr: number,
): void {
  const key = `v|${art.key}|${Math.round(width)}x${Math.round(height)}|${Math.round(dpr * 100)}`
  if (vignetteCache.key !== key || !vignetteCache.canvas) {
    vignetteCache = { key, canvas: buildVignette(width, height, art, dpr) }
  }
  if (vignetteCache.canvas) {
    ctx.drawImage(vignetteCache.canvas, 0, 0, width, height)
  }
}

function drawScreenFlash(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
  now: number,
): void {
  // 渐变本体按尺寸缓存（平板上每帧 createRadialGradient 是可测开销），动态透明度走 globalAlpha
  if (engine.hurtFlash > 0) {
    const edge = cachedGradient(ctx, `hurt|${Math.round(width)}x${Math.round(height)}`, () => {
      const g = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.2,
        width / 2, height / 2, Math.max(width, height) * 0.72,
      )
      g.addColorStop(0, 'rgba(220, 38, 38, 0)')
      g.addColorStop(1, 'rgba(220, 38, 38, 0.55)')
      return g
    })
    ctx.globalAlpha = Math.min(1, engine.hurtFlash)
    ctx.fillStyle = edge
    ctx.fillRect(0, 0, width, height)
    ctx.globalAlpha = 1
  }
  const hpRatio = engine.maxHp > 0 ? engine.hp / engine.maxHp : 1
  if (hpRatio < 0.25 && !engine.ended) {
    const pulse = 0.12 + 0.1 * Math.sin(now / 320)
    const edge = cachedGradient(ctx, `lowhp|${Math.round(width)}x${Math.round(height)}`, () => {
      const g = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.34,
        width / 2, height / 2, Math.max(width, height) * 0.7,
      )
      g.addColorStop(0, 'rgba(190, 18, 60, 0)')
      g.addColorStop(1, 'rgba(190, 18, 60, 1)')
      return g
    })
    ctx.globalAlpha = pulse
    ctx.fillStyle = edge
    ctx.fillRect(0, 0, width, height)
    ctx.globalAlpha = 1
  }
}

function drawSkillFlash(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
): void {
  const flash = engine.skillFlash
  if (!flash || flash.ms <= 0) return
  const ratio = Math.min(1, flash.ms / flash.life)
  ctx.save()
  ctx.globalAlpha = ratio * 0.16
  ctx.fillStyle = flash.color
  ctx.fillRect(0, 0, width, height)
  // 边框强化，技能释放瞬间整屏「闪一下」
  ctx.globalAlpha = ratio * 0.5
  ctx.strokeStyle = flash.color
  ctx.lineWidth = Math.max(6, Math.min(width, height) * 0.02)
  ctx.strokeRect(0, 0, width, height)
  ctx.restore()
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
   小地图
   ============================================================ */

/** 小地图房间类型字标（一格一字，比纯色块直观） */
const MINIMAP_ROOM_CHAR: Record<string, string> = {
  start: '起',
  combat: '战',
  elite: '精',
  boss: '王',
  loot: '资',
  hazard: '危',
  extract: '撤',
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  now: number,
  width: number,
  height: number,
): void {
  const art = getMapArt(engine.map.key)
  const map = engine.map
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
    ctx.globalAlpha = isCurrent ? 1 : cleared ? 0.65 : 0.3
    ctx.fillRect(x, y, size, size)
    ctx.globalAlpha = 1
    // 房间类型字标：格子够大才画（触屏 112px 小图里也有 18px 格，可读）
    if (cell >= 12) {
      ctx.fillStyle = '#0b1220'
      ctx.globalAlpha = isCurrent ? 0.92 : cleared ? 0.85 : 0.6
      ctx.font = `700 ${Math.max(8, Math.round(cell * 0.4))}px "SF Pro SC", "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(MINIMAP_ROOM_CHAR[room.kind] ?? '', x + size / 2, y + size / 2 + 0.5)
      ctx.globalAlpha = 1
    }
    if (isCurrent) {
      ctx.strokeStyle = art.minimap.current
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 1, y - 1, size + 2, size + 2)
      ctx.fillStyle = art.minimap.current
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 320)
      ctx.beginPath()
      ctx.arc(x + size / 2, y + size / 2, Math.max(1.6, size * 0.16), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  for (const extract of map.extracts) {
    const room = map.rooms[extract.roomId]
    if (!room) continue
    const x = originX + room.col * cell + cell * 0.5
    const y = originY + room.row * cell + cell * 0.5
    ctx.strokeStyle = '#bae6fd'
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.22, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - cell * 0.1, y)
    ctx.lineTo(x + cell * 0.1, y)
    ctx.moveTo(x, y - cell * 0.1)
    ctx.lineTo(x, y + cell * 0.1)
    ctx.stroke()
  }

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
