/**
 * 霓虹跑酷道路的「无限延伸」布局参数（纯常量与纯函数，可单测）。
 *
 * 道路几何仍是一整块 30km 长的平面，但会随进度按 1/4 长度整体前移：
 * 沥青纹理在整块道路上平铺 PARKOUR_ROAD_TEXTURE_REPEAT_Y = 1800 次，
 * 1800 能被 4 整除（= 450 个纹理周期），因此前移 1/4 长度后沥青花纹与原来完全重合，
 * 视觉上道路没有尽头；同时玩家前方永远保留 30km 以上的道路（远大于雾效 150m）。
 *
 * 这样既不用每帧重建几何，也不会像固定 30km 平面那样在 30,000m 处露出道路横断面。
 */

/** 单块道路几何的长度（米；近端 +40，远端 -30,000） */
export const PARKOUR_ROAD_LENGTH_M = 30_040
/** 沥青纹理在整条道路上的纵向平铺次数（与 parkourTextures.createAsphaltTexture 一致） */
export const PARKOUR_ROAD_TEXTURE_REPEAT_Y = 1800
/** 道路近端（+z，位于玩家身后）相对道路原点的偏移（米） */
export const PARKOUR_ROAD_NEAR_Z = 40
/** 道路几何在场景中的局部中心 z（近端 +40，远端 -30,000） */
export const PARKOUR_ROAD_CENTER_Z = PARKOUR_ROAD_NEAR_Z - PARKOUR_ROAD_LENGTH_M / 2
/** 每次整体前移的长度：1/4 条道路 = 450 个完整纹理周期 */
export const PARKOUR_ROAD_PERIOD_M = PARKOUR_ROAD_LENGTH_M / 4

/** 道路组应处的 z：按周期取整，玩家越过后整条道路前移一个周期 */
export function parkourRoadGroupZ(distanceM: number): number {
  const safeDistance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0
  const groupZ = -Math.floor(safeDistance / PARKOUR_ROAD_PERIOD_M) * PARKOUR_ROAD_PERIOD_M
  // 归一化 -0，避免测试与调试输出里出现无意义负零
  return groupZ === 0 ? 0 : groupZ
}

/** 当前时刻道路相对玩家的覆盖范围（米；用于单测与调试） */
export function parkourRoadCoverage(distanceM: number): { behindM: number; aheadM: number } {
  const safeDistance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0
  const groupZ = parkourRoadGroupZ(safeDistance)
  const playerZ = -safeDistance
  const nearZ = groupZ + PARKOUR_ROAD_NEAR_Z
  const farZ = nearZ - PARKOUR_ROAD_LENGTH_M
  return {
    behindM: nearZ - playerZ,
    aheadM: playerZ - farZ,
  }
}