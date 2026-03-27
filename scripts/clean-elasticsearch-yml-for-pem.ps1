<#
Cleans elasticsearch.yml by removing PKCS#12 / keystore entries and malformed escaped blocks,
and ensures PEM certificate/key settings are present. Creates a backup before changing the file.

Usage:
  .\clean-elasticsearch-yml-for-pem.ps1            # show actions (dry-run default)
  .\clean-elasticsearch-yml-for-pem.ps1 -Apply     # apply changes
  .\clean-elasticsearch-yml-for-pem.ps1 -Apply -Restart  # apply and start ES if not running
#>

[CmdletBinding()]
param(
    [string]$EsHome = "C:\dev\elasticsearch-9.1.4",
    [switch]$Apply,
    [switch]$Restart
)

$EsYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $EsYml)) {
    Write-Error "elasticsearch.yml not found at $EsYml"
    exit 2
}

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$backup = "$EsYml.$timestamp.pemclean.bak"

# patterns to remove (case-insensitive)
$removePatterns = @(
    'keystore\.path:.*\.pfx',
    'keystore\.password',
    'xpack\.security\.transport\.ssl\.keystore',
    'xpack\.security\.http\.ssl\.keystore',
    'xpack:\\n', # literal backslash-n sequences introduced by malformed edits
    '\\n'       # any remaining literal backslash-n
)

Write-Host "Reading $EsYml"
$lines = Get-Content -Raw -Path $EsYml -ErrorAction Stop

# Work on lines as array to preserve formatting
$lineArray = $lines -split "\r?\n"

$kept = New-Object System.Collections.Generic.List[string]
foreach ($line in $lineArray) {
    $skip = $false
    foreach ($pat in $removePatterns) {
        if ($line -match $pat) { $skip = $true; break }
    }
    if (-not $skip) { $kept.Add($line) }
}

# Ensure PEM entries exist (use forward slashes or Windows paths in quotes)
$pemEntries = @(
    'xpack.security.http.ssl.enabled: true',
    'xpack.security.http.ssl.certificate: "C:/dev/elasticsearch-9.1.4/config/certs/local-es.pem"',
    'xpack.security.http.ssl.key: "C:/dev/elasticsearch-9.1.4/config/certs/local-es-key.pem"',
    'xpack.security.transport.ssl.enabled: true',
    'xpack.security.transport.ssl.certificate: "C:/dev/elasticsearch-9.1.4/config/certs/local-es.pem"',
    'xpack.security.transport.ssl.key: "C:/dev/elasticsearch-9.1.4/config/certs/local-es-key.pem"'
)

# Check presence
$present = @{ }
foreach ($entry in $pemEntries) { $present[$entry] = $kept -contains $entry }

Write-Host "Detected the following PEM entries presence:"
foreach ($k in $present.Keys) { Write-Host (" - {0} : {1}" -f $k, $present[$k]) }

if (-not $Apply) {
    Write-Host "Dry run. To apply changes re-run with -Apply. Backup will be created when applying."
    exit 0
}

Write-Host "Creating backup: $backup"
Copy-Item -Path $EsYml -Destination $backup -Force

# Remove potential duplicate trailing blank lines
while ($kept.Count -gt 0 -and ($kept[-1] -match '^[\s]*$')) { $kept.RemoveAt($kept.Count-1) }

# Append missing PEM entries
foreach ($entry in $pemEntries) {
    if (-not ($kept -contains $entry)) {
        $kept.Add($entry)
    }
}

Write-Host "Writing cleaned file to $EsYml"
$kept | Out-File -FilePath $EsYml -Encoding utf8 -Force

Write-Host "Cleaning complete. Backup saved at $backup"

if ($Restart) {
    Write-Host "Attempting to start Elasticsearch if not running..."
    # Check for a running Java/Elasticsearch process
    $esProcess = Get-WmiObject Win32_Process -Filter "Name = 'java.exe' OR Name='javaw.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'elasticsearch') }
    if ($esProcess) {
        Write-Host "Elasticsearch Java process already running (pid: $($esProcess.ProcessId)). Not starting a new one."
    } else {
        $startBat = Join-Path $EsHome 'bin\elasticsearch.bat'
        if (-not (Test-Path $startBat)) {
            Write-Error "Start script not found: $startBat"
            exit 3
        }
        Write-Host "Starting Elasticsearch via $startBat"
        Start-Process -FilePath $startBat -WorkingDirectory $EsHome -WindowStyle Hidden -PassThru | Out-Null
        Start-Sleep -Seconds 6
        Write-Host "Start requested. Give ES a few seconds and then re-run diagnostics or check logs in $EsHome\logs"
    }
}

Write-Host "Done."
