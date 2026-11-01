import { memo, useState, useEffect, type CSSProperties } from 'react'
import { useOptionalPoints } from '../contexts/PointsContext'
import { PREMIUM_AVATAR_FRAMES, type AvatarFrameStyle } from '../types/points'
import { loadAvatar, peekAvatar } from '../lib/avatarCache'

interface UserAvatarProps {
  userId: number
  username: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** 头像框样式；不传时，若是当前登录用户则自动套用已佩戴的头像框 */
  frame?: AvatarFrameStyle | null
}

const SIZE_MAP = { sm: 24, md: 32, lg: 48, xl: 80 } as const

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const first = trimmed.charAt(0)
  if (/[a-zA-Z]/.test(first)) {
    return first.toUpperCase()
  }
  return first
}

function getColor(userId: number): string {
  // 负数 id（原生 neko 账号 / 群聊）取绝对值，避免出现负色相
  const hue = (Math.abs(userId) * 137.508) % 360
  return `hsl(${hue}, 50%, 50%)`
}

export default memo(function UserAvatar({ userId, username, size = 'md', frame }: UserAvatarProps) {
  const px = SIZE_MAP[size]
  // 头像按 userId 做模块级缓存：同一发送者只请求一次，避免聊天列表里几十个并发 fetch
  const [imgSrc, setImgSrc] = useState<string | null>(() => peekAvatar(userId) ?? null)
  const [failed, setFailed] = useState(false)
  // 未显式传入时，本人头像自动套用积分中心里佩戴的头像框（他人头像由调用方传 frame）
  const points = useOptionalPoints()
  const ownProfile = points?.profile ?? null
  const selfFrame = ownProfile && ownProfile.userId === userId
    ? ownProfile.avatarFrame?.frame ?? null
    : null
  const frameStyle = frame ?? selfFrame

  useEffect(() => {
    setFailed(false)
    // 负数 id 是原生 neko 账号 / 群聊的合成标识，不存在 LineWeb 头像，直接用首字母兜底
    if (userId <= 0) {
      setImgSrc(null)
      setFailed(true)
      return
    }

    const cached = peekAvatar(userId)
    if (cached !== undefined) {
      setImgSrc(cached)
      return
    }

    let cancelled = false
    void loadAvatar(userId).then((url) => {
      if (cancelled) return
      setImgSrc(url)
      if (!url) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  let content
  if (imgSrc && !failed) {
    content = (
      <img
        src={imgSrc}
        alt={username}
        loading="lazy"
        decoding="async"
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  } else {
    content = (
      <div
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          background: getColor(userId),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: px * 0.4,
          fontWeight: 600,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {getInitials(username)}
      </div>
    )
  }

  if (!frameStyle) return content

  // 炸裂系列框额外渲染装饰层（余烬 / 闪弧 / 星芒）；层本身绝对定位，不改变头像占位尺寸
  const premiumFx = (PREMIUM_AVATAR_FRAMES as readonly string[]).includes(frameStyle)

  // 包裹层不改变原有占位尺寸：外圈用绝对定位的伪元素绘制，不占布局
  return (
    <span
      className={`gh-avatar-frame gh-avatar-frame--${frameStyle}`}
      style={{ '--avatar-size': `${px}px` } as CSSProperties}
      data-frame={frameStyle}
    >
      {content}
      {premiumFx && (
        <span className="gh-avatar-frame-fx" aria-hidden>
          <i /><i /><i /><i />
        </span>
      )}
    </span>
  )
})
