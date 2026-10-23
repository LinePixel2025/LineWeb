import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_POLL_INTERVALS,
  FORCE_POLLING_STORAGE_KEY,
  GAME_POLL_INTERVALS,
  isWebSocketAvailable,
  readForcedPolling,
  resolveChatTransport,
  WS_CONNECT_TIMEOUT_MS,
} from '../realtime'

function setUrl(url: string): void {
  window.history.replaceState(null, '', url)
}

beforeEach(() => {
  window.localStorage.clear()
  setUrl('/')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  setUrl('/')
})

describe('常量', () => {
  it('WebSocket 握手超时为 8 秒', () => {
    expect(WS_CONNECT_TIMEOUT_MS).toBe(8_000)
  })

  it('聊天轮询间隔：消息 10s / 会话 30s / 摘要 30s / 好友 60s', () => {
    expect(CHAT_POLL_INTERVALS).toEqual({
      messages: 10_000,
      conversations: 30_000,
      summary: 30_000,
      friends: 60_000,
    })
  })

  it('游戏轮询间隔：sync 5s / match 2s / presence 20s', () => {
    expect(GAME_POLL_INTERVALS).toEqual({
      sync: 5_000,
      match: 2_000,
      presence: 20_000,
    })
  })
})

describe('readForcedPolling', () => {
  it('?transport=polling 返回 true，并把标记写入 localStorage', () => {
    setUrl('/chat?transport=polling')

    expect(readForcedPolling()).toBe(true)
    expect(window.localStorage.getItem(FORCE_POLLING_STORAGE_KEY)).toBe('1')
  })

  it('?transport=auto 返回 false，并清除已保存的标记', () => {
    window.localStorage.setItem(FORCE_POLLING_STORAGE_KEY, '1')
    setUrl('/chat?transport=auto')

    expect(readForcedPolling()).toBe(false)
    expect(window.localStorage.getItem(FORCE_POLLING_STORAGE_KEY)).toBeNull()
  })

  it('没有 URL 参数时读取持久化的标记', () => {
    window.localStorage.setItem(FORCE_POLLING_STORAGE_KEY, '1')
    setUrl('/chat')

    expect(readForcedPolling()).toBe(true)
  })

  it('没有标记时默认返回 false', () => {
    setUrl('/chat')

    expect(readForcedPolling()).toBe(false)
  })

  it('无法识别的 transport 值仍以持久化标记为准', () => {
    window.localStorage.setItem(FORCE_POLLING_STORAGE_KEY, '1')
    setUrl('/chat?transport=ws')

    expect(readForcedPolling()).toBe(true)
  })

  it('localStorage 读取抛异常时安全返回 false', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage 不可用')
    })
    setUrl('/chat')

    expect(() => readForcedPolling()).not.toThrow()
    expect(readForcedPolling()).toBe(false)
  })

  it('localStorage 写入抛异常时 ?transport=polling 仍返回 true', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage 不可用')
    })
    setUrl('/chat?transport=polling')

    expect(() => readForcedPolling()).not.toThrow()
    expect(readForcedPolling()).toBe(true)
  })
})

describe('resolveChatTransport', () => {
  it('WebSocket 已打开且未强制轮询时使用 ws', () => {
    expect(resolveChatTransport('open', false)).toBe('ws')
  })

  it('强制轮询时即使连接已打开也使用 polling', () => {
    expect(resolveChatTransport('open', true)).toBe('polling')
  })

  it('连接中或已断开时降级为 polling', () => {
    expect(resolveChatTransport('connecting', false)).toBe('polling')
    expect(resolveChatTransport('closed', false)).toBe('polling')
    expect(resolveChatTransport('connecting', true)).toBe('polling')
    expect(resolveChatTransport('closed', true)).toBe('polling')
  })
})

describe('isWebSocketAvailable', () => {
  it('jsdom 提供 WebSocket 时返回 true', () => {
    expect(isWebSocketAvailable()).toBe(true)
  })

  it('环境没有 WebSocket 时返回 false', () => {
    vi.stubGlobal('WebSocket', undefined)

    expect(isWebSocketAvailable()).toBe(false)
  })
})
