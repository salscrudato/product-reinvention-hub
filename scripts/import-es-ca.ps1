<#
Attempt to import the Elasticsearch HTTP CA into the Windows Trusted Root store.
This script must be run from an elevated PowerShell (Run as Administrator).
It will try `certutil -addstore` and print helpful next steps if it fails.
#>
param(
    [string]$CaPath = 'C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt',
    [switch]$ForceCurrentUser
)

Write-Host "Attempting to import CA: $CaPath" -ForegroundColor Cyan
if (-not (Test-Path $CaPath)) {
    Write-Host "CA file not found at $CaPath" -ForegroundColor Red
    exit 1
}

try {
    if (-not $ForceCurrentUser) {
        Write-Host 'Attempting system-wide import (requires admin)...' -ForegroundColor Yellow
        $out = certutil -addstore -f Root $CaPath 2>&1
    } else {
        Write-Host 'ForceCurrentUser set - importing into CurrentUser "Trusted Root Certification Authorities" instead.' -ForegroundColor Yellow
        $out = certutil -user -addstore -f Root $CaPath 2>&1
    }
    Write-Host $out
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'CA imported successfully into Trusted Root.' -ForegroundColor Green
        exit 0
    } else {
        Write-Host 'certutil returned non-zero exit code. You may need to run this script as Administrator.' -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host "Import failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'If you see Access Denied, you can re-run this script from an elevated PowerShell.' -ForegroundColor Yellow
    Write-Host 'Alternatively run this script with -ForceCurrentUser to import into the current user store (no admin required):' -ForegroundColor Magenta
    Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\import-es-ca.ps1 -CaPath \"$CaPath\" -ForceCurrentUser" -ForegroundColor Magenta
    exit 1
}
