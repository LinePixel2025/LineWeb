import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STICKER_SHOP, STICKER_SHOP_PACKS } from '../stickers'

/**
 * 表情商店清单与静态素材必须一一对应：
 * 生成脚本（client/scripts/generate-sticker-shop.mjs）新增/删除素材后，
 * 若忘记同步 lib/stickers.ts，这里会直接失败。
 */
describe('表情商店素材', () => {
  const dir = resolve(process.cwd(), 'public/stickers/shop')
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.svg'))
    .sort()

  it('清单与 public/stickers/shop 文件一一对应', () => {
    expect(STICKER_SHOP.map((item) => `${item.id}.svg`).sort()).toEqual(files)
  })

  it('每项都指向已声明的分类', () => {
    const packIds = new Set(STICKER_SHOP_PACKS.map((pack) => pack.id))
    for (const item of STICKER_SHOP) {
      expect(packIds.has(item.pack), `${item.id} 的分类 ${item.pack} 未声明`).toBe(true)
    }
  })

  it('id 唯一且素材地址为同源静态路径', () => {
    const ids = STICKER_SHOP.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of STICKER_SHOP) {
      expect(item.src).toBe(`/stickers/shop/${item.id}.svg`)
    }
  })
})
