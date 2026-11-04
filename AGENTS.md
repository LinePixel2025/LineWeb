# LineWeb — 项目知识库

**生成时间：** 2026-10-24
**提交：** f434518
**分支：** master

## 概述

个人网站/CMS 单体仓库，Apple 风格（macOS/iOS 视觉语言）的纯 CSS 前端设计系统（`.gh-*` 为历史命名空间，取值已切换为 Apple 体系）。React 19 SPA 前端，Express 4 REST API 后端，Python 3 WebSocket 文件存储节点，以及打包为 exe 的 LineWeb CLI 本地管理工具。SQLite 仅用于本地开发，生产为 PostgreSQL 16。功能：文章/评论、动态页面构建器、网盘、计算器、屏幕时间追踪（数字健康卡片，含电脑使用热力图）、AI 助手、**DeepSeek 对话（站内统一代理的多会话 AI 聊天：SSE 流式回复、图片/拍照提问、联网搜索支持 DeepSeek 官方搜索 / 博查 / Tavily、每用户每日提问上限由管理员设置，与首页 AI 助手配置相互独立）**、头像裁剪上传、用户名登录、**私信（2026-10-31 起完全自建：好友/群聊、图片与表情、引用回复、合并/逐条转发聊天记录、5 分钟撤回、已读回执、@、拍一拍、群公告、置顶与备注，全部落 Prisma 无外部依赖，WS/长轮询双通道；原 neko XMPP 接入与全员大厅已移除）**、**游戏大厅（2048、斗地主、贪吃蛇、扫雷、跳一跳、我的世界、五子棋、骗子酒馆、UNO、中国象棋、霓虹跑酷（3D 三车道），均支持对应单机 / 好友联机与无 WebSocket 轮询降级）**、**宠物（2026-10-31 起新增：花积分召唤一只 2D 小宠物——猫/狗/鸟，喂食洗澡玩耍、攒钱换装升级解锁更多动作，冷落太久会离家出走）**、**小说阅读器（2026-11-01 起新增：上传 EPUB/TXT 在线阅读——EPUB 用 vendored foliate-js 渲染、TXT 前端编码检测+正则分章，书架与 CFI/章节进度多端同步，文件计入网盘配额）**、**网易云音乐（2026-11-01 起新增：@neteasecloudmusicapienhanced/api 库挂载进 Express 进程、解灰显式关闭，每用户扫码绑定个人账号 cookie 仅存服务端，搜索/每日推荐/排行榜/歌词/播放，音频默认直连网易 CDN、直连失败自动经 `/api/music/stream` 服务器中转，封面同理走 `/api/music/image`）**、PWA。**部署：阿里云 ECS（Ubuntu，公网 IP `120.24.223.65`）上用 1Panel + Docker Compose 部署：Express :3001 容器 + PostgreSQL 16 容器，公网入口为 IP 直连 `http://120.24.223.65:8780`（宿主 8780 → 容器 3001；2026-10-31 起 Cloudflare Tunnel 已整体移除、不再使用任何域名，纯 HTTP 无 HTTPS）；存储节点运行在外部机器（容器日志实测自 `58.253.109.135` 直连接入），主动外连服务端；本地 Windows 全栈仍为开发/备用方案。**

## 目录结构

```
lineweb/
├── client/           # React 19 + Vite 6 SPA → 开发端口 5173，生产从 dist/ 提供
├── server/           # Express 4 + Prisma 6 API → 端口 3001，tsx 运行时，.js 导入后缀
├── storage-node/     # Python 3 WebSocket 文件存储客户端（10 个命令）→ D:/LineWebDrive，仅本地
├── cli/              # LineWeb CLI 本地管理工具（TS + esbuild + pkg → LineWebCLI.exe，v2.1.0）
├── scripts/          # 14 个运维脚本（部署、开发启动/停止、webhook、截图、屏幕时间推送）
├── docs/             # 登录认证接入（auth-api.md）、第三方应用授权（app-auth-api.md）、聊天 API（chat-api.md）、游戏 API（game-api.md）、AI 对话 API（ai-chat-api.md）、搜打撤 v2 API（raid-api.md）、API 参考、Drive 部署指南、屏幕时间 API 指南、健康系统 API 指南、ECS 部署指南（DEPLOYMENT_HTTP_3001.md）
├── .omo/             # OpenCode 会话续传数据
├── .trae/            # Trae IDE 配置、项目规则
├── .superpowers/     # SDD 任务产物
├── .codegraph/       # 代码图谱分析数据库
├── .agents/          # 代理技能定义（pdf）
├── .lineweb-cli/     # CLI 运行时数据（已 gitignore）
│
├── package.json      # 单体仓库根 — concurrently 编排 client + server；build:cli 构建 CLI
├── CLAUDE.md         # 用户维护的 Claude Code 指令文件（已 gitignore，与 AGENTS.md 并存）
├── ecosystem.config.js # 备选/存档：PM2 直跑 Node/tsx 的配置（生产不用；cwd 指向 /opt/lineweb）
├── Dockerfile        # 生产使用：Docker 镜像（入口脚本 docker-entrypoint.sh 把 SQLite schema 改写为 PostgreSQL 后 db push + seed）
├── docker-compose.yml # 生产使用：容器编排（Docker Compose + PostgreSQL 16；Docker 与 1panel-network 由 1Panel 提供）
├── nginx.conf        # 备选：Nginx 反向代理配置（仅启用域名 + HTTPS 后使用）
└── .npmrc            # 中文 npm 镜像

> 生产部署主线：阿里云 ECS（Ubuntu，`/opt/lineweb`）+ 1Panel + Docker Compose（Express 容器 + PostgreSQL 16 容器）；systemd 直跑 tsx 与旧宝塔 PM2 路径均已作废，仅存档。
> 原 `.github/workflows/deploy.yml`（云服务器自动部署）已删除，如需 CI 需重建；`.github/` 目录仅剩默认配置。
```

### 子项目 AGENTS.md

| 目录 | AGENTS.md | 覆盖内容 |
|-----------|-----------|----------|
| `client/` | ✅ | 路由、Context、网盘模块、数据获取、测试、反模式 |
| `server/` | ✅ | 中间件链、路由、服务、认证流程、反模式 |
| `storage-node/` | ✅ | WebSocket 协议、10 个命令、安全、配置 |
| `cli/` | ❌（有 `cli/README.md`） | setup/start/stop/restart/status/update/logs/token 命令、autoupdate（S4U）、pkg 构建 |

> 注意：子项目 AGENTS.md 部分内容已过期（如 server 仍提 bing.ts、client 仍提 WallpaperContext），以本文件为准。

## 哪里找

| 跨模块关注点 | 位置 | 说明 |
|----------------------|----------|-------|
| 单体仓库编排 | `package.json` | `concurrently` 同时运行前后端；`postinstall` 级联安装子目录依赖 |
| 部署方式 | 阿里云 ECS（Ubuntu，`120.24.223.65`）+ 外部存储节点 | 生产由 **1Panel v2.3.2 + Docker Compose** 部署，代码在 `/opt/lineweb`：应用是 compose 项目 `lineweb`（容器 `lineweb-server-1`，由仓库根 `docker-compose.yml` + `Dockerfile` 构建，对外端口 `8780`（宿主 8780 → 容器 3001），`restart: unless-stopped`，自带健康检查），数据库是 PostgreSQL 16 容器 `lineweb-postgres`；1Panel 面板在 `http://120.24.223.65:18080/lineweb_panel`（安装目录 `/opt/1panel`，**继续用 IP 访问，不要绑定域名**）；公网入口为 **IP 直连 `http://120.24.223.65:8780`**（唯一入口，纯 HTTP；2026-10-31 起 **Cloudflare Tunnel 已整体移除**——`cloudflared` 服务/二进制/`/etc/cloudflared` 均已删除，不再使用任何域名，HTTPS 与自定义域名能力随之放弃）；**阿里云安全组实测放行 `22`、`18080`、`8780`（`3001` 公网入口已收紧关闭）**；存储节点运行在外部机器（容器日志实测自 `58.253.109.135` 主动外连接入，规范地址 `ws://120.24.223.65:8780/ws/storage`），因此节点侧无需公网 IP；**服务器直连 GitHub 极慢/不可达，`git fetch + git reset --hard` 在服务器上跑不通**，更新需走镜像/代理或从本地机器 `git push` 到服务器（本地 push → 服务器裸仓 `/root/lineweb-deploy.git` → `/opt/lineweb` fetch + reset）。备选/存档：systemd 直跑 tsx、PM2（`ecosystem.config.js`）、Nginx 反代（`nginx.conf`）、Railway（`docs/DRIVE_SETUP.md` 第 1 章）；本地 Windows 全栈仍为开发/备用 |
| 数据库结构 | `server/prisma/schema.prisma` | **53 个模型**（此处仅列早期核心 21 个，其余为后续 additive 增量、见 schema：`FeatureFlag`、`GameStat`、`ChatContactSetting`、`SiteAnnouncement`/`SiteSetting`、`PointsLedger`/`PointsConfig`/`PointsShopItem`/`UserPointsItem`、`Farm`/`FarmPlot`/`FarmItem`/`FarmSteal`/`FarmMerchantOffer`、`DailyCheckin`、`GameLeaderTitle`、`ChatBan`、`StockHolding`、`Pet`/`PetOutfit`、`PersonalSpace`、`Book`/`BookProgress`、`MusicAccount`、`RedPacket`/`RedPacketClaim` 等）：User、Post、Comment、Page、DriveFile、DriveFavorite、ScreenTimeLog、AiConfig、AiChatConfig、AiConversation、AiMessage、AiChatImage（AI 对话）、OAuthClient、OAuthGrant、OAuthCode、OAuthRefreshToken、Friendship、FriendRequest、Conversation、ConversationMember、Message（`ApiKey`、`ScreenTimeToken` 已随统一登录移除）；`User.storageQuota` 为网盘空间上限（BigInt，默认 2 GiB）；**本地开发用 SQLite**，**生产为 PostgreSQL 16**（容器 `lineweb-postgres`，基于 `postgres:16-alpine`，挂在 `1panel-network` 上，数据卷 `lineweb-pg-data`） |
| 数据库连接池 | `server/src/lib/prisma.ts` | Prisma 单例；生产（PostgreSQL 16）在 `DATABASE_URL` 上注入 `connection_limit=10&pool_timeout=30`（由 `DATABASE_POOL_SIZE`/`DATABASE_POOL_TIMEOUT` 控制，默认 10/30）；本地 SQLite 单文件无连接池 |
| 认证（账号登录令牌） | `server/src/middleware/auth.ts` | **账号凭证**：`POST /api/auth/login` 换取 JWT（`Authorization: Bearer`，下载直链兼容 `?token=`）；**13 个公开路径**在 `index.ts` 白名单；新增公开端点必须同步改白名单；`optionalAuthenticate`（有 token 则解析、无则匿名放行，用于 AI chat；应用令牌与下载票据按游客处理） |
| 第三方应用授权 | `server/src/routes/oauth.ts` + `services/oauthService.ts` | **OAuth 2.0 授权码 + PKCE（强制 S256）**：管理员在 `/admin/apps` 注册应用取得 `client_id`（机密客户端另有 `client_secret`，仅返回一次）；第三方应用跳转前端 `/authorize` 让用户确认授权（`AuthorizePage.tsx`），授权码 5 分钟且一次性核销（防重放），换得 `access_token`(1h) + `refresh_token`(30d，每次刷新轮换，重放即吊销整条授权)；撤销入口在个人资料页 |
| 应用令牌（scope） | `server/src/lib/appScopes.ts` | **scope 与端点白名单的唯一真相源**：9 个 scope（`profile:read`、`content:read`、`comment:write`、`health:read/write`、`drive:read/write`、`content:write`、`comment:moderate`）；`APP_ENDPOINT_RULES` 是应用令牌唯一可达的 API 面，**未列入一律 403**（`/api/users`、`/api/devices`、`/api/stats`、`/api/ai/config`、`/api/oauth/*`、`/api/auth/logout|profile|settings` 等永不可达）；应用令牌 `role:'app'`（未知角色 → 全部角色型检查自动为假），能力派生 scope 逐请求与账号当前能力取交集 → 降权即时生效；前端副本 `client/src/lib/appScopes.ts`，`__tests__/appScopes.test.ts` 跨端断言一致 |
| 角色能力矩阵 | `server/src/lib/permissions.ts` | 角色 `user`/`author`/`admin` → 能力（`content:write`、`content:manage`、`comment:moderate`、`user:manage`、`stats:view`、`device:view`、`ai:configure`、`drive:all`、`app:manage`）；**新注册用户默认 `author`**（schema `User.role` 默认值 + `registerUser` 显式指定，可发布自己的文章；一次性提升存量账号用 `server/scripts/promote-users-to-author.ts`）；`author` 仅 `content:write`（管理员仍可调整角色）；`content:manage` 为全站文章 + 页面（仅 admin）；admin 自动全权；路由用 `requireCapability()` 守卫（读认证阶段解析好的 `req.user.capabilities`，故对应用令牌精确生效）；令牌只签 `{userId, role, ts}`，能力、网盘开关与空间配额逐请求从 DB 解析 → 角色变更即时生效 |
| 好友 / 聊天（私信，自建） | `server/src/routes/chatXmpp.ts`（REST 网关）+ `services/chatMessaging.ts`（消息核心 / XMPP 状态机 / bundle / 撤回 / 已读）+ `services/chatSessions.ts`（一次性票据 / 会话注册 / fanout / presence）+ `services/chatWsGateway.ts`（/ws/xmpp 网关）+ `services/chatPolling.ts`（长轮询会话）+ `services/chatView.ts`（bootstrap 出口口径）+ `services/bigGroup.ts`（官方大群）+ `lib/stanzaXml.ts` + `lib/chatIdentity.ts`；图片 `routes/chatUploads.ts`；好友 `routes/chat.ts` + `services/chatService.ts` | **聊天自建（2026-10-31 起，替代 neko XMPP，全员大厅已删）**：会话/消息/群聊全部落 Prisma，线上协议与 neko 完全兼容（前端 `lib/xmpp` 零改动）。REST 前缀 `/api/chat/xmpp`（bootstrap/ticket/state、目录/反查、建群/群管理含 role/transfer/mute/mute-all/mute-notify、公告+ack、置顶、撤回、表情、上传、http-* 长轮询）；实时双通道：`/ws/xmpp?token=` 自建网关（SASL PLAIN 一次性票据 + bind 在浏览器侧）与 `/api/chat/xmpp/http-*` 长轮询（默认，poll 挂 25s）共用同一状态机；身份映射 `nekoId=1000000000000+userId`、用户名 `lw_<id>`（前端硬契约，localStorage 未读水位延续）；消息特性：引用（`reply`→服务端解析 `<quote>`）、合并转发（`forward` ≤30 → 服务端生成 bundle 快照可跨会话）、拍一拍（XHTML `data-lw-poke`）、已读回执（`ConversationMember.lastReadMessageId` + headline `read`）、群公告三件套与 ack；**图片按上传计配额**（`ChatUpload.size` 计入 driveQuota，撤回最后一处引用删文件；`Message.uploadId` 引用计数）；旧存档（10-23~27）消息与图片原样可见（旧 `imagePath` 懒映射稳定 24hex id 走 `/chat/uploads/`；`GET /api/chat/messages/:id/image` 复活）；头像直链 `/chat/avatars/:nekoId` 读节点 `_avatars/`（`User.avatarVersion` 击穿缓存）；好友关系 Prisma 唯一真相源（非好友单聊注入 not-authorized）；官方大群自动建群/对账；封禁治理不变。旧 REST 端点 410（存档图片直链除外）。详见 `docs/chat-api.md` 第 0 章。**聊天双后端**：配置 `NEKO_CHAT_ENABLED+NEKO_CHAT_TOKEN` 后，用户可在聊天设置把后端切回 XMPP（neko 透传：`routes/chatXmppNeko.ts` + 恢复的 `nekoChat/nekoChatView/nekoChatGuard/nekoAccountSync/nekoBigGroup` 与 `nekoWsProxy` 中继），`User.chatBackend` 分发 REST（`routes/chatXmpp.ts` 分发器）与 `/ws/xmpp`，图片/头像直链 self 未命中回退 neko；未配置时与纯自建完全一致 |
| 游戏大厅（2048 / 斗地主 / 贪吃蛇 / 扫雷 / 跳一跳 / 我的世界 / 五子棋 / 骗子酒馆 / UNO / 中国象棋） | `server/src/routes/games.ts` + `services/gameService.ts` + `services/game2048.ts` + `services/gameDoudizhuService.ts` + `services/gameDoudizhu.ts`（引擎，与 `client/src/lib/games/doudizhu.ts` 双端同拷贝、对齐测试兜底）+ `services/gamePresence.ts`（presence 跨游戏共享）+ `services/gameIds.ts`（邀请 id 跨游戏统一发号）；前端 `client/src/pages/games/` + `contexts/GameContext.tsx` + `lib/games/` + `components/games/doudizhu/` | REST 前缀 `/api/games`（`/2048/*` 与 `/doudizhu/*` 并列，邀请 / presence / 轮询降级模式一致，**跨游戏互斥**：gameService 的 `registerGameModule` 注册探针，任一游戏未结束的房间都会让另一游戏的邀请返回 409）：2048 为好友邀请加入 **等待房间（2–10 人）**、接受/拒绝/取消、房主开始 `start`、离开/解散 `leave`、对局、移动、认输、`sync` 轮询、`presence` 心跳；邀请通过后双方进入同一房间，开始后自动进入对局；房主开始时可选择 1–60 分钟竞速时长（默认 10 分钟）；`game:*` 事件复用 `/ws/chat`；服务端权威多玩家棋盘，内存态、无 Prisma 表；无路可走/认输/掉线淘汰该玩家，最后存活或分数最高者获胜；无 WebSocket 时按 2–10 秒轮询降级，在线判定 = 聊天 WS 在线 OR presence 未过期（TTL 90s，120s 判负）；单机版纯前端、最高分 localStorage；**斗地主（`gameDoudizhuService.ts`）**：恰好 3 人房间 → 叫分（0–3，叫 3 立即成交，3 轮无人叫分流局 `no_bid`）→ 地主拿 3 张底牌先行 → 先出完者阵营胜（`hand_empty`），底分 100 × 倍率（炸弹/王炸/春天/反春 ×2），回合 90s 超时或离线 30s 自动托管（不叫 / 最小单张 / 不出），全员离线 10min 废弃（abandoned）；统一动作端点 `POST /matches/:id/actions`（`{type:bid|play|pass}`），**对局 DTO 按观看者裁剪（myHand 仅自己的牌）**；`game:match:*` 事件与 2048 同名、按 `match.game` 判别（每个玩家收到自己视角）；单机版纯前端（引擎 + `doudizhuAi.ts` 启发式 AI，战绩 localStorage）；**贪吃蛇**（`gameSnake.ts` + `gameSnakeService.ts`）单机与**同屏双人**（P1 WASD / P2 方向键）为纯前端，联机为 2–8 人 **40×40 大地图**、服务端每 220ms 权威推进一步（DTO `step`/`stepMs`/`remainingMs`），撞墙/撞蛇/双头对撞即淘汰，最后存活或按分数判定；**扫雷**（`gameMinesweeper.ts` + `gameMinesweeperService.ts`）单机三档纯前端（首点必安全 + 洪水展开 + 和弦），联机 2–4 人**轮流制：轮到自己只许一次动作**（`{type:"open"|"flag", index}`），踩雷出局、30 秒回合超时累计 3 次跳过判负，DTO 只含已翻开格与旗子故**雷位不泄露**；**跳一跳**（`gameJump.ts` + `gameJumpService.ts`）对齐微信小游戏：蓄力时长线性映射距离（≤2000ms → ≤260），`|offset|≤size×0.30` 判正中靶心、连击按 2/4/8/16/32 封顶，落空即淘汰，联机 2–6 人轮流各跳一次、**共享同一条 seed 盒子路线**（RNG 取数顺序 gap→size→kind 是双端协议的一部分）。三款新游戏统一走 `routes/games.ts` 的 `mountGameEndpoints()` 工厂挂载，跨游戏互斥改为 `registerGameModule({name,...})` + `isUserBusyInOtherGames(userId, selfName)` 单一口径（2048 自己也注册了探针，`sweep` 为空操作以免自我递归），详见 `docs/game-api.md` 各游戏章节（三～七，五子棋同走工厂挂载）；**我的世界**（`gameMinecraftWorld.ts` + `gameMinecraftService.ts`，客户端 `lib/games/minecraft.ts` 引擎 + `minecraftScene.ts` three.js 渲染 + `MinecraftGameView.tsx` 共用视图）单机为纯前端创造式体素沙盒（192×192×64 seed 确定性世界、程序化原创纹理、localStorage 存档），联机 2–8 人**共享世界**：服务端只存权威 seed + 方块修改日志（seq 增量，上限 30000）+ 玩家快照，各端本地生成世界（双端同拷贝文件用固定哈希常量对齐兜底），动作 `state`（~2Hz 位置）/`edit`（批量 ≤64），轻量事件 `game:minecraft:state|edit`，leave 在进行中也允许（房主移交），掉线 10 分钟移出、全员掉线 abandoned，路由为手动挂载（sync 带 since 水位，不走 mountGameEndpoints 工厂）；**五子棋**（`gameGomoku.ts` + `gameGomokuService.ts`，客户端 `lib/games/gomoku.ts` 引擎 + `GomokuPage.tsx` 单机人机 + `GomokuOnlinePage.tsx` 联机视图）恰好 2 人轮流落子：15×15 无禁手（连五及以上含长连即胜、下满平局），房主=座位 0 执黑先行，回合 60 秒超时由服务端自动托管落子（`lastMove.auto`，不淘汰）、掉线 120 秒判负、全局 30 分钟超时/下满为平局，棋盘全量下发无隐藏信息，动作 `{type:"place",x,y}`（下标=y×15+x），走 `mountGameEndpoints` 工厂挂载，双端引擎逐字同拷贝（client 测试读双端源码对齐兜底）；**骗子酒馆**（`gameLiar.ts` + `gameLiarService.ts`）2–4 人：20 张牌（K/Q/A×6 + 鬼牌×2）、每局随机目标、盖牌出 1–3 张或质疑上一手，质疑开牌定真假、输家扣左轮（子弹数=死亡数+1）、中弹出局并重发，最后存活者胜；`myHand`/牌堆牌面按观看者裁剪；**UNO**（`gameUno.ts` + `gameUnoService.ts`）2–10 人：108 张经典牌堆、每人 7 张，禁止/反转/+2/万能/+4 全结算，万能+4 受「手里仍有当前颜色」限制，摸牌后只能打刚摸到的牌或跳过，先出完手牌获胜；`drawnCardId` 全局下发但只有该玩家能出；**中国象棋**（`gameXiangqi.ts` + `gameXiangqiService.ts`）2 人：9×10 完整规则、将军/绝杀/困毙/将帅照面判定，alpha-beta AI 与联机托管共用；120 半回合无吃子判和。三者均走 `mountGameEndpoints`，双端引擎逐字同拷贝并用 client 测试对齐 |
| 霓虹跑酷（parkour，3D 第三人称三车道） | `server/src/services/gameParkour.ts`（双端唯一真相源引擎）+ `gameParkourService.ts`（内存房间 / 2Hz 进度 / 排名 / sweeper）；前端 `client/src/lib/games/parkour.ts`（逐字副本）+ `parkourScene.ts`（three.js 场景）+ `parkourModels.ts` + `parkourTextures.ts` + `components/games/parkour/ParkourGameView.tsx` + `pages/games/ParkourPage.tsx` / `ParkourOnlinePage.tsx` | 单机无尽、联机 **2–6 人**同 seed 的 **800m 幽灵竞速**：3 秒倒计时、150 秒上限；自动前进 + 左右换道 / 跳跃 / 按住滑铲，一次撞击或掉坑出局，护盾抵挡一次、磁铁 8s、冲刺 4s 无敌加速；客户端本地 60fps 模拟（three.js 与「我的世界」共用按需 chunk），每 500ms `progress` 上报距离/金币/连击/车道/姿态，服务端只做单调/速度上限/金币/车道校验与排名（冲线按服务端收到顺序；未冲线按距离 > 金币 > maxCombo）；`finish` 距离 ≥795m；掉线 30s DNF、全员不可用留给 timeout；完赛/出局观众不阻塞其它游戏；`verify:parkour` 3602 断言；无 Prisma 表 |
| 宠物系统（pet，2026-10-31） | `server/src/lib/petCatalog.ts`（物种/装扮/动作目录 + 衰减结算纯函数，服务端唯一真相源）+ `services/petService.ts`（惰性结算 + 积分事务）+ `routes/pets.ts`；前端 `client/src/pages/PetsPage.tsx` + `components/pets/PetSprite.tsx`（inline SVG 三物种立绘 + 装扮覆盖层）+ `types/pet.ts` + `styles/pet.css` | REST 前缀 `/api/pets`（全部需登录，挂 `requireFeature('pet')`，写端点 120/5min 按用户限流）：每用户一只宠物（`Pet.userId @unique`，`status: alive|gone`）；**召唤** 300 积分选 猫/狗/鸟，出走后重新召唤复用同一行（等级重置、已购装扮保留）；**照顾**：喂食 10 分（L1，饱食度回满+心情5）/ 洗澡 15 分（L2，清洁回满+心情5）/ 玩耍 20 分（L3，心情+30）；**抚摸**免费（60s 冷却，心情+2）；**升级**花积分 `100×当前等级`（满级 10）；**特技**按等级解锁（跳舞L4/翻滚L5/唱歌L6/后空翻L7/转圈圈L8/魔法秀L9/烟花庆祝L10，免费纯动画）；**换装** 18 件装扮分 hat/neck/face/back/aura 五槽（150–1000 积分，部分有等级门槛，`PetOutfit` 表永久拥有）；**懒惰衰减无定时器**：饱食度 -4/h、清洁 -2/h、心情 -3/h，线性可解析归零时刻 → `Pet.criticalSince` 记录最早归零点，**归零满 48h 判离家出走**（读时结算翻转 status，照顾/抚摸均 409 `PET_GONE`）；积分流水 reason `pet_summon/pet_feed/pet_bathe/pet_play/pet_upgrade/pet_outfit`；前端 inline SVG + CSS keyframes 动画（眨眼/摆尾/吃食/泡泡/后空翻等 12 种，`prefers-reduced-motion` 降级），30s 可见时轮询；`verify:pet` 721 断言；数据库 `Pet`/`PetOutfit` 为 additive，`prisma db push` 即可 |
| 搜打撤 v2（raid，2026-11-03 重构） | `server/src/lib/raidRun.ts`（共享纯函数：物品 / 装备目录、确定性地图生成、运行状态机、耐久与维修、每日契约）+ `server/src/lib/raidStorage.ts`（仓库等级、存入规划、回收价）；`services/raidRunService.ts`（开局 / 事件批处理 / 结算）、`raidCommon.ts`、`raidContractService.ts`、`raidStorageService.ts`、`raidShopService.ts`、`raidGearService.ts`、`petRaidService.ts`（概览）；`routes/pets.ts` 的 `/raid*`；前端 `client/src/lib/raid/{raidRun.ts（逐字副本）, engine.ts, renderer.ts, input.ts}` + `components/raid/{RaidCanvas,RaidHud,RaidResultDialog}.tsx` + `pages/{PetRaidPage,RaidStoragePage}.tsx` + `types/petRaid.ts` + `styles/{raid,raid-storage}.css` | 元气骑士式实时房间制：seed 确定性生成 3×3–5×5 房间（17×13 瓦片 + 生成树走廊 + 环路），进房锁门、清怪开门；敌人会移动（巡逻 / 追击 / 远程射击 / Boss 弹幕），WASD + 鼠标瞄准射击、技能 1/2/3 手动释放、手机双虚拟摇杆；服务端按 seed 重算地图校验事件（`enterRoom/kill/clearRoom/openContainer/takeLoot/useItem/castSkill/damage/extractStart/extractDone/abandon`），客户端本地 60fps 模拟、约 1.5s 批量上报，HP / 背包 / 撤离以服务端为权威；装备 6 级头 / 甲 / 鞋 + 背包（8–28 格）/ 胸挂（2–7 格），`RaidGear` 表，头盔护甲有耐久（维修每次 -5% 上限，最低初始 30%），商店只卖 1–3 级、4–6 级靠掉落 / 开箱；容器 `backpack/rig/safe`（`RaidBagItem` 表），没背包不能拾取、背包满不能装；**撤离后物品留在容器，必须手动存入仓库，仓库满不自动出售**；官方商店回收价 材料 / 珍宝 100%、消耗品 60%、箱子 70%；阵亡 / 失联背包与胸挂清空、随身装备必丢（行动保险 15% 可保住）、安全箱保留；50 种物品 / 6 档品质、每日契约 3 条；交易行整体删除（表保留，避免生产 `db push` 破坏性失败），旧对局首次读取按放弃结算；`verify:raid` 6285 断言 / `verify:raidstorage` 132 断言 |
| 个人空间（Personal Space，2026-10-31） | `server/src/routes/personalSpace.ts` + `lib/permissions.ts`（能力 `personal:manage`）；前端 `client/src/pages/PersonalSpacePage.tsx`（/personal-space，AdminLayout 组）+ `types/personalSpace.ts` + `styles/personalSpace.css` + `docs/personal-space-api.md` | **仅管理员**的私人服务页：`router.use(authenticate, requireCapability('personal:manage'))` router 级守卫（admin 自动全权，user/author 403，应用令牌不在 appScopes 白名单天然 403；无 FeatureFlag——管理员绕过开关）；数据按管理员隔离（`PersonalSpace.userId @unique` 每人一行，GET 首访 upsert 自动建行）；**空间名每人不同**：默认 `<用户名> 的私人空间`（用户名超长自动截断保证 ≤30，PUT 限 1–30 字）；首个私人服务 **RustDesk 远程桌面（配置卡片＋快捷连接）**：ID 服务器/中继服务器/公钥 Key/Web 客户端地址均可选（各 ≤200 字，Web 地址必须 `http(s)://` 开头），PUT 整体保存语义（未传可选字段等同清除）；页面提供配置一键复制（clipboard API → `execCommand('copy')` HTTP 降级，适配 IP 直连纯 HTTP 生产）、打开 Web 客户端（新窗 noopener）、被控 ID 纯数字校验后 `rustdesk://connection/new/<id>` 深链唤起；底部留「更多服务即将上线」扩展位；`personal_spaces` 表 additive，`prisma db push` 即可 |
| 小说阅读器（reader，2026-11-01） | `server/src/services/readerService.ts`（EPUB 元数据解析纯函数 + 上传/删除/进度）+ `routes/reader.ts`；前端 `client/src/pages/ReaderPage.tsx`（/reader 书架）+ `pages/ReaderBookPage.tsx`（/reader/:bookId 阅读视图）+ `lib/reader/epubReader.ts`（vendored foliate 唯一 TS 边界）+ `lib/reader/txtChapters.ts`（编码检测+分章纯函数）+ `lib/reader/foliate/`（foliate-js 快照，见其 VENDORED.md）+ `types/reader.ts` + `styles/reader.css` + `docs/reader-api.md` | REST 前缀 `/api/reader`（需登录，`requireFeature('reader')`，上传 20/5min 其余 120/5min）：上传 EPUB/TXT（≤50MiB/本，jszip 解析 container.xml→OPF 取标题/作者/内嵌封面，失败回退文件名不阻断；封面 sharp→宽 300 WebP）；书存节点 `_books/<userId>/`（storageSync 系统目录），**文件计入网盘配额**（driveQuota 第 5 聚合）、封面不计；三段式配额（预检/截断/写后复核回滚）；`BookProgress` 按 `[bookId,userId]` 唯一 upsert，epub 进度=CFI、txt=`{chapter,offset}` JSON；file/cover 直链属主校验 + `?token=` + immutable 缓存（compression 已排除）；前端 EPUB 用 foliate-js（动态 import、独立 `foliate` chunk 167KB，点击打开书才加载）、TXT 自绘章节渲染（UTF-8 严格解码失败→GB18030）；进度 2s 防抖 + pagehide/visibilitychange 冲刷；`verify:reader` 32 断言；客户端测试 txtChapters 12 用例 |
| 网易云音乐（music，2026-11-01） | `server/src/services/neteaseMusic.ts`（NCM 包函数级薄封装：懒加载/15s 超时/cookie 只存不回传/301 过期清绑定）+ `routes/music.ts`（status/扫码三步/logout/search/song url/lyric/recommend/toplist/playlist tracks）；前端 `client/src/pages/MusicPage.tsx`（/music：扫码卡+搜索+推荐+榜单）+ `contexts/MusicPlayerContext.tsx`（全局播放状态，audio 实例/MediaSession/队列模式/音量/进度 localStorage）+ `components/music/MusicPlayerBar.tsx`（App Routes 外层常驻迷你条）+ `lib/music/song.ts`（字段归一化+LRC 解析）+ `types/music.ts` + `styles/music.css` + `docs/music-api.md` | REST 前缀 `/api/music`（需登录，`requireFeature('music')`，扫码 prepare 10/5min、check 240/5min、search 60/5min、其余 120/5min，admin 豁免）；**`@neteasecloudmusicapienhanced/api` 库挂载**（不新增容器/进程，函数级调用带 timestamp；包按需懒加载）；**解灰关闭**（query 永不带 `unblock`，compose 显式 `ENABLE_GENERAL_UNBLOCK=false`）；**只做扫码登录**（800 过期/801 待扫/802 待确认/803 成功→upsert `MusicAccount`），cookie 失效（上游 301）→清绑定抛 401 `MUSIC_SESSION_EXPIRED`；未绑定匿名态可搜索/听免费歌（VIP 仅 30s 试听）；`song/url/v1` level 白名单默认 exhigh；**音频经网易 CDN 直连播放不经服务器**（helmet CSP 新增 `mediaSrc 'self' https: http:`，全站唯一安全面放宽）；扫码轮询前端 1.5s；风险提示文案在登录卡（逆向接口灰色地带：不解灰/不自动化/低频，仅供个人自用） |
| 网盘空间配额 | `server/src/services/driveQuota.ts` + `routes/drive.ts` / `routes/users.ts` | 每用户 `user.storageQuota`（默认 2 GiB，管理员 `PUT /api/users/:id/quota` 可调 0–10 TiB）；**已用空间 = 网盘文件 + 聊天图片（`Message.imageSize`，撤回后不计）+ AI 对话图片（`AiChatImage.size`，含 24h 未发送的待用附件）**；上传三阶段强制（预检 / busboy 按剩余空间截断 / 写后复核并清理），超限 413 `QUOTA_EXCEEDED`；`GET /api/drive/quota` 返回 BigInt 字符串；`drive:all` 不受限；`POST /api/drive/sync` 收紧为仅 `drive:all`；前端 `useDriveQuota` + `DriveQuotaBar` |
| 登录/个人资料 | `server/src/routes/auth.ts` | 登录支持 `identifier`（用户名或邮箱，兼容 email）与 `rememberDays`（1–90 天设备长期令牌）；`PUT /auth/profile` 修改用户名（唯一性校验）/密码（验证当前密码，改密后旧 token 全失效并重签） |
| 屏幕时间推送 | `server/src/routes/health.ts` | `/api/health/push`、`/screen-time*`、`/daily-goal*` 统一用登录令牌（仅本人数据）；`X-Screen-Time-Token` 已移除 |
| AI 助手 | `server/src/routes/ai.ts` + `services/aiService.ts` | OpenAI SDK + 兼容 baseUrl；`AiConfig` 单行表存 key（脱敏显示）；**`/api/ai/chat` 公开（POST）但走 `optionalAuthenticate`**——登录用户额外注入站点统计、最近评论、全部已发布页面、按需检索文章正文（≤2 篇×1500 字）、近 14 天屏幕时间；`/chat/public` GET 取站点内容；管理端 `/admin/ai`（AI 设置页「AI 助手」Tab）配置；chat() 错误统一 `AppError` |
| AI 对话（DeepSeek） | `server/src/routes/aiChat.ts` + `services/aiChatService.ts` + `services/aiChatImageService.ts` + `services/webSearch.ts`；前端 `client/src/pages/DeepSeekChatPage.tsx`（/deepseek）+ `pages/admin/AiChatAdminPage.tsx`（管理页已并入 `/admin/ai` AI 设置页的「AI 对话」Tab，旧地址 /admin/ai-chat 重定向）+ `lib/aiChat.ts` + `lib/markdown.ts`（marked + KaTeX + DOMPurify，DeepSeek 对话 / 首页 AI 助手 / Markdown 文件预览共用） | **与首页 AI 助手相互独立的通用对话**（`AiChatConfig` 单行：provider/model/apiKey/baseUrl/systemPrompt/dailyLimit/isEnabled + 联网搜索 searchEnabled/searchProvider/searchApiKey，默认 DeepSeek 预设），REST 前缀 `/api/ai-chat`（全部需登录，应用令牌不在 appScopes 白名单 → 403）：多会话（标题=首条消息前 20 字）、游标分页历史、**Markdown + LaTeX 渲染**（GFM 表格/引用/代码块 + `$...$`、`$$...$$`、`\(...\)`、`\[...\]`，DOMPurify 消毒）、**`POST /messages` SSE 流式**（`{meta}→{search}*→{reasoning}*→{delta}*→{done}|{error}`；SSE 前错误为普通 JSON 400/429/503）、**联网搜索**（请求体 `search` 开关 → 服务端调 DeepSeek 官方搜索 / 博查 / Tavily（Key 管理员配置、响应脱敏；端点可用 `DEEPSEEK_SEARCH_ENDPOINT`/`BOCHA_SEARCH_ENDPOINT`/`TAVILY_SEARCH_ENDPOINT` 覆盖；DeepSeek 搜索 `query` 上限 128 字、`summary` 长摘要注入），把标题/URL/摘要注入 system 并要求 Markdown 链接标注来源，单条摘要 ≤700 字、上下文 ≤6000 字、含提示词注入防护；`searchAvailable` 由 quota 下发，未配置时按钮置灰；搜索失败置 `counted=false` 退还）、**思考模式**（请求体 `thinking` 开关 → 上游恒传 `thinking:{type:enabled|disabled}`（DeepSeek 扩展参数，SDK 类型外仅此一处断言）；思维链 `delta.reasoning_content` 经 `{reasoning}` 透传并落库 `AiMessage.reasoningContent`，不回传历史上下文；前端「深度思考」开关 localStorage 持久化，思考折叠块生成中展开、正文开始自动收起）、**每日提问上限**（Asia/Shanghai 0 点重置，`dailyLimit=0` 不限；计数=当日 `counted=true` 的 user 消息，外层 429 快速失败 + 事务内复核封并发窗口，**上游失败置 `counted=false` 退还**）、**图片/拍照提问**（≤4 张/条、原始 ≤10MiB→WebP ≤4MiB，复用 chatImageService 的 sharp 流程与 413 协议，存节点 `_ai/<userId>/`（storageSync 已排除），计入网盘配额，读取走属主校验 + `?token=` 直链，附件先落库 `messageId=null` 随消息事务内认领、24h 未发送自动清理）；上下文=system（联网时并入搜索资料）+最近 20 条历史（历史图片以「（附图）」占位）+当前消息（**图片仅当前消息**以 base64 data URL 多模态传入——DeepSeek 官方 API 为纯文本，图片需管理员改配视觉模型，管理页有提示）；客户端中断已生成的部分回复照常落库；写端点 per-user 120/5min 限流；`compression` 对 `/ai-chat/messages`（SSE）与图片直链精确豁免；自检 `cd server && npm run verify:aichat`（82 断言）；详见 `docs/ai-chat-api.md` |
| 存储架构 | `server/src/services/storageTunnel.ts` ↔ `storage-node/main.py` | WebSocket 隧道；服务器代理命令到 Python 节点；节点 10 命令（7 个 HANDLERS + 流式 read/write/eof）、阻塞 I/O 线程池化、运行期间 `SetThreadExecutionState` 阻止 Windows 休眠 |
| 头像服务 | `server/src/services/avatarService.ts` | sharp 处理 + 存储节点读写；`GET /api/auth/avatar/:userId` 公开（头像可匿名访问）；上传/删除自增 `User.avatarVersion`（聊天头像直链 `/chat/avatars/:nekoId?v=` 缓存击穿） |
| 全文搜索 | `server/src/services/ftsSearch.ts` | SQLite FTS5 全文索引，启动时 `ensureFTSTable` |
| React Query 层 | `client/src/hooks/useQueries.ts` + `lib/queryKeys.ts` | 公开页面已使用（staleTime 5min、retry 1、不随窗口聚焦刷新），管理页面仍手写 `useState+useEffect` |
| 设计系统 | `client/src/styles/`（33 个 CSS 文件，含 `chat.css`、`games.css`、`doudizhu.css`、`snake.css`、`minesweeper.css`、`jump.css`、`minecraft.css`、`gomoku.css`、`liar.css`、`uno.css`、`xiangqi.css`、`parkour.css`、`farm.css`、`pet.css`、`stocks.css`、`reader.css`、`music.css`） | `globals.css` 仅 import 聚合器；`drive.css` 最大（约 2900 行）；聊天样式为 `.gh-chat-*`，游戏为 `.gh-games-*` / `.gh-g2048-*` / `.gh-game-*` / `.gh-ddz-*`（斗地主）/ `.gh-snake-*` / `.gh-ms-*`（扫雷）/ `.gh-jump-*` / `.gh-mc-*`（我的世界）/ `.gh-gmk-*`（五子棋）/ `.gh-liar-*` / `.gh-uno-*` / `.gh-xq-*` / `.gh-pk-*`（霓虹跑酷）/ `.gh-pet-*`（宠物）/ `.gh-reader-*`（阅读器）/ `.gh-music-*`（音乐）/ `.gh-chat-redpacket-*`（红包，在 `redpacket.css`）；无 Tailwind、无 CSS-in-JS |
| 本地管理 CLI | `cli/src/`（commands/autoupdate/processes/ui） | `setup` 新机器一键安装、`start` 默认生产模式、`update` GitHub 拉取（镜像降级）、`token` 查询存储节点 Key、`autoupdate` S4U 计划任务无人值守更新；构建 `npm run build:cli` → `cli/dist/LineWebCLI.exe` |
| PWA | `client/index.html` + `client/public/manifest.json` | theme-color、apple-touch-icon、manifest 已配置 |
| 环境配置 | `server/.env`（本地）/ `/opt/lineweb/.env`（生产） | 本地：`NODE_ENV`、`PORT=3001`、`JWT_SECRET`、`DATABASE_URL`（`file:./lineweb.db`）、`STORAGE_NODE_TOKEN`、`CORS_ORIGIN`、`MAX_FILE_SIZE_MB`；**生产 `.env` 在服务器 `/opt/lineweb/.env`，`DATABASE_URL` 指向 `lineweb-postgres:5432`**，另有 `JWT_SECRET`、`STORAGE_NODE_TOKEN`、`MAX_FILE_SIZE_MB` 等（凭据副本在服务器 `/root/lineweb-secrets.txt`，不进仓库）；缺 `JWT_SECRET`/`STORAGE_NODE_TOKEN` 会直接启动失败。本地与生产 `.env` 各自独立，`.env.docker` 为容器部署模板 |
| 内网穿透 | 无（已移除） | **2026-10-31 起 Cloudflare Tunnel 已整体移除**（`cloudflared` systemd 服务、二进制、`/etc/cloudflared` 全部删除；移除原因：隧道入口规则长期指向已废弃的宿主 3001 端口导致域名 502，且用户决定不再维护域名入口）。公网入口唯一为 IP 直连 `http://120.24.223.65:8780`。Cloudflare 控制台侧残留（隧道 `lineweb-ecs` + DNS CNAME）由账号持有人自行删除，不删也不影响服务器 |
| API 缓存策略 | `server/src/index.ts` cachePublic 中间件 | posts/pages/comments 5min、stats 1min；**bing 壁纸已移除** |

## 架构

```
┌────────────────┐     HTTP/API      ┌──────────────────────────────────┐     WebSocket      ┌──────────────────────────┐
│  浏览器         │ ◄──────────────► │  阿里云 ECS (Ubuntu)              │ ◄───────────────► │  Storage Node            │
│  (React SPA)   │   公网 IP :3001   │  1Panel + Docker Compose          │ ws(s)://ECS:3001   │  (Python)                │
│                │                  │  Express 容器 + PostgreSQL 16     │  :3001/ws/storage  │  本地 Windows             │
└────────────────┘                  │  + client/dist 静态               │                   │  D:/LineWebDrive         │
                                    └──────────────────────────────────┘                   └──────────────────────────┘

开发：  Vite :5173 → 代理 /api → Express :3001（本地，SQLite）
生产：  阿里云 ECS：1Panel + Docker Compose（Express 容器 :3001 + PostgreSQL 16 容器），容器内提供 client/dist 静态资源 + SPA fallback
公网：  IP 直连 http://120.24.223.65:8780（唯一入口，纯 HTTP；Cloudflare Tunnel 已于 2026-10-31 移除）
存储：  外部存储节点主动外连（容器日志实测来源 58.253.109.135，规范配置 ws://120.24.223.65:8780/ws/storage），health 实测 storageNode: connected
备用：  本地 Windows 全栈（开发/应急，非生产）
```

### 启动流程

```
server.listen(3001)
  ├── helmet(CSP) → cors → compression（跳过 /proxy、/download）
  ├── body parser 限定 /api（1mb，避免静态文件请求触发解析）
  ├── rate-limit(8000/15min，2026-11-03 从 600 上调；IP 硬上限默认 30000) → 设备追踪 → 全局认证检查
  ├── cachePublic 中间件 → 15 个路由组挂载于 /api/*（含 /api/oauth、/api/chat、/api/games）
  ├── [生产] express.static(client/dist, maxAge 1y+immutable, HTML 不缓存) + SPA fallback
  └── errorHandler

监听后：
  ├── http.createServer → WebSocket：/ws/storage（存储隧道）+ /ws/xmpp（自建聊天网关）+ /proxy-ws/:siteId（反代）+ /ws/chat（游戏/好友事件 Hub；chatHub 接管 upgrade 分发）
  ├── 网盘同步定时器（每 5 分钟，unref）
  ├── 启动延迟（10s）：去重 + 初始同步
  └── 设备追踪清理（30 分钟不活跃超时）
```

## 部署流程（阿里云 ECS + 1Panel + Docker Compose + 本地存储节点）

```
阿里云 ECS（Ubuntu 24.04，2 vCPU / 1.6GB + 2GB swap，代码在 /opt/lineweb）：
  1. 安装 1Panel v2.3.2（用非交互 PANEL_* 变量指定端口/入口/用户名，避免交互提问）：
     官方安装脚本会同时装好 Docker 29.8.1 + Docker Compose v5.5.1；
     安装目录 /opt/1panel，面板地址 http://120.24.223.65:18080/lineweb_panel（用户名 lineweb）
  2. 配置 /etc/docker/daemon.json 国内镜像加速
     （docker.1panel.live、docker.m.daocloud.io、docker.1ms.run）
     —— 该机器直连 Docker Hub 会超时，不配加速无法拉取镜像
  3. 创建 1panel-network 外部网络与 PostgreSQL 16 容器 lineweb-postgres
     （postgres:16-alpine、数据卷 lineweb-pg-data、数据库 lineweb）
  4. 代码放到 /opt/lineweb（git 仓库，当前 HEAD 660f492；origin 仍指向 GitHub）
  5. 写 /opt/lineweb/.env：DATABASE_URL 指向 lineweb-postgres:5432，
     另有 JWT_SECRET、STORAGE_NODE_TOKEN、MAX_FILE_SIZE_MB 等
     （凭据副本在服务器 /root/lineweb-secrets.txt，不要写入文档或仓库）
  6. 前端产物在本地构建后上传（**切勿**在服务器上 --build，见下方注意事项）：
     cd client && npm run build && tar czf - -C dist . | ssh -i ~/.ssh/lineweb_aliyun root@120.24.223.65 'rm -rf /opt/lineweb/client-dist && mkdir -p /opt/lineweb/client-dist && tar xzf - -C /opt/lineweb/client-dist'
     docker build -f Dockerfile.prebuilt -t lineweb-server:latest . && docker compose up -d
     # 应用容器 lineweb-server-1，对外端口 8780（宿主 8780 → 容器 3001），restart: unless-stopped，compose 自带健康检查
     # 首次启动由 server/scripts/docker-entrypoint.sh 把 SQLite schema 改写为 PostgreSQL，
     # 再执行 prisma db push + prisma db seed
  7. 验收：curl http://127.0.0.1:8780/api/health
     # 期望 {"status":"ok","db":"connected",...}，docker ps 显示容器 healthy
  8. 阿里云安全组放行 22、18080、8780
     —— 实测三者均已放行；3001 的公网入站已收紧关闭（2026-10-31 验证）

存储节点（外部机器，文件不出本机）：
  1. storage-node/config.json：serverUrl=ws://120.24.223.65:8780/ws/storage，
     token 与服务器 /opt/lineweb/.env 的 STORAGE_NODE_TOKEN 完全一致，storagePath 指向本地磁盘
  2. python main.py（或用 nssm 注册 Windows 服务开机自启）
  3. 节点为 WebSocket 客户端主动外连，本地无需公网 IP / 端口映射
  4. 节点接入状态（2026-10-31 实测）：/api/health 显示 "storageNode":"connected"，网盘/头像可用；
     容器日志确认线上节点自外部 IP 58.253.109.135 直连接入（不走任何隧道）

公网入口：
  唯一入口：IP 直连 http://120.24.223.65:8780（纯 HTTP，无 HTTPS）。
  2026-10-31 起 Cloudflare Tunnel 已整体移除（此前隧道入口规则长期指向已废弃的宿主 3001 端口，
  域名一直 502；用户决定不再维护域名入口，cloudflared 服务/二进制/配置已全部删除）。
  Cloudflare 控制台侧残留（隧道 lineweb-ecs、DNS CNAME）由账号持有人自行处理，不删也不影响服务器。
  若未来要恢复 HTTPS/域名：需先完成 ICP 备案（阿里云大陆节点按 Host 头拦截未备案域名，
  返回 403 + Server: Beaver + Non-compliance ICP Filing），或把服务器换到非大陆区域。
  1Panel 面板：http://120.24.223.65:18080/lineweb_panel（用户名 lineweb）——继续用 IP:18080 访问，
  **不要在面板里绑定域名**（面板设置 → 域名绑定）：绑了之后用 IP 访问会被拦成
  "Access Temporarily Unavailable"，恢复命令是 1pctl reset domain && systemctl restart 1panel-core。

代码更新（服务器无法直连 GitHub）：
  ❌ git fetch origin master && git reset --hard origin/master   # 在该 ECS 上跑不通
     （实测 clone 两分钟只拉到约 200KB，最初代码是用本地 git bundle 上传后 clone 的）
  ✅ 走镜像/代理拉取，或从本地机器 git push 到服务器（本地 → 服务器 SSH 可达）
  更新后重建容器：docker build -f Dockerfile.prebuilt -t lineweb-server:latest . && docker compose up -d（前端产物同样由本地 build 后上传 client-dist/）
```

> 详细运行手册（含 ECS/1Panel 准备、Docker Compose 部署、`.env`、存储节点连接、验收清单、故障排查、HTTPS 升级步骤）见 [`docs/DEPLOYMENT_HTTP_3001.md`](docs/DEPLOYMENT_HTTP_3001.md)。

## 约定

### 沟通

- **项目文档、注释、AI 交互均使用中文**

### TypeScript

- 前后端均 `strict: true`
- 前端 `noUnusedLocals: false`、`noUnusedParameters: false` — 死代码不被检测
- 前后端均 `skipLibCheck: true`
- 前端：`@/*` 别名 → `src/*`（已配置但很少使用；大部分使用相对导入）
- 后端：ESM 配合 .js 后缀（`import x from './routes/auth.js'`，尽管源文件是 .ts）
- **根 `npm run build` 只跑 vite、不跑 tsc** — 类型检查需单独 `cd client && npx tsc --noEmit`（client 内 `npm run build` 才包含 `tsc -b`）

### CSS

- **纯 CSS** — 无 Tailwind、无 CSS 模块、无 CSS-in-JS
- 命名空间 BEM：`.gh-*`（设计系统）、`.drive-*`（网盘）、`.admin-*`、`.lex-*`（编辑器）
- 状态修饰符：`--active`、`--selected`、`--collapsed`
- 主题属性：`[data-theme="dark"]`
- 字体为 GitHub 系统字体栈 `--gh-font` / `--gh-font-mono`（variables.css）

### 命名

| 分类 | 约定 | 示例 |
|----------|-----------|---------|
| React 组件 | PascalCase，默认导出 | `Navbar.tsx` |
| 页面 | PascalCase，懒加载 | `HomePage.tsx` |
| Context | PascalCase + Context 后缀 | `AuthContext.tsx` |
| Hooks | `use` 前缀，camelCase | `useThumbnails.ts` |
| 后端路由 | 复数，每个域一个文件 | `routes/auth.ts` |
| 后端服务 | 域名 + Service 后缀 | `services/authService.ts` |
| 数据库模型 | PascalCase 单数 → snake_case 表名（@map） | `DriveFile` → `drive_files` |
| CSS 类名 | kebab-case，模块命名空间 | `.drive-grid-card--selected` |

### 工具链缺失（值得注意）

- **无 ESLint、Prettier、Biome 或 EditorConfig** — 代码格式未强制执行
- **根目录无 `npm test`** — 仅在 `client/` 中有测试（42 个文件 / 453 个用例，`__tests__/` 目录）；server 零测试
- **不使用 `prisma migrate`** — 约定仅使用 `prisma db push`（根 `db:migrate` 脚本存在但 `prisma/migrations/` 目录不存在，属备用入口）
- **测试约定**：源文件旁 `__tests__/` 目录、`.test.{ts,tsx}` 命名、`vi.mock()`（无 MSW）
- **验证期望**（源自 CLAUDE.md）：前端改动至少跑 `npx tsc --noEmit` + `vite build`；涉及认证、数据库、网盘上传下载、存储 WebSocket 或权限的服务端改动，需启动服务做 API 或浏览器手动验证

## 反模式（项目全局）

### TypeScript

- **`req.user!.userId`**（41 处）— 非空断言；应使用声明合并
- **`as any` / `: any`**（4 处）— 散落的类型绕过
- **`@/` 别名未普及** — 仅少数文件使用

### 错误处理

- **`.catch(() => {})`**（11 处）— Promise 拒绝被忽略，主要集中 storageTunnel/drive/routes 中
- **错误传播不一致** — 部分路由委托给 `errorHandler`（posts/pages 已用 asyncHandler），部分内联 `res.status(500)`

### 代码质量

- **死依赖**：`@fontsource/instrument-serif` 仍在 package.json 但客户端无任何 import（字体已改系统字体栈）
- **超大文件**：`drive.ts`（约 1080 行）、`drive.css`（约 2900 行）、`PageEditor.tsx`（约 810 行，位于 `client/src/pages/admin/`）
- **跨模块耦合已消除**：`users.ts` 不再从 `drive.ts` 导入 `clearDriveAccessCache`（网盘权限改为逐请求从 `req.user.canAccessDrive` 读取）
- **服务层不一致**：部分路由使用 service 层（auth、posts、avatar、ai），其他直接调用 Prisma（comments、pages、stats、driveFavorites）
- **React Query 层已使用** — `QueryClientProvider` 在 App.tsx 中配置，公开页面通过 `useQueries.ts` 使用 React Query，管理页面仍手写 `useState+useEffect`
- **顶部导航快捷方式已移除** — 导航统一由侧边栏提供；首页站点统计移至右侧侧边栏，AI 助手在首页

### 数据库

- **无迁移** — 仅使用 `prisma db push`；无回滚能力
- **`$queryRawUnsafe`**（3 处）— 去重脚本中的原始 SQL（已参数化，但绕过了类型安全）
- **本地 SQLite / 生产 PostgreSQL 双轨** — 本地开发用 SQLite（同一套 `schema.prisma`），生产是 PostgreSQL 16（1Panel 上的容器 `lineweb-postgres`）；`server/scripts/docker-entrypoint.sh` 会在容器启动时把 SQLite schema 改写为 PostgreSQL 后执行 `db push`，属生产链路的一部分

### 安全

- **明文 token 存储于 `storage-node/config.json`，且 `.gitignore` 未覆盖该文件** — 一旦提交即对外公开（仓库工作区当前就是明文 token），保守应视为**已泄露**：需轮换 `STORAGE_NODE_TOKEN` 并把该文件加入 `.gitignore`，或改用 `LINEWEB_STORAGE_TOKEN` 环境变量注入；另注意公网入口现为 IP 直连 `ws://`，token 明文过网（Cloudflare Tunnel 已移除，链路加密暂无方案，恢复 HTTPS 前先接受该风险）
- **JWT 存于 localStorage** — 标准 SPA 模式，存在 XSS 风险
- **AI chat 接口公开** — `/api/ai/chat` 匿名可调（走 `optionalAuthenticate`，登录用户获额外上下文），消耗 API key 配额，滥用风险

## 命令

```bash
# 开发
npm run dev              # concurrently：server (3001) + client (5173)
npm run dev:server       # tsx watch server/src/index.ts
npm run dev:client       # vite（端口 5173，代理 /api → :3001）

# 构建 & 类型检查
npm run build            # 仅 vite 构建 client（跳过 tsc！类型检查需 cd client && npx tsc --noEmit）
cd client && npm run build   # tsc -b && vite build（含类型检查）
npm run start            # 构建 client → generate-pg-schema.js → NODE_ENV=production tsx server/src/index.ts
npm run build:cli        # 构建 cli/dist/LineWebCLI.exe（esbuild + pkg node22 基础二进制，缓存在 ~/.pkg-cache/v3.6）

# 数据库
npm run db:push          # prisma db push（SQLite 开发）
npm run db:migrate       # prisma migrate dev（备用入口，约定仍用 db push，无 migrations 目录）
npm run db:seed          # 种子数据：admin@lineweb.dev / admin123 + line@lineweb.dev / liang798119（两个 admin）
npm run db:studio        # prisma studio

# 游戏引擎 / 状态机自检（server）
cd server && npm run verify:game   # 2048 引擎 + presence（47 断言）
cd server && npm run verify:ddz    # 斗地主引擎 + 联机状态机 + 托管/流局/认输（50 断言）
cd server && npm run verify:snake       # 贪吃蛇引擎 + 大地图房间/步进/结算（170 断言）
cd server && npm run verify:minesweeper # 扫雷引擎 + 轮流点/跳过/踩雷/全清（385 断言）
cd server && npm run verify:jump        # 跳一跳物理 + 轮流跳/淘汰（207 断言）
cd server && npm run verify:minecraft  # 我的世界世界生成/哈希对齐 + 联机状态机（52 断言）
cd server && npm run verify:gomoku    # 五子棋引擎四方向/长连 + 托管/掉线/超时/平局 + 互斥（139+ 断言）
cd server && npm run verify:liar      # 骗子酒馆引擎 + 出牌/质疑/左轮/托管/掉线（363 断言）
cd server && npm run verify:uno       # UNO 牌堆/规则/效果/AI 自对弈/联机状态机（310 断言）
cd server && npm run verify:xiangqi   # 中国象棋规则/将军/绝杀/困毙/AI/联机状态机（91 断言）
cd server && npm run verify:parkour   # 3D 跑酷引擎/关卡生成/机器人 + 联机状态机/排名/掉线/互斥（3602 断言）
cd server && npm run verify:aichat   # AI 对话纯函数（日期边界/配额/标题/DTO/联网搜索解析与上下文，82 断言）
cd server && npm run verify:chat     # 自建聊天：XML 解析/身份映射/XMPP 握手状态机/长轮询/票据/视图（98 断言）
cd server && npm run verify:pet      # 宠物系统纯函数：衰减结算/归零时刻/离家出走判定/等级与解锁/装扮清洗/目录不变量（721 断言）
cd server && npm run verify:raid     # 搜打撤 v2 共享引擎：地图确定性/连通性、房间类型、掉落、状态机、耐久维修、撤离、保险、契约（6285 断言）
cd server && npm run verify:raidstorage  # 搜打撤仓库/官方商店：等级表、存入规划（不自动出售）、回收价/商店价、装备箱档次（132 断言）
cd server && npm run verify:reader   # 小说阅读器纯函数：EPUB 元数据解析/zip 路径/实体解码/格式识别（32 断言）
cd server && npm run verify:redpacket  # 红包纯函数：二倍均值拆分不变量/边界/greeting 清洗/入参校验（3864 断言）

# 测试（仅 client/）
cd client && npm run test        # vitest run（57 个测试文件 / 594 个用例）
cd client && npm run test:watch  # vitest watch
cd client && npx vitest run src/components/drive/__tests__/PathBar.test.tsx  # 单文件测试

# Storage Node（本地机器）
cd storage-node && python main.py   # token 需与 server/.env 的 STORAGE_NODE_TOKEN 一致（或环境变量 LINEWEB_STORAGE_TOKEN）；可用 `cli token` 查询

# LineWeb CLI（本地机器，管理整套服务）
cd cli && npm run dev             # tsx 运行
cd cli && npm run typecheck       # tsc --noEmit

# 部署（阿里云 ECS Ubuntu + 1Panel + Docker Compose + PostgreSQL 16；代码在 /opt/lineweb）
# 先在本地 npm run build 并把 dist 传成 /opt/lineweb/client-dist/，再：
docker build -f Dockerfile.prebuilt -t lineweb-server:latest . && docker compose up -d   # 构建并启动（Express 容器 lineweb-server-1 + PostgreSQL 16 容器）
docker compose logs -f server         # 跟踪 server 容器日志
docker compose restart server         # 重启 server 容器
docker compose ps                     # 查看容器与健康状态
curl http://127.0.0.1:3001/api/health # 验收：{"status":"ok","db":"connected",...}
cd storage-node && python main.py     # 存储节点，config.json 指向 ws://120.24.223.65:8780/ws/storage
# 更新（服务器无法直连 GitHub，git fetch/reset 跑不通）：走镜像/代理，或从本地 git push 到服务器后走「本地产物 + Dockerfile.prebuilt」重建
# 本地开发/备用：npm run dev（公网 HTTPS 隧道已于 2026-10-31 移除）

# 备选/存档：systemd 直跑 tsx、PM2（ecosystem.config.js）、Nginx 反代（nginx.conf）
#   原 GitHub Actions SSH 自动部署 workflow（.github/workflows/deploy.yml）已删除
```

## 注意事项

- **Server 运行时使用 tsx** — 生产环境从不编译为 JS。根目录 `npm run build` 仅构建 client（且不做类型检查）。
- **生产需要 SQLite → PostgreSQL 的 schema 转换** — 本地开发用 SQLite，生产是 PostgreSQL 16 容器；容器首次启动时 `server/scripts/docker-entrypoint.sh` 会把 SQLite schema 改写为 PostgreSQL（`prisma/schema.pg.prisma`）后执行 `prisma db push`（首启带 `--accept-data-loss`）与 `prisma db seed`，这是生产链路的一部分，不是备选机制。
- **服务器无法直连 GitHub** — 该 ECS 直连 GitHub 极慢/不可达（实测 clone 两分钟只拉到约 200KB），代码是本地 `git bundle` 上传后 clone 的；因此 `git fetch && git reset --hard` 在服务器上跑不通，更新需走镜像/代理，或从本地机器 `git push` 到服务器（本地 → 服务器 SSH 可达）。
- **绝不在该 ECS 上跑 `docker compose up -d --build`** — 机器只有 2 vCPU / 1.6GB 内存（2G swap 已存在），仓库根 `Dockerfile` 的 Stage 1 是 `npm ci` + `npx vite build`，峰值约 1.2GB，会把整机拖进 swap 抖动：`web.linetech.online` 返回 Cloudflare `1033`、1Panel 面板 `:18080` 与 IP 直连 `:3001` 同时无响应、SSH 卡在 banner exchange，**同机其他站点（如 `aurora-center`）一起下线**（2026-10-24 实测踩过，最终靠重启服务器恢复）。`docker-compose.yml` 的 `deploy.resources.limits` 只限制运行期容器，**管不住构建过程**，不能当兜底。正确做法：本地 `npm run build` → 把 `dist` 传成 `/opt/lineweb/client-dist/`（该目录已 gitignore，且不在 `.dockerignore` 里，被忽略的是 `client/dist`）→ `docker build -f Dockerfile.prebuilt -t lineweb-server:latest . && docker compose up -d`（不带 `--build`），实测全程约 1 分钟、机器无压力。
- **域名入口已放弃、Cloudflare Tunnel 已移除（2026-10-31）** — 阿里云大陆节点按 Host 头拦截未备案域名（`403` + `Server: Beaver` + `Non-compliance ICP Filing`），此前靠 Cloudflare Tunnel 规避；因隧道入口规则长期指向已废弃的宿主 3001 端口（域名持续 502）且用户决定不再维护域名，cloudflared 服务/二进制/`/etc/cloudflared` 已全部删除，公网入口收敛为 **IP 直连 `http://120.24.223.65:8780`（纯 HTTP）**。要恢复域名/HTTPS 需先完成 ICP 备案或换非大陆服务器。
- **storageNode 来源已确认（2026-10-31）** — 生产 `/api/health` 显示 `"storageNode":"connected"`，容器日志 `Storage node connecting from ::ffff:58.253.109.135`：线上节点自外部 IP **直连**（不经任何隧道）。节点规范配置为 `serverUrl=ws://120.24.223.65:8780/ws/storage`，token 用服务器 `/opt/lineweb/.env` 的 `STORAGE_NODE_TOKEN`；仓库 `storage-node/config.json` 仍指向已不可达的 `ws://123.207.8.77:3001`（勿照抄）。
- **Storage node 是外部进程** — Python 进程运行在本地 Windows 机器上，未容器化。通过 WebSocket 以指数退避重连（最长 60s）方式连接到 `/ws/storage`；认证 5s 超时、心跳 30s。运行期间通过 `SetThreadExecutionState` 阻止系统休眠；文件 I/O 走线程池避免阻塞事件循环。
- **LineWeb CLI** — `cli/` 子项目打包为单文件 exe，双击即交互式管理本地服务（setup/start/stop/restart/status/update/logs/token）；`start` 默认生产模式；`autoupdate` 通过 Windows S4U 计划任务无人值守拉取更新；构建依赖 pkg 的 node22 基础二进制（缓存于 `~/.pkg-cache/v3.6`，丢失时需通过镜像下载）。
- **中文友好默认配置** — `.npmrc` 设置 npmmirror.com 镜像；文档使用中文。
- **更新强制覆盖** — CLI `update` 使用 `git reset --hard origin/master` 而非 `git pull`，避免本地改动导致更新冲突；未跟踪文件（`server/.env` 等）不受影响。
- **Cloudflare Tunnel（当前生产公网入口）** — ECS 上运行 `cloudflared`（systemd 服务，开机自启），公网流量经 Cloudflare 边缘（`https://web.linetech.online`）进入服务器本机 `127.0.0.1:3001`（无需为站点额外开放入站端口）；原生支持 WebSocket（网盘存储隧道、AI 流式响应均可用），实测 `wss://web.linetech.online/ws/storage` 握手 101；本地开发时也可用 `cloudflared tunnel run <name>` 把本机 :3001 临时暴露为公网 HTTPS。
- **Server 无测试框架** — `server/` 中无 vitest 等测试基础设施；2048 引擎/presence 用 `cd server && npm run verify:game` 自检脚本，斗地主用 `verify:ddz`（含 `createDoudizhuRoomForTest` 测试建房入口）。Playwright 是 client 依赖但无正式配置；本次联机/轮询冒烟用临时脚本完成（未提交）。
- **认证中间件跳过 13 个路径**：`/auth/login`、`/auth/register`、`/auth/avatar`、`/health`、`/posts`、`/pages/featured`、`/pages/slug`、`/stats/public`、`/version`、`/comments/post`、`/ai/chat`、`/oauth/token`、`/oauth/revoke`。白名单匹配用 `req.path === p || req.path.startsWith(p + '/')`（`req.path` 不含 `/api` 前缀），因此 `/health` 覆盖全部 `/health/*`（路由内部仍要求登录令牌），`/ai/chat` 也覆盖 `/ai/chat/public`；`/oauth/token|revoke` 用精确路径，避免前缀匹配放大暴露面。
- **唯一账号凭证是账号登录令牌** — API Key（`X-API-Key`）与屏幕时间 Token（`X-Screen-Time-Token`）已彻底移除（含 `ApiKey` / `ScreenTimeToken` 两张表与 `/api/api-keys`、`/api/health/tokens` 端点）；第三方设备登录同一账号后使用同一 JWT，可用 `rememberDays`（1–90）申请长期令牌，**或走 OAuth 授权流程**获得权限更小的应用令牌。
- **应用令牌必须走 `authenticate` 内的白名单校验** — `/health/*`、`/comments`、`/auth/avatar`、`/ai/*` 在公开路径白名单里，靠路由内再次调用 `authenticate` 兜底，因此应用令牌的端点白名单检查必须写在 `authenticate()` 内部（而非只放在全局中间件），否则这些端点会被应用令牌绕过。完整路径用 `${req.baseUrl}${req.path}` 拼接并**归一化末尾斜杠**（挂在 `/api/posts` 的 router 处理 `POST /api/posts` 时 `req.path` 是 `/`，否则匹配不上 `^/api/posts$`）。
- **令牌失效精确到毫秒** — 签发时写入自签 `ts` claim 与 `user.tokenValidAfter` 直接比较，因此登出/改密后同一秒内的旧令牌也会立即 401；下载票据（`/api/drive/download-ticket/:id`）同样带 `ts`。
- **下载票据有作用域限制** — `type === 'download'` 的票据只允许访问 `/api/drive/download/:id` 与 `/api/drive/files/:id/download`，其它端点一律 403（票据常出现在 URL / 浏览器历史 / 访问日志中）。
- **前端管理区按能力守卫** — `client/src/lib/permissions.ts` 的 `ADMIN_ROUTE_CAPABILITIES` 同时驱动侧边栏过滤（`AdminLayout`/`GitHubSidebar`）与路由守卫（`Guards.AdminCapabilityRoute`，挂在 AdminLayout 的 `<Outlet/>` 外）；缺能力时重定向到该账号第一个可用管理页，避免落到无权页面 403。
- **前后端能力清单有测试兜底** — `client/src/lib/__tests__/permissions.test.ts` 直接读 `server/src/lib/permissions.ts` 源码断言两份 `CAPABILITIES` 完全一致（服务端加能力而前端漏改会让 `npm test` 失败）；同理 `client/src/lib/__tests__/appScopes.test.ts` 读 `server/src/lib/appScopes.ts` 断言 scope 清单、标签/说明、以及端点白名单引用的 scope 全部合法。
- **应用令牌绝不会获得管理能力** — 签发时 `role:'app'` + 按 scope 授予能力，且服务端所有角色判断都走 `roleHasCapability()`，未知角色让全部角色型检查自动为假（含 `drive.ts` 的 `drive:all` 越权豁免），因此新增管理端点无需额外改动即对应用令牌关闭。仅当需要放行「能力派生 scope」（`content:write`、`comment:moderate`）时才依赖 `requireCapability()` 读 `req.user.capabilities` 的行为。
- **认证 API 禁缓存** — 除公开路径外，全局认证中间件设置 `Cache-Control: no-store` 并清空 ETag，避免 304 导致旧数据。
- **新增公开端点必须同步两处** — `index.ts` 的 `publicApiPaths` 白名单 + `cachePublic` 缓存策略。
- **`/api` 自描述端点** — `GET /api` 返回全部路由清单（需认证），排查路由问题时先看这里。
- **前端 Provider 顺序** — `BrowserRouter → QueryClient → Auth → Chat → Game → Theme → Download → RouteErrorBoundary → Suspense → Routes`；`DownloadToast` 与 `GameInviteToast` 在 Routes 外；ChatProvider 负责 `/ws/chat` 连接与未读角标，GameProvider 依赖 ChatProvider 的 `transport`，两者都需在 AuthProvider 内。
- **多个 WebSocket 服务共用端口** — `chatHub` 用 `noServer: true` 接管 HTTP server 的 `upgrade` 事件并按路径分发（`/ws/chat` → 游戏/好友事件，未知路径转交上一监听器），注册顺序为 `initStorageTunnel → initChatWsGateway（/ws/xmpp）→ initWebProxyWs → initChatHub`，每个 WS 服务都快照并转发未知路径；后续新增 WebSocketServer 需接入同一分发链。聊天消息走 `/ws/xmpp`（自建网关），游戏事件（`game:invite` 等）复用 `/ws/chat`，不新增 WS 服务。
- **无 WebSocket 降级** — `ChatContext` 暴露 `transport: 'ws' | 'polling'`；WS 不存在/构造失败/8 秒握手超时/断线时聊天与游戏改用 HTTP 轮询（聊天消息 10s、会话/摘要 30s、好友 60s；游戏对局 sync 2s、全局 sync 5s、presence 20s）。游戏在线判定 = `chatHub.isUserOnline` OR `gamePresence` 未过期（TTL 90s），掉线判负 120s。`?transport=polling` / `localStorage.lineweb_force_polling=1` 可强制轮询，`?transport=auto` 恢复。游戏 `sync`/`presence`/移动端点从全局 8000/15min 限流中精确豁免，由路由级按用户限流；聊天轮询不改服务端限流。
- **霓虹跑酷是 3D 本地模拟 + 2Hz 进度** — three.js 只允许在 `client/src/lib/games/parkourScene.ts` / `parkourModels.ts` / `parkourTextures.ts` import，页面必须 lazy 且在点击开始时动态加载（与「我的世界」共用 `three` chunk，不进主包）；服务端不做逐帧物理，`progress` 每 500ms 上报距离/金币/连击/车道/姿态，服务端做单调/速度上限/金币/车道校验，排名以收到 `finish` 的顺序为准。三车道一次碰撞出局，护盾/冲刺是客户端玩法；完赛/出局观众不阻塞其它游戏，`getActiveParkourMatch` 对他们返回 null。全屏 3D 用 portal 挂到 body，`ResizeObserver` + DPR 上限（粗指针 1.5 / 桌面 2）、WebGL context lost 提示与完整 dispose；进度上报不经过 `useOnlineGameRoom.submitAction`，避免其 inFlight 锁与旧 DTO 回退版本。
- **网盘配额是 BigInt** — `User.storageQuota` / `DriveFile.size` 均不能直接 JSON 序列化；`/api/drive/quota`、`/api/users`、上传 413 响应中的字节数一律用**字符串**；客户端用 `formatStorageSize` 展示。
- **上传配额有三道检查** — 解析前预检剩余空间、busboy 以 `min(单文件上限, 剩余空间)` 截断、写入后重新 SUM 复核并清理（DB 行 + 节点文件 + FTS）。本地无存储节点时 `/upload` 会先返回 503，配额全链路需在节点在线时验证。
- **聊天图片与网盘共用配额** — `driveQuota.getDriveUsage` = `DriveFile.size` + `Message.imageSize`（未撤回图片）；聊天图片写节点后**先落库再复核**（复核必须能看到本张图，否则并发上传各超一张），超限回滚消息行 + 删除节点文件。撤回图片会清空 image 字段并删除节点文件，配额立即释放；`storageSync` 必须排除 `_chat/`，否则聊天图片会被扫进网盘。
- **`compression` 过滤器要用 `req.originalUrl`** — 响应头阶段（onHeaders）执行时，Express 挂载路由会把 `req.path` 剥成路由内相对路径（如 `/messages/17/image`），用 `req.path` 匹配完整路径会失效。聊天图片路由已按此排除压缩（WebP 无需 gzip，且保留 `Content-Length`）。
- **第三方应用的 `content:write` 语义已收窄** — 应用只能管理所属账号自己的文章；`/api/pages*` 已从应用白名单移除，页面管理改为管理员专属 `content:manage`（breaking change，见 `docs/app-auth-api.md`）。

---

## 2026-10 账号体系综合改造（实现口径）

- **全站登录**：除 `/api/auth/login|register`、`/api/health`、`/api/version`、`/api/oauth/token|revoke`、`/api/features` 外，所有 API 需登录；`cachePublic` 已移除，认证响应统一 `no-store`。
- **限流**：认证前 IP 硬上限（默认 30000/15min）+ 认证后按用户 `User.apiRateLimit`（默认 8000/15min，0=不限）；管理员豁免全局与模块限流、AI 每日上限；管理端可逐个用户调整。启动时一次性把仍为旧默认 600 的账号回填到 8000（`SiteSetting('system.rateLimit.backfill8000')` 幂等标记，手工调过的值不覆盖）。游戏/聊天/AI 专用限流保留。
- **功能开关**：`FeatureFlag` 表 + `feature:manage`；19 个模块键；管理员始终可访问被关闭功能；关闭对普通用户返回 `403 FEATURE_DISABLED`。另提供 `PUT /api/admin/features/all` 批量开关全部键（须注册在 `PUT /:key` 之前），管理面板侧边栏「Line Web」品牌标题栏内置一键关闭/一键开启按钮（确认后调用并即时刷新全站开关）。
- **注册审核**：`User.status`（默认 active；新注册 pending）；pending/rejected 不能登录；管理员通过/拒绝；通过即自动加入官方大群、不可被聊天搜索。
- **游戏战绩**：`GameStat` 表；单机上报 + 联机结算回调；旧 localStorage 一次性导入；我的世界存档/贪吃蛇同屏仍本地；`/api/game-stats` + 排行榜 `/games/leaderboard`。
- **联系人备注**：`ChatContactSetting` 表（ownerId+targetUserId 唯一），仅自己可见、≤30 字；显示名 `remark || displayName || username`。
- **聊天增强**：群聊 @、单聊已读、拍一拍（普通消息 + XHTML 标记）、收藏他人表情、长按/右键气泡菜单。
- **科学计算器**：纯函数解析，无 eval；DEG/RAD、记忆、历史。
- **数据库**：`User.status/apiRateLimit/gameStatsImportedAt` + `FeatureFlag` + `GameStat` 均为 additive；`prisma db push` 后启动 `ensureFTSTable` 重建 FTS。生产仍走本地构建 + `Dockerfile.prebuilt`，不要在 ECS 上 `docker compose up --build`。

---

## 2026-10 聊天群公告 / 大群 / 站点公告（实现口径）

> **2026-10-31 更新：聊天已自建（脱离 neko）。** 全员大厅随 neko 删除；群公告三件套、官方大群与站点公告语义不变，实现改为 Prisma（`Conversation.announcement*` + `ConversationMember.announcementConfirmedAt`；大群见 `services/bigGroup.ts`，`SiteSetting('chat.bigGroupConversationId')`）。详见 `docs/chat-api.md` 第 0 章。

- **群公告**：`ChatRoomView` 带 `announcementUpdatedAt/announcementAckRequired/announcementConfirmedAt`；聊天页头部横幅可关闭（localStorage 按 `roomId + updatedAt` 记忆），群主/管理员可编辑并勾选「需要群员确认」，成员进群未确认时弹窗，`POST /api/chat/xmpp/rooms/:id/announcement-ack` 只写自己的成员行。
- **全员大厅已删除**（原 neko 内建，随 XMPP 迁移一并移除；`NekoRoom.isLobby` 字段已从前后端类型移除）。
- **LineWeb 用户大群**：`server/src/services/bigGroup.ts` 创建 `LineWeb 用户群` group 会话（`CHAT_BIG_GROUP_NAME`，群主 = 第一个 active 管理员），会话 id 存 `SiteSetting('chat.bigGroupConversationId')`；启动 20s 后对账 + 每 10 分钟周期对账，审核通过/拒绝/删除用户时增量同步；大群的成员/改名/解散/退群接口全部 403（只能由对账服务维护）。前端以 `isBigGroup` 标记「官方」，不提供退群入口。关闭 `CHAT_BIG_GROUP_ENABLED=false` 可停用。
- **站点公告（LineWeb 自有，非群公告）**：`SiteAnnouncement` 表 + `GET /api/announcements`（登录读生效）+ `/api/admin/announcements`（`content:manage` CRUD）；全站顶部公告条（`SiteAnnouncementBar`，Provider 在 `Layout`）+ 聊天页侧栏入口（`SiteAnnouncementDialog`）共用；管理页已并入 `/admin` 内容管理页「公告」Tab（旧地址 /admin/announcements 重定向）。
- **聊天传输默认长轮询**：`lib/realtime.ts` 的 `lineweb_chat_realtime`（默认关闭），聊天设置开关持久化并立即重连；聊天默认走 `http-*` 长轮询，开启后才尝试 `/ws/xmpp`，失败自动降级。站内 `/ws/chat`（好友/游戏事件）不受该开关影响。
- **聊天界面增强**：日期分隔（今天/昨天/日期）、同发送者 5 分钟消息聚合、会话本地搜索、置顶标记、官方标签、回到最新、群成员搜索、公告横幅/待确认、设置浮层。
- **数据库**：`SiteAnnouncement` / `SiteSetting` 为 additive，`prisma db push` 即可；生产仍走本地构建 + `Dockerfile.prebuilt`，不要在 ECS 上 `docker compose up --build`。

---

## 2026-10 统一积分与开心农场（实现口径）

- **统一积分**：`PointsLedger` 是唯一台账，`User.points/pointsEarned` 为汇总余额与累计；`PointsConfig` 单行存 10 款游戏的胜/负/平/参与/表现加成/日上限，以及农场偷菜比例、每日偷菜次数、开荒礼包积分；日上限只压正向收益，自然日按 Asia/Shanghai 0 点切换（`lib/pointsRules.ts` 双端同拷贝）。
- **结算路径**：单机由 `POST /api/game-stats/result` 在写 `GameStat` 的同一事务里发分并返回 `{ stat, points }`；联机由 `gameStatsHooks` 的 `recordOnlineMatchResult` 逐人结算。前端 `GameStatsContext`（单机）与 `GameContext`（联机结束 1.5s 后）刷新积分。
- **商店 / 称号**：`PointsShopItem`（`title` / `emoji` 两类，payload 存颜色、图标、表情包 key）→ 购买写 `UserPointsItem`，佩戴写 `User.equippedTitleId`；称号只在 LineWeb 站内展示（顶部导航、个人资料、积分榜、战绩榜），不写入 neko。`emoji_<pack>` key 解锁聊天表情商店的奶龙 / 呆猫 / Twemoji 包（团子 / 橘猫 / 符号免费）。
- **权限**：新增 `points:manage`（admin 全权），管理页 `/admin/points` 覆盖游戏规则、商品增改、用户调分与统计；前端 `ADMIN_ROUTE_CAPABILITIES` + 跨端能力清单测试同步。
- **开心农场**：`Farm / FarmPlot / FarmItem / FarmSteal` 四表；作物目录与纯函数在 `server/src/lib/farmCrops.ts`（客户端只用 `/api/farm` 下发的 catalog，不复制数值）；生长按 `readyAt` 判定，服务端不跑定时器；施肥把剩余时间减半（至少 10 秒，每茬最多 2 次）；扩建 6→9→12→15→18（500/1500/3000/6000 积分）；偷菜受每日上限（默认 10）限制，同一茬每人只能偷一次，每块地至少留 1 单位给地主，小偷得 `floor(value × 0.6)`（≥1）。
- **farm 功能开关**：新增 `farm` 键（依赖 `games` 总开关），`/api/farm` 与 `/games/farm` 都受控，大厅卡片随开关隐藏。
- **新路由**：`/api/points/*`（全部需登录）、`/api/farm/*`（`requireFeature('farm')` + 路由级限流 180/5min，偷菜 40/5min）、`/api/admin/points/*`（`points:manage`）。
- **自检**：`cd server && npm run verify:points`（165 断言：游戏规则、上海日界、配置归一化、商品载荷清洗、作物目录不变量、施肥/偷菜/扩建）。
- **数据库**：`PointsLedger / PointsConfig / PointsShopItem / UserPointsItem / Farm / FarmPlot / FarmItem / FarmSteal` 与 `User.points/pointsEarned/equippedTitleId` 均为 additive，`prisma db push` 即可；生产仍走本地构建 + `Dockerfile.prebuilt`，不要在 ECS 上 `docker compose up --build`。

---

## 2026-10 农场 / 积分 / 机制调优（实现口径）

- **农场收益与随机化**：18 种作物 `value` 全部 ×2（种子价不变）；偷菜改为概率成功（`FarmPointRule.stealSuccessRate` 默认 0.65），失败返回 `success:false` 且**不扣每日次数、不写 `FarmSteal`、不减地块产量**；新增地主每日被偷上限 `victimDailyStealLimit`（默认 10，0 = 当天不可被偷，按 `FarmSteal.victimId + 当日` 统计，邻居/地块与本人都下发 `victimQuota`）；每日首次进农场按 tier 加权随机掉 1..`seedDropMax` 颗种子（`Farm.lastSeedDropDate` CAS 抢占，并发只发一次）；`FarmMerchantOffer` 每日随机 3 件（种子/肥料、折扣 40%–70%），积分购买后不可重复，跨日刷新返回 410 `MERCHANT_EXPIRED`。
- **积分双向日上限**：`GamePointRule.dailyLossCap`（0 = 不限）与 `dailyCap` 对称；负数结算按当日该游戏负流水绝对值截断，达到上限仍可继续游戏，战绩照常写入、积分 delta 为 0。`savePointsConfig` 改为「读旧配置 → 深合并 → normalize → 保存」，`clampFloat` 用 `Number.isFinite` 判断（0 不被默认值吞掉）。
- **每日签到**：`DailyCheckin`（`userId + dateKey` 唯一，Asia/Shanghai 日界），奖励 `base + min(streakMaxBonus, (streak-1) × streakStep)`，重复签到 409 `CHECKIN_DONE`；`GET /api/points/me` 的 `checkin` 下发今日/连签/明日可得。
- **头像框**：`PointsShopItem.type = avatar_frame`，payload `frame` 白名单 `gold|neon|sakura|galaxy`；佩戴写 `User.equippedAvatarFrameId`，只在 LineWeb 站内展示（`UserAvatar` 外框包裹层），**不同步 neko**；头像框种子标记独立（`points.shop.frames.seeded`），不会复活已删商品。
- **单机榜一传说称号**：`GameLeaderTitle`（每个 game 一行）；扫雷以 `expert` 为代表项（`SOLO_LEADER_VARIANTS`），其余为 `solo`；`recordSoloResult` 提交后按游戏 2s debounce 重算 + 启动 30s 全量重算；仅换人时发 `leader_bonus`（同日同游戏 `PointsLedger` 去重，`game:null` 不占游戏日上限）。前端 `UserTitleBadge` 支持 `rarity=legendary` 金色流光（`prefers-reduced-motion` 关闭）。
- **模拟股市**（2026-10-31 起实时化，详见下方「股市实时化」章节）：日线锚点仍由 `server/src/lib/stockMarket.ts` mulberry32 确定性生成（8 只股票 30 日 OHLC、同日稳定、相邻日连续）；报价改为 3 秒 tick 实时行情（`stockTicks.ts`），玩家交易小幅影响价格；功能键 `stock`（分组「工具」），前端 `/stocks` 进入前弹窗声明「模拟行情」。
- **聊天治理（`chat:manage`）**：`/admin/chat` 搜索账号并封禁/解封；`ChatBan` 表 + 30s 内存缓存，`/api/chat*`、聊天图片/头像直链与 `/ws/xmpp` 握手返回 `403 CHAT_BANNED`（含原因），封禁时通过自定义关闭码 4003 断开该账号全部聊天会话（WS + 长轮询）；管理员不可被封禁。聊天页对封禁显示整页说明并停止重连。
- **免打扰 / 快速回复（纯前端）**：`localStorage lineweb_chat_dnd` 控制全局新消息 Toast（`pushMessageNotice` 首行短路），未读与 @ 角标照常；会话头部显示「免打扰中」。新消息提示内新增「快速回复」：4 个常用短语 + 输入框直接 `sendText` 到该会话、不跳页，展开时暂停自动消失。
- **新增表**：`FarmMerchantOffer`、`DailyCheckin`、`GameLeaderTitle`、`ChatBan` 与 `Farm.lastSeedDropDate`、`User.equippedAvatarFrameId` 均为 additive；`prisma db push` 即可。
- **新路由/管理页**：`/api/farm/merchant/:offerId/buy`、`POST /api/points/checkin`、`POST /api/points/shop/:id/equip-frame`、`DELETE /api/points/equipped-frame`、`/api/stocks/market`、`/api/admin/chat/*`；管理页 `/admin/chat`，积分/农场/签到/榜一参数集中在 `/admin/points`。
- **自检**：`cd server && npm run verify:points`（337）、`verify:gamestats`（81）、`verify:stocks`（9199）；`cd client && npm run test`（48 文件 / 538 用例）。
- **部署**：2026-10-29 已按本地产物链路上线（`781bb62`）：本地 `cd client && npm run build` → dist 覆盖 `/opt/lineweb/client-dist` → `docker build -f Dockerfile.prebuilt` + `docker compose up -d`；容器启动日志显示 PostgreSQL schema 同步完成。

---

## 2026-10 称号特效 / 榜一佩戴 / 股市积分投资（实现口径）

- **称号特效由 `rarity` 驱动**：`UserTitleDto` 统一带 `rarity`（shop 商品继承配置；榜一传说恒为 `legendary`）；`UserTitleBadge` 在 `rarity==='legendary'` 时渲染光环 + 4 颗粒子火花 + 旋转锥形光线（`points.css`，`prefers-reduced-motion` 降级为静态）。凡是走统一 DTO 的位置（顶部导航、个人资料、积分榜、战绩榜、农场邻居/地主、聊天 titleMap）自动带特效。
- **统一“有效称号”口径**：`effectiveTitleDto()` 依次取 已佩戴商店称号 → 已佩戴榜一称号（必须仍属于本人）→ 无；`setEquippedTitle` 与 `setEquippedLeaderTitle` 互斥，`DELETE /api/points/equipped-title` 两者一起清空；榜一称号易主时 `gameLeaderTitleService` 在重算事务内清空旧主的 `equippedLeaderTitleId`。
- **榜一称号佩戴**：`User.equippedLeaderTitleId` + `GameLeaderTitle.id` 关系（additive）；`POST /api/points/leader-titles/:id/equip`，`GET /api/points/me` 下发 `equippedLeaderTitle`，`/api/points/shop` 下发 `equippedLeaderTitleId`。
- **股市积分投资**：`StockHolding`（`userId+code` 唯一，`shares Float`、`costPoints Int`）；买卖各收 1% 手续费（最低 1 积分），单笔 100–100,000 积分，`quoteStockBuy` / `quoteStockSell` 纯函数在 `server/src/lib/stockTrading.ts`；`POST /api/stocks/buy`（`stock_buy` 流水）、`POST /api/stocks/sell`（`stock_sell` 流水，支持 `shares` 部分卖出）、`GET /api/stocks/portfolio`；行情为 3 秒实时 tick（见「股市实时化」章节），玩家买卖会小幅推动价格，当日往返不再「必亏」但手续费仍是固定摩擦成本。
- **自检**：`cd server && npm run verify:stocks`（9199）、`verify:points`（337）、`verify:gamestats`（81）；`cd client && npm run test`（48 文件 / 538 用例）+ `npm run build`。
- **数据库**：`StockHolding`、`User.equippedLeaderTitleId`、`GameLeaderTitle.id` 均为 additive，`prisma db push` 即可；部署仍走本地产物链（不要在 ECS 上 `docker compose up --build`）。

---

## 2026-10-31 股市实时化：3 秒 tick 行情引擎 + 玩家交易冲击（实现口径）

- **删除「闭市」机制**：行情不再「当天冻结在当日 close、0 点刷新」，改为 **3 秒一 tick 的实时行情**（`STOCK_TICK_MS = 3000`、每日常数 28800 tick，`server/src/lib/stockTicks.ts`）；日线锚点与 30 日历史 K 线全部不变（`simulateStock` 日生成器原样保留，历史数据零变化）。
- **三层价格模型**：① 日线锚点（不动）；② 秒级基准路径 `basePath(tick) = anchor(tick) × (1 + noise(tick))`，anchor 由今日 open 线性插值到今日 close，noise 为 OU 式均值回归随机游走（种子 `lineweb-stock-tick:${code}:${dateKey}`，σ_tick = volatility × √(TICK_MS/86_400_000) × 2.0，每 tick ×0.993 回归），按 (dateKey, code) 惰性延展 + 双 Float64Array 缓存（basePath + 物化价，约 460KB/股/日，只保留当日），重启从 tick 0 重算 → **重启价格零跳变**；③ 玩家冲击 `impact`：`livePrice = basePath(tick) × (1 + impact)`，买入 `impact += points × 2e-7`（每 1 万积分 +0.2%）、卖出按毛收入负向，clamp ±5%，读时惰性指数衰减（半衰期 10 分钟），**无定时器**。
- **冲击持久化**：`SiteSetting('stock.marketImpact')` JSON（`{savedAt, impacts}`），在买卖事务内与积分扣减原子 upsert；启动懒加载并按 savedAt 差值衰减，解析失败一律重置为 0。lib 层（`stockTicks.ts`）不 import prisma，读写留在 `stockService.ts`。
- **零玩家也活跃 / 50 人可运作**：行情由确定性引擎驱动，不依赖任何玩家参与（模拟资金托底）；`/market` 与 `/market/trend` 加入 `apiLimiterSkipPaths` 全局限流豁免（游戏 sync 同款机制），路由级限流 market 40/min、trend 20/min、交易仍 60/5min（均按用户、admin 豁免）；纯内存计算，50 用户 × 3s 轮询 ≈ 17 QPS。
- **API 变更**：`GET /api/stocks/market` 轻量化（`StockQuote` 去掉内嵌 history，新增 `tickMs/tickIndex/updatedAt`，disclaimer 改「每 3 秒刷新…玩家交易会小幅影响价格」）；新增 `GET /api/stocks/market/trend?code=`（近 30 根日线——今日一根为实时 candle——+ 今日分时采样点每 60s 一点，`t` = 当日 00:00 Asia/Shanghai 起毫秒）；`POST /api/stocks/sell` 支持 `shares?` **部分卖出**（缺省整仓向后兼容；成本等比分摊 `splitCostForShares`，返回新增 `remainingShares/closed`）；买卖成交价与持仓估值全部按实时价（`getLiveQuoteByCode`）。
- **前端**（`StocksPage.tsx` + `types/stock.ts` + `stocks.css`）：行情 3s 轮询（`document.hidden` 暂停、失败保留旧数据 + 10s 退避自愈、visibilitychange 恢复可见立即刷新）、走势 30s 轮询 + 切换股票即拉（过期响应按自增 id 丢弃）；图表「分时 / 日线」双模式切换（分时含昨收虚线基准与实时末端点）；卖出对话框支持 25%/50%/全部 份额快捷 + 预估到账；`|涨跌幅| ≥5%` 「异动」、`≥9%` 「强烈异动」badge（纯提示，不限制交易）+ 价格红绿闪烁（`prefers-reduced-motion` 降级）；`client/src/lib/features.ts` 与 `server/src/lib/features.ts` 的 stock 描述同步为实时口径。
- **无 schema 变更**（复用 SiteSetting）；自检 `cd server && npm run verify:stocks`（9199 断言：日线回归 + tick 确定性/噪声有界/日界衔接/冲击纯函数与序列化容错/新 DTO 契约/分时采样）；`cd client && npx tsc --noEmit` + `npm run build` + `npm run test`（48 文件 / 538 用例）；部署仍走本地产物链（不要在 ECS 上 `docker compose up --build`）。

---

## 2026-10 反代同族子域（B 站登录修复，实现口径）

- **根因**：B 站是多子域站点——登录在 `passport.bilibili.com`、数据接口在 `api.bilibili.com`，而反代此前只改写「站点 origin + 资源 CDN（hdslb.com/biliimg.com）」。跨主机绝对 URL（`//passport.bilibili.com/login`、`//api.bilibili.com/x/web-interface/nav`）原样保留：登录点击会跳出反代进真实站点（Cookie 进不了服务端罐），接口直连被 B 站 403（实测外来 Origin 直接拒绝）。改 Referer/CDN 规则修不好登录。
- **站点族（同注册域子域）**：`webProxyService.ts` 新增轻量 PSL（`MULTIPART_PUBLIC_SUFFIXES` 三段式后缀表 + `FAMILY_TLDS` 单段 TLD 白名单）计算注册域 `registrableDomainOf()`；表外 TLD 返回 null 不启用族扩展（保守回退旧行为）。站点是 `www.bilibili.com` 时族 = `bilibili.com`。
- **内嵌主机路径形态**：`/proxy/<siteId>/<scheme>/<host>/<path>`（如 `/proxy/15/https/passport.bilibili.com/login`）。`webProxy.ts` 主链路解析该形态，仅接受与站点 origin 同注册域的主机；target 用内嵌主机构建，SSRF / 黑名单仍逐跳 `assertPublicHost`。同源重定向的 `Location` 改写按「目标主机是否为站点主机」分别回普通前缀或内嵌形态。
- **服务端 URL 改写**：`mapUrlToProxy` / `mapResourceUrl` / `rewriteBaseTag` 按优先级匹配 站点主机（普通前缀）→ 族内兄弟子域（内嵌形态）→ 资源 CDN（`__lw_res__`）→ 族外保持。文档来自兄弟子域时（`ctx.activeOrigin` ≠ `siteOrigin`），根相对 URL 与活动主机绝对 URL 也映射到内嵌形态（根相对属于活动主机）。`proxyUrlToUpstream` 还原内嵌形态的 Referer。
- **引导脚本**：`webProxyBootstrap.ts` cfg 新增 `pageOrigin`（本文档真实上游 origin）与 `family`；`mapHttpUrl`/`mapWsUrl`/`pushState` 钩子同样按 站点主机 → 族内 → CDN → 扩展名 分流；**查询参数重映射**（如登录页 `?goUrl=https%3A%2F%2Fwww.bilibili.com%2F...` 在 bootstrap 里 replaceState 改写成反代路径，应用代码后读 location.search，登录成功后 `location.href=goUrl` 跳回反代内不跳出 iframe）；新增 `HTMLScriptElement.src` / `HTMLIFrameElement.src` 属性钩子（与 img/media 一致走 mapHttpUrl）。
- **WS 中继**：`webProxyWs.ts` 支持 `/proxy-ws/<id>/<https|http>/<host>/<path>` 内嵌主机形态（限同族），`origin` 头与 Cookie 按内嵌 origin 取。
- **自检**：`cd server && npm run verify:webproxy`（213 断言：注册域计算、族内/族外 URL 与 WS 映射、内嵌形态 Referer 还原、兄弟子域文档根相对地址、引导脚本 family/pageOrigin 注入）；本地端到端已实测：反代内登录页二维码渲染、`qrcode/generate`/`qrcode/poll`/`captcha` 接口全部走代理、goUrl 重映射生效、首页点「登录」弹窗二维码正常且 URL 不跳出。
- **无数据库改动**，部署仍走本地产物链（本地 `npm run build` + `Dockerfile.prebuilt`，不要在 ECS 上 `docker compose up --build`）。

---

## 2026-10-31 宠物系统 + 主打游戏改农田（实现口径）

- **宠物系统**（详见上表「宠物系统」行）：每用户一只 2D 小宠物（猫/狗/鸟，inline SVG + CSS 动画），REST 前缀 `/api/pets`（需登录 + `pet` 功能开关，写端点 120/5min）。花积分召唤（300）/喂食（10，L1）/洗澡（15，L2）/玩耍（20，L3）/升级（100×当前等级，满级 10）/买装扮（150–800，hat/neck/face 三槽 7 件）；抚摸免费（60s 冷却心情+2）；特技按等级解锁（L4–L10：跳舞/翻滚/唱歌/后空翻/转圈圈/魔法秀/烟花庆祝，免费纯动画）。状态随时间惰性衰减（饱食 -4/h、清洁 -2/h、心情 -3/h，无定时器、读时线性结算），任一项归零满 **48 小时**宠物离家出走（`Pet.status='gone'`，读时翻转、照顾一律 409 `PET_GONE`；重新召唤复用同一行：等级/数值/佩戴重置，**已购装扮保留**）。UI：`/pets` 页（侧边栏「宠物」入口，`RequireFeature('pet')`），状态条 <20 红色预警 + 离家出走倒计时，30s 可见时轮询。
- **主打游戏改为农田**：游戏大厅「主打」大卡 = `GAME_CATALOG` 数组第一款（`GamesPage.tsx` 把 `PLAYABLE_GAMES[0]` 渲染成 featured），本次把 `farm` 条目移到 `client/src/lib/games/catalog.ts` 数组首位（原为 2048），并补了 `.gh-games-cover[data-game='farm']` 绿色渐变封面；`game2048.test.ts` 的目录顺序断言已同步。farm 功能开关关闭时主打自动回落为下一款（2048）。要再换主打游戏，调整 `GAME_CATALOG` 数组顺序即可（并同步 game2048.test.ts 的两处顺序断言）。
- **数据库**：`Pet` / `PetOutfit` 与 `User.pet` 反向关系均为 additive，`prisma db push` 即可；本地 SQLite `db push` 若撞 `drive_files_fts` 影子表，先 `DROP` 全部 FTS 虚拟表再 push（启动时 `ensureFTSTable` 自动重建）。
- **功能开关**：`pet` 键（独立，不依赖 games 总开关），server/client 两份 `features.ts` 已双写，`/admin/features` 管理页数据驱动自动出现。
- **自检**：`cd server && npm run verify:pet`（146 断言）；`cd server && npx tsc --noEmit` 零错误；`cd client && npx tsc --noEmit` + `npm run test`（50 文件 / 542 用例）+ `npm run build` 全过；本地 API 冒烟已实测（召唤/重复召唤 409/喂食满腹 400/等级门槛/抚摸冷却/升级/购买重复 409/佩戴/改名/离家出走翻转/重新召唤重置），浏览器视觉验收通过（小狗立绘、抚摸爱心、围巾佩戴、喂食动画、主打农场大卡）。

---

## 2026-10-31 个人空间 Personal Space（实现口径）

- **定位与权限**：仅管理员的私人服务页 `/personal-space`（App.tsx 懒加载、挂 AdminLayout 路由组由 `AdminCapabilityRoute` 守卫；管理面板侧边栏「个人空间」入口）；能力 `personal:manage` 仅 admin（admin 走 ALL_CAPABILITIES 自动全权，user/author 403）；应用令牌不在 appScopes 白名单 → 403；不加 FeatureFlag（管理员天然绕过开关）、不加模块限流（全局限流覆盖）。路由 `router.use(authenticate, requireCapability('personal:manage'))` 为 router 级守卫，未来新增端点自动被覆盖。
- **数据模型与隔离**：`PersonalSpace`（`@@map("personal_spaces")`，`userId @unique` + User 反向关系 `personalSpace`、`onDelete: Cascade`），每管理员一行按 `userId` 隔离，端点无路径参数、读写一律取 `req.user.userId` → 无跨管理员面。`spaceName` DB 默认「个人空间」，**GET 首访 upsert 自动建行**，默认名取 `<用户名> 的私人空间`（用户名超长自动截断保证总长 ≤30，与 PUT 的 1–30 字校验一致）——满足「每个管理员的私人空间名都不一样」，改名后即各不相同。
- **API**：`GET /api/personal-space`（取本人空间，缺失自动建）+ `PUT /api/personal-space`（**整体保存语义**：spaceName 1–30 字；RustDesk 四字段各 ≤200 可空，`rustdeskWebClient` 非空必须 `http(s)://` 开头防 `javascript:` 注入；未传可选字段等同空串清除）；DTO 可空字段统一输出 `""`；`GET /api` 自描述清单已同步。
- **RustDesk 服务（配置卡片＋快捷连接）**：保存 ID 服务器 / 中继服务器 / 公钥 Key / Web 客户端地址（均可选）；页面提供配置一键复制（`navigator.clipboard` 优先、`document.execCommand('copy')` 降级——生产为 IP 直连纯 HTTP、clipboard API 不存在，该降级是复制可用的关键）、打开 Web 客户端（新窗 `noopener,noreferrer`）、被控 ID 去空白后校验纯数字再拼 `rustdesk://connection/new/<id>` 深链唤起本机客户端；改名保存不会重置 RustDesk 表单草稿；底部留「更多服务即将上线」扩展位，后续私人服务在此页加卡片。
- **数据库**：`PersonalSpace` 为 additive，`prisma db push` 即可；生产走本地构建 + `Dockerfile.prebuilt`（docker-entrypoint.sh 自动 db push），不要在 ECS 上 `docker compose up --build`。
- **自检**：`cd server && npx tsc --noEmit` 零错误；`cd client && npx tsc --noEmit`（须用 client 本地 tsc，根目录 npx 会解析到 TS6 对 `baseUrl` 误报）+ `npm run build` + `npm run test`（50 文件 / 542 用例，含前后端能力清单一致性）；PORT=3002 API 冒烟（admin 200 自动建行/PUT 持久化、author 403、匿名 401、`javascript:` 地址 400）；详见 `docs/personal-space-api.md`。

---

## 2026-10-31 侧边栏抽屉 / 管理面板融合 / 公共网盘（实现口径）

### 侧边栏统一抽屉（修复平板/手机「有时无法收起」）

- **根因**：768–1279px（平板/手机横屏）被 responsive.css 强制为 64px 常驻窄轨且该区间无汉堡按钮、无遮罩——iPad 永远收不起来；手机抽屉内「收起」按钮被 `--open` CSS 压制成无效按钮；跨断点旋转时 `mobileOpen` 残留；AdminLayout 遮罩内联 `display:block` 压过媒体查询。
- **修复口径**：≤1279px 全部为「汉堡 + 遮罩抽屉」（抽屉规则从 ≤767px 上移到统一 ≤1279px 媒体块，窄轨规则删除）；≥1280px 保持常驻侧栏 + 收起按钮。`.gh-visible-mobile`（仅两处汉堡按钮使用）断点 ≤767 → ≤1279。Layout/AdminLayout 均加 `matchMedia('(max-width: 1279px)')` 监听：跨回桌面档自动复位抽屉状态。GitHubSidebar/AdminLayout 的「收起」按钮在抽屉态直接关闭抽屉（`matchMedia` 判定，不引入 re-render）。主站与管理面板两套侧边栏行为完全一致。

### 管理面板融合简化（16 项导航 → 10 项分组结构）

- **页面合并**（Tab 容器 + `?tab=` URL 持久化，复用现成 GitHubTabNav）：`/admin` 内容管理 = 文章+页面+公告+评论四合一（Tab 按能力过滤：文章 content:write、页面/公告 content:manage、评论 comment:moderate）；`/admin/users` 用户与设备二合一（设备 Tab 需 device:view）；`/admin/ai` AI 设置 = AI 助手+AI 对话二合一。原 8 个页面改为导出 Panel 组件 + 兼容默认导出（`AdminTabShell.tsx` 为通用 Tab 壳）。
- **旧地址 redirect**（`<Navigate replace>`，ADMIN_ROUTE_CAPABILITIES 保留原守卫语义）：`/admin/pages→/admin?tab=pages`、`/admin/announcements→/admin?tab=announcements`、`/admin/comments→/admin?tab=comments`、`/admin/devices→/admin/users?tab=devices`、`/admin/ai-chat→/admin/ai?tab=chat`。
- **AdminLayout**：侧边栏按 内容/用户/AI/运营/平台 分组（复用主站 `.gh-sidebar-section-title` 样式，折叠态自动隐藏标题）；顶栏 `<h1>` 从静态「管理面板」改为按路由动态显示；「写文章」不再是导航项（内容管理页内新建）。服务端端点与能力零改动。

### 公共网盘（管理员维护，全员只读）

- **Schema**：`DriveFile.isPublic Boolean @default(false) @map("is_public")`（additive，db push 即可）。公共根条目 storagePath 统一 `_public/<name>` 前缀，子级自然继承。
- **权限模型**：`assertFileOwnership` → `assertFileAccess(fileId, user, mode)`——read：公共文件对所有过网盘入口守卫的用户放行；write：仅 drive:all 或 owner（公共文件普通用户永远不可写，资源级拒绝沿用 404 不暴露存在性）。`assertParentFolderAccess` 加 scope：父 isPublic 必须与目标区一致；**有 parentId 时一律以父的 isPublic 定区（防参数伪造），根级才信请求参数**。列表/搜索/FTS/resolve-path 均加 `scope` 参数（private 默认；private 非 admin 只看本人私有，admin 看全部私有）。
- **写入路径**：建夹/上传支持 `scope=public`（非 drive:all → 403「公共网盘仅管理员可维护」）；`PUT` 移动禁止跨区（400「不能在公共网盘与我的网盘之间移动文件」，移到根保持自身区域）；同名冲突检查按区域隔离（公共根与私有根同名互不冲突）。
- **配额与同步**：`driveQuota.getDriveUsage` 排除 isPublic（公共盘不计入任何个人配额，受节点磁盘总容量约束）；`storageSync` SYSTEM_DIRECTORIES 加 `_public` 且孤儿清理排除 isPublic 行——**否则每 5 分钟周期同步会把全部公共盘 DB 记录误删**（实测踩过：公共行被清后节点文件残留，重传同名文件撞 WinError 183）。
- **顺带修复的上传挂起竞态（先于本功能就存在）**：busboy `close` 与异步写失败竞态——小文件时 close 先触发（fileError 还是 null 走不到响应分支），节点流错误（如目标文件名冲突/磁盘满）后到时无人发响应，请求永久挂起。修复：`respondErrorIfSettled()` 统一出口，`bbClosed/fileError/headersSent` 三条件，close 与错误路径谁后到谁补发；顺带把流中段权限错误（无权/公共网盘）映射 403（原全部 502）。
- **前端**：DriveContext 加 `scope` 状态（切区重置路径/选择/搜索，公共根面包屑「公共网盘」）；DriveNavigation 顶部「我的网盘 / 公共网盘」分段切换（收藏区仅私有显示）；DrivePage `canWriteHere = scope==='private' || can('drive:all')` 统一门控全部写入口（头部按钮/键盘快捷键/右键菜单/批量操作/详情面板/FolderPicker/UploadZone/移动端壳）；私有显示配额条、公共显示「公共网盘 · 由管理员维护」提示条；移动端壳同步。
- **验证**：API 冒烟 31 项（建夹/上传/列表/下载/隔离回归/写拒绝/防伪造/跨区移动/搜索 FTS scope/配额口径）；浏览器双区切换与 UI 建夹实测；`verify:webproxy` 等既有自检不受影响。生产部署走本地产物链（docker-entrypoint.sh 自动 db push），无需额外动作。

---

## 2026-11-01 小说阅读器 + 网易云音乐（实现口径）

- **小说阅读器（reader）**：上传 EPUB/TXT（≤50MiB/本）在线阅读。服务端 `readerService.ts` 用 jszip 解析 `container.xml → OPF`（纯函数 `parseOpfMetadata`，verify:reader 32 断言）取标题/作者/内嵌封面（sharp→宽 300 WebP），解析失败回退文件名不阻断上传；书存节点系统目录 `_books/<userId>/`（storageSync SYSTEM_DIRECTORIES 已加 `_books`，drive.ts 根级保留名自动覆盖、上传报错文案已同步）；`Book` 文件 size **计入网盘配额**（driveQuota 第 5 聚合）、封面不计；三段式配额（预检 413 → busboy 按 min(上限, 剩余) 截断 → 写后复核回滚行+删节点文件）。`BookProgress` 按 `[bookId,userId]` 唯一 upsert：epub 存 foliate CFI、txt 存 `{chapter,offset}` JSON，`percent` 0–1；file/cover 直链属主校验 + `?token=` + `private, immutable` 缓存，compression filter 已按 `\/reader\/books\/\d+\/(file|cover)` 排除。前端 EPUB 渲染用 **vendored foliate-js 快照**（`client/src/lib/reader/foliate/`，commit 78914ae，MIT；npm 禁 git 依赖 EALLOWGIT 故 vendor，pdf.js 为 stub——13MB pdfjs 未引入，PDF 走网盘 DrivePreview；`epubReader.ts` 是唯一 TS 边界，动态 import 生成独立 `foliate` chunk ~167KB、点开书才加载，vite manualChunks 按路径 `lib/reader/foliate/` 分包）；TXT 前端 `decodeTxt`（UTF-8 严格解码失败→GB18030）+ `splitTxtChapters`（第X章/卷/回 + 序章/楔子/番外/Chapter N 正则，无命中退化空行短行启发式，12 个测试用例）；阅读页功能：目录抽屉/主题（明亮·羊皮纸·夜间，经 load 事件向章节 iframe 注入 style）/字号 14–28/分页与滚动/键盘翻页，进度 2s 防抖保存 + pagehide/visibilitychange 冲刷。侧边栏「探索」组新增「小说」入口。
- **网易云音乐（music）**：`@neteasecloudmusicapienhanced/api@4.41.1`（原 Binaryify 归档后的社区维护分支）**库挂载**进现有 Express 进程——`neteaseMusic.ts` 的 `callNcmRaw` 函数级调用（带 `timestamp` 防缓存、15s 超时 unref、包按需懒加载不拖慢启动），**不新增容器/进程**。解灰绝不启用（query 永不带 `unblock` 参数即不触发；compose 另显式 `ENABLE_GENERAL_UNBLOCK=false`、`ENABLE_PROXY=false`）；**只做扫码登录**：`login/qr/prepare`（key+qrimg）→ 前端 1.5s 轮询 `login/qr/check`（800 过期/801 待扫/802 待确认/**803 成功→取响应 cookie upsert `MusicAccount`**，cookie 含 MUSIC_U 仅存服务端永不回传）；上游 301（登录过期）→ 清绑定抛 401 `MUSIC_SESSION_EXPIRED` 引导重扫。未绑定匿名态（包内自动匿名 token）可搜索/听免费歌，VIP 歌 30s 试听；`song/url/v1` level 白名单 standard/higher/exhigh/lossless/hires 默认 exhigh；每日推荐 `MUSIC_NOT_BOUND` 400。**音频默认走网易 CDN 浏览器直连**（健康设备 ECS 带宽零消耗）——helmet CSP 新增 `mediaSrc: ['self','https:','http:']`（全站唯一安全面放宽，仅音视频外链源）；**设备无法直连网易 CDN 时自动降级到服务器中转**（2026-11-01）：`GET /api/music/stream?id=&level=&token=` 用 `resolveSongStream`（5 分钟内存缓存）解析地址并经白名单校验后流式转发（透传 Range/If-Range、强制 identity、逐跳复核 302，返回 206 + Content-Range/Accept-Ranges），封面走 `GET /api/music/image?u=&token=`（只代理网易 CDN 主机）；前端 `lib/music/stream.ts` 记忆偏好 `lineweb_music_stream_proxy`，直连失败（8s 探测看门狗/媒体错误）自动切中转并记住，播放器提示条可「改回直连」。两个端点已加入 `apiLimiterSkipPaths`（Range/封面高频），由路由内 600/5min/用户限流接管；compression 过滤器排除这两个路径（保住 Content-Length/Range 语义）。前端 `MusicPlayerContext`（全局 audio 实例 + MediaSession 锁屏控制 + 顺序/单曲/随机 + 音量 + 队列与进度 localStorage `lineweb_music_player_v1`，刷新恢复队列不自动播放）+ `MusicPlayerBar` 常驻底部迷你条（挂 App Routes 外层，参照 DownloadToast）+ `/music` 页（推荐/榜单/搜索 Tab、扫码卡含风控提示文案）；歌词 LRC 解析与字段归一化在 `lib/music/song.ts`（10 测试用例）。侧边栏「探索」组新增「音乐」入口。
- **接入面改动**：server/client 两份 `features.ts` 双写 `reader`/`music`（17→19 键，`/admin/features` 数据驱动自动出现）；index.ts 挂载 `requireFeature('reader'/'music')` + compression 排除 + CSP mediaSrc + `GET /api` 自描述两组；`multipartImage.ts` 泛化出 `receiveMultipartFile`（返回 fileName，busboy `defParamCharset: 'utf8'` 保中文文件名），`receiveMultipartImage` 委托兼容旧调用；drive.ts 根级保留名报错文案加 `_books`。
- **数据库**：`Book` / `BookProgress` / `MusicAccount` 均为 additive（51 模型），`prisma db push` 即可（本地撞 FTS 影子表先 DROP 虚拟表，启动自动重建）；生产走 docker-entrypoint.sh 自动 push，部署仍走本地产物链，不要在 ECS 上 `docker compose up --build`。
- **自检**：`cd server && npx tsc --noEmit` 零错误；`cd server && npm run verify:reader`（32 断言）；`cd client && npx tsc --noEmit` + `npm run build`（foliate 独立 chunk）+ `npm run test`（52 文件 / 564 用例）全过；详见 `docs/reader-api.md`、`docs/music-api.md`。

---

## 2026-11-01 上传卡 100% / 网易云封面与播放（修复口径）

- **上传卡在 100%（影响小说与网盘，线上必现）**：`storageTunnel.streamWriteBinary` 原来用 `ws.on('drain')` 等待发送缓冲回落。**`ws` 的 WebSocket 实例不会发出 'drain'**（只有内部 receiver 有），所以 `bufferedAmount` 一旦超过 8MB 高水位，Promise 永不 resolve——浏览器进度 100% 后请求永不返回（本地 20MB 书必现，生产 20MB 书 >200s 不返回）。修复：`waitForDrain` 改轮询 `bufferedAmount`（5ms，60s 上限）+ readyState/close 立即失败；`streamWriteBinary` 锁定本次连接的 ws 引用并用 `ws.send` 回调捕获发送错误（重连后不会把帧发到新连接）；心跳加 ping/pong 存活检测，连续一个周期无任何入站数据即 terminate 半开连接，**并且 pong 必须单独监听**（pong 不走 'message'，漏掉会把空闲健康连接误断）。新增数据面校验：生产 20MB 书 4s 成功、150MB 网盘文件 20s 成功。
- **上传内存**：`lib/multipartImage.ts` 改为按 `content-length` 预分配目标缓冲并逐块拷入，去掉「chunks 数组 + Buffer.concat」的 2 倍峰值（512MB 容器下 50MiB 书原本要占 100MB+）。生产容器常态占用 185–330MB/512MB。
- **FTS 在 PostgreSQL 上每次上传都报错**：`ftsSearch.ts` 的 FTS5 语句（`INSERT OR REPLACE` / `MATCH` / `rank`）在 PG 下是非法 SQL，曾每次上传打一条 `42601 syntax error at or near "OR"`。现在模块加载时判定一次，非 SQLite 直接跳过 sync/delete/search 的 FTS 分支（搜索走 LIKE）。
- **网易云封面（大多数不显示）**：上游返回的封面是 `http://p*.music.126.net/…`，而 CSP `img-src` 只放行 `https:`，浏览器直接拦（生产实测 `securitypolicyviolation`）。修复：`callNcmForUser` 返回前用 `upgradeNcmMediaUrlsIn` 递归把网易 CDN（`*.music.126.net`/`*.126.net`/`*.127.net`/`*.netease.com`）的 http 地址升级为 https，前端 `lib/music/song.ts` 的 `upgradeMediaUrl` 兜底（含 localStorage 旧队列与绑定头像）。音频地址同样升级，将来上 HTTPS 不会被混合内容阻塞。
- **网易云播放偶发失败**：容器冷启动时匿名 token 注册失败会连带 `xeapi public key is missing`，之后 `song/url` 一直 502（生产日志实测）。修复：识别初始化类错误 → 重置并重跑一次启动例程后重试；匿名 token 过期（301 且未绑定）重新注册后重试，只有**已绑定**账号的 301 才清绑定抛 401。另外 **iOS Safari** 只允许在手势任务里 `play()`，点歌要先等接口返回，故在首次 pointerdown/keydown 播一段 `data:audio/wav` 静音片段解锁 `<audio>`（CSP `media-src` 因此放行 `data: blob:`）。
- **VIP 试听不是播放失败**：非黑胶账号请求会员歌曲时上游只给 30–45s 片段并带 `freeTrialInfo`；前端在正在播放卡/迷你条显示「试听片段 · 会员歌曲」与说明，不再当成错误。
- **前端展示（音乐页/书架）**：音乐页新增 `NowPlayingCard`（大封面 + 控制 + 可拖进度 + 音量 + 模式 + LRC 歌词面板，歌词滚动只作用于容器、不再把整页滚走），歌曲行加序号/播放脉冲条/封面悬浮播放，榜单卡片加曲目数与「播放全部」，搜索改分段控件 + 骨架屏。书架加两阶段上传反馈（浏览器上传进度 → 「服务器正在写入存储」计时 + 流动条纹 + 5min 超时 + 可取消；**第二阶段看起来像卡 100% 的观感即来源于此**）、封面进度细条、悬浮「继续阅读」、书脊+首字占位封面、拖拽上传、骨架屏；并修复阅读纸张配色（浅色纸固定深色墨水，暗色主题下不再白底白字）。
- **验收脚本**：`scripts/screenshot-design-audit.cjs` 路由表补 `music`/`reader`；`--routes music,reader --widths 1440,390` 双主题 0 横向溢出、0 console 错误。
- **部署**：本地 `vite build` → `client-dist` 上传 → `git push deploy master` → 服务器 `git fetch deploy && git reset --hard deploy/master` → `docker build -f Dockerfile.prebuilt` + `docker compose up -d`（照旧不在 ECS 上 `--build`）。

---

## 2026-11-01 聊天内积分红包（实现口径）

- **形态**：微信式聊天红包——单聊**专属红包**（对方领全部）+ 群聊**拼手气红包**（2–100 份，二倍均值法随机拆分）。入口是聊天输入框工具行的「红包」按钮（表情与图片之间），不新增独立页面/路由。
- **消息不带新 type**：复用「拍一拍」的 XHTML 私有标记模式——消息 body=祝福语、xhtml=`<span data-lw-red="<红包id>">[红包]</span>`，`Message.type` 仍是 `text`。`stanzaXml.ts` 的 span 白名单在 `data-lw-poke` 之外并列放行 `data-lw-red`（`/^\d{1,10}$/` 且 >0）；前端 `protocol.ts` 的 `extractRedPacket` 照 `extractPoke` 写，接入 `parseLiveMessage` 与 `parseHistoryMessages` 两条路径（红包优先，命中即置 poke=null）。
- **账本**：`RedPacket`（conversationId/senderId/totalPoints/count/type=single|lucky/greeting/status=active|finished|expired/claimedPoints/claimedCount/expireAt=创建+24h）+ `RedPacketClaim`（`@@unique([redPacketId, userId])` 领取幂等）。积分流转全部走统一台账：发送 `spendPointsTx`（`redpacket_send`）、领取 `awardPointsTx`（`redpacket_receive`）、过期退回 `awardPointsTx`（`redpacket_refund`）。
- **拆分口径（易错点，冒烟踩过）**：领取时先 `updateMany` 条件自增 `claimedCount` 占位（防并发超领），重读后 `claimedCount` **已含自己**，故拆分份数必须用 `count - claimedCount + 1`——直接用 `count - claimedCount` 会让首抢者看到「只剩 1 份」拿走全部。
- **重复领取 409 的位置**：单份红包领完立即 `status='finished'`，若只在事务内查 `RedPacketClaim`，重复领取会先被 `status !== 'active'` 短路成 400「已被领完」。**事务外预检区必须先查复合唯一键并抛 409**，事务内保留同样的检查 + P2002 兜底覆盖并发窗口。
- **过期退回是惰性 + 扫描双通道**：`GET` 详情 / `POST` 领取时会顺手结算（过期红包读一次即翻转 `expired` 并退款）；`index.ts` 另有 60s 定时器 `settleExpiredRedPackets`（每轮 50 条、最多 20 轮、整函数吞错只打日志、`unref` + 关闭时 `clearInterval`）。结算以 `updateMany({ status:'active', expireAt:{ lte: now } })` 条件翻转占位，命中 0 行即已结算，**幂等不会二次退款**（回归断言已覆盖）。`lte` 而非 `lt`：与调用方的 `<=` 口径对齐，避免到期毫秒边界漏结算。
- **权限口径**：单聊只能发给好友（`areFriends` 不过 → 403），会话由 `ensureDirectConversation`（已从 chatMessaging 导出）按 directKey 复用；群聊必须是 `type='group'` 且请求者为成员。详情/领取一律校验会话成员身份，非成员 **404（不暴露红包存在性）**；不能领取自己发的红包（400）。
- **接口**（自建聊天后端专属，挂 `chatWriteLimiter` + `requireFeature('redpacket')`）：`POST /api/chat/xmpp/redpackets`（`{ peer?: nekoId, roomId?, totalPoints, count?, type, greeting? }`，返回 `{ id, conversationId, totalPoints, count, type, greeting, expireAt }`）、`GET /redpackets/:id`（含 `senderName`、`myClaim`、`claims` 领取名单）、`POST /redpackets/:id/claim`（返回 `{ amount, balance }`）。切到 neko 后端时这些端点 404，属预期。
- **功能开关**：新增 `redpacket` 键（分组「聊天」），`effectiveFeatureEnabled` 里作为 `chat` 的子开关（同 farm→games）；前后端 `features.ts` 双写。管理员仍绕过开关（项目既有规范），故验证拦截要用普通用户。
- **前端**：`ChatRedPacketCreateDialog`（单聊只填金额，群聊多一份数；客户端预校验 1≤金额≤50000、群聊金额≥份数、≤余额；记录 `createdId`——创建成功但消息发送失败时重试只重发消息不重复扣款）、`ChatRedPacketDialog`（拉详情 → 大「開」按钮领取 → 结果态 + `applyLocalDelta` + `refresh()`；明细列表标手气最佳）、`ChatRedPacketCard`（静态卡片，点击才拉状态，不做实时推送）。开关经 `ChatPage` 以 prop 下传而非组件内读 context（`ChatThread.test.tsx` 无 Provider 渲染，内置 hook 会抛错）。
- **自检**：`cd server && npm run verify:redpacket`（3864 断言：拆分不变量/上下界/退化区间/greeting 清洗/入参校验）；`verify:chat`（98）回归通过；双端 `tsc --noEmit` + client `npm run build` + `npm run test`（575 用例）全绿；PORT=3002 双账号 API 冒烟 43 断言（创建/领取/409/404/过期退款/开关 403）+ 浏览器双账号 UI 全链路（发送→领取→余额实时变化→群拼手气）截图验收通过。
- **数据库**：`RedPacket` / `RedPacketClaim` 均为 additive，`prisma db push` 即可（本地撞 FTS 影子表先 DROP 虚拟表）；生产走 docker-entrypoint.sh 自动 push，仍走本地产物链，不要在 ECS 上 `docker compose up --build`。

---

## 2026-11-01 聊天称号动效降级 / 低性能模式 / 音乐播放健壮性（实现口径）

- **称号徽章 compact 模式**：`UserTitleBadge` 新增 `variant="compact"`（默认 `full`）。聊天内的消息行、会话列表、群成员列表、好友面板改用 compact——保留传说静态渐变配色 + 图标文字，但**不渲染 aura / sparks / burst 节点、不跑任何动画**（同屏几十个徽章时，完整特效每个要跑 7~13 个合成层动画）；聊天窗口头部与顶栏仍是 full（单实例，保留特效）。组件本身 `memo`，按称号字段（name/color/icon/rarity/effect/gameName）比较。
- **低性能模式**：`client/src/lib/performanceMode.ts`（localStorage `lineweb_low_perf_mode`，`<html data-perf="low">`，`useSyncExternalStore` 订阅、跨标签 `storage` 同步），入口在个人资料页「性能与动效」开关；`styles/performance.css`（在 `points.css` 之后引入）统一降级：称号粒子 / 旋转光晕 / 爆裂层隐藏，徽章自身动画关闭，扫光降为一个 6s opacity 呼吸（合成器动画，不触发重绘）；头像框粒子隐藏、旋转停止；聊天装饰动画（flash / poke / toast）关闭。**减弱而非完全删除**，与 `prefers-reduced-motion`（完全静止）各自独立。
- **聊天 sender 引用复用**：`ChatThread` 用 `senderCacheRef` 按 `会话:用户名` 缓存 sender，值不变时复用旧对象（称号按字段比较），轮询刷新 / 选中切换不再让全部消息行的 `memo` 失效。
- **音乐播放健壮性**（`MusicPlayerContext`）：① `<audio>` 挂进 `document.body`（老 WebView 里游离 Audio 可能不出声）；② 首次手势解锁同时监听 `pointerdown/touchstart/mousedown/click/keydown`（老 iOS Safari 没有 Pointer Events）；③ 新增 `playAudioSource()`：设置 src 后同时等 `play()`、`error` 事件与 **20s 看门狗**，杜绝「点歌后无限转圈」；④ 首选音质失败自动降 `standard` 重试一次，全部失败给出「网络可能无法直连网易云 CDN」的可操作提示（并清掉坏地址，下次点击重新取址）；⑤ `mediaSession.setActionHandler` 逐个 try/catch（个别浏览器只支持部分 action，抛错会打崩整个 Provider）；⑥ 服务端 `callNcmRaw` 把首次懒加载/运行时初始化也纳入 15s 超时（此前只包住 `fn()`，初始化卡住时前端会一直加载）。
- **自检**：`cd client && npx tsc --noEmit` + `npm run test`（56 文件 / 585 用例，新增 `performanceMode` / `UserTitleBadge` / `playAudioSource` 三组测试）+ `npm run build`；`cd server && npx tsc --noEmit`；本地浏览器实测：音乐可播放（`<audio>` 在 DOM、currentTime 递增、src 为网易 CDN）、聊天 compact 徽章 `animation: none` 且 0 个粒子节点、低性能模式开关即时生效（`html[data-perf=low]`）。
- **部署**：纯前端 + 服务端单文件改动，无数据库变更；照旧本地 build → `client-dist` 上传 → 服务器 `docker build -f Dockerfile.prebuilt` + `docker compose up -d`（不要在 ECS 上 `--build`）。

---

## 2026-11-02 股市重构 + 宠物战斗/装备/交易行 + 抽奖调息（实现口径）

- **股市（stock）重构**：删除异动 badge / 价格闪烁 / 每日分红 / 隔夜持仓 / 盘中慢波 / 内置每日模板新闻。12 只股票 `drift` 全部归零（对称随机），波动率 2.4%–5.5%；tick 噪声 sigma 倍率 2→4、衰减 0.993→0.99；实时价 = 日线锚点 × (1 + OU 噪声 + 玩家冲击 + 事件冲击)。
- **玩家交易冲击**：`STOCK_IMPACT_PER_POINT=1e-6`（每 1 万积分 ±1%）、上限 **±25%**、半衰期 **15 分钟**；成交价包含本笔交易的冲击滑点（`getLiveExecutionPrice`），大额买入越买越贵、卖出越卖越便宜，**买入拉高后立刻卖出无法套利**（`verify:stocks` 有往返必亏断言）。冲击仍持久化在 `SiteSetting('stock.marketImpact')`。
- **AI 事件（每 40 分钟）**：`services/stockEventService.ts` 每 60 秒检查当前 40 分钟槽，`batchKey=YYYY-MM-DDTHH:MM`；生成 2–3 条事件（股票不重复、利好/利空混合），配置优先级 **AiChatConfig（DeepSeek）→ AiConfig（首页助手）→ 模板兜底**；输出严格 JSON，服务端校验并 clamp impact 1.5%–8%、halfLife 30–180 分钟、单批同股票最多 1 条。事件持久化到 `StockEvent` 表，启动加载当日事件到 `stockTicks` 内存；单条事件衰减 + 同时刻合计冲击 clamp ±12%。`GET /api/stocks/events?limit=` 单独下发。
- **股市 DTO**：`StockQuoteDto` 删除 `dividendYield`；`StockHoldingDto` 删除分红/隔夜字段；`StockBuyResult.trade` / `StockSellResult` 新增 `impactPct` 与含滑点的成交价；`StockAccountSummaryDto` 只保留 `realizedPoints/totalAssets`（`StockAccount` 表保留但不再使用，已实现盈亏从 `StockTrade.profit` 汇总）。前端删除异动/分红/闪烁，快讯区改「AI 快讯」并标 `来源 AI/模板`，最多展示最近 12 条可展开。
- **宠物战斗装备**：`lib/petEquipment.ts` 12 件装备（weapon/armor/accessory 各 4 件），3 件绑定新手装（召唤/首次装备页/发起对战前自动补发，不可掉落/交易），商店出售 6 件基础装备；`PetEquipment` 表按 `petId+itemKey` 唯一。属性派生在 `lib/petBattle.ts` 的 `deriveCombatStats`（等级 + 物种 + 装备），同槽位只取第一件。
- **宠物技能**：`lib/petSkills.ts` 12 个技能（普攻 + 11 个商店技能：烈焰爪/冰晶护盾/雷霆一击/治愈之光/剧毒之牙/暗影突袭/战吼/铁壁/汲取之触/流星坠/净化），每个技能有 `animation` key；`PetSkill` 表按 `petId+skillKey` 唯一；最多装备 3 个，技能槽与装扮/装备共用 `Pet.equipped` JSON（`cleanLoadout` 清洗，未拥有项自动剔除，`equipOutfit` 已改为保留战斗装配）。
- **实时手动回合制 PvP**：`services/petBattleService.ts` + `PetBattle` 表（status pending/active/finished/declined/expired/cancelled/settling，state JSON + version 乐观锁 + turnDeadline + 双方 presence 心跳）。邀请 10 分钟有效、同一时间只能有 1 场、同一对用户每天 3 场；接受时快照双方属性/装备/技能；每回合 30 秒超时自动普攻、连续 3 次超时判负；90 秒无心跳判负；40 轮按剩余 HP 百分比判定、相同为平局。服务端权威结算，客户端 1.5 秒轮询 + 10 秒心跳，日志按 `seq` 逐条播放（每个技能都有 CSS 特效 + PetSprite 动作）。
- **战斗结算**：败者积分 `stake = clamp(round(败者积分×8%), 10, 300)`，实际扣多少就转给胜者多少（`pet_battle_lose` / `pet_battle_win`）；败者已穿戴非绑定装备随机掉 1 件转给胜者（`PetEquipment.petId` 转移 + 从败者 loadout 移除），每人每天最多被掉 1 件；平局无积分/掉落。`processPetBattleTimeouts` 每 5 秒重试未完成的结算，避免卡死。
- **玩家交易行**：`services/petMarketService.ts` + `PetMarketListing` / `PetMarketTrade` / `PetMarketPrice`。只能挂自己拥有、未绑定、未穿戴、未在售的装备/技能（挂单自动下架已穿戴项）；挂单价必须在参考价 50%–150%；成交买家扣分、卖家到账 95%（5% 手续费，最低 1）、所有权转移，买家已拥有同款 409。参考价随成交 `old×0.7+成交价×0.3`，在售多时下压、无在售时上浮，读取时按 7 天半衰期惰性回归基础价；`PetMarketPrice` 按 `itemType+itemKey` 唯一。
- **端点**：`GET /api/pets/gear`、`POST /gear/equip`、`POST /shop/equipment/:key/buy`、`POST /shop/skills/:key/buy`；`GET /battle/overview`、`POST /battle/invite`、`POST /battle/:id/respond|cancel|action|presence|forfeit`、`GET /battle/:id`；`GET /market`、`POST /market/list`、`POST /market/:id/buy`、`DELETE /market/:id`。全部挂现有 `authenticate` + `requireFeature('pet')` + 按用户限流（对战轮询 600/5min、邀请 30/5min、交易写 60/5min）。
- **前端**：新增 `/pets/gear`（装备/技能/商店 + 属性对比）、`/pets/battle`（竞技场 + 战斗舞台 + 战后结算）、`/pets/market`（挂单/购买/最近成交）；`PetBattleStage.tsx` + `pet-battle.css`（火球/雷电/冰盾/治疗/毒/暗影/流星等特效，`prefers-reduced-motion` 降级）；`pet-market.css`（装备页/交易行）；`PetsPage` 头部加入三个入口；`PointsPage` 补齐 pet/交易/抽奖 reason 标签。
- **抽奖调息**：稀有度 78/18/3.5/0.5（原 62/25/10/3）；种子权重与数量大幅下调、装扮折算 400/800→100/200、保底 10→30 抽；**完整 EV（种子满收 + 肥料 + 装扮折算 + 保底）≈49.56 分/抽 < 十连 54 分**，单抽 60 分则约 17% 负期望；`verify:lottery` 341 断言含完整 EV 模拟。
- **自检**：`cd server && npx tsc --noEmit`；`npm run verify:stocks`（223）、`verify:pet`（507）、`verify:lottery`（341）；`cd client && npx tsc --noEmit` + `npm run test`（57 文件 / 594 用例）+ `npm run build` 全绿；本地 3002 + 临时 vite 5275 实测：两账号完整 PvP（邀请→应战→技能→击杀→积分转移/装备掉落）、交易行挂单与成交（参考价 220→224、手续费 11）、股市 1000 积分往返 −7、抽奖免费抽、AI 事件模板兜底；浏览器视觉验收战斗舞台/装备页/交易行/股市/抽奖通过。
- **数据库**：新增 `StockEvent` / `PetEquipment` / `PetSkill` / `PetBattle` / `PetMarketListing` / `PetMarketTrade` / `PetMarketPrice` 均为 additive（`@@map` snake_case，不用 enum/Json），`prisma db push` 即可；生产由 `docker-entrypoint.sh` 自动 push，部署仍走本地产物链，不要在 ECS 上 `docker compose up --build`。

---

## 2026-11-02 搜打撤 / 种子交易 / 农场扩至 30 块 / 股市限价（实现口径）

- **搜打撤（pet raid）**：旧版「格子回合制 + 自动战斗」实现已被 2026-11-03 v2 重构取代，现行口径见下方「2026-11-03 搜打撤 v2」章节。
- **宠物装备/技能扩充**：`lib/petEquipment.ts` 由 12 件扩到 26 件（武器 10 / 护甲 9 / 饰品 12，含商店可售稀有与仅掉落/交易行的史诗传说）；`lib/petSkills.ts` 由 12 个扩到 24 个（新增寒冰之息/圣光复苏/荆棘护甲/狂暴/虚弱诅咒/破甲击/星辰陨落/回春术/处决/时之加速/生命虹吸/净化之雨）；战斗引擎新增 `crit_up` 增益、`weaken`（攻击降低）/`vulnerable`（防御降低）/`regen`（持续治疗）状态与 `executeBelow/executeBonus` 处决机制；装备/技能目录由 `/api/pets/gear` 全量下发，前端自动出现，无需改枚举。
- **宠物外观/动作/装扮**：`PetOutfitSlot` 扩展为 `hat/neck/face/back/aura` 五槽，装扮 7 件 → 18 件（新增派对尖帽/海盗头巾/单片眼镜/铃铛项圈/星星胸针/探险背包/天使之翼/暗夜蝠翼/星尘光环/圣光环/烈焰环绕）；`PetSprite` 新增背翼/光环/星尘/烈焰/背包 SVG 与 `wave/sneeze/yawn` 三个动作（`pet.css` 对应 keyframes，低性能模式与 `prefers-reduced-motion` 降级）；`PetSprite` 改为 `memo`，列表复用不随父级无关状态重渲染。
- **农场 30 块 + 一键种植/收获 + 偷菜保护**：`MAX_PLOT_COUNT=30`，扩建档位 21/24/27/30（10000/16000/24000/36000 积分）；`POST /api/farm/plant-all`（crop 缺省自动选数量最多的种子，逐块条件更新，种子不足尽量种）、`POST /api/farm/harvest-all`（一次事务合并结算）；`Farm.protectedUntil` + `POST /api/farm/protect {hours}`（1/3/6/12/24 小时 = 30/75/120/200/320 积分，可叠加、总剩余≤48h），保护期间 `steal` 返回 403 `FARM_PROTECTED`，邻居列表/农场详情显示保护状态并置 `stealable=false`。
- **玩家间种子交易**：`FarmSeedListing` + `services/farmSeedMarketService.ts` + `/api/farm/seed-market*`。挂单时种子从卖家仓库扣除托管，成交后进入买家仓库；取消原路退回；卖家 5% 手续费（最低 1），每人最多 20 条在售；前端「种子市场」Tab 支持挂单/买下/下架/最近成交。
- **股市限价委托**：`StockOrder` + `services/stockOrderService.ts` + `GET/POST/DELETE /api/stocks/orders*`。买入挂单立即冻结积分，卖出挂单立即冻结份额（成本等比保留）；行情/委托/资产/排行榜请求触发惰性撮合（全局最多 4 秒一次，无定时器），买入现价≤限价、卖出现价≥限价时按实时价成交并照常写入冲击与成交记录；撤单原路退回；每人最多 20 条 open；前端交易面板新增「限价买入/限价卖出」与「委托」Tab（10 秒静默刷新）。另新增行情刷新间隔本机设置（3/10/30 秒），降低老设备与服务器压力。
- **性能优化**：`vite.config.ts` 把 marked/katex/dompurify/marked-katex-extension 拆为独立 `markdown` chunk（335KB 只在 AI/预览页加载）；`performance.css` 对长列表（委托/成交/排行/搜打撤战利品/种子市场/宠物之家/网盘卡片）加 `content-visibility:auto`，低性能模式关闭 header/sidebar/dialog 的毛玻璃；`PetSprite` memo；Reader/Drive/Music/DeepSeek 图片补 `loading=lazy`/`decoding=async`；StocksPage 行情轮询可调。
- **自检**：`cd server && npx tsc --noEmit`；`npm run verify:raid`（104 断言）；`cd client && npx tsc --noEmit` + `npm run test`（57 文件 / 594 用例）+ `npm run build` 全绿；本地 3002 冒烟覆盖种子挂单/取消、一键种植、保护后偷菜 403、搜打撤开局/移动/战斗/放弃/战绩/契约、股市限价买入/卖出自动成交与撤单。数据库 `Farm.protectedUntil` + `FarmSeedListing` / `StockOrder` / `PetRaid` / `PetRaidRecord` / `PetRaidContract` 均 additive，`prisma db push` 即可；生产仍走本地产物链（不要在 ECS 上 `docker compose up --build`）。

---

## 2026-11-03 搜打撤 v2：官方商店 / 6 级装备耐久 / 背包胸挂 / 实时房间制（实现口径）

> 同日早些时候的「仓库 / 交易行」章节为旧实现，交易行已整体删除，仅作历史记录。

- **共享引擎（双端逐字副本）**：`server/src/lib/raidRun.ts` 为唯一真相源，`client/src/lib/raid/raidRun.ts` 为逐字副本（`client/src/lib/raid/__tests__/raidRun.test.ts` 读双端源码断言一致）。内含 50 种物品 / 6 档品质（普通 / 优良 / 稀有 / 史诗 / 传说 / 神话，神话仅 T5 掉落）、30 件装备（头 / 甲 / 鞋 / 背包 / 胸挂 × 6 级）、6 张地图（3×3–5×5 房间、17×13 瓦片、生成树走廊 + 环路）、自定义房间类型（start/combat/elite/boss/loot/hazard/extract）、确定性敌人 / 容器掉落、运行状态机与全部校验纯函数。
- **实时战斗**：客户端 Canvas 2D（`engine.ts` 60fps 本地模拟、`renderer.ts` 房间相机 + 小地图、`input.ts` 键鼠 + 手机双虚拟摇杆），敌人会巡逻 / 追击 / 保持距离射击 / Boss 弹幕，进房锁门、清怪开门；玩家 WASD + 鼠标瞄准射击，技能 1/2/3 手动释放（冰晶护盾 / 治疗 / 增伤等按宠物已装备技能映射）。客户端约 1.5s 批量上报事件，服务端按 seed 重算地图逐条校验，HP / 背包 / 撤离以服务端为权威，非法事件跳过并回传错误。
- **装备与耐久**：`RaidGear` 表（`userId+gearKey` 唯一，`equipped` 每槽一件）。头盔 / 护甲有耐久，受击按防护等级减伤并扣 `raw × 0.25` 耐久，耐久归零不再减伤；头修包 / 甲修包恢复耐久但每次把上限降到 95%、最低初始 30%。战靴提供移速，背包 8–28 格、胸挂 2–7 格（胸挂只能放消耗品）。商店只卖 1–3 级，4–6 级靠搜打撤掉落 / 开箱。
- **容器与结算**：`RaidBagItem`（`userId+container+slotIndex` 唯一，container = backpack / rig / safe，容量由装备与仓库等级派生）。没背包 / 胸挂容量为 0，背包满时拾取失败；撤离成功后物品**原样留在容器**，必须到仓库页手动存入（`deposit` 整笔失败 / `deposit-all` 装多少算多少），**仓库满不自动出售**；回收走官方商店价（材料 / 珍宝 100%、消耗品 60%、箱子 70%）。阵亡 / 失联 / 放弃：背包与胸挂清空、安全箱保留；随身装备必丢，行动保险（装备价值 15%，最低 20）可保住；旧 schema 对局首次读取按放弃结算、不扣装备。
- **官方商店**：`GET /api/pets/raid/shop` + `POST /shop/buy`（装备生成满耐久新件、同 key 唯一；消耗品 / 箱子进仓库）；装备箱 / 技能卷轴在仓库页 `POST /raid/gear/open-cache` 开启，重复折 60% 积分。交易行端点 / 服务 / UI 全部删除，`RaidMarketListing` / `RaidMarketTrade` 表保留不删（避免生产非首启 `db push` 因数据丢失失败）。
- **接口**：`GET /raid`、`POST /raid/start`、`POST /raid/events`（批量事件）、`POST /raid/abandon`、`POST /raid/contracts/:key/claim`；`GET /raid/storage`、`POST /storage/deposit|deposit-all|withdraw|recycle|upgrade`；`GET /raid/shop`、`POST /raid/shop/buy`；`POST /raid/gear/equip|repair|open-cache`。全部在 `/api/pets` 的 `requireFeature('pet')` 下，事件 600/5min、写操作 60/5min 按用户限流；行动中禁止整理装备 / 仓库（409/400 提示先撤离）。
- **前端**：`/pets/raid` 大厅（地图卡 / 出击装配 / 保险 / 契约 / 战绩）+ 对局（Canvas + HUD：HP/MP、护甲耐久、背包/胸挂/安全箱、技能冷却、撤离读条、小地图、手机摇杆）+ 结算弹层（按容器分组展示，前往仓库）；`/pets/raid/storage` 四 Tab（仓库 / 背包 / 装备 / 官方商店），装备页含耐久条与维修、商店支持数量选择。
- **自检**：`cd server && npm run verify:raid`（6285 断言）、`verify:raidstorage`（132 断言）；`cd client && npx tsc --noEmit` + `npm run test`（58 文件 / 612 用例）+ `npm run build` 全绿；本地 3002 + 浏览器 E2E 已覆盖：购买 1/3 级装备、穿戴、耐久下降与维修、进房 / 敌人追击 / 击杀 / 清门、开箱拾取、撤离读条与结算、撤离后手动存入仓库（23 件）、阵亡丢装备、交易行 404、手机 390×844 双摇杆与技能键。
- **限流**：全局按用户默认 600 → **8000 次/15min**（`User.apiRateLimit` 默认 + `userApiLimiter` 兜底），IP 硬上限 3000 → **30000**；启动迁移把仍为旧默认 600 的账号回填为 8000（`SiteSetting('system.rateLimit.backfill8000')` 幂等标记）。
- **数据库**：`RaidGear` / `RaidBagItem` 为 additive，`prisma db push` 即可；生产仍走本地构建 + `Dockerfile.prebuilt`（不要在 ECS 上 `docker compose up --build`）。

---

## 2026-11-03 搜打撤仓库/交易行/升级/安全箱 + 新地图新物品 + 农田一键施肥（历史，已被 v2 取代）

- **仓库系统**：撤离结算不再把 material 类战利品直接折积分，改为入用户仓库 `raid_inventory_items`（按 `(userId,itemKey)` 堆叠，`listedAmount` 为挂单预留量，恒有 `amount >= listedAmount` 不变式）；容量与保险箱格数由 `raid_storage.level` 经 `RAID_STORAGE_LEVELS`（`lib/raidStorage.ts`，6 级：容量 60/100/150/210/280/360、保险箱 2/3/3/4/5/6）派生，超容量部分自动折积分（流水 note「仓库已满折算」）；medkit/种子/装备/技能结算口径不变。REST 前缀 `/api/pets/raid/storage*`（GET view / POST recycle `{itemKey,amount}` / POST upgrade），积分 reason `raid_recycle`、`raid_storage_upgrade`。
- **搜打撤交易行**：`raid_market_listings` + `raid_market_trades`（append-only，无外键、视图批量查名），整单出售（amount + 总价 price，不支持部分购买），价格须落在「目录价值×0.5–1.5」含端点且 ≤100 万，卖家 5% 手续费（最低 1）；上架走 `listedAmount` 守卫预留 + 写后复核，购买 status 原子抢占 + **买家入库（受买家仓库容量约束，装不下整笔 400）**、不能买自己的、下架守卫递减释放预留；升级提交材料+积分（事务内守卫扣减 + 等级按 `where level=旧值` 守卫写，防并发双扣/回写）。积分 reason `raid_market_buy`、`raid_market_sell`。端点：`GET /raid/market`、`POST /raid/market/list`、`POST /raid/market/:id/buy`、`DELETE /raid/market/:id`（写挂 marketWriteLimiter、读挂 battlePollLimiter，均在 `/api/pets` 的 `requireFeature('pet')` 下）。
- **安全箱（用户级）**：局内保险箱格数从常量 2 改为按仓库等级（`storeSafeRaid` 可选容量参数），对局 DTO、`GET /api/pets/raid` overview 下发 `safeCapacity` 与 `storage {level,capacity,used,safeCapacity}`（读时惰性建行）。
- **新地图/新物品**：`RAID_MAPS` 4→6 张（新增 孢子雨林 `fungal` hard/entry 320/tier4、深渊实验室 `abyss` extreme/entry 900/tier5，撤离点候选 8 个按离出生点距离过滤 + 保底补齐、首领布点数据驱动支持多 boss）；`RAID_LOOT_ENTRIES` →24 种，新增 mythic 稀有度（`rarityWeight` tier1–4 恒 0、tier5 为 3，仅深渊实验室可掉），「非洲之心」💎 value 9999 为全游戏最高价值物品。`RaidMapKey`/`RaidLootRarity` 双端类型已同步。
- **农田一键施肥**：`POST /api/farm/fertilize-all`（best-effort 单事务逐块，规则与单块 fertilizePlot 完全一致：有作物/未达 2 次上限/未成熟，肥料逐块扣 1 扣到 0 为止），返回 `{view, fertilizedCount, fertilizerLeft, skippedCount}`（0 块也 200，由前端区分「没有可施肥地块」与「肥料不足」）；纯函数 `fertilizablePlotIndexes` 在 `farmCrops.ts`；前端 FarmPage 工具栏「一键施肥」按钮。
- **前端**：新页 `/pets/raid/storage`（`RaidStoragePage.tsx`：仓库/交易行双 Tab、等级卡+容量进度条、升级卡（材料 have/need + 积分）、物品卡（回收弹窗/上架弹窗带价格区间与手续费预览）、在售/我的挂单/最近成交、空状态）；`PetRaidPage` 头部「📦 仓库」入口、结算 loot 按 `outcome` 渲染（warehouse 条目同时显示溢出折分）、mythic 金红渐变样式（`raid.css`/`raid-storage.css`，均带 `prefers-reduced-motion` 降级）；`PointsPage` REASON_LABELS 补 4 个新 reason。
- **自检**：`cd server && npm run verify:raid`（114 断言）、`npm run verify:raidstorage`（1260 断言，新脚本 `scripts/verify-raid-storage.ts`：等级表不变量/入仓规划/定价边界/新地图确定性/4000 seed 掉落统计/abyss 脚本化对局）、`npm run verify:points`（357）；`cd client && npx tsc --noEmit` + `npm run build` + `npm run test`（57 文件 / 594 用例）全绿；本地 3002 双账号冒烟覆盖回收/定价边界/预留累计/购买交割（含买家容量守卫）/升级/一键施肥/完整撤离入仓链路（含保险箱存放与撤离保留）。数据库 `raid_storage`/`raid_inventory_items`/`raid_market_listings`/`raid_market_trades` 均 additive，`prisma db push` 即可；生产仍走本地产物链（不要在 ECS 上 `docker compose up --build`）。

---

## 2026-11-03 搜打撤 v3：好友组队 + 横屏浮层 HUD + 技能表现 + 地图风格化（实现口径）

- **好友组队（2–4 人）**：`server/src/services/raidSquadService.ts` 内存队伍房间（名册 / 邀请 / 实时位置 / 世界增量广播），复用 `chatService.areFriends / listFriends / getUserBrief` 与 `chatHub.sendToUser`，**不新增 Prisma 表**；`registerGameModule({ name: 'raid' })` 让在队玩家对其他游戏的邀请判为「对局中」，清扫钩子挂在既有 15 秒 `startGameSweeper`（大厅闲置 10 分钟、出击后「时长 + 3 分钟」、邀请 5 分钟过期）。出击由房主 `POST /api/pets/raid/squad/start` 一次给全员按**同一 seed** 开各自的 `PetRaid` 行：世界共享（击杀 / 房门解锁 / 开箱 / 被拿走的战利品全局唯一），个人独立（HP / 背包 / 装备 / 撤离结算 / 门票与保险）。预检不合格（无宠物 / 无背包 / 积分不足）的成员进 `failed` 并移出队伍，不开局不扣费。
- **版本语义变更（易错点）**：队友世界同步会推进别人那一行的 `version`，因此 `performRaidEvents` 只拒绝「客户端版本号超前」，落后照常接受并在响应里回权威状态，客户端 `engine.applyServerRun` 自愈；写队友行用 `updateMany({ where: { id, version } })` 守卫，抢不到就跳过（下一批再同步），绝不覆盖队友本地进度。
- **实时位置**：`POST /raid/events` 请求体新增可选 `me { x, y, angle, roomId }`，**不进 raidRun 事件系统、不落库**，只更新内存 live 缓存；`raid:squad:state` 按队伍节流 ≥0.9 秒推送，无 WS 时靠 `GET /raid/squad/state`（2 秒）与批处理响应里的 `squad.members` 兜底。客户端把队友画成幽灵（同房间实体 + 小地图房间标点），`raid:squad:world` 推送世界增量使免等批处理即生效。
- **对局 HUD 重做**：HUD 从画布下方整块改为 `.gh-raid-stage` 内四角浮层（`.gh-raid-pod--vitals|mission|map|squad|action|loot|log`，容器 `pointer-events: none`、只有按钮可点），小地图改用独立 DOM canvas（`renderMinimap`）由 CSS 定位，不再由画布绘制；新增「横屏沉浸」（元素原生全屏 + `screen.orientation.lock` 失败时 `.is-fallback` fixed 铺满降级）与 `env(safe-area-inset-*)`、`dvh` 适配，竖屏出「请旋转横屏」提示并只保留生命 + 技能。竖屏/小横屏下 `data-layout="touch"` 收窄面板并把容器改成顶部计数带；**注意面板宽度不能用 `vw`**（舞台比窗口窄，会算出错误宽度——审计踩过）。Playwright 审计口径：5 档视口全部 0 面板互遮、0 溢出舞台、0 控制台错误。
- **技能与打击表现**：`engine.ts` 新增 `effects / floats / hitMarkers / shakeMs / hurtFlash / hurtDirs / teammates` 与 `resolveSkillArt(key, kind)`（按 key 关键词推导元素配色与形状，退回 kind），技能有法阵 / 扇形火焰 / 雷击折线 / 毒雾 / 六边护盾 / 治疗上升粒子 / 增益旋转光环，普攻有枪口焰与弹道拖尾；受击侧加伤害飘字、护甲减免提示、方向罗盘与震屏，远程敌人开火前有准星预警线；首领弹幕有 expanding ring。渲染器统一在 `lowPerf`（`data-perf="low"`）与 `prefers-reduced-motion` 下关闭光晕 / 粒子 / 环境浮尘。
- **地图风格化（无外部图片资源）**：`client/src/lib/raid/mapArt.ts` 为 6 张地图各定义主题（地板两色、墙体三段、强调色、光照、暗角、危险区、门、环境粒子 kind/数量/速度、装饰物集合与密度、小地图配色），纹理按 `主题 × 像素尺寸` 离屏 canvas 程序化生成并缓存（plank/concrete/rock/panel/mycelium/steel），装饰物与地面污渍用 `hashTile(seed,x,y,salt)` 确定性布点（跨帧稳定），撤离点改停机坪（同心圆 + 旋转箭头），大厅地图卡用 `--map-pattern` 重复渐变做地貌暗示。
- **接口面**：`/api/pets/raid/squad`（GET 视图、GET state、POST invite/respond/cancel/leave/kick/start），读挂 `battlePollLimiter`、写挂 `battleInviteLimiter`；WS 事件 `raid:squad:invite|invite:removed|update|started|state|world`。客户端 `client/src/lib/raid/squad.ts`（`useRaidSquad`，用 `useChat().subscribe`，`transport === 'polling'` 才轮询）+ `RaidSquadPanel.tsx`（`.gh-raidsq-*` 浅色大厅样式，对局内队友条用暗色玻璃浮层）。详见 `docs/raid-api.md` 第 3 章。
- **数据库**：**零改动**（`squadId` 存在 `PetRaid.state` JSON 里，additive 字段不动 `RAID_STATE_VERSION`），部署仍走本地产物链（本地 `npm run build` → `client-dist` → `Dockerfile.prebuilt`，不要在 ECS 上 `docker compose up --build`）。
- **自检**：`cd server && npx tsc --noEmit`、`npm run verify:raid`（6285）、`verify:raidstorage`（132）；`cd client && npx tsc --noEmit` + `npm run test`（58 文件 / 612 用例，含双端 `raidRun.ts` 逐字一致断言）+ `npm run build`；本地 3002 双账号组队冒烟 25 条（邀请→接受→重复拒绝→同 seed 开局→击杀世界同步→B 进入队友清过的房间→旧版本号仍被接受→双方放弃）。

---

## 2026-11-03 搜打撤 v4：旧设备兼容 / 移动端背包 / 换房修复 / 性能与画面（实现口径）

- **旧 WebView 兼容**：`client/vite.config.ts` 接入 `@vitejs/plugin-legacy`（legacy 目标 chrome40/safari9/ios9，modern 目标 chrome61/safari11，`modernPolyfills` 仅列实际用到的 allSettled/finally/fromEntries/flatMap/queueMicrotask），`build.target` 同步降到 chrome61/safari11。**生产 CSP 不能直接放开 unsafe-inline**：`server/src/index.ts` 启动时读取 `client/dist/index.html`，把 plugin-legacy 注入的内联脚本逐个算 sha256 注入 `script-src`（Docker 内路径 `/app/client/dist`）。
- **旧 API 兜底**：新增 `client/src/lib/mediaQuery.ts`（`addEventListener` → `addListener`），`Layout/AdminLayout/ThemeContext/RaidCanvas` 全部改用它；`RaidCanvas` 对 `ResizeObserver`、`PointerEvent`、`requestFullscreen`、`screen.orientation.lock` 全部特性检测，缺 ResizeObserver 时退化为 window resize/orientationchange + 延迟重排（进入/退出沉浸后显式 resize）。`raid.css` 末尾补 `@supports not (inset: 0px)` 固定偏移、`min()/max()/clamp()/dvh` 固定高度回退。
- **自动画质**：`high / balanced / low` 三档（旧内核、Chrome < 80、iOS < 13、低内存/少核心、用户低性能模式自动 low；连续 90 帧渲染超时自动降档，手动切换后不再自动降）。low 档 DPR=1、锁 ~30fps、关闭毛玻璃/粒子/环境浮尘/震屏，但**技能特效、命中反馈、出口箭头始终保留**。低画质 CSS 由 `.gh-raid-stage[data-quality='low']` 驱动。
- **渲染性能**：`renderer.ts` 重写——地板/墙体/污渍/装饰物/房间染色按「房间 + 瓦片尺寸 + 门锁 + 画质 + DPR + 尺寸」缓存到离屏 canvas，每帧一次 `drawImage`；背景暗角、玩家手电、全屏渐变各自缓存；emoji 按 `emoji|px|dpr` 缓存成小 canvas（不再每帧 fillText）；去掉 shadowBlur。角色/敌人改为矢量绘制（宠物身体、耳朵、尾巴、枪；斥候/士兵/精英/首领四类轮廓），新增准星、技能横幅、技能屏幕染色、更丰富的元素特效（nova/shards/pillar/beam）。
- **换房修复（P0）**：`engine.tryMove` 不再只认正中门格，改为「目标瓦片归属哪个相邻房间」判定换房——走廊 3 格（门上方/门/门下方）任意一格都能进出；`transitionToRoom` 统一落点。`applyServerRun` 在服务端拒绝 `enterRoom` 时把玩家坐标夹回服务端房间内部（原来的实现只改 roomId，玩家会卡在房外无法移动），并按服务端 `killedEnemies/openedContainers` 自愈幽灵敌人/已开容器。
- **对局内移动物资**：共享 `raidRun.ts` 新增 `moveItem { from,to,slotIndex,amount? }`（双端逐字副本；胸挂只能放消耗品、目标容量/堆叠校验、整格或部分数量），`routes/pets.ts` 的 discriminatedUnion 同步；`engine.moveItem` 本地即时生效并上报。新增 `RaidInventory.tsx` 全屏面板（背包/胸挂/安全箱，点选物品 → 点目标容器，价值/格数/品质展示；`B`/`I`/Esc 快捷键），移动端 HUD 新增「战术背包」常驻入口（竖屏在生命盘下方，横屏在移动摇杆上方）。
- **移动端交互**：新增常驻「交互 E」按钮（手机没有键盘也能开箱/撤离，横屏在射击摇杆上方、竖屏在左侧竖排），撤离读条改为到点**自动完成**并每 2 秒重试被拒的 `extractDone`；触屏日志/工具条重新排布，小横屏居中显示紧凑错误/提示流，竖屏也保留提示条；`RaidInventory` 渲染进 stage 子树，原生全屏时仍然可见，且 `--raid-*` 变量提升到 `.gh-raid-page` 修复浅色主题下深色面板文字不可读。对局中隐藏站点公告条与页面大标题，舞台高度按 `100dvh - 118px` 撑满首屏（平板横屏无需滚动就能看到摇杆与技能）。
- **自检**：`cd server && npx tsc --noEmit`、`npm run verify:raid`（6292）；`cd client && npx tsc --noEmit` + `npm run test`（59 文件 / 617 用例，含新增 `engine.test.ts` 的走廊侧格换房 + 服务端拒绝回滚）+ `npm run build`；生产模式本地 3002 实测 CSP 3 个 sha256 与构建产物一致、页面无控制台错误、对局可启动。

---

## 2026-11-04 搜打撤体验大版本 + 银行系统 + 称号头像框扩充（实现口径）

- **搜打撤（raid，`RAID_STATE_VERSION` 2→3，旧对局读时按废弃结算）**：
  - **丢弃物品**：新事件 `dropItem`（容器格→当前房间地面，落点客户端坐标服务端夹取进房间内圈）+ `takeGround`（捡回背包/胸挂）；`RaidRunState.groundLoot`（单房上限 `RAID_GROUND_LOOT_LIMIT=24`、`groundSeq` 发号）；DTO 带 `groundLoot/groundSeq`；组队 `RaidWorldDelta` 增 `groundDropped/groundTaken`（`startSquadRaid` 按成员序号传 `groundSeqBase=(i+1)×100` 防撞 id）；客户端走过地面物品自动捡起（engine `updateGroundPickups`），`RaidInventory` 选中物品有「丢在地上」按钮，renderer `drawGroundLoot` 虚线圈渲染。自检 `verify:raid` 6312 断言。
  - **胸挂放宽**：`normalizeContainer` 去掉 consumablesOnly 参数，takeLoot/moveItem/withdraw/开局清洗 4 处「只能放消耗品」校验移除，任意物品可入胸挂。
  - **背包扩容**：`backpack_t7`（36 格）/`backpack_t8`（48 格）神话品质掉落限定；新增神话掉落物「深渊装备箱 `gear_cache_mythic`」（开 6–8 级装备、仅 lootTier 5 图）；`verify-raid`/`verify-raid-storage` 硬编码断言同步（装备 32 件、装备箱 5 种）。
  - **人机增强**：`createRaidEnemy` HP ×1.2/2.4/5.0（原 1/1.9/4.2）、伤害 ×1.15/1.45/1.8（原 1/1.2/1.5）、scout/soldier 远程概率 85%/65%、各图 enemyLevel +1、enemyBudget +2~4；客户端远程射击 1700/1200→1500/1100ms、近战 1000→950ms。
  - **触屏操控**：`VirtualStick` 改悬浮式（`gh-raid-stick-zone` 左右半屏热区、按下即触点生成底盘、超半径底盘跟随手指漂移）；开火自动锁敌 `aimAssistAngle`（±75° 锥内最近可视敌人，仅 `touchMode`）；技能伤害类全平台 `skillAutoTarget` 朝最近可视敌人；引擎 LOS 检测按敌 ~120ms 节流（`sightCheck`）。
  - **地图直观化**：房间类型水印徽标（⚔🛡👑📦☢🚁🏠 + 中文标签）烙进 scene 缓存零逐帧成本、tint 加深；minimap 每格加类型字标（起/战/精/王/资/危/撤）。
  - **平板适配**：raid.css 新增 768–1279px 断点（隐藏事件流、squad 上移、loot 计数带让位、vitals/技能紧凑化）；修复触屏 `.gh-raid-bag` top+bottom 双向生效拉伸。
  - **性能**：cone/pillar/screenFlash 的 `createLinearGradient`/`createRadialGradient` 按 ctx+参数缓存（`cachedGradient`，WeakMap）；平板（粗指针+宽≥1024）`detectQuality` 直接送 low 档。
  - **组队邀请修复**：`/raid/squad/invite|respond` 统一返回 `{ squad }`（拒绝 `{ squad: null }`，此前裸 null 让前端 `result.squad` 抛 TypeError 显示「操作失败」）；客户端对 404 竞态静默移除邀请。
  - **一键回收**：`POST /api/pets/raid/storage/recycle-all`（`{ keepUpgradeItems? }` 默认 true 跳过全部等级升级材料），事务内整仓按官方价结算；仓库 Tab「♻️ 一键回收」按钮 + 确认弹窗。
- **银行系统（bank，全新功能）**：`/api/bank`（`requireFeature('bank')`，读写各 60/5min 按用户限流）。**活期**年化 2% 按自然日惰性结息直接入积分余额（`bank_interest`，game:null 不占游戏日上限，水位 `lastInterestDateKey` 封顶 365 天）；**定期** 7 天 5% / 30 天 10% / 90 天 18%，到期支取全额利息、提前支取按活期；**基金** 3 只（稳健🛟 drift 4% vol 0.4% / 均衡⚖️ 10%/1.2% / 进取🚀 18%/2.8%），NAV 自 2026-01-01=1 逐日确定性复利（mulberry32 种子 `lineweb-fund:<code>:<dateKey>`）**带均值回归**（日拉力=0.05×ln(目标线/净值)，钳 ±0.02，防纯随机游走出 ±50% 极端路径）；单笔 100–100,000、申赎费 0.25%。schema additive 4 表 `BankAccount/BankDeposit/FundHolding/FundTrade`（`prisma db push` 即可）；lib 纯函数 `bankRules.ts` + 服务 `bankService.ts`（事务用 `spendPointsTx/awardPointsTx` + 条件 updateMany 防并发）；前端 `/bank`（BankPage + Sidebar 探索组入口 + features 双份加 `bank` 键）；自检 `cd server && npm run verify:bank`（1029 断言）；文档 `docs/bank-api.md`。
- **称号/头像框扩充（points）**：`AVATAR_FRAME_STYLES` 7→11（新增 frost/venom/royal/cyber，royal/cyber 走 premium fx 装饰层）、`TITLE_EFFECT_STYLES` 8→10（新增 meteor/blossom）；新种子商品 12 件走新标记 `points.shop.frames.v3.seeded`/`points.shop.titles.v3.seeded`（4 框 1500–3000 分 + 8 称号 800–5000 分）；前端 `types/points.ts` 拷贝、points.css 类与 reduced-motion 降级、`verify:points`（361）与 `titleEffects.test.ts` 长度断言同步。
- **部署**：2026-11-04 按本地产物链上线（本地 build → client-dist 覆盖 → `git push deploy master` → 服务器 fetch/reset → `Dockerfile.prebuilt` 重建），生产 schema 由 docker-entrypoint.sh 自动 db push。

---

## 2026-11-05 搜打撤修复 + 商店全站化 + 公司信贷扩展 + 危机税款自选（实现口径）

- **搜打撤修复（raid）**：
  - **沉浸模式退出三修**（`RaidCanvas.toggleImmersive` 重写）：退出判定补 `webkitFullscreenElement`/`webkitExitFullscreen` 兜底（修 iPad Safari 退不出）；`is-fallback` 降级模式先直接还原再 return（修「点退出反而重试进入」死循环）；退出补 `screen.orientation.unlock`。撤退确认 `window.confirm` 换成舞台内浮层（`.gh-raid-exit-confirm-*`，原生全屏只渲染 stage 子树必须挂里面；WebView confirm 恒 false 的坑一并修掉）。
  - **撤离点全程可见**：`raidMapForViewer`（lib/raidRun.ts 收口纯函数）取消情报裁剪——`map.extracts` 恒全量下发、extract 房显示真实 kind（小地图全程显示「撤」）；`discoveredExtracts` DTO 字段保留不再参与裁剪。
  - **撤离死局兜底**：run state 新增 `lastExtractFailAt`（additive，cloneState `?? 0` 兜底不升版本）；全部撤离点失联且冷却（60s）已过时 `extractStart` 清空全部 disabled 放行重试（救援队重架信标），部分失联维持拒绝。wasteland 单撤离点 25% 故障骰不再造成永久死局。
  - **敌人 AI/弹幕增强**（纯客户端 engine）：精英 3-way 扇形（狂暴 HP<50% 时 5-way + 射速 ×1.4）、boss 瞄准 3 连发（引擎内 `pendingEnemyShots` 延时队列）+ 环形 12 发起始角逐次 +37° 螺旋；实现 elite `charge` 冲锋（4s 冷却、telegraph 0.6s、冲刺 0.35s ×6 速、路径接触伤害）；远程怪绕圈方向 2.5–4s 翻转、dist<2.5 后撤；全场敌弹上限 240。`verify:raid` 15372 断言。
- **搜打撤商店全站化 + 仓库改造**：
  - 新独立页 `/raid/shop`（`RaidShopPage.tsx`，原仓库页 shop Tab 迁出；App.tsx 挂 `RequireFeature('pet')` 块、Sidebar 探索组入口 `isEnabled('pet')` 过滤）；**后端 API 不动**（仍 `/api/pets/raid/shop`）。仓库页 Tab 收窄为 仓库/背包 + 商店跳转卡片。
  - **装备并入仓库 Tab**：当前装备五槽 + 备用装备按槽分组整体内嵌（原独立 gear Tab 删除）。
  - **批量选择回收**：`✓ 选择`模式（物品+装备勾选、底部浮动批量条「已选 N 件 · 预计 X 积分」）；后端 `POST /api/pets/raid/storage/recycle-batch`（`raidStorageService.recycleRaidItemsBatch` 单事务、assertNoActiveRaid、逐项校验指明出错项、装备价 `max(1, round(price×0.6))` 与 raidGearService 同口径、合计一次 `awardPointsTx('raid_recycle')`、≤100 项）。
- **公司信贷扩展（company）**：
  - **资金池开放投资**：成员投积分入池 `POST /pool/invest`（≥100，`company_pool_invest` 流水）→ `CompanyPoolInvestment`（`@@unique([companyId,userId])`，amount=可赎回份额含并入利息、earned 只增统计）；赎回 `POST /pool/redeem` 双 CAS（份额 + 池流动性，区分「份额不足」/「池子被贷空」）。贷款结清时利息按份额 floor 分配（余数留池）；解散时 `liquidateTx` 投资人优先全额发还（`company_pool_refund`）再成员均分剩余。
  - **CEO 放贷设置**：`Company.loanSettings` JSON `{enabled,ratePct(0–20),maxPrincipal(0=跟随档位),dueDays(1–90),membersOnly}`（null=跟随全站 CompanyConfig），`PUT /loan/settings` 仅 CEO；`effectiveLoanSettings` 公司设置非 0 优先。
  - **跨公司贷款**：`borrowLoan` 加可选 companyId（enabled=false 403、membersOnly 校验、per-company 逾期/上限检查保持）；`GET /loan/offers` 列开放放贷公司；银行页新增「公司贷款」区（可借公司卡+借款表单+到期应还预览+跨公司还款）；银行流水白名单补 `company_loan_borrow/repay`、`company_pool_invest/redeem`。`verify:points` 538 断言（+92）。
- **危机税款自选（crisis）**：`User.crisisTaxEnabled`（默认关）+ `CrisisRules.spendTaxPct`（默认 5，管理员可调 0–50）。**唯一挂钩点 `spendPointsTx`**（全站 26 处花费必经）：`reason=crisis_payment` 免税防循环；税=`floor(cost×pct/100)` 一次条件更新扣 `cost+tax`；台账两笔（主 reason + `crisis_tax`，税笔不带 game 防误入游戏输分上限统计）；税款同事务 increment `CrisisPool`；税率直读 `tx.crisisConfig`+pointsService 内 5s 模块缓存（**不 import crisisService 防循环依赖**）。`PUT /api/crisis/tax`（豁免名单内，被封锁也能开）；个人资料页开关行 + 危机页税款卡（taxOptIn/taxPaidTotal）。**注意 `petBattleService` 赌注结算用赌注本金而非 `|delta|`**（delta 含税，否则赢家凭空多得税款）。`verify:crisis` 563 断言。
- **数据库**：`Company.loanSettings`、`CompanyPoolInvestment`、`User.crisisTaxEnabled` 均 additive，`prisma db push` 即可；生产由 docker-entrypoint.sh 自动执行。
- **部署**：2026-11-05 按本地产物链上线（本地 build → client-dist 覆盖 → `git push deploy master` → 服务器 fetch/reset → `Dockerfile.prebuilt` 重建）。
