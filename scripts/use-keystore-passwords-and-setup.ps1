Param(
    [string]$EsHome = "C:\dev\elasticsearch-9.1.4",
    [string]$KeystorePassword = "changeit"
)

$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "Missing: $esYml" -ForegroundColor Red; exit 1 }

Write-Host "Removing secure_password entries from ES keystore (if present)" -ForegroundColor Cyan
& (Join-Path $EsHome 'bin\elasticsearch-keystore.bat') remove xpack.security.transport.ssl.keystore.secure_password 2>$null
& (Join-Path $EsHome 'bin\elasticsearch-keystore.bat') remove xpack.security.http.ssl.keystore.secure_password 2>$null

Write-Host "Patching elasticsearch.yml to add keystore.password entries" -ForegroundColor Cyan
$lines = Get-Content -Path $esYml
$out = @()
$inTransportSsl = $false
$inHttpSsl = $false
foreach ($line in $lines) {
    $out += $line
    if ($line -match '^\s*transport:\s*$') { $inTransportSsl = $true; continue }
    if ($inTransportSsl -and $line -match '^\s*ssl:\s*$') { $out += (' ' * 6) + "keystore.password: $KeystorePassword"; $inTransportSsl = $false; continue }
    if ($line -match '^\s*http:\s*$') { $inHttpSsl = $true; continue }
    if ($inHttpSsl -and $line -match '^\s*ssl:\s*$') { $out += (' ' * 6) + "keystore.password: $KeystorePassword"; $inHttpSsl = $false; continue }
}

Set-Content -Path $esYml -Value ($out -join "`n") -Encoding UTF8

Write-Host "Restarting Elasticsearch" -ForegroundColor Yellow
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 12

Write-Host "Running elasticsearch-setup-passwords auto" -ForegroundColor Yellow
& (Join-Path $EsHome 'bin\elasticsearch-setup-passwords.bat') auto 2>&1 | Out-File -FilePath '.\scripts\es-setup-passwords-output.txt' -Encoding utf8
Get-Content '.\scripts\es-setup-passwords-output.txt' -Raw | Select-Object -First 200

Write-Host "Done — check scripts\es-setup-passwords-output.txt for generated passwords." -ForegroundColor Cyan
Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$KeystorePassword = 'changeit'
)

$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "Missing: $esYml" -ForegroundColor Red; exit 1 }

Write-Host "Removing secure_password entries from ES keystore (if present)" -ForegroundColor Cyan
& (Join-Path $EsHome 'bin\elasticsearch-keystore.bat') remove xpack.security.transport.ssl.keystore.secure_password 2>$null
& (Join-Path $EsHome 'bin\elasticsearch-keystore.bat') remove xpack.security.http.ssl.keystore.secure_password 2>$null

Write-Host "Patching elasticsearch.yml to add keystore.password entries" -ForegroundColor Cyan
$lines = Get-Content -Path $esYml
$out = @()
$inTransportSsl = $false
$inHttpSsl = $false
foreach ($line in $lines) {
    $out += $line
    if ($line -match '^\s*transport:\s*$') { $inTransportSsl = $true; continue }
    if ($inTransportSsl -and $line -match '^\s*ssl:\s*$') { $out += (' ' * 6) + "keystore.password: $KeystorePassword"; $inTransportSsl = $false; continue }
    if ($line -match '^\s*http:\s*$') { $inHttpSsl = $true; continue }
    if ($inHttpSsl -and $line -match '^\s*ssl:\s*$') { $out += (' ' * 6) + "keystore.password: $KeystorePassword"; $inHttpSsl = $false; continue }
}

Set-Content -Path $esYml -Value ($out -join "`n") -Encoding UTF8

Write-Host "Restarting Elasticsearch" -ForegroundColor Yellow
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 12

Write-Host "Running elasticsearch-setup-passwords auto" -ForegroundColor Yellow
& (Join-Path $EsHome 'bin\elasticsearch-setup-passwords.bat') auto 2>&1 | Out-File -FilePath '.\scripts\es-setup-passwords-output.txt' -Encoding utf8
Get-Content '.\scripts\es-setup-passwords-output.txt' -Raw | Select-Object -First 200

Write-Host "Done — check scripts\es-setup-passwords-output.txt for generated passwords." -ForegroundColor Cyan
