# LineWeb 屏幕时间读取 API

供 LineWeb 的其他客户端（桌面小组件、移动端、浏览器扩展等）读取用户当日的屏幕使用时间。

**生产环境：** `https://lineweb-production.up.railway.app`  
**本地开发：** `http://localhost:3001`

---

## 认证

所有请求在 Header 中携带 Token：

```
X-Screen-Time-Token: st_xxxxxxxxxxxx
```

Token 由用户在 LineWeb 个人资料页 → 数字健康生成。格式：`st_` + 64 位 hex。

---

## 端点

```
GET /api/health/screen-time/data
```

**无请求体，无查询参数。** 返回 Token 所属用户当日的屏幕时间数据。

**成功响应（200）：**

```json
{
  "totalSeconds": 12345,
  "date": "2026-07-14",
  "reportedAt": "2026-07-14T12:34:56.000Z",
  "updatedAt": "2026-07-14T12:34:56.000Z"
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalSeconds` | int | 当日累计屏幕使用秒数。无数据时为 `0` |
| `date` | string | 日期，`YYYY-MM-DD` |
| `reportedAt` | string \| null | 客户端最后一次上报时间（ISO 8601）。无数据时为 `null` |
| `updatedAt` | string \| null | 服务器最后更新时间（ISO 8601）。无数据时为 `null` |

**无数据时的响应：**

```json
{
  "totalSeconds": 0,
  "date": "2026-07-14",
  "reportedAt": null,
  "updatedAt": null
}
```

---

## 错误响应

| 状态码 | 含义 | 响应体示例 |
|--------|------|-----------|
| `400` | 参数无效 | `{"error":"输入数据无效"}` |
| `401` | Token 无效或已过期 | `{"error":"Token 无效或已过期"}` |
| `404` | Token 所属用户不存在 | — |

---

## 客户端示例

### JavaScript / TypeScript

```ts
interface ScreenTimeData {
  totalSeconds: number
  date: string
  reportedAt: string | null
  updatedAt: string | null
}

async function fetchScreenTime(baseUrl: string, token: string): Promise<ScreenTimeData> {
  const res = await fetch(`${baseUrl}/api/health/screen-time/data`, {
    headers: { 'X-Screen-Time-Token': token },
  })
  if (!res.ok) {
    throw new Error(`LineWeb API error: ${res.status}`)
  }
  return res.json()
}

// 使用
const data = await fetchScreenTime('https://lineweb-production.up.railway.app', 'st_xxxx')
console.log(`今日屏幕时间: ${Math.floor(data.totalSeconds / 3600)} 小时 ${Math.floor((data.totalSeconds % 3600) / 60)} 分钟`)
```

### Python

```python
import requests

def fetch_screen_time(base_url, token):
    resp = requests.get(
        f"{base_url}/api/health/screen-time/data",
        headers={"X-Screen-Time-Token": token},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()

data = fetch_screen_time("https://lineweb-production.up.railway.app", "st_xxxx")
hours = data["totalSeconds"] // 3600
minutes = (data["totalSeconds"] % 3600) // 60
print(f"今日屏幕时间: {hours} 小时 {minutes} 分钟")
```

### cURL

```bash
curl -s https://lineweb-production.up.railway.app/api/health/screen-time/data \
  -H "X-Screen-Time-Token: st_your_token"
```

### Go

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

type ScreenTimeData struct {
    TotalSeconds int     `json:"totalSeconds"`
    Date         string  `json:"date"`
    ReportedAt   *string `json:"reportedAt"`
    UpdatedAt    *string `json:"updatedAt"`
}

func fetchScreenTime(baseURL, token string) (*ScreenTimeData, error) {
    req, _ := http.NewRequest("GET", baseURL+"/api/health/screen-time/data", nil)
    req.Header.Set("X-Screen-Time-Token", token)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var data ScreenTimeData
    if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
        return nil, err
    }
    return &data, nil
}

func main() {
    data, _ := fetchScreenTime("https://lineweb-production.up.railway.app", "st_xxxx")
    h := data.TotalSeconds / 3600
    m := (data.TotalSeconds % 3600) / 60
    fmt.Printf("今日屏幕时间: %d 小时 %d 分钟\n", h, m)
}
```

---

## 轮询建议

- **频率：** 建议每 30~60 秒轮询一次，平衡实时性与服务器负载。
- **离线处理：** `reportedAt` 为 `null` 表示客户端尚未推送过数据，此时可显示"等待同步"状态。
- **数据陈旧：** 可对比 `reportedAt` 与当前时间，超过推送间隔（如 15 分钟）提示用户 Time Master 可能未运行。
