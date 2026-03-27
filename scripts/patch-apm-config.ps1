param(
    [string]$ApmInstallPath = 'C:\dev\apm-server-9.1.4-windows-x86_64\apm-server-9.1.4-windows-x86_64',
    [string]$CaPath = 'C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt'
)

$src = Join-Path $ApmInstallPath 'apm-server.yml'
$bak = Join-Path $ApmInstallPath 'apm-server.yml.bak'
if (-not (Test-Path $src)) { Write-Host "APM config not found: $src" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $bak)) { Copy-Item -Path $src -Destination $bak -Force; Write-Host "Backup created: $bak" -ForegroundColor Green }

(Get-Content $src) -replace "(?m)^\s*output\.elasticsearch\.hosts:\s*\[.*\]","output.elasticsearch.hosts: ['https://localhost:9200']" | Set-Content $src

# Ensure ssl.certificate_authorities entry exists under output.elasticsearch
$cfg = Get-Content $src -Raw
if ($cfg -notmatch 'output\.elasticsearch:\s*\n\s*ssl\.certificate_authorities') {
    $insertion = "output.elasticsearch.ssl.certificate_authorities: [ '$CaPath' ]`n"
    $cfg = $cfg -replace "(?m)(output\.elasticsearch(?:\s*:\s*\n|\s*:))","$1`n    ssl.certificate_authorities: [ '$CaPath' ]"
    Set-Content -Path $src -Value $cfg
    Write-Host "Inserted ssl.certificate_authorities into apm-server.yml" -ForegroundColor Green
} else {
    Write-Host "apm-server.yml already contains ssl.certificate_authorities; no insertion done." -ForegroundColor Yellow
}

Write-Host 'Patch complete. Please restart apm-server.exe for changes to take effect.' -ForegroundColor Cyan
