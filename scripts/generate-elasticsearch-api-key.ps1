# Generate an Elasticsearch API key for Kibana/APM usage
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-elasticsearch-api-key.ps1

$ElasticUser = "elastic"
$ElasticPass = "lBVNVUECDFcOFZ3f6joX"
$ApiKeyName = "kibana-apm-key"


$Body = @{
  name = $ApiKeyName
  role_descriptors = @{
    all_access = @{
      cluster = @("all")
      index = @(@{
        names = @("*")
        privileges = @("all")
      })
    }
  }
} | ConvertTo-Json -Depth 5

$Headers = @{ "Content-Type" = "application/json" }

# Ignore SSL errors for self-signed certs
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}

$uri = "https://localhost:9200/_security/api_key"

$response = Invoke-RestMethod -Uri $uri -Method Post -Headers $Headers -Body $Body -Credential (New-Object System.Management.Automation.PSCredential($ElasticUser,(ConvertTo-SecureString $ElasticPass -AsPlainText -Force)))

Write-Host "API Key Response:" -ForegroundColor Cyan
$response | ConvertTo-Json -Depth 5
