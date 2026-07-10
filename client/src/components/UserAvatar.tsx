import { useState, useEffect } from 'react'

interface UserAvatarProps {
  userId: number
  username: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
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
  const hue = (userId * 137.508) % 360
  return `hsl(${hue}, 50%, 50%)`
}

export default function UserAvatar({ userId, username, size = 'md' }: UserAvatarProps) {
  const px = SIZE_MAP[size]
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setImgSrc(null)
    setFailed(false)
    const controller = new AbortController()

    fetch(`/api/auth/avatar/${userId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('lineweb_token')}` },
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

  if (imgSrc && !failed) {
    return (
      <img
        src={imgSrc}
        alt={username}
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
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
