@echo off
cd /d C:\Users\salvatore.scrudato\Desktop\314358_InsurancePlatformsAI
set IMPORT_EVAL_ONLY=GL
set IMPORT_TENANT=accenture-test
set BASE_URL=https://app-prodhub-dev.azurewebsites.net
rem F23 armed: run id minted by the eval script; default 150-min timeout; attempts=1
npx tsx scripts/import-eval.mts --live > docs\import-hardening\RESULTS\wave3-gl-live.log 2>&1
