/**
 * 股市 AI 事件引擎（后台定时任务，无用户请求触发）。
 *
 * 每 40 分钟一个批次：调用站内大模型生成 2–3 条虚构财经快讯（股票 / 方向 / 幅度 / 半衰期），
 * 校验并 clamp 后写入 StockEvent 表，同时注入 stockTicks 的内存事件层。
 * 配置优先级：DeepSeek 对话配置（AiChatConfig）→ 首页 AI 助手配置（AiConfig）→ 模板兜底。
 * AI 不可用 / 超时 / 输出不合法时自动落模板事件，保证行情引擎永远有事件可消费。
 */

import prisma from '../lib/prisma.js'
import { getTodayDateKey, getTodayDayStart } from '../lib/pointsRules.js'
import { STOCK_DEFINITIONS, mulberry32, seedFromString } from '../lib/stockMarket.js'
import {
  STOCK_EVENT_BATCH_MINUTES,
  STOCK_NEWS_MAX_HALF_LIFE_MS,
  STOCK_NEWS_MAX_IMPACT,
  STOCK_NEWS_MIN_HALF_LIFE_MS,
  STOCK_NEWS_MIN_IMPACT,
  buildFallbackNewsEvents,
  injectExternalNews,
  loadExternalNews,
  tickIndexOf,
  type StockNewsEvent,
} from '../lib/stockTicks.js'
import { completeTask, getAiConfig, toAiError } from './aiService.js'
import { getAiChatConfig } from './aiChatService.js'

const BATCH_MS = STOCK_EVENT_BATCH_MINUTES * 60_000
const EVENTS_PER_BATCH = 2
const AI_TIMEOUT_MS = 25_000
const CLEANUP_INTERVAL_MS = 6 * 60 * 60_000

let timer: NodeJS.Timeout | null = null
let startupTimer: NodeJS.Timeout | null = null
let lastCleanupAt = 0
let running = false
let loadedDateKey: string | null = null

export interface StockEventBatchResult {
  dateKey: string
  batchKey: string
  created: number
  source: 'ai' | 'template' | 'skipped'
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 当前时刻所属的 40 分钟批次（Asia/Shanghai 日期键 + 槽位） */
export function currentBatch(now = Date.now()): {
  dateKey: string
  slot: number
  batchKey: string
  startAtMs: number
} {
  const dateKey = getTodayDateKey(now)
  const dayStart = getTodayDayStart(now).getTime()
  const minutes = Math.floor((now - dayStart) / 60_000)
  const slot = Math.max(0, Math.min(35, Math.floor(minutes / STOCK_EVENT_BATCH_MINUTES)))
  const slotStartMs = dayStart + slot * BATCH_MS
  const slotDate = new Date(slotStartMs + 8 * 3600_000)
  const batchKey = `${dateKey}T${pad2(slotDate.getUTCHours())}:${pad2(slotDate.getUTCMinutes())}`
  return { dateKey, slot, batchKey, startAtMs: slotStartMs }
}

interface AiEventDraft {
  code: string
  title: string
  summary: string
  sentiment: 'good' | 'bad'
  impactPct: number
  halfLifeMinutes: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseAiJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/** 把 AI 输出校验成合法事件；非法项直接丢弃，返回空数组表示需要走模板兜底 */
export function normalizeAiEvents(
  raw: unknown,
  dateKey: string,
  batchKey: string,
  startAtMs: number,
): StockNewsEvent[] {
  const payload = raw as { events?: unknown } | null
  if (!payload || !Array.isArray(payload.events)) return []
  const byCode = new Map(STOCK_DEFINITIONS.map((item) => [item.code, item]))
  const used = new Set<string>()
  const events: StockNewsEvent[] = []
  for (const item of payload.events) {
    if (!item || typeof item !== 'object') continue
    const draft = item as Partial<AiEventDraft>
    const code = typeof draft.code === 'string' ? draft.code.trim().toUpperCase() : ''
    const definition = byCode.get(code)
    if (!definition || used.has(code)) continue
    const sentiment = draft.sentiment === 'bad' ? 'bad' : draft.sentiment === 'good' ? 'good' : null
    if (!sentiment) continue
    const title = typeof draft.title === 'string' ? draft.title.trim().slice(0, 40) : ''
    const summary = typeof draft.summary === 'string' ? draft.summary.trim().slice(0, 120) : ''
    if (!title || !summary) continue
    const impactPct = Number(draft.impactPct)
    const halfLifeMinutes = Number(draft.halfLifeMinutes)
    if (!Number.isFinite(impactPct) || !Number.isFinite(halfLifeMinutes)) continue
    const magnitude = clamp(Math.abs(impactPct) / 100, STOCK_NEWS_MIN_IMPACT, STOCK_NEWS_MAX_IMPACT)
    const halfLifeMs = Math.round(
      clamp(halfLifeMinutes, 30, 180) * 60_000,
    )
    used.add(code)
    events.push({
      id: `${code}-${batchKey}-${events.length}`,
      code,
      title,
      summary,
      sentiment,
      startTick: Math.max(
        1,
        Math.min(28_799, tickIndexOf(dateKey, startAtMs)),
      ),
      impact: Math.round((sentiment === 'good' ? magnitude : -magnitude) * 10_000) / 10_000,
      halfLifeMs: Math.max(STOCK_NEWS_MIN_HALF_LIFE_MS, Math.min(STOCK_NEWS_MAX_HALF_LIFE_MS, halfLifeMs)),
      source: 'ai',
      batchKey,
    })
    if (events.length >= 3) break
  }
  return events
}

function buildPrompt(): { system: string; user: string } {
  const stockList = STOCK_DEFINITIONS.map(
    (item) => `${item.code}（${item.name}，${item.sector}）`,
  ).join('、')
  return {
    system:
      '你是 LineWeb 模拟股市的快讯编辑。只输出 JSON，不要输出解释、Markdown 或代码块。' +
      '你写的是完全虚构的财经快讯，不得提及真实公司或真实事件。',
    user:
      `为下列虚构股票生成 ${EVENTS_PER_BATCH}–3 条本时段（40 分钟）的财经快讯，` +
      `至少一条利好、一条利空，股票不要重复：${stockList}。\n` +
      '返回严格 JSON：{"events":[{"code":"LWST","title":"标题","summary":"摘要","sentiment":"good","impactPct":4.5,"halfLifeMinutes":90}]}\n' +
      '要求：code 必须是上面列表里的代码；title ≤ 24 字；summary ≤ 80 字；' +
      'impactPct 在 1.5–8 之间；halfLifeMinutes 在 30–180 之间。',
  }
}

async function resolveAiConfig(): Promise<
  { model: string; apiKey: string; baseUrl: string | null } | null
> {
  try {
    const chatConfig = await getAiChatConfig()
    if (chatConfig.isEnabled && chatConfig.apiKey) {
      return { model: chatConfig.model, apiKey: chatConfig.apiKey, baseUrl: chatConfig.baseUrl }
    }
  } catch {
    // 继续尝试首页 AI 配置
  }
  try {
    const aiConfig = await getAiConfig()
    if (aiConfig.isEnabled && aiConfig.apiKey) {
      return { model: aiConfig.model, apiKey: aiConfig.apiKey, baseUrl: aiConfig.baseUrl }
    }
  } catch {
    // 忽略，走模板兜底
  }
  return null
}

async function generateAiEvents(
  dateKey: string,
  batchKey: string,
  startAtMs: number,
): Promise<StockNewsEvent[]> {
  const config = await resolveAiConfig()
  if (!config) return []
  const prompt = buildPrompt()
  try {
    const content = await completeTask(
      config,
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      { json: true, maxTokens: 1200, temperature: 0.9, timeoutMs: AI_TIMEOUT_MS },
    )
    return normalizeAiEvents(parseAiJson(content), dateKey, batchKey, startAtMs)
  } catch (error) {
    const mapped = toAiError(error, 'stockEvents')
    console.warn('[stockEvents] AI 生成失败，使用模板兜底：', mapped.message)
    return []
  }
}

/**
 * 确保当前 40 分钟批次已生成（幂等：先查 batchKey 是否已有事件）。
 * 导出供启动任务与冒烟脚本复用。
 */
export async function ensureCurrentBatch(now = Date.now()): Promise<StockEventBatchResult> {
  const { dateKey, batchKey, startAtMs } = currentBatch(now)
  const existing = await prisma.stockEvent.count({ where: { batchKey } })
  if (existing > 0) {
    return { dateKey, batchKey, created: 0, source: 'skipped' }
  }

  // 批次开始时间已过去时，事件从「现在」生效（避免补生成一批已经过期的事件）
  const effectiveStart = Math.max(startAtMs, now - 5_000)
  let events = await generateAiEvents(dateKey, batchKey, effectiveStart)
  let source: 'ai' | 'template' = 'ai'
  if (events.length === 0) {
    const rng = mulberry32(seedFromString(`lineweb-stock-ai-batch:${batchKey}`))
    events = buildFallbackNewsEvents(dateKey, batchKey, effectiveStart, rng, EVENTS_PER_BATCH)
    source = 'template'
  }

  const startAt = new Date(effectiveStart)
  await prisma.stockEvent.createMany({
    data: events.map((event) => ({
      dateKey,
      code: event.code,
      batchKey: event.batchKey,
      title: event.title,
      summary: event.summary,
      sentiment: event.sentiment,
      impact: event.impact,
      halfLifeMs: event.halfLifeMs,
      startAt,
      startTick: event.startTick,
      source: event.source,
    })),
  })
  for (const event of events) injectExternalNews(event)
  return { dateKey, batchKey, created: events.length, source }
}

/** 启动时加载当日事件到内存（跨日重启也能恢复当天已生成的事件） */
export async function loadTodayStockEvents(now = Date.now()): Promise<number> {
  const dateKey = getTodayDateKey(now)
  const rows = await prisma.stockEvent.findMany({
    where: { dateKey },
    orderBy: [{ startTick: 'asc' }, { id: 'asc' }],
  })
  const events: StockNewsEvent[] = rows.map((row) => ({
    id: `${row.code}-${row.batchKey}-${row.id}`,
    code: row.code,
    title: row.title,
    summary: row.summary,
    sentiment: row.sentiment === 'bad' ? 'bad' : 'good',
    startTick: row.startTick,
    impact: row.impact,
    halfLifeMs: row.halfLifeMs,
    source: row.source === 'template' ? 'template' : 'ai',
    batchKey: row.batchKey,
  }))
  loadExternalNews(events)
  loadedDateKey = dateKey
  return events.length
}

async function cleanupOldEvents(now: number): Promise<void> {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now
  try {
    await prisma.stockEvent.deleteMany({
      where: { createdAt: { lt: new Date(now - 7 * 86_400_000) } },
    })
  } catch (error) {
    console.warn('[stockEvents] 清理旧事件失败：', error)
  }
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = Date.now()
    const dateKey = getTodayDateKey(now)
    // 跨日：清掉昨天的内存事件并加载今天的（避免昨日事件在今天同一 tick 重放）
    if (loadedDateKey && loadedDateKey !== dateKey) {
      await loadTodayStockEvents(now)
    }
    await ensureCurrentBatch(now)
    await cleanupOldEvents(now)
  } catch (error) {
    console.error('[stockEvents] 批次生成失败：', error)
  } finally {
    running = false
  }
}

/** 启动后台引擎（幂等）：启动 5 秒后补当前批次，之后每 60 秒检查一次 */
export function startStockEventEngine(): void {
  if (timer || startupTimer) return
  startupTimer = setTimeout(() => {
    void loadTodayStockEvents()
      .catch((error) => console.warn('[stockEvents] 加载当日事件失败：', error))
      .finally(() => {
        void tick()
      })
  }, 5_000)
  startupTimer.unref()
  timer = setInterval(() => {
    void tick()
  }, 60_000)
  timer.unref()
}

/** 停止后台引擎（shutdown 时调用） */
export function stopStockEventEngine(): void {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** 当日事件列表（供 GET /api/stocks/events 使用） */
export async function listTodayStockEvents(limit = 20): Promise<StockNewsEvent[]> {
  const dateKey = getTodayDateKey()
  const take = Math.min(60, Math.max(1, Math.trunc(limit) || 20))
  const rows = await prisma.stockEvent.findMany({
    // 只返回已触发事件：未来事件的方向/幅度属于剧透
    where: { dateKey, startAt: { lte: new Date() } },
    orderBy: [{ startTick: 'desc' }, { id: 'desc' }],
    take,
  })
  return rows.map((row) => ({
    id: `${row.code}-${row.batchKey}-${row.id}`,
    code: row.code,
    title: row.title,
    summary: row.summary,
    sentiment: row.sentiment === 'bad' ? 'bad' : 'good',
    startTick: row.startTick,
    impact: row.impact,
    halfLifeMs: row.halfLifeMs,
    source: row.source === 'template' ? 'template' : 'ai',
    batchKey: row.batchKey,
  }))
}
