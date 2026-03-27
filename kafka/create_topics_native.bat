@echo off
REM Create/ensure topics using native kafka-topics script
if not defined KAFKA_HOME (
  echo [create-topics-native] KAFKA_HOME not defined.
  exit /b 1
)
set RAW=%KAFKA_RAW_TOPIC%
if "%RAW%"=="" set RAW=crew-raw-events
set ENR=%KAFKA_ENRICHED_TOPIC%
if "%ENR%"=="" set ENR=crew-enriched-events
set MET=%KAFKA_METRICS_TOPIC%
if "%MET%"=="" set MET=crew-metrics-events

for %%T in (%RAW% %ENR% %MET%) do (
  "%KAFKA_HOME%\bin\windows\kafka-topics.bat" --create --if-not-exists --topic %%T --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1 >nul 2>nul
  if errorlevel 1 (
    echo [create-topics-native] Issue ensuring topic %%T (may already exist).
  ) else (
    echo [create-topics-native] Ensured topic %%T
  )
)
exit /b 0
