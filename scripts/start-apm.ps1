# Start APM Server and wait for it to be ready
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-apm.ps1

$apmHome = 'C:\dev\apm-server-9.1.4-windows-x86_64\apm-server-9.1.4-windows-x86_64'

function Wait-ForPort {
    param($TargetHost, $Port, $TimeoutSec = 60)
    $start = Get-Date
    while ((Get-Date) -lt $start.AddSeconds($TimeoutSec)) {
        $tcp = Test-NetConnection -ComputerName $TargetHost -Port $Port -WarningAction SilentlyContinue
        if ($tcp.TcpTestSucceeded) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

Write-Host "Starting APM Server..."
$apmBat = Join-Path $apmHome 'apm-server.bat'
if (Test-Path $apmBat) {
    Start-Process -FilePath $apmBat -WindowStyle Minimized
} else {
    Write-Host "APM Server .bat not found at $apmBat. Trying .exe..."
    $apmExe = Join-Path $apmHome 'apm-server.exe'
    if (Test-Path $apmExe) {
        Start-Process -FilePath $apmExe -WindowStyle Minimized
    } else {
        Write-Host "APM Server executable not found at $apmExe. Exiting."
        exit 1
    }
}
Write-Host "Waiting 15 seconds for APM Server to initialize..."
Start-Sleep -Seconds 15
Write-Host "Waiting for APM Server (8200) to be ready..."
if (Wait-ForPort 'localhost' 8200 60) {
    Write-Host "APM Server is up on 8200."
    Write-Host "Access APM Server at http://localhost:8200"
} else {
    Write-Host "ERROR: APM Server did not start on 8200 in time."
}