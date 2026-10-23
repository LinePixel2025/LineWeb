/**
 * 游戏模块共享 ID 生成器
 *
 * 2048 与斗地主的邀请共用同一个自增 id 空间：前端把两个游戏的邀请
 * 合并进同一列表（数字 id 作为 key），各自独立计数会发生撞号导致
 * 邀请互相覆盖 / 误删。对局 id 不合并展示，仍由各服务自行计数。
 */

let nextId = 1

/** 生成全局唯一的邀请 id（跨游戏不重复） */
export function nextGameInviteId(): number {
  const id = nextId
  nextId += 1
  return id
}
