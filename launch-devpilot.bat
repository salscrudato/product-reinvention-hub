@echo off
REM ============================================================================
REM launch-devpilot.bat
REM One-stop script to:
REM   1. Start Keycloak (dev mode) if not already running
REM   2. Provision devpilot realm (roles, client, users) via PowerShell script
REM   3. Set environment variables for backend & frontend (devpilot realm)
REM   4. Start backend (Flask)
REM   5. Start frontend (React) with devpilot Keycloak config
REM   6. Perform a quick token acquisition test for user dev1
REM Requirements:
REM   - Keycloak distribution accessible via start-keycloak.bat or KEYCLOAK_HOME
REM   - PowerShell available (Windows default)
REM   - Node/NPM installed for frontend
REM   - Python + dependencies installed for backend
REM ============================================================================
setlocal ENABLEDELAYEDEXPANSION

REM --- Configurable defaults ---
set KC_URL=http://localhost:8080
set KC_REALM=devpilot
set KC_CLIENT=devpilot-frontend
set DEV_USER=dev1
set DEV_PASS=DevPass123!

REM Allow overrides passed like KC_REALM=custom call launch-devpilot.bat
for %%A in (KC_URL KC_REALM KC_CLIENT DEV_USER DEV_PASS) do (
  for /f "tokens=1,2 delims==" %%K in ("%%A") do (
    if NOT "%%L"=="" set %%K=%%L
  )
)

echo === SnowChat DevPilot Launcher ===
echo Keycloak: %KC_URL%  Realm: %KC_REALM%  Client: %KC_CLIENT%

REM --- 1. Start Keycloak (non-blocking window) ---
echo [1/6] Starting Keycloak (if not already)...
call keycloak-start.bat >nul 2>&1
echo [1/6] Waiting for Keycloak to become ready...
set KC_READY=0
for /L %%I in (1,1,15) do (
  powershell -NoLogo -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing %KC_URL%/realms/master/.well-known/openid-configuration -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set KC_READY=1
    goto :kc_ready
  )
  >nul ping 127.0.0.1 -n 2
)
:kc_ready
if "%KC_READY%"=="1" (echo [1/6] Keycloak ready) else (echo [1/6] WARNING: Keycloak readiness not confirmed, continuing...)

REM --- 2. Provision realm/users ---
echo [2/6] Provisioning realm '%KC_REALM%' (idempotent)...
set PROVISION_FAILED=0
if /I "%LAUNCH_SKIP_PROVISION%"=="1" (
  echo [2/6] Skipping provisioning by request (LAUNCH_SKIP_PROVISION=1)
) else (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "keycloak\provision_devpilot_realm.ps1" -BaseUrl %KC_URL% -Realm %KC_REALM% -ClientId %KC_CLIENT% -AdminUser admin -AdminPassword admin > provisioning.log 2>&1
  if errorlevel 1 (
    echo [2/6] Provisioning script reported an error. See provisioning.log
    set PROVISION_FAILED=1
  ) else (
    echo [2/6] Provisioning complete (see provisioning.log for details)
  )
)

REM --- 3. Export environment for backend process only ---
echo [3/6] Setting backend environment variables...
set KEYCLOAK_URL=%KC_URL%
set KEYCLOAK_REALM=%KC_REALM%
set KEYCLOAK_CLIENT_ID=%KC_CLIENT%
REM (Optional) Add other env exports here e.g. SERVICENOW_* GITHUB_*

REM --- 4. Start backend ---
echo [4/6] Launching backend in DEBUG attach mode...
set BACKEND_DEBUG=1
set DEBUG_WAIT=1
set DEBUG_PORT=5678
call backend-start.bat
if not "%BACKEND_STATUS%"=="started" (
  echo [4/6] WARNING: Backend did not start (status=%BACKEND_STATUS%). Check Python / dependencies.
)

REM --- 5. Start frontend with devpilot env overrides ---
echo [5/6] Launching frontend (devpilot realm)...
pushd frontend
set REACT_APP_KEYCLOAK_URL=%KC_URL%
set REACT_APP_KEYCLOAK_REALM=%KC_REALM%
set REACT_APP_KEYCLOAK_CLIENT_ID=%KC_CLIENT%
if exist node_modules (echo [Frontend] Dependencies present) else (echo [Frontend] Installing dependencies... & call npm install)
start "Frontend" cmd /k "set REACT_APP_KEYCLOAK_URL=%KC_URL% && set REACT_APP_KEYCLOAK_REALM=%KC_REALM% && set REACT_APP_KEYCLOAK_CLIENT_ID=%KC_CLIENT% && npm start"
popd

REM --- 6. Quick token test for dev1 (client public direct grant) ---
echo [6/6] Testing direct access token acquisition for %DEV_USER% ...
powershell -NoLogo -NoProfile -Command ^
  "$b='%KC_URL%/realms/%KC_REALM%/protocol/openid-connect/token'; ^
   $resp=Invoke-RestMethod -Method Post -Uri $b -Body @{client_id='%KC_CLIENT%';grant_type='password';username='%DEV_USER%';password='%DEV_PASS%'} -ContentType 'application/x-www-form-urlencoded'; ^
   if($resp.access_token){$payload=$resp.access_token.Split('.')[1];$pad=4-($payload.Length%4);if($pad -lt 4){$payload=$payload+'='*$pad};$json=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload)); Write-Host 'Token OK (decoded payload excerpt):'; ($json | Select-String -Pattern '"preferred_username"'); } else {Write-Error 'No access_token returned'}}" > token_test.log 2>&1
if errorlevel 1 (
  echo Token test failed. See token_test.log
) else (
  type token_test.log | find /i "preferred_username" >nul && echo Token test success for %DEV_USER% || echo Review token_test.log (payload not parsed)
)

echo.
echo Done.
echo Realm provisioning failed? %PROVISION_FAILED% (0 means ok). See provisioning.log if 1.
echo Open http://localhost:3000 and log in as %DEV_USER% / %DEV_PASS% (realm: %KC_REALM%).
echo If the browser shows the old realm, clear cache/local storage or restart npm dev server.

:post
echo (Close this window or press a key to finish summary.)
pause >nul
endlocal
exit /b 0
