# Start Elasticsearch, Kibana, and APM Server (optional) in sequence
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-elastic-stack.ps1

$esHome = 'C:\dev\elk\elasticsearch-9.2.3'
$kibanaHome = 'C:\dev\elk\kibana-9.2.3'
$apmHome = 'C:\dev\elk\apm-server-7.17.29-windows-x86_64'

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


Write-Host "[1/4] Starting Elasticsearch..."
Start-Process -FilePath "$esHome\bin\elasticsearch.bat" -WindowStyle Minimized
Write-Host "Waiting 30 seconds for Elasticsearch to initialize..."
Start-Sleep -Seconds 30
Write-Host "Waiting for Elasticsearch HTTP (9200) to be ready..."
if (Wait-ForPort 'localhost' 9200 180) {
    Write-Host "Elasticsearch is up on 9200."
} else {
    Write-Host "ERROR: Elasticsearch did not start on 9200 in time."; exit 1
}

# Uncomment to run password setup (only once, not on every start)
# Write-Host "Running elasticsearch-setup-passwords auto..."
# Start-Process -FilePath "$esHome\bin\elasticsearch-setup-passwords.bat" -ArgumentList 'auto' -Wait -NoNewWindow

Write-Host "[2/4] Starting Kibana..."
if (Test-Path $kibanaHome) {
    Start-Process -FilePath "$kibanaHome\bin\kibana.bat" -WindowStyle Minimized
    Write-Host "Waiting 30 seconds for Kibana to initialize..."
    Start-Sleep -Seconds 30
    Write-Host "Waiting for Kibana (5601) to be ready..."
    if (Wait-ForPort 'localhost' 5601 120) {
        Write-Host "Kibana is up on 5601."
    } else {
        Write-Host "ERROR: Kibana did not start on 5601 in time."; exit 1
    }
} else {
    Write-Host "Kibana not found at $kibanaHome. Skipping."
}

Write-Host "[3/4] Starting APM Server (optional)..."
if (Test-Path $apmHome) {
    $apmBat = Join-Path $apmHome 'apm-server.bat'
    if (Test-Path $apmBat) {
        Start-Process -FilePath $apmBat -WindowStyle Minimized
    } else {
        Write-Host "APM Server .bat not found at $apmBat. Trying .exe..."
        $apmExe = Join-Path $apmHome 'apm-server.exe'
        if (Test-Path $apmExe) {
            Start-Process -FilePath $apmExe -WindowStyle Minimized
        } else {
            Write-Host "APM Server executable not found at $apmExe. Skipping."
            return
        }
    }
    Write-Host "Waiting 15 seconds for APM Server to initialize..."
    Start-Sleep -Seconds 15
    Write-Host "Waiting for APM Server (8200) to be ready..."
    if (Wait-ForPort 'localhost' 8200 60) {
        Write-Host "APM Server is up on 8200."
    } else {
        Write-Host "APM Server did not start on 8200 in time (continuing)."
    }
} else {
    Write-Host "APM Server not found at $apmHome. Skipping."
}

Write-Host "[4/4] All services started (where available)."
Write-Host "You can now access:"
Write-Host "  Elasticsearch: http://localhost:9200"
Write-Host "  Kibana:        http://localhost:5601"
Write-Host "  APM Server:    http://localhost:8200 (if installed)"
