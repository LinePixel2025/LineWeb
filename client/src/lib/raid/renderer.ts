/**
 * 搜打撤实时战斗渲染器（Canvas 2D）。
 *
 * 只渲染当前房间（元气骑士式房间相机），不引入任何图片资源：瓦片、角色、敌人、掉落
 * 全部用 Canvas 图元 + 系统 emoji 绘制，保证离线可用与包体积可控。
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
import type { RaidEngine } from './engine'

const SPECIES_COLORS: Record<string, { body: string; ear: string; accent: string }> = {
  cat: { body: '#f6c177', ear: '#e0883a', accent: '#fff7ed' },
  dog: { body: '#c99a6e', ear: '#9a6b45', accent: '#fff7ed' },
  bird: { body: '#7dd3fc', ear: '#38bdf8', accent: '#f0f9ff' },
  rabbit: { body: '#f5d0fe', ear: '#d8b4fe', accent: '#fdf4ff' },
  fox: { body: '#fb923c', ear: '#ea580c', accent: '#fff7ed' },
  panda: { body: '#e5e7eb', ear: '#4b5563', accent: '#f9fafb' },
}

const ROOM_COLORS: Record<string, string> = {
  start: '#4ade80',
  combat: '#94a3b8',
  elite: '#fbbf24',
  boss: '#f87171',
  loot: '#fcd34d',
  hazard: '#c084fc',
  extract: '#38bdf8',
}

export interface RaidRenderMetrics {
  tile: number
  offsetX: number
  offsetY: number
  width: number
  height: number
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

export function renderRaid(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
  now: number,
): void {
  const room = engine.room
  const metrics = computeMetrics(engine.map, room, width, height)
  ctx.clearRect(0, 0, width, height)
  ctx.save()

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, '#0b1220')
  bg.addColorStop(1, '#111827')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  if (!room) {
    ctx.restore()
    return
  }

  // 视野外遮罩
  const roomRect = {
    x: metrics.offsetX + room.x * metrics.tile,
    y: metrics.offsetY + room.y * metrics.tile,
    w: room.w * metrics.tile,
    h: room.h * metrics.tile,
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(roomRect.x, roomRect.y, roomRect.w, roomRect.h)
  ctx.clip()

  // 地板
  const tile = metrics.tile
  for (let ty = room.y + 1; ty < room.y + room.h - 1; ty += 1) {
    for (let tx = room.x + 1; tx < room.x + room.w - 1; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      const screen = worldToScreen(metrics, tx, ty)
      if (value === RAID_TILE_HAZARD) {
        const pulse = 0.16 + 0.08 * Math.sin(now / 320 + tx + ty)
        ctx.fillStyle = `rgba(192, 132, 252, ${pulse + 0.18})`
        ctx.fillRect(screen.x, screen.y, tile, tile)
        ctx.strokeStyle = 'rgba(216, 180, 254, 0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(screen.x + tile * 0.2, screen.y + tile * 0.8)
        ctx.lineTo(screen.x + tile * 0.8, screen.y + tile * 0.2)
        ctx.stroke()
        continue
      }
      const checker = (tx + ty) % 2 === 0
      ctx.fillStyle = checker ? '#1b2536' : '#1e2a3d'
      ctx.fillRect(screen.x, screen.y, tile, tile)
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)'
      ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, tile - 1, tile - 1)
    }
  }

  // 墙体
  for (let ty = room.y; ty < room.y + room.h; ty += 1) {
    for (let tx = room.x; tx < room.x + room.w; tx += 1) {
      const value = engine.map.tiles[raidTileIndex(engine.map.width, tx, ty)]
      if (value !== RAID_TILE_WALL && value !== RAID_TILE_DOOR) continue
      const screen = worldToScreen(metrics, tx, ty)
      if (value === RAID_TILE_DOOR) {
        const open = engine.roomCleared
        ctx.fillStyle = open ? 'rgba(250, 204, 21, 0.35)' : 'rgba(120, 53, 15, 0.9)'
        ctx.fillRect(screen.x, screen.y, tile, tile)
        ctx.strokeStyle = open ? '#facc15' : '#92400e'
        ctx.lineWidth = 2
        ctx.strokeRect(screen.x + 2, screen.y + 2, tile - 4, tile - 4)
        ctx.fillStyle = 'rgba(248, 250, 252, 0.9)'
        ctx.font = `${Math.max(10, tile * 0.28)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(open ? '开' : '锁', screen.x + tile / 2, screen.y + tile / 2)
        continue
      }
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(screen.x, screen.y, tile, tile)
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.55)'
      ctx.lineWidth = 1
      ctx.strokeRect(screen.x + 0.5, screen.y + 0.5, tile - 1, tile - 1)
      if (ty === room.y && (tx + ty) % 3 === 0) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.16)'
        ctx.fillRect(screen.x + tile * 0.2, screen.y + tile * 0.6, tile * 0.6, 2)
      }
    }
  }

  // 撤离信标
  const extract = engine.extractPoint
  if (extract) {
    const screen = worldToScreen(metrics, extract.x + 0.5, extract.y + 0.5)
    const pulse = 1 + 0.12 * Math.sin(now / 260)
    const radius = tile * 0.9 * pulse
    const gradient = ctx.createRadialGradient(screen.x, screen.y, 0, screen.x, screen.y, radius)
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.42)')
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.7)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, tile * 0.52, 0, Math.PI * 2)
    ctx.stroke()
    drawEmoji(ctx, '🚁', screen.x, screen.y - tile * 0.05, tile * 0.7)
    ctx.fillStyle = 'rgba(186, 230, 253, 0.9)'
    ctx.font = `${Math.max(10, tile * 0.24)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('撤离点', screen.x, screen.y + tile * 0.55)
  }

  // 容器
  for (const container of engine.containers) {
    const screen = worldToScreen(metrics, container.x, container.y)
    ctx.fillStyle = container.opened ? 'rgba(148, 163, 184, 0.18)' : 'rgba(250, 204, 21, 0.16)'
    roundedRect(ctx, screen.x - tile * 0.42, screen.y - tile * 0.42, tile * 0.84, tile * 0.84, tile * 0.16)
    ctx.fill()
    ctx.strokeStyle = container.opened ? 'rgba(148, 163, 184, 0.5)' : 'rgba(250, 204, 21, 0.7)'
    ctx.lineWidth = 2
    ctx.stroke()
    drawEmoji(ctx, container.opened ? '📭' : '📦', screen.x, screen.y, tile * 0.62)
  }

  // 掉落物
  for (const pickup of engine.pickups) {
    const def = RAID_ITEM_MAP.get(pickup.itemKey)
    if (!def) continue
    const bob = Math.sin(now / 320 + pickup.x) * tile * 0.08
    const screen = worldToScreen(metrics, pickup.x, pickup.y + bob * 0.2)
    const rarityColor = RARITY_RING[def.rarity] ?? '#94a3b8'
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, tile * 0.34, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)'
    ctx.fill()
    ctx.strokeStyle = rarityColor
    ctx.lineWidth = 2
    ctx.stroke()
    drawEmoji(ctx, def.emoji, screen.x, screen.y - bob * 0.4, tile * 0.44)
  }

  // 子弹
  for (const bullet of engine.bullets) {
    const screen = worldToScreen(metrics, bullet.x, bullet.y)
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, Math.max(2, bullet.radius * tile), 0, Math.PI * 2)
    ctx.fillStyle = bullet.color
    ctx.shadowColor = bullet.color
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // 敌人
  for (const enemy of engine.enemies) {
    if (enemy.dead) continue
    const screen = worldToScreen(metrics, enemy.x, enemy.y)
    const radius = Math.max(8, enemy.source.radius * tile)
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = enemy.hitFlash > 0 ? 'rgba(254, 226, 226, 0.9)' : 'rgba(127, 29, 29, 0.55)'
    ctx.fill()
    ctx.strokeStyle = enemy.source.kind === 'boss' ? '#fbbf24' : '#f87171'
    ctx.lineWidth = 2
    ctx.stroke()
    drawEmoji(ctx, enemyEmoji(enemy.source.kind), screen.x, screen.y, radius * 1.2)
    // 血条
    const barW = radius * 2.2
    const ratio = Math.max(0, enemy.hp / enemy.maxHp)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fillRect(screen.x - barW / 2, screen.y - radius - 10, barW, 4)
    ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#f87171'
    ctx.fillRect(screen.x - barW / 2, screen.y - radius - 10, barW * ratio, 4)
    ctx.fillStyle = 'rgba(248, 250, 252, 0.85)'
    ctx.font = `${Math.max(9, tile * 0.2)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(`${enemy.source.name} Lv.${enemy.source.level}`, screen.x, screen.y - radius - 16)
  }

  // 玩家
  drawPlayer(ctx, engine, metrics, now)

  // 粒子
  for (const particle of engine.particles) {
    const screen = worldToScreen(metrics, particle.x, particle.y)
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife)
    ctx.fillStyle = particle.color
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, Math.max(1, particle.size * tile), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  ctx.restore()

  // 房间外暗角
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.28,
    width / 2, height / 2, Math.min(width, height) * 0.78,
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  // 小地图
  drawMinimap(ctx, engine, width, height, now)

  // 交互提示
  drawPrompt(ctx, engine, metrics, width, height, now)

  ctx.restore()
}

const RARITY_RING: Record<string, string> = {
  common: '#e5e7eb',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fb923c',
  mythic: '#f87171',
}

function enemyEmoji(kind: string): string {
  if (kind === 'boss') return '👑'
  if (kind === 'elite') return '🦾'
  if (kind === 'scout') return '🥷'
  return '🪖'
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  now: number,
): void {
  const screen = worldToScreen(metrics, engine.player.x, engine.player.y)
  const tile = metrics.tile
  const colors = SPECIES_COLORS[engine.species] ?? SPECIES_COLORS.cat!
  const radius = tile * 0.36
  const angle = engine.player.angle

  // 增益光环
  if (engine.player.atkBuffUntil > now) {
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius * 1.55, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.7)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  // 护盾
  if (engine.player.shield > 0) {
    ctx.beginPath()
    ctx.arc(screen.x, screen.y, radius * 1.5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.85)'
    ctx.lineWidth = 3
    ctx.stroke()
  }

  ctx.save()
  ctx.translate(screen.x, screen.y)
  ctx.rotate(angle)
  // 身体
  ctx.beginPath()
  ctx.ellipse(0, 0, radius * 1.05, radius * 0.9, 0, 0, Math.PI * 2)
  ctx.fillStyle = colors.body
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)'
  ctx.lineWidth = 2
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
  // 眼睛（朝前）
  ctx.beginPath()
  ctx.arc(radius * 0.42, -radius * 0.12, radius * 0.12, 0, Math.PI * 2)
  ctx.arc(radius * 0.42, radius * 0.22, radius * 0.12, 0, Math.PI * 2)
  ctx.fillStyle = '#0f172a'
  ctx.fill()
  // 枪口
  ctx.fillStyle = '#94a3b8'
  ctx.fillRect(radius * 0.8, -radius * 0.1, radius * 0.7, radius * 0.2)
  ctx.restore()

  // 名牌
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)'
  ctx.font = `${Math.max(10, tile * 0.22)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('你', screen.x, screen.y + radius * 1.9)
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  width: number,
  height: number,
  now: number,
): void {
  const map = engine.map
  const cell = 14
  const gap = 3
  const w = map.cols * (cell + gap)
  const h = map.rows * (cell + gap)
  const x = width - w - 16
  const y = 16
  ctx.save()
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'
  roundedRect(ctx, x - 8, y - 8, w + 12, h + 12, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'
  ctx.stroke()
  for (const room of map.rooms) {
    const rx = x + room.col * (cell + gap)
    const ry = y + room.row * (cell + gap)
    const isCurrent = room.id === engine.roomId
    const cleared = engine.clearedRooms.has(room.id)
    ctx.fillStyle = ROOM_COLORS[room.kind] ?? '#64748b'
    ctx.globalAlpha = isCurrent ? 1 : cleared ? 0.75 : 0.3
    roundedRect(ctx, rx, ry, cell, cell, 3)
    ctx.fill()
    ctx.globalAlpha = 1
    if (isCurrent) {
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.95)'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
  ctx.fillStyle = 'rgba(226, 232, 240, 0.7)'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`${engine.map.name} · ${engine.room?.kind === 'extract' ? '撤离区' : '搜索中'}`, x + w, y + h + 14)
  // 剩余时间由 HUD 显示；这里只做轻微呼吸指示灯
  ctx.beginPath()
  ctx.arc(x + w - 4, y - 2, 2 + Math.sin(now / 400) * 0.6, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(74, 222, 128, 0.9)'
  ctx.fill()
  ctx.restore()
}

function drawPrompt(
  ctx: CanvasRenderingContext2D,
  engine: RaidEngine,
  metrics: RaidRenderMetrics,
  width: number,
  height: number,
  now: number,
): void {
  const container = engine.nearestContainer()
  const extract = engine.extractPoint
  let text = ''
  if (extract && Math.hypot(extract.x + 0.5 - engine.player.x, extract.y + 0.5 - engine.player.y) < 2.2) {
    text = engine.extractStartedAt === null
      ? '按 E 开始撤离'
      : `撤离中 ${Math.min(100, Math.round(((now - engine.extractStartedAt) / RAID_EXTRACT_CHANNEL_MS) * 100))}%`
  } else if (container) {
    text = container.opened ? '已搜过' : engine.roomCleared ? '按 E 搜索容器' : '清场后才能搜索'
  }
  if (!text) return
  ctx.save()
  ctx.font = '14px sans-serif'
  const padding = 12
  const textWidth = ctx.measureText(text).width
  const boxW = textWidth + padding * 2
  const boxH = 32
  const x = (width - boxW) / 2
  const y = height - 54
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  roundedRect(ctx, x, y, boxW, boxH, 16)
  ctx.fill()
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)'
  ctx.stroke()
  ctx.fillStyle = 'rgba(226, 232, 240, 0.95)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, y + boxH / 2)
  ctx.restore()
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
