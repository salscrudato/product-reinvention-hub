$outDir = Join-Path $PSScriptRoot 'es-checks'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$report = Join-Path $outDir 'report.txt'
"Report generated at: $(Get-Date)" | Out-File -FilePath $report -Encoding utf8
"---LISTENERS (9200,9300)---" | Out-File -FilePath $report -Append -Encoding utf8
try {
    Get-NetTCPConnection -LocalPort 9200,9300 -State Listen -ErrorAction SilentlyContinue |
      Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize | Out-String -Width 4096 | Out-File -FilePath $report -Append -Encoding utf8
} catch {
    "Get-NetTCPConnection error: $_" | Out-File -FilePath $report -Append -Encoding utf8
}

"`n---OWNING PROCESSES---" | Out-File -FilePath $report -Append -Encoding utf8
try {
    $pids = Get-NetTCPConnection -LocalPort 9200,9300 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($pids) { Get-Process -Id $pids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path | Format-Table -AutoSize | Out-String -Width 4096 | Out-File -FilePath $report -Append -Encoding utf8 } else { 'No listener PIDs found' | Out-File -FilePath $report -Append -Encoding utf8 }
} catch {
    "Get-Process error: $_" | Out-File -FilePath $report -Append -Encoding utf8
}

"`n---PUBLISH/BOUND LINES (last 40 matches)---" | Out-File -FilePath $report -Append -Encoding utf8
$esLog = 'C:\dev\elasticsearch-9.1.4\logs\elasticsearch.log'
if (Test-Path $esLog) {
    try {
        Select-String -Path $esLog -Pattern 'publish_address|bound_addresses' -SimpleMatch | Select-Object -Last 40 | Out-String -Width 4096 | Out-File -FilePath $report -Append -Encoding utf8
    } catch {
        "Select-String error: $_" | Out-File -FilePath $report -Append -Encoding utf8
    }
} else {
    "ES log not found at $esLog" | Out-File -FilePath $report -Append -Encoding utf8
}

"`n---TEST HTTP (publish IP if known)---" | Out-File -FilePath $report -Append -Encoding utf8
# Try to extract an ip from publish_address lines
try {
    $pub = Select-String -Path $esLog -Pattern 'publish_address' -SimpleMatch -ErrorAction SilentlyContinue | Select-Object -Last 1
    if ($pub) {
        $m = [regex]::Match($pub.Line, 'publish_address \{([^:}]+):(?<port>\d+)\}')
        if ($m.Success) {
            $ip = $m.Groups[1].Value
            $port = $m.Groups['port'].Value
            "Found publish IP: $ip:$port" | Out-File -FilePath $report -Append -Encoding utf8
            Test-NetConnection -ComputerName $ip -Port $port | Format-List | Out-String -Width 4096 | Out-File -FilePath $report -Append -Encoding utf8
            try { curl -k ("https://$ip:$port/") -UseBasicParsing -TimeoutSec 10 | Out-String -Width 4096 | Out-File -FilePath $report -Append -Encoding utf8 } catch { "curl error: $_" | Out-File -FilePath $report -Append -Encoding utf8 }
        } else { "No publish IP:port parse from line: $($pub.Line)" | Out-File -FilePath $report -Append -Encoding utf8 }
    } else { "No publish_address line found in ES log" | Out-File -FilePath $report -Append -Encoding utf8 }
} catch { "Publish parse error: $_" | Out-File -FilePath $report -Append -Encoding utf8 }

"`n---TEST TRANSPORT (127.0.0.1:9300)---" | Out-File -FilePath $report -Append -Encoding utf8
try { Test-NetConnection -ComputerName 127.0.0.1 -Port 9300 | Format-List | Out-String -Width 4096 | Out-File -FilePath $report -Append -Encoding utf8 } catch { "Transport test error: $_" | Out-File -FilePath $report -Append -Encoding utf8 }

"`nDone." | Out-File -FilePath $report -Append -Encoding utf8
Write-Host "Wrote report to $report"