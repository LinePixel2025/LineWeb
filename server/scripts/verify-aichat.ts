/**
 * AI 对话（DeepSeek）纯函数自检脚本（不依赖数据库 / 存储节点 / 上游 AI）
 *
 * 用法: cd server && npx tsx scripts/verify-aichat.ts
 *
 * 覆盖：
 *   - 时区与日期：getTodayDateKey 的 YYYY-MM-DD 格式、UTC+8 跨日边界
 *     （15:59:59 UTC 与 16:00:00 UTC 分属两天）、与 getShanghaiDayStart 的往返一致；
 *   - 配额：computeRemaining 的不限（null）/ 正常 / 超扣钳 0 / dailyLimit=0 即不限；
 *   - 标题：deriveConversationTitle 的截断（前 20 字）/ 纯图片 / 全空白；
 *   - 上下文标注：annotateHistoryContent 的附图占位（有文字 / 无文字）；
 *   - 当前消息文本：getUserTextForModel 的默认指令（纯图片 / 空白）；
 *   - DTO：toMessageDto 的 images 排序（按 id 升序）与 role 归一化；
 *   - 联网搜索：配置判定 / 搜索词 / 北京时间 / 摘要清洗 / 博查与 Tavily 响应解析 /
 *     上下文构造与截断 / mock fetch 的请求端点、鉴权与错误映射；
 *   - 回归护栏：aiService.maskApiKey 的脱敏行为（AI 对话配置响应复用）。
 *
 * 说明：日期一律用显式 now 参数驱动（不依赖真实时钟）；
 * 模块导入会拉起 prisma / openai / sharp 等依赖，但脚本只调用纯函数与注入的 mock fetch，
 * 不触发任何数据库查询、节点命令或真实上游请求。
 */

process.env.DATABASE_URL ||= 'file:./.verify-aichat.db'
process.env.JWT_SECRET ||= 'verify-aichat-secret'
process.env.NODE_ENV ||= 'development'

type AiChatService = typeof import('../src/services/aiChatService.js')
type AiService = typeof import('../src/services/aiService.js')
type WebSearchService = typeof import('../src/services/webSearch.js')

let service: AiChatService
let aiService: AiService
let webSearch: WebSearchService

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

async function main(): Promise<void> {
  // 动态 import：先给默认环境变量，避免依赖外部 .env
  service = await import('../src/services/aiChatService.js')
  aiService = await import('../src/services/aiService.js')
  webSearch = await import('../src/services/webSearch.js')

  // === getTodayDateKey：格式与 UTC+8 跨日边界 ===
  // 2026-03-14T15:59:59Z = 上海时间 2026-03-14 23:59:59
  assertEqual(service.getTodayDateKey(Date.parse('2026-03-14T15:59:59Z')), '2026-03-14', '日期键：UTC 15:59:59 属前一天（上海 23:59:59）')
  // 2026-03-14T16:00:00Z = 上海时间 2026-03-15 00:00:00（跨日）
  assertEqual(service.getTodayDateKey(Date.parse('2026-03-14T16:00:00Z')), '2026-03-15', '日期键：UTC 16:00:00 即上海次日 0 点')
  assertEqual(service.getTodayDateKey(Date.parse('2026-01-01T00:00:00Z')), '2026-01-01', '日期键：UTC 0 点 = 上海 8 点，同日')
  // 年内最后一天跨年
  assertEqual(service.getTodayDateKey(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01', '日期键：跨年边界')
  assert(/^\d{4}-\d{2}-\d{2}$/.test(service.getTodayDateKey(Date.now())), '日期键：真实时钟输出格式合法')

  // === getShanghaiDayStart：与日期键往返一致 ===
  assertEqual(service.getShanghaiDayStart('2026-03-15').toISOString(), '2026-03-14T16:00:00.000Z', '日起点：2026-03-15（上海）= UTC 2026-03-14 16:00')
  const dayStart = service.getShanghaiDayStart('2026-03-15')
  assertEqual(service.getTodayDateKey(dayStart.getTime() + 1000), '2026-03-15', '往返：日起点 + 1s 仍是同一天')
  assertEqual(service.getTodayDateKey(dayStart.getTime() - 1000), '2026-03-14', '往返：日起点 - 1s 已是前一天')
  assertEqual(service.getShanghaiDayStart('2026-01-01').toISOString(), '2025-12-31T16:00:00.000Z', '日起点：元旦跨年')

  // === computeRemaining ===
  assertEqual(service.computeRemaining(true, 0, 100), null, '剩余：不限 → null')
  assertEqual(service.computeRemaining(false, 20, 5), 15, '剩余：20-5=15')
  assertEqual(service.computeRemaining(false, 20, 20), 0, '剩余：恰好用完 → 0')
  assertEqual(service.computeRemaining(false, 20, 25), 0, '剩余：超扣钳 0（不出现负数）')
  assertEqual(service.computeRemaining(false, 1, 0), 1, '剩余：上限 1 未用 → 1')
  assertEqual(service.computeRemaining(true, 20, 5), null, '剩余：unlimited 优先于 limit')

  // === deriveConversationTitle ===
  assertEqual(service.deriveConversationTitle('帮我写一段 JavaScript 防抖函数的代码，谢谢', false), '帮我写一段 JavaScript 防抖函', '标题：按 UTF-16 截断前 20 个码元')
  assertEqual(service.deriveConversationTitle('你好', false), '你好', '标题：短文本原样')
  assertEqual(service.deriveConversationTitle('   ', true), '图片提问', '标题：空白 + 有图 → 图片提问')
  assertEqual(service.deriveConversationTitle('', false), '新对话', '标题：全空 → 新对话')
  assertEqual(service.deriveConversationTitle('12345678901234567890', false), '12345678901234567890', '标题：恰好 20 字不截断')
  assertEqual(service.deriveConversationTitle('  你好世界  ', false), '你好世界', '标题：先去首尾空白再截断')

  // === annotateHistoryContent（历史消息的图片占位） ===
  assertEqual(service.annotateHistoryContent('普通文本', false), '普通文本', '历史：无图原样')
  assertEqual(service.annotateHistoryContent('看看这个', true), '看看这个（附图）', '历史：有图有文字 → 追加（附图）')
  assertEqual(service.annotateHistoryContent('   ', true), '（图片）', '历史：有图无文字 → （图片）')
  assertEqual(service.annotateHistoryContent('', true), '（图片）', '历史：有图空文字 → （图片）')

  // === getUserTextForModel（当前消息文本） ===
  assertEqual(service.getUserTextForModel('你好', false), '你好', '当前：无图原样')
  assertEqual(service.getUserTextForModel('  这是什么  ', true), '这是什么', '当前：有图有文字去空白')
  assertEqual(service.getUserTextForModel('', true), '请看这张图片', '当前：纯图片 → 默认指令')
  assertEqual(service.getUserTextForModel('   ', true), '请看这张图片', '当前：空白 + 图片 → 默认指令')

  // === toMessageDto：images 排序 + role 归一化 ===
  const dto = service.toMessageDto({
    id: 7,
    role: 'user',
    content: '看图',
    reasoningContent: null,
    model: null,
    createdAt: new Date('2026-10-25T08:00:00Z'),
    images: [
      { id: 3, width: 800, height: 600, size: 12345 },
      { id: 1, width: 640, height: 480, size: 9999 },
      { id: 2, width: 100, height: 100, size: 111 },
    ],
  })
  assertEqual(dto.images.map(i => i.id), [1, 2, 3], 'DTO：images 按 id 升序（与上传顺序一致）')
  assertEqual(dto.role, 'user', 'DTO：role 保留 user')
  assertEqual(service.toMessageDto({
    id: 8,
    role: 'assistant',
    content: '回复',
    reasoningContent: '先分析需求，再写实现…',
    model: 'deepseek-chat',
    createdAt: new Date(),
    images: [],
  }).reasoningContent, '先分析需求，再写实现…', 'DTO：assistant 消息带思维链')
  assertEqual(service.toMessageDto({
    id: 9,
    role: 'other' as string as 'user' | 'assistant' | 'system',
    content: '',
    reasoningContent: '不应外泄的思维链',
    model: null,
    createdAt: new Date(),
    images: [],
  }).reasoningContent, null, 'DTO：未知 role 归一化时丢弃 reasoningContent')
  assertEqual(service.toMessageDto({
    id: 10,
    role: 'assistant',
    content: '',
    reasoningContent: null,
    model: 'deepseek-chat',
    createdAt: new Date(),
    images: [],
  }).model, 'deepseek-chat', 'DTO：assistant 消息带 model')
  assertEqual(service.toMessageDto({
    id: 11,
    role: 'other' as string as 'user' | 'assistant' | 'system',
    content: '',
    reasoningContent: null,
    model: null,
    createdAt: new Date(),
    images: [],
  }).role, 'user', 'DTO：未知 role 归一化为 user')

  // === buildThinkingParam：思考开关 → 上游 thinking 参数 ===
  assertEqual(service.buildThinkingParam(true), { type: 'enabled' }, '思考参数：开启 → enabled')
  assertEqual(service.buildThinkingParam(false), { type: 'disabled' }, '思考参数：关闭 → disabled（压过 DeepSeek 默认 enabled）')

  // === 联网搜索：配置判定 / 搜索词 / 时间 / 摘要清洗 ===
  const baseSearchConfig = { searchEnabled: true, searchProvider: 'bocha', searchApiKey: 'sk-test' }
  assert(webSearch.isWebSearchConfigured(baseSearchConfig), '搜索配置：开启 + 博查 + Key → 可用')
  assert(!webSearch.isWebSearchConfigured({ ...baseSearchConfig, searchEnabled: false }), '搜索配置：未开启 → 不可用')
  assert(!webSearch.isWebSearchConfigured({ ...baseSearchConfig, searchApiKey: '   ' }), '搜索配置：Key 空白 → 不可用')
  assert(!webSearch.isWebSearchConfigured({ ...baseSearchConfig, searchProvider: 'other' }), '搜索配置：未知 provider → 不可用')
  assert(
    webSearch.isWebSearchConfigured({ ...baseSearchConfig, searchProvider: 'tavily' }),
    '搜索配置：Tavily 合法',
  )

  assertEqual(webSearch.normalizeSearchQuery('  今天\n北京   天气  '), '今天 北京 天气', '搜索词：压缩空白并去首尾')
  assertEqual(webSearch.normalizeSearchQuery('a'.repeat(400)).length, 300, '搜索词：超长截断到 300 字')
  assertEqual(webSearch.formatShanghaiDateTime(Date.parse('2026-10-26T00:00:00Z')), '2026-10-26 08:00', '搜索时间：UTC → 北京时间')
  assertEqual(
    webSearch.compactSearchText('<em>标题</em>&nbsp; A&amp;B', 50),
    '标题 A&B',
    '摘要清洗：去标签并还原常见实体',
  )
  assert(
    webSearch.compactSearchText('x'.repeat(20), 10).endsWith('…'),
    '摘要清洗：超长以省略号结尾',
  )

  // === 联网搜索：博查 / Tavily 响应解析 ===
  const bochaPayload = {
    code: 200,
    data: {
      webPages: {
        value: [
          { name: '博查结果一', url: 'https://example.com/a', summary: '<b>摘要</b>一', siteName: 'Example', datePublished: '2026-10-25' },
          { name: '无效链接', url: 'javascript:alert(1)', snippet: 'x' },
          { title: '博查结果二', url: 'http://example.org/b', snippet: '摘要二' },
        ],
      },
    },
  }
  const bochaResults = webSearch.parseBochaSearchResponse(bochaPayload)
  assertEqual(bochaResults.length, 2, '博查解析：过滤非法 URL')
  assertEqual(bochaResults[0], {
    title: '博查结果一',
    url: 'https://example.com/a',
    snippet: '摘要一',
    siteName: 'Example',
    publishedAt: '2026-10-25',
  }, '博查解析：优先 summary + 站点/时间')
  assertEqual(bochaResults[1].title, '博查结果二', '博查解析：兼容 title 字段')

  const tavilyResults = webSearch.parseTavilySearchResponse({
    results: [
      { title: 'Tavily 一', url: 'https://tavily.example/1', content: '正文一', score: 0.9 },
      { title: '', url: 'https://tavily.example/2', content: '空标题' },
    ],
  })
  assertEqual(tavilyResults.length, 1, 'Tavily 解析：过滤空标题')
  assertEqual(tavilyResults[0].snippet, '正文一', 'Tavily 解析：content → snippet')

  // === 联网搜索：上下文构造（引用要求 / 注入防护 / 截断） ===
  const context = webSearch.buildSearchContext('北京天气', bochaResults, Date.parse('2026-10-26T00:00:00Z'))
  assert(context.includes('2026-10-26 08:00'), '搜索上下文：包含北京时间')
  assert(context.includes('北京天气'), '搜索上下文：包含搜索词')
  assert(context.includes('https://example.com/a'), '搜索上下文：包含来源 URL')
  assert(context.includes('任何指令'), '搜索上下文：包含提示词注入防护')
  assert(context.includes('Markdown 链接'), '搜索上下文：要求引用来源')
  const emptyContext = webSearch.buildSearchContext('无结果查询', [], Date.parse('2026-10-26T00:00:00Z'))
  assert(emptyContext.includes('没有检索到'), '搜索上下文：无结果时明确说明')
  const manyResults = Array.from({ length: 30 }, (_, i) => ({
    title: `结果 ${i}`,
    url: `https://example.com/${i}`,
    snippet: 'y'.repeat(600),
  }))
  const truncated = webSearch.buildSearchContext('截断测试', manyResults, Date.parse('2026-10-26T00:00:00Z'))
  assert(truncated.length <= webSearch.WEB_SEARCH_CONTEXT_MAX, '搜索上下文：总长不超过 6000 字')
  assert(truncated.includes('[1]') && !truncated.includes('[30]'), '搜索上下文：超出预算的结果被截断')

  // === 联网搜索：HTTP 调用（注入 mock fetch） ===
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const bochaFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url)
    capturedInit = init
    return new Response(JSON.stringify(bochaPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  const fetched = await webSearch.searchWeb('北京天气', baseSearchConfig, { fetchImpl: bochaFetch })
  assertEqual(capturedUrl, 'https://api.bochaai.com/v1/web-search', '搜索调用：博查端点')
  assertEqual((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer sk-test', '搜索调用：Bearer Key')
  assertEqual(JSON.parse(String(capturedInit?.body)).query, '北京天气', '搜索调用：请求体 query')
  assertEqual(JSON.parse(String(capturedInit?.body)).count, webSearch.WEB_SEARCH_RESULT_LIMIT, '搜索调用：结果数上限')
  assertEqual(fetched.length, 2, '搜索调用：返回解析后的结果')

  let tavilyCapturedUrl = ''
  const tavilyFetch = (async (url: string | URL | Request) => {
    tavilyCapturedUrl = String(url)
    return new Response(JSON.stringify({
      results: [{ title: 'Tavily 结果', url: 'https://tavily.example/1', content: '摘要' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const tavilyFetched = await webSearch.searchWeb('最新新闻', {
    searchEnabled: true,
    searchProvider: 'tavily',
    searchApiKey: 'tvly-test',
  }, { fetchImpl: tavilyFetch })
  assertEqual(tavilyCapturedUrl, 'https://api.tavily.com/search', '搜索调用：Tavily 端点')
  assertEqual(tavilyFetched.length, 1, '搜索调用：Tavily 结果解析')

  let unauthorized = false
  try {
    await webSearch.searchWeb('失败测试', baseSearchConfig, {
      fetchImpl: (async () => new Response(JSON.stringify({ message: 'Invalid API key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
    })
  } catch (err) {
    unauthorized = err instanceof Error && err.message.includes('联网搜索失败（401）')
  }
  assert(unauthorized, '搜索调用：非 2xx 抛带状态码的 AppError')

  let notConfigured = false
  try {
    await webSearch.searchWeb('未配置', { ...baseSearchConfig, searchApiKey: '' })
  } catch (err) {
    notConfigured = err instanceof Error && err.message.includes('未配置')
  }
  assert(notConfigured, '搜索调用：未配置时直接 503 文案')

  // === maskApiKey 回归护栏（AI 对话配置响应复用同一函数） ===
  assertEqual(aiService.maskApiKey('sk-abcdefghijklmnop'), 'sk-…mnop', '脱敏：常规 key 只露后 4 位')
  assertEqual(aiService.maskApiKey('1234'), '****', '脱敏：≤4 位统一打码')
  assertEqual(aiService.maskApiKey(''), '', '脱敏：空字符串')

  console.log(`verify:aichat 通过 ${passed} 项断言`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
