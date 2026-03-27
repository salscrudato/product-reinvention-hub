param(
    [string]$KibanaUrl = 'http://localhost:5601'
)

Write-Host "=== Kibana Check: $KibanaUrl ===" -ForegroundColor Cyan

try {
    $status = Invoke-RestMethod -Uri ($KibanaUrl.TrimEnd('/') + '/api/status') -UseBasicParsing -ErrorAction Stop
    Write-Host "Kibana status: $($status.status.overall.state)" -ForegroundColor Green
} catch {
    Write-Host "Kibana error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "=== Kibana Check Complete ===`n" -ForegroundColor Cyan
