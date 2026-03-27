@echo off
REM Starts native Apache Kafka (requires KAFKA_HOME env var)
if not defined KAFKA_HOME (
  echo [start-native] KAFKA_HOME not defined.
  exit /b 1
)
if not exist "%KAFKA_HOME%\bin\windows\zookeeper-server-start.bat" (
  echo [start-native] Cannot find Zookeeper script in %KAFKA_HOME%\bin\windows
  exit /b 1
)
start "Zookeeper" cmd /k call "%KAFKA_HOME%\bin\windows\zookeeper-server-start.bat" "%KAFKA_HOME%\config\zookeeper.properties"
ping -n 5 127.0.0.1 >nul
start "KafkaBroker" cmd /k call "%KAFKA_HOME%\bin\windows\kafka-server-start.bat" "%KAFKA_HOME%\config\server.properties"
exit /b 0
