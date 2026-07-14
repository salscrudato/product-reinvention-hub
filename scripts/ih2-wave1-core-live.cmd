@echo off
cd /d C:\Users\salvatore.scrudato\Desktop\314358_InsurancePlatformsAI
set IMPORT_EVAL_ONLY=CORE
set IMPORT_TENANT=accenture-test
set BASE_URL=https://app-prodhub-dev.azurewebsites.net
npx tsx scripts/import-eval.mts --live > docs\import-hardening\RESULTS\wave1-core-live.log 2>&1
