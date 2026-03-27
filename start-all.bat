@echo off
REM ============================================================================
REM start-all.bat (modular orchestrator)
REM Invokes individual component scripts:
REM   kafka-start.bat [skip|docker]
REM   keycloak-start.bat [skip]
REM   frontend-start.bat [skip]
REM   backend-start.bat [skip]
REM Args (order independent):
REM   debug       -> verbose summary
REM   no-kafka|quick -> skip kafka
REM   backend     -> start backend
REM   no-frontend -> skip frontend
REM   no-keycloak -> skip keycloak
REM   docker-kafka -> force docker path
REM ============================================================================
setlocal
set START_DEBUG=0
set WANT_BACKEND=0
set FORCE_DOCKER=0
set SKIP_KAFKA=0
set SKIP_FRONTEND=0
set SKIP_KEYCLOAK=0

if "%~1"=="" goto :args_done
:loop
if /I "%~1"=="debug" set START_DEBUG=1
if /I "%~1"=="backend" set WANT_BACKEND=1
if /I "%~1"=="no-kafka" set SKIP_KAFKA=1
if /I "%~1"=="quick" set SKIP_KAFKA=1
if /I "%~1"=="no-frontend" set SKIP_FRONTEND=1
if /I "%~1"=="no-keycloak" set SKIP_KEYCLOAK=1
if /I "%~1"=="docker-kafka" set FORCE_DOCKER=1
shift
if not "%~1"=="" goto :loop
:args_done

if "%START_DEBUG%"=="1" (echo [Mode] DEBUG enabled) else (echo === Snowchat Modular Startup ===)

REM Kafka
if "%SKIP_KAFKA%"=="1" (
  call kafka-start.bat skip
) else if "%FORCE_DOCKER%"=="1" (
  call kafka-start.bat docker
) else (
  call kafka-start.bat
)

REM Keycloak
if "%SKIP_KEYCLOAK%"=="1" (
  call keycloak-start.bat skip
) else (
  call keycloak-start.bat
)

REM Frontend
if "%SKIP_FRONTEND%"=="1" (
  call frontend-start.bat skip
) else (
  call frontend-start.bat
)

REM Backend
if "%WANT_BACKEND%"=="1" (
  call backend-start.bat
) else (
  call backend-start.bat skip
)

echo.
echo ================= SUMMARY =================
echo Kafka........: %KAFKA_STATUS% (port=%KAFKA_PORT%) streaming=%ENABLE_EVENT_STREAMING%
echo Keycloak.....: %KEYCLOAK_STATUS%
echo Frontend.....: %FRONTEND_STATUS%
echo Backend......: %BACKEND_STATUS%
echo ===========================================
echo.
if NOT "%START_DEBUG%"=="1" pause
endlocal
exit /b 0