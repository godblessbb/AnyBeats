@echo off
chcp 65001 >nul
echo ========================================
echo   AnyBeats - Rap 创作工具
echo ========================================
echo.
echo 正在启动开发服务器...
echo.

REM 激活 conda 环境
call conda activate tool

REM 启动开发服务器并自动打开浏览器
npm run dev

pause
