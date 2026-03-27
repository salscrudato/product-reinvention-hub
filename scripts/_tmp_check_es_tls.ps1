[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
Add-Type -TypeDefinition @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll { public static bool AcceptAll(object s, X509Certificate c, X509Chain ch, System.Net.Security.SslPolicyErrors e){ return true; } }
"@
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { param($s,$c,$ch,$e) [TrustAll]::AcceptAll($s,$c,$ch,$e) }

try {
    $r = Invoke-WebRequest -Uri 'https://localhost:9200/_cluster/health?pretty' -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    Write-Host '--- Status Code:' $r.StatusCode
    Write-Host '--- Headers:'
    $r.Headers | Format-List
    Write-Host '--- Body:'
    $r.Content
} catch {
    Write-Host 'Request failed:' $_.Exception.Message -ForegroundColor Red
}
