@echo off
chcp 65001 >nul
echo ========================================
echo   AnyBeats - Rap 创作工具
echo ========================================
echo.

REM 激活 conda 环境
call conda activate tool

REM 检查后端数据库是否初始化
if not exist "backend\rhyme_db\chroma.sqlite3" (
    echo [提示] 首次运行，正在初始化韵脚词库...
    echo        这可能需要几分钟，请耐心等待...
    echo.
    cd backend
    python scripts/init_db.py
    cd ..
    echo.
)

REM 检查是否安装了 concurrently
call npm list concurrently >nul 2>&1
if errorlevel 1 (
    echo [提示] 首次运行，正在安装依赖...
    call npm install
    echo.
)

REM 同时启动前后端（在同一窗口）
echo [启动] 前后端服务...
echo        后端: http://localhost:8000
echo        前端: http://localhost:5173
echo.
npm start
