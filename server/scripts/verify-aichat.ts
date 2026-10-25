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
 *   - 回归护栏：aiService.maskApiKey 的脱敏行为（AI 对话配置响应复用）。
 *
 * 说明：日期一律用显式 now 参数驱动（不依赖真实时钟）；
 * 模块导入会拉起 prisma / openai / sharp 等依赖，但脚本只调用纯函数，
 * 不触发任何数据库查询、节点命令或上游请求。
 */

process.env.DATABASE_URL ||= 'file:./.verify-aichat.db'
process.env.JWT_SECRET ||= 'verify-aichat-secret'
process.env.NODE_ENV ||= 'development'

type AiChatService = typeof import('../src/services/aiChatService.js')
type AiService = typeof import('../src/services/aiService.js')

let service: AiChatService
let aiService: AiService

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
    model: 'deepseek-chat',
    createdAt: new Date(),
    images: [],
  }).model, 'deepseek-chat', 'DTO：assistant 消息带 model')
  assertEqual(service.toMessageDto({
    id: 9,
    role: 'other' as string as 'user' | 'assistant' | 'system',
    content: '',
    model: null,
    createdAt: new Date(),
    images: [],
  }).role, 'user', 'DTO：未知 role 归一化为 user')

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
