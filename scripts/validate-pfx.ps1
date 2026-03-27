Param(
    [string]$PfxPath = 'C:\dev\elasticsearch-9.1.4\config\certs\local-es.pfx',
    [string]$PfxPassword = 'changeit'
)

if (-not (Test-Path $PfxPath)) { Write-Host "MISSING: $PfxPath" -ForegroundColor Red; exit 2 }
try {
    $bytes = [System.IO.File]::ReadAllBytes($PfxPath)
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($bytes, $PfxPassword, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
    Write-Host "PFX OK: Subject=$($cert.Subject) HasPrivateKey=$($cert.HasPrivateKey)" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "PFX load failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
