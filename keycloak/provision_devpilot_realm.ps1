<#
Provision a separate Keycloak realm 'devpilot' WITHOUT touching existing realms.
Creates realm, roles (developer, product_owner, engineering_lead), client 'devpilot-frontend',
and users: dev1, po1, el1 (password DevPass123!). Idempotent.

Usage:
  pwsh ./keycloak/provision_devpilot_realm.ps1 -AdminUser admin -AdminPassword admin

Parameters can also come from env vars KC_ADMIN / KC_ADMIN_PASSWORD.
#>
param(
  [string]$BaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$ClientId = 'devpilot-frontend',
  [string]$AdminUser = $env:KC_ADMIN,
  [string]$AdminPassword = $env:KC_ADMIN_PASSWORD,
  [string]$UserPassword = 'DevPass123!',
  # Additional allowed frontend ports (default includes legacy 3000 + new 8081)
  [int[]]$FrontendPorts = @(3000,8081),
  [switch]$VerboseMode
)

if (-not $AdminUser -or -not $AdminPassword) {
  Write-Error 'Admin credentials required (set KC_ADMIN / KC_ADMIN_PASSWORD or use parameters).'
  exit 1
}

function Invoke-Keycloak {
  param([string]$Method,[string]$Url,$Body=$null,[string]$Token=$null,[int[]]$Expected=@(200,201,204))
  $headers = @{'Content-Type'='application/json'}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  if ($VerboseMode) { Write-Host "[$Method] $Url" -ForegroundColor Cyan }
  try {
    if ($Body -and $Method -ne 'GET') {
      $json = $Body | ConvertTo-Json -Depth 12
      $resp = Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -Body $json -ErrorAction Stop
      return @{Status=200;Body=$resp}
    } else {
      $resp = Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ErrorAction Stop
      return @{Status=200;Body=$resp}
    }
  } catch {
    $we = $_.Exception.Response
    if ($we) {
      $code = $we.StatusCode.value__
      if ($code -in $Expected) { return @{Status=$code;Body=$null} }
      $stream = $we.GetResponseStream(); $reader = New-Object IO.StreamReader($stream); $txt=$reader.ReadToEnd()
      return @{Status=$code;Error=$txt}
    }
    throw $_
  }
}

# Obtain admin token
$tokenResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/realms/master/protocol/openid-connect/token" -Body @{
  client_id='admin-cli';grant_type='password';username=$AdminUser;password=$AdminPassword
} -ContentType 'application/x-www-form-urlencoded'
$accessToken = $tokenResp.access_token
if (-not $accessToken) { Write-Error 'Failed to obtain admin token.'; exit 1 }

function Ensure-Realm($Name) {
  $r = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$Name" -Token $accessToken -Expected 200
  if ($r.Status -eq 200) { Write-Host "Realm '$Name' exists"; return }
  Write-Host "Creating realm '$Name'" -ForegroundColor Yellow
  $c = Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms" -Token $accessToken -Body @{realm=$Name;enabled=$true} -Expected 201
  if ($c.Status -ne 201) { Write-Error ("Failed to create realm {0}: {1}" -f $Name, $c.Error); exit 1 }
}

function Ensure-Role($RealmName,$RoleName){
  $r = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/roles/$RoleName" -Token $accessToken -Expected 200
  if ($r.Status -eq 200) { Write-Host "Role '$RoleName' exists"; return }
  Write-Host "Creating role '$RoleName'"
  Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms/$RealmName/roles" -Token $accessToken -Body @{name=$RoleName} -Expected 201 | Out-Null
}

function Ensure-Client($RealmName,$Cid){
  $cl = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/clients?clientId=$Cid" -Token $accessToken
  if ($cl.Body -and $cl.Body.Count -gt 0) {
    $client = $cl.Body[0]
    Write-Host "Client '$Cid' exists";
    # Ensure alternate ports are present in redirectUris/webOrigins
    $desiredRedirects = @()
    $desiredOrigins = @()
    foreach ($p in $FrontendPorts) {
      $desiredRedirects += "http://localhost:$p/*"
      $desiredOrigins += "http://localhost:$p"
    }
    $missingRedirects = $desiredRedirects | Where-Object { $client.redirectUris -notcontains $_ }
    $missingOrigins   = $desiredOrigins   | Where-Object { $client.webOrigins   -notcontains $_ }
    if ($missingRedirects -or $missingOrigins) {
      Write-Host "Updating client to add redirect/web origins for ports: $($FrontendPorts -join ',')" -ForegroundColor Yellow
      $mergedRedirects = ($client.redirectUris + $missingRedirects | Select-Object -Unique)
      $mergedOrigins   = ($client.webOrigins + $missingOrigins | Select-Object -Unique)
      $updateBody = @{ id=$client.id; clientId=$client.clientId; redirectUris=$mergedRedirects; webOrigins=$mergedOrigins }
      # Best-effort update (ignore failure if lacking fields; admin token should permit)
      $u = Invoke-Keycloak -Method PUT -Url "$BaseUrl/admin/realms/$RealmName/clients/$($client.id)" -Token $accessToken -Body $updateBody -Expected 204
      if ($u.Status -eq 204) { Write-Host "Client redirectUris/webOrigins updated." -ForegroundColor Green } else { Write-Warning "Failed to update client redirect URIs (status=$($u.Status))." }
    }
    return $client.id
  }
  Write-Host "Creating client '$Cid'"
  $redirects = @()
  $origins = @()
  foreach ($p in $FrontendPorts) { $redirects += "http://localhost:$p/*"; $origins += "http://localhost:$p" }
  $body = @{ clientId=$Cid; publicClient=$true; protocol='openid-connect'; standardFlowEnabled=$true; directAccessGrantsEnabled=$true; redirectUris=$redirects; webOrigins=$origins; attributes=@{'pkce.code.challenge.method'='S256'} }
  $c = Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms/$RealmName/clients" -Token $accessToken -Body $body -Expected 201
  if ($c.Status -ne 201) { Write-Error ("Client create failed: {0}" -f $c.Error) }
  $cl2 = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/clients?clientId=$Cid" -Token $accessToken
  return $cl2.Body[0].id
}

function Ensure-User($RealmName,$Username,$Password,$RealmRoles){
  $u = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/users?username=$Username" -Token $accessToken
  if ($u.Body -and $u.Body.Count -gt 0) { $id=$u.Body[0].id; Write-Host "User '$Username' exists" }
  else {
    Write-Host "Creating user '$Username'"
    Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms/$RealmName/users" -Token $accessToken -Body @{username=$Username;enabled=$true;email="$Username@devpilot.test";emailVerified=$true} -Expected 201 | Out-Null
    $u = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/users?username=$Username" -Token $accessToken
    $id=$u.Body[0].id
  }
  Write-Host "Setting password for '$Username'"
  Invoke-Keycloak -Method PUT -Url "$BaseUrl/admin/realms/$RealmName/users/$id/reset-password" -Token $accessToken -Body @{type='password';value=$Password;temporary=$false} -Expected 204 | Out-Null
  # Explicitly clear required actions so direct grant / password flow works without UI challenges
  Write-Host "Clearing required actions for '$Username' (if any)"
  Invoke-Keycloak -Method PUT -Url "$BaseUrl/admin/realms/$RealmName/users/$id" -Token $accessToken -Body @{id=$id;enabled=$true;emailVerified=$true;requiredActions=@()} -Expected 204 | Out-Null
  foreach ($rr in $RealmRoles) {
    $role = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/roles/$rr" -Token $accessToken
    if (-not $role.Body) { Write-Warning "Role $rr missing"; continue }
    $existing = Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$RealmName/users/$id/role-mappings/realm" -Token $accessToken
    $already = $false
    if ($existing.Body) { $already = $existing.Body.name -contains $rr }
    if (-not $already) {
      Write-Host "Assigning role '$rr' -> '$Username'"
      Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms/$RealmName/users/$id/role-mappings/realm" -Token $accessToken -Body @(@{id=$role.Body.id;name=$role.Body.name}) | Out-Null
    }
  }
}

Write-Host "--- Provisioning devpilot realm ---" -ForegroundColor Green
Ensure-Realm $Realm
Ensure-Role $Realm 'developer'
Ensure-Role $Realm 'product_owner'
Ensure-Role $Realm 'engineering_lead'
Ensure-Role $Realm 'prompt_admin'
$clientIdCreated = Ensure-Client $Realm $ClientId
Ensure-User $Realm 'dev1' $UserPassword @('developer','prompt_admin')
Ensure-User $Realm 'po1'  $UserPassword @('product_owner')
Ensure-User $Realm 'el1'  $UserPassword @('engineering_lead')
Ensure-User $Realm 'snow_admin' 'SnowPass123!' @('developer')
Write-Host "Provisioning complete (realm=$Realm client=$ClientId)." -ForegroundColor Green
