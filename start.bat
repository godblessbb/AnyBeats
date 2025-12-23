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

REM 启动后端（新窗口）
echo [1/2] 启动韵脚后端服务...
start "AnyBeats Backend" cmd /k "cd backend && python -m uvicorn app:app --host 0.0.0.0 --port 8000"

REM 等待后端启动
timeout /t 3 /nobreak >nul

REM 启动前端
echo [2/2] 启动前端开发服务器...
echo.
npm run dev

pause
