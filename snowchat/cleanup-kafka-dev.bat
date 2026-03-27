@echo off
REM -------------------------------------------------------------
REM cleanup-kafka-dev.bat : Safely reset local Kafka/ZooKeeper dev state.
REM USE ONLY FOR LOCAL DEV. This will:
REM   1. Stop running java Kafka / ZooKeeper processes (prompt)
REM   2. Optionally stop docker compose stack (if running and chosen)
REM   3. Delete Kafka log directories (data logs) but keep config files
REM   4. Attempt to remove stale ZooKeeper data dirs (zookeeper, kafka) under common paths
REM   5. Provide manual instructions if embedded ZooKeeper snapshot dir not found.
REM -------------------------------------------------------------
setlocal enabledelayedexpansion

set KAFKA_HOME_DEFAULT=C:\dev\kafka
if not defined KAFKA_HOME if exist "%KAFKA_HOME_DEFAULT%\config\server.properties" set KAFKA_HOME=%KAFKA_HOME_DEFAULT%

echo [Cleanup] This will RESET local Kafka dev state. Proceed? (Y/N):
set /p CONFIRM=>
if /I not "%CONFIRM%"=="Y" (
  echo [Cleanup] Aborted.
  goto :end
)

REM Detect java processes referencing kafka or zookeeper
for /f "tokens=1,2 delims= " %%A in ('tasklist /v /fi "IMAGENAME eq java.exe" ^| find /I "kafka"') do (
  set FOUND_JAVA=1
)
for /f "tokens=1,2 delims= " %%A in ('tasklist /v /fi "IMAGENAME eq java.exe" ^| find /I "zookeeper"') do (
  set FOUND_JAVA=1
)
if defined FOUND_JAVA (
  echo [Cleanup] Java Kafka/ZooKeeper processes detected.
  echo [Cleanup] Attempting graceful termination...
  tasklist /v /fi "IMAGENAME eq java.exe" | find /I "kafka" >nul && taskkill /f /im java.exe >nul 2>&1
)

REM Offer docker compose stop if stack present
if exist kafka\docker-compose.yml (
  echo [Cleanup] Stop docker compose Kafka stack? (Y/N):
  set /p STOPDK=>
  if /I "%STOPDK%"=="Y" (
    pushd kafka >nul 2>&1
    docker compose down >nul 2>&1 || docker-compose down >nul 2>&1
    popd >nul
  )
)

if defined KAFKA_HOME (
  echo [Cleanup] Kafka home: %KAFKA_HOME%
  if exist "%KAFKA_HOME%\logs" (
    echo [Cleanup] Deleting broker runtime logs in %KAFKA_HOME%\logs ...
    rmdir /s /q "%KAFKA_HOME%\logs" 2>nul
    mkdir "%KAFKA_HOME%\logs" >nul 2>&1
  )
  for /f "tokens=1 delims==" %%L in ('findstr /R /C:"^log.dirs=" "%KAFKA_HOME%\config\server.properties"') do set LOGDIRS=%%L
)

REM Common local data directories to purge (adjust if needed)
set CANDIDATES=%KAFKA_HOME%\data C:\tmp\kafka-logs C:\kafka-logs C:\dev\kafka-logs
for %%D in (%CANDIDATES%) do (
  if exist "%%D" (
    echo [Cleanup] Removing data dir %%D
    rmdir /s /q "%%D" 2>nul
  )
)

REM ZooKeeper data cleanup (embedded ZK default)
set ZKDIRS=%KAFKA_HOME%\data\zookeeper C:\tmp\zookeeper C:\zookeeper-data C:\dev\zookeeper-data
for %%Z in (%ZKDIRS%) do (
  if exist "%%Z" (
    echo [Cleanup] Removing ZooKeeper dir %%Z
    rmdir /s /q "%%Z" 2>nul
  )
)

echo [Cleanup] Done. You can now restart using kafka-start.bat.
echo [Cleanup] If NodeExistsException persists, ensure no external ZooKeeper ensemble holds stale /brokers/ids nodes.

:end
endlocal
exit /b 0
