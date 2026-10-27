/**
 * 聊天图片预处理
 *
 * neko 的上传上限是 8MB，且只按魔数识别 PNG/JPEG/GIF/WebP；这里在浏览器侧先压缩，
 * 避免手机直出照片（常见 3–8MB）上传失败或过慢。
 *   - GIF 原样保留（压缩会丢动画）——超过上限直接报错
 *   - ≤300KB 原样上传
 *   - 其余按最长边 1920 缩放到 JPEG(0.85)，只有更小才采用
 */

export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024
const PASSTHROUGH_BYTES = 300 * 1024
const MAX_EDGE = 1920
const JPEG_QUALITY = 0.85
/** 表情走小图：neko 原生客户端也是 360px PNG */
const STICKER_MAX_EDGE = 360

function toFile(blob: Blob, name: string): File {
  if (typeof File === 'function') return new File([blob], name, { type: blob.type })
  // 极老环境没有 File 构造函数：用 Blob 冒充（FormData 同样接受）
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

function encodeJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  return encodeImage(source, width, height, 'image/jpeg', JPEG_QUALITY)
}

function encodePng(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  return encodeImage(source, width, height, 'image/png')
}

/**
 * 把待发送图片压缩到 neko 可接受的范围；无法压缩时在超限情况下抛错。
 */
export async function prepareChatImage(file: File): Promise<File> {
  if (typeof file.type === 'string' && file.type && !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    if (file.type === 'image/gif') throw new Error('图片不能超过 8MB')
  }
  if (file.type === 'image/gif' || file.size <= PASSTHROUGH_BYTES) {
    if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('图片不能超过 8MB')
    return file
  }

  const decoded = await decode(file)
  if (!decoded) {
    if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('图片不能超过 8MB')
    return file
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const encoded = await encodeJpeg(decoded.source, width, height)
    if (!encoded) {
      if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('图片不能超过 8MB')
      return file
    }
    if (encoded.size >= file.size || encoded.size > MAX_CHAT_IMAGE_BYTES) {
      if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('图片不能超过 8MB')
      return file
    }
    const base = (file.name || 'image').replace(/\.[^.]+$/, '')
    return toFile(encoded, `${base || 'image'}.jpg`)
  } finally {
    decoded.release()
  }
}

/**
 * 把待收藏的图片压成表情尺寸（最长边 360 的 PNG，保留透明通道）。
 *
 * GIF 原样保留（压缩会丢动画，neko 上限 8MB）；其余格式转 PNG，
 * 只有更小时才采用，避免把小图放大或编码反而变大。
 */
export async function prepareStickerImage(file: File): Promise<File> {
  if (typeof file.type === 'string' && file.type && !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('图片不能超过 8MB')
  if (file.type === 'image/gif') return file

  const decoded = await decode(file)
  if (!decoded) return file

  try {
    const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const encoded = await encodePng(decoded.source, width, height)
    if (!encoded || encoded.size >= file.size || encoded.size > MAX_CHAT_IMAGE_BYTES) {
      return file
    }
    const base = (file.name || 'sticker').replace(/\.[^.]+$/, '')
    return toFile(encoded, `${base || 'sticker'}.png`)
  } finally {
    decoded.release()
  }
}
