type Area = {
  x: number
  y: number
  width: number
  height: number
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(new Error(`图片加载失败: ${e}`))
    img.src = url
  })
}

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  outputMimeType = 'image/jpeg',
  outputQuality = 0.92,
): Promise<Blob> {
  const image = await createImage(imageSrc)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Canvas 2D 上下文不可用')
  }

  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Canvas 裁剪失败'))
        }
      },
      outputMimeType,
      outputQuality,
    )
  })
}
