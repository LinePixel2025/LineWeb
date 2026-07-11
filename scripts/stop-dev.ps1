# LineWeb dev server stop script

Write-Host "Stopping LineWeb dev server..." -ForegroundColor Cyan

Write-Host "Stopping Node.js processes..." -ForegroundColor Yellow
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "vite|tsx|npm"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Stopping Python processes..." -ForegroundColor Yellow
Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "main.py"
} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Releasing ports 3001 and 5173..." -ForegroundColor Yellow
$ports = @(3001, 5173)
foreach ($port in $ports) {
    $process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | 
        Select-Object -ExpandProperty OwningProcess -First 1
    if ($process) {
        Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  LineWeb dev server stopped!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
