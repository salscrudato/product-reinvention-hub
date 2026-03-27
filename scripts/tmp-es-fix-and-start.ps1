# Temporary script: if no ES java process, remove stale node.lock and start ES
$EsHome = 'C:\dev\elasticsearch-9.1.4'
$Lock = Join-Path $EsHome 'data\node.lock'
$javaProcs = Get-WmiObject Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'elasticsearch') }
if ($javaProcs) {
    Write-Host "Elasticsearch java process running (pid: $($javaProcs.ProcessId)). Not removing lock or starting."
    exit 0
}

if (Test-Path $Lock) {
    Write-Host "Found node.lock at $Lock. Attempting to remove it (will create backup)."
    $bak = "$Lock.bak.$((Get-Date).ToString('yyyyMMddHHmmss'))"
    try {
        Copy-Item -Path $Lock -Destination $bak -Force
        Remove-Item -Path $Lock -Force
        Write-Host "Removed node.lock (backup saved to $bak)"
    } catch {
        Write-Error "Failed to remove node.lock: $_"
        exit 2
    }
} else {
    Write-Host "No node.lock found."
}

# Start ES
$startBat = Join-Path $EsHome 'bin\elasticsearch.bat'
if (-not (Test-Path $startBat)) { Write-Error "Start script missing: $startBat"; exit 3 }
Write-Host "Starting Elasticsearch: $startBat"
Start-Process -FilePath $startBat -WorkingDirectory $EsHome -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 6
Write-Host "Start requested. Run diagnostic probe after a few seconds to confirm."