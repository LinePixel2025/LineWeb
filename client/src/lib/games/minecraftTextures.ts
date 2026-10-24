/**
 * 我的世界 —— 程序化纹理图集（Canvas 逐像素绘制，无外部素材）
 *
 * 全部贴图为 16×16 像素的**原创程序化生成**（受随机种子控制的噪声 + 图案），
 * 风格致敬像素沙盒游戏但不含任何第三方版权素材；打包进 128×64 的图集
 * （8 列 × 4 行），渲染时用 NearestFilter 保持像素风。
 *
 * 本文件依赖 DOM（canvas），不参与 vitest / 服务端自检。
 */

import { MC_BLOCK } from './minecraft'

export const MC_ATLAS_COLS = 8
export const MC_ATLAS_ROWS = 4
export const MC_TILE_PX = 16

/** 图集中各贴图的槽位（与绘制顺序一一对应） */
export const MC_TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  PLANKS: 5,
  LOG_SIDE: 6,
  LOG_TOP: 7,
  LEAVES: 8,
  SAND: 9,
  GRAVEL: 10,
  WATER: 11,
  GLASS: 12,
  BRICK: 13,
  SNOW: 14,
  SNOW_SIDE: 15,
  BEDROCK: 16,
  COAL: 17,
  IRON: 18,
  DIAMOND: 19,
} as const

/** 每个方块 [顶面, 底面, 侧面] 的贴图槽位 */
const BLOCK_FACES: Record<number, [number, number, number]> = {
  [MC_BLOCK.GRASS]: [MC_TILE.GRASS_TOP, MC_TILE.DIRT, MC_TILE.GRASS_SIDE],
  [MC_BLOCK.DIRT]: [MC_TILE.DIRT, MC_TILE.DIRT, MC_TILE.DIRT],
  [MC_BLOCK.STONE]: [MC_TILE.STONE, MC_TILE.STONE, MC_TILE.STONE],
  [MC_BLOCK.COBBLESTONE]: [MC_TILE.COBBLE, MC_TILE.COBBLE, MC_TILE.COBBLE],
  [MC_BLOCK.PLANKS]: [MC_TILE.PLANKS, MC_TILE.PLANKS, MC_TILE.PLANKS],
  [MC_BLOCK.LOG]: [MC_TILE.LOG_TOP, MC_TILE.LOG_TOP, MC_TILE.LOG_SIDE],
  [MC_BLOCK.LEAVES]: [MC_TILE.LEAVES, MC_TILE.LEAVES, MC_TILE.LEAVES],
  [MC_BLOCK.SAND]: [MC_TILE.SAND, MC_TILE.SAND, MC_TILE.SAND],
  [MC_BLOCK.GRAVEL]: [MC_TILE.GRAVEL, MC_TILE.GRAVEL, MC_TILE.GRAVEL],
  [MC_BLOCK.WATER]: [MC_TILE.WATER, MC_TILE.WATER, MC_TILE.WATER],
  [MC_BLOCK.GLASS]: [MC_TILE.GLASS, MC_TILE.GLASS, MC_TILE.GLASS],
  [MC_BLOCK.BRICK]: [MC_TILE.BRICK, MC_TILE.BRICK, MC_TILE.BRICK],
  [MC_BLOCK.SNOW]: [MC_TILE.SNOW, MC_TILE.DIRT, MC_TILE.SNOW_SIDE],
  [MC_BLOCK.BEDROCK]: [MC_TILE.BEDROCK, MC_TILE.BEDROCK, MC_TILE.BEDROCK],
  [MC_BLOCK.COAL_ORE]: [MC_TILE.COAL, MC_TILE.COAL, MC_TILE.COAL],
  [MC_BLOCK.IRON_ORE]: [MC_TILE.IRON, MC_TILE.IRON, MC_TILE.IRON],
  [MC_BLOCK.DIAMOND_ORE]: [MC_TILE.DIAMOND, MC_TILE.DIAMOND, MC_TILE.DIAMOND],
}

/** face: 0 = 顶, 1 = 底, 2 = 侧 */
export function mcBlockFaceTile(block: number, face: number): number {
  const faces = BLOCK_FACES[block]
  if (!faces) return MC_TILE.STONE
  if (face === 0) return faces[0]
  if (face === 1) return faces[1]
  return faces[2]
}

// === 绘制工具 ===

/** 确定性 LCG 随机数（贴图逐像素抖动用，保证每次生成视觉一致） */
function createTileRng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

interface TilePainter {
  /** 向 16×16 像素区域写颜色（r/g/b/a 各 0-255） */
  (x: number, y: number, rng: () => number): [number, number, number, number]
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** 基础色 + 随机明度抖动 */
function noisy(base: [number, number, number], variance: number, alpha = 255): TilePainter {
  return (_x, _y, rng) => {
    const d = (rng() - 0.5) * 2 * variance
    return [clamp255(base[0] + d), clamp255(base[1] + d), clamp255(base[2] + d), alpha]
  }
}

function speckle(
  base: TilePainter,
  speck: [number, number, number],
  probability: number,
  alpha = 255,
): TilePainter {
  return (x, y, rng) => {
    if (rng() < probability) return [speck[0], speck[1], speck[2], alpha]
    return base(x, y, rng)
  }
}

/** 各贴图的绘制函数（索引与 MC_TILE 一致） */
const PAINTERS: TilePainter[] = [
  // 0 草方块顶面
  speckle(noisy([106, 170, 64], 22), [88, 148, 50], 0.18),
  // 1 草方块侧面（泥土 + 顶部参差草皮，每列草皮下探 2-4 像素）
  (x, y, rng) => {
    const colRng = createTileRng(x * 7919 + 13)
    const greenDepth = 2 + Math.floor(colRng() * 3)
    if (y < greenDepth) {
      const v = (rng() - 0.5) * 30
      return [clamp255(98 + v), clamp255(160 + v), clamp255(58 + v), 255]
    }
    const v = (rng() - 0.5) * 2 * 20
    const dark = rng() < 0.06 ? -26 : 0
    return [clamp255(134 + v + dark), clamp255(97 + v + dark), clamp255(66 + v + dark), 255]
  },
  // 2 泥土
  speckle(noisy([134, 97, 66], 20), [104, 74, 48], 0.08),
  // 3 石头
  speckle(noisy([138, 138, 138], 16), [112, 112, 114], 0.1),
  // 4 圆石（石块拼贴 + 深色缝）
  (x, y, rng) => {
    const row = Math.floor(y / 4)
    const offset = (row % 2) * 3
    const inCellX = (x + offset) % 6
    const inCellY = y % 4
    const edge = inCellX === 0 || inCellY === 0
    const v = (rng() - 0.5) * 18
    const b = edge ? 96 : 142
    return [clamp255(b + v), clamp255(b + v), clamp255(b + 2 + v), 255]
  },
  // 5 木板（横向板条 + 板缝 + 木纹）
  (x, y, rng) => {
    if (y % 4 === 3) return [122, 90, 51, 255]
    const row = Math.floor(y / 4)
    const joint = (x + row * 7) % 16 === 0
    if (joint) return [130, 98, 56, 255]
    const grain = (x * 3 + y * 7) % 11 === 0 ? -14 : 0
    const v = (rng() - 0.5) * 14
    return [clamp255(184 + v + grain), clamp255(148 + v + grain), clamp255(95 + v + grain), 255]
  },
  // 6 原木侧面（竖向条纹）
  (x, y, rng) => {
    const stripe = (x * 5 + Math.floor(y / 5)) % 7 < 2 ? -22 : 0
    const v = (rng() - 0.5) * 10
    return [clamp255(107 + v + stripe), clamp255(79 + v + stripe), clamp255(46 + v + stripe), 255]
  },
  // 7 原木顶面（年轮方环）
  (x, y, rng) => {
    const ring = Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))) % 2
    const v = (rng() - 0.5) * 8
    const base = ring === 0 ? [176, 142, 90] : [148, 114, 66]
    if (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 6.5) return [clamp255(96 + v), clamp255(72 + v), clamp255(42 + v), 255]
    return [clamp255(base[0] + v), clamp255(base[1] + v), clamp255(base[2] + v), 255]
  },
  // 8 树叶（深浅绿斑 + 少量深洞）
  speckle(noisy([62, 122, 40], 30), [34, 70, 22], 0.1),
  // 9 沙子
  speckle(noisy([219, 207, 160], 14), [198, 184, 134], 0.08),
  // 10 沙砾（多色碎石）
  (x, _y, rng) => {
    const palette: Array<[number, number, number]> = [
      [141, 141, 141],
      [122, 122, 122],
      [154, 154, 148],
      [111, 106, 102],
      [128, 118, 108],
    ]
    return [...palette[Math.floor(rng() * palette.length)], 255]
  },
  // 11 水（半透明蓝 + 波纹亮带）
  (x, y, rng) => {
    const wave = (x + y * 2) % 8 < 2 ? 18 : 0
    const v = (rng() - 0.5) * 10
    return [clamp255(63 + v + wave), clamp255(102 + v + wave), clamp255(212 + v + wave), 196]
  },
  // 12 玻璃（几乎全透 + 边框 + 斜向高光）
  (x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15
    if (border) return [207, 232, 242, 170]
    const streak = (x + y) % 16 === 5 || (x + y) % 16 === 6
    if (streak) return [235, 248, 252, 110]
    return [220, 240, 248, 22]
  },
  // 13 砖块（错缝砖 + 灰浆）
  (x, y, rng) => {
    const row = Math.floor(y / 4)
    const mortarH = y % 4 === 3
    const mortarV = (x + (row % 2) * 4) % 8 === 0
    if (mortarH || mortarV) {
      const v = (rng() - 0.5) * 10
      return [clamp255(158 + v), clamp255(154 + v), clamp255(148 + v), 255]
    }
    const v = (rng() - 0.5) * 16
    return [clamp255(150 + v), clamp255(71 + v), clamp255(61 + v), 255]
  },
  // 14 雪块
  speckle(noisy([242, 246, 250], 8), [226, 232, 240], 0.1),
  // 15 雪的侧面（泥土 + 顶部雪盖）
  (x, y, rng) => {
    if (y < 3) {
      const v = (rng() - 0.5) * 10
      return [clamp255(242 + v), clamp255(246 + v), clamp255(250 + v), 255]
    }
    const v = (rng() - 0.5) * 2 * 20
    const dark = rng() < 0.06 ? -26 : 0
    return [clamp255(134 + v + dark), clamp255(97 + v + dark), clamp255(66 + v + dark), 255]
  },
  // 16 基岩（深浅反差大的杂色）
  (x, _y, rng) => {
    const palette: Array<[number, number, number]> = [[86, 86, 86], [51, 51, 51], [106, 106, 106], [34, 34, 34]]
    return [...palette[Math.floor(rng() * palette.length)], 255]
  },
  // 17-19 矿石（石头底 + 矿物斑点团）
  ...([MC_TILE.COAL, MC_TILE.IRON, MC_TILE.DIAMOND] as const).map((tile) => {
    const oreColor: Record<number, [number, number, number]> = {
      [MC_TILE.COAL]: [44, 44, 46],
      [MC_TILE.IRON]: [216, 171, 133],
      [MC_TILE.DIAMOND]: [92, 227, 216],
    }
    // 确定性斑点中心（每 tile 固定 4 团）
    const centers: Array<[number, number]> = []
    const rng = createTileRng(tile * 977 + 31)
    for (let i = 0; i < 4; i += 1) centers.push([2 + Math.floor(rng() * 12), 2 + Math.floor(rng() * 12)])
    return (x: number, y: number, pixelRng: () => number): [number, number, number, number] => {
      for (const [cx, cy] of centers) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy <= 2) {
          const v = (pixelRng() - 0.5) * 20
          const base = oreColor[tile]
          return [clamp255(base[0] + v), clamp255(base[1] + v), clamp255(base[2] + v), 255]
        }
      }
      const v = (pixelRng() - 0.5) * 16
      const dark = pixelRng() < 0.1 ? -26 : 0
      return [clamp255(138 + v + dark), clamp255(138 + v + dark), clamp255(140 + v + dark), 255]
    }
  }),
]

let cachedAtlas: HTMLCanvasElement | null = null

/** 生成（并缓存）128×64 的纹理图集画布 */
export function buildMinecraftAtlas(): HTMLCanvasElement {
  if (cachedAtlas) return cachedAtlas
  const canvas = document.createElement('canvas')
  canvas.width = MC_ATLAS_COLS * MC_TILE_PX
  canvas.height = MC_ATLAS_ROWS * MC_TILE_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 画布上下文')
  const image = ctx.createImageData(canvas.width, canvas.height)
  const data = image.data

  for (let tile = 0; tile < PAINTERS.length; tile += 1) {
    const painter = PAINTERS[tile]
    const col = tile % MC_ATLAS_COLS
    const row = Math.floor(tile / MC_ATLAS_COLS)
    const rng = createTileRng(tile + 1)
    for (let py = 0; py < MC_TILE_PX; py += 1) {
      for (let px = 0; px < MC_TILE_PX; px += 1) {
        const [r, g, b, a] = painter(px, py, rng)
        const index = ((row * MC_TILE_PX + py) * canvas.width + col * MC_TILE_PX + px) * 4
        data[index] = r
        data[index + 1] = g
        data[index + 2] = b
        data[index + 3] = a
      }
    }
  }
  ctx.putImageData(image, 0, 0)
  cachedAtlas = canvas
  return canvas
}

const iconCache = new Map<string, string>()

/**
 * 单个贴图放大后的 dataURL（快捷栏 / 物品栏图标用）。
 * scale 为整数倍缩放（默认 ×3 = 48px），禁用平滑保持像素感。
 */
export function mcTileIconUrl(tile: number, scale: number = 3): string {
  const key = `${tile}:${scale}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const atlas = buildMinecraftAtlas()
  const canvas = document.createElement('canvas')
  canvas.width = MC_TILE_PX * scale
  canvas.height = MC_TILE_PX * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 画布上下文')
  ctx.imageSmoothingEnabled = false
  const col = tile % MC_ATLAS_COLS
  const row = Math.floor(tile / MC_ATLAS_COLS)
  ctx.drawImage(atlas, col * MC_TILE_PX, row * MC_TILE_PX, MC_TILE_PX, MC_TILE_PX, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/png')
  iconCache.set(key, url)
  return url
}
