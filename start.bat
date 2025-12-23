@echo off
chcp 65001 >nul
echo ========================================
echo   AnyBeats - Rap 创作工具
echo ========================================
echo.
echo [提示] 如需使用韵脚助手，请先启动后端:
echo        cd backend ^&^& start.bat
echo.
echo 正在启动前端开发服务器...
echo.

REM 激活 conda 环境
call conda activate tool

REM 启动开发服务器并自动打开浏览器
npm run dev

pause
