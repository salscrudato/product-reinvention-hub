@echo off
cd /d C:\Users\salvatore.scrudato\Desktop\314358_InsurancePlatformsAI
set IMPORT_EVAL_ONLY=GL
set IMPORT_TENANT=accenture-test
set BASE_URL=https://app-prodhub-dev.azurewebsites.net
rem post-push-2 re-smoke: F28 fold + G5 mapper live confirmation, scored on new-era goldens
npx tsx scripts/import-eval.mts --live > docs\import-hardening\RESULTS\wave3-gl-resmoke.log 2>&1
