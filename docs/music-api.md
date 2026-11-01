# 网易云音乐 API（/api/music）

> 2026-11-01 新增。前端 `/music` 页 + 全局迷你播放条（跨页持续播放）。
> 受 `music` 功能开关控制（`/admin/features`），管理员豁免开关与限流。

## 概览与实现口径

- 服务端以**库挂载**方式集成 [`@neteasecloudmusicapienhanced/api`](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（原 Binaryify/NeteaseCloudMusicApi 的社区维护分支，MIT）——函数级调用（`callNcmRaw`），**不起独立 HTTP 服务、不新增容器**。该包较重（axios/jsdom 等），已按需懒加载（首次调用时 import）。
- **解灰绝不启用**：本模块构造的 query 永不携带 `unblock` 参数（该包解灰仅在 `query.unblock === 'true'` 时触发）；生产 compose 另显式设 `ENABLE_GENERAL_UNBLOCK=false`、`ENABLE_PROXY=false` 双保险。
- **登录只做扫码**（`login_qr_key` → `login_qr_create` → `login_qr_check`）：账密登录风控最严，扫码是社区公认最稳路径。**不做签到/刷歌等自动化**。
- **cookie 只存服务端**（`MusicAccount.cookie`，含 MUSIC_U），任何响应不回传；上游返回 `code 301`（登录过期）时清除绑定并抛 `401 MUSIC_SESSION_EXPIRED`，前端引导重新扫码。
- 未绑定为**匿名态**（包内自动注入匿名 token）：可搜索、可播免费歌曲；VIP 歌只有 30 秒试听或无源（黑胶账号登录后可取完整/高音质）。
- **媒体地址统一升级为 https（重要）**：上游返回的封面 / 音频 / 头像地址大多是明文 `http://…music.126.net/…`。页面 CSP 的 `img-src` 只放行 `https:`，`http` 封面会被浏览器直接拦掉（线上现象：搜索结果「大多数封面无法显示」）。因此 `callNcmForUser` 返回前会把响应中所有网易 CDN（`*.music.126.net` / `*.126.net` / `*.127.net` / `*.netease.com`）的 http 地址递归升级为 https（`upgradeNcmMediaUrlsIn`），前端 `lib/music/song.ts` 的 `upgradeMediaUrl` 再做一层兜底（含 localStorage 里的旧队列）。
- **运行时自愈**：容器冷启动时启动例程里的匿名 token 注册可能失败并连带 xeapi 公钥缺失（`xeapi public key is missing`），此后 `song/url` 会一直 502（线上「无法听歌」的成因之一）。现在识别到这类初始化错误会重置并重跑一次启动例程再重试；匿名 token 过期（上游 `code 301` 且未绑定）同样重新注册后重试一次，只有**已绑定**账号的 301 才清绑定并抛 401。
- **音频默认直连、可经服务器中转**：`song/url/v1` 返回网易 CDN 直链，浏览器直连播放（helmet CSP 已加 `mediaSrc 'self' https: http:`）；封面由 `imgSrc https:` 覆盖（配合上面的 https 升级）。部分设备/网络**无法直连网易云 CDN**（`m*.music.126.net` / `p*.music.126.net`），此时前端自动改走 `/api/music/stream`（音频，支持 Range/seek）与 `/api/music/image`（封面）由服务器中转，并在本设备记住偏好（localStorage `lineweb_music_stream_proxy`，播放器里可手动改回直连）。健康设备仍然零额外带宽；中转会消耗 ECS 出网流量。
- **VIP 试听**：非黑胶账号请求会员歌曲时，上游返回的是 30–45 秒试听片段，并带 `freeTrialInfo: { start, end }`；前端据此显示「试听片段」标记与提示，而不是把它当成播放失败。
- 全部端点需登录令牌（应用令牌 403）。NCM 资源 ID 为纯数字长串，一律以字符串传递。

## 表

- `MusicAccount`（music_accounts）：`user_id @unique`、`cookie`（敏感，不回传）、`nickname`、`avatar_url`、`logged_in_at`

## 端点与限流（每用户 5min，管理员豁免）

| 方法 | 路径 | 限流 | 说明 |
|------|------|------|------|
| GET | `/api/music/status` | — | 绑定状态 `{ bound, nickname, avatarUrl }` |
| GET | `/api/music/login/qr/prepare` | 10 | 生成二维码 `{ key, qrimg }`（qrimg 为 base64 data URL） |
| GET | `/api/music/login/qr/check?key=` | 240 | 轮询扫码状态：`code` 800 过期 / 801 待扫 / 802 已扫待确认 / **803 成功（此时完成绑定，响应含 `account`）**。建议前端 1.5s 一次 |
| POST | `/api/music/logout` | 120 | 解绑（删行） |
| GET | `/api/music/search?keywords=&type=&limit=&offset=` | 60 | 搜索（keywords 1–80 字；type：1 单曲（默认）/ 10 专辑 / 1000 歌单；limit ≤30） |
| GET | `/api/music/song/url?id=&level=` | 120 | 播放地址 `{ data: [{ url, level, type, fee, time, freeTrialInfo }] }`；level 白名单 `standard/higher/exhigh/lossless/hires`（默认 exhigh；非黑胶由上游自动降级）。`freeTrialInfo` 非 null 表示这是 VIP 试听片段 |
| GET | `/api/music/stream?id=&level=&token=` | 600 | 音频中转：解析同一首歌的可播放地址后由服务器流式转发（透传 `Range`/`If-Range`，返回 200/206 + `Content-Range`/`Accept-Ranges`；`?token=` 供 `<audio>` 直链）。地址只来自 NCM 响应并校验网易 CDN 域名白名单，5 分钟内存缓存 |
| GET | `/api/music/image?u=&token=` | 600 | 封面中转：只代理网易云 CDN 图片（白名单校验，重定向逐跳复核），`cache-control: private, max-age=86400` |
| GET | `/api/music/lyric?id=` | 120 | 歌词 `{ lrc, tlyric }`（`lyric_new`，含翻译） |
| GET | `/api/music/recommend/songs` | 120 | 每日推荐（**需绑定**，否则 400 `MUSIC_NOT_BOUND`） |
| GET | `/api/music/toplist` | 120 | 官方排行榜列表 `{ list: [{ id, name, updateFrequency, coverImgUrl }] }` |
| GET | `/api/music/playlist/:id/tracks?limit=&offset=` | 120 | 歌单/榜单曲目（limit ≤100） |

搜索/歌词/榜单/歌单响应为 NCM 原始 JSON 透传（前端 `lib/music/song.ts` 归一化 `ar/al/dt` 与旧字段 `artists/album/duration`）。

## 错误码

- `400` 参数无效 / `MUSIC_NOT_BOUND`（未绑定却调需登录的端点）
- `401` `MUSIC_SESSION_EXPIRED`（cookie 失效，绑定已清除，需重新扫码）
- `502` NCM 接口调用失败；`504` 上游超时（15s）；中转端点另有 `MUSIC_MEDIA_UNAVAILABLE`（上游媒体不可用）/ `MUSIC_BAD_MEDIA_URL`（媒体地址不在白名单）/ `404 MUSIC_NO_SOURCE`（无音源）
- 中转端点不在全局 API 限流内（`apiLimiterSkipPaths`），由路由内 600 次/5min/用户限流接管（管理员豁免）

## 风险与合规提示

逆向官方接口属灰色地带（网易 2024 年曾发律师函致原仓库删库）。本项目已按社区低风险姿势实现：不解灰、只扫码、不做自动化、低频调用、服务端固定出口 IP。**仅供个人站内自用**。前端登录卡含风控风险提示文案。

## 自检

`cd server && npx tsc --noEmit`（服务层为薄代理，纯逻辑在客户端 `client/src/lib/music/__tests__/song.test.ts`：字段归一化 / LRC 解析 / 时长格式化）；链路冒烟见 AGENTS.md「本地冒烟」。
