# Short-Term Memory Rollback Script
# Run this to disable short-term memory feature

Write-Host "=== Short-Term Memory Feature Rollback ===" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
$envFile = "backend\.env"
if (-not (Test-Path $envFile)) {
    Write-Host ".env file not found at: $envFile" -ForegroundColor Yellow
    Write-Host "Creating new .env file..." -ForegroundColor Yellow
    New-Item -Path $envFile -ItemType File -Force | Out-Null
}

# Read current .env
$envContent = Get-Content $envFile -Raw

# Check current state
if ($envContent -match "ENABLE_SHORT_TERM_MEMORY\s*=\s*0") {
    Write-Host "Short-term memory is already DISABLED" -ForegroundColor Green
    exit 0
}

# Add or update the flag
if ($envContent -match "ENABLE_SHORT_TERM_MEMORY") {
    $envContent = $envContent -replace "ENABLE_SHORT_TERM_MEMORY\s*=\s*\d+", "ENABLE_SHORT_TERM_MEMORY=0"
    Write-Host "Updated existing ENABLE_SHORT_TERM_MEMORY flag to 0" -ForegroundColor Yellow
} else {
    $envContent += "`nENABLE_SHORT_TERM_MEMORY=0`n"
    Write-Host "Added ENABLE_SHORT_TERM_MEMORY=0 to .env" -ForegroundColor Yellow
}

# Write back
Set-Content -Path $envFile -Value $envContent

Write-Host ""
Write-Host "✓ Short-term memory feature DISABLED" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart backend: python backend/app.py"
Write-Host "2. Verify in logs: Look for '[ShortTermMemory] Initialized (enabled=False)'"
Write-Host ""
Write-Host "To re-enable: Set ENABLE_SHORT_TERM_MEMORY=1 in .env" -ForegroundColor Gray
