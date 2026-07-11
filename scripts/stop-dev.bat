@echo off
echo ========================================
echo   LineWeb Dev Server Stop Script
echo ========================================
echo.

echo Stopping all Node.js processes...
taskkill /F /IM node.exe >nul 2>&1

echo Stopping all Python processes...
taskkill /F /IM python.exe >nul 2>&1

echo Releasing ports 3001 and 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo.
echo ========================================
echo   All services stopped!
echo ========================================
echo.
pause
