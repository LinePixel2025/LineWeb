import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AVATAR_FRAMES, TITLE_EFFECTS } from '../../types/points'

/**
 * 称号特效 / 头像框样式白名单以服务端 pointsRules.ts 为唯一真相源，客户端保留一份拷贝
 * （types/points.ts）用于渲染类名与管理端下拉。这里直接读服务端源码断言两边完全一致
 * （含顺序）：服务端调整清单或改名时，测试会立刻失败。
 */
const SERVER_POINTS_RULES_FILE = resolve(process.cwd(), '../server/src/lib/pointsRules.ts')
const CLIENT_POINTS_CSS_FILE = resolve(process.cwd(), 'src/styles/points.css')

function readServerSource(): string {
  try {
    return readFileSync(SERVER_POINTS_RULES_FILE, 'utf8')
  } catch {
    throw new Error(`未能读取服务端白名单：${SERVER_POINTS_RULES_FILE}`)
  }
}

/** 从服务端源码抽取 `export const <name> = [...] as const` 字面量 */
function serverStringList(name: string): string[] {
  const source = readServerSource()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`export const ${escaped} = \\[([\\s\\S]*?)\\] as const`).exec(source)?.[1]
  if (!block) throw new Error(`未能从 server/src/lib/pointsRules.ts 解析出 ${name}`)
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function serverTitleEffects(): string[] {
  return serverStringList('TITLE_EFFECT_STYLES')
}

function serverAvatarFrames(): string[] {
  return serverStringList('AVATAR_FRAME_STYLES')
}

describe('titleEffects 前后端一致性', () => {
  it('客户端 TITLE_EFFECTS 与服务端 TITLE_EFFECT_STYLES 完全一致（含顺序）', () => {
    expect([...TITLE_EFFECTS]).toEqual(serverTitleEffects())
  })

  it('特效白名单共 20 个（8 个既有 + 2 个幻彩 + 5 个神话 + 2 个至臻 + 3 个源初）且与 CSS fx 类名后缀约定一致', () => {
    expect([...TITLE_EFFECTS]).toEqual([
      'classic',
      'stardust',
      'flame',
      'aurora',
      'thunder',
      'nova',
      'prism',
      'void',
      'meteor',
      'blossom',
      'singularity',
      'zenith',
      'eternity',
      'chaos',
      'firmament',
      'genesis',
      'oblivion',
      'etch',
      'holo',
      'monolith',
    ])
    expect(TITLE_EFFECTS.length).toBe(20)
  })

  it('炸裂 / 幻彩 / 神话 / 至臻特效 key 均为小写且可作为 gh-title-badge--fx-<key> 类名后缀', () => {
    for (const key of [
      'nova', 'prism', 'void', 'meteor', 'blossom',
      'singularity', 'zenith', 'eternity', 'chaos', 'firmament',
      'genesis', 'oblivion',
    ]) {
      expect(TITLE_EFFECTS).toContain(key)
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })
})

describe('avatarFrames 前后端一致性', () => {
  it('客户端 AVATAR_FRAMES 与服务端 AVATAR_FRAME_STYLES 完全一致（含顺序）', () => {
    expect([...AVATAR_FRAMES]).toEqual(serverAvatarFrames())
  })

  it('头像框白名单共 16 个（4 个既有 + 3 个炸裂 + 4 个幻彩 + 5 个神话）且与 gh-avatar-frame--<key> 约定一致', () => {
    expect([...AVATAR_FRAMES]).toEqual([
      'gold',
      'neon',
      'sakura',
      'galaxy',
      'inferno',
      'storm',
      'supernova',
      'frost',
      'venom',
      'royal',
      'cyber',
      'abyss',
      'eclipse',
      'quantum',
      'draconis',
      'immortal',
    ])
    expect(AVATAR_FRAMES.length).toBe(16)
    for (const key of [
      'inferno', 'storm', 'supernova', 'royal', 'cyber',
      'abyss', 'eclipse', 'quantum', 'draconis', 'immortal',
    ]) {
      expect(AVATAR_FRAMES).toContain(key)
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })
})

describe('特效 CSS 类名覆盖', () => {
  it('每个白名单 key 都在 points.css 里有对应类名规则（防止白名单与样式脱节）', () => {
    const css = readFileSync(CLIENT_POINTS_CSS_FILE, 'utf8')
    for (const key of TITLE_EFFECTS) {
      if (key === 'classic') continue // classic 走基础金色流光，不加 fx 类
      expect(css).toContain(`.gh-title-badge--fx-${key}`)
    }
    for (const key of AVATAR_FRAMES) {
      expect(css).toContain(`.gh-avatar-frame--${key}`)
    }
  })
})
