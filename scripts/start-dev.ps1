# LineWeb 本地开发服务器一键启动脚本

Write-Host "正在启动 LineWeb 本地开发服务器..." -ForegroundColor Cyan

# 获取脚本所在目录
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 启动后端服务器
Write-Host "启动后端服务器 (端口 3001)..." -ForegroundColor Yellow
$serverJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\server"
    npm run dev
} -ArgumentList $rootDir

# 启动前端开发服务器
Write-Host "启动前端开发服务器 (端口 5173)..." -ForegroundColor Yellow
$clientJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\client"
    npx vite
} -ArgumentList $rootDir

# 启动存储节点
Write-Host "启动存储节点..." -ForegroundColor Yellow
$storageJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\storage-node"
    python main.py
} -ArgumentList $rootDir

# 等待服务器启动
Start-Sleep -Seconds 3

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  LineWeb 本地开发服务器已启动!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  前端: http://localhost:5173" -ForegroundColor White
Write-Host "  后端: http://localhost:3001" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host "`n按 Ctrl+C 停止所有服务器" -ForegroundColor Yellow

# 保持脚本运行并显示作业输出
try {
    while ($true) {
        Receive-Job -Job $serverJob, $clientJob, $storageJob
        Start-Sleep -Seconds 1
    }
} finally {
    # 清理作业
    Stop-Job -Job $serverJob, $clientJob, $storageJob
    Remove-Job -Job $serverJob, $clientJob, $storageJob -Force
    Write-Host "所有服务器已停止" -ForegroundColor Red
}
