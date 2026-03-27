<#!
launch-devpilot.ps1
Unified PowerShell launcher for SnowChat devpilot realm.

Features:
 1. Optional parameterization for Keycloak URL/Realm/Client and user credentials
 2. Starts Keycloak (via start-keycloak.bat or KEYCLOAK_HOME) if not already running
 3. Waits for Keycloak readiness (OIDC config endpoint)
 4. Provisions devpilot realm, roles, client, and users (idempotent)
 5. Starts backend (debugpy attach mode, waits for debugger if DEBUG_WAIT=1)
 6. Starts frontend (React) with Keycloak env overrides for devpilot realm
 7. Performs direct grant token test for dev1 and decodes a payload excerpt
 8. Structured colored logging

Usage Examples:
  # Default (devpilot realm)
  ./launch-devpilot.ps1

  # Custom realm/client
  ./launch-devpilot.ps1 -Realm myrealm -ClientId my-frontend -DevUser dev1 -DevPassword P@ssw0rd!

  # Skip provisioning if already done
  ./launch-devpilot.ps1 -SkipProvision

Requires: PowerShell 5+, Python, Node/npm. debugpy already in requirements.txt.
#>
[CmdletBinding()] param(
  [string]$KeycloakUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$ClientId = 'devpilot-frontend',
  [string]$DevUser = 'dev1',
  [string]$DevPassword = 'DevPass123!',
  [string]$AdminUser = 'admin',
  [string]$AdminPassword = 'admin',
  [switch]$SkipProvision,
  [switch]$NoBackend,
  [switch]$NoFrontend,
  [switch]$NoKeycloak,
  [switch]$DetatchDebuggerWait,
  [int]$KeycloakWaitSeconds = 60,
  [int]$DebugPort = 5678
)

$ErrorActionPreference = 'Stop'
$script:StartTime = Get-Date

function Write-Stage($msg,[ConsoleColor]$Color='Cyan') { Write-Host ("[" + (Get-Date -Format HH:mm:ss) + "] $msg") -ForegroundColor $Color }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-ErrLine($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

Write-Host "=== SnowChat DevPilot PowerShell Launcher ===" -ForegroundColor Magenta
Write-Host "Keycloak: $KeycloakUrl  Realm: $Realm  Client: $ClientId" -ForegroundColor DarkCyan

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# 1. Start Keycloak -----------------------------------------------------------
if (-not $NoKeycloak) {
  Write-Stage "[1/7] Ensuring Keycloak is running" Green
  $kcStarted = $false
  $existing = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'java*' -or $_.ProcessName -like 'kc*' } | Select-Object -First 1
  if ($existing) {
    Write-Stage "Keycloak (or JVM) already running (PID=$($existing.Id))" DarkGray
  } else {
    if (Test-Path "$Root\start-keycloak.bat") {
      Write-Stage "Launching start-keycloak.bat" DarkGray
      Start-Process -FilePath cmd.exe -ArgumentList "/k","call start-keycloak.bat" -WindowStyle Normal -WorkingDirectory $Root -PassThru | Out-Null
      $kcStarted = $true
    } elseif ($env:KEYCLOAK_HOME -and (Test-Path (Join-Path $env:KEYCLOAK_HOME 'bin\kc.bat'))) {
      Write-Stage "Launching kc.bat from KEYCLOAK_HOME" DarkGray
      Start-Process -FilePath cmd.exe -ArgumentList "/k","cd /d $env:KEYCLOAK_HOME\bin && kc.bat start-dev" -WindowStyle Normal -PassThru | Out-Null
      $kcStarted = $true
    } else {
      Write-Warn "Keycloak start script not found; continuing (assume external)."
    }
  }
  # Wait for readiness
  Write-Stage "Waiting for Keycloak OIDC endpoint (timeout ${KeycloakWaitSeconds}s)" DarkGray
  $deadline = (Get-Date).AddSeconds($KeycloakWaitSeconds)
  $ready = $false
  while((Get-Date) -lt $deadline) {
    try {
      Invoke-RestMethod -Method Get -Uri "$KeycloakUrl/realms/master/.well-known/openid-configuration" -TimeoutSec 4 | Out-Null
      $ready = $true; break
    } catch { Start-Sleep -Milliseconds 800 }
  }
  if ($ready) { Write-Stage "Keycloak ready." Green } else { Write-Warn "Keycloak readiness not confirmed." }
} else {
  Write-Stage "[1/7] Skipping Keycloak (NoKeycloak switch)" Yellow
}

# 2. Provision realm ---------------------------------------------------------
if ($SkipProvision) {
  Write-Stage "[2/7] Skipping provisioning (SkipProvision)" Yellow
} elseif ($NoKeycloak) {
  Write-Warn "[2/7] Cannot provision because Keycloak start was skipped."
} else {
  Write-Stage "[2/7] Provisioning realm '$Realm' (idempotent)" Green
  if (-not (Test-Path "$Root\keycloak\provision_devpilot_realm.ps1")) {
    Write-ErrLine "Provision script missing: keycloak\provision_devpilot_realm.ps1"; exit 2
  }
  try {
    & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "keycloak\provision_devpilot_realm.ps1" -BaseUrl $KeycloakUrl -Realm $Realm -ClientId $ClientId -AdminUser $AdminUser -AdminPassword $AdminPassword > provisioning.log 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "Provisioning script exited with code $LASTEXITCODE (see provisioning.log)."
    } else {
      Write-Stage "Provisioning complete (see provisioning.log for details)" DarkGreen
    }
  } catch {
    Write-Warn "Provisioning threw exception: $($_.Exception.Message) (see provisioning.log)"
  }
}

# 3. Backend start -----------------------------------------------------------
$BackendProc = $null
if (-not $NoBackend) {
  Write-Stage "[3/7] Starting backend (debug attach mode)" Green
  $python = if (Test-Path "$Root\.venv\Scripts\python.exe") { "$Root\.venv\Scripts\python.exe" } elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { $null }
  if (-not $python) { Write-ErrLine "Python not found."; exit 3 }
  # Lazy dependency check
  $depOk = $true
  try { & $python -c "import flask" 2>$null } catch { $depOk = $false }
  if (-not $depOk) { Write-Stage "Installing backend dependencies..." DarkGray; & $python -m pip install -r requirements.txt | Out-Null }
  $env:KEYCLOAK_URL = $KeycloakUrl
  $env:KEYCLOAK_REALM = $Realm
  $env:KEYCLOAK_CLIENT_ID = $ClientId
  $env:BACKEND_DEBUG = '1'
  $env:DEBUG_WAIT = if ($DetatchDebuggerWait) { '' } else { '1' }
  $env:DEBUG_PORT = $DebugPort
  $backendCmd = "set KEYCLOAK_URL=$KeycloakUrl && set KEYCLOAK_REALM=$Realm && set KEYCLOAK_CLIENT_ID=$ClientId && set BACKEND_DEBUG=1 && set DEBUG_PORT=$DebugPort && set DEBUG_WAIT=$($env:DEBUG_WAIT) && $python backend\\app.py --debug-listen"
  $BackendProc = Start-Process -FilePath cmd.exe -ArgumentList '/k', $backendCmd -PassThru -WindowStyle Normal
  Write-Stage "Backend PID=$($BackendProc.Id) listening for debugpy on port $DebugPort" DarkGray
} else {
  Write-Stage "[3/7] Skipping backend (-NoBackend)" Yellow
}

# 4. Frontend start ----------------------------------------------------------
$FrontendProc = $null
if (-not $NoFrontend) {
  Write-Stage "[4/7] Starting frontend (React)" Green
  if (-not (Test-Path "$Root\frontend\package.json")) { Write-ErrLine "frontend/package.json missing"; exit 4 }
  if (-not (Test-Path "$Root\frontend\node_modules")) {
    Write-Stage "Installing npm deps..." DarkGray
    Push-Location frontend
    npm install > ..\frontend-install.log 2>&1
    Pop-Location
  }
  $frontendCmd = "cd frontend && set REACT_APP_KEYCLOAK_URL=$KeycloakUrl && set REACT_APP_KEYCLOAK_REALM=$Realm && set REACT_APP_KEYCLOAK_CLIENT_ID=$ClientId && set REACT_APP_KEYCLOAK_LOGIN_HINT=$DevUser && npm start"
  $FrontendProc = Start-Process -FilePath cmd.exe -ArgumentList '/k', $frontendCmd -PassThru -WindowStyle Normal
  Write-Stage "Frontend PID=$($FrontendProc.Id) realm=$Realm client=$ClientId" DarkGray
} else {
  Write-Stage "[4/7] Skipping frontend (-NoFrontend)" Yellow
}

# 5. Token test --------------------------------------------------------------
Write-Stage "[5/7] Performing direct grant token test for $DevUser" Green
$tokenOk = $false
try {
  $resp = Invoke-RestMethod -Method Post -Uri "$KeycloakUrl/realms/$Realm/protocol/openid-connect/token" -Body @{client_id=$ClientId;grant_type='password';username=$DevUser;password=$DevPassword} -ContentType 'application/x-www-form-urlencoded'
  if ($resp.access_token) {
    $payload = ($resp.access_token.Split('.')[1])
    $pad = 4 - ($payload.Length % 4); if ($pad -lt 4) { $payload += ('=' * $pad) }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
    if ($json -match '"preferred_username"') { $tokenOk = $true }
    $short = ($json | Select-String -Pattern 'preferred_username').Line
    Write-Stage "Token OK: $short" DarkGreen
  }
} catch {
  Write-Warn "Token request failed: $($_.Exception.Message)"
}
if (-not $tokenOk) { Write-Warn "Direct grant token acquisition failed (check user or client direct access grants)." }

# 6. Next-step guidance ------------------------------------------------------
Write-Stage "[6/7] Next Steps" Green
Write-Host " Open http://localhost:3000 in a fresh/private window to avoid cached realm." -ForegroundColor DarkCyan
Write-Host " Login as $DevUser / $DevPassword (realm should be '$Realm')." -ForegroundColor DarkCyan
Write-Host " Attach debugger: VS Code -> Run -> Attach to Python (localhost:$DebugPort)." -ForegroundColor DarkCyan

# 7. Summary -----------------------------------------------------------------
Write-Stage "[7/7] Summary" Green
Write-Host " Realm: $Realm  Client: $ClientId  TokenTest: $(if($tokenOk){'PASS'}else{'FAIL'})" -ForegroundColor White
if ($BackendProc) { Write-Host " Backend PID: $($BackendProc.Id)" }
if ($FrontendProc) { Write-Host " Frontend PID: $($FrontendProc.Id)" }
Write-Host " Provision Log: $(Join-Path $Root 'provisioning.log')" -ForegroundColor DarkGray

$elapsed = (Get-Date) - $script:StartTime
Write-Host " Completed in $([int]$elapsed.TotalSeconds)s" -ForegroundColor Magenta

Write-Host "(Script finished. Windows remain open; close manually when done.)" -ForegroundColor Gray
