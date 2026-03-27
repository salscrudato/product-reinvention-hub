Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4'
)

$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "Missing: $esYml" -ForegroundColor Red; exit 1 }

$bak = $esYml + '.sslstrip.bak'
Copy-Item -Path $esYml -Destination $bak -Force

$lines = Get-Content -Path $esYml
$out = @()
$inXpack = $false
foreach ($line in $lines) {
    if ($line -match '^\s*xpack\.security\s*:') { $inXpack = $true; $out += $line; continue }
    if ($inXpack -and $line -match '^\S') { $inXpack = $false }
    if ($inXpack) {
        # keep only 'enabled: true' line; drop any ssl/keystore/truststore lines
        if ($line.Trim() -match '^enabled:\s*true$') { $out += $line; continue }
        else { continue }
    } else { $out += $line }
}

Set-Content -Path $esYml -Value ($out -join "`n") -Encoding UTF8
Write-Host "Wrote stripped elasticsearch.yml (backup at $bak)" -ForegroundColor Green

Write-Host "Restarting Elasticsearch to pick up config" -ForegroundColor Yellow
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 12

Write-Host "Running elasticsearch-setup-passwords auto" -ForegroundColor Yellow
& (Join-Path $EsHome 'bin\elasticsearch-setup-passwords.bat') auto 2>&1 | Out-File -FilePath '.\scripts\es-setup-passwords-output.txt' -Encoding utf8
Get-Content '.\scripts\es-setup-passwords-output.txt' -Tail 200

Write-Host "Restoring original elasticsearch.yml" -ForegroundColor Yellow
Copy-Item -Path $bak -Destination $esYml -Force
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 10

Write-Host "Done. Check scripts\es-setup-passwords-output.txt for generated passwords." -ForegroundColor Cyan
