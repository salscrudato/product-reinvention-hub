<# Restarts apm-server.exe: stops any running process with 'apm-server' in its commandline and starts a fresh one. #>
param(
    [string]$ApmExe = 'C:\dev\apm-server-9.1.4-windows-x86_64\apm-server-9.1.4-windows-x86_64\apm-server.exe',
    [string]$Args = '-E apm-server.rum.enabled=true'
)

Write-Host "Restarting APM Server using: $ApmExe $Args" -ForegroundColor Cyan
try {
    $procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'apm-server') }
    if ($procs) {
        foreach ($p in $procs) {
            Write-Host "Stopping pid $($p.ProcessId) - $($p.CommandLine)" -ForegroundColor Yellow
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    } else { Write-Host 'No running apm-server processes found.' -ForegroundColor DarkYellow }

    if (Test-Path $ApmExe) {
        Write-Host "Starting: $ApmExe $Args" -ForegroundColor Green
        Start-Process -FilePath $ApmExe -ArgumentList $Args -WindowStyle Hidden
        Start-Sleep -Seconds 6
        Write-Host 'APM start requested.' -ForegroundColor Cyan
        exit 0
    } else {
        Write-Host "APM executable not found: $ApmExe" -ForegroundColor Red
        exit 2
    }
} catch {
    Write-Host "Error restarting APM: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
