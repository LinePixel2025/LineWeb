import { describe, expect, it } from 'vitest'
import {
  PARKOUR_ROAD_CENTER_Z,
  PARKOUR_ROAD_LENGTH_M,
  PARKOUR_ROAD_NEAR_Z,
  PARKOUR_ROAD_PERIOD_M,
  PARKOUR_ROAD_TEXTURE_REPEAT_Y,
  parkourRoadCoverage,
  parkourRoadGroupZ,
} from '../parkourRoad'

/** 道路必须永远覆盖相机前方（相机远裁剪 420m、雾效远端 150m） */
const MIN_AHEAD_M = 20_000
/** 道路近端必须留在玩家身后，避免镜头下方露出空隙 */
const MIN_BEHIND_M = PARKOUR_ROAD_NEAR_Z

describe('parkour 道路循环', () => {
  it('道路周期与纹理平铺严格对齐（1/4 赛道 = 整数个纹理周期）', () => {
    expect(PARKOUR_ROAD_TEXTURE_REPEAT_Y % 4).toBe(0)
    expect(PARKOUR_ROAD_PERIOD_M).toBe(PARKOUR_ROAD_LENGTH_M / 4)
    expect(
      (PARKOUR_ROAD_PERIOD_M / PARKOUR_ROAD_LENGTH_M) * PARKOUR_ROAD_TEXTURE_REPEAT_Y,
    ).toBe(PARKOUR_ROAD_TEXTURE_REPEAT_Y / 4)
    expect(PARKOUR_ROAD_CENTER_Z).toBe(PARKOUR_ROAD_NEAR_Z - PARKOUR_ROAD_LENGTH_M / 2)
  })

  it('按周期取整前移：不足一个周期不前移，越过周期后整段前移', () => {
    expect(parkourRoadGroupZ(0)).toBe(0)
    expect(parkourRoadGroupZ(PARKOUR_ROAD_PERIOD_M - 0.01)).toBe(0)
    expect(parkourRoadGroupZ(PARKOUR_ROAD_PERIOD_M)).toBe(-PARKOUR_ROAD_PERIOD_M)
    expect(parkourRoadGroupZ(30_000)).toBe(-PARKOUR_ROAD_PERIOD_M * 3)
    expect(parkourRoadGroupZ(120_000)).toBe(-PARKOUR_ROAD_PERIOD_M * 15)
  })

  it('脏数据（负数 / NaN / Infinity）回退到起点，不产生 NaN 坐标', () => {
    expect(parkourRoadGroupZ(-100)).toBe(0)
    expect(parkourRoadGroupZ(Number.NaN)).toBe(0)
    expect(parkourRoadGroupZ(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('任意距离都覆盖玩家前后足够范围（30km 后仍不会露头）', () => {
    const distances = [0, 1, 7_509.9, 7_510, 29_900, 30_000, 30_500, 60_000, 120_000, 1_000_000]
    for (const distance of distances) {
      const { aheadM, behindM } = parkourRoadCoverage(distance)
      expect(Number.isFinite(aheadM)).toBe(true)
      expect(aheadM).toBeGreaterThan(MIN_AHEAD_M)
      expect(behindM).toBeGreaterThanOrEqual(MIN_BEHIND_M)
    }
  })

  it('每前移一个周期都恰好是整数个纹理周期，且道路位置随周期整体平移', () => {
    const tilesPerPeriod = (PARKOUR_ROAD_PERIOD_M / PARKOUR_ROAD_LENGTH_M) * PARKOUR_ROAD_TEXTURE_REPEAT_Y
    expect(Number.isInteger(tilesPerPeriod)).toBe(true)
    expect(tilesPerPeriod).toBe(450)
    for (const distance of [0, 1234.5, 30_000, 123_456.7]) {
      expect(parkourRoadGroupZ(distance + PARKOUR_ROAD_PERIOD_M)).toBe(
        parkourRoadGroupZ(distance) - PARKOUR_ROAD_PERIOD_M,
      )
    }
  })
})