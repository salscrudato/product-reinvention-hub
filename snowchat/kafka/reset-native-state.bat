@echo off
REM Resets local single-node Kafka/ZooKeeper state to fix stale broker id / NodeExists errors.
REM USE WITH CAUTION: This deletes local log/state directories (NO production use).

set ZK_DIR=C:\tmp\zookeeper
set KAFKA_LOG_DIR=C:\tmp\kafka-logs

echo This will DELETE:
echo   %ZK_DIR%
echo   %KAFKA_LOG_DIR%
set /p CONFIRM=Type YES to continue: 
if /I not "%CONFIRM%"=="YES" (
  echo Aborted.
  exit /b 1
)

for %%D in ("%ZK_DIR%" "%KAFKA_LOG_DIR%") do (
  if exist %%D (
    echo Deleting %%D ...
    rmdir /s /q %%D
  ) else (
    echo Skipping (not found): %%D
  )
)

echo Done. Re-run start-all.bat to recreate state.
exit /b 0
