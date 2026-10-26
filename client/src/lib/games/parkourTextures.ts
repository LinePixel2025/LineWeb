import * as THREE from 'three'

/** 霓虹跑酷的程序化 Canvas 纹理（无外部图片资源） */

function canvas2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D canvas 上下文')
  return ctx
}

function finishTexture(ctx: CanvasRenderingContext2D, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(ctx.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.anisotropy = 4
  return texture
}

/** 深色沥青 + 细碎反光；平铺到整条赛道 */
export function createAsphaltTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(256, 512)
  const gradient = ctx.createLinearGradient(0, 0, 0, 512)
  gradient.addColorStop(0, '#121525')
  gradient.addColorStop(0.5, '#0c0f1c')
  gradient.addColorStop(1, '#15192a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 512)
  for (let i = 0; i < 2200; i += 1) {
    const alpha = 0.02 + Math.random() * 0.08
    ctx.fillStyle = Math.random() > 0.72 ? `rgba(125, 211, 252, ${alpha})` : `rgba(255, 255, 255, ${alpha * 0.5})`
    const size = Math.random() * 2 + 0.5
    ctx.fillRect(Math.random() * 256, Math.random() * 512, size, size)
  }
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.08)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, 256)
  ctx.lineTo(256, 256)
  ctx.stroke()
  return finishTexture(ctx, 2, 1800)
}

/** 霓虹楼体窗灯（两种色温） */
export function createBuildingTexture(variant: 'cool' | 'warm' = 'cool'): THREE.CanvasTexture {
  const ctx = canvas2d(128, 256)
  ctx.fillStyle = variant === 'cool' ? '#080c18' : '#100b18'
  ctx.fillRect(0, 0, 128, 256)
  const cool = ['#65e6ff', '#8aa4ff', '#c4b5fd']
  const warm = ['#ffd28a', '#ff8f6b', '#ffb86b']
  const colors = variant === 'cool' ? cool : warm
  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const lit = Math.random() > 0.46
      ctx.fillStyle = lit
        ? colors[Math.floor(Math.random() * colors.length)]
        : 'rgba(20, 28, 48, 0.85)'
      ctx.globalAlpha = lit ? 0.55 + Math.random() * 0.45 : 0.55
      ctx.fillRect(8 + col * 20, 8 + row * 15, 9, 6)
    }
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
  for (let row = 0; row < 16; row += 1) ctx.fillRect(0, 8 + row * 15 + 8, 128, 1)
  return finishTexture(ctx, 2, 3)
}

/** 列车车体：金属暗色 + 亮窗 */
export function createTrainTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(128, 256)
  const gradient = ctx.createLinearGradient(0, 0, 128, 0)
  gradient.addColorStop(0, '#151c2f')
  gradient.addColorStop(0.5, '#27324a')
  gradient.addColorStop(1, '#111827')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 256)
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.fillStyle = Math.random() > 0.25 ? '#7ee7ff' : '#ffd38a'
      ctx.globalAlpha = 0.55 + Math.random() * 0.35
      ctx.fillRect(12 + col * 38, 20 + row * 38, 24, 16)
    }
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255, 89, 122, 0.8)'
  ctx.fillRect(0, 4, 128, 2)
  ctx.fillStyle = 'rgba(101, 230, 255, 0.55)'
  ctx.fillRect(0, 250, 128, 2)
  return finishTexture(ctx, 1, 2)
}

/** 低路障的黄黑反光条纹 */
export function createBarrierTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(128, 64)
  ctx.fillStyle = '#171a24'
  ctx.fillRect(0, 0, 128, 64)
  ctx.save()
  ctx.translate(-32, 0)
  ctx.rotate(-0.55)
  for (let i = -4; i < 18; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? '#ffcc4d' : '#22242e'
    ctx.fillRect(i * 20, -40, 12, 180)
  }
  ctx.restore()
  return finishTexture(ctx, 1, 1)
}

/** 悬空广告牌 / 霓虹文字 */
export function createSignTexture(label = 'NIGHT RUN', accent = '#65e6ff'): THREE.CanvasTexture {
  const ctx = canvas2d(256, 128)
  ctx.fillStyle = '#080b17'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = accent
  ctx.lineWidth = 4
  ctx.shadowColor = accent
  ctx.shadowBlur = 14
  ctx.strokeRect(8, 8, 240, 112)
  ctx.font = '700 30px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = accent
  ctx.shadowBlur = 18
  ctx.fillText(label, 128, 58)
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(224, 242, 254, 0.75)'
  ctx.shadowBlur = 6
  ctx.fillText('NEON DISTRICT', 128, 92)
  return finishTexture(ctx, 1, 1)
}

/** 800m 终点横幅 */
export function createFinishTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(512, 128)
  ctx.fillStyle = '#070912'
  ctx.fillRect(0, 0, 512, 128)
  ctx.strokeStyle = '#65e6ff'
  ctx.lineWidth = 5
  ctx.shadowColor = '#65e6ff'
  ctx.shadowBlur = 20
  ctx.strokeRect(10, 10, 492, 108)
  ctx.font = '800 58px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e7fbff'
  ctx.shadowColor = '#65e6ff'
  ctx.shadowBlur = 26
  ctx.fillText('FINISH', 256, 58)
  ctx.font = '600 14px "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = '#ff8f9c'
  ctx.shadowColor = '#ff4d6d'
  ctx.fillText('800 m · NEON DISTRICT', 256, 98)
  return finishTexture(ctx, 1, 1)
}

/** 夜空球体：深靛蓝 → 霓虹地平线 + 星点 + 月亮 */
export function createSkyTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(1024, 512)
  const gradient = ctx.createLinearGradient(0, 0, 0, 512)
  gradient.addColorStop(0, '#04030d')
  gradient.addColorStop(0.38, '#150a2d')
  gradient.addColorStop(0.63, '#45174f')
  gradient.addColorStop(0.75, '#b53e63')
  gradient.addColorStop(0.84, '#ff7a59')
  gradient.addColorStop(1, '#160d26')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1024, 512)

  for (let i = 0; i < 260; i += 1) {
    const y = Math.random() * 300
    ctx.globalAlpha = 0.25 + Math.random() * 0.7
    ctx.fillStyle = Math.random() > 0.8 ? '#9ce7ff' : '#ffffff'
    const size = Math.random() > 0.9 ? 2 : 1
    ctx.fillRect(Math.random() * 1024, y, size, size)
  }
  ctx.globalAlpha = 1

  const moon = ctx.createRadialGradient(720, 118, 10, 720, 118, 74)
  moon.addColorStop(0, 'rgba(255, 246, 220, 0.95)')
  moon.addColorStop(0.34, 'rgba(255, 219, 178, 0.55)')
  moon.addColorStop(1, 'rgba(255, 150, 160, 0)')
  ctx.fillStyle = moon
  ctx.beginPath()
  ctx.arc(720, 118, 74, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 249, 230, 0.9)'
  ctx.beginPath()
  ctx.arc(720, 118, 26, 0, Math.PI * 2)
  ctx.fill()

  const texture = finishTexture(ctx, 1, 1)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/** 径向光晕（金币 / 路灯 / 冲击） */
export function createGlowTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(128, 128)
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.25, 'rgba(160, 240, 255, 0.7)')
  gradient.addColorStop(1, 'rgba(80, 180, 255, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  return finishTexture(ctx, 1, 1)
}

/** 玩家脚底柔和阴影 */
export function createShadowTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(128, 128)
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  return finishTexture(ctx, 1, 1)
}

/** 幽灵头顶名字标签 */
export function createLabelTexture(name: string, color: string): THREE.CanvasTexture {
  const ctx = canvas2d(256, 64)
  ctx.clearRect(0, 0, 256, 64)
  ctx.fillStyle = 'rgba(4, 7, 18, 0.72)'
  ctx.beginPath()
  ctx.roundRect(8, 10, 240, 44, 14)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(30, 32, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '600 20px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f4f8ff'
  ctx.fillText(name.slice(0, 14), 48, 33)
  return finishTexture(ctx, 1, 1)
}

/** 金币面向相机的发光贴图（用作 Sprite 光晕） */
export function createCoinGlowTexture(): THREE.CanvasTexture {
  const ctx = canvas2d(64, 64)
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255, 247, 196, 0.9)')
  gradient.addColorStop(0.35, 'rgba(255, 204, 77, 0.45)')
  gradient.addColorStop(1, 'rgba(255, 170, 20, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return finishTexture(ctx, 1, 1)
}
