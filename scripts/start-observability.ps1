<#
Starts Elasticsearch, APM Server and Kibana from local installs (under C:\dev by default),
and polls their health endpoints until they're ready.

Usage examples:
  # Default (assumes C:\dev paths)
  .\scripts\start-observability.ps1

  # Provide explicit paths and skip TLS cert validation (for dev)
  .\scripts\start-observability.ps1 -ElasticsearchPath 'C:\dev\elasticsearch-9.1.4' -KibanaPath 'C:\dev\kibana-9.1.4' -ApmPath 'C:\dev\apm-server-9.1.4' -SkipCertificateValidation

#>

param(
    [string]$InstallRoot = 'C:\dev',
    [string]$ElasticsearchPath = '',
    [string]$KibanaPath = '',
    [string]$ApmPath = '',
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$SkipCertificateValidation = $false,
    [int]$TimeoutSeconds = 120
)

function Resolve-DefaultPaths {
    param()
    if ([string]::IsNullOrWhiteSpace($ElasticsearchPath)) {
        $candidate = Join-Path $InstallRoot 'elasticsearch-9.1.4'
        if (Test-Path $candidate) { $ElasticsearchPath = $candidate } else {
            $found = Get-ChildItem -Path $InstallRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'elasticsearch*' } | Select-Object -First 1
            if ($found) { $ElasticsearchPath = $found.FullName }
        }
    }
    if ([string]::IsNullOrWhiteSpace($KibanaPath)) {
        $candidate = Join-Path $InstallRoot 'kibana-9.1.4-windows-x86_64\kibana-9.1.4'
        if (Test-Path $candidate) { $KibanaPath = $candidate } else {
            $found = Get-ChildItem -Path $InstallRoot -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'kibana*' } | Select-Object -First 1
            if ($found) { $KibanaPath = $found.FullName }
        }
    }
    if ([string]::IsNullOrWhiteSpace($ApmPath)) {
        $candidate = Join-Path $InstallRoot 'apm-server-9.1.4-windows-x86_64\apm-server-9.1.4-windows-x86_64'
        if (Test-Path $candidate) { $ApmPath = $candidate } else {
            $found = Get-ChildItem -Path $InstallRoot -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'apm-server*' } | Select-Object -First 1
            if ($found) { $ApmPath = $found.FullName }
        }
    }
}

Resolve-DefaultPaths

Write-Host "Starting observability stack using paths:`n Elasticsearch: $ElasticsearchPath`n Kibana: $KibanaPath`n APM: $ApmPath" -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Host 'Warning: Skipping TLS certificate validation for this PowerShell session.' -ForegroundColor Yellow
    Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAllCertsPolicy {
    public static bool Validate(object sender, X509Certificate certificate, X509Chain chain, System.Net.Security.SslPolicyErrors sslPolicyErrors) {
        return true;
    }
}
"@
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { param($s,$c,$ch,$e) [TrustAllCertsPolicy]::Validate($s,$c,$ch,$e) }
}

function Start-IfExists {
    param(
        [string]$exePath,
        [string]$args = ''
    )
    if ([string]::IsNullOrWhiteSpace($exePath)) {
        Write-Host "No executable path provided." -ForegroundColor Yellow
        return $false
    }
    if (Test-Path $exePath) {
        if ([string]::IsNullOrWhiteSpace($args)) {
            Write-Host "Starting: $exePath" -ForegroundColor Green
            Start-Process -FilePath $exePath -WindowStyle Hidden
        } else {
            Write-Host "Starting: $exePath $args" -ForegroundColor Green
            Start-Process -FilePath $exePath -ArgumentList $args -WindowStyle Hidden
        }
        return $true
    } else {
        Write-Host "Not found: $exePath" -ForegroundColor Red
        return $false
    }
}

# Start Elasticsearch
if (-not [string]::IsNullOrWhiteSpace($ElasticsearchPath)) {
    $esExe = Join-Path $ElasticsearchPath 'bin\elasticsearch.bat'
    Start-IfExists -exePath $esExe
} else {
    Write-Host 'Elasticsearch install path not found; skipping start.' -ForegroundColor Yellow
}

# Start APM Server (RUM enabled recommended)
if (-not [string]::IsNullOrWhiteSpace($ApmPath)) {
    $apmExe = Join-Path $ApmPath 'apm-server.exe'
    Start-IfExists -exePath $apmExe -args '-E apm-server.rum.enabled=true'
} else {
    Write-Host 'APM Server install path not found; skipping start.' -ForegroundColor Yellow
}

# Start Kibana
if (-not [string]::IsNullOrWhiteSpace($KibanaPath)) {
    $kibExe = Join-Path $KibanaPath 'bin\kibana.bat'
    Start-IfExists -exePath $kibExe
} else {
    Write-Host 'Kibana install path not found; skipping start.' -ForegroundColor Yellow
}

function Wait-ForHttp {
    param(
        [string]$url,
        [int]$timeoutSec = 120
    )
    $interval = 2
    $attempts = [math]::Ceiling($timeoutSec / $interval)
    for ($i = 0; $i -lt $attempts; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            return $true
        } catch {
            Start-Sleep -Seconds $interval
        }
    }
    return $false
}

Write-Host 'Waiting for services to become available...' -ForegroundColor Cyan
$esHealthUrl = "${ElasticsearchUrl.TrimEnd('/')}/_cluster/health?pretty"
$kibStatusUrl = "${KibanaUrl.TrimEnd('/')}/api/status"
$apmUrl = "${ApmUrl.TrimEnd('/')}/"
$esOk = Wait-ForHttp -url $esHealthUrl -timeoutSec $TimeoutSeconds
$apmOk = Wait-ForHttp -url $apmUrl -timeoutSec $TimeoutSeconds
$kibOk = Wait-ForHttp -url $kibStatusUrl -timeoutSec $TimeoutSeconds

if ($esOk) { Write-Host 'Elasticsearch reachable.' -ForegroundColor Green } else { Write-Host 'Elasticsearch did NOT respond in time.' -ForegroundColor Red }
if ($apmOk) { Write-Host 'APM Server reachable.' -ForegroundColor Green } else { Write-Host 'APM Server did NOT respond in time.' -ForegroundColor Red }
if ($kibOk) { Write-Host 'Kibana reachable.' -ForegroundColor Green } else { Write-Host 'Kibana did NOT respond in time.' -ForegroundColor Red }

Write-Host 'If you saw certificate errors, consider importing the ES http CA into the Windows Trusted Root:' -ForegroundColor Yellow
Write-Host "  certutil -addstore -f \"Root\" \"C:\dev\elasticsearch-9.1.4\config\certs\http_ca.crt\"" -ForegroundColor Magenta

Write-Host 'Done.' -ForegroundColor Cyan
