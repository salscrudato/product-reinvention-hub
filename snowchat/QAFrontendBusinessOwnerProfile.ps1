<#!
QAFrontendBusinessOwnerProfile.ps1

Bootstrap a QA persona session for Business Owner login governance validation.
Sets environment variables for the frontend, ensures the persona exists in Keycloak,
retrieves a token for business.owner@example.com, and optionally invokes the SnowChat
agentic API to retrieve a plan receipt.
#>
[CmdletBinding()]
param(
  [string]$KeycloakBaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$ClientId = 'devpilot-frontend',
  [string]$BackendBaseUrl = 'http://localhost:5001',
  [int]$FrontendPort = 3000,
  [string]$Username = 'business.owner@example.com',
  [System.Security.SecureString]$Password = (ConvertTo-SecureString 'OwnerPass123!' -AsPlainText -Force),
  [string]$ProfilePath = '.qa.business.owner.profile.json',
  [switch]$RunPlan,
  [string]$PlanQuestion = 'Audit login governance for IN-201 entitlements',
  [string]$PlanIntent = 'login_governance',
  [string]$JiraIssueKey = 'IN-201',
  [string]$TelemetryWindow = '14',
  [switch]$SkipFrontendStart,
  [switch]$NoBrowser,
  [string]$KeycloakAdminUser = $(if ($env:KC_ADMIN) { $env:KC_ADMIN } else { 'admin' }),
  [System.Security.SecureString]$KeycloakAdminPassword = $(if ($env:KC_ADMIN_PASSWORD) { ConvertTo-SecureString $env:KC_ADMIN_PASSWORD -AsPlainText -Force } else { ConvertTo-SecureString 'admin' -AsPlainText -Force }),
  [switch]$SkipUserProvision,
  [switch]$VerboseLogs
)

if ($VerboseLogs) { $VerbosePreference = 'Continue' }

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

function Test-ServiceUp {
  param([string]$Url,[int]$TimeoutSec=40)
  $start = Get-Date
  while ((Get-Date) -lt $start.AddSeconds($TimeoutSec)) {
    try {
      Invoke-WebRequest -Method Head -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  return $false
}

function Get-KeycloakToken {
  param([string]$BaseUrl,[string]$Realm,[string]$ClientId,[string]$User,[System.Security.SecureString]$Password)
  $tokenEndpoint = "$BaseUrl/realms/$Realm/protocol/openid-connect/token"
  $plain = [System.Net.NetworkCredential]::new('', $Password).Password
  $body = "client_id=$ClientId&grant_type=password&username=$User&password=$plain"
  try {
    (Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType 'application/x-www-form-urlencoded').access_token
  } catch {
    Write-Err "Failed to obtain token: $($_.Exception.Message)"
    throw
  }
}

function ConvertFrom-JwtPayload {
  param([string]$Token)
  if (-not $Token) { return @{} }
  $parts = $Token.Split('.')
  if ($parts.Length -lt 2) { return @{} }
  $padded = $parts[1].PadRight(($parts[1].Length + 3) - (($parts[1].Length + 3) % 4), '=')
  try {
    ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($padded.Replace('-', '+').Replace('_', '/'))) | ConvertFrom-Json)
  } catch {
    @{}
  }
}

function Set-FrontendEnv {
  param([string]$BaseUrl,[string]$Realm,[string]$ClientId,[string]$Backend,[string]$LoginHint='')
  Write-Info 'Exporting frontend environment variables (process scope)...'
  $env:REACT_APP_KEYCLOAK_URL = $BaseUrl.TrimEnd('/')
  $env:REACT_APP_KEYCLOAK_REALM = $Realm
  $env:REACT_APP_KEYCLOAK_CLIENT_ID = $ClientId
  $env:REACT_APP_BACKEND_BASE = $Backend.TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($LoginHint)) {
    Remove-Item Env:REACT_APP_KEYCLOAK_LOGIN_HINT -ErrorAction SilentlyContinue
  } else {
    $env:REACT_APP_KEYCLOAK_LOGIN_HINT = $LoginHint
  }
  Write-Host "  REACT_APP_KEYCLOAK_URL       = $env:REACT_APP_KEYCLOAK_URL" -ForegroundColor DarkGray
  Write-Host "  REACT_APP_KEYCLOAK_REALM     = $env:REACT_APP_KEYCLOAK_REALM" -ForegroundColor DarkGray
  Write-Host "  REACT_APP_KEYCLOAK_CLIENT_ID = $env:REACT_APP_KEYCLOAK_CLIENT_ID" -ForegroundColor DarkGray
  Write-Host "  REACT_APP_BACKEND_BASE       = $env:REACT_APP_BACKEND_BASE" -ForegroundColor DarkGray
  if (-not [string]::IsNullOrWhiteSpace($LoginHint)) {
    Write-Host "  REACT_APP_KEYCLOAK_LOGIN_HINT = $env:REACT_APP_KEYCLOAK_LOGIN_HINT" -ForegroundColor DarkGray
  } else {
    Write-Host '  REACT_APP_KEYCLOAK_LOGIN_HINT = <cleared>' -ForegroundColor DarkGray
  }
}

function Set-QABusinessOwnerUser {
  param(
    [string]$BaseUrl,
    [string]$Realm,
    [string]$Username,
    [System.Security.SecureString]$Password,
    [string]$AdminUser,
    [System.Security.SecureString]$AdminPassword
  )
  $plainPassword = [System.Net.NetworkCredential]::new('', $Password).Password
  $plainAdminPassword = [System.Net.NetworkCredential]::new('', $AdminPassword).Password
  if (-not $AdminUser -or -not $AdminPassword) {
    Write-Warn 'Admin credentials not provided; skipping Keycloak user provisioning.'
    return $false
  }
  try {
    $tokenResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/realms/master/protocol/openid-connect/token" -Body @{
      client_id='admin-cli'; grant_type='password'; username=$AdminUser; password=$plainAdminPassword
    } -ContentType 'application/x-www-form-urlencoded'
  } catch {
    Write-Warn "Unable to obtain Keycloak admin token: $($_.Exception.Message)"
    return $false
  }
  $adminToken = $tokenResp.access_token
  if (-not $adminToken) {
    Write-Warn 'Admin token acquisition returned empty payload; cannot provision user.'
    return $false
  }
  $authHeader = @{ Authorization = "Bearer $adminToken" }
  $jsonHeader = @{ Authorization = "Bearer $adminToken"; 'Content-Type' = 'application/json' }

  $roleName = 'business_owner'
  $role = $null
  try {
    $role = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/roles/$roleName" -Headers $authHeader -ErrorAction Stop
  } catch {
    Write-Info "Creating Keycloak realm role '$roleName'"
    $roleBody = @{ name = $roleName; description = 'Business owner persona role' }
    try { Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/realms/$Realm/roles" -Headers $jsonHeader -Body ($roleBody | ConvertTo-Json -Depth 4) | Out-Null } catch {}
    try { $role = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/roles/$roleName" -Headers $authHeader -ErrorAction Stop } catch { $role = $null }
  }

  $encodedUsername = [System.Uri]::EscapeDataString($Username)
  try {
    $existingUsers = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users?username=$encodedUsername" -Headers $authHeader -ErrorAction Stop
  } catch {
    Write-Warn "Failed querying Keycloak users: $($_.Exception.Message)"
    return $false
  }
  if ($existingUsers -and $existingUsers.Count -gt 0) {
    $userId = $existingUsers[0].id
    Write-Info "Keycloak user '$Username' already exists; ensuring password, role, and required actions."
  } else {
    $email = if ($Username -like '*@*') { $Username } else { "$Username@devpilot.test" }
    $createBody = @{
      username = $Username
      enabled = $true
      email = $email
      emailVerified = $true
      firstName = 'Business'
      lastName = 'Owner'
    }
    Write-Info "Creating Keycloak user '$Username'"
    try {
      Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/realms/$Realm/users" -Headers $jsonHeader -Body ($createBody | ConvertTo-Json -Depth 6) -ErrorAction Stop | Out-Null
    } catch {
      Write-Warn "Failed to create Keycloak user '$Username': $($_.Exception.Message)"
      return $false
    }
    try {
      $existingUsers = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users?username=$encodedUsername" -Headers $authHeader -ErrorAction Stop
    } catch {
      Write-Warn "Unable to verify user creation for '$Username': $($_.Exception.Message)"
      return $false
    }
    if (-not $existingUsers -or $existingUsers.Count -eq 0) {
      Write-Warn "Keycloak user '$Username' not found after creation attempt."
      return $false
    }
    $userId = $existingUsers[0].id
  }

  try {
    $userDetails = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users/$userId" -Headers $authHeader -ErrorAction Stop
  } catch {
    Write-Warn "Failed to retrieve user details for '$Username': $($_.Exception.Message)"
    $userDetails = $null
  }

  if ($userDetails) {
    $requiredActionsText = if ($userDetails.requiredActions -and $userDetails.requiredActions.Count -gt 0) {
      $userDetails.requiredActions -join ', '
    } else { '<none>' }
    Write-Verbose ("User '$Username' required actions before update: $requiredActionsText")
    Write-Verbose ("User '$Username' emailVerified=$($userDetails.emailVerified) enabled=$($userDetails.enabled)")
  $emailValue = if ($userDetails.email) { $userDetails.email } else { $Username }
  $firstNameValue = if ($userDetails.firstName) { $userDetails.firstName } else { 'Business' }
  $lastNameValue = if ($userDetails.lastName) { $userDetails.lastName } else { 'Owner' }
    Write-Info "Ensuring metadata for '$Username' (emailVerified, enabled, required actions cleared)."
    $updateUserBody = [ordered]@{
      id = $userId
      username = $userDetails.username
      email = $emailValue
      emailVerified = $true
      enabled = $true
      requiredActions = @()
      firstName = $firstNameValue
      lastName = $lastNameValue
    }
    if ($userDetails.attributes) { $updateUserBody.attributes = $userDetails.attributes }
    try {
      Invoke-RestMethod -Method Put -Uri "$BaseUrl/admin/realms/$Realm/users/$userId" -Headers $jsonHeader -Body ($updateUserBody | ConvertTo-Json -Depth 8) -ErrorAction Stop | Out-Null
    } catch {
      $responseMsg = $_.Exception.Message
      if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
        try {
          $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
          $responseMsg = $reader.ReadToEnd()
          $reader.Dispose()
        } catch {}
      }
      Write-Warn "Failed to update user metadata for '$Username': $responseMsg"
    }
  }

  $passwordBody = @{ type='password'; value=$plainPassword; temporary=$false }
  try {
    Invoke-RestMethod -Method Put -Uri "$BaseUrl/admin/realms/$Realm/users/$userId/reset-password" -Headers $jsonHeader -Body ($passwordBody | ConvertTo-Json -Depth 4) -ErrorAction Stop | Out-Null
  } catch {
    Write-Warn "Failed to set password for '$Username': $($_.Exception.Message)"
  }

  if ($role) {
    Write-Verbose ("Role '$roleName' resolved: id=$($role.id) composite=$($role.composite) container=$($role.containerId)")
    try {
      $currentRoles = Invoke-RestMethod -Method Get -Uri "$BaseUrl/admin/realms/$Realm/users/$userId/role-mappings/realm" -Headers $authHeader -ErrorAction Stop
    } catch { $currentRoles = @() }
  $assignedRoleNames = @()
  if ($currentRoles) { $assignedRoleNames = $currentRoles | ForEach-Object { $_.name } }
  $rolesDisplay = if ($assignedRoleNames.Count -gt 0) { $assignedRoleNames -join ', ' } else { '<none>' }
  Write-Verbose "Existing realm roles for '$Username': $rolesDisplay"
    $alreadyAssigned = $assignedRoleNames -contains $role.name
    if (-not $alreadyAssigned) {
      try {
        $roleJson = (@($role) | ConvertTo-Json -Depth 6)
        Write-Verbose ("Assigning role payload: $roleJson")
        Invoke-RestMethod -Method Post -Uri "$BaseUrl/admin/realms/$Realm/users/$userId/role-mappings/realm" -Headers $jsonHeader -Body $roleJson -ErrorAction Stop | Out-Null
      } catch {
        $responseMsg = $_.Exception.Message
        if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
          try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseMsg = $reader.ReadToEnd()
            $reader.Dispose()
          } catch {}
        }
        Write-Warn "Failed to assign role '$roleName' to '$Username': $responseMsg"
      }
    }
  }

  Write-Info "Business owner persona ensured for user '$Username'."
  return $true
}

function Start-Frontend {
  param([string]$FrontendDir,[int]$Port)
  if (-not (Test-Path (Join-Path $FrontendDir 'package.json'))) {
    Write-Warn "package.json not found in $FrontendDir"
    return
  }
  Write-Info 'Starting React dev server (background job)...'
  Start-Job -Name QABusinessOwnerFrontend -ScriptBlock { param($Dir,$Port) Set-Location $Dir; $env:PORT=$Port; npm start 2>&1 | Write-Host } -ArgumentList $FrontendDir,$Port | Out-Null
  Write-Info 'Waiting up to 60s for frontend to respond...'
  if (Test-ServiceUp -Url "http://localhost:$Port" -TimeoutSec 60) { Write-Info 'Frontend is responding.' } else { Write-Warn 'Frontend not reachable yet; it may still be compiling.' }
}

Write-Info "QA Business Owner bootstrap (realm=$Realm user=$Username)"

if (-not (Test-ServiceUp -Url $KeycloakBaseUrl -TimeoutSec 40)) {
  Write-Warn "Keycloak not reachable at $KeycloakBaseUrl"
}
if (-not (Test-ServiceUp -Url "$BackendBaseUrl/healthz" -TimeoutSec 40)) {
  Write-Warn "Backend not reachable at $BackendBaseUrl/healthz"
}

Set-FrontendEnv -BaseUrl $KeycloakBaseUrl -Realm $Realm -ClientId $ClientId -Backend $BackendBaseUrl -LoginHint $Username

if (-not $SkipUserProvision) {
  $ensured = Set-QABusinessOwnerUser -BaseUrl $KeycloakBaseUrl -Realm $Realm -Username $Username -Password $Password -AdminUser $KeycloakAdminUser -AdminPassword $KeycloakAdminPassword
  if (-not $ensured) {
    Write-Warn 'Keycloak user provisioning did not complete successfully; token request may fail if the user does not exist.'
  }
} else {
  Write-Info 'SkipUserProvision set; assuming persona user already exists.'
}

$token = Get-KeycloakToken -BaseUrl $KeycloakBaseUrl -Realm $Realm -ClientId $ClientId -User $Username -Password $Password
Write-Info "Access token acquired (length=$($token.Length))."
$claims = ConvertFrom-JwtPayload -Token $token

$personaProfile = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  persona = 'business_owner'
  realm = $Realm
  keycloak_url = $KeycloakBaseUrl
  client_id = $ClientId
  username = $Username
  roles = $claims.realm_access.roles
  plan_intent = $PlanIntent
  jira_issue_key = $JiraIssueKey
  telemetry_window = $TelemetryWindow
  frontend_env = @{realm=$Realm; client=$ClientId; keycloak=$KeycloakBaseUrl; backend=$BackendBaseUrl}
}
$personaProfile | ConvertTo-Json -Depth 6 | Out-File -FilePath $ProfilePath -Encoding UTF8
Write-Info "Profile stored at $ProfilePath"

if ($RunPlan) {
  $metadata = @{ intent = $PlanIntent; persona = 'business_owner' }
  if ($JiraIssueKey) { $metadata.jira_issue_key = $JiraIssueKey }
  if ($TelemetryWindow) { $metadata.telemetry_window = $TelemetryWindow }
  $payload = @{
    prompt = $PlanQuestion
    messages = @(@{ role = 'user'; content = $PlanQuestion })
    metadata = $metadata
    username = $Username
  }
  $body = $payload | ConvertTo-Json -Depth 6
  Write-Info "Requesting plan receipt from SnowChat..."
  try {
    $headers = @{ Authorization = "Bearer $token" }
    $response = Invoke-RestMethod -Method Post -Uri "$BackendBaseUrl/agentic_orchestrate_auto" -Headers $headers -ContentType 'application/json' -Body $body
    $receiptPath = 'qa.login_governance.receipt.json'
    $response | ConvertTo-Json -Depth 6 | Out-File -FilePath $receiptPath -Encoding UTF8
    Write-Info "Plan response stored at $receiptPath"
    $finalAnswer = $response.final_answer
    if ($finalAnswer) { Write-Host "Plan Summary:`n$finalAnswer" -ForegroundColor Green }
  } catch {
    Write-Err "Failed to invoke plan: $($_.Exception.Message)"
  }
}

$env:PORT = $FrontendPort
if (-not $SkipFrontendStart) {
  $frontendDir = Join-Path $PSScriptRoot 'frontend'
  Start-Frontend -FrontendDir $frontendDir -Port $FrontendPort
}

if (-not $NoBrowser) {
  Write-Info "Opening http://localhost:$FrontendPort in browser..."
  Start-Process "http://localhost:$FrontendPort"
}

Write-Host "\nQA Business Owner environment ready." -ForegroundColor Green
Write-Host "Token roles: $($claims.realm_access.roles -join ', ')" -ForegroundColor DarkCyan
