@echo off
title AI Resume Generator

echo ==================================================
echo   AI Resume Generator - Starting Services
echo ==================================================
echo.

:: Check if .env exists
if not exist ".env" (
    echo [ERROR] .env file not found. Create it with:
    echo   ANTHROPIC_API_KEY=sk-ant-...
    echo   JWT_SECRET=your-secret-here
    pause
    exit /b 1
)

:: Install Python dependencies if needed
echo [1/4] Checking Python dependencies...
pip install -q -r requirements.txt 2>nul

:: Initialize database (idempotent - safe to run every time)
echo [2/4] Initializing database...
python -m api.migrate

:: Install frontend dependencies if needed
echo [3/4] Checking frontend dependencies...
if not exist "frontend\node_modules" (
    echo   Installing npm packages...
    cd frontend && npm install && cd ..
)

:: Start backend and frontend
echo [4/4] Starting servers...
echo.
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo.
echo   Press Ctrl+C to stop both servers.
echo ==================================================
echo.

start "API Server" cmd /c "uvicorn api.server:app --reload --port 8000"
cd frontend && npm run dev
