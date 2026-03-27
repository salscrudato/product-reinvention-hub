<#!
OneClickDevSetup.ps1 (Slim Edition)

Goal: Single click to (optionally) provision Keycloak realm, ensure Keycloak is up, fetch dev1 token, set frontend env, start React, open browser.

Deliberately DOES NOT: start or talk to backend, run session init, snapshot incidents, ask questions.

Steps:
 1. (Optional) Provision devpilot realm
 2. Start Keycloak (unless -NoKeycloakStart or already up)
 3. Fetch token for dev1
 4. Write minimal profile (timestamp, username, roles, token preview)
 5. Export REACT_APP_* vars & start React dev server (unless skipped)
 6. Open browser (unless skipped)

Usage:
  ./OneClickDevSetup.ps1
  ./OneClickDevSetup.ps1 -AutoProvision -KCAdminUser admin -KCAdminPassword admin
  ./OneClickDevSetup.ps1 -NoKeycloakStart (assume already running)
  ./OneClickDevSetup.ps1 -SkipFrontend -SkipBrowser (just provision + token)

Output: .oneclick.devcopilot.profile.json and $Global:OneClickDev
#>
[CmdletBinding()] param(
  [string]$KeycloakBaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$ClientId = 'devpilot-frontend',
  [string]$BackendBaseUrl = 'http://localhost:5000',
  [string]$FrontendUrl = 'http://localhost:3000',
  [string]$Username = 'dev1',
  [string]$Password = 'DevPass123!',
  [switch]$AutoProvision,
  [switch]$NoKeycloakStart,
  [string]$KCAdminUser = $env:KC_ADMIN,
  [string]$KCAdminPassword = $env:KC_ADMIN_PASSWORD,
  [switch]$SkipFrontend,
  [switch]$SkipBrowser,
  [int]$TimeoutSec = 70,
  [string]$ProfilePath = '.oneclick.devcopilot.profile.json',
  [switch]$VerboseLogs
)

if ($VerboseLogs) { $VerbosePreference='Continue' }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$provisionScript = Join-Path $repoRoot 'keycloak' 'provision_devpilot_realm.ps1'
$keycloakStartBat = Join-Path $repoRoot 'start-keycloak.bat'
$frontendDir = Join-Path $repoRoot 'frontend'

function Test-Up($url,$timeout){
  $start=Get-Date
  while((Get-Date) -lt $start.AddSeconds($timeout)){
    try { Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true } catch { Start-Sleep 2 }
  }
  return $false
}

# Backend logic removed.

function Start-Frontend {
  if ($SkipFrontend) { return }
  if (-not (Test-Path (Join-Path $frontendDir 'package.json'))) { Warn 'Frontend package.json missing; skipping.'; return }
  Info 'Exporting frontend REACT_APP_* env vars...'
  $env:REACT_APP_KEYCLOAK_URL = $KeycloakBaseUrl.TrimEnd('/')
  $env:REACT_APP_KEYCLOAK_REALM = $Realm
  $env:REACT_APP_KEYCLOAK_CLIENT_ID = $ClientId
  $env:REACT_APP_BACKEND_BASE = $BackendBaseUrl.TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($Username)) {
    Remove-Item Env:REACT_APP_KEYCLOAK_LOGIN_HINT -ErrorAction SilentlyContinue
  } else {
    $env:REACT_APP_KEYCLOAK_LOGIN_HINT = $Username
  }
  Info 'Starting React dev server (background job DevCopilotFrontend)' 
  if (Get-Job -Name DevCopilotFrontend -ErrorAction SilentlyContinue) { Remove-Job DevCopilotFrontend -Force }
  Start-Job -Name DevCopilotFrontend -ScriptBlock { param($dir) Set-Location $dir; npm start 2>&1 | Write-Host } -ArgumentList $frontendDir | Out-Null
}

function Provision-RealmIfRequested {
  if (-not $AutoProvision) { return }
  if (-not (Test-Path $provisionScript)) { Err "Provision script not found: $provisionScript"; return }
  if (-not $KCAdminUser -or -not $KCAdminPassword) { Err 'Admin creds required for provisioning.'; return }
  Info 'Provisioning Keycloak realm devpilot...'
  pwsh -File $provisionScript -AdminUser $KCAdminUser -AdminPassword $KCAdminPassword -VerboseMode
}

function Get-Token {
  $url = "$KeycloakBaseUrl/realms/$Realm/protocol/openid-connect/token"
  $body = "client_id=$ClientId&grant_type=password&username=$Username&password=$Password"
  try { (Invoke-RestMethod -Method Post -Uri $url -Body $body -ContentType 'application/x-www-form-urlencoded').access_token } catch { Err "Token fetch failed: $($_.Exception.Message)"; throw }
}

function Decode-JWT($token){
  if (-not $token){ return @{} }
  $parts = $token.Split('.')
  if ($parts.Length -lt 2){ return @{} }
  $padded = $parts[1].PadRight(($parts[1].Length+3) - (($parts[1].Length+3) % 4),'=')
  try { ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($padded.Replace('-','+').Replace('_','/'))) | ConvertFrom-Json) } catch { @{} }
}

# Removed backend-related helper functions

# MAIN
Info "OneClick slim setup (user=$Username realm=$Realm)"
Provision-RealmIfRequested
if (-not (Test-Up $KeycloakBaseUrl 10)) {
  if ($NoKeycloakStart) {
    Err "Keycloak not reachable and -NoKeycloakStart specified. Aborting."; return
  }
  if (Test-Path $keycloakStartBat) {
    Info 'Starting Keycloak via start-keycloak.bat...'
    Start-Process cmd.exe "/c `"$keycloakStartBat`"" | Out-Null
    if (-not (Test-Up $KeycloakBaseUrl 60)) { Err 'Keycloak failed to start within 60s.'; return }
  } else {
    Err 'Keycloak start script not found; cannot continue.'; return
  }
}
$token = Get-Token
Info "Token acquired (length=$($token.Length))"
$claims = Decode-JWT $token
$roles = ($claims.realm_access.roles -join ',')
Info "Roles: $roles"
$profile = [ordered]@{
  timestamp=(Get-Date).ToString('o')
  username=$Username
  realm=$Realm
  roles=$claims.realm_access.roles
  token_preview=($token.Substring(0,25) + '...')
}
$profile | ConvertTo-Json -Depth 6 | Out-File -FilePath $ProfilePath -Encoding UTF8
Info "Profile stored at $ProfilePath"
Start-Frontend
if (-not $SkipBrowser -and -not $SkipFrontend){ Start-Process $FrontendUrl }
$Global:OneClickDev = $profile
Info 'Slim one-click setup complete.'
