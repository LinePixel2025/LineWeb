/**
 * 聊天免打扰偏好（纯前端，localStorage 持久化）
 *
 * 开启后：不弹出全局新消息提示（ChatMessageToast），但消息照常落库、
 * 未读角标与群聊 @ 角标照常累加，聊天页内正常收发。
 * 与「实时连接（WebSocket）」偏好相互独立，互不影响。
 */

export const CHAT_DND_STORAGE_KEY = 'lineweb_chat_dnd'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/** 读取免打扰开关（缺省关闭；localStorage 不可用时按关闭处理） */
export function readChatDnd(): boolean {
  try {
    return getStorage()?.getItem(CHAT_DND_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 写入免打扰开关（localStorage 不可用时只在本次会话生效，状态仍在 Context 里） */
export function writeChatDnd(enabled: boolean): void {
  try {
    const storage = getStorage()
    if (!storage) return
    if (enabled) storage.setItem(CHAT_DND_STORAGE_KEY, '1')
    else storage.removeItem(CHAT_DND_STORAGE_KEY)
  } catch {
    // 隐私模式/配额不足：忽略
  }
}
