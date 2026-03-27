# Diagnostic script: collects Elasticsearch process, ports, config and recent logs
param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$OutFile = 'C:\dev\snowchat\scripts\diag-es-output.txt'
)

function SafeWrite([string]$s) { "$(([datetime]::UtcNow).ToString('o')) - $s" }

# Ensure output directory exists and clear previous output
if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

Add-Content -Path $OutFile -Value (SafeWrite 'Starting Elasticsearch diagnostics')

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '1) Processes named elasticsearch')
try {
    $procs = Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU
    if ($procs) { $procs | Format-Table | Out-String | Add-Content -Path $OutFile } else { Add-Content -Path $OutFile -Value 'No process named "elasticsearch" found.' }
} catch { Add-Content -Path $OutFile -Value ("Error listing processes: $_") }

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '2) Java processes with elasticsearch in command line (Win32_Process)')
try {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'elasticsearch' -or $_.CommandLine -match 'org.elasticsearch') } | Select-Object ProcessId,Name,@{Name='CommandLine';Expression={$_.CommandLine}} | Format-List | Out-String | Add-Content -Path $OutFile
} catch { Add-Content -Path $OutFile -Value ("Error querying Win32_Process: $_") }

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '3) Listening TCP ports for 9200')
try {
    $tcp = Get-NetTCPConnection -LocalPort 9200 -ErrorAction SilentlyContinue
    if ($tcp) { $tcp | Format-Table -AutoSize | Out-String | Add-Content -Path $OutFile } else { Add-Content -Path $OutFile -Value 'No TCP listener on port 9200.' }
} catch { Add-Content -Path $OutFile -Value ("Error checking TCP port: $_") }

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '4) Check connectivity to localhost:9200')
try {
    $test = Test-NetConnection -ComputerName localhost -Port 9200 -WarningAction SilentlyContinue
    $test | Format-List | Out-String | Add-Content -Path $OutFile
} catch { Add-Content -Path $OutFile -Value ("Error testing connection: $_") }

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '5) Verify PEM files exist')
$certPath = Join-Path $EsHome 'config\certs\local-es.pem'
$keyPath = Join-Path $EsHome 'config\certs\local-es-key.pem'
Add-Content -Path $OutFile -Value ("local-es.pem exists: " + (Test-Path $certPath))
Add-Content -Path $OutFile -Value ("local-es-key.pem exists: " + (Test-Path $keyPath))

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '6) Tail of elasticsearch.yml (last 120 lines)')
try {
    Get-Content -Path (Join-Path $EsHome 'config\elasticsearch.yml') -Tail 120 | Out-String | Add-Content -Path $OutFile
} catch { Add-Content -Path $OutFile -Value ("Error reading elasticsearch.yml: $_") }

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite '7) Tail of elasticsearch.log (last 200 lines)')
try {
    Get-Content -Path (Join-Path $EsHome 'logs\elasticsearch.log') -Tail 200 | Out-String | Add-Content -Path $OutFile
} catch { Add-Content -Path $OutFile -Value ("Error reading elasticsearch.log: $_") }

Add-Content -Path $OutFile -Value ''
Add-Content -Path $OutFile -Value (SafeWrite 'Diagnostics complete')

Write-Host "Diagnostics written to $OutFile"
