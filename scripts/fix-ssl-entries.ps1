<#
Fix SSL entries in elasticsearch.yml:
- Remove any PKCS#12/keystore entries and any references to .pfx
- Remove existing xpack.security.http.ssl.* and xpack.security.transport.ssl.* entries
- Add canonical PEM-based entries for http and transport (paths set to local-es.pem/local-es-key.pem)

Usage:
  .\fix-ssl-entries.ps1            # dry-run
  .\fix-ssl-entries.ps1 -Apply    # apply changes (backup created)
#>
[CmdletBinding()]
param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [switch]$Apply
)
$EsYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $EsYml)) { Write-Error "Missing $EsYml"; exit 2 }

$raw = Get-Content -Raw -Path $EsYml -ErrorAction Stop
$lines = $raw -split "\r?\n"

# Patterns to remove
$removePatterns = @(
    'keystore\.path',
    'keystore\.password',
    '\.pfx',
    '^\s*xpack\.security\.http\.ssl\.',
    '^\s*xpack\.security\.transport\.ssl\.'
)

$filtered = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
    $skip = $false
    foreach ($pat in $removePatterns) {
        if ($line -match $pat) { $skip = $true; break }
    }
    if (-not $skip) { $filtered.Add($line) }
}

# Canonical PEM entries (use forward slashes in YAML values)
$pemHttpEnabled = 'xpack.security.http.ssl.enabled: true'
$httpPemCert = 'xpack.security.http.ssl.certificate: "C:/dev/elasticsearch-9.1.4/config/certs/local-es.pem"'
$httpPemKey = 'xpack.security.http.ssl.key: "C:/dev/elasticsearch-9.1.4/config/certs/local-es-key.pem"'

$pemTransportEnabled = 'xpack.security.transport.ssl.enabled: true'
$transportPemCert = 'xpack.security.transport.ssl.certificate: "C:/dev/elasticsearch-9.1.4/config/certs/local-es.pem"'
$transportPemKey = 'xpack.security.transport.ssl.key: "C:/dev/elasticsearch-9.1.4/config/certs/local-es-key.pem"'

# Check current presence
$present = @{}
$present[$pemHttpEnabled] = $filtered -contains $pemHttpEnabled
$present[$httpPemCert] = $filtered -contains $httpPemCert
$present[$httpPemKey] = $filtered -contains $httpPemKey
$present[$pemTransportEnabled] = $filtered -contains $pemTransportEnabled
$present[$transportPemCert] = $filtered -contains $transportPemCert
$present[$transportPemKey] = $filtered -contains $transportPemKey

Write-Host "Current presence of canonical PEM entries:"
foreach ($k in $present.Keys) { Write-Host (" - {0} : {1}" -f $k, $present[$k]) }

if (-not $Apply) {
    Write-Host "Dry run: no file changes. Run with -Apply to write a backup and update $EsYml"
    exit 0
}

# Backup and write
$bak = "$EsYml.$((Get-Date).ToString('yyyyMMddHHmmss')).fixssl.bak"
Copy-Item -Path $EsYml -Destination $bak -Force

# Remove trailing empty lines
while ($filtered.Count -gt 0 -and ($filtered[-1] -match '^[\s]*$')) { $filtered.RemoveAt($filtered.Count-1) }

# Append canonical entries if missing
$append = New-Object System.Collections.Generic.List[string]
$append.Add('')
$append.Add('# Added by fix-ssl-entries.ps1')
if (-not $present[$pemHttpEnabled]) { $append.Add($pemHttpEnabled) }
if (-not $present[$httpPemCert]) { $append.Add($httpPemCert) }
if (-not $present[$httpPemKey]) { $append.Add($httpPemKey) }
if (-not $present[$pemTransportEnabled]) { $append.Add($pemTransportEnabled) }
if (-not $present[$transportPemCert]) { $append.Add($transportPemCert) }
if (-not $present[$transportPemKey]) { $append.Add($transportPemKey) }

# Write final file
$final = @()
$final += $filtered
$final += $append
$final | Out-File -FilePath $EsYml -Encoding utf8 -Force
Write-Host "Wrote updated elasticsearch.yml (backup at $bak)"
