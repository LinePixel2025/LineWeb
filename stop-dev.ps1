# LineWeb 本地开发服务器一键关闭脚本

Write-Host "正在停止 LineWeb 本地开发服务器..." -ForegroundColor Cyan

# 停止 Node.js 进程 (前端和后端)
Write-Host "停止 Node.js 进程..." -ForegroundColor Yellow
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "vite|tsx|npm"
} | Stop-Process -Force -ErrorAction SilentlyContinue

# 停止 Python 进程 (存储节点)
Write-Host "停止 Python 进程..." -ForegroundColor Yellow
Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "main.py"
} | Stop-Process -Force -ErrorAction SilentlyContinue

# 停止可能占用端口的进程
Write-Host "释放端口 3001 和 5173..." -ForegroundColor Yellow
$ports = @(3001, 5173)
foreach ($port in $ports) {
    $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | 
        Select-Object -ExpandProperty OwningProcess -First 1
    if ($process) {
        Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  LineWeb 本地开发服务器已停止!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
