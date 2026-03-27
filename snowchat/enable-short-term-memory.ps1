# Short-Term Memory Enable Script
# Run this to re-enable short-term memory feature

Write-Host "=== Enable Short-Term Memory Feature ===" -ForegroundColor Cyan
Write-Host ""

$envFile = "backend\.env"
if (-not (Test-Path $envFile)) {
    Write-Host ".env file not found at: $envFile" -ForegroundColor Yellow
    Write-Host "Creating new .env file..." -ForegroundColor Yellow
    New-Item -Path $envFile -ItemType File -Force | Out-Null
}

$envContent = Get-Content $envFile -Raw

if ($envContent -match "ENABLE_SHORT_TERM_MEMORY\s*=\s*1") {
    Write-Host "Short-term memory is already ENABLED" -ForegroundColor Green
    exit 0
}

if ($envContent -match "ENABLE_SHORT_TERM_MEMORY") {
    $envContent = $envContent -replace "ENABLE_SHORT_TERM_MEMORY\s*=\s*\d+", "ENABLE_SHORT_TERM_MEMORY=1"
    Write-Host "Updated ENABLE_SHORT_TERM_MEMORY flag to 1" -ForegroundColor Yellow
} else {
    $envContent += "`nENABLE_SHORT_TERM_MEMORY=1`n"
    Write-Host "Added ENABLE_SHORT_TERM_MEMORY=1 to .env" -ForegroundColor Yellow
}

Set-Content -Path $envFile -Value $envContent

Write-Host ""
Write-Host "✓ Short-term memory feature ENABLED" -ForegroundColor Green
Write-Host ""
Write-Host "Restart backend to apply: python backend/app.py" -ForegroundColor Cyan
