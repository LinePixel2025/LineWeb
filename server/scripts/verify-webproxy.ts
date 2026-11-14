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
 *   - 同源媒体代理：路径编码/解析、Content-Type 白名单、HLS 播放列表改写（含 URI="..." 标签）、
 *     媒体标签属性改写与引导脚本补丁；
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
type MediaModule = typeof import('../src/services/webProxyMedia.js')
type ProfilesModule = typeof import('../src/services/webProxyProfiles.js')
type HostsModule = typeof import('../src/services/webProxyHosts.js')
type BodyModule = typeof import('../src/services/webProxyBody.js')
type ProxyCookie = import('../src/services/proxyCookies.js').ProxyCookie

let cookies: CookiesModule
let proxy: ProxyServiceModule
let bootstrap: BootstrapModule
let media: MediaModule
let profiles: ProfilesModule
let hosts: HostsModule
let body: BodyModule

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
  media = await import('../src/services/webProxyMedia.js')
  profiles = await import('../src/services/webProxyProfiles.js')
  hosts = await import('../src/services/webProxyHosts.js')
  body = await import('../src/services/webProxyBody.js')

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
  assertEqual(
    proxy.mapUrlToProxy('https://cdn.example.com/a.js', ctx),
    '/proxy/7/https/cdn.example.com/a.js',
    'URL 重写：同注册域兄弟子域走内嵌主机',
  )
  assertEqual(proxy.mapUrlToProxy('https://other.com/a', ctx), 'https://other.com/a', 'URL 重写：族外第三方保持')
  assertEqual(proxy.mapUrlToProxy('#top', ctx), '#top', 'URL 重写：锚点保持')
  assertEqual(proxy.mapUrlToProxy('mailto:a@b.com', ctx), 'mailto:a@b.com', 'URL 重写：mailto 保持')
  assertEqual(proxy.mapUrlToProxy('javascript:void(0)', ctx), 'javascript:void(0)', 'URL 重写：javascript 保持')
  assertEqual(proxy.mapUrlToProxy('data:image/png;base64,AAAA', ctx), 'data:image/png;base64,AAAA', 'URL 重写：data URI 保持')
  assertEqual(
    proxy.mapUrlToProxy('https://login.example.com/oauth', { ...ctx, activeOrigin: 'https://login.example.com' }),
    '/proxy/7/https/login.example.com/oauth',
    'URL 重写：活动主机绝对地址走内嵌主机',
  )
  assertEqual(
    proxy.mapUrlToProxy('/oauth?x=1', { ...ctx, activeOrigin: 'https://login.example.com' }),
    '/proxy/7/https/login.example.com/oauth?x=1',
    'URL 重写：兄弟子域文档的根相对地址属于活动主机',
  )
  assertEqual(
    proxy.mapUrlToProxy('/oauth', ctx),
    '/proxy/7/oauth',
    'URL 重写：站点文档根相对地址仍走普通前缀',
  )

  // 站点族注册域计算
  assertEqual(proxy.registrableDomainOf('www.bilibili.com'), 'bilibili.com', '站点族：常规两段 TLD')
  assertEqual(proxy.registrableDomainOf('a.b.example.com'), 'example.com', '站点族：多级子域取注册域')
  assertEqual(proxy.registrableDomainOf('www.example.com.cn'), 'example.com.cn', '站点族：多段公共后缀取三段')
  assertEqual(proxy.registrableDomainOf('bilibili.com'), 'bilibili.com', '站点族：裸注册域')
  assertEqual(proxy.registrableDomainOf('192.168.1.1'), null, '站点族：IP 不启用')
  assertEqual(proxy.registrableDomainOf('foo.bar.moe'), null, '站点族：表外 TLD 回退不启用')

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
    proxy.mapWsUrlToProxy('wss://api.example.com/live', wsCtx, 'lineweb.test', true),
    'wss://lineweb.test/proxy-ws/7/https/api.example.com/live',
    'WS 重写：族内子域走内嵌主机',
  )
  assertEqual(
    proxy.mapWsUrlToProxy('/socket', { ...wsCtx, activeOrigin: 'https://login.example.com' }, 'lineweb.test', true),
    'wss://lineweb.test/proxy-ws/7/https/login.example.com/socket',
    'WS 重写：兄弟子域文档的根相对地址',
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
    proxy.proxyUrlToUpstream('http://lineweb.test/proxy/7/https/passport.example.com/login?go=1', ctx),
    'https://passport.example.com/login?go=1',
    'Referer 还原：内嵌主机形态 → 上游',
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
  assert(
    rewrittenCss.includes('url(/proxy/7/__lw_res__/https/cdn.com/c.png)'),
    'CSS 重写：外链 url() 走资源代理',
  )
  assert(rewrittenCss.includes('@import "/proxy/7/style/d.css"'), 'CSS 重写：@import')
  assert(rewrittenCss.includes('url(data:image/png;base64,AA)'), 'CSS 重写：data URI 保持')

  // ============================================================
  // 4.5 同源媒体代理
  // ============================================================
  assertEqual(media.MEDIA_SEGMENT, '__lw_media__', '媒体代理：路径段常量')
  assertEqual(media.mediaPathPrefix(7), '/proxy/7/__lw_media__/', '媒体代理：路径前缀')

  const mediaUrl = new URL('https://cdn.example.com/hls/index.m3u8?token=a%2Fb&x=1')
  const mediaPath = media.buildMediaProxyPath(mediaUrl, 7)
  assertEqual(
    mediaPath,
    '/proxy/7/__lw_media__/https/cdn.example.com/hls/index.m3u8?token=a%2Fb&x=1',
    '媒体代理：路径保留大小写与查询串',
  )
  assertEqual(
    media.buildMediaProxyPath(new URL('http://cdn.example.com:8080/a/b.ts'), 9),
    '/proxy/9/__lw_media__/http/cdn.example.com:8080/a/b.ts',
    '媒体代理：保留 http 协议与端口',
  )
  assertEqual(
    media.buildMediaProxyPath(new URL('https://cdn.example.com'), 7),
    '/proxy/7/__lw_media__/https/cdn.example.com/',
    '媒体代理：无路径时补 /',
  )
  assert(media.isMediaProxyPath(mediaPath, 7), '媒体代理：识别自身路径')
  assert(!media.isMediaProxyPath(mediaPath, 8), '媒体代理：站点编号不同不算')

  const parsedMedia = media.parseMediaTarget(7, mediaPath.split('?')[0], '?token=a%2Fb&x=1')
  assertEqual(parsedMedia?.href, 'https://cdn.example.com/hls/index.m3u8?token=a%2Fb&x=1', '媒体代理：解析回上游 URL')
  assertEqual(media.parseMediaTarget(7, '/proxy/7/index.html'), null, '媒体代理：非媒体路径解析失败')
  assertEqual(media.parseMediaTarget(7, '/proxy/7/__lw_media__/ftp/cdn.com/a'), null, '媒体代理：拒绝非 http(s) 协议')
  assertEqual(media.parseMediaTarget(7, '/proxy/7/__lw_media__/https/user:pass@cdn.com/a'), null, '媒体代理：拒绝带账号密码')
  assertEqual(media.parseMediaTarget(7, '/proxy/7/__lw_media__/https/'), null, '媒体代理：缺少主机名')

  assertEqual(media.classifyMediaContentType('video/mp4'), 'stream', '媒体类型：video/mp4')
  assertEqual(media.classifyMediaContentType('audio/mpeg; charset=binary'), 'stream', '媒体类型：audio 带参数')
  assertEqual(media.classifyMediaContentType('application/octet-stream'), 'stream', '媒体类型：octet-stream')
  assertEqual(media.classifyMediaContentType(''), 'stream', '媒体类型：缺失按流处理')
  assertEqual(media.classifyMediaContentType('application/vnd.apple.mpegurl'), 'playlist', '媒体类型：HLS 清单')
  assertEqual(media.classifyMediaContentType('APPLICATION/X-MPEGURL'), 'playlist', '媒体类型：忽略大小写')
  assertEqual(media.classifyMediaContentType('application/dash+xml'), 'manifest', '媒体类型：DASH 清单')
  assertEqual(media.classifyMediaContentType('text/plain'), 'text', '媒体类型：纯文本')
  assertEqual(media.classifyMediaContentType('text/vtt'), 'text', '媒体类型：WebVTT 字幕')
  assertEqual(media.classifyMediaContentType('text/html'), 'blocked', '媒体类型：拒绝 HTML')
  assertEqual(media.classifyMediaContentType('application/xhtml+xml'), 'blocked', '媒体类型：拒绝 XHTML')
  assertEqual(media.classifyMediaContentType('text/css'), 'blocked', '媒体类型：拒绝 CSS')
  assertEqual(media.classifyMediaContentType('application/javascript'), 'blocked', '媒体类型：拒绝 JS')
  assertEqual(media.classifyMediaContentType('image/svg+xml'), 'blocked', '媒体类型：拒绝 SVG')
  assertEqual(media.classifyMediaContentType('application/json'), 'blocked', '媒体类型：拒绝 JSON')

  assert(media.looksLikePlaylist(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3')), '播放列表识别：标准头')
  assert(media.looksLikePlaylist(Buffer.from('\uFEFF  \n#EXTM3U\n')), '播放列表识别：BOM 与前导空白')
  assert(!media.looksLikePlaylist(Buffer.from('<!doctype html><html>')), '播放列表识别：HTML 不算')
  assert(!media.looksLikePlaylist(Buffer.alloc(0)), '播放列表识别：空内容')

  const playlistBase = new URL('https://cdn.example.com/hls/index.m3u8')
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k1.bin",IV=0x01',
    '#EXT-X-MAP:URI="../init.mp4"',
    '#EXTINF:6.0,',
    'seg-1.ts',
    '#EXTINF:6.0,',
    '/hls/seg-2.ts?token=a%2Fb',
    '#EXTINF:6.0,',
    'https://other.cdn.com/seg-3.ts',
    '#EXT-X-ENDLIST',
  ].join('\n')
  const rewrittenPlaylist = media.rewritePlaylist(playlist, playlistBase, 7)
  assert(rewrittenPlaylist.includes('URI="/proxy/7/__lw_media__/https/keys.example.com/k1.bin"'), '播放列表：EXT-X-KEY 的 URI')
  assert(rewrittenPlaylist.includes('URI="../init.mp4"'), '播放列表：相对 URI 保持')
  assert(rewrittenPlaylist.includes('\nseg-1.ts\n'), '播放列表：相对分片保持')
  assert(rewrittenPlaylist.includes('/proxy/7/__lw_media__/https/cdn.example.com/hls/seg-2.ts?token=a%2Fb'), '播放列表：根路径分片')
  assert(rewrittenPlaylist.includes('/proxy/7/__lw_media__/https/other.cdn.com/seg-3.ts'), '播放列表：跨域绝对分片')
  assert(rewrittenPlaylist.includes('#EXT-X-VERSION:3'), '播放列表：普通标签保持')
  assertEqual(
    media.rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE', playlistBase, 7),
    '#EXTM3U\n#EXT-X-KEY:METHOD=NONE',
    '播放列表：无 URI 标签不改变',
  )
  assert(
    media.rewritePlaylist('#EXTM3U\nhttps://cdn.example.com/a.ts', playlistBase, 7)
      .includes('/proxy/7/__lw_media__/https/cdn.example.com/a.ts'),
    '播放列表：已同源绝对地址也映射',
  )

  assertEqual(
    media.mediaReferer('https://lineweb.test/proxy/7/watch/1?x=1', 'https://example.com', 7),
    'https://example.com/watch/1?x=1',
    '媒体 Referer：页面地址还原上游',
  )
  assertEqual(
    media.mediaReferer('https://lineweb.test/proxy/7/__lw_media__/https/cdn.com/a.ts', 'https://example.com', 7),
    'https://example.com/',
    '媒体 Referer：媒体路径退回站点根',
  )
  assertEqual(media.mediaReferer(undefined, 'https://example.com', 7), 'https://example.com/', '媒体 Referer：缺省站点根')

  const imageCtx = { ...ctx, siteId: 7 }
  assertEqual(
    proxy.mapMediaUrl('https://cdn.example.com/movie.mp4?sign=1', imageCtx),
    '/proxy/7/__lw_media__/https/cdn.example.com/movie.mp4?sign=1',
    '媒体 URL：跨域绝对地址走媒体代理',
  )
  assertEqual(
    proxy.mapMediaUrl('//cdn.example.com/live.m3u8', imageCtx),
    '/proxy/7/__lw_media__/https/cdn.example.com/live.m3u8',
    '媒体 URL：协议相对地址走媒体代理',
  )
  assertEqual(proxy.mapMediaUrl('/video.mp4', imageCtx), '/proxy/7/__lw_media__/https/example.com/video.mp4', '媒体 URL：根路径按站点源站解析')
  assertEqual(proxy.mapMediaUrl('https://example.com/video.mp4', imageCtx), '/proxy/7/__lw_media__/https/example.com/video.mp4', '媒体 URL：同站绝对地址也走媒体代理')
  assertEqual(proxy.mapMediaUrl('seg-1.ts', imageCtx), 'seg-1.ts', '媒体 URL：相对地址保持')
  const pageCtx = { ...imageCtx, pageUrl: 'https://example.com/watch/1.html' }
  assertEqual(
    proxy.mapMediaUrl('media/rabbit.mp4', pageCtx),
    '/proxy/7/__lw_media__/https/example.com/watch/media/rabbit.mp4',
    '媒体 URL：相对媒体文件按页面地址解析',
  )
  assertEqual(proxy.mapMediaUrl('app.js', pageCtx), 'app.js', '媒体 URL：相对非媒体文件保持')
  assertEqual(proxy.mapMediaUrl('/proxy/7/__lw_media__/https/cdn.com/a.ts', imageCtx), '/proxy/7/__lw_media__/https/cdn.com/a.ts', '媒体 URL：已映射地址保持')
  assertEqual(proxy.mapMediaUrl('blob:https://lineweb.test/abc', imageCtx), 'blob:https://lineweb.test/abc', '媒体 URL：blob 保持')

  const mediaHtml = proxy.rewriteHtml(
    [
      '<html><head></head><body>',
      '<video src="https://cdn.example.com/movie.mp4" poster="/poster.jpg"><source src="//cdn.example.com/a.m3u8"></video>',
      '<video src="/local.mp4"></video>',
      '<audio src="https://cdn.example.com/b.mp3"></audio>',
      '<img src="https://cdn.example.com/p.png">',
      '</body></html>',
    ].join(''),
    ctx,
    { cookies: [] },
  )
  assert(mediaHtml.includes('<video src="/proxy/7/__lw_media__/https/cdn.example.com/movie.mp4"'), 'HTML 媒体：video 跨域 src')
  assert(mediaHtml.includes('poster="/proxy/7/poster.jpg"'), 'HTML 媒体：poster 仍走普通反代')
  assert(mediaHtml.includes('<source src="/proxy/7/__lw_media__/https/cdn.example.com/a.m3u8"'), 'HTML 媒体：source 协议相对')
  assert(mediaHtml.includes('<video src="/proxy/7/__lw_media__/https/example.com/local.mp4"'), 'HTML 媒体：同站 video 也走媒体代理')
  assert(mediaHtml.includes('<audio src="/proxy/7/__lw_media__/https/cdn.example.com/b.mp3"'), 'HTML 媒体：audio 跨域 src')
  assert(
    mediaHtml.includes('<img src="/proxy/7/https/cdn.example.com/p.png"'),
    'HTML 媒体：同族子域图片走内嵌主机反代',
  )
  assert(
    mediaHtml.includes('<video src="/proxy/7/__lw_media__/https/cdn.example.com/movie.mp4"'),
    'HTML 媒体：媒体地址仍走媒体代理',
  )

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
  assert(out.includes('<base href="/proxy/7/">'), 'HTML 重写：<base> 改写为同源前缀')
  assert(!/content-security-policy/i.test(out), 'HTML 重写：剥离 meta CSP')
  assert(!out.includes('integrity='), 'HTML 重写：剥离 integrity')
  assert(out.includes('src="/proxy/7/app.js"'), 'HTML 重写：脚本 src')
  assert(out.includes('href="/proxy/7/site.css"'), 'HTML 重写：样式表 href')
  assert(out.includes('href="/proxy/7/docs"'), 'HTML 重写：链接 href')
  assert(out.includes('action="/proxy/7/search"'), 'HTML 重写：表单 action')
  assert(out.includes('src="/proxy/7/logo.png"'), 'HTML 重写：协议相对 img')
  assert(
    out.includes('srcset="/proxy/7/small.png 1x, /proxy/7/__lw_res__/https/cdn.com/big.png 2x"'),
    'HTML 重写：srcset 同源直连 + 跨域走资源代理',
  )
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
  assert(boot.includes("var MEDIA_PREFIX=PREFIX+'/__lw_media__/'"), '引导脚本：媒体代理前缀')
  assert(boot.includes('function mapMediaUrl'), '引导脚本：媒体 URL 映射')
  assert(boot.includes('function mapAbsUrl'), '引导脚本：绝对 URL 统一映射（档案优先）')
  assert(boot.includes('if(isMediaFile(u))return toMediaPath(u)'), '引导脚本：fetch/XHR 媒体后缀走媒体代理')
  assert(boot.includes('function profileClass'), '引导脚本：档案主机分类')
  assert(boot.includes('function hitMediaPattern'), '引导脚本：无扩展名媒体路径匹配')
  assert(boot.includes("defineProperty(HTMLMediaElement.prototype,'src'"), '引导脚本：media.src 改写')
  assert(boot.includes("defineProperty(sourceProto,'src'"), '引导脚本：source.src 改写')
  assert(boot.includes("defineProperty(HTMLScriptElement.prototype,'src'"), '引导脚本：script.src 改写')
  assert(boot.includes("defineProperty(HTMLIFrameElement.prototype,'src'"), '引导脚本：iframe.src 改写')
  assert(boot.includes('Element.prototype.setAttribute=function'), '引导脚本：setAttribute 媒体补写')
  assert(boot.includes('mediaPrefix:MEDIA_PREFIX'), '引导脚本：全局标记暴露媒体前缀')
  assert(boot.includes('"desktop":false'), '引导脚本：默认跟随设备 UA')
  assert(boot.includes('toEmbeddedPath'), '引导脚本：内嵌主机映射函数')
  assert(boot.includes('URLSearchParams'), '引导脚本：查询参数重映射')
  assert(boot.includes('"family":""'), '引导脚本：默认无站点族')
  assert(boot.includes('"pageOrigin":"https://example.com"'), '引导脚本：默认页面来源为站点源')

  const familyBoot = bootstrap.buildBootstrapScript({
    siteId: 7,
    origin: 'https://www.example.com',
    pageOrigin: 'https://passport.example.com',
    family: 'example.com',
    cookies: [],
  })
  assert(familyBoot.includes('"family":"example.com"'), '引导脚本：站点族注册域注入')
  assert(familyBoot.includes('"pageOrigin":"https://passport.example.com"'), '引导脚本：兄弟子域页面来源注入')

  const desktopBoot = bootstrap.buildBootstrapScript({
    siteId: 7,
    origin: 'https://example.com',
    cookies: [],
    forceDesktop: true,
    desktopUserAgent: 'UA-TEST',
  })
  assert(desktopBoot.includes('"desktop":true'), '引导脚本：桌面模式标记')
  assert(desktopBoot.includes('"ua":"UA-TEST"'), '引导脚本：桌面 UA 注入')
  assert(desktopBoot.includes("defineProperty(navigator,'userAgent'"), '引导脚本：navigator.userAgent 伪装')
  assert(desktopBoot.includes("defineProperty(navigator,'userAgentData'"), '引导脚本：navigator.userAgentData 伪装')
  assert(desktopBoot.includes('forceDesktop:!!cfg.desktop'), '引导脚本：全局标记暴露桌面模式')

  const desktopHtml = proxy.rewriteHtml('<html><head></head><body></body></html>', { ...ctx, forceDesktop: true }, { cookies: [] })
  assert(desktopHtml.includes('"desktop":true'), 'HTML 重写：桌面模式传入引导脚本')

  // 兄弟子域文档：注入脚本携带页面真实来源与站点族
  const siblingHtml = proxy.rewriteHtml(
    '<html><head></head><body><a href="/oauth">登录</a></body></html>',
    { ...ctx, activeOrigin: 'https://passport.example.com' },
    { cookies: [] },
  )
  assert(siblingHtml.includes('"pageOrigin":"https://passport.example.com"'), 'HTML 重写：兄弟子域文档注入页面来源')
  assert(siblingHtml.includes('"family":"example.com"'), 'HTML 重写：注入站点族注册域')
  assert(siblingHtml.includes('href="/proxy/7/https/passport.example.com/oauth"'), 'HTML 重写：兄弟子域根相对链接走内嵌主机')

  // ============================================================
  // 6.5 站点档案（抖音 / B 站多域名生态）
  // ============================================================
  const biliProfile = profiles.profileForOrigin('https://www.bilibili.com')
  const dyProfile = profiles.profileForOrigin('https://www.douyin.com')
  assert(!!biliProfile && biliProfile.id === 'bilibili', '档案：B 站命中')
  assert(!!dyProfile && dyProfile.id === 'douyin', '档案：抖音命中')
  assert(profiles.profileForOrigin('https://example.com') === null, '档案：通用站点无档案')
  assert(profiles.classifyProfileHost(dyProfile!, 'lf-douyin-pc.douyinpic.com') === 'resource', '档案：抖音静态域→资源')
  assert(profiles.classifyProfileHost(dyProfile!, 'v26-web.douyinvod.com') === 'media', '档案：抖音视频域→媒体')
  assert(profiles.classifyProfileHost(dyProfile!, 'ttwid.bytedance.com') === 'page', '档案：ttwid 域→page')
  assert(profiles.classifyProfileHost(dyProfile!, 'webcast.amemv.com') === 'page', '档案：直播 WS 域→page')
  assert(profiles.classifyProfileHost(biliProfile!, 'upos-sz-mirrorcos.bilivideo.com') === 'media', '档案：B 站视频域→媒体')
  assert(profiles.classifyProfileHost(biliProfile!, 'i0.hdslb.com') === 'resource', '档案：B 站图床→资源')
  assert(profiles.classifyProfileHost(dyProfile!, 'evil.com') === null, '档案：无关域不命中')
  assert(
    profiles.isProfileMediaPath(dyProfile!, new URL('https://www.douyin.com/aweme/v1/play/?video_id=v0d&ratio=1080p')),
    '档案：抖音无扩展名播放路径命中媒体',
  )
  assert(!profiles.isProfileMediaPath(dyProfile!, new URL('https://www.douyin.com/aweme/v1/web/feed/')), '档案：信息流接口不算媒体')

  // 档案驱动的 URL 重写
  const dyCtx = { siteId: 7, siteOrigin: 'https://www.douyin.com', activeOrigin: 'https://www.douyin.com', profile: dyProfile }
  assertEqual(
    proxy.mapUrlToProxy('https://ttwid.bytedance.com/ttwid/union/register/', dyCtx),
    '/proxy/7/https/ttwid.bytedance.com/ttwid/union/register/',
    '档案重写：ttwid 接口走内嵌主机',
  )
  assertEqual(
    proxy.mapUrlToProxy('https://www.douyin.com/aweme/v1/play/?video_id=v0d', dyCtx),
    '/proxy/7/__lw_media__/https/www.douyin.com/aweme/v1/play/?video_id=v0d',
    '档案重写：同站无扩展名播放路径走媒体代理',
  )
  assertEqual(
    proxy.mapUrlToProxy('https://p3-pc.douyinpic.com/img/cover.jpeg', dyCtx),
    '/proxy/7/__lw_res__/https/p3-pc.douyinpic.com/img/cover.jpeg',
    '档案重写：抖音图床走资源代理',
  )
  assertEqual(
    proxy.mapResourceUrl('https://v26-web.douyinvod.com/video/tos/cn/tos-cn-ve-15/o0.mp4', dyCtx),
    '/proxy/7/__lw_media__/https/v26-web.douyinvod.com/video/tos/cn/tos-cn-ve-15/o0.mp4',
    '档案重写：抖音视频 CDN 走媒体代理',
  )
  assertEqual(
    proxy.mapWsUrlToProxy('wss://webcast.amemv.com/webcast/im/push/v2/', dyCtx, 'lineweb.test', true),
    'wss://lineweb.test/proxy-ws/7/https/webcast.amemv.com/webcast/im/push/v2/',
    '档案重写：抖音直播 WS 走中继',
  )
  const biliCtx = { siteId: 7, siteOrigin: 'https://www.bilibili.com', activeOrigin: 'https://www.bilibili.com', profile: biliProfile }
  assertEqual(
    proxy.mapResourceUrl('https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/a/b.m4s', biliCtx),
    '/proxy/7/__lw_media__/https/upos-sz-mirrorcos.bilivideo.com/upgcxcode/a/b.m4s',
    '档案重写：B 站视频切片走媒体代理',
  )
  // 通用站点不受档案影响（同站媒体仍走普通前缀，与旧版一致）
  assertEqual(proxy.mapUrlToProxy('https://example.com/a.mp4', ctx), '/proxy/7/a.mp4', '档案：通用站点同站媒体保持普通前缀')

  // 档案注入引导脚本
  const dyBoot = bootstrap.buildBootstrapScript({
    siteId: 7,
    origin: 'https://www.douyin.com',
    cookies: [],
    hostRules: { page: dyProfile!.pageHosts, res: dyProfile!.resourceHosts, media: dyProfile!.mediaHosts },
    mediaPatterns: dyProfile!.mediaPathPatterns.map((re) => re.source),
  })
  assert(dyBoot.includes('"hostRules"'), '引导脚本：档案主机规则注入')
  assert(dyBoot.includes('ttwid.bytedance.com') || dyBoot.includes('bytedance.com'), '引导脚本：ttwid 域在 page 规则')
  assert(dyBoot.includes('"mediaPatterns"'), '引导脚本：媒体路径模式注入')
  const dyHtml = proxy.rewriteHtml('<html><head></head><body></body></html>', dyCtx, { cookies: [] })
  assert(dyHtml.includes('"hostRules"'), 'HTML 重写：档案随引导脚本注入')

  // 跨域 Set-Cookie（ttwid）：档案放松 vs 通用严格
  const ttwidUrl = new URL('https://ttwid.bytedance.com/ttwid/union/register/')
  const ttwidStrict = cookies.parseSetCookie('ttwid=1%7Cabc; Domain=.douyin.com; Path=/', ttwidUrl)!
  assertEqual(ttwidStrict.domain, 'ttwid.bytedance.com', '跨域 Cookie：通用严格拒绝无关 Domain')
  assertEqual(ttwidStrict.hostOnly, true, '跨域 Cookie：严格模式保持 hostOnly')
  const ttwidTrusted = cookies.parseSetCookie('ttwid=1%7Cabc; Domain=.douyin.com; Path=/', ttwidUrl, dyProfile!.pageHosts)!
  assertEqual(ttwidTrusted.domain, 'douyin.com', '跨域 Cookie：档案放松接受生态内 Domain')
  assertEqual(ttwidTrusted.hostOnly, false, '跨域 Cookie：放松后非 hostOnly')
  const ttwidEvil = cookies.parseSetCookie('x=1; Domain=evil.com; Path=/', ttwidUrl, dyProfile!.pageHosts)!
  assertEqual(ttwidEvil.domain, 'ttwid.bytedance.com', '跨域 Cookie：档案外域仍拒绝')
  assert(
    cookies.cookieHeaderForUrl([ttwidTrusted], new URL('https://www.douyin.com/aweme/v1/web/feed/')).includes('ttwid=1%7Cabc'),
    '跨域 Cookie：ttwid 可发往抖音接口',
  )

  // Referer 防盗链规则
  assertEqual(hosts.refererRuleForHost('v26-web.douyinvod.com')?.referer, 'https://www.douyin.com/', 'Referer：抖音视频 CDN')
  assertEqual(hosts.refererRuleForHost('p3-pc.douyinpic.com')?.referer, 'https://www.douyin.com/', 'Referer：抖音图床')
  assertEqual(hosts.refererRuleForHost('upos-sz-mirrorcos.bilivideo.com')?.referer, 'https://www.bilibili.com/', 'Referer：B 站视频 CDN')
  assert(hosts.refererOverrideFor('v26-web.douyinvod.com', 'https://web.linetech.online/proxy/7/') !== null, 'Referer：LineWeb 来源触发改写')
  assert(hosts.refererOverrideFor('v26-web.douyinvod.com', 'https://www.douyin.com/video/1') === null, 'Referer：抖音来源保持原样')

  // ============================================================
  // 6.6 响应体改写（JSON / JSONP / 内联 / RENDER_DATA / DASH）
  // ============================================================
  const dyMap = (v: string) => proxy.mapUrlToProxy(v, dyCtx)
  const playurl = JSON.stringify({
    code: 0,
    data: {
      dash: {
        video: [{ id: 80, baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/a/v.m4s', backupUrl: ['https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/a/v.m4s'] }],
        audio: [{ id: 30280, baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/a/a.m4s' }],
      },
    },
  })
  const biliMap = (v: string) => proxy.mapUrlToProxy(v, biliCtx)
  const playurlOut = JSON.parse(body.rewriteJsonBody(playurl, biliMap))
  assert(
    playurlOut.data.dash.video[0].baseUrl.startsWith('/proxy/7/__lw_media__/https/upos-sz-mirrorcos.bilivideo.com/'),
    'JSON 改写：playurl baseUrl 走媒体代理',
  )
  assert(
    playurlOut.data.dash.video[0].backupUrl[0].startsWith('/proxy/7/__lw_media__/'),
    'JSON 改写：backupUrl 数组逐项改写',
  )
  assertEqual(playurlOut.code, 0, 'JSON 改写：非 URL 字段保持')
  assertEqual(body.rewriteJsonBody('not json', dyMap), 'not json', 'JSON 改写：非法 JSON 原样返回')
  const dyFeed = JSON.stringify({ aweme_list: [{ video: { play_addr: { url_list: ['https://www.douyin.com/aweme/v1/play/?video_id=v0d&ratio=1080p'] }, cover: { url_list: ['https://p3-pc.douyinpic.com/img/c.jpeg'] } } }] })
  const dyFeedOut = JSON.parse(body.rewriteJsonBody(dyFeed, dyMap))
  assert(dyFeedOut.aweme_list[0].video.play_addr.url_list[0].startsWith('/proxy/7/__lw_media__/https/www.douyin.com/aweme/v1/play/'), 'JSON 改写：抖音 play_addr 走媒体代理')
  assert(dyFeedOut.aweme_list[0].video.cover.url_list[0].startsWith('/proxy/7/__lw_res__/https/p3-pc.douyinpic.com/'), 'JSON 改写：抖音封面走资源代理')
  // 未知第三方域保持
  const thirdParty = JSON.stringify({ u: 'https://other.com/a.mp4', t: 'hello' })
  assertEqual(JSON.parse(body.rewriteJsonBody(thirdParty, dyMap)).u, 'https://other.com/a.mp4', 'JSON 改写：档案外域保持')

  const jsonp = 'jQuery123({"url":"https://www.douyin.com/aweme/v1/play/?video_id=v0d"})'
  const jsonpOut = body.rewriteJsonpBody(jsonp, dyMap)
  assert(jsonpOut.startsWith('jQuery123(') && jsonpOut.includes('/proxy/7/__lw_media__/'), 'JSONP 改写：回调包裹保留 + 内部改写')
  assertEqual(body.rewriteJsonpBody('var x = 1', dyMap), 'var x = 1', 'JSONP 改写：非 JSONP 原样')

  const inlineHtml = '<html><head><script>window.__playinfo__={"data":{"dash":{"video":[{"baseUrl":"https://upos-sz-mirrorcos.bilivideo.com/v.m4s"}]}}}</script><script src="/app.js"></script></head><body></body></html>'
  const inlineOut = proxy.rewriteHtml(inlineHtml, biliCtx, { cookies: [] })
  assert(inlineOut.includes('/proxy/7/__lw_media__/https/upos-sz-mirrorcos.bilivideo.com/v.m4s'), '内联改写：__playinfo__ 媒体地址')
  assert(inlineOut.includes('src="/proxy/7/app.js"'), '内联改写：外链脚本仍走属性重写')

  const renderRaw = { aweme: { detail: { video: { playAddr: [{ src: 'https://www.douyin.com/aweme/v1/play/?video_id=v0d' }] } } } }
  const renderHtml = `<html><head><script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(renderRaw))}</script></head><body></body></html>`
  const renderOut = proxy.rewriteHtml(renderHtml, dyCtx, { cookies: [] })
  const renderMatch = /<script id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i.exec(renderOut)!
  const renderDecoded = JSON.parse(decodeURIComponent(renderMatch[1]))
  assert(renderDecoded.aweme.detail.video.playAddr[0].src.startsWith('/proxy/7/__lw_media__/'), 'RENDER_DATA：解码改写后回填')
  assert(renderOut.includes('RENDER_DATA'), 'RENDER_DATA：脚本保留')

  // DASH 清单改写
  const dashBase = new URL('https://cdn.example.com/dash/manifest.mpd')
  const dash = [
    '<?xml version="1.0"?>',
    '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">',
    '  <Period>',
    '    <BaseURL>https://cdn.example.com/dash/</BaseURL>',
    '    <AdaptationSet mimeType="video/mp4">',
    '      <SegmentTemplate initialization="init-$RepresentationID$.m4s" media="seg-$RepresentationID$-$Number$.m4s" startNumber="1"/>',
    '      <Representation id="v1" bandwidth="1000"/>',
    '    </AdaptationSet>',
    '    <AdaptationSet mimeType="audio/mp4">',
    '      <SegmentTemplate initialization="https://other.cdn.com/a/init.m4s" media="https://other.cdn.com/a/seg-$Number$.m4s"/>',
    '    </AdaptationSet>',
    '  </Period>',
    '  <Location>https://cdn.example.com/dash/manifest.mpd</Location>',
    '</MPD>',
  ].join('\n')
  const dashOut = media.rewriteDashManifest(dash, dashBase, 7)
  assert(dashOut.includes('<BaseURL>/proxy/7/__lw_media__/https/cdn.example.com/dash/</BaseURL>'), 'DASH：BaseURL 绝对地址改写')
  assert(dashOut.includes('initialization="init-$RepresentationID$.m4s"'), 'DASH：相对模板占位符保持')
  assert(dashOut.includes('media="seg-$RepresentationID$-$Number$.m4s"'), 'DASH：相对 media 模板保持')
  assert(dashOut.includes('initialization="/proxy/7/__lw_media__/https/other.cdn.com/a/init.m4s"'), 'DASH：绝对 initialization 改写')
  assert(dashOut.includes('media="/proxy/7/__lw_media__/https/other.cdn.com/a/seg-$Number$.m4s"'), 'DASH：绝对 media 模板改写（占位符保留）')
  assert(dashOut.includes('<Location>/proxy/7/__lw_media__/https/cdn.example.com/dash/manifest.mpd</Location>'), 'DASH：Location 改写')

  // ============================================================
  // 6.7 WebSocket over HTTP 桥：帧队列 + 引导脚本 polyfill
  // ============================================================
  const wsHttp = await import('../src/services/webProxyWsHttp.js')
  const FQ = wsHttp.FrameQueue
  const frame = (s: string, binary = false) => ({ data: Buffer.from(s).toString('base64'), binary })
  // push → poll 立即取批
  const q1 = new FQ()
  q1.push(frame('a'))
  q1.push(frame('b'))
  assertEqual((await q1.poll(50))!.length, 2, '桥队列：push 后 poll 取批')
  // poll 挂起 → push 唤醒
  const q2 = new FQ()
  const pending = q2.poll(2000)
  q2.push(frame('x'))
  assertEqual((await pending)!.map((f) => Buffer.from(f.data, 'base64').toString())[0], 'x', '桥队列：挂起 poll 被 push 唤醒')
  // poll 超时返回空批
  const q3 = new FQ()
  assertEqual((await q3.poll(20))!.length, 0, '桥队列：超时返回空批')
  // close 投递剩余帧 + closed 标志
  const q4 = new FQ()
  q4.push(frame('last'))
  q4.close(1001, 'bye')
  assertEqual((await q4.poll(50))!.length, 1, '桥队列：close 后仍可取剩余帧')
  assert(q4.closed && q4.closeCode === 1001, '桥队列：close 标志与 code')
  // 溢出 → 1011 关闭
  const q5 = new FQ(2, 1024)
  q5.push(frame('1'))
  q5.push(frame('2'))
  q5.push(frame('3'))
  assert(q5.closed && q5.closeCode === 1011, '桥队列：帧数溢出以 1011 关闭')
  // cancelPoll 提前结束挂起（不关闭会话）
  const q6 = new FQ()
  const cancelled = q6.poll(2000)
  q6.cancelPoll()
  assertEqual((await cancelled)!.length, 0, '桥队列：cancelPoll 结束挂起')
  assert(!q6.closed, '桥队列：cancelPoll 不关闭会话')

  // 引导脚本 polyfill 标记 + 整体语法可解析
  assert(boot.includes('LWWebSocket'), '引导脚本：WS polyfill 类')
  assert(boot.includes('WS_HTTP_PREFIX'), '引导脚本：WS HTTP 桥前缀')
  assert(boot.includes('_fallback'), '引导脚本：原生 WS 失败自动降级')
  assert(boot.includes('FORCE_WS_POLL'), '引导脚本：?lw_ws=poll 强制桥')
  assert(boot.includes('LWSSE'), '引导脚本：SSE polyfill')
  assert(boot.includes('window.WebSocket=LWWebSocket'), '引导脚本：安装 WS polyfill')
  // 用 new Function 解析（不执行）验证引导脚本无语法错误
  let bootSyntaxOk = true
  try { new Function(boot) } catch { bootSyntaxOk = false }
  assert(bootSyntaxOk, '引导脚本：整体语法可解析')
  let familySyntaxOk = true
  try { new Function(familyBoot) } catch { familySyntaxOk = false }
  assert(familySyntaxOk, '引导脚本：档案变体语法可解析')
  let desktopSyntaxOk = true
  try { new Function(desktopBoot) } catch { desktopSyntaxOk = false }
  assert(desktopSyntaxOk, '引导脚本：桌面变体语法可解析')

  // ============================================================
  // 6.8 兼容管线（compat 判定 / ES5 转译 / polyfill / legacy 注入）
  // ============================================================
  const compat = await import('../src/services/webProxyCompat.js')
  const transpile = await import('../src/services/webProxyTranspile.js')
  const polyfills = await import('../src/services/webProxyPolyfills.js')

  const oldAndroid = 'Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/30.0.0.0 Mobile Safari/537.36'
  const oldIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_3_5 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13G36 Safari/601.1'
  const modernChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const modernIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  assert(compat.isLegacyUserAgent(oldAndroid), 'compat：老 Android 判 legacy')
  assert(compat.isLegacyUserAgent(oldIOS), 'compat：老 iOS 判 legacy')
  assert(!compat.isLegacyUserAgent(modernChrome), 'compat：现代 Chrome 判 modern')
  assert(!compat.isLegacyUserAgent(modernIOS), 'compat：现代 iOS 判 modern')
  assert(!compat.isLegacyUserAgent(undefined), 'compat：无 UA 按 modern')
  assertEqual(compat.resolveCompatMode('auto', oldAndroid), 'legacy', 'compat：auto + 老 UA → legacy')
  assertEqual(compat.resolveCompatMode('auto', modernChrome), 'modern', 'compat：auto + 现代 UA → modern')
  assertEqual(compat.resolveCompatMode('legacy', modernChrome), 'legacy', 'compat：站点强制 legacy')
  assertEqual(compat.resolveCompatMode('modern', oldAndroid), 'modern', 'compat：站点强制 modern')
  assertEqual(compat.resolveCompatMode('auto', modernChrome, 'legacy'), 'legacy', 'compat：查询钩子优先')

  // ES5 转译：async/await + 箭头降级
  const es6 = 'const f = async (x) => { await g(x); return x + 1; }; class A { m() { return 1; } }'
  const es5 = transpile.transpileToEs5(es6)
  assert(!es5.includes('=>'), '转译：箭头函数已降级')
  assert(!/\basync\b/.test(es5), '转译：async 已降级')
  assert(es5.includes('regeneratorRuntime'), '转译：async 降级为 regenerator')
  assert(!/\bclass\b/.test(es5), '转译：class 已降级')
  // 缓存命中
  transpile.transpileToEs5(es6)
  assert(transpile.transpileCacheSize() >= 1, '转译：缓存生效')
  // 非法输入回退原文
  assertEqual(transpile.transpileToEs5('this is not valid js {{{'), 'this is not valid js {{{', '转译：失败回退原文')
  assertEqual(transpile.transpileToEs5(''), '', '转译：空输入原样')

  // polyfill bundle 可解析 + 关键 API
  let polyfillSyntaxOk = true
  try { new Function(polyfills.POLYFILL_BUNDLE) } catch { polyfillSyntaxOk = false }
  assert(polyfillSyntaxOk, 'polyfill：bundle 语法可解析')
  assert(polyfills.POLYFILL_BUNDLE.includes('regeneratorRuntime'), 'polyfill：内联 regenerator')
  assert(polyfills.POLYFILL_BUNDLE.includes('Promise'), 'polyfill：Promise')
  assert(polyfills.POLYFILL_BUNDLE.includes('fetch'), 'polyfill：fetch')
  assert(polyfills.POLYFILL_BUNDLE.includes('URLSearchParams'), 'polyfill：URLSearchParams')
  assertEqual(polyfills.polyfillPath(7), '/proxy/7/__lw_polyfill__.js', 'polyfill：路径')

  // legacy HTML：polyfill 先注入 + 内联脚本转译
  const legacyCtx = { ...ctx, compat: 'legacy' as const }
  const legacyHtml = proxy.rewriteHtml(
    '<html><head><script>const x = () => 1;</script></head><body></body></html>',
    legacyCtx,
    { cookies: [] },
  )
  assert(legacyHtml.includes('src="/proxy/7/__lw_polyfill__.js"'), 'legacy HTML：注入 polyfill')
  const polyfillAt = legacyHtml.indexOf('__lw_polyfill__.js')
  const bootAt = legacyHtml.indexOf('data-lineweb-proxy')
  assert(polyfillAt >= 0 && polyfillAt < bootAt, 'legacy HTML：polyfill 先于引导脚本')
  assert(!legacyHtml.includes('() => 1'), 'legacy HTML：内联箭头脚本已转译')
  assert(legacyHtml.includes('"compat":"legacy"'), 'legacy HTML：引导脚本携带 compat')
  // modern HTML 不注入 polyfill
  const modernHtml = proxy.rewriteHtml('<html><head></head><body></body></html>', ctx, { cookies: [] })
  assert(!modernHtml.includes('__lw_polyfill__.js'), 'modern HTML：不注入 polyfill')

  // ============================================================
  // 6.9 无 MSE 原生播放适配
  // ============================================================
  assert(boot.includes('lwBiliNoMse'), '播放适配：B 站 no-MSE 适配器')
  assert(boot.includes('lwDouyinNoMse'), '播放适配：抖音 no-MSE 适配器')
  assert(boot.includes('window.MediaSource'), '播放适配：MSE 检测门控')
  assert(boot.includes('fnval=1'), '播放适配：B 站 mp4 降级')
  assert(boot.includes('RENDER_DATA'), '播放适配：抖音读取 RENDER_DATA')
  const dyProfileBoot = bootstrap.buildBootstrapScript({ siteId: 7, origin: 'https://www.douyin.com', cookies: [], profileId: 'douyin', compat: 'legacy' })
  assert(dyProfileBoot.includes('"profileId":"douyin"'), '播放适配：profileId 注入')
  let playbackSyntaxOk = true
  try { new Function(dyProfileBoot) } catch { playbackSyntaxOk = false }
  assert(playbackSyntaxOk, '播放适配：抖音 legacy 变体语法可解析')

  // ============================================================
  // 6.10 字节 WAF "Please wait" 挑战服务端求解
  // ============================================================
  const waf = await import('../src/services/webProxyWaf.js')
  const { createHash } = await import('crypto')
  // 真实捕获的挑战串（服务端预选 i=7）
  const wafCs = 'eyJ2Ijp7ImEiOiJYbXYvV0t2cmd4VjM5ZzNRZHg0OXlOcGJ1L2habzN0N3psTytlY2lHU2JZPSIsImIiOjE3OTQ2NzI4MDQsImMiOiJNaFJYQjFhbEtLZVQ5bCtaT3lBRHBka0laaVRXemtVY1UxY1lJcHQzNzlFPSJ9LCJzIjoiWTVZQStraHYycWkrdkl6bXYxT1hoZlJNVDlNRzNOeExVUHZNQU9hd0tkUT0ifQ'
  const wafHtml = `<html><head><script src="https://lf-waf-js.byted-static.com/obj/waf-jschallenge/out-sha256.js"></script></head><body onload="readygo()"><script>var cs="${wafCs}";expect===s256(prefix,""+i)</script>Please wait...</body></html>`
  assert(waf.isWafChallenge(wafHtml), 'WAF：识别挑战页')
  assert(!waf.isWafChallenge('<html><body>normal page</body></html>'), 'WAF：正常页不误判')
  assertEqual(waf.extractWafChallenge(wafHtml), wafCs, 'WAF：提取 cs 挑战串')
  const wafCookie = waf.solveWafChallenge(wafCs)
  assert(!!wafCookie, 'WAF：PoW 求解成功')
  const wafDecoded = JSON.parse(Buffer.from(wafCookie!, 'base64').toString('utf8'))
  assertEqual(Buffer.from(wafDecoded.d, 'base64').toString('utf8'), '7', 'WAF：解为 i=7')
  const wafPrefix = Buffer.from(wafDecoded.v.a, 'base64')
  const wafExpect = Buffer.from(wafDecoded.v.c, 'base64').toString('hex')
  assertEqual(createHash('sha256').update(wafPrefix).update(Buffer.from('7', 'utf8')).digest('hex'), wafExpect, 'WAF：解答哈希与 expect 匹配')
  assertEqual(waf.solveWafChallenge('bm90LWpzb24'), null, 'WAF：非法挑战返回 null')
  assertEqual(waf.WAF_COOKIE_NAME, '_wafchallengeid', 'WAF：Cookie 名常量')
  // 档案补齐挑战域名
  assert(profiles.classifyProfileHost(dyProfile!, 'lf-waf-js.byted-static.com') === 'resource', 'WAF：挑战脚本域归资源类')
  assert(profiles.classifyProfileHost(dyProfile!, 'lf3-short.ibytedapm.com') === 'resource', 'WAF：Slardar 域归资源类')
  assert(profiles.classifyProfileHost(dyProfile!, 'mssdk.zijieapi.com') === 'page', 'WAF：风控接口域归 page 类')
  // 虚拟罐 Cookie 镜像（导航携带，破解 acrawler reload 死循环）
  assert(boot.includes('mirrorRealCookie'), 'Cookie 镜像：引导脚本含镜像函数')
  assert(boot.includes('__lwp_'), 'Cookie 镜像：命名空间前缀')
  assert(boot.includes('nativeCookieSet'), 'Cookie 镜像：捕获原生 cookie setter')
  let mirrorSyntaxOk = true
  try { new Function(boot) } catch { mirrorSyntaxOk = false }
  assert(mirrorSyntaxOk, 'Cookie 镜像：引导脚本语法可解析')

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
