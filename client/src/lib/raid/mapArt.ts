/**
 * 搜打撤地图美术层：每张地图一套主题（材质 / 光照 / 环境粒子 / 装饰物 / 小地图配色）。
 *
 * 口径：不引入任何图片资源，纹理用离屏 canvas 程序化生成并按 `主题+像素尺寸` 缓存，
 * 保证离线可用、包体积可控，同时让 6 张地图在视觉上真正区分开。
 */

export type RaidTextureKind = 'plank' | 'concrete' | 'rock' | 'panel' | 'mycelium' | 'steel' | 'riveted'

export type RaidPropKind =
  | 'crate' | 'barrel' | 'rock' | 'hay' | 'pipe' | 'valve'
  | 'console' | 'pillar' | 'mushroom' | 'vine' | 'tank' | 'specimen' | 'rubble'

export type RaidAmbientKind = 'mote' | 'drop' | 'ember' | 'spore' | 'spark' | 'ash'

export interface RaidMapArt {
  key: string
  /** 地板棋盘两色 */
  floor: [string, string]
  grout: string
  wallFace: string
  wallTop: string
  wallEdge: string
  /** 主题强调色（发光与标识涂装） */
  accent: string
  accentSoft: string
  /** 房间整体光晕色 */
  light: string
  /** 暗角强度 0–1 */
  vignette: number
  texture: RaidTextureKind
  ambient: { kind: RaidAmbientKind; color: string; count: number; speed: number }
  hazard: { base: string; glow: string }
  door: { locked: string; open: string; frame: string }
  props: RaidPropKind[]
  /** 装饰密度（每房间期望件数） */
  propDensity: number
  minimap: { bg: string; grid: string; room: string; cleared: string; current: string }
}

export const RAID_MAP_ART: Record<string, RaidMapArt> = {
  // 废弃农场：木板 + 干草 + 暖绿阳光，浮尘
  wasteland: {
    key: 'wasteland',
    floor: ['#3a3122', '#42382a'],
    grout: 'rgba(120, 96, 58, 0.45)',
    wallFace: '#2a2118',
    wallTop: '#4a3a26',
    wallEdge: '#6b5334',
    accent: '#a3e635',
    accentSoft: 'rgba(163, 230, 53, 0.22)',
    light: 'rgba(250, 226, 150, 0.10)',
    vignette: 0.42,
    texture: 'plank',
    ambient: { kind: 'mote', color: 'rgba(253, 230, 138, 0.55)', count: 22, speed: 0.16 },
    hazard: { base: 'rgba(180, 120, 40, 0.5)', glow: '#d97706' },
    door: { locked: '#7c4a1e', open: '#a3e635', frame: '#5b4327' },
    props: ['crate', 'barrel', 'hay', 'rock'],
    propDensity: 5,
    minimap: { bg: 'rgba(28, 24, 16, 0.88)', grid: 'rgba(163, 230, 53, 0.18)', room: '#65a30d', cleared: '#a3e635', current: '#fef9c3' },
  },
  // 零号大坝：潮湿混凝土 + 水蓝反光 + 滴落
  dam: {
    key: 'dam',
    floor: ['#243240', '#29394a'],
    grout: 'rgba(94, 138, 168, 0.35)',
    wallFace: '#18242f',
    wallTop: '#2c4356',
    wallEdge: '#4b7188',
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.22)',
    light: 'rgba(125, 211, 252, 0.10)',
    vignette: 0.5,
    texture: 'concrete',
    ambient: { kind: 'drop', color: 'rgba(186, 230, 253, 0.7)', count: 26, speed: 0.9 },
    hazard: { base: 'rgba(14, 116, 144, 0.55)', glow: '#22d3ee' },
    door: { locked: '#33475b', open: '#38bdf8', frame: '#20313f' },
    props: ['pipe', 'valve', 'barrel', 'rubble'],
    propDensity: 5,
    minimap: { bg: 'rgba(10, 20, 28, 0.88)', grid: 'rgba(56, 189, 248, 0.16)', room: '#0e7490', cleared: '#38bdf8', current: '#e0f2fe' },
  },
  // 长弓溪谷：岩层 + 锈蚀军需 + 火星
  valley: {
    key: 'valley',
    floor: ['#3b2c25', '#443229'],
    grout: 'rgba(154, 106, 74, 0.35)',
    wallFace: '#241a15',
    wallTop: '#4a3428',
    wallEdge: '#8a5a44',
    accent: '#fb923c',
    accentSoft: 'rgba(251, 146, 60, 0.22)',
    light: 'rgba(251, 191, 36, 0.09)',
    vignette: 0.52,
    texture: 'rock',
    ambient: { kind: 'ember', color: 'rgba(251, 146, 60, 0.8)', count: 20, speed: 0.5 },
    hazard: { base: 'rgba(194, 65, 12, 0.5)', glow: '#f97316' },
    door: { locked: '#5b3a26', open: '#fb923c', frame: '#3d2a1e' },
    props: ['crate', 'rock', 'barrel', 'rubble'],
    propDensity: 6,
    minimap: { bg: 'rgba(26, 18, 14, 0.88)', grid: 'rgba(251, 146, 60, 0.16)', room: '#c2410c', cleared: '#fb923c', current: '#ffedd5' },
  },
  // 航天基地：洁净舱板 + 冷白灯带 + 静电火花
  space: {
    key: 'space',
    floor: ['#212a3c', '#263045'],
    grout: 'rgba(148, 183, 226, 0.28)',
    wallFace: '#141b28',
    wallTop: '#31405a',
    wallEdge: '#7dd3fc',
    accent: '#a5b4fc',
    accentSoft: 'rgba(165, 180, 252, 0.24)',
    light: 'rgba(226, 240, 255, 0.12)',
    vignette: 0.4,
    texture: 'panel',
    ambient: { kind: 'spark', color: 'rgba(224, 242, 254, 0.85)', count: 18, speed: 0.3 },
    hazard: { base: 'rgba(99, 102, 241, 0.45)', glow: '#818cf8' },
    door: { locked: '#334155', open: '#a5b4fc', frame: '#1e293b' },
    props: ['console', 'pillar', 'tank', 'rubble'],
    propDensity: 5,
    minimap: { bg: 'rgba(10, 14, 24, 0.88)', grid: 'rgba(165, 180, 252, 0.16)', room: '#4f46e5', cleared: '#a5b4fc', current: '#eef2ff' },
  },
  // 孢子雨林：菌毯 + 紫绿荧光 + 飘孢子
  fungal: {
    key: 'fungal',
    floor: ['#22301f', '#27382a'],
    grout: 'rgba(129, 199, 132, 0.3)',
    wallFace: '#151f18',
    wallTop: '#2f4a33',
    wallEdge: '#4a7c59',
    accent: '#c084fc',
    accentSoft: 'rgba(192, 132, 252, 0.24)',
    light: 'rgba(74, 222, 128, 0.10)',
    vignette: 0.55,
    texture: 'mycelium',
    ambient: { kind: 'spore', color: 'rgba(216, 180, 254, 0.75)', count: 30, speed: 0.24 },
    hazard: { base: 'rgba(126, 34, 206, 0.45)', glow: '#c084fc' },
    door: { locked: '#3f2d55', open: '#c084fc', frame: '#2a1d3a' },
    props: ['mushroom', 'vine', 'specimen', 'rock'],
    propDensity: 7,
    minimap: { bg: 'rgba(12, 20, 16, 0.9)', grid: 'rgba(192, 132, 252, 0.18)', room: '#4d7c0f', cleared: '#c084fc', current: '#f5d0fe' },
  },
  // 深渊实验室：合金格栅 + 警示灯 + 下沉灰
  abyss: {
    key: 'abyss',
    floor: ['#1b2130', '#1f2739'],
    grout: 'rgba(103, 232, 249, 0.22)',
    wallFace: '#10141f',
    wallTop: '#27314a',
    wallEdge: '#22d3ee',
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.26)',
    light: 'rgba(34, 211, 238, 0.10)',
    vignette: 0.62,
    texture: 'steel',
    ambient: { kind: 'ash', color: 'rgba(148, 163, 184, 0.55)', count: 24, speed: 0.34 },
    hazard: { base: 'rgba(8, 145, 178, 0.5)', glow: '#22d3ee' },
    door: { locked: '#334155', open: '#22d3ee', frame: '#0f172a' },
    props: ['specimen', 'console', 'tank', 'pillar'],
    propDensity: 6,
    minimap: { bg: 'rgba(6, 10, 20, 0.92)', grid: 'rgba(34, 211, 238, 0.18)', room: '#0e7490', cleared: '#22d3ee', current: '#ecfeff' },
  },
  // 日蚀要塞：锈红铆接装甲 + 琥珀警示灯 + 余烬，室内隔断让掩体成为主视觉
  citadel: {
    key: 'citadel',
    floor: ['#2d241d', '#352a21'],
    grout: 'rgba(180, 120, 58, 0.36)',
    wallFace: '#1b1410',
    wallTop: '#a05a1e',
    wallEdge: '#fbbf24',
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.26)',
    light: 'rgba(251, 191, 36, 0.10)',
    vignette: 0.58,
    texture: 'riveted',
    ambient: { kind: 'ember', color: 'rgba(251, 146, 60, 0.75)', count: 26, speed: 0.45 },
    hazard: { base: 'rgba(180, 83, 9, 0.52)', glow: '#f97316' },
    door: { locked: '#4a2f1c', open: '#f59e0b', frame: '#2a1c12' },
    props: ['crate', 'barrel', 'rubble', 'pipe', 'pillar'],
    propDensity: 7,
    minimap: { bg: 'rgba(24, 16, 10, 0.9)', grid: 'rgba(245, 158, 11, 0.18)', room: '#92400e', cleared: '#f59e0b', current: '#fef3c7' },
  },
}

const FALLBACK_ART: RaidMapArt = RAID_MAP_ART.dam!

export function getMapArt(mapKey: string | null | undefined): RaidMapArt {
  if (!mapKey) return FALLBACK_ART
  return RAID_MAP_ART[mapKey] ?? FALLBACK_ART
}

/* ============================================================
   确定性哈希：装饰物与地面污渍跨帧稳定，且不依赖地图生成器内部状态
   ============================================================ */

export function hashTile(seed: number, x: number, y: number, salt = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (x * 0x85ebca6b), 0xc2b2ae35) >>> 0
  h = Math.imul(h ^ (y * 0x27d4eb2f), 0x165667b1) >>> 0
  h = Math.imul(h ^ (salt * 0x9e3779b1), 0x2545f491) >>> 0
  h ^= h >>> 15
  return (h >>> 0) / 0xffffffff
}

/** 房间内的装饰瓦片：返回 null 表示不放东西（避开墙体与通道） */
export function pickProp(
  art: RaidMapArt,
  seed: number,
  roomId: number,
  x: number,
  y: number,
): { kind: RaidPropKind; variant: number; scale: number } | null {
  const roll = hashTile(seed, x, y, roomId + 11)
  if (roll > 0.115) return null
  const index = Math.floor(hashTile(seed, x, y, roomId + 37) * art.props.length) % art.props.length
  return {
    kind: art.props[index] ?? 'crate',
    variant: Math.floor(hashTile(seed, x, y, roomId + 71) * 3),
    scale: 0.7 + hashTile(seed, x, y, roomId + 91) * 0.45,
  }
}

/* ============================================================
   程序化纹理（按 主题 | 像素尺寸 缓存离屏 canvas）
   ============================================================ */

export interface RaidTextureSet {
  floorA: HTMLCanvasElement
  floorB: HTMLCanvasElement
  wall: HTMLCanvasElement
  wallTop: HTMLCanvasElement
}

const textureCache = new Map<string, RaidTextureSet>()

function makeTile(px: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(4, Math.round(px))
  canvas.height = Math.max(4, Math.round(px))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  return { canvas, ctx }
}

/** 主题纹理细化：每种材质画自己的接缝、磨损与高光 */
function paintSurface(ctx: CanvasRenderingContext2D, px: number, kind: RaidTextureKind, base: string, seedSalt: number): void {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, px, px)
  const unit = px / 16

  if (kind === 'plank') {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)'
    ctx.lineWidth = Math.max(1, unit * 0.7)
    for (let i = 1; i < 4; i += 1) {
      const y = (px / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(px, y)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
    for (let i = 0; i < 4; i += 1) ctx.fillRect(0, (px / 4) * i + unit, px, unit)
  } else if (kind === 'concrete') {
    for (let i = 0; i < 90; i += 1) {
      const x = ((i * 37 + seedSalt * 91) % 16) / 16 * px
      const y = ((i * 53 + seedSalt * 17) % 16) / 16 * px
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 255, 255, 0.055)' : 'rgba(0, 0, 0, 0.14)'
      ctx.fillRect(x, y, unit, unit)
    }
  } else if (kind === 'rock') {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.lineWidth = Math.max(1, unit * 0.6)
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath()
      ctx.moveTo(((i * 5 + seedSalt) % 16) / 16 * px, 0)
      ctx.lineTo(((i * 11 + seedSalt * 3) % 16) / 16 * px, px)
      ctx.stroke()
    }
  } else if (kind === 'panel') {
    ctx.strokeStyle = 'rgba(226, 240, 255, 0.16)'
    ctx.lineWidth = Math.max(1, unit * 0.5)
    ctx.strokeRect(unit, unit, px - unit * 2, px - unit * 2)
    ctx.fillStyle = 'rgba(226, 240, 255, 0.22)'
    for (const [rx, ry] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) {
      ctx.fillRect((rx / 16) * px, (ry / 16) * px, unit * 0.9, unit * 0.9)
    }
  } else if (kind === 'mycelium') {
    ctx.strokeStyle = 'rgba(190, 242, 100, 0.16)'
    ctx.lineWidth = Math.max(1, unit * 0.4)
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath()
      ctx.arc(((i * 7 + seedSalt) % 16) / 16 * px, ((i * 13 + seedSalt * 5) % 16) / 16 * px, unit * (2 + i), 0, Math.PI * 1.4)
      ctx.stroke()
    }
  } else if (kind === 'riveted') {
    // 铆接装甲板：横向板缝 + 四角铆钉 + 一条斜向警示涂装
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.38)'
    ctx.lineWidth = Math.max(1, unit * 0.7)
    for (let i = 1; i < 4; i += 1) {
      const y = (px / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(px, y)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.12)'
    ctx.lineWidth = Math.max(1, unit * 0.35)
    ctx.beginPath()
    ctx.moveTo(0, px)
    ctx.lineTo(px, 0)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)'
    for (const [rx, ry] of [[2, 2], [13, 2], [2, 13], [13, 13]] as const) {
      ctx.beginPath()
      ctx.arc((rx / 16) * px, (ry / 16) * px, unit * 0.55, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
    ctx.fillRect(0, px * 0.72, px, px * 0.28)
  } else {
    // steel：格栅 + 拉丝
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.36)'
    ctx.lineWidth = Math.max(1, unit * 0.55)
    for (let i = 0; i < 4; i += 1) {
      const x = (px / 4) * i + unit
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, px)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(148, 197, 253, 0.10)'
    ctx.lineWidth = Math.max(1, unit * 0.3)
    for (let i = 0; i < 6; i += 1) {
      const y = (px / 6) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(px, y)
      ctx.stroke()
    }
  }
}

export function buildTextures(art: RaidMapArt, px: number): RaidTextureSet {
  const size = Math.max(8, Math.round(px))
  const cacheKey = `${art.key}|${size}`
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  const a = makeTile(size)
  paintSurface(a.ctx, size, art.texture, art.floor[0], 1)
  const b = makeTile(size)
  paintSurface(b.ctx, size, art.texture, art.floor[1], 7)
  const wall = makeTile(size)
  paintSurface(wall.ctx, size, art.texture === 'plank' || art.texture === 'rock' || art.texture === 'riveted' ? art.texture : 'concrete', art.wallFace, 3)
  // 墙面顶部收边：主题强调的一条高光
  wall.ctx.fillStyle = art.wallTop
  wall.ctx.fillRect(0, 0, size, Math.max(2, size * 0.22))
  wall.ctx.fillStyle = art.wallEdge
  wall.ctx.fillRect(0, 0, size, Math.max(1, size * 0.07))
  const wallTop = makeTile(size)
  wallTop.ctx.fillStyle = art.wallTop
  wallTop.ctx.fillRect(0, 0, size, size)
  wallTop.ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
  wallTop.ctx.fillRect(0, size * 0.6, size, size * 0.4)

  const set: RaidTextureSet = { floorA: a.canvas, floorB: b.canvas, wall: wall.canvas, wallTop: wallTop.canvas }
  // 尺寸档位有限（DPR × 房间像素），缓存不会无界增长
  if (textureCache.size > 24) textureCache.clear()
  textureCache.set(cacheKey, set)
  return set
}

/* ============================================================
   装饰物绘制（世界坐标传入，尺寸按 tile 缩放）
   ============================================================ */

export function drawProp(
  ctx: CanvasRenderingContext2D,
  kind: RaidPropKind,
  cx: number,
  cy: number,
  tile: number,
  art: RaidMapArt,
  variant: number,
  scale: number,
  now: number,
): void {
  const s = tile * scale
  ctx.save()
  ctx.translate(cx, cy)
  // 接地阴影统一画，装饰物才不会像浮在地上
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.beginPath()
  ctx.ellipse(0, s * 0.34, s * 0.42, s * 0.16, 0, 0, Math.PI * 2)
  ctx.fill()

  if (kind === 'crate' || kind === 'specimen') {
    const box = s * 0.72
    ctx.fillStyle = kind === 'specimen' ? 'rgba(30, 41, 59, 0.9)' : '#4b3a26'
    ctx.fillRect(-box / 2, -box / 2, box, box)
    ctx.strokeStyle = kind === 'specimen' ? art.accent : 'rgba(0, 0, 0, 0.5)'
    ctx.lineWidth = Math.max(1, s * 0.05)
    ctx.strokeRect(-box / 2, -box / 2, box, box)
    if (kind === 'specimen') {
      const pulse = 0.4 + 0.25 * Math.sin(now / 500 + variant)
      ctx.fillStyle = art.accentSoft
      ctx.fillRect(-box * 0.3, -box * 0.3, box * 0.6, box * 0.6)
      ctx.strokeStyle = `rgba(226, 255, 255, ${pulse})`
      ctx.beginPath()
      ctx.arc(0, 0, box * 0.22, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
      ctx.beginPath()
      ctx.moveTo(-box / 2, -box / 2)
      ctx.lineTo(box / 2, box / 2)
      ctx.moveTo(box / 2, -box / 2)
      ctx.lineTo(-box / 2, box / 2)
      ctx.stroke()
    }
  } else if (kind === 'barrel') {
    const w = s * 0.5
    const h = s * 0.72
    ctx.fillStyle = variant === 0 ? '#7c5b3a' : variant === 1 ? '#3f6212' : '#7f1d1d'
    ctx.beginPath()
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = Math.max(1, s * 0.05)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.beginPath()
    ctx.moveTo(-w / 2, -h * 0.12)
    ctx.lineTo(w / 2, -h * 0.12)
    ctx.stroke()
  } else if (kind === 'rock' || kind === 'rubble') {
    ctx.fillStyle = kind === 'rubble' ? '#3f3f46' : '#57534e'
    ctx.beginPath()
    const points = kind === 'rubble' ? 5 : 6
    for (let i = 0; i < points; i += 1) {
      const angle = (i / points) * Math.PI * 2
      const radius = s * (0.24 + ((variant + i) % 3) * 0.05)
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius * 0.75
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.stroke()
  } else if (kind === 'hay') {
    ctx.fillStyle = '#b8912f'
    ctx.beginPath()
    ctx.ellipse(0, 0, s * 0.4, s * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(90, 66, 20, 0.6)'
    ctx.lineWidth = Math.max(1, s * 0.04)
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath()
      ctx.moveTo(-s * 0.36, i * s * 0.1)
      ctx.lineTo(s * 0.36, i * s * 0.1)
      ctx.stroke()
    }
  } else if (kind === 'pipe' || kind === 'valve') {
    ctx.strokeStyle = art.wallEdge
    ctx.lineWidth = Math.max(2, s * 0.14)
    ctx.beginPath()
    if (kind === 'pipe') {
      ctx.moveTo(-s * 0.4, -s * 0.1)
      ctx.lineTo(s * 0.1, -s * 0.1)
      ctx.lineTo(s * 0.1, s * 0.2)
      ctx.lineTo(s * 0.4, s * 0.2)
    } else {
      ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2)
    }
    ctx.stroke()
    if (kind === 'valve') {
      ctx.strokeStyle = art.accent
      ctx.lineWidth = Math.max(1, s * 0.06)
      ctx.beginPath()
      ctx.moveTo(-s * 0.28, 0)
      ctx.lineTo(s * 0.28, 0)
      ctx.moveTo(0, -s * 0.28)
      ctx.lineTo(0, s * 0.28)
      ctx.stroke()
    }
  } else if (kind === 'console') {
    const w = s * 0.66
    const h = s * 0.5
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.strokeStyle = art.wallEdge
    ctx.lineWidth = Math.max(1, s * 0.04)
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    const blink = 0.45 + 0.4 * Math.sin(now / 340 + variant * 2)
    ctx.fillStyle = art.accent
    ctx.globalAlpha = blink
    ctx.fillRect(-w * 0.38, -h * 0.3, w * 0.76, h * 0.34)
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)'
    ctx.fillRect(-w * 0.38, h * 0.12, w * 0.5, h * 0.12)
  } else if (kind === 'pillar') {
    ctx.fillStyle = art.wallTop
    ctx.beginPath()
    ctx.ellipse(0, 0, s * 0.3, s * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = art.wallEdge
    ctx.lineWidth = Math.max(1, s * 0.05)
    ctx.stroke()
    ctx.fillStyle = art.accentSoft
    ctx.beginPath()
    ctx.ellipse(0, -s * 0.06, s * 0.16, s * 0.1, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'mushroom') {
    const cap = s * (0.3 + (variant % 3) * 0.06)
    const sway = Math.sin(now / 700 + variant) * s * 0.03
    ctx.strokeStyle = '#d1fae5'
    ctx.lineWidth = Math.max(1, s * 0.07)
    ctx.beginPath()
    ctx.moveTo(0, s * 0.26)
    ctx.lineTo(sway, -cap * 0.2)
    ctx.stroke()
    ctx.fillStyle = variant % 2 === 0 ? '#c084fc' : '#f0abfc'
    ctx.beginPath()
    ctx.ellipse(sway, -cap * 0.28, cap, cap * 0.6, 0, Math.PI, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.beginPath()
    ctx.arc(sway - cap * 0.3, -cap * 0.42, cap * 0.13, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'vine') {
    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = Math.max(1, s * 0.06)
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath()
      ctx.moveTo(-s * 0.3 + i * s * 0.3, s * 0.28)
      ctx.quadraticCurveTo(-s * 0.2 + i * s * 0.3, -s * 0.1, -s * 0.05 + i * s * 0.3, -s * 0.3)
      ctx.stroke()
    }
  } else {
    // tank
    const w = s * 0.5
    const h = s * 0.7
    ctx.fillStyle = 'rgba(30, 41, 59, 0.92)'
    ctx.fillRect(-w / 2, -h / 2, w, h)
    ctx.strokeStyle = art.wallEdge
    ctx.lineWidth = Math.max(1, s * 0.04)
    ctx.strokeRect(-w / 2, -h / 2, w, h)
    const glow = 0.35 + 0.3 * Math.sin(now / 460 + variant)
    ctx.fillStyle = art.accent
    ctx.globalAlpha = glow
    ctx.fillRect(-w * 0.3, -h * 0.36, w * 0.6, h * 0.72)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
