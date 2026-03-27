@echo off
REM -------------------------------------------------------------
REM keycloak-start.bat : Launch Keycloak if available.
REM Sets KEYCLOAK_STATUS = started|missing|skipped
REM Args:
REM   skip  -> skip starting keycloak
REM Env:
REM   KEYCLOAK_HOME (optional path)
REM -------------------------------------------------------------
setlocal
set KEYCLOAK_STATUS=missing
if /I "%~1"=="skip" goto :skip

if exist start-keycloak.bat (
  echo [Keycloak] Launching via start-keycloak.bat ...
  start "Keycloak" cmd /k "call start-keycloak.bat"
  set KEYCLOAK_STATUS=started
  goto :done
)
if defined KEYCLOAK_HOME if exist "%KEYCLOAK_HOME%\bin\kc.bat" (
  echo [Keycloak] Launching from KEYCLOAK_HOME=%KEYCLOAK_HOME%
  start "Keycloak" cmd /k "cd /d %KEYCLOAK_HOME%\bin && kc.bat start-dev"
  set KEYCLOAK_STATUS=started
  goto :done
)
echo [Keycloak] Not started (no script / KEYCLOAK_HOME)
set KEYCLOAK_STATUS=missing
goto :done

:skip
echo [Keycloak] Skipped by request
set KEYCLOAK_STATUS=skipped

:done
endlocal & set KEYCLOAK_STATUS=%KEYCLOAK_STATUS%
exit /b 0
