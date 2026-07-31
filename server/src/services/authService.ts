import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'

export interface TokenResponse {
  token: string
  user: {
    id: number
    username: string
    email: string
    role: string
    settings: string | null
    canAccessDrive: boolean
  }
}

function signToken(user: { id: number; username: string; email: string; role: string }): string {
  return jwt.sign(
    { userId: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )
}

function buildTokenResponse(user: {
  id: number; username: string; email: string; role: string;
  settings: string | null; canAccessDrive: boolean;
}): TokenResponse {
  return {
    token: signToken(user),
    user: {
      id: user.id, username: user.username, email: user.email,
      role: user.role, settings: user.settings, canAccessDrive: user.canAccessDrive,
    },
  }
}

async function findExistingUser(email: string, username: string) {
  return prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  })
}

/**
 * 用户注册
 */
export async function registerUser(username: string, email: string, password: string): Promise<TokenResponse> {
  const exists = await findExistingUser(email, username)
  if (exists) {
    throw Object.assign(new Error('用户名或邮箱已被注册'), { status: 409 })
  }

  const hashed = await bcrypt.hash(password, 10)  // 成本因子 10: ~100ms vs 12 的 ~300ms, 仍足够安全
  const user = await prisma.user.create({
    data: { username, email, password: hashed },
  })

  return buildTokenResponse(user)
}

/**
 * 用户登录 —— 支持用户名或邮箱
 */
export async function loginUser(identifier: string, password: string): Promise<TokenResponse> {
  let user = await prisma.user.findUnique({ where: { username: identifier } })
  if (!user) {
    user = await prisma.user.findUnique({ where: { email: identifier } })
  }
  if (!user) {
    throw Object.assign(new Error('用户名或邮箱与密码不匹配'), { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    throw Object.assign(new Error('用户名或邮箱与密码不匹配'), { status: 401 })
  }

  return buildTokenResponse(user)
}

/**
 * 获取用户信息
 */
export async function getUserById(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, role: true, settings: true, canAccessDrive: true, createdAt: true },
  })
}

/**
 * 更新用户设置
 */
export async function updateUserSettings(userId: number, settings: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { settings },
    select: { id: true, username: true, email: true, role: true, settings: true, canAccessDrive: true },
  })
}

export interface UpdateProfileInput {
  username?: string
  currentPassword?: string
  newPassword?: string
}

/**
 * 更新个人资料（用户名 / 登录密码）
 * 修改密码后使所有旧 token 失效，并返回新 token 保持当前会话
 */
export async function updateUserProfile(userId: number, input: UpdateProfileInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { status: 404 })
  }

  const data: { username?: string; password?: string } = {}

  if (input.username && input.username !== user.username) {
    const exists = await prisma.user.findUnique({ where: { username: input.username } })
    if (exists) {
      throw Object.assign(new Error('用户名已被使用'), { status: 409 })
    }
    data.username = input.username
  }

  if (input.newPassword) {
    if (!input.currentPassword) {
      throw Object.assign(new Error('请输入当前密码'), { status: 400 })
    }
    const valid = await bcrypt.compare(input.currentPassword, user.password)
    if (!valid) {
      throw Object.assign(new Error('当前密码错误'), { status: 400 })
    }
    data.password = await bcrypt.hash(input.newPassword, 10)
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, username: true, email: true, role: true, settings: true, canAccessDrive: true },
  })

  // 修改密码后使所有旧 token 立即失效，并签发新 token 保持当前登录
  if (input.newPassword) {
    await invalidateUserTokens(userId)
    return { user: updated, token: signToken(updated) }
  }

  return { user: updated }
}

/**
 * 使指定用户的所有 JWT 失效 — 更新 tokenValidAfter 为当前时间
 * 用于登出/改密码场景：使该用户之前签发的所有 token 立即失效
 */
export async function invalidateUserTokens(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenValidAfter: new Date() },
  })
}
