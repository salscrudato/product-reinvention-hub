Write-Host "Stopping Elasticsearch processes (if any)" -ForegroundColor Cyan
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Write-Host "Stopped PID $($_.Id)" -ForegroundColor Green } catch { Write-Host "Failed to stop PID $($_.Id): $($_.Exception.Message)" -ForegroundColor Yellow }
}
Write-Host "Done." -ForegroundColor Cyan
