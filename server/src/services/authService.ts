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
 * 用户登录
 */
export async function loginUser(email: string, password: string): Promise<TokenResponse> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw Object.assign(new Error('邮箱或密码错误'), { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    throw Object.assign(new Error('邮箱或密码错误'), { status: 401 })
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
