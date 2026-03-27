@echo off
REM TinyDB Cleanup Script - Easy Launcher
REM Keeps last 5 chat conversations per user, last 10 token metrics

echo ========================================
echo   TinyDB Cleanup Utility
echo ========================================
echo.

REM Activate conda environment
call conda activate devpilot 2>nul
if errorlevel 1 (
    echo Warning: Could not activate devpilot environment
    echo Trying with system Python...
)

echo Running cleanup analysis (dry-run)...
echo.

python cleanup_tinydb.py

echo.
echo ========================================
echo To actually delete data, run:
echo   python cleanup_tinydb.py --execute --backup
echo ========================================
pause
