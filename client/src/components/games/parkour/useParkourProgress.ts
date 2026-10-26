import { useEffect, useRef } from 'react'
import api from '../../../lib/api'
import { parkourPose, type ParkourRunState } from '../../../lib/games/parkour'
import type { ParkourActionBody } from '../../../types/game'

interface UseParkourProgressOptions {
  matchId: number | null
  enabled: boolean
  getRun: () => ParkourRunState | null
  onStopped?: (reason: 'ended' | 'error') => void
}

const PROGRESS_INTERVAL_MS = 500
const FINAL_WATCH_INTERVAL_MS = 100
const FINISH_RETRY_DELAY_MS = 400

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

/**
 * 联机跑酷进度上报：
 *   - 每 500ms 发 progress（绝对值），服务端做单调/速度/金币/车道校验；
 *   - 冲线/出局由 100ms 监视器立即触发，避免 500ms 采样错过名次；
 *   - 失败或 404/409（对局已结束）后停止，由页面依赖 sync/WS 收尾；
 *   - 不经过 useOnlineGameRoom.submitAction，避免 inFlight 锁与旧 DTO 回退版本。
 */
export function useParkourProgress({
  matchId,
  enabled,
  getRun,
  onStopped,
}: UseParkourProgressOptions): void {
  const getRunRef = useRef(getRun)
  const onStoppedRef = useRef(onStopped)
  getRunRef.current = getRun
  onStoppedRef.current = onStopped

  useEffect(() => {
    if (!matchId || !enabled) return undefined
    let disposed = false
    let inFlight = false
    let stopped = false
    let finalSent = false

    const isFatalStatus = (error: unknown): boolean => {
      const message = errorMessage(error)
      return message.includes('对局已结束')
        || message.includes('对局不存在')
        || message.includes('你已出局')
        || message.includes('无法冲线')
    }

    const post = async (body: ParkourActionBody, final = false): Promise<boolean> => {
      if (disposed || inFlight) return false
      if (!final && stopped) return false
      inFlight = true
      try {
        await api.post(`/games/parkour/matches/${matchId}/actions`, body)
        if (final) stopped = true
        return true
      } catch (error) {
        if (!final && isFatalStatus(error)) {
          stopped = true
          onStoppedRef.current?.('ended')
        }
        return false
      } finally {
        inFlight = false
      }
    }

    const sendFinish = async (run: ParkourRunState): Promise<void> => {
      if (finalSent) return
      finalSent = true
      const body: ParkourActionBody = {
        type: 'finish',
        distanceM: 800,
        coins: run.coins,
        maxCombo: run.maxCombo,
      }
      for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
        if (await post(body, true)) return
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, FINISH_RETRY_DELAY_MS))
      }
      stopped = true
    }

    const sendCrash = async (run: ParkourRunState): Promise<void> => {
      if (finalSent) return
      finalSent = true
      const body: ParkourActionBody = {
        type: 'progress',
        distanceM: run.distanceM,
        coins: run.coins,
        maxCombo: run.maxCombo,
        lane: run.targetLane,
        pose: parkourPose(run),
        alive: false,
        cause: run.cause === 'pit' ? 'pit' : 'hit',
      }
      await post(body, true)
      stopped = true
    }

    const sendProgress = async (): Promise<void> => {
      if (disposed || stopped || inFlight) return
      const run = getRunRef.current()
      if (!run) return
      if (run.finished) {
        await sendFinish(run)
        return
      }
      if (!run.alive) {
        await sendCrash(run)
        return
      }
      await post({
        type: 'progress',
        distanceM: run.distanceM,
        coins: run.coins,
        maxCombo: run.maxCombo,
        lane: run.targetLane,
        pose: parkourPose(run),
        alive: true,
      })
    }

    const watchFinal = (): void => {
      if (disposed || stopped || finalSent) return
      const run = getRunRef.current()
      if (!run) return
      if (run.finished) {
        void sendFinish(run)
        return
      }
      if (!run.alive) void sendCrash(run)
    }

    void sendProgress()
    const progressTimer = setInterval(() => void sendProgress(), PROGRESS_INTERVAL_MS)
    const finalTimer = setInterval(watchFinal, FINAL_WATCH_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(progressTimer)
      clearInterval(finalTimer)
    }
  }, [matchId, enabled])
}
