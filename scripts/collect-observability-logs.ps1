# Collect observability service statuses and recent logs
Write-Host "Collecting observability processes and logs..." -ForegroundColor Cyan

function Tail-File([string]$path, [int]$lines=200) {
    if (Test-Path $path) {
        Write-Host "--- TAIL: $path (last $lines lines) ---" -ForegroundColor Yellow
        Get-Content -Path $path -Tail $lines -ErrorAction SilentlyContinue
    } else {
        Write-Host "File not found: $path" -ForegroundColor DarkYellow
    }
}

# Process search via Win32_Process to get CommandLine
Write-Host "Processes matching observability components:" -ForegroundColor Cyan
try {
    $procs = Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -and ($_.CommandLine -match 'elasticsearch' -or $_.CommandLine -match 'apm-server' -or $_.CommandLine -match 'kibana')) }
    if ($procs) {
        $procs | Select-Object ProcessId,Name,@{Name='CommandLine';Expression={$_.CommandLine}} | Format-List
    } else {
        Write-Host "No observable processes found by CommandLine match." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Failed to enumerate processes: $($_.Exception.Message)" -ForegroundColor Red
}

# Tail logs from known install locations
$esLogDir = 'C:\dev\elasticsearch-9.1.4\logs'
$apmLogDir = 'C:\dev\apm-server-9.1.4-windows-x86_64\apm-server-9.1.4-windows-x86_64\logs'
$kibLogDir = 'C:\dev\kibana-9.1.4-windows-x86_64\kibana-9.1.4\logs'

if (Test-Path $esLogDir) {
    $f = Get-ChildItem -Path $esLogDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { Tail-File $f.FullName 200 } else { Write-Host 'No ES log files found' -ForegroundColor Yellow }
} else { Write-Host "Elasticsearch logs dir not found: $esLogDir" -ForegroundColor Yellow }

if (Test-Path $apmLogDir) {
    $f = Get-ChildItem -Path $apmLogDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { Tail-File $f.FullName 200 } else { Write-Host 'No APM log files found' -ForegroundColor Yellow }
} else { Write-Host "APM logs dir not found: $apmLogDir" -ForegroundColor Yellow }

if (Test-Path $kibLogDir) {
    $f = Get-ChildItem -Path $kibLogDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { Tail-File $f.FullName 200 } else { Write-Host 'No Kibana log files found' -ForegroundColor Yellow }
} else { Write-Host "Kibana logs dir not found: $kibLogDir" -ForegroundColor Yellow }

Write-Host 'Collection complete.' -ForegroundColor Cyan
