/**
 * 设计验收截图矩阵（Apple 风格重构专用）
 *
 * 用法：
 *   node scripts/screenshot-design-audit.cjs --tag p0
 *   node scripts/screenshot-design-audit.cjs --tag p1 --routes core --widths 1440,390 --themes light
 *   node scripts/screenshot-design-audit.cjs --tag p2 --routes home,posts,post
 *
 * 前提：
 *   - 本机已启动 `npm run dev`（client http://127.0.0.1:5173，server 3001）
 *   - 本机装有 Chrome（脚本用 channel: 'chrome'，不需要下载 Playwright 浏览器）
 *   - 数据库已 seed（admin@lineweb.dev / admin123）
 *
 * 说明：只调用一次 /api/auth/login 取令牌，然后注入 localStorage 复用，
 *       避免反复登录触发 authLimiter（20 次/15 分钟）。
 *
 * 产物：test-screenshots/design/<tag>/<theme>/<width>/<name>.png + report.json
 */
const fs = require('fs')
const path = require('path')

/* playwright 装在 client/node_modules（前端 devDependency），从仓库根 require 会找不到 */
function loadPlaywright() {
  const candidates = ['playwright', path.resolve(__dirname, '..', 'client', 'node_modules', 'playwright')]
  for (const candidate of candidates) {
    try { return require(candidate) } catch { /* 继续尝试下一个 */ }
  }
  throw new Error('找不到 playwright：请在 client/ 下执行 npm install')
}

const { chromium } = loadPlaywright()

const BASE = process.env.LW_BASE_URL || 'http://127.0.0.1:5173'
const OUTPUT_ROOT = path.resolve(__dirname, '..', 'test-screenshots', 'design')
const ADMIN_EMAIL = 'admin@lineweb.dev'
const ADMIN_PASSWORD = 'admin123'

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2)
function argValue(name, fallback) {
  const pref = `--${name}=`
  const hit = argv.find((a) => a.startsWith(pref))
  if (hit) return hit.slice(pref.length)
  const idx = argv.indexOf(`--${name}`)
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1]
  return fallback
}
const TAG = argValue('tag', 'current')
const WIDTHS = argValue('widths', '1440,1024,390').split(',').map((n) => parseInt(n, 10)).filter(Boolean)
const THEMES = argValue('themes', 'light,dark').split(',').filter(Boolean)
const ROUTE_FILTER = argValue('routes', 'all')
const ONLY = argValue('only', '')
const PROVIDED_TOKEN = argValue('token', '')

/* ---------- 路由 ---------- */
const ROUTES = [
  { name: 'login', path: '/login', public: true },
  { name: 'register', path: '/register', public: true },
  { name: 'home', path: '/', full: true },
  { name: 'posts', path: '/posts' },
  { name: 'post', path: '/posts/{slug}' },
  { name: 'features', path: '/features' },
  { name: 'dynamic-page', path: '/page/{pageSlug}' },
  { name: 'profile', path: '/profile' },
  { name: 'calculator', path: '/calculator' },
  { name: 'games', path: '/games' },
  { name: 'leaderboard', path: '/games/leaderboard' },
  { name: 'game-2048', path: '/games/2048' },
  { name: 'game-doudizhu', path: '/games/doudizhu' },
  { name: 'game-uno', path: '/games/uno' },
  { name: 'game-xiangqi', path: '/games/xiangqi' },
  { name: 'drive', path: '/drive' },
  { name: 'chat', path: '/chat' },
  { name: 'deepseek', path: '/deepseek' },
  { name: 'points', path: '/points' },
  { name: 'pets', path: '/pets' },
  { name: 'music', path: '/music' },
  { name: 'reader', path: '/reader' },
  { name: 'stocks', path: '/stocks' },
  { name: 'webproxy', path: '/webproxy' },
  { name: 'admin', path: '/admin' },
  { name: 'admin-users', path: '/admin/users' },
  { name: 'admin-features', path: '/admin/features' },
  { name: 'admin-ai', path: '/admin/ai' },
  { name: 'admin-points', path: '/admin/points' },
  { name: 'admin-apps', path: '/admin/apps' },
  { name: 'admin-api', path: '/admin/api' },
  { name: 'admin-editor', path: '/admin/new' },
  { name: 'admin-page-editor', path: '/admin/pages/new' },
  { name: 'personal-space', path: '/personal-space' },
]

const CORE_NAMES = ['login', 'register', 'home', 'posts', 'post', 'profile', 'drive', 'chat', 'games', 'admin', 'admin-users', 'admin-features']
const ADMIN_NAMES = ['admin', 'admin-users', 'admin-features', 'admin-ai', 'admin-points', 'admin-apps', 'admin-api', 'admin-editor', 'admin-page-editor', 'personal-space']

function selectRoutes() {
  let list = ROUTES
  if (ROUTE_FILTER === 'core') list = list.filter((r) => CORE_NAMES.includes(r.name))
  else if (ROUTE_FILTER === 'admin') list = list.filter((r) => ADMIN_NAMES.includes(r.name))
  else if (ROUTE_FILTER !== 'all') {
    const wanted = ROUTE_FILTER.split(',').map((s) => s.trim()).filter(Boolean)
    list = ROUTES.filter((r) => wanted.includes(r.name) || wanted.includes(r.path))
  }
  if (ONLY) {
    const wanted = ONLY.split(',').map((s) => s.trim()).filter(Boolean)
    list = list.filter((r) => wanted.includes(r.name))
  }
  return list
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/* ---------- 令牌（只登录一次） ---------- */
async function fetchToken(browser) {
  const context = await browser.newContext()
  try {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    if (!res.ok()) {
      const text = await res.text().catch(() => '')
      throw new Error(`登录 API ${res.status()} ${text.slice(0, 160)}`)
    }
    const data = await res.json()
    return data.token
  } finally {
    await context.close()
  }
}

async function lookupSlugs(browser, token) {
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } })
  const out = { slug: null, pageSlug: null }
  try {
    const posts = await context.request.get(`${BASE}/api/posts?page=1&limit=1`)
    if (posts.ok()) {
      const data = await posts.json()
      out.slug = data?.posts?.[0]?.slug ?? null
    }
  } catch { /* 相关截图会跳过 */ }
  try {
    const pages = await context.request.get(`${BASE}/api/pages/featured`)
    if (pages.ok()) {
      const data = await pages.json()
      out.pageSlug = data?.pages?.[0]?.slug ?? null
    }
  } catch { /* 同上 */ }
  await context.close()
  return out
}

function attachCollectors(page, report, meta) {
  let currentRoute = 'boot'
  page.on('console', (msg) => {
    if (msg.type() === 'error') report.consoleErrors.push({ ...meta, route: currentRoute, text: msg.text().slice(0, 400) })
  })
  page.on('pageerror', (err) => report.consoleErrors.push({ ...meta, route: currentRoute, text: `pageerror: ${String(err).slice(0, 400)}` }))
  return (route) => { currentRoute = route }
}

async function capture(page, routes, dir, report, meta, setRoute) {
  for (const route of routes) {
    setRoute(route.name)
    await page.goto(BASE + route.path, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
    }))
    if (overflow.scrollWidth > overflow.innerWidth + 1 || overflow.bodyWidth > overflow.innerWidth + 1) {
      report.overflow.push({ ...meta, route: route.name, ...overflow })
    }
    await page.screenshot({ path: path.join(dir, `${route.name}.png`), fullPage: !!route.full })
  }
}

/* ---------- 主流程 ---------- */
;(async () => {
  const routes = selectRoutes()
  const publicRoutes = routes.filter((r) => r.public)
  const protectedRoutes = routes.filter((r) => !r.public)
  const report = { tag: TAG, base: BASE, startedAt: new Date().toISOString(), runs: [], overflow: [], consoleErrors: [], skipped: [] }

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    let token = PROVIDED_TOKEN || null
    try {
      if (!token) token = await fetchToken(browser)
      console.log(token === PROVIDED_TOKEN ? '[auth] 使用 --token 提供的令牌' : '[auth] 已获取复用令牌（仅登录一次）')
    } catch (err) {
      console.warn('[auth] 获取令牌失败，将回退到页面登录：', err.message)
    }

    const { slug, pageSlug } = token
      ? await lookupSlugs(browser, token)
      : { slug: null, pageSlug: null }
    if (!slug) report.skipped.push({ reason: '没有已发布文章，跳过 /posts/:slug' })
    if (!pageSlug) report.skipped.push({ reason: '没有推荐页面，跳过 /page/:slug' })

    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        const height = width <= 430 ? 844 : 900
        const dir = path.join(OUTPUT_ROOT, TAG, theme, String(width))
        ensureDir(dir)
        const meta = { theme, width }

        // 1) 公开页：独立上下文，不带令牌（否则 /login 会被重定向）
        const publicContext = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: width <= 430 ? 2 : 1,
          colorScheme: theme === 'dark' ? 'dark' : 'light',
        })
        await publicContext.addInitScript((t) => {
          try { localStorage.setItem('lineweb_theme', t) } catch { /* about:blank */ }
        }, theme)
        const publicPage = await publicContext.newPage()
        const publicSetRoute = attachCollectors(publicPage, report, meta)
        await capture(publicPage, publicRoutes, dir, report, meta, publicSetRoute)
        await publicContext.close()

        // 2) 受保护页：注入令牌
        if (protectedRoutes.length > 0) {
          if (!token) {
            report.skipped.push({ theme, width, reason: '无可用令牌，跳过受保护页面' })
            continue
          }
          const authContext = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: width <= 430 ? 2 : 1,
            colorScheme: theme === 'dark' ? 'dark' : 'light',
          })
          await authContext.addInitScript(([t, tk]) => {
            try {
              localStorage.setItem('lineweb_theme', t)
              localStorage.setItem('lineweb_token', tk)
            } catch { /* about:blank */ }
          }, [theme, token])
          const authPage = await authContext.newPage()
          const authSetRoute = attachCollectors(authPage, report, meta)

          const resolvable = protectedRoutes.filter((route) => {
            if (route.path.includes('{slug}') && !slug) return false
            if (route.path.includes('{pageSlug}') && !pageSlug) return false
            return true
          })
          const resolved = resolvable.map((route) => ({
            ...route,
            path: route.path.replace('{slug}', slug ?? '').replace('{pageSlug}', pageSlug ?? ''),
          }))
          await capture(authPage, resolved, dir, report, meta, authSetRoute)
          await authContext.close()
        }

        report.runs.push({ theme, width, publicRoutes: publicRoutes.length, protectedRoutes: protectedRoutes.length })
        console.log(`[ok] ${theme} ${width}px → ${path.relative(process.cwd(), dir)}`)
      }
    }
  } finally {
    await browser.close()
  }

  report.finishedAt = new Date().toISOString()
  ensureDir(path.join(OUTPUT_ROOT, TAG))
  fs.writeFileSync(path.join(OUTPUT_ROOT, TAG, 'report.json'), JSON.stringify(report, null, 2))

  const overflowCount = report.overflow.length
  const errorCount = report.consoleErrors.length
  console.log(`\n===== ${TAG} 设计验收 =====`)
  console.log(`截图目录: test-screenshots/design/${TAG}`)
  console.log(`水平溢出: ${overflowCount}`)
  report.overflow.slice(0, 20).forEach((o) => console.log(`  ! ${o.theme} ${o.width} ${o.route}: scrollWidth=${o.scrollWidth} > ${o.innerWidth}`))
  console.log(`console 错误: ${errorCount}`)
  report.consoleErrors.slice(0, 15).forEach((e) => console.log(`  ! ${e.theme} ${e.width} ${e.route}: ${e.text}`))
  if (report.skipped.length) console.log(`跳过: ${report.skipped.length}（详见 report.json）`)
  process.exitCode = overflowCount > 0 ? 2 : 0
})().catch((err) => {
  console.error('[fatal]', err)
  process.exitCode = 1
})
