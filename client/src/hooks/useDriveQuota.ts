import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../lib/api'

/** 服务端 GET /api/drive/quota 的响应结构（字节数均以字符串传输） */
export interface DriveQuota {
  /** 是否不限空间（具备 drive:all 能力的管理员） */
  unlimited: boolean
  /** 空间上限（字节字符串）；不限空间时为 null */
  quota: string | null
  /** 已用空间（字节字符串） */
  used: string
  /** 剩余空间（字节字符串）；不限空间时为 null */
  remaining: string | null
}

export interface UseDriveQuotaResult {
  data: DriveQuota | null
  loading: boolean
  refresh: () => void
}

/**
 * 读取当前用户的网盘空间配额。
 *
 * @param refreshToken 自增该值即可重新拉取（上传 / 删除成功后使用）
 *
 * 配额只用于展示，读取失败不打断网盘主流程；组件卸载后忽略迟到的响应。
 */
export function useDriveQuota(refreshToken = 0): UseDriveQuotaResult {
  const [data, setData] = useState<DriveQuota | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    api.get<DriveQuota>('/drive/quota')
      .then(quota => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return
        setData(quota)
      })
      .catch(() => {
        // 配额是辅助信息，失败时保留上一次数据，不打断网盘主流程
      })
      .finally(() => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshToken])

  return { data, loading, refresh }
}

export default useDriveQuota
