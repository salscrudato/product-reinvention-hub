param(
    [string]$ElasticsearchUrl = 'https://localhost:9200',
    [switch]$ShowCert = $false,
    [switch]$SkipCertificateValidation = $false
)

Write-Host "=== Elasticsearch Check: $ElasticsearchUrl ===" -ForegroundColor Cyan

if ($SkipCertificateValidation) {
    Write-Warning 'Skipping TLS certificate validation for this session.'
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

    try {
        if ($ElasticsearchUrl -match '^https://') {
            try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 } catch {}
        }
        $health = Invoke-RestMethod -Uri ($ElasticsearchUrl.TrimEnd('/') + '/_cluster/health') -UseBasicParsing -ErrorAction Stop
        Write-Host "Cluster status: $($health.status)" -ForegroundColor Green
    } catch {
        Write-Host "Elasticsearch error: $($_.Exception.Message)" -ForegroundColor Red
    }

if ($ShowCert -and $ElasticsearchUrl -match '^https://') {
    try {
        $uri = [System.Uri]$ElasticsearchUrl
        $esHost = $uri.Host
        $esPort = if ($uri.Port -gt 0) { $uri.Port } else { 9200 }
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($esHost, $esPort)
        $stream = $tcp.GetStream()
        $ssl = New-Object System.Net.Security.SslStream($stream, $false, ({ $true }))
        $ssl.AuthenticateAsClient($esHost)
        $cert = $ssl.RemoteCertificate
        $x509 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cert
        Write-Host ("Certificate Subject: {0}" -f $x509.Subject)
        Write-Host ("Certificate Issuer:  {0}" -f $x509.Issuer)
        Write-Host ("Certificate Thumbprint: {0}" -f $x509.Thumbprint)
        $ssl.Close(); $tcp.Close()
    } catch {
        Write-Host "Failed to read ES certificate: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "=== Elasticsearch Check Complete ===`n" -ForegroundColor Cyan
