import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCrisis } from '../contexts/CrisisContext'
import { useAuth } from '../contexts/AuthContext'
import { crisisMsUntilBlock, formatCrisisCountdown, formatCrisisPoints } from '../lib/crisis'

/** 待缴提醒被「稍后处理」压掉的水位：按轮次记忆，同一轮不再 nag，新一轮会重新提醒 */
const SNOOZE_KEY = 'lineweb_crisis_snoozed_round'

/**
 * 危机封锁 / 提醒弹窗。
 *
 * - 已封锁：不可关闭的模态，只提供「前往缴纳」与「退出登录」两条出路；
 * - 待缴未封锁：可「稍后处理」压掉（按轮次记忆），但倒计时始终如实显示。
 * 管理员豁免与开关关闭都由服务端把 status 直接算成 clear，这里自然不渲染。
 */
export default function CrisisGate() {
  const { state, pay, blocked } = useCrisis()
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [snoozed, setSnoozed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onCrisisPage = location.pathname.startsWith('/crisis')

  useEffect(() => {
    if (!state || state.status !== 'due') return
    try {
      setSnoozed(localStorage.getItem(SNOOZE_KEY) === String(state.round))
    } catch {
      setSnoozed(false)
    }
  }, [state?.round, state?.status, state])

  const dismiss = useCallback(() => {
    if (!state) return
    try {
      localStorage.setItem(SNOOZE_KEY, String(state.round))
    } catch {
      // 隐私模式下 localStorage 会抛：压不住这一次，下次进来再提醒
    }
    setSnoozed(true)
  }, [state])

  const payRemaining = useCallback(async () => {
    if (!state || state.remaining <= 0) return
    setBusy(true)
    setError('')
    try {
      await pay(state.remaining)
    } catch (err) {
      setError(err instanceof Error ? err.message : '缴纳失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }, [pay, state])

  if (!user || !state || state.exempt || !state.enabled) return null
  if (state.status === 'clear' || onCrisisPage) return null
  if (!blocked && snoozed) return null

  return (
    <div className="gh-dialog-overlay gh-crisis-overlay" role="presentation">
      <div
        className="gh-dialog gh-crisis-dialog"
        role={blocked ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={blocked ? 'Lineweb 危机封锁' : 'Lineweb 危机待缴提醒'}
      >
        <p className="gh-crisis-eyebrow">Lineweb · 危机{blocked ? '封锁' : '提醒'}</p>
        <h3 className="gh-dialog-title">
          {blocked ? '功能已被暂停，请先上缴危机积分' : `请在 ${formatCrisisCountdown(crisisMsUntilBlock(state))} 内缴清危机积分`}
        </h3>
        <p className="gh-crisis-lede">
          本轮按你开轮时的总资产 <strong>{formatCrisisPoints(state.snapshot)}</strong> 积分快照征收
          {' '}{Math.round(state.rules.ratio * 100)}%，应缴 <strong className="gh-crisis-required">{formatCrisisPoints(state.required)}</strong> 积分，
          已缴 <strong>{formatCrisisPoints(state.paid)}</strong>，尚欠{' '}
          <strong className="gh-crisis-remaining">{formatCrisisPoints(state.remaining)}</strong> 积分。
          上缴的积分进入 Lineweb 公共银行（累计已达 {formatCrisisPoints(state.poolTotal)} 积分），只进不出。
        </p>
        {state.hasLiveRaid && !blocked && (
          <div className="gh-alert gh-alert--warning">
            你有进行中的搜打撤对局，封锁会等这局打完之后再开始。
          </div>
        )}
        {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
        <div className="gh-crisis-actions">
          <button type="button" className="gh-btn gh-btn--primary" onClick={() => navigate('/crisis')}>
            前往缴纳
          </button>
          {!blocked && state.remaining > 0 && (
            <button type="button" className="gh-btn" onClick={payRemaining} disabled={busy}>
              {busy ? '缴纳中…' : `一键缴清 ${formatCrisisPoints(state.remaining)}`}
            </button>
          )}
          {!blocked && <button type="button" className="gh-btn gh-btn--ghost" onClick={dismiss}>稍后处理</button>}
          {blocked && (
            <button type="button" className="gh-btn gh-btn--ghost" onClick={() => navigate('/login')}>
              退出登录
            </button>
          )}
        </div>
        {!blocked && (
          <p className="gh-crisis-hint">
            积分不够？被封锁期间银行、股市、搜打撤仓库与官方商店仍可正常访问，先把资产变现再来缴。
          </p>
        )}
      </div>
    </div>
  )
}
