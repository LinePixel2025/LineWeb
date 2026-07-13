# LineWeb 屏幕时间 API 文档

用于第三方应用读写用户屏幕使用时间。所有接口使用屏幕时间 Token 认证，无需 JWT 登录态。

**生产环境基址：** `https://lineweb-production.up.railway.app`  
**本地开发：** `http://localhost:3001`

---

## 认证

所有请求在 Header 中携带 Token：

```
X-Screen-Time-Token: st_xxxxxxxxxxxx
```

Token 由用户在 LineWeb 个人资料页 → 数字健康生成。格式：`st_` + 64 位 hex。有效期可为永久、7 天或 30 天。

---

## 端点

### 1. 推送屏幕时间（写）

```
POST /api/health/push
```

**请求体 (JSON)：**

```json
{
  "totalSeconds": 12345,
  "date": "2026-07-14"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `totalSeconds` | int | 是 | 当日累计屏幕使用秒数（0~86400） |
| `date` | string | 是 | 日期，`YYYY-MM-DD` |

**成功响应 (200)：**

```json
{ "message": "已同步" }
```

**说明：** 按用户 + 日期覆盖存储，重复推送以最新值为准。

---

### 2. 获取屏幕时间（读）

```
GET /api/health/screen-time/data
```

**无请求体。** 返回 Token 所属用户今日数据。

**成功响应 (200)：**

```json
{
  "totalSeconds": 12345,
  "date": "2026-07-14",
  "reportedAt": "2026-07-14T12:34:56.000Z",
  "updatedAt": "2026-07-14T12:34:56.000Z"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalSeconds` | int | 今日累计秒数，无数据时为 `0` |
| `date` | string | 日期，`YYYY-MM-DD` |
| `reportedAt` | string\|null | 客户端最后一次上报时间（ISO 8601） |
| `updatedAt` | string\|null | 服务器最后更新时间（ISO 8601） |

---

### 3. 错误响应

| 状态码 | 含义 |
|--------|------|
| 400 | 参数无效（`totalSeconds` 超范围或 `date` 格式错误） |
| 401 | Token 无效或已过期 |
| 404 | Token 对应的用户不存在 |

---

## 使用流程

```
应用启动 → GET /screen-time/data 拉取已有数据 → 与本地合并
         → 定时 POST /push 推送最新累计秒数
         → 退出前 POST /push 最终数据
```

---

## cURL 示例

```bash
# 读取今日数据
curl -s https://lineweb-production.up.railway.app/api/health/screen-time/data \
  -H "X-Screen-Time-Token: st_your_token"

# 推送今日数据
curl -s -X POST https://lineweb-production.up.railway.app/api/health/push \
  -H "Content-Type: application/json" \
  -H "X-Screen-Time-Token: st_your_token" \
  -d '{"totalSeconds": 7200, "date": "2026-07-14"}'
```

---

## 备注

- 同一 Token 可同时用于读写，无需分别生成。
- 用户删除 Token 后该 Token 立即失效。
- 服务器按请求到达时间记录，不验证 `date` 是否为当天。
