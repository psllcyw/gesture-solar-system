@echo off
rem Solar gesture viewer - one click local server launcher (ASCII only)
cd /d "%~dp0"

rem 8200 起，端口被占用时 serve.py 会自动顺延并打开正确地址
where py >nul 2>nul && (set PY=py) || (set PY=python)

echo ========================================
echo   Gesture Solar System
echo   Closing this window stops the server
echo ========================================
"%PY%" serve.py 8200 --open
pause
