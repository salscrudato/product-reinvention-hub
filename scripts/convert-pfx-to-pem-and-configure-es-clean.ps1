param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$PfxPath = 'C:\dev\elasticsearch-9.1.4\config\certs\local-es.pfx',
    [string]$PfxPassword = 'changeit'
)

function Fail([string]$msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

Write-Host "[convert-clean] Starting conversion for ES home: $EsHome" -ForegroundColor Cyan

# Check preconditions
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) { Fail 'OpenSSL not found in PATH.' }
if (-not (Test-Path $PfxPath)) { Fail "PFX not found at $PfxPath" }

$certsDir = Join-Path $EsHome 'config\certs'
if (-not (Test-Path $certsDir)) { New-Item -Path $certsDir -ItemType Directory -Force | Out-Null }

$outCert = Join-Path $certsDir 'local-es.pem'
$outKey = Join-Path $certsDir 'local-es-key.pem'

Write-Host '[convert-clean] Exporting certificate (PEM)...'
& openssl pkcs12 -in $PfxPath -nokeys -out $outCert -passin pass:$PfxPassword
if ($LASTEXITCODE -ne 0) { Fail 'openssl failed extracting certificate' }

Write-Host '[convert-clean] Exporting private key (PEM)...'
& openssl pkcs12 -in $PfxPath -nocerts -nodes -out $outKey -passin pass:$PfxPassword
if ($LASTEXITCODE -ne 0) { Fail 'openssl failed extracting private key' }

Write-Host "[convert-clean] PEM files created: $outCert, $outKey" -ForegroundColor Green

# Backup and patch elasticsearch.yml
$yml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $yml)) { Fail "elasticsearch.yml not found at $yml" }
$bak = $yml + '.pemconvert-clean.bak'
if (-not (Test-Path $bak)) { Copy-Item $yml $bak -Force }

Write-Host '[convert-clean] Appending PEM settings to elasticsearch.yml'
$certPath = $outCert -replace '\\','/'
$keyPath = $outKey -replace '\\','/'
$lines = @()
$lines += '# Added by convert-pfx-to-pem-and-configure-es-clean.ps1'
$lines += 'xpack.security.http.ssl.enabled: true'
$lines += ('xpack.security.http.ssl.certificate: "' + $certPath + '"')
$lines += ('xpack.security.http.ssl.key: "' + $keyPath + '"')
$lines += 'xpack.security.transport.ssl.enabled: true'
$lines += ('xpack.security.transport.ssl.certificate: "' + $certPath + '"')
$lines += ('xpack.security.transport.ssl.key: "' + $keyPath + '"')

Add-Content -Path $yml -Value ($lines -join "`n")
Write-Host '[convert-clean] elasticsearch.yml updated (backup created).' -ForegroundColor Green

Write-Host '[convert-clean] Restarting Elasticsearch (requesting start)...' -ForegroundColor Cyan
$esBin = Join-Path $EsHome 'bin\elasticsearch.bat'
if (-not (Test-Path $esBin)) { Fail 'Elasticsearch start binary not found.' }

try { Stop-Process -Name elasticsearch -ErrorAction SilentlyContinue } catch {}
Start-Process -FilePath $esBin -WorkingDirectory $EsHome

Write-Host '[convert-clean] Start requested; check logs in $EsHome\logs for progress.' -ForegroundColor Cyan
