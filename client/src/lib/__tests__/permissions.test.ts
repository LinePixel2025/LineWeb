import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES,
  hasCapability,
  hasAnyCapability,
  capabilityLabel,
  roleLabel,
} from '../permissions'

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
