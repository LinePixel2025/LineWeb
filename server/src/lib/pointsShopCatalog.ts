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
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'transcendent'
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

/**
 * 至臻系列称号（第五批，2026-11-10）。
 *
 * 新增最高稀有度 `transcendent`（至臻）——比神话再高一档：徽章在神话黑金翼饰之外再叠一层
 * 至臻星环（`.gh-title-badge-transcendent`），商店卡与名字也有独立配色。
 * 新特效 genesis（创世星环）与 oblivion（湮灭奇点）只在这批里使用。
 */
export const DEFAULT_TITLE_ITEMS_V5: readonly DefaultShopItem[] = [
  { key: 'title_v5_dawn', type: 'title', name: '破晓之翼', description: '天际线裂开第一道光，金色羽翼在名字两侧缓缓展开。', cost: 5600, rarity: 'legendary', payload: { icon: '🌅', color: '#f6b73c', effect: 'aurora' }, sortOrder: 110 },
  { key: 'title_v5_tide', type: 'title', name: '潮汐君王', description: '蓝绿色的潮水一遍遍漫过称号，退去时留下细碎的盐晶光。', cost: 6200, rarity: 'legendary', payload: { icon: '🌊', color: '#3ec6c6', effect: 'blossom' }, sortOrder: 111 },
  { key: 'title_v5_throne', type: 'title', name: '永恒王座', description: '一座金色王座从名字背后升起，扶手两侧的光柱永不熄灭。', cost: 16000, rarity: 'mythic', payload: { icon: '👑', color: '#f5c542', effect: 'zenith' }, sortOrder: 112 },
  { key: 'title_v5_starforge', type: 'title', name: '星铸', description: '把你名字的每一笔都重铸成星辰，锤落之处溅起一整圈星屑。', cost: 18000, rarity: 'mythic', payload: { icon: '⚒️', color: '#8ecaff', effect: 'genesis' }, sortOrder: 113 },
  { key: 'title_v5_void_emperor', type: 'title', name: '虚空帝皇', description: '所有光在称号中心坍缩成一枚安静的黑色王印，边缘仍有吸积盘在燃烧。', cost: 20000, rarity: 'mythic', payload: { icon: '🕳️', color: '#a371f7', effect: 'singularity' }, sortOrder: 114 },
  { key: 'title_v5_genesis', type: 'title', name: '创世者', description: '一圈金白色的创世星环绕名旋转，星环内侧不断诞生又熄灭微小的恒星。', cost: 30000, rarity: 'transcendent', payload: { icon: '🌐', color: '#ffd76a', effect: 'genesis' }, sortOrder: 115 },
  { key: 'title_v5_oblivion', type: 'title', name: '湮灭之主', description: '名字周围的空间被缓慢抹去又重写，紫黑色的湮灭奇点像一只不肯闭上的眼睛。', cost: 36000, rarity: 'transcendent', payload: { icon: '♾️', color: '#c084fc', effect: 'oblivion' }, sortOrder: 116 },
  { key: 'title_v5_zenith_of_all', type: 'title', name: '万象归一', description: '整片星海、极光与潮汐同时在你名字背后归位——LineWeb 称号的最高一档。', cost: 50000, rarity: 'transcendent', payload: { icon: '🌠', color: '#7aa7ff', effect: 'firmament' }, sortOrder: 117 },
]
