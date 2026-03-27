param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Call-Url {
    param([string]$Url)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        Write-Host ($Url + ' -> HTTP ' + $resp.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ($Url + ' -> ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    }
}

function Show-Cert {
    param([string]$Url)
    if ($Url -notlike 'https://*') { return }
    try {
        $u = New-Object System.Uri($Url)
        $host = $u.Host
        if ($u.Port -gt 0) { $port = $u.Port } else { $port = 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host ('Certificate Subject: ' + $cert.Subject)
        Write-Host ('Certificate Issuer:  ' + $cert.Issuer)
        Write-Host ('Thumbprint: ' + $cert.Thumbprint)
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host ('Failed to read certificate for ' + $Url + ': ' + $_.Exception.Message) -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Call-Url $esHealth
if ($ShowCert) { Show-Cert $ElasticsearchUrl }

Call-Url $apmCheck
Call-Url $kibStatus

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host ('verify-observability: starting checks') -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Call-Url {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host ('{0} -> HTTP {1}' -f $Url, $resp.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ('{0} -> ERROR: {1}' -f $Url, $_.Exception.Message) -ForegroundColor Red
    }
}

function Show-Cert {
    param([string]$Url)
    if ($Url -notlike 'https://*') { return }
    try {
        $u = New-Object System.Uri($Url)
        $host = $u.Host
        if ($u.Port -gt 0) { $port = $u.Port } else { $port = 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host ('Certificate Subject: {0}' -f $cert.Subject)
        Write-Host ('Certificate Issuer:  {0}' -f $cert.Issuer)
        Write-Host ('Thumbprint: {0}' -f $cert.Thumbprint)
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host ('Failed to read certificate for {0}: {1}' -f $Url, $_.Exception.Message) -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Call-Url -Url $esHealth -TimeoutSec 10
if ($ShowCert) { Show-Cert -Url $ElasticsearchUrl }

Call-Url -Url $apmCheck -TimeoutSec 5
Call-Url -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host ('verify-observability: starting checks') -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Call-Url {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host ('{0} -> HTTP {1}' -f $Url, $resp.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ('{0} -> ERROR: {1}' -f $Url, $_.Exception.Message) -ForegroundColor Red
    }
}

function Show-Cert {
    param([string]$Url)
    if ($Url -notlike 'https://*') { return }
    try {
        $u = New-Object System.Uri($Url)
        $host = $u.Host
        if ($u.Port -gt 0) { $port = $u.Port } else { $port = 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host ('Certificate Subject: {0}' -f $cert.Subject)
        Write-Host ('Certificate Issuer:  {0}' -f $cert.Issuer)
        Write-Host ('Thumbprint: {0}' -f $cert.Thumbprint)
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host ('Failed to read certificate for {0}: {1}' -f $Url, $_.Exception.Message) -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Call-Url -Url $esHealth -TimeoutSec 10
if ($ShowCert) { Show-Cert -Url $ElasticsearchUrl }

Call-Url -Url $apmCheck -TimeoutSec 5
Call-Url -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Call-Url {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host ('{0} -> HTTP {1}' -f $Url, $resp.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ('{0} -> ERROR: {1}' -f $Url, $_.Exception.Message) -ForegroundColor Red
    }
}

function Show-Cert {
    param([string]$Url)
    if ($Url -notlike 'https://*') { return }
    try {
        $u = New-Object System.Uri($Url)
        $host = $u.Host
        if ($u.Port -gt 0) { $port = $u.Port } else { $port = 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host ('Certificate Subject: {0}' -f $cert.Subject)
        Write-Host ('Certificate Issuer:  {0}' -f $cert.Issuer)
        Write-Host ('Thumbprint: {0}' -f $cert.Thumbprint)
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host ('Failed to read certificate for {0}: {1}' -f $Url, $_.Exception.Message) -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Call-Url -Url $esHealth -TimeoutSec 10
if ($ShowCert) { Show-Cert -Url $ElasticsearchUrl }

Call-Url -Url $apmCheck -TimeoutSec 5
Call-Url -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Call-Url {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host ("{0} -> HTTP {1}" -f $Url, $resp.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ("{0} -> ERROR: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Red
    }
}

function Show-Cert {
    param([string]$Url)
    if ($Url -notlike 'https://*') { return }
    try {
        $u = New-Object System.Uri($Url)
        $host = $u.Host
        if ($u.Port -gt 0) { $port = $u.Port } else { $port = 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host ("Certificate Subject: {0}" -f $cert.Subject)
        Write-Host ("Certificate Issuer:  {0}" -f $cert.Issuer)
        Write-Host ("Thumbprint: {0}" -f $cert.Thumbprint)
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host ("Failed to read certificate for {0}: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Call-Url -Url $esHealth -TimeoutSec 10
if ($ShowCert) { Show-Cert -Url $ElasticsearchUrl }

Call-Url -Url $apmCheck -TimeoutSec 5
Call-Url -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Call-Url {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host "$Url -> HTTP $($resp.StatusCode)" -ForegroundColor Green
    } catch {
        Write-Host "$Url -> ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Show-Cert {
    param([string]$Url)
    if ($Url -notlike 'https://*') { return }
    try {
        $u = New-Object System.Uri($Url)
        $host = $u.Host
        $port = if ($u.Port -gt 0) { $u.Port } else { 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host "Certificate Subject: $($cert.Subject)"
        Write-Host "Certificate Issuer:  $($cert.Issuer)"
        Write-Host "Thumbprint: $($cert.Thumbprint)"
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host "Failed to read certificate for $Url: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Call-Url -Url $esHealth -TimeoutSec 10
if ($ShowCert) { Show-Cert -Url $ElasticsearchUrl }

Call-Url -Url $apmCheck -TimeoutSec 5
Call-Url -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
    # Using ServicePointManager callback is sufficient for most PowerShell versions.
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

function Safe-Invoke {
    param([string]$Url, [int]$TimeoutSec = 10)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        return @{ ok = $true; status = $resp.StatusCode }
    } catch {
        return @{ ok = $false; err = $_.Exception.Message }
    }
}

function Print-CertInfo {
    param([string]$Url)
    if ($Url -notmatch '^https://') { return }
    try {
        $uri = [System.Uri]$Url
        $tcp = New-Object System.Net.Sockets.TcpClient($uri.Host, ($uri.Port -gt 0 ? $uri.Port : 443))
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($uri.Host)
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
        Write-Host "Certificate Subject: $($cert.Subject)"
        Write-Host "Certificate Issuer:  $($cert.Issuer)"
        Write-Host "Thumbprint: $($cert.Thumbprint)"
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host "Failed to read certificate for $Url: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

$r = Safe-Invoke -Url $esHealth -TimeoutSec 10
if ($r.ok) { Write-Host "$esHealth -> HTTP $($r.status)" -ForegroundColor Green } else { Write-Host "$esHealth -> ERROR: $($r.err)" -ForegroundColor Red }
if ($ShowCert) { Print-CertInfo -Url $ElasticsearchUrl }

$r = Safe-Invoke -Url $apmCheck -TimeoutSec 5
if ($r.ok) { Write-Host "$apmCheck -> HTTP $($r.status)" -ForegroundColor Green } else { Write-Host "$apmCheck -> ERROR: $($r.err)" -ForegroundColor Red }

$r = Safe-Invoke -Url $kibStatus -TimeoutSec 5
if ($r.ok) { Write-Host "$kibStatus -> HTTP $($r.status)" -ForegroundColor Green } else { Write-Host "$kibStatus -> ERROR: $($r.err)" -ForegroundColor Red }

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
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

function Get-CertificateInfo {
    param([string]$Url)
    try {
        $uri = [System.Uri]$Url
        if ($uri.Scheme -ne 'https') { return }
        $host = $uri.Host
        $port = if ($uri.Port -gt 0) { $uri.Port } else { 443 }
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($host, $port)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($host)
        $cert = $ssl.RemoteCertificate
        $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cert
        $ssl.Close(); $tcp.Close()
        return $x509
    } catch {
        Write-Host ("Failed to read certificate for {0}: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Yellow
    }
}

function Test-Endpoint {
    param([string]$Url, [int]$TimeoutSec = 10, [switch]$ShowCert)
    if ([string]::IsNullOrWhiteSpace($Url)) { Write-Host "<empty URL> -> SKIPPED" -ForegroundColor Yellow; return }
    if ($Url -notmatch '^[a-zA-Z]+://') { $Url = "http://$Url" }
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host ("{0} -> HTTP {1}" -f $Url, $r.StatusCode) -ForegroundColor Green
    } catch {
        Write-Host ("{0} -> ERROR: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Red
    }
    if ($ShowCert -and $Url -match '^https://') {
        $cert = Get-CertificateInfo -Url $Url
        if ($cert) {
            Write-Host ("Certificate Subject: {0}" -f $cert.Subject)
            Write-Host ("Certificate Issuer:  {0}" -f $cert.Issuer)
            Write-Host ("Thumbprint: {0}" -f $cert.Thumbprint)
        }
    }
}

$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

Test-Endpoint -Url $esHealth -TimeoutSec 10 -ShowCert:$ShowCert
Test-Endpoint -Url $apmCheck -TimeoutSec 5
Test-Endpoint -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
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

function Test-Endpoint {
    param(
        [Parameter(Mandatory=$true)] [string]$Url,
        [int]$TimeoutSec = 10,
        [switch]$ShowCert
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        Write-Host "<empty URL> -> SKIPPED" -ForegroundColor Yellow
        return
    }

    if ($Url -notmatch '^[a-zA-Z]+://') {
        $Url = "http://$Url"
    }

    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host "$Url -> HTTP $($r.StatusCode)" -ForegroundColor Green

        if ($ShowCert -and $Url -match '^https://') {
            try {
                $uri = [System.Uri]$Url
                $host = $uri.Host
                $port = if ($uri.Port -gt 0) { $uri.Port } else { if ($uri.Scheme -eq 'https') { 443 } else { 80 } }
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect($host, $port)
                $stream = $tcp.GetStream()
                $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
                $ssl.AuthenticateAsClient($host)
                $cert = $ssl.RemoteCertificate
                $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cert
                Write-Host ("Certificate Subject: {0}" -f $x509.Subject)
                Write-Host ("Certificate Issuer:  {0}" -f $x509.Issuer)
                Write-Host ("Certificate Thumbprint: {0}" -f $x509.Thumbprint)
                $ssl.Close()
                $tcp.Close()
            } catch {
                Write-Host ("Failed to read certificate for {0}: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    } catch {
        $err = $_.Exception
        if ($err -and $err.Response) {
            try { $status = ($err.Response).StatusCode.ToString() } catch { $status = '' }
            Write-Host ("{0} -> ERROR: {1} {2}" -f $Url, $err.Message, $status) -ForegroundColor Red
        } else {
            Write-Host ("{0} -> ERROR: {1}" -f $Url, $err.Message) -ForegroundColor Red
        }
    }
}

# Build endpoints
$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

# Test endpoints
Test-Endpoint -Url $esHealth -TimeoutSec 10 -ShowCert:$ShowCert
Test-Endpoint -Url $apmCheck -TimeoutSec 5
Test-Endpoint -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
Write-Host 'verify-observability test: script executed' -ForegroundColor Green
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
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

function Test-Endpoint {
    param(
        [Parameter(Mandatory=$true)] [string]$Url,
        [int]$TimeoutSec = 10,
        [switch]$ShowCert
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        Write-Host "<empty URL> -> SKIPPED" -ForegroundColor Yellow
        return
    }

    if ($Url -notmatch '^[a-zA-Z]+://') {
        $Url = "http://$Url"
    }

    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host "$Url -> HTTP $($r.StatusCode)" -ForegroundColor Green

        if ($ShowCert -and $Url -match '^https://') {
            try {
                $uri = [System.Uri]$Url
                $host = $uri.Host
                $port = if ($uri.Port -gt 0) { $uri.Port } else { if ($uri.Scheme -eq 'https') { 443 } else { 80 } }
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect($host, $port)
                $stream = $tcp.GetStream()
                $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
                $ssl.AuthenticateAsClient($host)
                $cert = $ssl.RemoteCertificate
                $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cert
                Write-Host ("Certificate Subject: {0}" -f $x509.Subject)
                Write-Host ("Certificate Issuer:  {0}" -f $x509.Issuer)
                Write-Host ("Certificate Thumbprint: {0}" -f $x509.Thumbprint)
                $ssl.Close()
                $tcp.Close()
            } catch {
                Write-Host ("Failed to read certificate for {0}: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    } catch {
        $err = $_.Exception
        if ($err -and $err.Response) {
            try { $status = ($err.Response).StatusCode.ToString() } catch { $status = '' }
            Write-Host ("{0} -> ERROR: {1} {2}" -f $Url, $err.Message, $status) -ForegroundColor Red
        } else {
            Write-Host ("{0} -> ERROR: {1}" -f $Url, $err.Message) -ForegroundColor Red
        }
    }
}

# Build endpoints
$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

# Test endpoints
Test-Endpoint -Url $esHealth -TimeoutSec 10 -ShowCert:$ShowCert
Test-Endpoint -Url $apmCheck -TimeoutSec 5
Test-Endpoint -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
Write-Host 'verify-observability test: script executed' -ForegroundColor Green

# If requested, disable certificate validation for this session (diagnostic only)
if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
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

function Test-Endpoint {
    param(
        [Parameter(Mandatory=$true)] [string]$Url,
        [int]$TimeoutSec = 10,
        [switch]$ShowCert
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        Write-Host "<empty URL> -> SKIPPED" -ForegroundColor Yellow
        return
    }
param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [string]$KibanaUrl = 'http://localhost:5601',
    [string]$ApmUrl = 'http://localhost:8200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host 'verify-observability: starting checks' -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this PowerShell session.'
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

function Test-Endpoint {
    param(
        [Parameter(Mandatory=$true)] [string]$Url,
        [int]$TimeoutSec = 10,
        [switch]$ShowCert
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        Write-Host "<empty URL> -> SKIPPED" -ForegroundColor Yellow
        return
    }

    if ($Url -notmatch '^[a-zA-Z]+://') {
        $Url = "http://$Url"
    }

    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        Write-Host "$Url -> HTTP $($r.StatusCode)" -ForegroundColor Green

        if ($ShowCert -and $Url -match '^https://') {
            try {
                $uri = [System.Uri]$Url
                $host = $uri.Host
                $port = if ($uri.Port -gt 0) { $uri.Port } else { if ($uri.Scheme -eq 'https') { 443 } else { 80 } }
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect($host, $port)
                $stream = $tcp.GetStream()
                $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
                $ssl.AuthenticateAsClient($host)
                $cert = $ssl.RemoteCertificate
                $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cert
                Write-Host ("Certificate Subject: {0}" -f $x509.Subject)
                Write-Host ("Certificate Issuer:  {0}" -f $x509.Issuer)
                Write-Host ("Certificate Thumbprint: {0}" -f $x509.Thumbprint)
                $ssl.Close()
                $tcp.Close()
            } catch {
                Write-Host ("Failed to read certificate for {0}: {1}" -f $Url, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    } catch {
        $err = $_.Exception
        if ($err -and $err.Response) {
            try { $status = ($err.Response).StatusCode.ToString() } catch { $status = '' }
            Write-Host ("{0} -> ERROR: {1} {2}" -f $Url, $err.Message, $status) -ForegroundColor Red
        } else {
            Write-Host ("{0} -> ERROR: {1}" -f $Url, $err.Message) -ForegroundColor Red
        }
    }
}

# Build endpoints
$esHealth = $ElasticsearchUrl.TrimEnd('/') + '/_cluster/health?pretty'
$apmCheck = $ApmUrl.TrimEnd('/') + '/'
$kibStatus = $KibanaUrl.TrimEnd('/') + '/api/status'

# Test endpoints
Test-Endpoint -Url $esHealth -TimeoutSec 10 -ShowCert:$ShowCert
Test-Endpoint -Url $apmCheck -TimeoutSec 5
Test-Endpoint -Url $kibStatus -TimeoutSec 5

Write-Host 'Verification complete.' -ForegroundColor Cyan
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { param($s,$c,$ch,$e) [TrustAllCertsPolicy]::Validate($s,$c,$ch,$e) }
