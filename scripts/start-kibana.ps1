# Start Kibana and wait for it to be ready
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-kibana.ps1

$kibanaHome = 'C:\dev\kibana-9.1.4-windows-x86_64\kibana-9.1.4'

function Wait-ForPort {
    param($TargetHost, $Port, $TimeoutSec = 120)
    $start = Get-Date
    while ((Get-Date) -lt $start.AddSeconds($TimeoutSec)) {
        $tcp = Test-NetConnection -ComputerName $TargetHost -Port $Port -WarningAction SilentlyContinue
        if ($tcp.TcpTestSucceeded) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

Write-Host "Starting Kibana..."
Start-Process -FilePath "$kibanaHome\bin\kibana.bat" -WindowStyle Minimized
Write-Host "Waiting 30 seconds for Kibana to initialize..."
Start-Sleep -Seconds 30
Write-Host "Waiting for Kibana (5601) to be ready..."
if (Wait-ForPort 'localhost' 5601 120) {
    Write-Host "Kibana is up on 5601."
    Write-Host "Access Kibana at http://localhost:5601"
} else {
    Write-Host "ERROR: Kibana did not start on 5601 in time."
}