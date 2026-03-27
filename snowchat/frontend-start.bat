@echo off
REM -------------------------------------------------------------
REM frontend-start.bat : Start React dev server if prerequisites present.
REM Sets FRONTEND_STATUS = started|skipped|error
REM Args:
REM   skip -> skip frontend
REM -------------------------------------------------------------
setlocal enabledelayedexpansion
REM Auto-map backend realm env vars to React build-time vars if not already set.
if not defined REACT_APP_KEYCLOAK_URL (
  if defined KEYCLOAK_URL (set REACT_APP_KEYCLOAK_URL=%KEYCLOAK_URL%) else (set REACT_APP_KEYCLOAK_URL=http://localhost:8080)
)
if not defined REACT_APP_KEYCLOAK_REALM (
  if defined KEYCLOAK_REALM (set REACT_APP_KEYCLOAK_REALM=%KEYCLOAK_REALM%) else (set REACT_APP_KEYCLOAK_REALM=snowchat)
)
if not defined REACT_APP_KEYCLOAK_CLIENT_ID (
  if /I "%REACT_APP_KEYCLOAK_REALM%"=="devpilot" (
    set REACT_APP_KEYCLOAK_CLIENT_ID=devpilot-frontend
  ) else (
    set REACT_APP_KEYCLOAK_CLIENT_ID=snowchat-frontend
  )
)
set FRONTEND_STATUS=skipped
if /I "%~1"=="skip" goto :done

where node >nul 2>&1 || (echo [Frontend] Node not found & set FRONTEND_STATUS=skipped & goto :done)
where npm >nul 2>&1 || (echo [Frontend] npm not found & set FRONTEND_STATUS=skipped & goto :done)
if not exist frontend\package.json (
  echo [Frontend] package.json missing; skipping
  set FRONTEND_STATUS=skipped
  goto :done
)
if not exist frontend\node_modules (
  echo [Frontend] Installing dependencies...
  pushd frontend >nul
  call npm install > ..\frontend-install.log 2>&1
  popd >nul
  if not exist frontend\node_modules (
    echo [Frontend] ERROR install failed (see frontend-install.log)
    set FRONTEND_STATUS=error
    goto :done
  )
)
echo [Frontend] Starting React dev server...
echo [Frontend] Using Keycloak URL=%REACT_APP_KEYCLOAK_URL% Realm=%REACT_APP_KEYCLOAK_REALM% Client=%REACT_APP_KEYCLOAK_CLIENT_ID%
start "Frontend" cmd /k "cd frontend && set REACT_APP_KEYCLOAK_URL=%REACT_APP_KEYCLOAK_URL% && set REACT_APP_KEYCLOAK_REALM=%REACT_APP_KEYCLOAK_REALM% && set REACT_APP_KEYCLOAK_CLIENT_ID=%REACT_APP_KEYCLOAK_CLIENT_ID% && npm start"
set FRONTEND_STATUS=started

:done
endlocal & set FRONTEND_STATUS=%FRONTEND_STATUS%
exit /b 0
