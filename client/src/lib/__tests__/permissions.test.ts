import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  ADMIN_ROUTE_CAPABILITIES,
  hasCapability,
  hasAnyCapability,
  capabilityLabel,
  capabilityForAdminPath,
  canAccessAdminPath,
  firstAllowedAdminPath,
  roleLabel,
} from '../permissions'

/**
 * 服务端能力清单是唯一真相源，客户端保留一份拷贝用于导航过滤与路由守卫。
 * 这里直接读服务端源码断言两边一致：服务端新增能力而前端漏改时测试会失败。
 */
const SERVER_PERMISSIONS_FILE = resolve(process.cwd(), '../server/src/lib/permissions.ts')

/** 从服务端 permissions.ts 源码里抽出 CAPABILITIES 字面量 */
function serverCapabilities(): string[] {
  const source = readFileSync(SERVER_PERMISSIONS_FILE, 'utf8')
  const block = /export const CAPABILITIES = \[([\s\S]*?)\] as const/.exec(source)?.[1]
  if (!block) throw new Error('未能从 server/src/lib/permissions.ts 解析出 CAPABILITIES')
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('permissions 能力判定', () => {
  it('admin 能力清单覆盖全部能力常量', () => {
    const admin = { role: 'admin', capabilities: [...CAPABILITIES] }
    for (const cap of CAPABILITIES) {
      expect(hasCapability(admin, cap)).toBe(true)
    }
  })

  it('普通账号无管理能力', () => {
    const user = { role: 'user', capabilities: [] }
    expect(hasCapability(user, 'content:write')).toBe(false)
    expect(hasAnyCapability(user)).toBe(false)
  })

  it('未登录 / 缺少 capabilities 字段时不越权', () => {
    expect(hasCapability(null, 'user:manage')).toBe(false)
    expect(hasCapability(undefined, 'user:manage')).toBe(false)
    expect(hasCapability({ role: 'admin' }, 'user:manage')).toBe(false)
    expect(hasAnyCapability({ role: 'admin' })).toBe(false)
  })

  it('只认清单内的能力，忽略未知值', () => {
    const user = { role: 'admin', capabilities: ['content:write'] }
    expect(hasCapability(user, 'content:write')).toBe(true)
    expect(hasCapability(user, 'device:view')).toBe(false)
    expect(hasAnyCapability(user)).toBe(true)
  })

  it('中文标签有兜底', () => {
    expect(capabilityLabel('user:manage')).toBe('用户管理')
    expect(capabilityLabel('unknown:cap')).toBe('unknown:cap')
    expect(roleLabel('admin')).toBe('管理员')
    expect(roleLabel('user')).toBe('用户')
    expect(roleLabel(undefined)).toBe('未知')
  })
})

describe('前后端能力清单一致性', () => {
  it('client 与 server 的 CAPABILITIES 完全相同', () => {
    expect([...CAPABILITIES].sort()).toEqual([...serverCapabilities()].sort())
  })

  it('每项能力都有中文标签', () => {
    for (const cap of CAPABILITIES) {
      expect(CAPABILITY_LABELS[cap]).toBeTruthy()
    }
  })

  it('管理区路由表只引用已声明的能力', () => {
    for (const entry of ADMIN_ROUTE_CAPABILITIES) {
      if (entry.capability === null) continue
      expect(CAPABILITIES).toContain(entry.capability)
    }
  })
})

describe('管理区路径 → 能力（导航过滤与路由守卫同源）', () => {
  const routeCases: [string, string | null | undefined][] = [
    ['/admin', 'content:write'],
    ['/admin/new', 'content:write'],
    ['/admin/edit/12', 'content:write'],
    ['/admin/pages', 'content:write'],
    ['/admin/pages/3/edit', 'content:write'],
    ['/admin/comments', 'comment:moderate'],
    ['/admin/users', 'user:manage'],
    ['/admin/devices', 'device:view'],
    ['/admin/ai', 'ai:configure'],
    ['/admin/api', null],
    ['/profile', undefined],
    ['/', undefined],
  ]

  it.each(routeCases)('%s → %s', (path, expected) => {
    expect(capabilityForAdminPath(path)).toBe(expected)
  })

  it('按最长前缀匹配，/admin 不会盖住 /admin/users', () => {
    expect(capabilityForAdminPath('/admin/users/5')).toBe('user:manage')
  })

  it('canAccessAdminPath 按账号能力放行/拦截', () => {
    const admin = { role: 'admin', capabilities: [...CAPABILITIES] }
    const driveOnly = { role: 'user', capabilities: ['device:view'] }
    const none = { role: 'user', capabilities: [] }

    expect(canAccessAdminPath(admin, '/admin/users')).toBe(true)
    expect(canAccessAdminPath(admin, '/admin/api')).toBe(true)
    expect(canAccessAdminPath(driveOnly, '/admin/devices')).toBe(true)
    expect(canAccessAdminPath(driveOnly, '/admin/users')).toBe(false)
    expect(canAccessAdminPath(driveOnly, '/admin')).toBe(false)
    expect(canAccessAdminPath(none, '/admin/api')).toBe(false)
    // 非管理区路径不受能力限制
    expect(canAccessAdminPath(none, '/profile')).toBe(true)
  })

  it('firstAllowedAdminPath 给出该账号的可用落点', () => {
    expect(firstAllowedAdminPath({ role: 'user', capabilities: ['device:view'] })).toBe('/admin/devices')
    expect(firstAllowedAdminPath({ role: 'user', capabilities: ['content:write'] })).toBe('/admin/new')
    expect(firstAllowedAdminPath({ role: 'user', capabilities: [] })).toBe('/')
    expect(firstAllowedAdminPath({ role: 'admin', capabilities: [...CAPABILITIES] })).toBe('/admin/new')
  })
})
