<#!
DevSnow.ps1

Sets up a local developer profile for snow_admin user in the DevCopilot frontend + backend using the devpilot Keycloak realm.

Features:
 1. Optionally provisions devpilot realm + snow_admin user.
 2. Exports environment variables for the React frontend to target devpilot realm.
 3. Starts (or verifies) backend and Keycloak, then launches frontend dev server on port 8081.
 4. Performs a direct-grant login for snow_admin (Keycloak) to fetch a token & decodes basic claims.
 5. Saves a lightweight developer profile JSON for reuse (.devsnow.profile.json).
 6. Opens browser to http://localhost:8081 automatically (optional switch to disable).

Usage Examples:
  # Straight startup (assumes realm already provisioned and services running)
  ./DevSnow.ps1

  # Force provision realm & open browser
  ./DevSnow.ps1 -AutoProvision -KCAdminUser admin -KCAdminPassword admin

  # Skip browser auto-open & just output profile
  ./DevSnow.ps1 -NoBrowser

Notes:
 - Run from repo root (same directory as this script) in PowerShell.
 - React dev server must see env vars at launch time; we set process-level env for current session.
 - Keycloak default devpilot snow_admin password: SnowPass123!
 - Backend should listen on http://localhost:5000 (start-all.bat can be used separately if preferred).

#>
[CmdletBinding()] param(
  [string]$KeycloakBaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$ClientId = 'devpilot-frontend',
  [int]$FrontendPort = 8081,
  [string]$FrontendUrl = '',
  [string]$BackendBaseUrl = 'http://localhost:5000',
  [string]$Username = 'snow_admin',
  [string]$Password = 'SnowPass123!',
  [switch]$AutoProvision,
  # Optional explicit path to provisioning script; if blank we'll derive it after params
  [string]$ProvisionScriptPath = '',
  [string]$KCAdminUser = $env:KC_ADMIN,
  [string]$KCAdminPassword = $env:KC_ADMIN_PASSWORD,
  [string]$ProfilePath = '.devsnow.profile.json',
  [switch]$NoBrowser,
  [switch]$SkipFrontendStart,
  [switch]$SkipBackendCheck,
  [switch]$VerboseLogs
)

if ($VerboseLogs) { $VerbosePreference = 'Continue' }

# Derive provisioning script path if not supplied
if (-not $ProvisionScriptPath -or $ProvisionScriptPath.Trim() -eq '') {
  $__base = if ($PSScriptRoot -and $PSScriptRoot.Trim() -ne '') { $PSScriptRoot } else { (Split-Path -Parent $MyInvocation.MyCommand.Path) }
  try {
    $ProvisionScriptPath = Join-Path (Join-Path $__base 'keycloak') 'provision_devpilot_realm.ps1'
  } catch {
    Write-Warn "Failed to build ProvisionScriptPath automatically: $($_.Exception.Message)"
  }
}

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

function Test-ServiceUp {
  param([string]$Url,[int]$TimeoutSec=40)
  $start = Get-Date
  while ((Get-Date) -lt $start.AddSeconds($TimeoutSec)) {
    try { Invoke-WebRequest -Method Head -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true } catch { Start-Sleep -Seconds 2 }
  }
  return $false
}

function Remove-KeycloakUser {
  param([string]$BaseUrl,[string]$Realm,[string]$Username,[string]$AdminUser,[string]$AdminPassword)
  try {
    Write-Info "Checking if user '$Username' exists..."
    $tokenResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/realms/master/protocol/openid-connect/token" -Body @{
      client_id='admin-cli';grant_type='password';username=$AdminUser;password=$AdminPassword
    } -ContentType 'application/x-www-form-urlencoded'
    $adminToken = $tokenResp.access_token
    $headers = @{'Authorization'="Bearer $adminToken"}
    $users = Invoke-RestMethod -Method GET -Uri "$BaseUrl/admin/realms/$Realm/users?username=$Username" -Headers $headers
    if ($users.Count -gt 0) {
      Write-Info "Deleting existing user '$Username' to recreate fresh..."
      Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/admin/realms/$Realm/users/$($users[0].id)" -Headers $headers | Out-Null
      Write-Info "User '$Username' deleted successfully"
    } else {
      Write-Info "User '$Username' does not exist, will be created fresh"
    }
  } catch {
    Write-Warn "Failed to delete user '$Username': $($_.Exception.Message)"
  }
}

function Invoke-ProvisionRealm {
  param([string]$ScriptPath,[string]$AdminUser,[string]$AdminPassword)
  if (-not (Test-Path $ScriptPath)) { Write-Err "Provision script not found: $ScriptPath"; return }
  if (-not $AdminUser -or -not $AdminPassword) { Write-Err 'Admin credentials required for provisioning.'; return }
  Write-Info "Provisioning realm via $ScriptPath ..."
  powershell -File $ScriptPath -AdminUser $AdminUser -AdminPassword $AdminPassword -VerboseMode | Write-Host
}

function Get-KeycloakToken {
  param([string]$BaseUrl,[string]$Realm,[string]$ClientId,[string]$User,[string]$Password)
  $tokenEndpoint = "$BaseUrl/realms/$Realm/protocol/openid-connect/token"
  $body = "client_id=$ClientId&grant_type=password&username=$User&password=$Password"
  try { (Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType 'application/x-www-form-urlencoded').access_token } catch { Write-Err "Failed to obtain token: $($_.Exception.Message)"; throw }
}

function Decode-JwtPayload {
  param([string]$Token)
  if (-not $Token) { return @{} }
  $parts = $Token.Split('.')
  if ($parts.Length -lt 2) { return @{} }
  $padded = $parts[1].PadRight(($parts[1].Length + 3) - (($parts[1].Length + 3) % 4), '=')
  try { ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($padded.Replace('-', '+').Replace('_', '/'))) | ConvertFrom-Json) } catch { @{} }
}

function Ensure-FrontendEnv {
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

function Stop-ExistingFrontend {
  Write-Info 'Checking for existing frontend job...'
  $existingJob = Get-Job -Name DevCopilotSnowAdmin -ErrorAction SilentlyContinue
  if ($existingJob) {
    Write-Info "Stopping existing frontend job (State: $($existingJob.State))..."
    Stop-Job -Name DevCopilotSnowAdmin -ErrorAction SilentlyContinue
    Receive-Job -Name DevCopilotSnowAdmin -ErrorAction SilentlyContinue | Out-Null
    Remove-Job -Name DevCopilotSnowAdmin -Force -ErrorAction SilentlyContinue
    Write-Info 'Existing frontend job stopped.'
  } else {
    Write-Info 'No existing frontend job found.'
  }
}

function Start-Frontend {
  param([string]$FrontendDir,[switch]$ForceRebuild)
  if (-not (Test-Path (Join-Path $FrontendDir 'package.json'))) { Write-Err "package.json not found in $FrontendDir"; return }
  
  # Stop any existing frontend job first
  Stop-ExistingFrontend
  
  # Check if node_modules exists
  if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Write-Info 'node_modules not found, running npm install...'
    Push-Location $FrontendDir
    npm install
    Pop-Location
  }
  
  Write-Info 'Starting React dev server (background job)...'
  Write-Info 'Note: React dev server will auto-rebuild when files change'
  Start-Job -Name DevCopilotSnowAdmin -ScriptBlock { param($Dir) Set-Location $Dir; npm start 2>&1 | Write-Host } -ArgumentList $FrontendDir | Out-Null
  Write-Info 'Waiting up to 60s for frontend to respond...'
  if (Test-ServiceUp -Url "http://localhost:$($env:PORT)" -TimeoutSec 60) { Write-Info 'Frontend is responding.' } else { Write-Warn 'Frontend not reachable yet; it may still be compiling.' }
}

# ------------------- MAIN -------------------
Write-Info "DevSnow profile bootstrap (realm=$Realm user=$Username on port $FrontendPort)"

if ($AutoProvision) {
  # Delete snow_admin first to ensure clean creation
  Remove-KeycloakUser -BaseUrl $KeycloakBaseUrl -Realm $Realm -Username $Username -AdminUser $KCAdminUser -AdminPassword $KCAdminPassword
  Invoke-ProvisionRealm -ScriptPath $ProvisionScriptPath -AdminUser $KCAdminUser -AdminPassword $KCAdminPassword 
  # Give Keycloak a moment to finalize user setup
  Write-Info "Waiting 3 seconds for user provisioning to complete..."
  Start-Sleep -Seconds 3
}

# Basic reachability
if (-not (Test-ServiceUp -Url $KeycloakBaseUrl -TimeoutSec 50)) { Write-Warn "Keycloak not reachable at $KeycloakBaseUrl" }
if (-not $SkipBackendCheck) {
  if (-not (Test-ServiceUp -Url "$BackendBaseUrl/healthz" -TimeoutSec 40)) { Write-Warn "Backend not reachable at $BackendBaseUrl/healthz" }
}

# Export env for frontend build process
Ensure-FrontendEnv -BaseUrl $KeycloakBaseUrl -Realm $Realm -ClientId $ClientId -Backend $BackendBaseUrl -LoginHint $Username

# Try to acquire token (optional verification)
try {
  $token = Get-KeycloakToken -BaseUrl $KeycloakBaseUrl -Realm $Realm -ClientId $ClientId -User $Username -Password $Password
  Write-Info "Access token acquired (length=$($token.Length))."
  $claims = Decode-JwtPayload -Token $token
  $roles = if ($claims.realm_access -and $claims.realm_access.roles) { ($claims.realm_access.roles -join ',') } else { '<none>' }
  Write-Info "User roles: $roles"
  $userRoles = if ($claims.realm_access) { $claims.realm_access.roles } else { @() }
} catch {
  Write-Warn "Could not obtain token via direct grant (user may need to login via UI first): $($_.Exception.Message)"
  Write-Info "Proceeding with frontend startup - user will login via Keycloak UI"
  $userRoles = @('developer')
}

# Persist lightweight profile
$profile = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  realm = $Realm
  keycloak_url = $KeycloakBaseUrl
  client_id = $ClientId
  username = $Username
  roles = $userRoles
  frontend_env = @{realm=$Realm; client=$ClientId; keycloak=$KeycloakBaseUrl; backend=$BackendBaseUrl; port=$FrontendPort}
}
$profile | ConvertTo-Json -Depth 6 | Out-File -FilePath $ProfilePath -Encoding UTF8
Write-Info "Profile stored at $ProfilePath"

# Optionally start frontend
if (-not $FrontendUrl -or $FrontendUrl.Trim() -eq '') { $FrontendUrl = "http://localhost:$FrontendPort" }

# Set PORT env var so CRA uses the requested port
$env:PORT = $FrontendPort
Write-Info "Frontend will start on port $FrontendPort (URL=$FrontendUrl)"

if (-not $SkipFrontendStart) {
  $frontendDir = Join-Path $PSScriptRoot 'frontend'
  Start-Frontend -FrontendDir $frontendDir
}

if (-not $NoBrowser) {
  Write-Info "Opening $FrontendUrl in browser..."
  Start-Process $FrontendUrl
}

Write-Host "`nDone. Environment variables set for this session. If you open a new shell, rerun this script." -ForegroundColor Green
Write-Host "To view profile: Get-Content $ProfilePath" -ForegroundColor DarkCyan
Write-Host "`n[TIP] After code changes, hard-refresh browser (Ctrl+Shift+R) to see updates" -ForegroundColor Yellow

<# Quick tips:
  If frontend shows Keycloak login for wrong realm: ensure REACT_APP_* vars were exported before start.
  To restart frontend only: Run this script again (it will auto-stop the old job)
  To manually stop frontend: Stop-Job DevCopilotSnowAdmin; Remove-Job DevCopilotSnowAdmin -Force
  After changing frontend code: Hard refresh browser (Ctrl+Shift+R or Ctrl+F5) to bypass cache
  
  ServiceNow Integration:
  - Ensure snow_admin exists in ServiceNow with user_name=snow_admin
  - Backend will query incidents with: sysparm_query=assigned_to.user_name=snow_admin
  - Groups ITSM_Engineering and ITSM_App-Dev can be configured in Keycloak for role-based access
#>
