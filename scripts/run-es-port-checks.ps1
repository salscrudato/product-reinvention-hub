
# Refactored: Each check writes to a temp file, then concatenate all into the final report
$report = Join-Path $PSScriptRoot 'es-port-checks-report.txt'
$tmpDir = Join-Path $PSScriptRoot 'es-port-checks-tmp'
if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }
Remove-Item "$tmpDir\*" -ErrorAction SilentlyContinue
"ES port checks report - $(Get-Date -Format o)" | Out-File -FilePath $report -Encoding utf8

# 1) Listeners on 9200 and 9300
$f1 = Join-Path $tmpDir 'listeners.txt'
"--- Listeners (9200,9300) ---`n" | Out-File $f1 -Encoding utf8
try {
    Get-NetTCPConnection -LocalPort 9200,9300 -State Listen -ErrorAction SilentlyContinue |
        Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize | Out-String -Width 4096 | Out-File $f1 -Append -Encoding utf8
} catch { ("Error: {0}" -f $_) | Out-File $f1 -Append -Encoding utf8 }

# 2) Owning processes
$f2 = Join-Path $tmpDir 'procs.txt'
"--- Owning Processes (if any) ---`n" | Out-File $f2 -Encoding utf8
try {
    $pids = Get-NetTCPConnection -LocalPort 9200,9300 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($pids) {
        Get-Process -Id $pids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path | Format-Table -AutoSize | Out-String -Width 4096 | Out-File $f2 -Append -Encoding utf8
    } else {
        'No listener PIDs found on 9200/9300' | Out-File $f2 -Append -Encoding utf8
    }
} catch { ("Error: {0}" -f $_) | Out-File $f2 -Append -Encoding utf8 }

# 3) Extract publish/bound lines from ES log
$f3 = Join-Path $tmpDir 'publish.txt'
"--- Publish/Bound lines (last 40 matches) ---`n" | Out-File $f3 -Encoding utf8
$esLog = 'C:\dev\elasticsearch-9.1.4\logs\elasticsearch.log'
try {
    if (Test-Path $esLog) {
        Select-String -Path $esLog -Pattern 'publish_address|bound_addresses' -SimpleMatch | Select-Object -Last 40 | Out-String -Width 4096 | Out-File $f3 -Append -Encoding utf8
    } else {
        "ES log not found at $esLog" | Out-File $f3 -Append -Encoding utf8
    }
} catch { ("Error: {0}" -f $_) | Out-File $f3 -Append -Encoding utf8 }

# 4) Test HTTP connectivity to publish IP (try to parse from log)
$f4 = Join-Path $tmpDir 'httpcheck.txt'
"--- HTTP connectivity to publish IP (parsed from log) ---`n" | Out-File $f4 -Encoding utf8
try {
    if (-not (Test-Path $esLog)) { "ES log not found at $esLog" | Out-File $f4 -Append -Encoding utf8 }
    else {
        $pub = Select-String -Path $esLog -Pattern 'publish_address' -SimpleMatch | Select-Object -Last 1
        if ($pub) {
            $m = [regex]::Match($pub.Line, 'publish_address \{([^:}]+):(?<port>\d+)\}')
            if ($m.Success) {
                $ip = $m.Groups[1].Value
                $port = $m.Groups['port'].Value
                ("Found publish IP: {0}:{1}" -f $ip, $port) | Out-File $f4 -Append -Encoding utf8
                "Test-NetConnection:" | Out-File $f4 -Append -Encoding utf8
                Test-NetConnection -ComputerName $ip -Port $port | Format-List | Out-String -Width 4096 | Out-File $f4 -Append -Encoding utf8
                "curl response (insecure):" | Out-File $f4 -Append -Encoding utf8
                try {
                    $url = "https://$($ip):$port/"
                    curl -k $url -UseBasicParsing -TimeoutSec 10 | Out-String -Width 4096 | Out-File $f4 -Append -Encoding utf8
                } catch {
                    ("curl error: {0}" -f $_.Exception.Message) | Out-File $f4 -Append -Encoding utf8
                }
            } else { ("No publish IP:port parse from line: {0}" -f $pub.Line) | Out-File $f4 -Append -Encoding utf8 }
        } else { "No publish_address line found in ES log" | Out-File $f4 -Append -Encoding utf8 }
    }
} catch { ("Error: {0}" -f $_) | Out-File $f4 -Append -Encoding utf8 }

# 5) Test transport TCP on 9300 (127.0.0.1)
$f5 = Join-Path $tmpDir 'transport.txt'
"--- Transport TCP check (127.0.0.1:9300) ---`n" | Out-File $f5 -Encoding utf8
try {
    Test-NetConnection -ComputerName 127.0.0.1 -Port 9300 | Format-List | Out-String -Width 4096 | Out-File $f5 -Append -Encoding utf8
} catch { ("Error: {0}" -f $_) | Out-File $f5 -Append -Encoding utf8 }

# Concatenate all temp files into the final report
Get-Content $f1,$f2,$f3,$f4,$f5 | Out-File -FilePath $report -Append -Encoding utf8
Write-Host "Report written to $report"
"Report written to: $report" | Out-File -FilePath $report -Append -Encoding utf8
