Param(
    [string]$EsHome = "C:\\dev\\elasticsearch-9.1.4"
Param(
    [string]$EsHome = "C:\\dev\\elasticsearch-9.1.4"
)

$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "Missing: $esYml" -ForegroundColor Red; exit 1 }

$bak = $esYml + '.prehttptls.bak'
Copy-Item -Path $esYml -Destination $bak -Force

$text = Get-Content -Path $esYml -Raw

# Try to locate http.ssl.enabled and flip it to false; otherwise append a temporary override.
if ($text -match '(?ms)http:\s*\r?\n\s*ssl:\s*\r?\n[\s\S]*?enabled:\s*true') {
    Write-Host "Disabling http.ssl.enabled temporarily" -ForegroundColor Yellow
    $text = [Regex]::Replace($text, '(?ms)(http:\s*\r?\n\s*ssl:\s*\r?\n[\s\S]*?)enabled:\s*true', '${1}enabled: false')
    Set-Content -Path $esYml -Value $text -Encoding UTF8
} else {
    Write-Host "Could not find http.ssl.enabled: true pattern - adding a temporary override" -ForegroundColor Yellow
    $text = $text + "`n# TEMP: disable http TLS for password setup`nhttp:`n  ssl:`n    enabled: false`n"
    Set-Content -Path $esYml -Value $text -Encoding UTF8
}

Write-Host "Restarting Elasticsearch (stopped then started)" -ForegroundColor Yellow
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 12

Write-Host "Running elasticsearch-setup-passwords auto (output -> scripts\es-setup-passwords-output.txt)" -ForegroundColor Yellow
# Run the setup-passwords batch and capture both stdout/stderr to the file.
& (Join-Path $EsHome 'bin\elasticsearch-setup-passwords.bat') auto *>&1 | Out-File -FilePath '.\scripts\es-setup-passwords-output.txt' -Encoding utf8
Get-Content '.\scripts\es-setup-passwords-output.txt' -Tail 200

Write-Host "Restoring original elasticsearch.yml from backup and restarting ES" -ForegroundColor Yellow
Copy-Item -Path $bak -Destination $esYml -Force
Get-Process -Name elasticsearch -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process -FilePath (Join-Path $EsHome 'bin\elasticsearch.bat') -WorkingDirectory $EsHome -WindowStyle Hidden
Start-Sleep -Seconds 10

Write-Host "Done. Check scripts\es-setup-passwords-output.txt for generated passwords and ES logs if needed." -ForegroundColor Cyan
