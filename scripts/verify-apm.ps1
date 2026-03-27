param(
    [string]$ApmUrl = 'http://localhost:8200'
)

Write-Host "=== APM Server Check: $ApmUrl ===" -ForegroundColor Cyan

try {
    $r = Invoke-WebRequest -Uri $ApmUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host "$ApmUrl -> HTTP $($r.StatusCode)" -ForegroundColor Green
    if ($r.Content) { Write-Host "APM response length: $($r.Content.Length)" -ForegroundColor DarkCyan }
} catch {
    Write-Host "APM Server error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "=== APM Check Complete ===`n" -ForegroundColor Cyan
