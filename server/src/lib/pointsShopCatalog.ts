/**
 * 积分商店默认商品目录（纯数据，禁止 import prisma / 网络依赖）。
 *
 * 单独成模块的原因：`scripts/verify-points.ts` 要断言这批商品（价格区间、稀有度合法、
 * payload 的样式 key 命中白名单），而自检脚本必须能在没有 Prisma 客户端的环境里跑。
 * pointsService 只负责「幂等播种」这套数据，早期批次（v1–v3）仍留在服务里，
 * 新批次一律写在这里，避免自检脚本被迫 import 服务层。
 */

export interface DefaultShopItem {
  key: string
  type: 'title' | 'emoji' | 'avatar_frame'
  name: string
  description: string
  cost: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'
  payload: Record<string, unknown>
  sortOrder: number
}

/**
 * 神话系列头像框（第四批）：深渊 / 蚀月为普通框（伪元素外圈），
 * 量子 / 龙裔 / 不朽带装饰层动画与 mythic 稀有度。
 */
export const DEFAULT_FRAME_ITEMS_V4: readonly DefaultShopItem[] = [
  { key: 'frame_v4_abyss', type: 'avatar_frame', name: '深渊之环', description: '墨蓝的深渊在头像边缘缓缓下沉，偶尔翻起一圈冷光。', cost: 3500, rarity: 'epic', payload: { frame: 'abyss', color: '#4c1d95' }, sortOrder: 310 },
  { key: 'frame_v4_eclipse', type: 'avatar_frame', name: '蚀月之环', description: '日轮被暗影吞去一半，只剩一圈金色日冕贴在头像外沿。', cost: 4200, rarity: 'epic', payload: { frame: 'eclipse', color: '#f59e0b' }, sortOrder: 320 },
  { key: 'frame_v4_quantum', type: 'avatar_frame', name: '量子之环', description: '青蓝色的量子轨道绕着头像高速公转，视线扫过时闪一下。', cost: 6000, rarity: 'mythic', payload: { frame: 'quantum', color: '#22d3ee' }, sortOrder: 330 },
  { key: 'frame_v4_draconis', type: 'avatar_frame', name: '龙裔之环', description: '赤金鳞光沿环带游走，环外浮起两道未熄的龙息。', cost: 7000, rarity: 'mythic', payload: { frame: 'draconis', color: '#e11d48' }, sortOrder: 340 },
  { key: 'frame_v4_immortal', type: 'avatar_frame', name: '不朽王座', description: '黑金双环镶着不灭的火种，戴上它像是被加冕过。', cost: 8000, rarity: 'mythic', payload: { frame: 'immortal', color: '#f5c542' }, sortOrder: 350 },
]

/**
 * 神话系列称号（第四批）：singularity / zenith / eternity / chaos / firmament 五个新特效，
 * 三件传说（低价尝鲜）+ 五件神话（新增最高稀有度）。
 */
export const DEFAULT_TITLE_ITEMS_V4: readonly DefaultShopItem[] = [
  { key: 'title_v4_eternity_dawn', type: 'title', name: '永恒之光', description: '一圈不紧不慢的时间光环，把名字圈成不会褪色的一小片。', cost: 3600, rarity: 'legendary', payload: { icon: '🔆', color: '#8ecaff', effect: 'eternity' }, sortOrder: 102 },
  { key: 'title_v4_chaos_wave', type: 'title', name: '混沌之潮', description: '碎片在名字周围无序翻涌，谁也说不准下一片会飘向哪。', cost: 4200, rarity: 'legendary', payload: { icon: '🌊', color: '#ff7ac6', effect: 'chaos' }, sortOrder: 103 },
  { key: 'title_v4_firmament_star', type: 'title', name: '星河穹顶', description: '把整片夜空折起来搭在名字上方，星子还在慢慢挪位。', cost: 4800, rarity: 'legendary', payload: { icon: '🌠', color: '#6ea8ff', effect: 'firmament' }, sortOrder: 104 },
  { key: 'title_v4_zenith', type: 'title', name: '极巅', description: '名字背后升起一道金色光柱，像是站在全服最高的那级台阶上。', cost: 9000, rarity: 'mythic', payload: { icon: '🔱', color: '#f5c542', effect: 'zenith' }, sortOrder: 105 },
  { key: 'title_v4_eternity', type: 'title', name: '不朽回响', description: '时间长河的刻度绕着称号旋转，风吹过也带不走一个字。', cost: 10000, rarity: 'mythic', payload: { icon: '🏛️', color: '#9ad8ff', effect: 'eternity' }, sortOrder: 106 },
  { key: 'title_v4_singularity', type: 'title', name: '奇点', description: '所有光都朝名字中心坍缩，只留一圈马上要熄灭的吸积盘。', cost: 12000, rarity: 'mythic', payload: { icon: '🌀', color: '#a371f7', effect: 'singularity' }, sortOrder: 107 },
  { key: 'title_v4_chaos', type: 'title', name: '混沌深渊', description: '规则在称号里碎成五彩的碎片，一边飞散一边重新拼合。', cost: 14000, rarity: 'mythic', payload: { icon: '🎭', color: '#ff5fae', effect: 'chaos' }, sortOrder: 108 },
  { key: 'title_v4_firmament', type: 'title', name: '苍穹主宰', description: '整片星海随你的名字缓慢旋转，抬头就是自己的夜空。', cost: 15000, rarity: 'mythic', payload: { icon: '🌌', color: '#5b8cff', effect: 'firmament' }, sortOrder: 109 },
]
