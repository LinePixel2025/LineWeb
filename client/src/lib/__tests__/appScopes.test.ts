import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  APP_SCOPES,
  APP_SCOPE_LABELS,
  APP_SCOPE_DESCRIPTIONS,
  HIGH_RISK_APP_SCOPES,
  CAPABILITY_APP_SCOPES,
  appScopeLabel,
  appScopeDescription,
  isHighRiskScope,
  isKnownAppScope,
  sortScopesForDisplay,
} from '../appScopes'

/**
 * 服务端 scope 清单是唯一真相源，客户端保留一份拷贝用于渲染授权页与管理页。
 * 这里直接读服务端源码断言两边一致：服务端新增 scope、改标签或白名单里写错
 * 不存在的 scope 时，测试会立刻失败。
 */
const SERVER_APP_SCOPES_FILE = resolve(process.cwd(), '../server/src/lib/appScopes.ts')

function readServerSource(): string {
  try {
    return readFileSync(SERVER_APP_SCOPES_FILE, 'utf8')
  } catch {
    throw new Error(`未能读取服务端 scope 清单：${SERVER_APP_SCOPES_FILE}`)
  }
}

/** 从服务端源码抽取 `export const APP_SCOPES = [...] as const` 字面量 */
function serverAppScopes(): string[] {
  const source = readServerSource()
  const block = /export const APP_SCOPES = \[([\s\S]*?)\] as const/.exec(source)?.[1]
  if (!block) throw new Error('未能从 server/src/lib/appScopes.ts 解析出 APP_SCOPES')
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/** 抽取某个 `Record<AppScope, string> = { ... }` 对象字面量的键 */
function serverObjectKeys(name: string): string[] {
  const source = readServerSource()
  const pattern = new RegExp(`export const ${name}: Record<AppScope, string> = \\{([\\s\\S]*?)\\n\\}`)
  const block = pattern.exec(source)?.[1]
  if (!block) throw new Error(`未能从 server/src/lib/appScopes.ts 解析出 ${name}`)
  return [...block.matchAll(/'([^']+)':/g)].map((match) => match[1])
}

describe('appScopes 前后端一致性', () => {
  it('客户端 APP_SCOPES 与服务端完全一致（含顺序）', () => {
    expect([...APP_SCOPES]).toEqual(serverAppScopes())
  })

  it('服务端标签与说明覆盖每一个 scope，且客户端同样齐全', () => {
    const serverScopes = serverAppScopes()
    expect(serverObjectKeys('APP_SCOPE_LABELS').sort()).toEqual([...serverScopes].sort())
    expect(serverObjectKeys('APP_SCOPE_DESCRIPTIONS').sort()).toEqual([...serverScopes].sort())

    for (const scope of APP_SCOPES) {
      expect(APP_SCOPE_LABELS[scope], `缺少标签：${scope}`).toBeTruthy()
      expect(APP_SCOPE_DESCRIPTIONS[scope], `缺少说明：${scope}`).toBeTruthy()
    }
  })

  it('服务端端点白名单只引用已声明的 scope（防止白名单写错）', () => {
    const source = readServerSource()
    const referenced = [...source.matchAll(/scope:\s*'([^']+)'/g)].map((match) => match[1])
    expect(referenced.length).toBeGreaterThan(0)

    const declared = new Set(serverAppScopes())
    const unknown = [...new Set(referenced)].filter((scope) => !declared.has(scope))
    expect(unknown, `端点白名单引用了未声明的 scope：${unknown.join('、')}`).toEqual([])
  })

  it('高危 / 能力派生 scope 都是合法 scope', () => {
    const declared = new Set<string>([...APP_SCOPES])
    for (const scope of [...HIGH_RISK_APP_SCOPES, ...CAPABILITY_APP_SCOPES]) {
      expect(declared.has(scope), `非法 scope：${scope}`).toBe(true)
    }
  })

  it('管理类能力不可作为第三方应用的 scope 申请', () => {
    const forbidden = ['user:manage', 'content:manage', 'device:view', 'ai:configure', 'stats:view', 'drive:all', 'app:manage']
    for (const capability of forbidden) {
      expect(isKnownAppScope(capability), `${capability} 不应出现在应用 scope 中`).toBe(false)
    }
  })
})

describe('appScopes 工具函数', () => {
  it('isHighRiskScope 正确识别高危权限', () => {
    expect(isHighRiskScope('content:write')).toBe(true)
    expect(isHighRiskScope('comment:moderate')).toBe(true)
    expect(isHighRiskScope('profile:read')).toBe(false)
    expect(isHighRiskScope('unknown:scope')).toBe(false)
  })

  it('未知 scope 回退为原始字符串，不显示空白', () => {
    expect(appScopeLabel('unknown:scope')).toBe('unknown:scope')
    expect(appScopeDescription('unknown:scope')).toBe('')
  })

  it('展示排序把高危权限排在最后', () => {
    const sorted = sortScopesForDisplay(['content:write', 'profile:read', 'comment:moderate', 'health:read'])
    expect(sorted.slice(0, 2)).toEqual(['profile:read', 'health:read'])
    expect(sorted.slice(2).sort()).toEqual(['comment:moderate', 'content:write'])
  })
})
