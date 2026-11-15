import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { useFeature } from '../../contexts/FeatureContext'
import type { RaidOverview } from '../../types/petRaid'

/**
 * 「返回 LineWeb」后的行动恢复浮窗（2026-11-15）。
 *
 * 离开搜打撤页面不会放弃对局（服务端 PetRaid 仍 active），
 * 这个浮窗在站内其他页面提示「行动进行中」，一键回到 /pets/raid 继续。
 * 只在登录、pet 功能开启、且不在搜打撤页面时每 60 秒轻量轮询一次。
 */
export default function RaidResumeDock() {
  const { user } = useAuth()
  const { isEnabled } = useFeature()
  const location = useLocation()
  const navigate = useNavigate()
  const [run, setRun] = useState<RaidOverview['run']>(null)

  const onRaidPage = location.pathname === '/pets/raid'
    || location.pathname.startsWith('/pets/raid/')

  useEffect(() => {
    if (!user || !isEnabled('pet') || onRaidPage) {
      setRun(null)
      return undefined
    }
    let disposed = false
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const data = await api.get<RaidOverview>('/pets/raid')
        if (!disposed && data.active && data.run) setRun(data.run)
        else if (!disposed) setRun(null)
      } catch {
        // 静默：下一轮再试
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user, isEnabled, onRaidPage])

  if (!user || !run) return null

  const remainingMs = Math.max(0, Date.parse(run.expiresAt) - Date.now())
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000))

  return (
    <button
      type="button"
      className="gh-raid-resume-dock"
      onClick={() => navigate('/pets/raid')}
      aria-label="返回进行中的搜打撤行动"
    >
      <span aria-hidden>🎯</span>
      <span>
        <strong>搜打撤行动进行中</strong>
        <small>{run.mapName} · 剩余约 {minutes} 分钟</small>
      </span>
      <span className="gh-raid-resume-dock-go">继续 →</span>
    </button>
  )
}