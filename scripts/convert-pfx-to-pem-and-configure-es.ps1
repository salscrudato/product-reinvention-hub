param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$PfxPath = 'C:\dev\elasticsearch-9.1.4\config\certs\local-es.pfx',
    [string]$PfxPassword = 'changeit'
)

Write-Host "Converting PFX to PEM for ES in $EsHome" -ForegroundColor Cyan

function Fail([string]$msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# Check openssl
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) { Fail 'OpenSSL not found in PATH. Please install OpenSSL or add it to PATH.' }

$certsDir = Join-Path $EsHome 'config\certs'
if (-not (Test-Path $PfxPath)) { Fail "PFX not found at $PfxPath" }

$outCert = Join-Path $certsDir 'local-es.pem'
$outKey = Join-Path $certsDir 'local-es-key.pem'

Write-Host 'Exporting certificate (PEM)...'
& openssl pkcs12 -in $PfxPath -nokeys -out $outCert -passin pass:$PfxPassword | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Failed to export certificate from PFX' }

Write-Host 'Exporting private key (PEM)...'
& openssl pkcs12 -in $PfxPath -nocerts -nodes -out $outKey -passin pass:$PfxPassword | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Failed to export private key from PFX' }

Write-Host "PEM files written: $outCert, $outKey" -ForegroundColor Green

# Backup elasticsearch.yml
$yml = Join-Path $EsHome 'config\elasticsearch.yml'
$bak = $yml + '.pemconvert.bak'
if (-not (Test-Path $bak)) { Copy-Item $yml $bak -Force }

Write-Host 'Patching elasticsearch.yml to use PEM cert/key' -ForegroundColor Cyan
$ymlText = Get-Content $yml -Raw

# Remove any xpack.security.http.ssl.keystore.* and transport.keystore.* lines to avoid conflicts
$ymlText = $ymlText -replace '(?m)^\s*xpack\.security\.http\.ssl\.keystore\.[^:]+:.*$',''
$ymlText = $ymlText -replace '(?m)^\s*xpack\.security\.transport\.ssl\.keystore\.[^:]+:.*$',''

# Append simple dotted YAML keys for PEM cert and key to avoid complex block edits
$certPath = $outCert -replace '\\','/'
$keyPath = $outKey -replace '\\','/'
$appendLines = @(
    '# Added by convert-pfx-to-pem-and-configure-es.ps1',
    'xpack.security.http.ssl.enabled: true',
    "xpack.security.http.ssl.certificate: \"$certPath\"",
    "xpack.security.http.ssl.key: \"$keyPath\"",
    'xpack.security.transport.ssl.enabled: true',
    "xpack.security.transport.ssl.certificate: \"$certPath\"",
    "xpack.security.transport.ssl.key: \"$keyPath\""
)

$append = "`n" + ($appendLines -join "`n") + "`n"
$ymlText = $ymlText + $append

Set-Content -Path $yml -Value $ymlText -Encoding UTF8
Write-Host 'elasticsearch.yml patched (backup created).' -ForegroundColor Green

# Restart Elasticsearch (attempt graceful stop then start)
Write-Host 'Restarting Elasticsearch...' -ForegroundColor Cyan
$esBin = Join-Path $EsHome 'bin\elasticsearch.bat'
if (-not (Test-Path $esBin)) { Fail 'Elasticsearch binary not found at expected location.' }

try {
    Stop-Process -Name elasticsearch -ErrorAction SilentlyContinue
} catch {}

Start-Process -FilePath $esBin -WorkingDirectory $EsHome
Write-Host 'Elasticsearch start requested. Wait a moment, then check logs.' -ForegroundColor Cyan
param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$PfxPath = 'C:\dev\elasticsearch-9.1.4\config\certs\local-es.pfx',
    [string]$PfxPassword = 'changeit'
)

Write-Host "Converting PFX to PEM for ES in $EsHome" -ForegroundColor Cyan

function Fail([string]$msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

# Check openssl
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) { Fail 'OpenSSL not found in PATH. Please install OpenSSL or add it to PATH.' }

$certsDir = Join-Path $EsHome 'config\certs'
if (-not (Test-Path $PfxPath)) { Fail "PFX not found at $PfxPath" }

$outCert = Join-Path $certsDir 'local-es.pem'
$outKey = Join-Path $certsDir 'local-es-key.pem'

Write-Host 'Exporting certificate (PEM)...'
& openssl pkcs12 -in $PfxPath -nokeys -out $outCert -passin pass:$PfxPassword | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Failed to export certificate from PFX' }

Write-Host 'Exporting private key (PEM)...'
& openssl pkcs12 -in $PfxPath -nocerts -nodes -out $outKey -passin pass:$PfxPassword | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Failed to export private key from PFX' }

Write-Host "PEM files written: $outCert, $outKey" -ForegroundColor Green

# Backup elasticsearch.yml
$yml = Join-Path $EsHome 'config\elasticsearch.yml'
$bak = $yml + '.pemconvert.bak'
if (-not (Test-Path $bak)) { Copy-Item $yml $bak -Force }

Write-Host 'Patching elasticsearch.yml to use PEM cert/key' -ForegroundColor Cyan
$ymlText = Get-Content $yml -Raw

# Remove any xpack.security.http.ssl.keystore.* and transport.keystore.* lines to avoid conflicts
$ymlText = $ymlText -replace '(?m)^\s*xpack\.security\.http\.ssl\.keystore\.[^:]+:.*$',''
$ymlText = $ymlText -replace '(?m)^\s*xpack\.security\.transport\.ssl\.keystore\.[^:]+:.*$',''

# Append simple dotted YAML keys for PEM cert and key to avoid complex block edits
$certPath = $outCert -replace '\\','/'
$keyPath = $outKey -replace '\\','/'
$append = "`n# Added by convert-pfx-to-pem-and-configure-es.ps1`n"
$append += "xpack.security.http.ssl.enabled: true`n"
$append += "xpack.security.http.ssl.certificate: \"$certPath\"`n"
$append += "xpack.security.http.ssl.key: \"$keyPath\"`n"
$append += "xpack.security.transport.ssl.enabled: true`n"
$append += "xpack.security.transport.ssl.certificate: \"$certPath\"`n"
$append += "xpack.security.transport.ssl.key: \"$keyPath\"`n"

$ymlText = $ymlText + $append

Set-Content -Path $yml -Value $ymlText -Encoding UTF8
Write-Host 'elasticsearch.yml patched (backup created).' -ForegroundColor Green

# Restart Elasticsearch (attempt graceful stop then start)
Write-Host 'Restarting Elasticsearch...' -ForegroundColor Cyan
$esBin = Join-Path $EsHome 'bin\elasticsearch.bat'
if (-not (Test-Path $esBin)) { Fail 'Elasticsearch binary not found at expected location.' }

try {
    Stop-Process -Name elasticsearch -ErrorAction SilentlyContinue
} catch {}

Start-Process -FilePath $esBin -WorkingDirectory $EsHome
Write-Host 'Elasticsearch start requested. Wait a moment, then check logs.' -ForegroundColor Cyan
