import { memo, useState, useEffect, type CSSProperties } from 'react'
import { useOptionalPoints } from '../contexts/PointsContext'
import type { AvatarFrameStyle } from '../types/points'

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
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // 未显式传入时，本人头像自动套用积分中心里佩戴的头像框（他人头像由调用方传 frame）
  const points = useOptionalPoints()
  const ownProfile = points?.profile ?? null
  const selfFrame = ownProfile && ownProfile.userId === userId
    ? ownProfile.avatarFrame?.frame ?? null
    : null
  const frameStyle = frame ?? selfFrame

  useEffect(() => {
    setImgSrc(null)
    setFailed(false)
    // 负数 id 是原生 neko 账号 / 群聊的合成标识，不存在 LineWeb 头像，直接用首字母兜底
    if (userId <= 0) {
      setFailed(true)
      return
    }
    const controller = new AbortController()

    const token = localStorage.getItem('lineweb_token')
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    fetch(`/api/auth/avatar/${userId}`, {
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(res => {
        if (res.ok && res.status !== 204) {
          return res.blob().then(blob => {
            setImgSrc(URL.createObjectURL(blob))
          })
        }
        setFailed(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => controller.abort()
  }, [userId])

  useEffect(() => {
    return () => {
      if (imgSrc) URL.revokeObjectURL(imgSrc)
    }
  }, [imgSrc])

  let content
  if (imgSrc && !failed) {
    content = (
      <img
        src={imgSrc}
        alt={username}
        loading="lazy"
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

  // 包裹层不改变原有占位尺寸：外圈用绝对定位的伪元素绘制，不占布局
  return (
    <span
      className={`gh-avatar-frame gh-avatar-frame--${frameStyle}`}
      style={{ '--avatar-size': `${px}px` } as CSSProperties}
      data-frame={frameStyle}
    >
      {content}
    </span>
  )
})
