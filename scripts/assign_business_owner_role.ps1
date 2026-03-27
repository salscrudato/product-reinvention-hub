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
$role = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/roles/business_owner" -Headers $headers
$userSearch = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users?username=$([System.Uri]::EscapeDataString($Username))" -Headers $headers
if (-not $userSearch -or $userSearch.Count -eq 0) {
  Write-Error "User $Username not found."
  exit 1
}

$userId = $userSearch[0].id
$roleJson = (@(@{
    id = $role.id
    name = $role.name
    description = $role.description
    composite = $role.composite
    clientRole = $role.clientRole
    containerId = $role.containerId
  }) | ConvertTo-Json -Depth 6)
Write-Host "Attempting role assignment with payload:`n$roleJson" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/realms/$Realm/users/$userId/role-mappings/realm" -Headers $headers -ContentType 'application/json' -Body $roleJson -ErrorAction Stop | Out-Null
  Write-Host 'Role assignment succeeded.' -ForegroundColor Green
} catch {
  Write-Warning "Role assignment failed: $($_.Exception.Message)"
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $responseContent = $reader.ReadToEnd()
      $reader.Dispose()
      if ($responseContent) { Write-Warning "Response content: $responseContent" }
    } catch {}
  }
  if ($_.Exception.Response) {
    Write-Warning "Status: $([int]$_.Exception.Response.StatusCode) $($_.Exception.Response.StatusDescription)"
  }
}
