@echo off
cd /d C:\Users\salvatore.scrudato\Desktop\314358_InsurancePlatformsAI
set IMPORT_TENANT=accenture-test
set BASE_URL=https://app-prodhub-dev.azurewebsites.net
set IMPORT_LIVE_ONLY=pdf
rem Phase P: real-PDF filing slice, then the two-manuals + anti-PH probes (serialized)
npx tsx scripts/import-live.mts > docs\import-hardening\RESULTS\phasep-pdf-live.log 2>&1
npx tsx scripts/phasep-probes.mts >> docs\import-hardening\RESULTS\phasep-pdf-live.log 2>&1
