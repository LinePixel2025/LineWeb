/**
 * 表情商店清单与素材转换
 *
 * 素材放在 `client/public/stickers/shop/`：
 *   - dango / cat / misc：`client/scripts/generate-sticker-shop.mjs` 生成的原创矢量；
 *   - twemoji：`client/scripts/fetch-twemoji-stickers.mjs` 下载的 Twemoji 子集
 *     （图形 CC-BY 4.0，署名见 `public/stickers/shop/twemoji/LICENSE.txt`）；
 *   - nailong / felyne：`server/scripts/fetch-sticker-packs.mjs` 从公开表情图库抓取并统一压到
 *     360px（来源与许可见各包目录的 `LICENSE.txt`）。
 * 商店只是「素材来源」：
 * 用户点保存后，这里把素材转成可上传文件（SVG 栅格化为 PNG；图片原样），
 * 再交给 XmppChatContext 的 addSticker 走与「收藏表情」完全相同的上传链路。
 */

export interface ShopStickerPack {
  id: string
  name: string
}

export interface ShopSticker {
  /** 与素材文件路径一致（用于记录已保存状态） */
  id: string
  name: string
  pack: string
  /** 同源静态地址 */
  src: string
}

export const STICKER_SHOP_PACKS: ShopStickerPack[] = [
  { id: 'nailong', name: '奶龙' },
  { id: 'felyne', name: '呆猫' },
  { id: 'dango', name: '团子日常' },
  { id: 'cat', name: '橘猫反应' },
  { id: 'misc', name: '通用符号' },
  { id: 'twemoji', name: '经典表情' },
]

type ShopStickerEntry = Omit<ShopSticker, 'src'> & { ext?: 'svg' | 'jpg' | 'png' | 'gif' }

function packEntries(
  pack: string,
  items: Array<[slug: string, name: string, ext: 'jpg' | 'png' | 'gif']>,
): ShopStickerEntry[] {
  return items.map(([slug, name, ext]) => ({ id: `${pack}/${slug}`, name, pack, ext }))
}

const NAILONG_ENTRIES = packEntries('nailong', [
  ['meeting', '开会', 'jpg'],
  ['newspaper', '看报', 'jpg'],
  ['wave', '招手', 'jpg'],
  ['hug', '抱抱', 'jpg'],
  ['sweet', '乖巧', 'jpg'],
  ['defiant', '不服', 'jpg'],
  ['handstand', '倒立', 'jpg'],
  ['punch', '出拳', 'jpg'],
  ['laugh', '大笑', 'jpg'],
  ['cheer', '欢呼', 'jpg'],
  ['akimbo', '叉腰', 'jpg'],
  ['chin', '托腮', 'jpg'],
  ['soccer', '足球', 'jpg'],
  ['meditate', '打坐', 'jpg'],
  ['shush', '嘘', 'jpg'],
  ['police', '警察', 'jpg'],
  ['cry', '流泪', 'jpg'],
  ['shock', '震惊', 'jpg'],
  ['thumb', '点赞', 'jpg'],
  ['milktea', '奶茶', 'jpg'],
  ['rofl', '狂笑', 'jpg'],
  ['double-thumb', '双赞', 'jpg'],
  ['eat', '干饭', 'jpg'],
  ['speechless', '无语', 'jpg'],
  ['angel', '天使', 'jpg'],
  ['happy', '开心', 'jpg'],
  ['glasses', '眼镜', 'jpg'],
  ['phone', '接电话', 'jpg'],
  ['heart', '比心', 'gif'],
  ['laugh-gif', '笑哭', 'gif'],
  ['wave-gif', '招手', 'gif'],
  ['swim', '游泳', 'gif'],
  ['akimbo-gif', '叉腰', 'gif'],
  ['arms', '抱臂', 'gif'],
  ['angel-gif', '天使', 'gif'],
  ['cuddle', '贴贴', 'gif'],
])

const FELYNE_ENTRIES = packEntries('felyne', [
  ['hello', '招手', 'gif'],
  ['light-off', '关灯', 'jpg'],
  ['knife', '亮刀', 'gif'],
  ['rice', '吃白饭', 'jpg'],
  ['cry', '大哭', 'png'],
  ['shy', '害羞', 'jpg'],
  ['annoy', '弄你', 'jpg'],
  ['nose', '抠鼻', 'gif'],
  ['clap', '拍手', 'gif'],
  ['punch', '出拳', 'gif'],
  ['touch', '摸摸', 'gif'],
  ['roll', '滚蛋', 'png'],
  ['stare', '瞪眼', 'jpg'],
  ['spirit', '精神', 'gif'],
  ['gimme', '给我', 'jpg'],
  ['run', '跑跑', 'jpg'],
  ['scratch', '躺挠', 'gif'],
  ['flower', '送花', 'jpg'],
  ['ride', '骑', 'gif'],
])

const ENTRIES: ShopStickerEntry[] = [
  ...NAILONG_ENTRIES,
  ...FELYNE_ENTRIES,
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
  { id: 'twemoji/1f600', name: '开心', pack: 'twemoji' },
  { id: 'twemoji/1f602', name: '笑哭', pack: 'twemoji' },
  { id: 'twemoji/1f605', name: '汗笑', pack: 'twemoji' },
  { id: 'twemoji/1f606', name: '大笑', pack: 'twemoji' },
  { id: 'twemoji/1f609', name: '眨眼', pack: 'twemoji' },
  { id: 'twemoji/1f60a', name: '害羞', pack: 'twemoji' },
  { id: 'twemoji/1f60d', name: '花痴', pack: 'twemoji' },
  { id: 'twemoji/1f618', name: '亲亲', pack: 'twemoji' },
  { id: 'twemoji/1f61c', name: '吐舌', pack: 'twemoji' },
  { id: 'twemoji/1f914', name: '思考', pack: 'twemoji' },
  { id: 'twemoji/1f928', name: '挑眉', pack: 'twemoji' },
  { id: 'twemoji/1f644', name: '白眼', pack: 'twemoji' },
  { id: 'twemoji/1f62d', name: '大哭', pack: 'twemoji' },
  { id: 'twemoji/1f621', name: '生气', pack: 'twemoji' },
  { id: 'twemoji/1f92c', name: '爆粗', pack: 'twemoji' },
  { id: 'twemoji/1f634', name: '睡觉', pack: 'twemoji' },
  { id: 'twemoji/1f971', name: '打哈欠', pack: 'twemoji' },
  { id: 'twemoji/1f923', name: '笑翻', pack: 'twemoji' },
  { id: 'twemoji/1f973', name: '庆祝', pack: 'twemoji' },
  { id: 'twemoji/1f97a', name: '委屈', pack: 'twemoji' },
  { id: 'twemoji/1f60e', name: '酷', pack: 'twemoji' },
  { id: 'twemoji/1f929', name: '星星眼', pack: 'twemoji' },
  { id: 'twemoji/1f970', name: '心动', pack: 'twemoji' },
  { id: 'twemoji/1f612', name: '无语', pack: 'twemoji' },
  { id: 'twemoji/1f60f', name: '得意', pack: 'twemoji' },
  { id: 'twemoji/1f614', name: '失落', pack: 'twemoji' },
  { id: 'twemoji/1f622', name: '流泪', pack: 'twemoji' },
  { id: 'twemoji/1f62e', name: '惊讶', pack: 'twemoji' },
  { id: 'twemoji/1f632', name: '震惊', pack: 'twemoji' },
  { id: 'twemoji/1f631', name: '尖叫', pack: 'twemoji' },
  { id: 'twemoji/1f620', name: '愤怒', pack: 'twemoji' },
  { id: 'twemoji/1f608', name: '小恶魔', pack: 'twemoji' },
  { id: 'twemoji/1f47b', name: '幽灵', pack: 'twemoji' },
  { id: 'twemoji/1f480', name: '骷髅', pack: 'twemoji' },
  { id: 'twemoji/1f921', name: '小丑', pack: 'twemoji' },
  { id: 'twemoji/1f916', name: '机器人', pack: 'twemoji' },
  { id: 'twemoji/1f44d', name: '赞', pack: 'twemoji' },
  { id: 'twemoji/1f44e', name: '踩', pack: 'twemoji' },
  { id: 'twemoji/1f44f', name: '鼓掌', pack: 'twemoji' },
  { id: 'twemoji/1f64c', name: '举手', pack: 'twemoji' },
  { id: 'twemoji/1f64f', name: '拜托', pack: 'twemoji' },
  { id: 'twemoji/1f91d', name: '握手', pack: 'twemoji' },
  { id: 'twemoji/270c', name: '胜利', pack: 'twemoji' },
  { id: 'twemoji/1f4aa', name: '加油', pack: 'twemoji' },
  { id: 'twemoji/1f440', name: '盯', pack: 'twemoji' },
  { id: 'twemoji/1f926', name: '捂脸', pack: 'twemoji' },
  { id: 'twemoji/1f937', name: '耸肩', pack: 'twemoji' },
  { id: 'twemoji/1f525', name: '火', pack: 'twemoji' },
  { id: 'twemoji/2764', name: '爱心', pack: 'twemoji' },
  { id: 'twemoji/1f494', name: '心碎', pack: 'twemoji' },
  { id: 'twemoji/1f389', name: '撒花', pack: 'twemoji' },
  { id: 'twemoji/1f38a', name: '彩带', pack: 'twemoji' },
  { id: 'twemoji/1f31f', name: '闪星', pack: 'twemoji' },
  { id: 'twemoji/2b50', name: '星星', pack: 'twemoji' },
  { id: 'twemoji/1f308', name: '彩虹', pack: 'twemoji' },
  { id: 'twemoji/1f319', name: '月亮', pack: 'twemoji' },
  { id: 'twemoji/2728', name: '闪光', pack: 'twemoji' },
  { id: 'twemoji/1f4af', name: '满分', pack: 'twemoji' },
  { id: 'twemoji/1f436', name: '狗', pack: 'twemoji' },
  { id: 'twemoji/1f431', name: '猫', pack: 'twemoji' },
  { id: 'twemoji/1f43c', name: '熊猫', pack: 'twemoji' },
  { id: 'twemoji/1f984', name: '独角兽', pack: 'twemoji' },
  { id: 'twemoji/1f34e', name: '苹果', pack: 'twemoji' },
  { id: 'twemoji/1f349', name: '西瓜', pack: 'twemoji' },
  { id: 'twemoji/2615', name: '咖啡', pack: 'twemoji' },
  { id: 'twemoji/1f37a', name: '啤酒', pack: 'twemoji' },
  { id: 'twemoji/1f382', name: '蛋糕', pack: 'twemoji' },
  { id: 'twemoji/1f381', name: '礼物', pack: 'twemoji' },
  { id: 'twemoji/1f680', name: '火箭', pack: 'twemoji' },
  { id: 'twemoji/1f3c6', name: '奖杯', pack: 'twemoji' },
  { id: 'twemoji/1f3ae', name: '游戏', pack: 'twemoji' },
  { id: 'twemoji/26bd', name: '足球', pack: 'twemoji' },
]

export const STICKER_SHOP: ShopSticker[] = ENTRIES.map(({ ext = 'svg', ...entry }) => ({
  ...entry,
  src: `/stickers/shop/${entry.id}.${ext}`,
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

/** 把商店素材转成可上传的文件（SVG → 360px PNG；图片/GIF 原样） */
export async function shopStickerToFile(sticker: ShopSticker): Promise<File> {
  const response = await fetch(sticker.src)
  if (!response.ok) throw new Error('表情素材下载失败')
  const blob = await response.blob()

  if (!sticker.src.endsWith('.svg')) {
    const ext = sticker.src.split('.').pop() || 'png'
    const base = sticker.id.split('/').pop() || 'sticker'
    const mime = blob.type || (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
    return new File([blob], `${base}.${ext}`, { type: mime })
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
