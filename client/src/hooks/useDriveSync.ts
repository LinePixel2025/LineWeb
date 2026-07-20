import { useState, useCallback } from 'react'
import api from '../lib/api'

export function useDriveSync() {
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  const sync = useCallback(async () => {
    setSyncing(true)
    setMessage('')
    try {
      const report = await api.post<{ missingCreated: number; errors: string[]; scanned: number }>('/drive/sync')
      if (report.errors && report.errors.length > 0) {
        setMessage(`同步完成，${report.errors.length} 个错误: ${report.errors.slice(0, 2).join('; ')}`)
      } else if (report.missingCreated > 0) {
        setMessage(`同步完成，发现 ${report.missingCreated} 个新文件`)
      } else {
        setMessage('同步完成，没有新文件')
      }
    } catch {
      setMessage('同步失败，请检查存储节点连接')
    } finally {
      setSyncing(false)
    }
  }, [])

  const clearMessage = useCallback(() => setMessage(''), [])

  return { sync, syncing, message, clearMessage }
}
