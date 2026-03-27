@echo off
REM Clears Zookeeper and Kafka log dirs to recover from stale state
set ZK_DIR=C:\tmp\zookeeper
set KLOG_DIR=C:\tmp\kafka-logs
if exist %ZK_DIR% (
  echo [reset] Removing %ZK_DIR%
  rmdir /s /q %ZK_DIR%
)
if exist %KLOG_DIR% (
  echo [reset] Removing %KLOG_DIR%
  rmdir /s /q %KLOG_DIR%
)
echo [reset] Done.
