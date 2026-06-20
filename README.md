# Line Web

一个融合 Apple Liquid Glass 设计语言的个人网站。

## 特性

- ✨ **Liquid Glass 设计** — Apple WWDC 2025 全新设计语言，毛玻璃质感
- 📝 **文章系统** — Markdown 写作、发布与管理
- 🧮 **在线计算器** — 支持基础运算与科学计算
- 🌓 **智能主题** — 亮色/暗色模式，跟随系统或手动切换
- 📱 **响应式设计** — 桌面端与移动端完美适配
- 🔐 **认证系统** — JWT 登录注册，管理员面板

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 6, TypeScript, React Router 7 |
| 后端 | Express 4, Prisma 6, JWT, Zod |
| 数据库 | MySQL |
| 设计 | Liquid Glass (backdrop-filter CSS) |

## 快速开始

### 前置要求

- Node.js 18+
- MySQL 8+

### 安装

```bash
# 配置 npm 镜像（中国用户）
npm config set registry https://registry.npmmirror.com

# 安装依赖
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 配置

编辑 `server/.env`：

```env
DATABASE_URL="mysql://用户名:密码@localhost:3306/lineweb"
JWT_SECRET="替换为安全的密钥"
```

### 启动

```bash
# 同步数据库结构
npm run db:push

# 填充种子数据 (管理员: admin@lineweb.dev / admin123)
npm run db:seed

# 启动开发环境 (前后端同时)
npm run dev
```

打开 http://localhost:5173

### 管理员入口

访问 `/admin` 登录管理员账号：

- 邮箱：`admin@lineweb.dev`
- 密码：`admin123`

## 项目结构

```
lineweb/
├── client/          # 前端应用
│   └── src/
│       ├── components/   # 共享组件
│       ├── contexts/     # React Context
│       ├── pages/        # 页面
│       ├── lib/          # 工具
│       └── styles/       # 全局样式
├── server/          # 后端 API
│   ├── prisma/      # 数据库模型 & 种子
│   └── src/
│       ├── config/      # 校验 & 配置
│       ├── middleware/   # 认证中间件
│       └── routes/      # API 路由
└── package.json     # Monorepo 脚本
```

## API

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户信息 |

### 文章
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/posts` | 文章列表 | 公开 |
| GET | `/api/posts/:slug` | 文章详情 | 公开 |
| GET | `/api/posts/admin/all` | 全部文章 | admin |
| GET | `/api/posts/admin/:id` | 文章详情 | admin |
| POST | `/api/posts` | 创建文章 | admin |
| PUT | `/api/posts/:id` | 更新文章 | admin |
| DELETE | `/api/posts/:id` | 删除文章 | admin |

## License

MIT
