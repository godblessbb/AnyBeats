@echo off
chcp 65001 >nul
echo ========================================
echo   AnyBeats - Rap Creator
echo ========================================
echo.

REM Activate conda environment
call conda activate tool

REM Check if backend database is initialized
if not exist "backend\rhyme_db\chroma.sqlite3" (
    echo [Init] First run, initializing rhyme database...
    echo        This may take a few minutes...
    echo.
    cd backend
    python scripts/init_db.py
    cd ..
    echo.
)

REM Check if dependencies are installed
call npm list concurrently >nul 2>&1
if errorlevel 1 (
    echo [Init] Installing dependencies...
    call npm install
    echo.
)

REM Start both frontend and backend in same window
echo [Start] Backend: http://localhost:8000
echo [Start] Frontend: http://localhost:5173
echo.
npm start
