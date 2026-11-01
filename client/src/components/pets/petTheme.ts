import type { PetPalette, PetSpecies } from '../../types/pet'

/**
 * 物种兜底元数据。
 *
 * 正常路径下 name / emoji / palette 都由 `/api/pets` 的 catalog 下发；
 * 这份表只是「服务端字段缺失 / 旧缓存 / 测试夹具」时的渲染兜底，
 * 保证贴图与卡片永远不会因为一个字段缺失而画出空白。
 */
export const PET_SPECIES_FALLBACK: Record<
  PetSpecies,
  { name: string; emoji: string; defaultName: string; palette: PetPalette }
> = {
  cat: {
    name: '小猫',
    emoji: '🐱',
    defaultName: '咪咪',
    palette: { primary: '#f2a55c', secondary: '#ffe6c2', accent: '#e8837f' },
  },
  dog: {
    name: '小狗',
    emoji: '🐶',
    defaultName: '旺旺',
    palette: { primary: '#cf9a63', secondary: '#f8e6c8', accent: '#e8877a' },
  },
  bird: {
    name: '小鸟',
    emoji: '🐦',
    defaultName: '啾啾',
    palette: { primary: '#5cc6e8', secondary: '#e2f8ff', accent: '#f7c948' },
  },
  rabbit: {
    name: '小兔',
    emoji: '🐰',
    defaultName: '糯糯',
    palette: { primary: '#ecd8ef', secondary: '#fff7fb', accent: '#f28fa8' },
  },
  fox: {
    name: '小狐狸',
    emoji: '🦊',
    defaultName: '阿狸',
    palette: { primary: '#ef8b4c', secondary: '#fff1e1', accent: '#c95c33' },
  },
  panda: {
    name: '小熊猫',
    emoji: '🐼',
    defaultName: '圆圆',
    palette: { primary: '#f2f0ec', secondary: '#33333c', accent: '#f0a6b5' },
  },
}

/** 全部物种的稳定顺序（换宠物卡片按它排；新增物种只能追加） */
export const PET_SPECIES_ORDER: PetSpecies[] = ['cat', 'dog', 'bird', 'rabbit', 'fox', 'panda']

/** 心情 0–100 → 一句人话（公共页面只暴露 mood，不展示其它数值） */
export function moodLabel(mood: number): string {
  if (mood >= 75) return '心情超好'
  if (mood >= 50) return '悠哉悠哉'
  if (mood >= 25) return '有点无聊'
  return '闷闷不乐'
}

/** 未知 species（脏数据）时按小猫兜底，避免整页崩掉 */
export function normalizePetSpecies(raw: string | null | undefined): PetSpecies {
  if (raw && raw in PET_SPECIES_FALLBACK) return raw as PetSpecies
  return 'cat'
}

/** 取物种配色：优先用服务端下发的 palette，缺失时回退本地表 */
export function resolveSpeciesPalette(species: PetSpecies, palette?: PetPalette | null): PetPalette {
  const fallback = PET_SPECIES_FALLBACK[species].palette
  if (!palette) return fallback
  return {
    primary: palette.primary || fallback.primary,
    secondary: palette.secondary || fallback.secondary,
    accent: palette.accent || fallback.accent,
  }
}

/** 物种显示名 + emoji（catalog 缺失时回退本地表） */
export function resolveSpeciesMeta(
  species: PetSpecies,
  info?: { name?: string; emoji?: string; defaultName?: string } | null,
): { name: string; emoji: string; defaultName: string } {
  const fallback = PET_SPECIES_FALLBACK[species]
  return {
    name: info?.name || fallback.name,
    emoji: info?.emoji || fallback.emoji,
    defaultName: info?.defaultName || fallback.defaultName,
  }
}
