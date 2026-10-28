/**
 * 网页反代纯函数自检（不依赖数据库 / 存储节点 / 真实上游）
 *
 * 用法: cd server && npx tsx scripts/verify-webproxy.ts
 *
 * 覆盖：
 *   - Cookie 罐：Set-Cookie 解析（Domain/Path/Expires/Max-Age/HttpOnly/Secure/SameSite、
 *     非法值、伪造 Domain 忽略）、默认 Path、合并与过期删除、按域/路径/Secure 匹配、
 *     JS Cookie 合并、可见 Cookie 过滤、序列化往返；
 *   - 站点规范化：补 https、去路径、拒账号密码、拒非 http(s)；
 *   - URL 重写：根路径 / 同源绝对 / 协议相对 / 已反代 / 外链 / 伪协议，WebSocket 映射与
 *     Referer 还原，CSS url() 与 @import；
 *   - HTML 重写：属性 / srcset / style / meta refresh 改写，meta CSP / base / integrity
 *     剥离，引导脚本注入位置与内容；
 *   - SSRF 防护：localhost / 内网 / 云元数据 / 公网 IP；
 *   - 错误页与登录页文案。
 */

process.env.DATABASE_URL ||= 'file:./.verify-webproxy.db'
process.env.JWT_SECRET ||= 'verify-webproxy-secret'
process.env.NODE_ENV ||= 'development'

type CookiesModule = typeof import('../src/services/proxyCookies.js')
type ProxyServiceModule = typeof import('../src/services/webProxyService.js')
type BootstrapModule = typeof import('../src/services/webProxyBootstrap.js')
type ProxyCookie = import('../src/services/proxyCookies.js').ProxyCookie

let cookies: CookiesModule
let proxy: ProxyServiceModule
let bootstrap: BootstrapModule

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

async function assertRejects(run: () => Promise<unknown>, includes: string, label: string): Promise<void> {
  try {
    await run()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes(includes)) {
      throw new Error(`断言失败：${label}\n  错误信息: ${message}\n  期望包含: ${includes}`)
    }
    passed += 1
    return
  }
  throw new Error(`断言失败：${label}（没有抛错）`)
}

function assertThrows(run: () => unknown, includes: string, label: string): void {
  try {
    run()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes(includes)) {
      throw new Error(`断言失败：${label}\n  错误信息: ${message}\n  期望包含: ${includes}`)
    }
    passed += 1
    return
  }
  throw new Error(`断言失败：${label}（没有抛错）`)
}

async function main(): Promise<void> {
  cookies = await import('../src/services/proxyCookies.js')
  proxy = await import('../src/services/webProxyService.js')
  bootstrap = await import('../src/services/webProxyBootstrap.js')

  // ============================================================
  // 1. Cookie：默认 Path 与 Set-Cookie 解析
  // ============================================================
  assertEqual(cookies.defaultCookiePath('/a/b/c'), '/a/b', '默认 Path：取目录部分')
  assertEqual(cookies.defaultCookiePath('/foo'), '/', '默认 Path：一级路径回退 /')
  assertEqual(cookies.defaultCookiePath('/'), '/', '默认 Path：根路径')
  assertEqual(cookies.defaultCookiePath(''), '/', '默认 Path：空路径')

  const loginUrl = new URL('https://www.example.com/account/login?next=%2Fhome')
  const session = cookies.parseSetCookie(
    'sid=abc123; Domain=.example.com; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax',
    loginUrl,
  )!
  assertEqual(session.name, 'sid', 'Set-Cookie：名称')
  assertEqual(session.value, 'abc123', 'Set-Cookie：值')
  assertEqual(session.domain, 'example.com', 'Set-Cookie：Domain 去前导点')
  assertEqual(session.hostOnly, false, 'Set-Cookie：带 Domain 时非 hostOnly')
  assertEqual(session.path, '/', 'Set-Cookie：显式 Path')
  assertEqual(session.httpOnly, true, 'Set-Cookie：HttpOnly')
  assertEqual(session.secure, true, 'Set-Cookie：Secure')
  assertEqual(session.sameSite, 'lax', 'Set-Cookie：SameSite 小写')
  assert(
    typeof session.expires === 'number' && session.expires > Date.now() + 3_500_000,
    'Set-Cookie：Max-Age 换算为未来时间',
  )

  const theme = cookies.parseSetCookie('theme="dark"', loginUrl)!
  assertEqual(theme.domain, 'www.example.com', 'Set-Cookie：无 Domain 时 hostOnly')
  assertEqual(theme.hostOnly, true, 'Set-Cookie：hostOnly 标记')
  assertEqual(theme.path, '/account', 'Set-Cookie：默认 Path 取请求目录')
  assertEqual(theme.value, '"dark"', 'Set-Cookie：引号值原样保留')

  const spoofed = cookies.parseSetCookie('x=1; Domain=evil.com; Path=/', loginUrl)!
  assertEqual(spoofed.domain, 'www.example.com', 'Set-Cookie：拒绝无关域名')
  assertEqual(spoofed.hostOnly, true, 'Set-Cookie：伪造 Domain 后仍为 hostOnly')

  const maxAgeWins = cookies.parseSetCookie(
    'm=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=600',
    loginUrl,
  )!
  assert(
    typeof maxAgeWins.expires === 'number' && maxAgeWins.expires > Date.now(),
    'Set-Cookie：Max-Age 优先于 Expires',
  )

  const evict = cookies.parseSetCookie('sid=; Max-Age=0', loginUrl)!
  assertEqual(evict.expires, 0, 'Set-Cookie：Max-Age=0 表示立即过期')

  assertEqual(cookies.parseSetCookie('novalue', loginUrl), null, 'Set-Cookie：缺少 = 时忽略')
  assertEqual(cookies.parseSetCookie('=x', loginUrl), null, 'Set-Cookie：空名称时忽略')
  assertEqual(cookies.parseSetCookie('bad name=x', loginUrl), null, 'Set-Cookie：名称含空格时忽略')

  // ============================================================
  // 2. Cookie 合并 / 匹配 / 序列化
  // ============================================================
  const base = (name: string, value: string, extra: Partial<ProxyCookie> = {}): ProxyCookie => ({
    name,
    value,
    domain: 'example.com',
    path: '/',
    hostOnly: false,
    ...extra,
  })

  const merged = cookies.mergeCookieJar(
    [base('a', '1'), base('b', '2')],
    [base('a', '9'), base('c', '3')],
  )
  assertEqual(
    merged.map((c) => `${c.name}=${c.value}`).sort(),
    ['a=9', 'b=2', 'c=3'],
    'Cookie 合并：同名覆盖、不同名保留',
  )

  const removed = cookies.mergeCookieJar([base('a', '1')], [base('a', '', { expires: 0 })])
  assertEqual(removed.length, 0, 'Cookie 合并：过期项被删除')

  const expiredExisting = cookies.mergeCookieJar([base('old', '1', { expires: Date.now() - 1000 })], [])
  assertEqual(expiredExisting.length, 0, 'Cookie 合并：已有过期项被清理')

  const jar = [
    base('a', '1'),
    base('b', '2', { domain: 'www.example.com', hostOnly: true, path: '/account' }),
    base('c', '3', { secure: true }),
    base('dead', '4', { expires: Date.now() - 5000 }),
  ]
  assertEqual(
    cookies.cookieHeaderForUrl(jar, new URL('https://www.example.com/account/login')),
    'a=1; b=2; c=3',
    'Cookie 头：同域 + 子域 Domain + 路径 + Secure(https)',
  )
  assertEqual(
    cookies.cookieHeaderForUrl(jar, new URL('http://www.example.com/account/login')),
    'a=1; b=2',
    'Cookie 头：http 下不发送 Secure',
  )
  assertEqual(
    cookies.cookieHeaderForUrl(jar, new URL('https://www.example.com/accounting')),
    'a=1; c=3',
    'Cookie 头：/account 不匹配 /accounting',
  )
  assertEqual(
    cookies.cookieHeaderForUrl(jar, new URL('https://api.example.com/')),
    'a=1; c=3',
    'Cookie 头：hostOnly 不发往子域，Domain 覆盖子域',
  )

  assertEqual(
    cookies.publicCookiesForUrl(
      [base('a', '1'), base('h', '2', { httpOnly: true }), base('s', '3', { secure: true })],
      new URL('http://example.com/'),
    ).map((c) => c.name),
    ['a'],
    '可见 Cookie：过滤 HttpOnly 与 http 下的 Secure',
  )
  assertEqual(
    cookies.publicCookiesForUrl([base('a', '1')], new URL('https://example.com/')).length,
    1,
    '可见 Cookie：https 下保留普通 Cookie',
  )

  assertEqual(
    cookies.sanitizeClientCookies('a=1; bad name=2; c=3; ; x=hello world'),
    'a=1; c=3; x=hello world',
    'JS Cookie 清洗：丢弃非法名称与空段',
  )
  assertEqual(
    cookies.mergeCookieHeaders('a=1; b=2', 'b=9; c=3'),
    'a=1; b=9; c=3',
    'Cookie 头合并：JS 写入覆盖服务端同名项',
  )
  assertEqual(cookies.mergeCookieHeaders('', 'x=1'), 'x=1', 'Cookie 头合并：服务端为空')
  assertEqual(cookies.mergeCookieHeaders('x=1', ''), 'x=1', 'Cookie 头合并：客户端为空')

  const serialized = cookies.serializeCookieJar([base('a', '1'), base('b', '2')])
  assertEqual(cookies.readCookieJar(serialized).length, 2, 'Cookie 序列化：往返保留')
  assertEqual(cookies.readCookieJar('not json'), [], 'Cookie 序列化：坏 JSON 按空罐')
  assertEqual(cookies.readCookieJar('{"a":1}'), [], 'Cookie 序列化：非数组按空罐')
  assertEqual(
    cookies.readCookieJar(JSON.stringify([base('a', '1', { expires: Date.now() - 1000 })])).length,
    0,
    'Cookie 读取：过滤已过期项',
  )
  assertEqual(cookies.countSessionCookies([base('a', '1'), base('b', '2', { expires: Date.now() - 1 })]), 1, 'Cookie 统计：登录态数量')

  // ============================================================
  // 3. 站点规范化与 SSRF 防护
  // ============================================================
  assertEqual(proxy.normalizeSiteOrigin('example.com'), 'https://example.com', '站点规范化：补 https')
  assertEqual(proxy.normalizeSiteOrigin('http://Example.COM:8080/a/b?x=1#h'), 'http://example.com:8080', '站点规范化：去路径并小写主机')
  assertEqual(proxy.normalizeSiteOrigin('  https://example.com/  '), 'https://example.com', '站点规范化：去空白与末尾斜杠')
  assertThrows(() => proxy.normalizeSiteOrigin(''), '请输入网站域名', '站点规范化：空输入')
  assertThrows(() => proxy.normalizeSiteOrigin('ftp://example.com'), '只支持', '站点规范化：拒绝 ftp')
  assertThrows(() => proxy.normalizeSiteOrigin('https://u:p@example.com'), '账号密码', '站点规范化：拒绝账号密码')
  assertEqual(proxy.prettySiteName('https://www.example.com'), 'www.example.com', '站点显示名：hostname')

  await assertRejects(() => proxy.assertPublicHost('localhost'), '本机或内网', 'SSRF：localhost')
  await assertRejects(() => proxy.assertPublicHost('foo.localhost'), '本机或内网', 'SSRF：子域 localhost')
  await assertRejects(() => proxy.assertPublicHost('app.internal'), '本机或内网', 'SSRF：.internal')
  await assertRejects(() => proxy.assertPublicHost('127.0.0.1'), '本机或内网', 'SSRF：127.0.0.1')
  await assertRejects(() => proxy.assertPublicHost('10.1.2.3'), '本机或内网', 'SSRF：10/8')
  await assertRejects(() => proxy.assertPublicHost('172.20.0.1'), '本机或内网', 'SSRF：172.16/12')
  await assertRejects(() => proxy.assertPublicHost('192.168.1.1'), '本机或内网', 'SSRF：192.168/16')
  await assertRejects(() => proxy.assertPublicHost('169.254.169.254'), '本机或内网', 'SSRF：云元数据')
  await assertRejects(() => proxy.assertPublicHost('::1'), '本机或内网', 'SSRF：IPv6 回环')
  await assertRejects(() => proxy.assertPublicHost('fd00::1'), '本机或内网', 'SSRF：IPv6 ULA')
  await assertRejects(() => proxy.assertPublicHost(''), '缺少主机名', 'SSRF：空主机')
  await proxy.assertPublicHost('8.8.8.8')
  assert(true, 'SSRF：公网 IP 放行')

  // ============================================================
  // 4. URL / WebSocket / CSS 重写
  // ============================================================
  const ctx = { siteId: 7, siteOrigin: 'https://example.com', activeOrigin: 'https://example.com' }
  assertEqual(proxy.mapUrlToProxy('/', ctx), '/proxy/7/', 'URL 重写：根路径')
  assertEqual(proxy.mapUrlToProxy('/a/b?x=1#h', ctx), '/proxy/7/a/b?x=1#h', 'URL 重写：根路径带查询与哈希')
  assertEqual(proxy.mapUrlToProxy('https://example.com/a.js', ctx), '/proxy/7/a.js', 'URL 重写：同源绝对地址')
  assertEqual(proxy.mapUrlToProxy('//example.com/img.png', ctx), '/proxy/7/img.png', 'URL 重写：协议相对同源')
  assertEqual(proxy.mapUrlToProxy('/proxy/7/a.js', ctx), '/proxy/7/a.js', 'URL 重写：已反代地址不重复前缀')
  assertEqual(proxy.mapUrlToProxy('https://cdn.example.com/a.js', ctx), 'https://cdn.example.com/a.js', 'URL 重写：外链保持')
  assertEqual(proxy.mapUrlToProxy('https://other.com/a', ctx), 'https://other.com/a', 'URL 重写：第三方保持')
  assertEqual(proxy.mapUrlToProxy('#top', ctx), '#top', 'URL 重写：锚点保持')
  assertEqual(proxy.mapUrlToProxy('mailto:a@b.com', ctx), 'mailto:a@b.com', 'URL 重写：mailto 保持')
  assertEqual(proxy.mapUrlToProxy('javascript:void(0)', ctx), 'javascript:void(0)', 'URL 重写：javascript 保持')
  assertEqual(proxy.mapUrlToProxy('data:image/png;base64,AAAA', ctx), 'data:image/png;base64,AAAA', 'URL 重写：data URI 保持')
  assertEqual(
    proxy.mapUrlToProxy('https://login.example.com/oauth', { ...ctx, activeOrigin: 'https://login.example.com' }),
    '/proxy/7/oauth',
    'URL 重写：跨域跳转后的活动源站',
  )

  const wsCtx = { ...ctx, siteId: 7 }
  assertEqual(
    proxy.mapWsUrlToProxy('/socket', wsCtx, 'lineweb.test', true),
    'wss://lineweb.test/proxy-ws/7/socket',
    'WS 重写：根路径',
  )
  assertEqual(
    proxy.mapWsUrlToProxy('wss://example.com/live?x=1', wsCtx, 'lineweb.test', true),
    'wss://lineweb.test/proxy-ws/7/live?x=1',
    'WS 重写：同源绝对地址',
  )
  assertEqual(
    proxy.mapWsUrlToProxy('wss://other.com/live', wsCtx, 'lineweb.test', true),
    'wss://other.com/live',
    'WS 重写：外部地址保持',
  )
  assertEqual(
    proxy.mapWsUrlToProxy('/proxy-ws/7/live', wsCtx, 'lineweb.test', true),
    '/proxy-ws/7/live',
    'WS 重写：已反代地址保持',
  )

  assertEqual(
    proxy.proxyUrlToUpstream('http://lineweb.test/proxy/7/a?b=1', ctx),
    'https://example.com/a?b=1',
    'Referer 还原：反代路径 → 上游',
  )
  assertEqual(
    proxy.proxyUrlToUpstream('https://other.com/page', ctx),
    'https://other.com/page',
    'Referer 还原：外部地址保持',
  )

  const css = '.a{background:url(/img/a.png)} .b{background:url("https://example.com/b.png")} .c{background:url(https://cdn.com/c.png)} @import "/style/d.css"; .e{background:url(data:image/png;base64,AA)}'
  const rewrittenCss = proxy.rewriteCss(css, ctx)
  assert(rewrittenCss.includes('url(/proxy/7/img/a.png)'), 'CSS 重写：根路径 url()')
  assert(rewrittenCss.includes('url("/proxy/7/b.png")'), 'CSS 重写：同源绝对 url() 保留引号')
  assert(rewrittenCss.includes('url(https://cdn.com/c.png)'), 'CSS 重写：外链 url() 保持')
  assert(rewrittenCss.includes('@import "/proxy/7/style/d.css"'), 'CSS 重写：@import')
  assert(rewrittenCss.includes('url(data:image/png;base64,AA)'), 'CSS 重写：data URI 保持')

  // ============================================================
  // 5. HTML 重写与引导脚本注入
  // ============================================================
  const html = [
    '<!doctype html><html lang="en"><head>',
    '<base href="https://example.com/">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
    '<meta http-equiv="refresh" content="3;url=/next">',
    '<script src="/app.js" integrity="sha384-abc"></script>',
    '<link rel="stylesheet" href="https://example.com/site.css">',
    '<style>.hero{background:url(/bg.png)}</style>',
    '</head><body>',
    '<a href="/docs">docs</a>',
    '<img src="//example.com/logo.png" srcset="/small.png 1x, https://cdn.com/big.png 2x">',
    '<form action="/search"><input name="q"></form>',
    '<div style="background:url(\'/inline.png\')"></div>',
    '</body></html>',
  ].join('')

  const out = proxy.rewriteHtml(html, ctx, { cookies: [{ name: 'sid', value: 'abc' }] })
  assert(!out.includes('<base'), 'HTML 重写：剥离 <base>')
  assert(!/content-security-policy/i.test(out), 'HTML 重写：剥离 meta CSP')
  assert(!out.includes('integrity='), 'HTML 重写：剥离 integrity')
  assert(out.includes('src="/proxy/7/app.js"'), 'HTML 重写：脚本 src')
  assert(out.includes('href="/proxy/7/site.css"'), 'HTML 重写：样式表 href')
  assert(out.includes('href="/proxy/7/docs"'), 'HTML 重写：链接 href')
  assert(out.includes('action="/proxy/7/search"'), 'HTML 重写：表单 action')
  assert(out.includes('src="/proxy/7/logo.png"'), 'HTML 重写：协议相对 img')
  assert(out.includes('srcset="/proxy/7/small.png 1x, https://cdn.com/big.png 2x"'), 'HTML 重写：srcset 只映射同源')
  assert(out.includes('background:url(/proxy/7/bg.png)'), 'HTML 重写：<style> 内 url()')
  assert(out.includes("background:url('/proxy/7/inline.png')"), 'HTML 重写：style 属性内 url()')
  assert(out.includes('3;url=/proxy/7/next'), 'HTML 重写：meta refresh')
  assert(out.includes('<script data-lineweb-proxy="7">'), 'HTML 重写：注入引导脚本')
  const headEnd = out.indexOf('</head>')
  const scriptAt = out.indexOf('<script data-lineweb-proxy="7">')
  assert(scriptAt > out.indexOf('<head') && scriptAt < headEnd, 'HTML 重写：脚本位于 head 内')
  assert(out.includes('"cookies":[{"name":"sid","value":"abc"}]'), 'HTML 重写：页面可见 Cookie 注入')

  const noHead = proxy.rewriteHtml('<html><body><a href="/x">x</a></body></html>', ctx, { cookies: [] })
  assert(noHead.includes('<html><script data-lineweb-proxy="7">'), 'HTML 重写：无 head 时插在 html 后')

  const fragment = proxy.rewriteHtml('<div>hi</div>', ctx, { cookies: [] })
  assert(fragment.startsWith('<script data-lineweb-proxy="7">'), 'HTML 重写：片段前插入脚本')

  // ============================================================
  // 6. 引导脚本内容
  // ============================================================
  const boot = bootstrap.buildBootstrapScript({ siteId: 7, origin: 'https://example.com', cookies: [{ name: 'a', value: '1' }] })
  assert(boot.includes("var PREFIX='/proxy/'+SITE_ID"), '引导脚本：HTTP 前缀')
  assert(boot.includes("var WS_PREFIX='/proxy-ws/'+SITE_ID"), '引导脚本：WS 前缀')
  assert(boot.includes("var STORE_PREFIX='__lw'+SITE_ID+'__'"), '引导脚本：Storage 分区前缀')
  assert(boot.includes('__LINEWEB_PROXY__'), '引导脚本：全局标记')
  assert(boot.includes("defineProperty(document,'cookie'"), '引导脚本：document.cookie 虚拟罐')
  assert(boot.includes('window.fetch='), '引导脚本：fetch 改写')
  assert(boot.includes('XMLHttpRequest'), '引导脚本：XHR 改写')
  assert(boot.includes('window.WebSocket='), '引导脚本：WebSocket 改写')
  assert(boot.includes('window.EventSource='), '引导脚本：EventSource 改写')
  assert(boot.includes('MutationObserver'), '引导脚本：动态节点补写')
  assert(boot.includes('serviceWorker'), '引导脚本：禁用 Service Worker')

  // ============================================================
  // 7. 错误页 / 登录页
  // ============================================================
  const errorPage = proxy.buildProxyErrorPage('无法连接目标网站', '请稍后重试', { retry: true })
  assert(errorPage.includes('返回 LineWeb'), '错误页：返回 LineWeb')
  assert(errorPage.includes('target="_top"'), '错误页：跳出 iframe 返回')
  assert(errorPage.includes('href="/webproxy"'), '错误页：指向反代列表')
  assert(errorPage.includes('重新加载'), '错误页：重试按钮')

  const loginPage = proxy.buildProxyLoginPage('会话已失效')
  assert(loginPage.includes('需要重新登录 LineWeb'), '登录页：标题')
  assert(loginPage.includes('会话已失效'), '登录页：自定义文案')
  assert(!loginPage.includes('返回上一页'), '登录页：不提供返回上一页')

  console.log(`verify:webproxy 通过 ${passed} 项断言`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
