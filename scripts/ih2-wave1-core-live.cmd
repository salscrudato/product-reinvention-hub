@echo off
cd /d C:\Users\salvatore.scrudato\Desktop\314358_InsurancePlatformsAI
set IMPORT_EVAL_ONLY=CORE
set IMPORT_TENANT=accenture-test
rem F23: timeout must exceed observed CORE runtime (~113 min); retries restart a ~$70 run
set IMPORT_EVAL_TIMEOUT_MS=9000000
set BASE_URL=https://app-prodhub-dev.azurewebsites.net
npx tsx scripts/import-eval.mts --live > docs\import-hardening\RESULTS\wave2-core-live.log 2>&1
