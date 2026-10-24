/**
 * 游戏大厅目录（客户端，纯数据）
 *
 * 大厅页按 `GAME_CATALOG` 渲染卡片：只有 `status === 'available'`（同时 `playable === true`）
 * 的游戏可进入，其余显示为「即将上线」占位。2048 支持单机与好友联机，
 * 路由与 `App.tsx` 中的 `/games/2048`、`/games/2048/online` 保持一致。
 */

/** 游戏支持的模式：单机 / 同屏双人 / 好友联机 */
export type GameCatalogMode = 'single' | 'local' | 'online'

/** 游戏上线状态：available 可玩，coming-soon 仅为占位 */
export type GameCatalogStatus = 'available' | 'coming-soon'

/** 大厅目录项 */
export interface GameCatalogEntry {
  /** 唯一标识，与后端 `game` 字段一致（如 '2048'） */
  id: string
  /** 展示名称 */
  name: string
  /** 一句话介绍 */
  description: string
  /** 卡片图标（emoji，无需额外图片资源） */
  icon: string
  /** 支持的模式：单机 / 联机 */
  modes: GameCatalogMode[]
  /** 上线状态 */
  status: GameCatalogStatus
  /** 是否可玩（与 status 保持一致，方便 UI 直接判断） */
  playable: boolean
  /** 单机模式路由；未上线或暂无单机模式为 null */
  route: string | null
  /** 联机模式路由；未上线或暂无联机模式为 null */
  onlineRoute: string | null
}

/** 2048 单机模式路由 */
export const GAME_2048_ROUTE = '/games/2048'
/** 2048 联机大厅路由（对局详情为 `${GAME_2048_ONLINE_ROUTE}/:matchId`） */
export const GAME_2048_ONLINE_ROUTE = '/games/2048/online'
/** 斗地主单机模式路由 */
export const GAME_DOUDIZHU_ROUTE = '/games/doudizhu'
/** 斗地主联机大厅路由（对局详情为 `${GAME_DOUDIZHU_ONLINE_ROUTE}/:matchId`） */
export const GAME_DOUDIZHU_ONLINE_ROUTE = '/games/doudizhu/online'
/** 贪吃蛇单机 / 同屏双人对局路由（同屏联机是页内模式，不单独占路由） */
export const GAME_SNAKE_ROUTE = '/games/snake'
/** 贪吃蛇大地图联机大厅路由 */
export const GAME_SNAKE_ONLINE_ROUTE = '/games/snake/online'
/** 扫雷单机路由 */
export const GAME_MINESWEEPER_ROUTE = '/games/minesweeper'
/** 扫雷联机（轮流点）大厅路由 */
export const GAME_MINESWEEPER_ONLINE_ROUTE = '/games/minesweeper/online'
/** 跳一跳单机路由 */
export const GAME_JUMP_ROUTE = '/games/jump'
/** 跳一跳联机（轮流跳）大厅路由 */
export const GAME_JUMP_ONLINE_ROUTE = '/games/jump/online'
/** 我的世界单机路由 */
export const GAME_MINECRAFT_ROUTE = '/games/minecraft'
/** 我的世界联机（共享世界）大厅路由 */
export const GAME_MINECRAFT_ONLINE_ROUTE = '/games/minecraft/online'
/** 五子棋单机（人机对战）路由 */
export const GAME_GOMOKU_ROUTE = '/games/gomoku'
/** 五子棋联机（轮流落子）大厅路由 */
export const GAME_GOMOKU_ONLINE_ROUTE = '/games/gomoku/online'

/** 大厅完整目录：可玩游戏在前，即将上线占位在后 */
export const GAME_CATALOG: readonly GameCatalogEntry[] = [
  {
    id: '2048',
    name: '2048',
    description: '滑动合并数字方块，冲击 2048；支持单机练习与好友联机对战。',
    icon: '🔢',
    modes: ['single', 'online'],
    status: 'available',
    playable: true,
    route: GAME_2048_ROUTE,
    onlineRoute: GAME_2048_ONLINE_ROUTE,
  },
  {
    id: 'doudizhu',
    name: '斗地主',
    description: '经典三人扑克：叫分定地主、炸弹翻倍；支持单机 AI 练习与好友三人联机。',
    icon: '🃏',
    modes: ['single', 'online'],
    status: 'available',
    playable: true,
    route: GAME_DOUDIZHU_ROUTE,
    onlineRoute: GAME_DOUDIZHU_ONLINE_ROUTE,
  },
  {
    id: 'snake',
    name: '贪吃蛇',
    description: '经典街机吃果变长：单机冲分、同屏双人对掐，或好友大地图混战。',
    icon: '🐍',
    modes: ['single', 'local', 'online'],
    status: 'available',
    playable: true,
    route: GAME_SNAKE_ROUTE,
    onlineRoute: GAME_SNAKE_ONLINE_ROUTE,
  },
  {
    id: 'minesweeper',
    name: '扫雷',
    description: '数字推理排雷：单机三档难度冲纪录，联机模式一人只许下一次，轮流开格。',
    icon: '💣',
    modes: ['single', 'online'],
    status: 'available',
    playable: true,
    route: GAME_MINESWEEPER_ROUTE,
    onlineRoute: GAME_MINESWEEPER_ONLINE_ROUTE,
  },
  {
    id: 'jump',
    name: '跳一跳',
    description: '按住蓄力、松手起跳，落点越靠近中心分越高；支持单机冲榜与好友轮流对战。',
    icon: '🎯',
    modes: ['single', 'online'],
    status: 'available',
    playable: true,
    route: GAME_JUMP_ROUTE,
    onlineRoute: GAME_JUMP_ONLINE_ROUTE,
  },
  {
    id: 'minecraft',
    name: '我的世界',
    description: '三维体素沙盒：程序化地形上挖矿、建造、飞行；单机随时续玩，联机与好友共享同一片世界。',
    icon: '⛏️',
    modes: ['single', 'online'],
    status: 'available',
    playable: true,
    route: GAME_MINECRAFT_ROUTE,
    onlineRoute: GAME_MINECRAFT_ONLINE_ROUTE,
  },
  {
    id: 'gomoku',
    name: '五子棋',
    description: '15×15 经典连五对弈：黑先白后轮流落子，率先连成五子获胜；支持单机人机练习与好友联机。',
    icon: '⚫',
    modes: ['single', 'online'],
    status: 'available',
    playable: true,
    route: GAME_GOMOKU_ROUTE,
    onlineRoute: GAME_GOMOKU_ONLINE_ROUTE,
  },
]

/** 当前可玩的游戏（大厅卡片入口） */
export const PLAYABLE_GAMES: readonly GameCatalogEntry[] = GAME_CATALOG.filter(
  (game) => game.playable,
)

/** 即将上线的占位游戏 */
export const COMING_SOON_GAMES: readonly GameCatalogEntry[] = GAME_CATALOG.filter(
  (game) => !game.playable,
)

/** 按 id 查找目录项（找不到返回 undefined） */
export function getGameCatalogEntry(id: string): GameCatalogEntry | undefined {
  return GAME_CATALOG.find((game) => game.id === id)
}

/** 判断某个游戏 id 是否可玩 */
export function isGamePlayable(id: string): boolean {
  return getGameCatalogEntry(id)?.playable ?? false
}
