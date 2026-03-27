@echo off
if not defined KAFKA_HOME (
  echo [topics-native] KAFKA_HOME not set.
  exit /b 1
)
set KTOOLS=%KAFKA_HOME%\bin\windows
set RAW=%KAFKA_RAW_TOPIC%
if "%RAW%"=="" set RAW=crew-raw-events
set ENR=%KAFKA_ENRICHED_TOPIC%
if "%ENR%"=="" set ENR=crew-enriched-events
set MET=%KAFKA_METRICS_TOPIC%
if "%MET%"=="" set MET=crew-metrics-events

for %%T in (%RAW% %ENR% %MET%) do (
  call %KTOOLS%\kafka-topics.bat --bootstrap-server localhost:%KAFKA_PORT% --list | findstr /i "^%%T$" >nul
  if errorlevel 1 (
    echo [topics-native] Creating topic %%T
    call %KTOOLS%\kafka-topics.bat --bootstrap-server localhost:%KAFKA_PORT% --create --topic %%T --partitions 1 --replication-factor 1 >nul 2>&1
  ) else (
    echo [topics-native] Topic %%T exists
  )
)
exit /b 0
