<#
Adds 'prompt_admin' role and assigns it to specified users in an existing Keycloak realm.
Usage:
  pwsh ./keycloak/update_prompt_admin_role.ps1 -Realm devpilot -Users dev1,po1 -AdminUser admin -AdminPassword admin
#>
param(
  [string]$BaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$AdminUser = $env:KC_ADMIN,
  [string]$AdminPassword = $env:KC_ADMIN_PASSWORD,
  [string[]]$Users = @('dev1'),
  [switch]$VerboseMode
)
if (-not $AdminUser -or -not $AdminPassword){ Write-Error 'Admin credentials required.'; exit 1 }
$tokenResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/realms/master/protocol/openid-connect/token" -Body @{client_id='admin-cli';grant_type='password';username=$AdminUser;password=$AdminPassword} -ContentType 'application/x-www-form-urlencoded'
$accessToken = $tokenResp.access_token
if (-not $accessToken){ Write-Error 'Failed to obtain admin token'; exit 1 }
function Invoke-Keycloak { param([string]$Method,[string]$Url,$Body=$null,[int[]]$Expected=@(200,201,204))
  $headers=@{'Authorization'="Bearer $accessToken";'Content-Type'='application/json'}
  try { if($Body -and $Method -ne 'GET'){ $json=$Body|ConvertTo-Json -Depth 12; $r=Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -Body $json -ErrorAction Stop; return @{Status=200;Body=$r} } else { $r=Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ErrorAction Stop; return @{Status=200;Body=$r} }} catch { $we=$_.Exception.Response; if($we){ $code=$we.StatusCode.value__; if($code -in $Expected){ return @{Status=$code;Body=$null} }; $stream=$we.GetResponseStream(); $reader=New-Object IO.StreamReader($stream); $txt=$reader.ReadToEnd(); return @{Status=$code;Error=$txt} }; throw }
}
function Ensure-Role($RoleName){ $r=Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$Realm/roles/$RoleName"; if($r.Status -eq 200){ if($VerboseMode){Write-Host "Role $RoleName exists"}; return }; Write-Host "Creating role $RoleName" -ForegroundColor Yellow; Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms/$Realm/roles" -Body @{name=$RoleName} | Out-Null }
Ensure-Role 'prompt_admin'
foreach($u in $Users){
  $resp=Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$Realm/users?username=$u"; if(-not $resp.Body -or $resp.Body.Count -eq 0){ Write-Warning "User $u not found"; continue }; $id=$resp.Body[0].id
  $role=Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$Realm/roles/prompt_admin"; if(-not $role.Body){ Write-Warning 'prompt_admin role retrieval failed'; continue }
  $existing=Invoke-Keycloak -Method GET -Url "$BaseUrl/admin/realms/$Realm/users/$id/role-mappings/realm"; $has=$false; if($existing.Body){ $has = $existing.Body.name -contains 'prompt_admin' }
  if(-not $has){ Write-Host "Assigning prompt_admin -> $u" -ForegroundColor Green; Invoke-Keycloak -Method POST -Url "$BaseUrl/admin/realms/$Realm/users/$id/role-mappings/realm" -Body @(@{id=$role.Body.id;name=$role.Body.name}) | Out-Null } else { if($VerboseMode){Write-Host "User $u already has prompt_admin"} }
}
Write-Host "prompt_admin role assignment complete" -ForegroundColor Green