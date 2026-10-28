import { memo, useEffect, useState } from 'react'
import UserAvatar from '../UserAvatar'
import { getToken } from '../../lib/api'

const SIZE_MAP = { sm: 24, md: 32, lg: 48, xl: 80 } as const

export type NekoAvatarSize = keyof typeof SIZE_MAP

interface Props {
  /** neko 账号 id（群聊 / 未知为 null） */
  nekoId: number | null
  /** neko 头像版本号（0 = 没有头像，不发请求） */
  avatarVersion?: number
  /** 回退用的 LineWeb 用户 id（负数 / 0 → 首字母兜底） */
  fallbackId: number
  name: string
  size?: NekoAvatarSize
}

/** neko 头像地址：`<img>` 无法带 Authorization，用 `?token=` 登录令牌 + 版本号击穿缓存 */
export function nekoAvatarUrl(nekoId: number, version: number): string {
  const token = getToken() ?? ''
  return `/chat/avatars/${nekoId}?v=${Math.max(0, Math.trunc(version))}&token=${encodeURIComponent(token)}`
}

/**
 * 聊天头像：优先后端中继的 neko 头像（LineWeb 头像上传后会同步过去），
 * 没有 neko 头像时回退到 LineWeb 头像 / 首字母。
 */
export default memo(function NekoAvatar({
  nekoId,
  avatarVersion = 0,
  fallbackId,
  name,
  size = 'md',
}: Props) {
  const px = SIZE_MAP[size]
  const [failed, setFailed] = useState(false)

  // 账号或版本变化（用户换了头像）时重新尝试
  useEffect(() => {
    setFailed(false)
  }, [nekoId, avatarVersion])

  const usable = !!nekoId && nekoId > 0 && avatarVersion > 0 && !failed

  if (!usable) {
    return <UserAvatar userId={fallbackId} username={name} size={size} />
  }

  return (
    <img
      src={nekoAvatarUrl(nekoId, avatarVersion)}
      alt={name}
      title={name}
      loading="lazy"
      width={px}
      height={px}
      style={{
        width: px,
        height: px,
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
      }}
      onError={() => setFailed(true)}
    />
  )
})
