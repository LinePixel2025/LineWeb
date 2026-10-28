/**
 * 聊天图片预处理（与 senlinjun/internet_neko 的 `compressImage` 逐条对齐）
 *
 * neko 的上传上限是 8MB，且只按魔数识别 PNG/JPEG/GIF/WebP；这里在浏览器侧先压缩，
 * 避免手机直出照片（常见 3–8MB）上传失败或过慢。
 *   - GIF 原样保留（压缩会丢动画），上限 5MB
 *   - 白名单类型且 ≤300KB 原样上传（保留 PNG 透明度）
 *   - 其余按用途缩放后重编码：照片最长边 1920 → JPEG(0.85)，表情最长边 360 → PNG
 *   - 重编码结果反而更大时回退原文件；非白名单类型（BMP/HEIC 等）不能保留，直接报错
 */

export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024
/** neko 前端对 GIF 的单独上限（canvas 重编码会丢动画，只能原样传） */
export const GIF_MAX_BYTES = 5 * 1024 * 1024
const PASSTHROUGH_BYTES = 300 * 1024
const MAX_EDGE = 1920
const JPEG_QUALITY = 0.85
/** 表情走小图：neko 原生客户端也是 360px PNG */
const STICKER_MAX_EDGE = 360
/** neko 服务端按魔数只认这四种 */
const UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

const UNSUPPORTED_MESSAGE = '仅支持 PNG/JPEG/GIF/WebP 图片'
const TOO_LARGE_MESSAGE = '图片不能超过 8MB'

function isAllowedMime(file: File): boolean {
  return UPLOAD_MIMES.includes(file.type)
}

function toFile(blob: Blob, name: string, type: string): File {
  if (typeof File === 'function') return new File([blob], name, { type })
  // 极老环境没有 File 构造函数：用 Blob 冒充（FormData/fetch 同样接受）
  return blob as unknown as File
}

async function decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; release: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        release: () => bitmap.close(),
      }
    } catch {
      // 回退到 <img>
    }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片解析失败'))
      element.src = url
    })
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      source: image,
      release: () => URL.revokeObjectURL(url),
    }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

function encodeImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return Promise.resolve(null)
  // PNG 没有透明背景会变成黑底：表情需要透明通道，先清空画布
  if (type === 'image/png') {
    context.clearRect(0, 0, width, height)
  }
  context.drawImage(source, 0, 0, width, height)
  return new Promise<Blob | null>((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null)
      return
    }
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

/**
 * 与 neko `compressImage(file, maxDim, reencodeMime)` 同语义。
 * 返回可直接上传的 File（类型交给 raw 上传的 Content-Type）。
 */
async function compressForUpload(
  file: File,
  maxDim: number,
  reencodeMime: 'image/jpeg' | 'image/png',
): Promise<File> {
  // GIF 原样传（canvas 会丢动画）
  if (file.type === 'image/gif') {
    if (file.size > GIF_MAX_BYTES) throw new Error('GIF 图片不能超过 5MB')
    return file
  }

  const rawTypeOk = isAllowedMime(file)
  // 小文件原样传（保留 PNG 透明度），与 neko 一致
  if (rawTypeOk && file.size <= PASSTHROUGH_BYTES) return file

  const decoded = await decode(file)
  if (!decoded) {
    // 浏览器无法解码（老环境/HEIC）：白名单内且未超限才允许直传
    if (!rawTypeOk) throw new Error(UNSUPPORTED_MESSAGE)
    if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error(TOO_LARGE_MESSAGE)
    return file
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const encoded = await encodeImage(
      decoded.source,
      width,
      height,
      reencodeMime,
      reencodeMime === 'image/jpeg' ? JPEG_QUALITY : undefined,
    )
    // 个别浏览器会回退成 PNG 编码导致体积反增：只有更小才采用
    if (encoded && encoded.size < file.size) {
      if (encoded.size > MAX_CHAT_IMAGE_BYTES) throw new Error(TOO_LARGE_MESSAGE)
      const ext = reencodeMime === 'image/jpeg' ? 'jpg' : 'png'
      const base = (file.name || 'image').replace(/\.[^.]+$/, '')
      return toFile(encoded, `${base || 'image'}.${ext}`, reencodeMime)
    }
    // 非白名单类型不能原样直传（服务端按魔数拒绝）
    if (!rawTypeOk) throw new Error(UNSUPPORTED_MESSAGE)
    if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error(TOO_LARGE_MESSAGE)
    return file
  } finally {
    decoded.release()
  }
}

/** 照片：最长边 1920 的 JPEG(0.85)，GIF 原样保留 */
export async function prepareChatImage(file: File): Promise<File> {
  return compressForUpload(file, MAX_EDGE, 'image/jpeg')
}

/** 表情：最长边 360 的 PNG（保留透明通道），GIF 原样保留 */
export async function prepareStickerImage(file: File): Promise<File> {
  return compressForUpload(file, STICKER_MAX_EDGE, 'image/png')
}
