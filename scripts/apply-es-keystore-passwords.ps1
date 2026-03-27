Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [string]$KeystorePassword = 'changeit'
)

Write-Host "Applying keystore secure passwords for ES at $EsHome" -ForegroundColor Cyan

$yml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $yml)) { Write-Host "Missing: $yml" -ForegroundColor Red; exit 1 }

# Remove any keystore.password lines we previously wrote
$lines = Get-Content -Path $yml
$clean = $lines | Where-Object { $_ -notmatch 'keystore\.password' }
Set-Content -Path $yml -Value ($clean -join "`n") -Encoding UTF8
Write-Host "Removed plaintext keystore.password entries from elasticsearch.yml" -ForegroundColor Green

$keystoreExe = Join-Path $EsHome 'bin\elasticsearch-keystore.bat'
if (-not (Test-Path $keystoreExe)) { Write-Host "elasticsearch-keystore not found: $keystoreExe" -ForegroundColor Red; exit 1 }


function AddSecurePassword($settingName) {
    Write-Host "Adding secure password to keystore for $settingName" -ForegroundColor Yellow
    $cmd = "echo $KeystorePassword ^| `"$keystoreExe`" add $settingName"
    Write-Host "Running: cmd /c $cmd" -ForegroundColor DarkGray
    $proc = Start-Process -FilePath cmd.exe -ArgumentList "/c", $cmd -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) { Write-Host "Failed to add $settingName (exit $($proc.ExitCode))" -ForegroundColor Red } else { Write-Host "Added $settingName" -ForegroundColor Green }
}

AddSecurePassword 'xpack.security.transport.ssl.keystore.secure_password'
AddSecurePassword 'xpack.security.http.ssl.keystore.secure_password'

Write-Host "Keystore updates complete. Restart Elasticsearch to pick up changes." -ForegroundColor Cyan
