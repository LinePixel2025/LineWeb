# LineWeb CLI

LineWeb 本地管理命令行工具。打包为单个 `LineWebCLI.exe`，**双击即可打开交互式控制台**管理本地前后端服务。

## 快速开始

```bash
# 1. 构建 exe（首次需要安装 cli 依赖）
cd cli && npm install
npm run build            # 产物：cli/dist/LineWebCLI.exe

# 或在仓库根目录
npm run build:cli
```

构建完成后双击 `cli/dist/LineWebCLI.exe`：

```
  LineWeb CLI  v1.0.0
  项目根目录：D:\AICOP\Projects\LineWeb
  输入 help 查看可用命令，exit 退出

lineweb> start
lineweb> status
lineweb> stop
```

也支持命令行直接执行单条命令（适合脚本/快捷方式）：

```bash
LineWebCLI.exe start
LineWebCLI.exe restart --no-storage
LineWebCLI.exe update --yes
LineWebCLI.exe logs server -f
```

## 命令一览

| 命令 | 说明 |
|------|------|
| `setup [--no-storage]` | **一键安装**：自动克隆/更新代码 → 安装依赖 → 生成 `.env` → 初始化数据库 → 启动服务 → 打印网盘存储 token（幂等，可重复执行） |
| `start [--no-storage]` | 后台启动后端（3001）+ 前端（5173）+ 存储节点（python） |
| `stop` | 停止所有服务（按 PID 杀进程树 + 按端口兜底清理） |
| `restart [--no-storage]` | 重启所有服务 |
| `status` | 查看各服务运行状态、端口监听、后端健康检查 |
| `update [--yes]` | 从 GitHub 拉取最新版本（`git reset --hard`，同 CI），重装依赖、同步数据库，服务在运行则自动重启 |
| `autoupdate [on\|off\|status] [--interval 6h]` | 注册 Windows 计划任务定时执行 `update --yes`（默认每 6 小时，支持 m/h/d；`on` 开启，`off` 关闭，`status` 查看） |
| `logs [server\|client\|storage] [-f]` | 查看日志，默认最近 30 行；`-f` 持续跟踪（仅命令行直调模式） |
| `open` | 打开浏览器访问 http://localhost:5173 |
| `help` / `exit` | 帮助 / 退出（退出不影响后台服务） |

## 新机器一键部署

在一台全新的 Windows 机器上（需先装好 [Git](https://git-scm.com) 和 [Node.js 18+](https://nodejs.org)，存储节点另需 Python 3.10+）：1. 把 `LineWebCLI.exe` 放到任意目录（如 `D:\`）
2. 双击打开控制台，输入 `setup` 回车

CLI 会自动在当前目录下克隆仓库到 `LineWeb/`，安装全部依赖，生成 `server/.env`（JWT 密钥与网盘存储 token 随机生成），初始化 SQLite 数据库与管理员账号，最后启动服务。完成后会打印**网盘存储节点 Token**——存储节点 `config.json` 的 `token` 字段（或环境变量 `LINEWEB_STORAGE_TOKEN`）需与该值一致才能连上网盘服务。exe 旁会写入 `lineweb-root.txt` 记录项目位置，之后在同一位置运行 `start`/`stop`/`update` 等命令均可自动定位。

管理后台：http://localhost:5173/admin（`admin@lineweb.dev` / `admin123`）。

## 说明

- **启动模式**：开发模式（后端 `tsx watch` + 前端 `vite dev`），与 `scripts/start-dev.ps1` 一致。
- **进程管理**：服务以独立后台进程运行，PID 记录在 `<项目根>/.lineweb-cli/state.json`，日志写入 `.lineweb-cli/logs/*.log`。CLI 退出不影响服务。
- **更新策略**：与服务器 CI 部署一致，强制覆盖本地已提交改动；未跟踪文件（如 `server/.env`）不受影响。有本地改动时会先列出并要求确认（`--yes` 跳过）。
- **自动更新**：`autoupdate on [--interval 6h]` 注册 Windows 计划任务（`LineWeb-AutoUpdate`），按间隔自动执行 `update --yes`。以 **S4U 登录类型**运行，**无需保持用户登录**（无人值守），重启机器后依然生效；`autoupdate off` 关闭，`autoupdate status` 查看下次/上次运行及登录模式。更新与手动 `update` 通过锁文件互斥，不会并发执行。S4U 不加载用户环境变量，运行脚本（`.lineweb-cli/autoupdate-run.bat`）会注入 HOME/APPDATA/PATH 等；日志写入 `.lineweb-cli/logs/autoupdate.log`。注册 S4U 计划任务需要管理员权限（非管理员 shell 会提示"拒绝访问"）。
- **数据库备份**：每次 `update` 执行 `prisma db push` 前，自动将 `server/prisma/*.db` 备份到 `.lineweb-cli/db-backups/`（保留最近 5 份）。`--accept-data-loss` 有破坏性，备份可回滚。
- **内网穿透场景**：CLI 全部命令走本地回路，不依赖公网，穿透中断不影响 `update`/`autoupdate` 拉代码。自动更新以 S4U 身份运行，无需保持登录；注册时需管理员权限。
- **项目根定位**：优先读环境变量 `LINEWEB_ROOT`，否则从 exe 所在目录 / 当前目录向上查找 `name: "lineweb"` 的 `package.json`。因此可以把 exe 复制到项目内任意位置使用；复制到其他位置时需设置 `LINEWEB_ROOT`。
- **依赖**：CLI 本身免安装 Node（exe 内嵌运行时）；启动服务仍需本机装有 Node 18+、npm、Python 3.10+（存储节点）。

## 开发

```bash
cd cli
npm run dev              # tsx 直接运行（调试）
npm run typecheck        # tsc 类型检查
npm run build            # esbuild 打包 + pkg 编译 exe
```
