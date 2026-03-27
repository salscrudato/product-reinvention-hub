<#
.SYNOPSIS
  Imports Elasticsearch http_ca.crt into Windows Root store, ensures hosts file maps hostname to 127.0.0.1, and updates backend/.env ELASTICSEARCH_URL.

.DESCRIPTION
  Automates local dev setup so SnowChat logging can successfully negotiate HTTPS with the auto-generated ES certificate.

.PARAMETER Hostname
  Desired hostname matching a certificate SAN (default: LLMCOEAZHIJMP01)

.PARAMETER CaCertPath
  Path to http_ca.crt (default: C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt)

.EXAMPLE
  ./configure-elasticsearch-host.ps1 -Hostname LLMCOEAZHIJMP01 -CaCertPath C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt

.NOTES
  Run in elevated (Administrator) PowerShell for hosts + cert import.
#>
[CmdletBinding()] param(
  [string]$Hostname = 'LLMCOEAZHIJMP01',
  [string]$CaCertPath = 'C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt',
  # Resolve one directory up from scripts folder to locate backend/.env
  [string]$EnvFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env')
)

# Normalize .env path if relative segments exist
try {
  if (Test-Path $EnvFile) { $EnvFile = (Resolve-Path $EnvFile).Path }
} catch { }

function Write-Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host "[ERROR] $msg" -ForegroundColor Red }

# 1. Validate CA cert path
if (-not (Test-Path $CaCertPath)) { Write-Err "CA certificate not found at $CaCertPath"; exit 1 }

# 2. Import certificate to LocalMachine Root (needs admin)
try {
  $cert = Import-Certificate -FilePath $CaCertPath -CertStoreLocation Cert:\LocalMachine\Root -ErrorAction Stop
  Write-Info "Imported CA cert Thumbprint=$($cert.Thumbprint)"
} catch {
  Write-Warn "Certificate import failed: $($_.Exception.Message). You may need to run as Administrator or it may already be imported. Proceeding."
}

# 3. Ensure hosts entry
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
if (-not (Test-Path $hostsPath)) { Write-Err "Hosts file not found at $hostsPath"; exit 1 }
$hostsContent = Get-Content $hostsPath -ErrorAction Stop
$desiredLine = "127.0.0.1`t$Hostname"
if ($hostsContent -notmatch "^127\.0\.0\.1\s+$Hostname(\s|$)") {
  try {
    Add-Content -Path $hostsPath -Value $desiredLine
    Write-Info "Added hosts entry: $desiredLine"
  } catch {
    Write-Warn "Could not modify hosts file (admin required). $_"
  }
} else {
  Write-Info "Hosts entry already present for $Hostname"
}

# 4. Patch .env ELASTICSEARCH_URL
if (-not (Test-Path $EnvFile)) {
  Write-Warn ".env file not found at $EnvFile, skipping patch"
} else {
  $envLines = Get-Content $EnvFile
  $updated = $false
  for ($i=0; $i -lt $envLines.Count; $i++) {
    if ($envLines[$i] -match '^ELASTICSEARCH_URL=') {
      $envLines[$i] = "ELASTICSEARCH_URL=https://$Hostname:9200"
      $updated = $true
      Write-Info "Updated ELASTICSEARCH_URL to https://$Hostname:9200"
    }
  }
  if (-not $updated) {
    $envLines += "ELASTICSEARCH_URL=https://$Hostname:9200"
    Write-Info "Appended ELASTICSEARCH_URL=https://$Hostname:9200"
  }
  try {
    Set-Content -Path $EnvFile -Value $envLines -Encoding UTF8
  } catch {
    Write-Warn "Failed to write .env file: $_"
  }
}

# 5. Test curl (if available)
$curl = Get-Command curl -ErrorAction SilentlyContinue
if ($curl) {
  Write-Info "Testing HTTPS connectivity with curl (revocation disabled for self-signed CA)..."
  try {
    $result = curl --ssl-no-revoke -s -o NUL -w "%{http_code}" https://$Hostname:9200/
    if ($result -eq '200') { Write-Info "Elasticsearch responded with HTTP 200" } else { Write-Warn "Elasticsearch returned HTTP $result (expected 200)" }
  } catch { Write-Warn "curl test failed: $_" }
} else {
  Write-Warn "curl not found in PATH; skipping connectivity test"
}

Write-Info "Done. Restart backend process to pick up updated .env if it was running."
