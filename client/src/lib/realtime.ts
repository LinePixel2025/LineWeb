/**
 * 实时传输降级工具
 *
 * 聊天/游戏默认走 WebSocket；当环境不支持 WS、握手失败或用户强制降级时，
 * 前端退回 HTTP 轮询。这里集中管理「强制轮询」开关、传输模式判定、握手超时
 * 以及各轮询任务的间隔，避免散落在 Context / 页面里。
 */

import type { ChatConnectionState, ChatTransport } from '../types/chat'

export type { ChatTransport }

/** WebSocket 握手（发出 auth 帧 → 收到 auth_ok）超时：超时即关闭连接，交给重连/轮询兜底 */
export const WS_CONNECT_TIMEOUT_MS = 8_000

/** 聊天轮询间隔（毫秒） */
export const CHAT_POLL_INTERVALS = {
  messages: 10_000,
  conversations: 30_000,
  summary: 30_000,
  friends: 60_000,
} as const

/** 游戏轮询间隔（毫秒）—— 供 GameContext 在轮询模式下使用 */
export const GAME_POLL_INTERVALS = {
  sync: 5_000,
  match: 2_000,
  presence: 20_000,
} as const

/** localStorage 中「强制轮询」标记的键名 */
export const FORCE_POLLING_STORAGE_KEY = 'lineweb_force_polling'

/** 安全读取 localStorage（隐私模式/SSR 下访问会抛异常） */
function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * 读取「强制轮询」开关。
 *
 * - URL 带 `?transport=polling`：写入标记并返回 true
 * - URL 带 `?transport=auto`：清除标记并返回 false
 * - 其他情况：返回 localStorage 中的标记（缺省 false）
 *
 * 在无 window / localStorage 不可用（隐私模式、SSR）时安全地返回 false。
 */
export function readForcedPolling(): boolean {
  let transport: string | null = null
  try {
    if (typeof window !== 'undefined' && window.location) {
      transport = new URLSearchParams(window.location.search).get('transport')
    }
  } catch {
    transport = null
  }

  const storage = getStorage()

  if (transport === 'polling') {
    try {
      storage?.setItem(FORCE_POLLING_STORAGE_KEY, '1')
    } catch {
      // localStorage 写入被拒绝（隐私模式/配额）时忽略，本次仍按强制轮询处理
    }
    return true
  }

  if (transport === 'auto') {
    try {
      storage?.removeItem(FORCE_POLLING_STORAGE_KEY)
    } catch {
      // ignore
    }
    return false
  }

  try {
    return storage?.getItem(FORCE_POLLING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 浏览器是否支持 WebSocket（构造函数存在即视为支持；真正的连接失败由连接逻辑处理） */
export function isWebSocketAvailable(): boolean {
  return typeof WebSocket !== 'undefined'
}

/**
 * 解析当前应使用的聊天传输模式：
 * 只有 WebSocket 已认证打开且未被强制降级时才用 'ws'，其余一律 'polling'。
 */
export function resolveChatTransport(
  connectionState: ChatConnectionState,
  forcedPolling: boolean
): ChatTransport {
  return connectionState === 'open' && !forcedPolling ? 'ws' : 'polling'
}
