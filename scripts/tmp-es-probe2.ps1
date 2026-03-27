# Enhanced probe: lists log files, shows newest log tail, checks processes and listeners
$Out = 'C:\dev\snowchat\scripts\tmp-es-probe2-output.txt'
"Probe2 run at: $(Get-Date -Format o)" | Out-File $Out -Encoding utf8

"1) Java processes with elasticsearch in command line:" | Out-File $Out -Append
Get-WmiObject Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'elasticsearch') } | Select-Object ProcessId,CommandLine | Format-List | Out-File $Out -Append

"\n2) netstat entries for :9200:" | Out-File $Out -Append
netstat -ano | Select-String ':9200' | Out-File $Out -Append

"\n3) Listening TCP ports for 9200 (Get-NetTCPConnection):" | Out-File $Out -Append
Get-NetTCPConnection -LocalPort 9200 -ErrorAction SilentlyContinue | Out-File $Out -Append

$logs = Get-ChildItem -Path 'C:\dev\elasticsearch-9.1.4\logs' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
"\n4) Elasticsearch logs listing (most recent first):" | Out-File $Out -Append
if ($logs) { $logs | Select-Object Name,LastWriteTime,Length | Out-File $Out -Append } else { "No log files found" | Out-File $Out -Append }

if ($logs -and $logs[0]) {
    $latest = $logs[0].FullName
    "\n5) Tail of most recent log ($latest) - last 300 lines:" | Out-File $Out -Append
    Get-Content -Path $latest -Tail 300 | Out-File $Out -Append
} else {
    "\nNo logs to tail." | Out-File $Out -Append
}

"\n6) elasticsearch.yml last 120 lines:" | Out-File $Out -Append
if (Test-Path 'C:\dev\elasticsearch-9.1.4\config\elasticsearch.yml') { Get-Content 'C:\dev\elasticsearch-9.1.4\config\elasticsearch.yml' -Tail 120 | Out-File $Out -Append } else { "elasticsearch.yml not found" | Out-File $Out -Append }

"\nEnd of probe2" | Out-File $Out -Append
Write-Host "Probe2 written to $Out"