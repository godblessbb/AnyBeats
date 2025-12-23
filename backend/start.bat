@echo off
chcp 65001 >nul
echo ========================================
echo   AnyBeats 韵脚后端服务
echo ========================================
echo.

REM 检查是否在虚拟环境中
if not defined VIRTUAL_ENV (
    if exist venv\Scripts\activate.bat (
        echo 激活虚拟环境...
        call venv\Scripts\activate.bat
    )
)

REM 检查数据库是否初始化
if not exist rhyme_db\chroma.sqlite3 (
    echo.
    echo [警告] 数据库未初始化，正在初始化...
    echo 首次运行需要下载模型，请耐心等待...
    echo.
    python scripts/init_db.py
    if errorlevel 1 (
        echo.
        echo [错误] 初始化失败，请检查依赖是否安装
        echo 运行: pip install -r requirements.txt
        pause
        exit /b 1
    )
)

echo.
echo 启动后端服务...
echo API地址: http://localhost:8000
echo API文档: http://localhost:8000/docs
echo.
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload

pause
