/**
 * 表情商店清单与素材转换
 *
 * 素材放在 `client/public/stickers/shop/*.svg`，由 `client/scripts/generate-sticker-shop.mjs`
 * 生成（原创矢量，无第三方版权）。商店只是「素材来源」：
 * 用户点保存后，这里把 SVG 栅格化成 PNG（neko 只接受 PNG/JPEG/GIF/WebP），
 * 再交给 XmppChatContext 的 addSticker 走与「收藏表情」完全相同的上传链路。
 */

export interface ShopStickerPack {
  id: string
  name: string
}

export interface ShopSticker {
  /** 与素材文件名一致（用于记录已保存状态） */
  id: string
  name: string
  pack: string
  /** 同源静态地址 */
  src: string
}

export const STICKER_SHOP_PACKS: ShopStickerPack[] = [
  { id: 'dango', name: '团子日常' },
  { id: 'cat', name: '橘猫反应' },
  { id: 'misc', name: '通用符号' },
]

const ENTRIES: Array<Omit<ShopSticker, 'src'>> = [
  { id: 'dango-hi', name: '打招呼', pack: 'dango' },
  { id: 'dango-laugh', name: '笑死', pack: 'dango' },
  { id: 'dango-shock', name: '震惊', pack: 'dango' },
  { id: 'dango-sleep', name: '睡觉', pack: 'dango' },
  { id: 'cat-like', name: '喵赞', pack: 'cat' },
  { id: 'cat-fish', name: '吃鱼', pack: 'cat' },
  { id: 'cat-angry', name: '生气', pack: 'cat' },
  { id: 'cat-heart', name: '比心', pack: 'cat' },
  { id: 'shop-thumb', name: '点赞', pack: 'misc' },
  { id: 'shop-ok', name: '收到', pack: 'misc' },
  { id: 'shop-heart', name: '爱心', pack: 'misc' },
  { id: 'shop-cheer', name: '加油', pack: 'misc' },
]

export const STICKER_SHOP: ShopSticker[] = ENTRIES.map((entry) => ({
  ...entry,
  src: `/stickers/shop/${entry.id}.svg`,
}))

const SAVED_KEY = 'lineweb_sticker_shop_saved'

/** 已保存过的商店表情 id（仅用于 UI 显示「已保存」，不作为发送依据） */
export function readSavedShopStickerIds(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function writeSavedShopStickerIds(ids: string[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(Array.from(new Set(ids))))
  } catch {
    // 隐私模式等无法写入：忽略，仅影响「已保存」标记
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('表情素材加载失败'))
    image.src = src
  })
}

/** 把商店素材转成可上传的 PNG 文件（最长边 360，与收藏表情一致） */
export async function shopStickerToFile(sticker: ShopSticker): Promise<File> {
  const response = await fetch(sticker.src)
  if (!response.ok) throw new Error('表情素材下载失败')
  const blob = await response.blob()

  if (!sticker.src.endsWith('.svg')) {
    return new File([blob], `${sticker.id}.png`, { type: blob.type || 'image/png' })
  }

  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = 360
    canvas.height = 360
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持表情转换')
    context.drawImage(image, 0, 0, 360, 360)
    const png = await new Promise<Blob | null>((resolve) => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null)
        return
      }
      canvas.toBlob((result) => resolve(result), 'image/png')
    })
    if (!png) throw new Error('表情转换失败')
    return new File([png], `${sticker.id}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
