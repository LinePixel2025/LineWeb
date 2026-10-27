import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import {
  ensureAccount,
  ensureAccounts,
  isNekoChatEnabled,
  removeAccount,
  toNekoId,
} from './nekoChat.js'

/**
 * LineWeb 账号 → neko 聊天账号的同步
 *
 * 用户完全无感：仍用 LineWeb 账号登录，neko 侧账号由服务端按需/批量创建。
 *   - 启动后延迟 10 秒全量对齐（失败只告警，不影响站点启动）
 *   - 注册、改名、建群前按需补建（幂等）
 *   - 删除用户时停用 neko 账号并踢线（聊天记录保留）
 */

/** 同一用户的并发补建合并成一次请求（注册 + 立刻打开聊天时不会重复建号） */
const inflight = new Map<number, Promise<void>>()

/** 按需补建/同步单个账号（幂等；未启用聊天服务时静默跳过） */
export function ensureNekoAccount(userId: number, options: { kick?: boolean } = {}): Promise<void> {
  if (!isNekoChatEnabled()) return Promise.resolve()
  const existing = inflight.get(userId)
  if (existing) return existing

  const task = (async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true },
      })
      if (!user) return
      await ensureAccount(user, options)
    } catch (err) {
      console.warn(`[nekoChat] 账号同步失败 #${userId}：`, err instanceof Error ? err.message : err)
    } finally {
      inflight.delete(userId)
    }
  })()
  inflight.set(userId, task)
  return task
}

/** 批量补建（建群前确保成员工在 neko 侧存在）；逐个静默失败 */
export async function ensureNekoAccounts(userIds: number[]): Promise<void> {
  if (!isNekoChatEnabled()) return
  const unique = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))]
  await Promise.all(unique.map((id) => ensureNekoAccount(id)))
}

/** 删除/停用用户：停用 neko 账号并断开其连接（数据保留，账号不可再登录） */
export async function deactivateNekoAccount(userId: number): Promise<void> {
  if (!isNekoChatEnabled()) return
  try {
    await removeAccount(toNekoId(userId))
  } catch (err) {
    console.warn(`[nekoChat] 停用账号失败 #${userId}：`, err instanceof Error ? err.message : err)
  }
}

/** 启动后全量对齐（分页 100 条，失败只告警） */
export async function syncAllNekoAccounts(): Promise<number> {
  if (!isNekoChatEnabled()) return 0
  let cursor = 0
  let total = 0
  for (;;) {
    const users = await prisma.user.findMany({
      where: { id: { gt: cursor } },
      select: { id: true, username: true },
      orderBy: { id: 'asc' },
      take: 100,
    })
    if (users.length === 0) break
    cursor = users[users.length - 1].id
    const count = await ensureAccounts(users)
    total += count
    if (users.length < 100) break
  }
  return total
}

let started = false
let startupTimer: ReturnType<typeof setTimeout> | null = null

/** 启动同步（延迟 10 秒，避免与首次网盘同步等启动任务抢带宽） */
export function startNekoAccountSync(delayMs = 10000): void {
  if (started || !isNekoChatEnabled()) return
  started = true
  startupTimer = setTimeout(() => {
    startupTimer = null
    syncAllNekoAccounts()
      .then((count) => {
        if (count > 0) console.log(`[nekoChat] 已同步 ${count} 个聊天账号`)
      })
      .catch((err) => {
        console.warn('[nekoChat] 启动账号同步失败：', err instanceof Error ? err.message : err)
      })
  }, delayMs)
  startupTimer.unref?.()
}

export function stopNekoAccountSync(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
}

/** 配置里的基础偏移（供路由做校验提示） */
export const NEKO_ACCOUNT_BASE = config.nekoChatAccountBase
