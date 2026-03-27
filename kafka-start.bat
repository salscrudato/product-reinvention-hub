@echo off
REM -------------------------------------------------------------
REM kafka-start.bat : Start (or verify) Kafka stack and ensure topics.
REM Sets (in current shell when invoked via CALL):
REM   KAFKA_STATUS = started|running|spooling|error|skipped
REM   ENABLE_EVENT_STREAMING = true|false
REM   KAFKA_PORT (if detected/used)
REM Optional args:
REM   skip        -> skip kafka entirely
REM   docker      -> force docker compose path (if available)
REM -------------------------------------------------------------
setlocal enabledelayedexpansion
set KAFKA_STATUS=unknown
if /I "%~1"=="skip" ( goto :skip )

if not defined KAFKA_PORT set KAFKA_PORT=9092

REM Detect python quickly (only for topic ensure)
where python >nul 2>&1
if errorlevel 1 (
  echo [Kafka] Python not found (topic ensure disabled)
  set HAVE_PY=0
) else (
  python -c "import kafka" >nul 2>&1
  if errorlevel 1 ( set HAVE_PY=0 ) else ( set HAVE_PY=1 )
)

REM Force docker if requested
if /I "%~1"=="docker" goto :docker_path

REM Native detection
if not defined KAFKA_HOME if exist "C:\dev\kafka\bin\windows\kafka-server-start.bat" set "KAFKA_HOME=C:\dev\kafka"
if defined KAFKA_HOME goto :native

REM Fallback to docker if compose file present
if exist kafka\docker-compose.yml goto :docker_path

echo [Kafka] No native or docker compose; spooling fallback.
set ENABLE_EVENT_STREAMING=false
set KAFKA_STATUS=spooling
goto :done

:native
echo [Kafka] Native install at %KAFKA_HOME%
powershell -Command "if ((Test-NetConnection -ComputerName localhost -Port %KAFKA_PORT% -WarningAction SilentlyContinue).TcpTestSucceeded){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [Kafka] Starting Zookeeper + Broker...
  if not exist "%KAFKA_HOME%\bin\windows\zookeeper-server-start.bat" (
    echo [Kafka] ERROR missing zookeeper-server-start.bat
    set KAFKA_STATUS=error
    set ENABLE_EVENT_STREAMING=false
    goto :done
  )
  start "Zookeeper" cmd /k call "%KAFKA_HOME%\bin\windows\zookeeper-server-start.bat" "%KAFKA_HOME%\config\zookeeper.properties"
  ping -n 5 127.0.0.1 >nul
  if not exist "%KAFKA_HOME%\bin\windows\kafka-server-start.bat" (
    echo [Kafka] ERROR missing kafka-server-start.bat
    set KAFKA_STATUS=error
    set ENABLE_EVENT_STREAMING=false
    goto :done
  )
  start "KafkaBroker" cmd /k call "%KAFKA_HOME%\bin\windows\kafka-server-start.bat" "%KAFKA_HOME%\config\server.properties"
  echo [Kafka] Waiting for port %KAFKA_PORT% ...
  powershell -Command "$d=0;while($d -lt 25){if((Test-NetConnection -ComputerName localhost -Port %KAFKA_PORT% -WarningAction SilentlyContinue).TcpTestSucceeded){exit 0}; Start-Sleep -Seconds 2;$d++}; exit 1" >nul 2>&1
  if errorlevel 1 (
    echo [Kafka] WARNING port %KAFKA_PORT% not reachable; spooling fallback.
    set KAFKA_STATUS=spooling
    set ENABLE_EVENT_STREAMING=false
      rem Attempt to detect ZooKeeper stale ephemeral broker registration (NodeExistsException)
      if exist "%KAFKA_HOME%\logs\server.log" (
        findstr /C:"NodeExistsException" "%KAFKA_HOME%\logs\server.log" >nul 2>&1
        if not errorlevel 1 (
          echo [Kafka] DETECTED NodeExistsException in server.log (likely stale ZooKeeper /brokers/ids znode)
          echo [Kafka] HINT: Run cleanup-kafka-dev.bat to remove stale ZK/Kafka state, then re-run this script.
        )
      )
    goto :done
  ) else (
    set KAFKA_STATUS=started
  )
) else (
  echo [Kafka] Broker already running on %KAFKA_PORT%
  set KAFKA_STATUS=running
)
set ENABLE_EVENT_STREAMING=true
goto :topics

:docker_path
echo [Kafka] Using docker compose stack...
where docker >nul 2>&1 || ( echo [Kafka] Docker not on PATH -> spooling; set KAFKA_STATUS=spooling & set ENABLE_EVENT_STREAMING=false & goto :done )
pushd kafka >nul 2>&1
docker compose up -d >nul 2>&1 || docker-compose up -d >nul 2>&1
echo [Kafka] Waiting for port 9092 (docker)...
powershell -Command "$d=0;while($d -lt 25){if((Test-NetConnection -ComputerName localhost -Port 9092 -WarningAction SilentlyContinue).TcpTestSucceeded){exit 0}; Start-Sleep -Seconds 2;$d++}; exit 1" >nul 2>&1
if errorlevel 1 (
  echo [Kafka] WARNING docker broker not reachable; spooling fallback.
  set ENABLE_EVENT_STREAMING=false
  set KAFKA_STATUS=spooling
  popd >nul & goto :done
)
set ENABLE_EVENT_STREAMING=true
set KAFKA_PORT=9092
if "%KAFKA_STATUS%"=="unknown" set KAFKA_STATUS=started
popd >nul

:topics
if NOT "%ENABLE_EVENT_STREAMING%"=="true" goto :done
if NOT "%HAVE_PY%"=="1" goto :done
python -m kafka_scripts.create_topics >nul 2>&1
if errorlevel 1 (
  echo [Kafka] WARNING topic creation issues (continuing)
) else (
  echo [Kafka] Topics ensured.
)

:done
endlocal & set KAFKA_STATUS=%KAFKA_STATUS%& set ENABLE_EVENT_STREAMING=%ENABLE_EVENT_STREAMING%& set KAFKA_PORT=%KAFKA_PORT%
exit /b 0

:skip
echo [Kafka] Skipped by request (spooling)
set ENABLE_EVENT_STREAMING=false
set KAFKA_STATUS=skipped
endlocal & set KAFKA_STATUS=%KAFKA_STATUS%& set ENABLE_EVENT_STREAMING=%ENABLE_EVENT_STREAMING%
exit /b 0
