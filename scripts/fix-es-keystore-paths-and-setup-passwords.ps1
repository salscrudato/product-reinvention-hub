Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4'
)

Write-Host "Fixing keystore paths in elasticsearch.yml under $EsHome" -ForegroundColor Cyan

$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "Missing: $esYml" -ForegroundColor Red; exit 1 }

$backup = $esYml + '.keystorepath.bak'
Copy-Item -Path $esYml -Destination $backup -Force

$text = Get-Content -Path $esYml -Raw
$updated = $text -replace 'config/\s*certs', 'certs'
$updated = $updated -replace 'config\\certs', 'certs'

Set-Content -Path $esYml -Value $updated -Encoding UTF8
Write-Host "Rewrote $esYml (backup at $backup)" -ForegroundColor Green

Write-Host "Restarting Elasticsearch (start)" -ForegroundColor Yellow
# Ensure ES is stopped first
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 15

Write-Host "Running elasticsearch-setup-passwords auto (output -> scripts\es-setup-passwords-output.txt)" -ForegroundColor Yellow
& (Join-Path $EsHome 'bin\elasticsearch-setup-passwords.bat') auto | Out-File -FilePath '.\scripts\es-setup-passwords-output.txt' -Encoding utf8
Get-Content '.\scripts\es-setup-passwords-output.txt' -Tail 200

Write-Host "Done. If the setup failed, inspect scripts\es-setup-passwords-output.txt and elasticsearch logs." -ForegroundColor Cyan
