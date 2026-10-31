import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TITLE_EFFECTS } from '../../types/points'

/**
 * 传说特效白名单以服务端 TITLE_EFFECT_STYLES 为唯一真相源，客户端保留一份拷贝
 * （types/points.ts）用于渲染徽章 fx 类名与管理端下拉。这里直接读服务端源码断言
 * 两边完全一致（含顺序）：服务端调整特效清单或改名时，测试会立刻失败。
 */
const SERVER_POINTS_RULES_FILE = resolve(process.cwd(), '../server/src/lib/pointsRules.ts')

function readServerSource(): string {
  try {
    return readFileSync(SERVER_POINTS_RULES_FILE, 'utf8')
  } catch {
    throw new Error(`未能读取服务端特效清单：${SERVER_POINTS_RULES_FILE}`)
  }
}

/** 从服务端源码抽取 `export const TITLE_EFFECT_STYLES = [...] as const` 字面量 */
function serverTitleEffects(): string[] {
  const source = readServerSource()
  const block = /export const TITLE_EFFECT_STYLES = \[([\s\S]*?)\] as const/.exec(source)?.[1]
  if (!block) throw new Error('未能从 server/src/lib/pointsRules.ts 解析出 TITLE_EFFECT_STYLES')
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('titleEffects 前后端一致性', () => {
  it('客户端 TITLE_EFFECTS 与服务端 TITLE_EFFECT_STYLES 完全一致（含顺序）', () => {
    expect([...TITLE_EFFECTS]).toEqual(serverTitleEffects())
  })

  it('特效白名单共 5 个且与 CSS fx 类名后缀约定一致', () => {
    expect([...TITLE_EFFECTS]).toEqual(['classic', 'stardust', 'flame', 'aurora', 'thunder'])
    expect(TITLE_EFFECTS.length).toBe(5)
  })
})
