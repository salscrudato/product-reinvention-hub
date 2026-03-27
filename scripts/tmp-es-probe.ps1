# Temporary ES probe script - collects process, netstat, and logs
$Out = 'C:\dev\snowchat\scripts\tmp-es-probe-output.txt'
"Probe run at: $(Get-Date -Format o)" | Out-File $Out -Encoding utf8
"\n1) Java processes with elasticsearch in command line:" | Out-File $Out -Append
Get-WmiObject Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'elasticsearch') } | Select-Object ProcessId,CommandLine | Format-List | Out-File $Out -Append

"\n--- netstat for :9200 ---" | Out-File $Out -Append
netstat -ano | Select-String ':9200' | Out-File $Out -Append

"\n--- Listening TCP ports (TCP) ---" | Out-File $Out -Append
Get-NetTCPConnection -LocalPort 9200 -ErrorAction SilentlyContinue | Out-File $Out -Append

"\n--- Test-NetConnection localhost:9200 ---" | Out-File $Out -Append
Test-NetConnection -ComputerName localhost -Port 9200 | Out-File $Out -Append

$logPath = 'C:\dev\elasticsearch-9.1.4\logs\elasticsearch.log'
"\n--- Tail elasticsearch.log (last 400 lines) ---" | Out-File $Out -Append
if (Test-Path $logPath) { Get-Content $logPath -Tail 400 | Out-File $Out -Append } else { "Log file not found: $logPath" | Out-File $Out -Append }

"\n--- End of probe ---" | Out-File $Out -Append
Write-Host "Probe written to $Out"