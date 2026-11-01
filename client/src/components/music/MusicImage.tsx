import { useEffect, useState, type ReactNode } from 'react'
import { getToken } from '../../lib/api'
import { resolveMusicImageSrc } from '../../lib/music/stream'

interface Props {
  url: string | null | undefined
  /** 是否经服务器中转（直接由调用方传入 useMusicPlayer().streamViaProxy） */
  proxy: boolean
  className?: string
  alt?: string
  loading?: 'lazy' | 'eager'
  /** 无地址 / 直连与中转都失败时渲染的内容（一般是现有占位块） */
  fallback?: ReactNode
}

/**
 * 音乐封面图：默认直连网易云 CDN；直连失败自动改走 `/api/music/image`
 * （服务器中转），中转也失败才显示占位。设备已记录「无法直连」时直接从
 * 中转开始，不再先失败一次。
 *
 * 不用 Context 订阅：封面可能一次渲染几十个（榜单/歌单），避免每次播放进度
 * 更新都让所有封面重渲染；`proxy` 由调用方随播放器状态传入。
 */
export default function MusicImage({
  url,
  proxy,
  className,
  alt = '',
  loading,
  fallback = null,
}: Props) {
  const [stage, setStage] = useState<'direct' | 'proxy' | 'failed'>('direct')

  // 换图或切换直连/中转模式时重置探测状态（同一组件复用于列表项 / 切歌）
  useEffect(() => {
    setStage('direct')
  }, [url, proxy])

  if (!url || stage === 'failed') return <>{fallback}</>

  const useProxy = proxy || stage === 'proxy'
  const src = resolveMusicImageSrc(url, useProxy, getToken())
  if (!src) return <>{fallback}</>

  const handleError = () => {
    if (!useProxy) {
      setStage('proxy')
      return
    }
    setStage('failed')
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      onError={handleError}
    />
  )
}
