# 小说阅读器 API（/api/reader）

> 2026-11-01 新增。前端 `/reader`（书架）+ `/reader/:bookId`（阅读视图）。
> 受 `reader` 功能开关控制（`/admin/features`），管理员豁免开关与限流。

## 概览

- 用户上传 **EPUB / TXT**（单本 ≤ 50 MiB），服务端解析 EPUB 元数据（标题/作者/内嵌封面）后存入存储节点系统目录 `_books/<userId>/`（`storageSync` 已排除，不进网盘），文件本体**计入网盘配额**（`driveQuota.getDriveUsage` 的 `Book` 聚合；封面体积小不计）。
- **上传分两段耗时**：① 浏览器 → 服务器（XHR `upload.onprogress` 的 0–100%）；② 服务器写存储节点 + 解析 EPUB 元数据（客户端看不到进度）。前端把 ② 显示为「服务器正在写入存储」阶段并带计时，避免看起来「卡在 100%」；`XHR.timeout = 5min` 兜底。服务端 busboy 按 `content-length` 预分配缓冲（`lib/multipartImage.ts`），避免「chunks 数组 + concat」的 2 倍内存峰值（512MB 容器下 50MiB 的书原本要占 100MB+）。
- 写入节点走 `storageTunnel.streamWriteBinary`，背压用轮询 `bufferedAmount`（`ws` 不会发出 `drain` 事件，早期实现会在这里死等，表现为上传 100% 后请求永不返回）。
- EPUB 由前端 vendored **foliate-js**（MIT，快照见 `client/src/lib/reader/foliate/VENDORED.md`）渲染，进度以 foliate CFI 保存；TXT 前端自行做编码检测（UTF-8 → GB18030）与正则分章，进度按 `{chapter, offset}` JSON 保存。
- 全部端点需登录令牌（应用令牌不在 appScopes 白名单 → 403）。

## 表

- `Book`（books）：`user_id`、`title`、`author`、`format(epub|txt)`、`size`、`storage_path @unique`、`cover_path?`
- `BookProgress`（book_progress）：`book_id`（Cascade）、`user_id`、`location`、`percent(0–1)`，`@@unique([bookId, userId])`

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reader/books` | 书架（含本人进度，最近在读在前）。响应 `{ books: BookDto[] }` |
| POST | `/api/reader/books` | 上传（`multipart/form-data`，字段名 `file`）。限流 20/5min。三段式配额：预检 413 → busboy 按 `min(50MiB, 剩余)` 截断 → 写后复核（超限回滚行 + 删节点文件）。EPUB 解析出标题/作者/封面（失败回退文件名，不阻断）。响应 `201 { book: BookDto }` |
| PUT | `/api/reader/books/:id/progress` | 保存进度 `{ location, percent }`（epub=CFI，txt=`{chapter,offset}` JSON）。upsert，非本人书 404 |
| DELETE | `/api/reader/books/:id` | 删除（行 + 进度级联 + 节点文件对偶清理） |
| GET | `/api/reader/books/:id/file` | 书籍文件直链（仅属主；支持 `?token=`；`application/epub+zip` 或 `application/octet-stream`；`Cache-Control: private, immutable`） |
| GET | `/api/reader/books/:id/cover` | 封面缩略图（宽 300 WebP；仅属主；`?token=`；immutable）。无封面 404 |

`BookDto`：`{ id, title, author, format, size, hasCover, createdAt, updatedAt, progress: { location, percent, updatedAt } | null }`

## 错误码

- `400` 非 EPUB/TXT、空文件、参数无效
- `404` 书籍不存在/非本人（不泄露存在性）
- `413` 超过单本上限或网盘配额不足
- `502` 节点写入失败；`503` 存储节点未接入

## 自检

```bash
cd server && npm run verify:reader   # EPUB 元数据解析/zip 路径/格式识别等 32 断言
```
