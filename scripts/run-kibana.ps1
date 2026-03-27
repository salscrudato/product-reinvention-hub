# Run Kibana in a separate PowerShell window for repeated testing
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-kibana.ps1

$kibanaHome = 'C:\dev\kibana-9.1.4-windows-x86_64\kibana-9.1.4'

if (-not (Test-Path "$kibanaHome\bin\kibana.bat")) {
    Write-Host "Kibana executable not found at $kibanaHome\bin\kibana.bat" -ForegroundColor Red
    exit 1
}

Write-Host "Starting Kibana..." -ForegroundColor Cyan
$process = Start-Process -FilePath "$kibanaHome\bin\kibana.bat" -WindowStyle Normal -PassThru
Start-Sleep -Seconds 5
if ($process.HasExited) {
    Write-Host "Kibana process exited immediately with code $($process.ExitCode)." -ForegroundColor Red
    Write-Host "Check kibana.log or run kibana.bat manually in a terminal for error details." -ForegroundColor Yellow
} else {
    Write-Host "Kibana started in a new window. Check for errors in the new window or in kibana.log."
}
