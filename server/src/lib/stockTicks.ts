/**
 * 股市实时 tick 行情引擎（纯计算层，禁止 import prisma / 网络依赖）。
 *
 * 四层价格模型：
 * 1. 日线锚点（不动）：stockMarket.ts 的确定性日生成器给出每日 open/close，
 *   历史 K 线零变化；秒级基准路径在「今日 open → 今日 close」之间线性插值作为锚点；
 * 2. 秒级基准路径 basePath(tick) = anchor(tick) × (1 + noise(tick) + wave(tick))：
 *   - noise 为 OU 式均值回归随机游走（按 (code, dateKey) 播种，起点 0），负责秒级抖动；
 *   - wave 为确定性「盘中慢波」（3 个正弦叠加，周期 30–180 分钟，总幅度 ±0.6%~±1.2%，
 *     首尾用 sin 包络压到 0）—— 这是给趋势交易者的可交易波段，旧版只有纯噪声，
 *     分时图没有任何结构性起伏，玩家只能赌下一秒的随机数；
 *   两者都按 (code, dateKey) 播种，重启后从 tick 0 重算完全一致，重启价格零跳变；
 * 3. 新闻事件冲击 eventImpact：每只股票每天 0–2 条确定性利好 / 利空快讯，
 *   在指定 tick 触发后按 45–120 分钟半衰期指数衰减（同样无定时器，读时计算）；
 * 4. 玩家冲击 impact：买入推高 / 卖出压低价格，读时按 10 分钟半衰期指数衰减。
 *   状态通过 SiteSetting('stock.marketImpact') 持久化，prisma 读写放在 stockService.ts，
 *   本文件只提供序列化 / 恢复纯函数。
 *
 * 实时价 = basePath(当前 tick) × (1 + 玩家冲击 + 事件冲击)，每次报价实时计算
 * （不走物化缓存），因此成交与新闻触发都能在下一次报价立即反映。
 * 内存只保留当前日的 tick 缓存（每股 2 × Float64Array(28800) ≈ 460KB，
 * 12 只约 5.5MB），跨日整包重建；新闻 / 慢波参数按 (dateKey, code) 懒算并缓存当日。
 */

import {
  STOCK_DEFINITIONS,
  STOCK_MARKET_DISCLAIMER,
  getStockDailySeries,
  mulberry32,
  seedFromString,
  dateKeyToUtc,
  type StockCandle,
  type StockDefinition,
  type StockMarketDto,
  type StockMarketMood,
  type StockNewsItemDto,
  type StockQuoteDto,
} from './stockMarket.js'
import { STOCK_FEE_RATE, STOCK_MAX_INVEST, STOCK_MIN_INVEST } from './stockTrading.js'
import { getTodayDateKey } from './pointsRules.js'

/** 行情 tick 间隔（毫秒）：每 3 秒推进一个报价 */
export const STOCK_TICK_MS = 3000
/** 每日 tick 数 = 86_400_000 / STOCK_TICK_MS = 28800 */
export const STOCK_TICKS_PER_DAY = 86_400_000 / STOCK_TICK_MS

/* ============================================================
   玩家冲击参数
   ============================================================ */

/** 冲击系数：每 1 万积分买入 ≈ +0.2%（卖出按毛收入等量反向） */
export const STOCK_IMPACT_PER_POINT = 2e-7
/** 冲击幅度上下限（±5%） */
export const STOCK_IMPACT_MAX = 0.05
/** 冲击半衰期：10 分钟（读时惰性衰减，无定时器） */
export const STOCK_IMPACT_HALF_LIFE_MS = 600_000
/** 冲击状态在 SiteSetting 表中的持久化键 */
export const IMPACT_STATE_SETTING_KEY = 'stock.marketImpact'

/* ============================================================
   噪声 / 慢波参数
   ============================================================ */

/** 噪声每步衰减系数（0.993 → 相关时间约 143 tick ≈ 7 分钟） */
const STOCK_NOISE_DECAY = 0.993
/** 价格下限（与日线生成器一致） */
const STOCK_PRICE_FLOOR = 0.5
/** 分时采样间隔：每 20 tick（60 秒）一点 */
export const STOCK_INTRADAY_SAMPLE_TICKS = 20

/** 慢波总幅度区间（±0.6%~±1.2%）：足够做出可交易的波段，又不至于盖过日线锚点 */
export const STOCK_WAVE_MIN_AMPLITUDE = 0.006
export const STOCK_WAVE_MAX_AMPLITUDE = 0.012
/** 慢波周期区间（30–180 分钟），换成 tick 数即 600–3600 */
const STOCK_WAVE_MIN_PERIOD_TICKS = 600
const STOCK_WAVE_MAX_PERIOD_TICKS = 3_600
/** 谐波权重：3 条正弦按 50/30/20 分配总幅度，叠加后形态不重复 */
const STOCK_WAVE_WEIGHTS = [0.5, 0.3, 0.2] as const

/* ============================================================
   新闻事件参数
   ============================================================ */

/** 每只股票每天最多 2 条事件 */
export const STOCK_NEWS_MAX_EVENTS = 2
/** 事件冲击幅度区间（带符号前）1.5%–5% */
export const STOCK_NEWS_MIN_IMPACT = 0.015
export const STOCK_NEWS_MAX_IMPACT = 0.05
/** 事件半衰期区间 45–120 分钟 */
export const STOCK_NEWS_MIN_HALF_LIFE_MS = 45 * 60_000
export const STOCK_NEWS_MAX_HALF_LIFE_MS = 120 * 60_000
/**
 * 同日两条事件的最小间隔 = 首条半衰期 × 4。
 * 4 个半衰期后首条残余 ≤ 6.25%，再叠加第二条才不会出现「两条冲击互相放大」
 * 的失真区间，也保证 startTick 互不重叠。
 */
const STOCK_NEWS_GAP_HALF_LIVES = 4

export interface StockNewsEvent {
  /** 稳定 id：`${code}-${dateKey}-${index}` */
  id: string
  code: string
  /** 中文快讯标题（按板块文案池挑选，含股票名） */
  title: string
  summary: string
  sentiment: 'good' | 'bad'
  /** 触发 tick（1..28799），同一只股票事件不重叠 */
  startTick: number
  /** 冲击幅度（带符号，good 正 bad 负，绝对 1.5%–5%） */
  impact: number
  /** 半衰期（45–120 分钟） */
  halfLifeMs: number
}

interface NewsCopy {
  title: string
  summary: string
}

interface NewsPool {
  good: readonly NewsCopy[]
  bad: readonly NewsCopy[]
}

/**
 * 新闻文案池：按板块分组，每组利好 / 利空各 6 条。
 * 文案里用 {{name}} 占位股票名（同一板块的不同股票共用一个池，标题才不会重复）。
 * 多板块合并成一组是为了控制体积：科技/半导体共用 tech，农业/消费共用 consumer……
 */
const NEWS_POOLS: Record<string, NewsPool> = {
  tech: {
    good: [
      { title: '{{name}}发布新一代自研芯片，算力提升四成', summary: '机构调研纪要显示新产品已进入小批量交付，市场预期明年放量。' },
      { title: '{{name}}获得大额算力订单，产能排至明年二季度', summary: '订单金额未披露，但供应链人士称已锁定关键材料供应。' },
      { title: '{{name}}核心架构专利获批，技术壁垒抬升', summary: '专利覆盖底层架构，研发投入转化好于市场预期。' },
      { title: '{{name}}与头部云厂商达成战略合作', summary: '双方将在模型推理与边缘计算上共建方案，首批项目本季度落地。' },
      { title: '{{name}}季度营收同比增长三成，毛利率回升', summary: '高毛利产品占比提升，管理层维持全年指引。' },
      { title: '{{name}}启动回购计划，规模上限为流通盘 2%', summary: '回购股份将用于员工激励，释放长期信心。' },
    ],
    bad: [
      { title: '{{name}}关键设备交付延期，新产线投产推迟', summary: '供应商确认物流受阻，公司未给出新的时间表。' },
      { title: '{{name}}遭竞争对手发起专利诉讼', summary: '诉讼涉及两项基础专利，短期或影响部分产品出货。' },
      { title: '{{name}}下调全年出货指引', summary: '管理层称下游客户进入去库存阶段，需求恢复晚于预期。' },
      { title: '{{name}}核心技术人员离职', summary: '公司称研发梯队完整，但市场担忧下一代产品节奏。' },
      { title: '{{name}}季度毛利率下滑，费用率上升', summary: '价格战导致产品均价下降，销售费用同比明显增加。' },
      { title: '{{name}}被监管问询关联交易细节', summary: '交易所要求补充披露交易定价依据与资金流向。' },
    ],
  },
  energy: {
    good: [
      { title: '{{name}}新电站并网发电，装机容量超预期', summary: '项目提前一个季度投产，预计明年贡献稳定现金流。' },
      { title: '{{name}}签订长期供能协议，锁价三年', summary: '协议设定价格联动机制，降低了下游需求波动的敞口。' },
      { title: '{{name}}储能项目中标，规模创公司纪录', summary: '中标价格高于市场预期，验证了系统集成的成本优势。' },
      { title: '{{name}}获政策补贴支持，资本开支压力缓解', summary: '补贴覆盖首批设备采购，项目内部收益率上调。' },
      { title: '{{name}}季度发电量创新高，利用率提升', summary: '资源条件改善，叠加运维效率提升。' },
      { title: '{{name}}与工业园区签署绿电直供协议', summary: '用电方承诺最低采购量，收入可预测性增强。' },
    ],
    bad: [
      { title: '{{name}}项目并网进度落后于计划', summary: '电网接入审批延长，公司下调年内投产目标。' },
      { title: '{{name}}上网电价下调，收入预期承压', summary: '新签合同电价低于存量项目，机构下调盈利预测。' },
      { title: '{{name}}设备故障导致部分机组停机检修', summary: '公司称无安全事故，但检修期间发电量将明显下降。' },
      { title: '{{name}}原材料价格上涨，项目成本超支', summary: '关键部件价格年内涨幅明显，毛利空间被压缩。' },
      { title: '{{name}}应收账款回收周期拉长', summary: '下游客户付款放缓，经营性现金流短期承压。' },
      { title: '{{name}}新项目环评被要求补充材料', summary: '审批节奏延后，市场担心年内开工计划落空。' },
    ],
  },
  consumer: {
    good: [
      { title: '{{name}}新品上市首周销量超预期', summary: '渠道反馈铺货率快速提升，公司已追加生产计划。' },
      { title: '{{name}}提价顺利落地，终端动销稳定', summary: '提价幅度约 3%–5%，未对销量造成明显影响。' },
      { title: '{{name}}线上渠道销售额同比增长四成', summary: '自播与达人矩阵贡献主要增量，退货率保持低位。' },
      { title: '{{name}}新增产能投产，交付周期缩短', summary: '新工厂自动化率提升，单位成本有望下降。' },
      { title: '{{name}}入选地方消费刺激名单', summary: '补贴范围覆盖核心单品，短期订单明显增加。' },
      { title: '{{name}}与连锁商超签订年度供货协议', summary: '协议覆盖全国主要门店，预计带来稳定增量收入。' },
    ],
    bad: [
      { title: '{{name}}部分批次产品被要求下架复检', summary: '公司称属预防性措施，但短期影响渠道供货。' },
      { title: '{{name}}促销力度加大，毛利率承压', summary: '行业价格战延续，公司为保份额被动跟进。' },
      { title: '{{name}}渠道库存偏高，经销商打款放缓', summary: '公司计划控货消化库存，短期收入增速或下滑。' },
      { title: '{{name}}原材料成本上行，提价空间有限', summary: '竞品价格战限制了终端提价幅度。' },
      { title: '{{name}}新品反馈分化，复购率待观察', summary: '社媒声量高但转化一般，机构下调首年销量预期。' },
      { title: '{{name}}被曝代工厂管理问题，公司启动核查', summary: '公司称已暂停相关产线，等待核查结论。' },
    ],
  },
  health: {
    good: [
      { title: '{{name}}核心品种通过一致性评价', summary: '有望参与新一轮集采，市场份额存在提升空间。' },
      { title: '{{name}}创新药二期临床达到主要终点', summary: '公司计划尽快启动三期，向监管提交沟通申请。' },
      { title: '{{name}}获得海外注册批件，打开新增市场', summary: '首批订单预计下季度确认收入。' },
      { title: '{{name}}季度销售费用率下降，净利率改善', summary: '数字化营销投入见效，人均产出提升。' },
      { title: '{{name}}与三甲医院共建临床研究中心', summary: '研究覆盖两个适应症，为后续注册提供数据支持。' },
      { title: '{{name}}原料药自供比例提升，成本下降', summary: '关键中间体实现自产，供应链稳定性增强。' },
    ],
    bad: [
      { title: '{{name}}某产品被纳入重点监控目录', summary: '短期处方量或受影响，公司正评估替代品种的补充。' },
      { title: '{{name}}临床试验进度不及预期', summary: '入组速度偏慢，公司推迟数据读出时间。' },
      { title: '{{name}}集采报价低于预期，以价换量', summary: '中标价格下降明显，机构下调相关品种收入预测。' },
      { title: '{{name}}收到药监补充资料通知', summary: '注册审批节奏延后，上市时间存在不确定性。' },
      { title: '{{name}}销售合规检查，部分推广活动暂停', summary: '公司称属常规检查，但短期学术推广节奏放缓。' },
      { title: '{{name}}核心专利临近到期，仿制压力上升', summary: '多家企业已提交仿制申请，竞争格局趋紧。' },
    ],
  },
  media: {
    good: [
      { title: '{{name}}新作预约量破纪录，上线档期提前', summary: '渠道预约转化率高，公司上调首月流水预期。' },
      { title: '{{name}}与头部 IP 达成联动合作', summary: '联动活动将覆盖核心用户群，提升付费意愿。' },
      { title: '{{name}}季度流水环比增长，长线运营见效', summary: '老产品通过版本更新延长生命周期，买量效率提升。' },
      { title: '{{name}}海外发行取得突破，进入畅销榜前列', summary: '本地化版本表现超预期，公司计划加大投放。' },
      { title: '{{name}}广告业务签约多个品牌客户', summary: '品牌预算回暖，刊例价与填充率同步提升。' },
      { title: '{{name}}短剧项目上线首日播放量领先', summary: '平台推荐位加持，分账收入有望超预期。' },
    ],
    bad: [
      { title: '{{name}}新作上线延期，档期调整至下季度', summary: '公司称需要更多时间打磨，市场担心流水递延。' },
      { title: '{{name}}被指内容合规问题，部分内容下架整改', summary: '公司已启动自查，短期影响广告与会员收入。' },
      { title: '{{name}}季度流水下滑，买量成本上升', summary: '获客单价上涨，利润率承压。' },
      { title: '{{name}}核心制作人离职，项目进度存疑', summary: '公司称团队稳定，但新项目排期未披露。' },
      { title: '{{name}}版号审批进度不及预期', summary: '多款产品仍在排队，上线时间存在不确定性。' },
      { title: '{{name}}广告主预算收缩，刊例执行率下降', summary: '品牌方推迟投放，短期收入可见度降低。' },
    ],
  },
  industrial: {
    good: [
      { title: '{{name}}中标重大工程项目，金额创年内新高', summary: '项目分三年确认收入，订单能见度提升。' },
      { title: '{{name}}海外订单增长，出口占比提升', summary: '新兴市场需求旺盛，公司加快本地化服务布局。' },
      { title: '{{name}}智能制造产线投产，人均效率提升', summary: '自动化改造降低单位人工成本，交付周期缩短。' },
      { title: '{{name}}获评国家级专精特新企业', summary: '有望获得政策与融资支持，品牌背书增强。' },
      { title: '{{name}}与上游签订长期供货协议，成本锁定', summary: '关键原材料价格波动风险下降。' },
      { title: '{{name}}季度订单同比双位数增长', summary: '在手订单饱满，产能利用率维持高位。' },
    ],
    bad: [
      { title: '{{name}}项目验收延期，收入确认后移', summary: '客户现场条件未达标，公司称不影响最终交付。' },
      { title: '{{name}}原材料涨价，毛利率承压', summary: '成本传导存在时滞，短期利润率下滑。' },
      { title: '{{name}}海外订单受物流受阻影响', summary: '部分货物滞留港口，交付节奏被打乱。' },
      { title: '{{name}}应收账款计提增加，现金流承压', summary: '部分客户回款不及预期，公司加大催收力度。' },
      { title: '{{name}}发生生产安全事故，相关产线停产整顿', summary: '公司称无人员重伤，但复产时间待定。' },
      { title: '{{name}}同业扩产引发价格竞争', summary: '新增产能集中释放，产品均价存在下行压力。' },
    ],
  },
  aerospace: {
    good: [
      { title: '{{name}}成功完成新型号首飞试验', summary: '试验数据符合预期，为后续定型与批量交付铺路。' },
      { title: '{{name}}获得卫星组网批量订单', summary: '订单覆盖未来两年产能，收入确定性提升。' },
      { title: '{{name}}商业发射任务圆满成功', summary: '一箭多星方案验证成功，发射成本有望下降。' },
      { title: '{{name}}与科研院所共建实验室', summary: '聚焦先进材料与推进系统，强化长期技术储备。' },
      { title: '{{name}}测控系统通过验收，进入交付阶段', summary: '系统稳定性获客户认可，后续有望复制到其他项目。' },
      { title: '{{name}}获得产业基金增资', summary: '资金将用于产能扩建与新型号研发。' },
    ],
    bad: [
      { title: '{{name}}发射任务因天气原因推迟', summary: '公司称窗口将顺延，年内发射计划或受影响。' },
      { title: '{{name}}新型号试验数据不及预期', summary: '公司称将复盘改进，后续试验时间待定。' },
      { title: '{{name}}部分零部件供应紧张，交付延后', summary: '关键器件交期拉长，公司正寻找替代供应。' },
      { title: '{{name}}项目预算调整，回款周期延长', summary: '客户方预算审批放缓，短期现金流承压。' },
      { title: '{{name}}被要求补充型号安全审查材料', summary: '审查流程延长，定型节点存在不确定性。' },
      { title: '{{name}}研发费用超支，短期利润承压', summary: '多项试验并行推进，费用确认集中在当期。' },
    ],
  },
}

/** 板块 → 文案池分组（未列出的板块回落到 industrial，保证一定有文案） */
const NEWS_GROUP_OF_SECTOR: Record<string, string> = {
  科技: 'tech',
  半导体: 'tech',
  能源: 'energy',
  新能源: 'energy',
  消费: 'consumer',
  农业: 'consumer',
  医药: 'health',
  传媒: 'media',
  游戏: 'media',
  物流: 'industrial',
  制造: 'industrial',
  航天: 'aerospace',
}

function newsPoolOf(sector: string): NewsPool {
  return NEWS_POOLS[NEWS_GROUP_OF_SECTOR[sector] ?? 'industrial']
}

/** 把文案里的 {{name}} 换成股票名 */
function fillNewsCopy(copy: NewsCopy, name: string): NewsCopy {
  return {
    title: copy.title.replaceAll('{{name}}', name),
    summary: copy.summary.replaceAll('{{name}}', name),
  }
}

/* ============================================================
   纯函数（供自检直接测试）
   ============================================================ */

/** 冲击读时衰减：value × 0.5^(elapsedMs / 半衰期)，elapsed 取 0 下限（防时钟回拨） */
export function decayImpact(value: number, elapsedMs: number): number {
  const elapsed = Math.max(0, elapsedMs)
  return value * Math.pow(0.5, elapsed / STOCK_IMPACT_HALF_LIFE_MS)
}

/** 冲击幅度夹紧到 ±STOCK_IMPACT_MAX */
export function clampImpact(value: number): number {
  return Math.max(-STOCK_IMPACT_MAX, Math.min(STOCK_IMPACT_MAX, value))
}

/** 买入冲击：现值 + points × 系数后夹紧（points ≤ 0 视为无冲击） */
export function applyBuyImpact(value: number, points: number): number {
  if (!(points > 0)) return clampImpact(value)
  return clampImpact(value + points * STOCK_IMPACT_PER_POINT)
}

/** 卖出冲击：现值 − gross × 系数后夹紧（gross ≤ 0 视为无冲击） */
export function applySellImpact(value: number, gross: number): number {
  if (!(gross > 0)) return clampImpact(value)
  return clampImpact(value - gross * STOCK_IMPACT_PER_POINT)
}

/**
 * 新闻事件在某个 tick 的合计冲击（纯函数，无缓存）。
 * 规则：tick < startTick 时事件尚未触发（贡献 0，因此 tick 0 恒为 0）；
 * 触发后按 2^(-((tick − startTick) × tickMs / halfLifeMs)) 指数衰减。
 * 同一只股票的事件 startTick 互不重叠（buildDayNews 保证间隔 ≥ 4 个半衰期）。
 */
export function eventImpactAt(
  events: readonly StockNewsEvent[],
  tick: number,
  tickMs: number = STOCK_TICK_MS,
): number {
  let sum = 0
  for (const event of events) {
    if (tick < event.startTick) continue
    const elapsedMs = (tick - event.startTick) * tickMs
    sum += event.impact * Math.pow(0.5, elapsedMs / event.halfLifeMs)
  }
  return sum
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * 为某只股票生成当日新闻事件（0–2 条，确定性）。
 *
 * 随机数取数顺序固定：事件条数 → 每条 [情绪, 幅度, 半衰期, 文案下标] → 首条起始 tick。
 * 因此同 (code, dateKey) 永远得到同一组事件，且事件会随日期变化。
 * 第一条事件留出「第二条所需间隔」的空间；放不下时只发一条（永远 ≤ 2）。
 */
export function buildDayNews(definition: StockDefinition, dateKey: string): StockNewsEvent[] {
  const rng = mulberry32(seedFromString(`lineweb-stock-news:${definition.code}:${dateKey}`))
  const roll = rng()
  // 45% 无事件 / 37% 一条 / 18% 两条：平均约 0.73 条/股/日，全市场每天约 9 条快讯
  const count = roll < 0.45 ? 0 : roll < 0.82 ? 1 : STOCK_NEWS_MAX_EVENTS
  if (count === 0) return []

  const drafts: Array<{
    sentiment: 'good' | 'bad'
    impact: number
    halfLifeMs: number
    copy: NewsCopy
  }> = []
  for (let index = 0; index < count; index += 1) {
    // 轻微偏利好（56%）：整体牛市长趋势里，好消息比坏消息略多
    const sentiment: 'good' | 'bad' = rng() < 0.56 ? 'good' : 'bad'
    const magnitude =
      STOCK_NEWS_MIN_IMPACT + rng() * (STOCK_NEWS_MAX_IMPACT - STOCK_NEWS_MIN_IMPACT)
    const halfLifeMs = Math.round(
      STOCK_NEWS_MIN_HALF_LIFE_MS + rng() * (STOCK_NEWS_MAX_HALF_LIFE_MS - STOCK_NEWS_MIN_HALF_LIFE_MS),
    )
    const pool = newsPoolOf(definition.sector)[sentiment]
    const picked = pool[Math.floor(rng() * pool.length) % pool.length]
    drafts.push({
      sentiment,
      impact: round4((sentiment === 'good' ? 1 : -1) * magnitude),
      halfLifeMs,
      copy: fillNewsCopy(picked, definition.name),
    })
  }

  const lastTick = STOCK_TICKS_PER_DAY - 1
  const gap0 = Math.ceil((drafts[0].halfLifeMs * STOCK_NEWS_GAP_HALF_LIVES) / STOCK_TICK_MS)
  const reserve = drafts.length > 1 ? Math.min(gap0, lastTick - 2) : 0
  // 首条落在 [1, lastTick − reserve − 1]，保证 tick 0 一定没有事件
  const span = Math.max(1, lastTick - 1 - reserve)
  const firstStart = 1 + Math.floor(rng() * span)
  const starts = [firstStart]
  if (drafts.length > 1) {
    const secondStart = firstStart + gap0
    // 放不下第二条（比如首条半衰期长 + 起始晚）就只保留一条
    if (secondStart <= lastTick) starts.push(secondStart)
  }

  return drafts.slice(0, starts.length).map((draft, index) => ({
    id: `${definition.code}-${dateKey}-${index}`,
    code: definition.code,
    title: draft.copy.title,
    summary: draft.copy.summary,
    sentiment: draft.sentiment,
    startTick: starts[index],
    impact: draft.impact,
    halfLifeMs: draft.halfLifeMs,
  }))
}

interface WaveHarmonic {
  amplitude: number
  periodTicks: number
  phase: number
}

function buildWaveHarmonics(code: string, dateKey: string): WaveHarmonic[] {
  const rng = mulberry32(seedFromString(`lineweb-stock-wave:${code}:${dateKey}`))
  const total =
    STOCK_WAVE_MIN_AMPLITUDE + rng() * (STOCK_WAVE_MAX_AMPLITUDE - STOCK_WAVE_MIN_AMPLITUDE)
  return STOCK_WAVE_WEIGHTS.map((weight) => ({
    amplitude: total * weight,
    periodTicks: Math.round(
      STOCK_WAVE_MIN_PERIOD_TICKS + rng() * (STOCK_WAVE_MAX_PERIOD_TICKS - STOCK_WAVE_MIN_PERIOD_TICKS),
    ),
    phase: rng() * Math.PI * 2,
  }))
}

/**
 * 盘中慢波（确定性）：3 条正弦叠加后乘 sin 包络。
 * 包络在 tick 0 与最后一个 tick 都恰好为 0 —— 前者保证「次日 tick0 = 开盘价」的
 * 日界衔接不变量，后者保证收盘时价格回归日线锚点（不会出现日末偏离收盘价 1%+）。
 */
function waveAt(harmonics: readonly WaveHarmonic[], tick: number): number {
  if (tick <= 0) return 0
  const t = Math.min(tick, STOCK_TICKS_PER_DAY - 1)
  const envelope = Math.sin((Math.PI * t) / (STOCK_TICKS_PER_DAY - 1))
  let value = 0
  for (const harmonic of harmonics) {
    value += harmonic.amplitude * Math.sin((2 * Math.PI * t) / harmonic.periodTicks + harmonic.phase)
  }
  return value * envelope
}

/** 慢波缓存：只保留当日 12 只的谐波参数（换日 / resetTicksForTest 时清空） */
let waveCache: { dateKey: string; map: Map<string, WaveHarmonic[]> } | null = null

function harmonicsOf(code: string, dateKey: string): WaveHarmonic[] {
  if (!waveCache || waveCache.dateKey !== dateKey) {
    waveCache = { dateKey, map: new Map() }
  }
  const cached = waveCache.map.get(code)
  if (cached) return cached
  const built = buildWaveHarmonics(code, dateKey)
  waveCache.map.set(code, built)
  return built
}

/**
 * 盘中慢波（对外导出，供自检直接断言）：
 * 返回该 tick 相对日线锚点的比例偏移（如 0.008 = +0.8%）。
 * tick 0 与当日最后一个 tick 恒为 0。
 */
export function dayWave(code: string, dateKey: string, tick: number): number {
  return waveAt(harmonicsOf(code.trim().toUpperCase(), dateKey), tick)
}

/* ============================================================
   冲击状态（模块级，每股票一个标量）
   ============================================================ */

interface ImpactState {
  /** 当前冲击幅度（带符号） */
  value: number
  /** 上次衰减 / 写入的时刻（毫秒），读时按差值衰减 */
  atMs: number
}

const impactStates = new Map<string, ImpactState>()
let impactDirty = false

/** 读某只股票的当前冲击（读时惰性衰减并回写，避免定时器） */
export function getImpact(code: string, nowMs: number): number {
  const state = impactStates.get(code.toUpperCase())
  if (!state || state.value === 0) return 0
  const decayed = decayImpact(state.value, nowMs - state.atMs)
  state.value = decayed
  state.atMs = nowMs
  return decayed
}

/**
 * 记一笔玩家交易冲击：买入传 +投入积分、卖出传 −毛收入。
 * 先按 nowMs 衰减旧值，再叠加 delta × 系数并夹紧，最后标记脏（待 stockService 落盘）。
 */
export function applyTradeImpactDelta(code: string, delta: number, nowMs: number): void {
  const key = code.toUpperCase()
  const current = getImpact(key, nowMs)
  impactStates.set(key, { value: clampImpact(current + delta * STOCK_IMPACT_PER_POINT), atMs: nowMs })
  impactDirty = true
}

/**
 * 序列化冲击状态（供 stockService 写入 SiteSetting）。
 * 先把全部冲击统一衰减到 nowMs 再落盘，恢复时用 savedAt 与现在的差值续算衰减。
 */
export function serializeImpactState(nowMs: number): string {
  const impacts: Record<string, number> = {}
  for (const [code, state] of impactStates) {
    const decayed = decayImpact(state.value, nowMs - state.atMs)
    state.value = decayed
    state.atMs = nowMs
    impacts[code] = decayed
  }
  return JSON.stringify({ savedAt: nowMs, impacts })
}

/**
 * 从 SiteSetting 的 value 恢复冲击状态（重启后调用一次）。
 * 容错约定：json 为 null / 解析失败 / 缺字段 / 数值非法 → 一律重置为 0；
 * savedAt 缺失或非法时视为「现在」，避免旧格式数据被瞬间大衰减。
 */
export function loadImpactStateFromJson(json: string | null, nowMs: number): void {
  impactStates.clear()
  impactDirty = false
  if (!json) return
  let savedAt = nowMs
  let entries: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(json) as { savedAt?: unknown; impacts?: unknown }
    if (typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
      savedAt = parsed.savedAt
    }
    if (parsed?.impacts && typeof parsed.impacts === 'object') {
      entries = parsed.impacts as Record<string, unknown>
    }
  } catch {
    return // 解析失败：上面已 clear，全部置 0
  }
  const elapsed = nowMs - savedAt
  for (const [code, value] of Object.entries(entries)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    impactStates.set(code.toUpperCase(), { value: clampImpact(decayImpact(value, elapsed)), atMs: nowMs })
  }
}

/**
 * 是否有未落盘的冲击变动。
 * 当前每笔交易即时落盘、该标记仅供自检脚本断言使用；保留给未来的周期性批量落盘，勿删。
 */
export function isImpactDirty(): boolean {
  return impactDirty
}

/** 冲击状态已成功写入 SiteSetting 后清除脏标记 */
export function markImpactPersisted(): void {
  impactDirty = false
}

/* ============================================================
   秒级基准路径（按日缓存，惰性延展）
   ============================================================ */

interface TickStockState {
  /** 秒级基准路径（日线锚点 × (1 + 噪声 + 慢波)，不含玩家 / 事件冲击） */
  basePath: Float64Array
  /** 物化价快照：延展时逐 tick 记录 basePath × (1 + 当时冲击 + 事件冲击)，供分时图采样 */
  materialized: Float64Array
  /** 已填充的最大 tick（含）；−1 = 尚未开始 */
  filled: number
  /** OU 噪声当前值（tick 0 恒为 0） */
  noise: number
  /** 噪声与虚拟成交量共用的 rng（每 (code, dateKey) 独立播种，取数顺序固定） */
  rng: () => number
  /** 每 tick 噪声步长（由日波动率换算，ensureDay 时算好） */
  sigmaTick: number
  /** 上一 tick 基准价（成交量扰动用） */
  prevBase: number
  todayOpen: number
  todayClose: number
  prevClose: number
  baseVolume: number
  /** 当日新闻事件（确定性，最多 2 条） */
  news: StockNewsEvent[]
  /** 当日慢波谐波参数 */
  wave: WaveHarmonic[]
  /** 盘中跟踪的最高 / 最低（物化价并入最新实时价） */
  high: number
  low: number
  /** 盘中累计虚拟成交量 */
  volumeAcc: number
}

/** 日缓存：只保留当前日，换日整包重建（跨日由 GC 回收旧数组） */
let dayCache: { dateKey: string; stocks: Map<string, TickStockState> } | null = null

function ensureDay(dateKey: string): Map<string, TickStockState> {
  if (dayCache && dayCache.dateKey === dateKey) return dayCache.stocks
  // 换日时慢波缓存一并丢弃，避免旧日谐波常驻内存
  if (waveCache && waveCache.dateKey !== dateKey) waveCache = null
  const stocks = new Map<string, TickStockState>()
  for (const definition of STOCK_DEFINITIONS) {
    const series = getStockDailySeries(definition, dateKey)
    const today = series[series.length - 1]
    const yesterday = series[series.length - 2] ?? today
    stocks.set(definition.code, {
      basePath: new Float64Array(STOCK_TICKS_PER_DAY),
      materialized: new Float64Array(STOCK_TICKS_PER_DAY),
      filled: -1,
      noise: 0,
      rng: mulberry32(seedFromString(`lineweb-stock-tick:${definition.code}:${dateKey}`)),
      // σ_tick = 日波动率 × √(tick 占全日比例) × 2（经验系数，噪声日内幅度约 ±0.5%）
      sigmaTick: definition.volatility * Math.sqrt(STOCK_TICK_MS / 86_400_000) * 2,
      prevBase: today.open,
      todayOpen: today.open,
      todayClose: today.close,
      prevClose: yesterday.close,
      baseVolume: definition.baseVolume,
      news: buildDayNews(definition, dateKey),
      wave: harmonicsOf(definition.code, dateKey),
      high: -Infinity,
      low: Infinity,
      volumeAcc: 0,
    })
  }
  dayCache = { dateKey, stocks }
  return stocks
}

/** 锚点：今日 open 与 close 之间按 tick 线性过渡（t = TICKS_PER_DAY − 1 时恰为 close） */
function anchorAt(state: TickStockState, tick: number): number {
  return state.todayOpen + (state.todayClose - state.todayOpen) * (tick / (STOCK_TICKS_PER_DAY - 1))
}

/**
 * 惰性延展基准路径到目标 tick。rng 取数顺序固定：t > 0 时噪声 2 次，之后成交量 1 次；
 * materialized 用「延展时刻」的玩家冲击盖章（分时图近似：历史点的冲击不回溯重算），
 * 但事件冲击按每个 tick 自身的触发状态计算（否则新闻触发前的历史采样会被倒灌）。
 */
function extendTo(state: TickStockState, tick: number, impact: number): void {
  if (tick <= state.filled) return
  for (let t = state.filled + 1; t <= tick; t += 1) {
    if (t > 0) {
      // OU 式均值回归：三角分布增量（rng() + rng() − 1 ∈ [−1, 1]）
      state.noise = state.noise * STOCK_NOISE_DECAY + state.sigmaTick * (state.rng() + state.rng() - 1)
    }
    const shaped = anchorAt(state, t) * (1 + state.noise + waveAt(state.wave, t))
    const base = Math.max(STOCK_PRICE_FLOOR, round2(shaped))
    state.basePath[t] = base
    const eventImpact = eventImpactAt(state.news, t)
    const materialized = Math.max(STOCK_PRICE_FLOOR, round2(base * (1 + impact + eventImpact)))
    state.materialized[t] = materialized
    if (materialized > state.high) state.high = materialized
    if (materialized < state.low) state.low = materialized
    // 虚拟成交量（确定性）：日基础量按 tick 均摊，随机 0.5–1.5 倍，
    // 再按该 tick 基准价变动加成（|Δbase/base| 每 0.1% 放大 4%，封顶 5 倍）
    const deltaRatio = state.prevBase > 0 ? (base - state.prevBase) / state.prevBase : 0
    state.volumeAcc +=
      state.baseVolume * (STOCK_TICK_MS / 86_400_000) * (0.5 + state.rng()) * Math.min(5, 1 + Math.abs(deltaRatio) * 40)
    state.prevBase = base
  }
  state.filled = tick
}

/** 当日第几个 tick（0..28799）；nowMs 早于当日 0 点按 0 处理（Asia/Shanghai 0 点 = UTC 前一日 16:00） */
export function tickIndexOf(dateKey: string, nowMs: number): number {
  const dayStartMs = dateKeyToUtc(dateKey) - 8 * 3600 * 1000
  const tick = Math.floor((nowMs - dayStartMs) / STOCK_TICK_MS)
  return Math.max(0, Math.min(STOCK_TICKS_PER_DAY - 1, tick))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 当日事件 → 对外 DTO。
 * 未触发的事件也会下发（前端展示「今日 14:32 有重要公告」），但不暴露冲击幅度
 * （impact 字段其实是初始幅度，前端只在 active 时读取，避免提前剧透涨跌方向）。
 */
function newsItemsOf(events: readonly StockNewsEvent[], dateKey: string, tick: number): StockNewsItemDto[] {
  const dayStartMs = dateKeyToUtc(dateKey) - 8 * 3600 * 1000
  return events.map((event) => {
    const active = tick >= event.startTick
    return {
      id: event.id,
      title: event.title,
      summary: event.summary,
      sentiment: event.sentiment,
      startTick: event.startTick,
      startAt: new Date(dayStartMs + event.startTick * STOCK_TICK_MS).toISOString(),
      impact: event.impact,
      halfLifeMs: event.halfLifeMs,
      currentImpact: active
        ? round4(event.impact * Math.pow(0.5, ((tick - event.startTick) * STOCK_TICK_MS) / event.halfLifeMs))
        : 0,
      active,
    }
  })
}

/** 单只股票的实时报价（实时价 = basePath × (1 + 玩家冲击 + 事件冲击)，现算，不走物化缓存） */
export function getLiveQuote(definition: StockDefinition, dateKey: string, nowMs: number = Date.now()): StockQuoteDto {
  const state = ensureDay(dateKey).get(definition.code)
  if (!state) throw new Error(`stockTicks: 未知股票 ${definition.code}`)
  const tick = tickIndexOf(dateKey, nowMs)
  const impact = getImpact(definition.code, nowMs)
  extendTo(state, tick, impact)

  const eventImpact = eventImpactAt(state.news, tick)
  const price = Math.max(STOCK_PRICE_FLOOR, round2(state.basePath[tick] * (1 + impact + eventImpact)))
  if (price > state.high) state.high = price
  if (price < state.low) state.low = price
  const change = round2(price - state.prevClose)
  const changePct = state.prevClose > 0 ? Math.round((change / state.prevClose) * 10_000) / 100 : 0

  return {
    code: definition.code,
    name: definition.name,
    sector: definition.sector,
    color: definition.color,
    price,
    prevClose: state.prevClose,
    // 开盘价取 tick 0 的基准路径（噪声与慢波起点均为 0 → 恰为日线今日开盘，确定性）
    open: state.basePath[0],
    high: state.high,
    low: state.low,
    change,
    changePct,
    volume: Math.round(state.volumeAcc),
    dividendYield: definition.dividendYield,
    news: newsItemsOf(state.news, dateKey, tick),
  }
}

/** 按代码取实时报价（code 大写归一，未知代码返回 null） */
export function getLiveQuoteByCode(code: string, nowMs: number = Date.now()): StockQuoteDto | null {
  const normalized = code.trim().toUpperCase()
  const definition = STOCK_DEFINITIONS.find((item) => item.code === normalized)
  if (!definition) return null
  return getLiveQuote(definition, getTodayDateKey(nowMs), nowMs)
}

/** 大盘指数：基准 1000 点 × (1 + 平均涨跌幅/100)，保留 2 位 */
export function marketIndexOf(marketChangePct: number): number {
  return Math.round(1000 * (1 + marketChangePct / 100) * 100) / 100
}

/** 市场情绪：平均涨跌 > +0.6% 牛、< −0.6% 熊，其余震荡 */
export function marketMoodOf(marketChangePct: number): StockMarketMood {
  if (marketChangePct > 0.6) return 'bull'
  if (marketChangePct < -0.6) return 'bear'
  return 'flat'
}

/** 全市场实时行情（对外 GET /api/stocks/market 的响应体） */
export function buildLiveMarket(dateKey: string, nowMs: number = Date.now()): StockMarketDto {
  const tickIndex = tickIndexOf(dateKey, nowMs)
  const stocks = STOCK_DEFINITIONS.map((definition) => getLiveQuote(definition, dateKey, nowMs))
  const marketChangePct = stocks.length === 0
    ? 0
    : Math.round((stocks.reduce((sum, stock) => sum + stock.changePct, 0) / stocks.length) * 100) / 100

  return {
    dateKey,
    tickMs: STOCK_TICK_MS,
    tickIndex,
    updatedAt: new Date(nowMs).toISOString(),
    currency: '模拟币',
    disclaimer: STOCK_MARKET_DISCLAIMER,
    trade: {
      feeRate: STOCK_FEE_RATE,
      minInvest: STOCK_MIN_INVEST,
      maxInvest: STOCK_MAX_INVEST,
    },
    marketChangePct,
    index: marketIndexOf(marketChangePct),
    marketMood: marketMoodOf(marketChangePct),
    stocks,
  }
}

export interface StockIntradayPoint {
  /** 当日 00:00（Asia/Shanghai）以来的毫秒 */
  t: number
  price: number
}

export interface StockTrendDto {
  code: string
  name: string
  dateKey: string
  tickMs: number
  /** 近 30 根日线（含今日：今日 high/low/close/volume 为实时跟踪值） */
  daily: StockCandle[]
  /** 今日分时：每 60 秒（20 tick）一点 + 最新实时点 */
  intraday: StockIntradayPoint[]
  /** 当日新闻事件（前端在分时图上按 startTick × tickMs 画事件标记） */
  news: StockNewsItemDto[]
}

/** 单只股票的日线 + 当日分时（对外 GET /api/stocks/market/trend 的响应体） */
export function buildStockTrend(
  definition: StockDefinition,
  dateKey: string,
  nowMs: number = Date.now(),
): StockTrendDto {
  const quote = getLiveQuote(definition, dateKey, nowMs)
  const tick = tickIndexOf(dateKey, nowMs)
  const daily = getStockDailySeries(definition, dateKey)
  // 今日 K 线用实时值替换：open = 秒级开盘，high/low = 盘中跟踪值（已并入最新价）
  daily[daily.length - 1] = {
    date: dateKey,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.price,
    volume: quote.volume,
  }

  // 分时：物化快照每 20 tick 采样，最后补一个最新实时点（t 严格递增）
  const state = ensureDay(dateKey).get(definition.code)
  if (!state) throw new Error(`stockTicks: 未知股票 ${definition.code}`)
  const intraday: StockIntradayPoint[] = []
  for (let t = 0; t < tick; t += STOCK_INTRADAY_SAMPLE_TICKS) {
    intraday.push({ t: t * STOCK_TICK_MS, price: round2(state.materialized[t]) })
  }
  intraday.push({ t: tick * STOCK_TICK_MS, price: quote.price })

  return {
    code: definition.code,
    name: definition.name,
    dateKey,
    tickMs: STOCK_TICK_MS,
    daily,
    intraday,
    news: newsItemsOf(state.news, dateKey, tick),
  }
}

/**
 * 读取基准路径（不含玩家 / 事件冲击）—— 自检断言日界衔接与慢波包络用，业务方不需要。
 * 会顺带把路径延展到目标 tick（与 getLiveQuote 同一套物化逻辑）。
 */
export function getBasePathAt(
  definition: StockDefinition,
  dateKey: string,
  tick: number,
  nowMs: number = Date.now(),
): number {
  const state = ensureDay(dateKey).get(definition.code)
  if (!state) throw new Error(`stockTicks: 未知股票 ${definition.code}`)
  extendTo(state, Math.max(0, Math.min(STOCK_TICKS_PER_DAY - 1, tick)), getImpact(definition.code, nowMs))
  return state.basePath[Math.max(0, Math.min(STOCK_TICKS_PER_DAY - 1, tick))]
}

/** 某只股票当日新闻事件（自检 / 内部复用；不改变缓存状态） */
export function getDayNews(definition: StockDefinition, dateKey: string): StockNewsEvent[] {
  const state = ensureDay(dateKey).get(definition.code)
  return state ? state.news : buildDayNews(definition, dateKey)
}

/** 清空日缓存、慢波缓存与冲击状态（自检脚本跨用例隔离用，生产代码不得调用） */
export function resetTicksForTest(): void {
  dayCache = null
  waveCache = null
  impactStates.clear()
  impactDirty = false
}
