# LineWeb dev server start script

Write-Host "Starting LineWeb dev server..." -ForegroundColor Cyan

$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "Starting backend server (port 3001)..." -ForegroundColor Yellow
$serverJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\server"
    npm run dev
} -ArgumentList $rootDir

Write-Host "Starting frontend dev server (port 5173)..." -ForegroundColor Yellow
$clientJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\client"
    npx vite
} -ArgumentList $rootDir

Write-Host "Starting storage node..." -ForegroundColor Yellow
$storageJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\storage-node"
    python main.py
} -ArgumentList $rootDir

Start-Sleep -Seconds 3

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  LineWeb dev server started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "  Backend: http://localhost:3001" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop all servers" -ForegroundColor Yellow

try {
    while ($true) {
        Receive-Job -Job $serverJob, $clientJob, $storageJob
        Start-Sleep -Seconds 1
    }
} finally {
    Stop-Job -Job $serverJob, $clientJob, $storageJob
    Remove-Job -Job $serverJob, $clientJob, $storageJob -Force
    Write-Host "All servers stopped" -ForegroundColor Red
}
