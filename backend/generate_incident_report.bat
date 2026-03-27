@echo off
REM ========================================================
REM Workflow Incident Analysis Report Generator
REM ========================================================
REM This script generates a unified incident analysis report
REM Output: wf_inc_analysis.txt (fixed filename, overwrites each run)
REM ========================================================

echo.
echo ========================================================
echo   Workflow Incident Analysis Report Generator
echo ========================================================
echo.
echo Generating comprehensive incident report...
echo.
echo This includes:
echo   - Executive Summary (AI-generated for leadership)
echo   - Developer Technical Deep-Dive (detailed analysis)
echo.

REM Activate conda environment
call C:\Users\s.kumar.mamidala\AppData\Local\anaconda3\Scripts\activate.bat
call conda activate devpilot

REM Change to backend directory
cd /d "%~dp0"

REM Run the analyzer in unified mode
python batch_incident_analyzer.py --mode unified

echo.
echo ========================================================
echo Report generation complete!
echo.
echo Output file: wf_inc_analysis.txt
echo Location: %CD%\wf_inc_analysis.txt
echo ========================================================
echo.

pause
