Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$SubjectName = 'CN=localhost',
    [string]$PfxPassword = 'changeit'
)

Write-Host "Setting up ES TLS assets in $EsHome" -ForegroundColor Cyan

$certsDir = Join-Path $EsHome 'config\certs'
if (-not (Test-Path $certsDir)) { New-Item -Path $certsDir -ItemType Directory -Force | Out-Null }

$pfxPath = Join-Path $certsDir 'local-es.pfx'
$crtPath = Join-Path $certsDir 'local-es.crt'
$keyPath = Join-Path $certsDir 'local-es.key'

Write-Host 'Generating self-signed certificate (PowerShell New-SelfSignedCertificate)...' -ForegroundColor Yellow
try {
    $cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(5) -FriendlyName 'local-es'
    if ($null -eq $cert) { throw 'certificate creation failed' }

    $securePwd = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
    Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $pfxPath -Password $securePwd -Force

    $bytes = [System.IO.File]::ReadAllBytes($pfxPath)
    $pfx = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($bytes, $PfxPassword, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
    $pemCert = "-----BEGIN CERTIFICATE-----`n" + [System.Convert]::ToBase64String($pfx.RawData, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----`n"
    Set-Content -Path $crtPath -Value $pemCert -Encoding ascii

    Write-Host "Wrote PFX to $pfxPath and CRT to $crtPath" -ForegroundColor Green
} catch {
    Write-Host "Certificate generation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host 'Patching elasticsearch.yml (HTTP TLS settings)...' -ForegroundColor Yellow
$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "elasticsearch.yml not found at $esYml" -ForegroundColor Red; exit 1 }

$backup = $esYml + '.bak'
Copy-Item -Path $esYml -Destination $backup -Force

$yml = Get-Content $esYml

# Remove any existing xpack.security http/transport ssl lines to avoid duplicates
$yml = $yml | Where-Object { $_ -notmatch '^(xpack.security.transport.ssl|xpack.security.http.ssl|xpack.security.enabled)' }

$add = @(
  'xpack.security.enabled: true',
  'xpack.security.transport.ssl.enabled: true',
  "xpack.security.transport.ssl.keystore.path: config/certs/local-es.pfx",
  "xpack.security.transport.ssl.keystore.password: $PfxPassword",
  'xpack.security.http.ssl.enabled: true',
  "xpack.security.http.ssl.keystore.path: config/certs/local-es.pfx",
  "xpack.security.http.ssl.keystore.password: $PfxPassword"
)

$new = $yml + $add
Set-Content -Path $esYml -Value $new -Encoding utf8

Write-Host 'Restarting Elasticsearch (attempting graceful stop/start).' -ForegroundColor Yellow
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$esExe = Join-Path $EsHome 'bin\elasticsearch.bat'
if (-not (Test-Path $esExe)) { Write-Host "elasticsearch.bat not found at $esExe" -ForegroundColor Red; exit 1 }

Start-Process -FilePath $esExe -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 8

Write-Host 'Setup script finished — check elasticsearch logs for TLS startup messages.' -ForegroundColor Cyan
