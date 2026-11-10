import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { usePoints } from '../contexts/PointsContext'
import { formatCrisisPoints } from '../lib/crisis'
import type { CrisisDividendRecord } from '../types/crisis'

/** 已读水位：记录最近一次弹过窗的发放流水号（换设备会重新弹最近一次，不影响账目） */
const SEEN_KEY = 'lineweb_crisis_dividend_seen'
/** 轮询间隔：分红一天最多一次，60 秒足够及时；手动触发也会在一分钟内被发现 */
const POLL_MS = 60_000

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, id)
  } catch {
    // 隐私模式写不进去只会导致下次重新弹一次，不影响分红本身
  }
}

/**
 * 公共银行分红弹窗：每次发放（每日自动 / 管理员手动）都会给全站用户弹一次。
 *
 * 口径：
 * - 首次使用（本地没有水位）只记录当前流水号、不弹窗——避免上线当天给每个人弹一条历史发放；
 * - 水位按「发放流水号」比较，同一笔发放只弹一次（含多次刷新 / 多标签页共用 localStorage）；
 * - 人均不足 1 分的跳过记录不弹窗（没有实际到账，弹了只会让人困惑），但同样推进水位。
 *
 * 挂在 Routes 外层（App.tsx），未登录时直接不渲染。
 */
export default function CrisisDividendNotifier() {
  const { user } = useAuth()
  const { refresh: refreshPoints } = usePoints()
  const [record, setRecord] = useState<CrisisDividendRecord | null>(null)
  const busyRef = useRef(false)

  const check = useCallback(async () => {
    if (!user || busyRef.current) return
    busyRef.current = true
    try {
      const data = await api.get<{ total: string; dividend: CrisisDividendRecord | null }>('/crisis/pool')
      const dividend = data.dividend
      if (!dividend || !dividend.id) return
      const seen = readSeen()
      if (!seen) {
        // 首次使用：只建水位，不把历史发放弹给所有人
        writeSeen(dividend.id)
        return
      }
      if (seen === dividend.id) return
      writeSeen(dividend.id)
      if (dividend.skipped) return
      setRecord(dividend)
      // 分红是直接进积分余额的：立刻刷一次余额，顶部与积分页数字才不会落后
      void refreshPoints()
    } catch {
      // 读不到分红动态不影响站点（未登录 / 网络异常 / 服务端重启）
    } finally {
      busyRef.current = false
    }
  }, [refreshPoints, user])

  useEffect(() => {
    if (!user) {
      setRecord(null)
      return undefined
    }
    void check()
    const timer = window.setInterval(() => {
      if (!document.hidden) void check()
    }, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check, user])

  if (!record) return null

  return (
    <div
      className="gh-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setRecord(null)
      }}
    >
      <div
        className="gh-dialog gh-crisis-dividend-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gh-crisis-dividend-title"
      >
        <h3 id="gh-crisis-dividend-title" className="gh-dialog-title">🏦 公共银行分红到账</h3>
        <p className="gh-crisis-dividend-lead">
          {record.manual ? '管理员刚刚手动发放了一次公共银行分红' : '今天的公共银行分红已经发放'}
          ，积分已自动进入你的余额。
        </p>
        <ul className="gh-crisis-dividend-rows">
          <li>
            <span>本次发放</span>
            <strong>{formatCrisisPoints(record.total)} 积分</strong>
          </li>
          <li>
            <span>每人到账</span>
            <strong className="gh-crisis-dividend-per-user">+{formatCrisisPoints(record.perUser)}</strong>
          </li>
          <li>
            <span>参与人数</span>
            <strong>{formatCrisisPoints(record.userCount)} 人</strong>
          </li>
          <li>
            <span>抽取比例</span>
            <strong>{record.pct}%</strong>
          </li>
          <li>
            <span>发放方式</span>
            <strong>{record.manual ? '管理员手动发放' : '每日自动发放'}</strong>
          </li>
          <li>
            <span>发放时间</span>
            <strong>{record.at ? new Date(record.at).toLocaleString('zh-CN', { hour12: false }) : '—'}</strong>
          </li>
        </ul>
        <div className="gh-dialog-actions">
          <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/crisis" onClick={() => setRecord(null)}>
            查看公共银行
          </Link>
          <button type="button" className="gh-btn gh-btn--primary gh-btn--sm" onClick={() => setRecord(null)} autoFocus>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
