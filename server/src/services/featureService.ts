import prisma from '../lib/prisma.js'
import {
  DEFAULT_FEATURE_MAP,
  effectiveFeatureEnabled,
  FEATURE_KEYS,
  type FeatureKey,
} from '../lib/features.js'

type FeatureMap = Record<FeatureKey, boolean>

const CACHE_MS = 5000
let cache: { map: FeatureMap; at: number } | null = null

/** 读取功能开关（缺失的 key 按默认 true），带 5 秒内存缓存 */
export async function getFeatureMap(force = false): Promise<FeatureMap> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.map }
  }
  const map: FeatureMap = { ...DEFAULT_FEATURE_MAP }
  try {
    const rows = await prisma.featureFlag.findMany()
    for (const row of rows) {
      if ((FEATURE_KEYS as readonly string[]).includes(row.key)) {
        map[row.key as FeatureKey] = row.enabled
      }
    }
  } catch (err) {
    console.warn('[features] 读取功能开关失败，按默认全开处理：', err instanceof Error ? err.message : err)
  }
  cache = { map: { ...map }, at: Date.now() }
  return map
}

export function invalidateFeatureCache(): void {
  cache = null
}

export async function isFeatureEnabled(key: FeatureKey, role?: string): Promise<boolean> {
  if (role === 'admin') return true
  const map = await getFeatureMap()
  return effectiveFeatureEnabled(map, key)
}

export async function setFeature(key: FeatureKey, enabled: boolean, updatedBy: number): Promise<FeatureMap> {
  await prisma.featureFlag.upsert({
    where: { key },
    create: { key, enabled, updatedBy },
    update: { enabled, updatedBy },
  })
  invalidateFeatureCache()
  return getFeatureMap(true)
}
