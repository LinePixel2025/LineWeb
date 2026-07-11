@echo off
echo ========================================
echo   LineWeb Dev Server Start Script
echo ========================================
echo.

echo Starting backend server...
start "LineWeb Server" cmd /c "cd /d %~dp0server && npm run dev"

timeout /t 2 /nobreak >nul

echo Starting frontend dev server...
start "LineWeb Client" cmd /c "cd /d %~dp0client && npx vite"

timeout /t 2 /nobreak >nul

echo Starting storage node...
start "LineWeb Storage" cmd /c "cd /d %~dp0storage-node && python main.py"

echo.
echo ========================================
echo   All services started!
echo   Frontend: http://localhost:5173
echo   Backend: http://localhost:3001
echo ========================================
echo.
echo Press any key to exit this window (services will continue running)
pause >nul
