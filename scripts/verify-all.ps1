param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

$errors = @()

Write-Host 'Starting combined observability verification...' -ForegroundColor Cyan

& .\verify-es.ps1 -ElasticsearchUrl $ElasticsearchUrl -ShowCert:$ShowCert -SkipCertificateValidation:$SkipCertificateValidation
if ($LASTEXITCODE -ne 0) { $errors += 'elasticsearch' }

& .\verify-apm.ps1 -ApmUrl $ApmUrl
if ($LASTEXITCODE -ne 0) { $errors += 'apm' }

& .\verify-kibana.ps1 -KibanaUrl $KibanaUrl
if ($LASTEXITCODE -ne 0) { $errors += 'kibana' }

if ($errors.Count -eq 0) {
    Write-Host 'All checks completed (no script-level errors detected).' -ForegroundColor Green
} else {
    Write-Host "Checks completed with issues: $($errors -join ', ')" -ForegroundColor Yellow
}

Write-Host 'verify-all finished.' -ForegroundColor Cyan
