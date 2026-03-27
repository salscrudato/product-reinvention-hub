Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$PfxPassword = 'changeit'
)

Write-Host "Fixing elasticsearch.yml under $EsHome" -ForegroundColor Cyan

$esYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $esYml)) { Write-Host "elasticsearch.yml not found at $esYml" -ForegroundColor Red; exit 1 }

$backup = $esYml + '.autofix.bak'
Copy-Item -Path $esYml -Destination $backup -Force


$content = Get-Content -Path $esYml -Raw

# Remove the auto-generated security configuration block if present
$pattern = '(?s)#----------------------- BEGIN SECURITY AUTO CONFIGURATION .*?--\n#----------------------- END SECURITY AUTO CONFIGURATION -------------------------\r?\n?'
$cleaned = [regex]::Replace($content, $pattern, '')

# Remove any stray top-level 'enabled:' or keystore.path lines that are not under xpack.security

# Remove existing xpack.security blocks entirely (if any)
$lines = $cleaned -split "\r?\n"
$out = @()
$skip = $false
foreach ($ln in $lines) {
    if ($ln -match '^\s*xpack\.security\s*:') { $skip = $true; continue }
    if ($skip) {
        if ($ln -match '^\S') { $skip = $false }
    }
    if (-not $skip) { $out += $ln }
}

# Build a clean xpack.security block
$xpack = @(
    '',
    'xpack.security:',
    '  enabled: true',
    '  transport:',
    '    ssl:',
    '      enabled: true',
    "      keystore.path: config/certs/local-es.pfx",
    "      keystore.password: $PfxPassword",
    '  http:',
    '    ssl:',
    '      enabled: true',
    "      keystore.path: config/certs/local-es.pfx",
    "      keystore.password: $PfxPassword",
    ''
)

$new = $out + $xpack

Set-Content -Path $esYml -Value ($new -join "`n") -Encoding UTF8

Write-Host "Wrote cleaned elasticsearch.yml (removed auto security block) and saved backup to $backup" -ForegroundColor Green

Write-Host "Attempting to run elasticsearch-setup-passwords auto to create built-in users (may fail if ES isn't fully started)." -ForegroundColor Yellow
& "${EsHome}\bin\elasticsearch-setup-passwords.bat" auto

Write-Host "Done. If you still see YAML parse errors, open $esYml and inspect manually." -ForegroundColor Cyan
