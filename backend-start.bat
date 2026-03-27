@echo off
REM -------------------------------------------------------------
REM backend-start.bat : Launch backend Flask app.
REM Sets BACKEND_STATUS = started|missing
REM Args:
REM   skip -> skip backend
REM -------------------------------------------------------------
setlocal
set BACKEND_STATUS=missing
if /I "%~1"=="skip" goto :done
if not exist backend\app.py (
  echo [Backend] backend\app.py missing
  goto :done
)
REM Determine python command (prefer local venv)
set PY_CMD=
if exist .venv\Scripts\python.exe set PY_CMD=.venv\Scripts\python.exe
if not defined PY_CMD (
  where python >nul 2>&1 && set PY_CMD=python
)
if not defined PY_CMD (
  echo [Backend] ERROR: No python interpreter found.
  goto :done
)

REM Lazy dependency install check (import flask)
%PY_CMD% -c "import flask" >nul 2>&1
if errorlevel 1 (
  echo [Backend] Installing Python dependencies (first run)...
  %PY_CMD% -m pip install --quiet -r requirements.txt
)

if "%BACKEND_DEBUG%"=="1" (
  echo [Backend] Starting Flask backend in DEBUG (debugpy attach) mode using %PY_CMD% ...
  start "Backend" cmd /k "%PY_CMD% backend\app.py --debug-listen"
) else (
  echo [Backend] Starting Flask backend using %PY_CMD% ...
  start "Backend" cmd /k "%PY_CMD% backend\app.py"
)
set BACKEND_STATUS=started

:done
endlocal & set BACKEND_STATUS=%BACKEND_STATUS%
exit /b 0
