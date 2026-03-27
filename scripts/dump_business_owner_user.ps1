param(
  [string]$BaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$AdminUser = 'admin',
  [System.Security.SecureString]$AdminPassword = (ConvertTo-SecureString 'admin' -AsPlainText -Force),
  [string]$Username = 'business.owner@example.com'
)

$plainAdminPassword = [System.Net.NetworkCredential]::new('', $AdminPassword).Password

$tokenResponse = Invoke-RestMethod -Method Post -Uri "$BaseUrl/realms/master/protocol/openid-connect/token" -Body @{
  client_id = 'admin-cli'
  grant_type = 'password'
  username = $AdminUser
  password = $plainAdminPassword
} -ContentType 'application/x-www-form-urlencoded'

if (-not $tokenResponse.access_token) {
  Write-Error 'Failed to get admin token.'
  exit 1
}

$headers = @{ Authorization = "Bearer $($tokenResponse.access_token)" }
$userSearch = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users?username=$([System.Uri]::EscapeDataString($Username))" -Headers $headers
if (-not $userSearch -or $userSearch.Count -eq 0) {
  Write-Error "User $Username not found."
  exit 1
}

$userId = $userSearch[0].id
$userDetails = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users/$userId" -Headers $headers
$credentials = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users/$userId/credentials" -Headers $headers
[PSCustomObject]@{
  user = $userDetails
  credentials = $credentials
} | ConvertTo-Json -Depth 10
