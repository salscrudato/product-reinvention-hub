<#!
DevCopilotSetup.ps1

Bootstrap script to:
 1. (Optionally) provision the Keycloak 'devpilot' realm (developer/product_owner/engineering_lead roles + dev1 user)
 2. Authenticate as dev1 and obtain an access token
 3. Initialize a DevCopilot (Agentic Orchestrator Auto) session to resolve persona & gather role-based context
 4. Provide helper functions to ask SDLC / ServiceNow / Wiki / GitHub style questions and view the tool plan produced
 5. Offer an interactive REPL for rapid experimentation

Prereqs:
 - Keycloak running locally at http://localhost:8080 (adjust with -KeycloakBaseUrl)
 - Backend running at http://localhost:5000 (adjust with -BackendBaseUrl)
 - Realm/client already provisioned OR run with -AutoProvision and provide KC admin credentials

Usage Examples:
  # Simple one-shot question
  ./DevCopilotSetup.ps1 -Ask "What incidents are assigned to me?"

  # Provision realm then interactive loop
  ./DevCopilotSetup.ps1 -AutoProvision -KCAdminUser admin -KCAdminPassword admin -Interactive

  # Open a browser to frontend after login
  ./DevCopilotSetup.ps1 -OpenFrontend

Outputs:
 - Writes a profile JSON (by default .devcopilot.profile.json) if -SaveProfile is used
 - Sets $Global:DevCopilotContext with token, persona, roles, incidents summary, last plan

#>
[CmdletBinding()] param(
  [string]$KeycloakBaseUrl = 'http://localhost:8080',
  [string]$Realm = 'devpilot',
  [string]$ClientId = 'devpilot-frontend',
  [string]$BackendBaseUrl = 'http://localhost:5000',
  [string]$Username = 'dev1',
  [string]$Password = 'DevPass123!',
  [switch]$AutoProvision,
  [string]$ProvisionScriptPath = (Join-Path $PSScriptRoot '..' '..' 'keycloak' 'provision_devpilot_realm.ps1'),
  [string]$KCAdminUser = $env:KC_ADMIN,
  [string]$KCAdminPassword = $env:KC_ADMIN_PASSWORD,
  [switch]$Interactive,
  [string]$Ask,
  [switch]$SaveProfile,
  [string]$ProfilePath = '.devcopilot.profile.json',
  [switch]$OpenFrontend,
  [int]$TimeoutSec = 60,
  [switch]$VerboseLogs
)

if ($VerboseLogs) { $VerbosePreference = 'Continue' }

function Write-Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Test-ServiceUp {
  param([string]$Url,[int]$TimeoutSec=30)
  $start = Get-Date
  while ((Get-Date) -lt $start.AddSeconds($TimeoutSec)) {
    try { Invoke-WebRequest -Method Head -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true } catch { Start-Sleep -Seconds 2 }
  }
  return $false
}

function Invoke-ProvisionRealm {
  param([string]$ScriptPath,[string]$AdminUser,[string]$AdminPassword)
  if (-not (Test-Path $ScriptPath)) { Write-Err "Provision script not found: $ScriptPath"; return }
  if (-not $AdminUser -or -not $AdminPassword) { Write-Err 'Admin credentials required for provisioning.'; return }
  Write-Info "Provisioning realm via $ScriptPath ..."
  pwsh -File $ScriptPath -AdminUser $AdminUser -AdminPassword $AdminPassword -VerboseMode | Write-Host
}

function Get-KeycloakToken {
  param([string]$BaseUrl,[string]$Realm,[string]$ClientId,[string]$User,[string]$Password)
  $tokenEndpoint = "$BaseUrl/realms/$Realm/protocol/openid-connect/token"
  $body = "client_id=$ClientId&grant_type=password&username=$User&password=$Password"
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -Body $body -ContentType 'application/x-www-form-urlencoded'
    return $resp.access_token
  } catch {
    Write-Err "Failed to obtain token: $($_.Exception.Message)"; throw
  }
}

function Decode-JwtPayload {
  param([string]$Token)
  if (-not $Token) { return @{} }
  $parts = $Token.Split('.')
  if ($parts.Length -lt 2) { return @{} }
  $p = $parts[1].PadRight(($parts[1].Length + 3) - (($parts[1].Length + 3) % 4), '=')
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p.Replace('-', '+').Replace('_', '/')))
  try { return $json | ConvertFrom-Json } catch { return @{} }
}

function Invoke-DevCopilotSessionInit {
  param([string]$Backend,[string]$Token,[string]$User)
  $url = "$Backend/session/init"
  $headers = @{'Authorization'="Bearer $Token"}
  $payload = @{user_id=$User; question='session init'; metadata=@{}} | ConvertTo-Json -Depth 5
  try {
    return Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $payload -ContentType 'application/json'
  } catch {
    Write-Err "Session init failed: $($_.Exception.Message)"; throw
  }
}

function Invoke-DevCopilotQuestion {
  param(
    [string]$Backend,
    [string]$Token,
    [string]$User,
    [string]$Question,
    [hashtable]$Metadata
  )
  $url = "$Backend/agentic_orchestrate_auto"
  $headers = @{'Authorization'="Bearer $Token"}
  $body = @{username=$User; prompt=$Question; messages=@(@{role='user';content=$Question}); metadata=($Metadata | ConvertTo-Json -Depth 8 | ConvertFrom-Json)} | ConvertTo-Json -Depth 10
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $body -ContentType 'application/json'
    return $resp
  } catch {
    Write-Err "Question invocation failed: $($_.Exception.Message)"; throw
  }
}

function Get-DevCopilotUserIncidents {
  param([string]$Backend,[string]$Token,[string]$User)
  $q = 'my incidents'
  $resp = Invoke-DevCopilotQuestion -Backend $Backend -Token $Token -User $User -Question $q -Metadata @{ }
  $tool = $resp.tool_outputs.fetch_user_incidents
  if (-not $tool) { return @{ question=$q; note='No fetch_user_incidents output. Possibly planner chose different tools.'; raw=$resp } }
  return @{ question=$q; count=$tool.count; username=$tool.username; sample=($tool.incidents | Select-Object -First 3) }
}

function New-DevCopilotContext {
  param([string]$Backend,[string]$Token,[string]$User,[string]$Persona)
  Write-Info 'Assembling initial context (incidents snapshot)...'
  $inc = Get-DevCopilotUserIncidents -Backend $Backend -Token $Token -User $User
  $ctx = [ordered]@{
    username = $User
    persona = $Persona
    token_acquired = (Get-Date).ToString('o')
    incidents = $inc
    last_plan = $null
  }
  return $ctx
}

function Show-DevCopilotPlan {
  param($Resp)
  if (-not $Resp) { return }
  $plan = $Resp.plan
  if (-not $plan) { $plan = $Resp.function_sequence }
  if (-not $plan) { Write-Warn 'No plan / function_sequence in response.'; return }
  Write-Host "--- Tool Plan ---" -ForegroundColor Green
  $i=0
  foreach ($p in $plan) {
    $fn = $p.function_name
    if (-not $fn) { $fn = $p.tool }
    $args = $p.arguments
    if (-not $args) { $args = $p.args }
    Write-Host ("[{0}] {1} :: {2}" -f $i,$fn, ($args | ConvertTo-Json -Depth 6)) -ForegroundColor White
    $i++
  }
}

function Start-DevCopilotInteractive {
  param([string]$Backend,[string]$Token,[string]$User,[ref]$Context,[switch]$ShowTools)
  Write-Host "\nInteractive DevCopilot. Type 'exit' to quit." -ForegroundColor Green
  while ($true) {
    Write-Host -NoNewline "devcopilot> " -ForegroundColor Magenta
    $q = Read-Host
    if ($q -match '^(exit|quit)$') { break }
    if (-not $q) { continue }
    $resp = Invoke-DevCopilotQuestion -Backend $Backend -Token $Token -User $User -Question $q -Metadata @{}
    if ($ShowTools) { Show-DevCopilotPlan -Resp $resp }
    $Context.Value.last_plan = $resp.plan
    Write-Host "Answer:" -ForegroundColor Yellow
    Write-Host ($resp.final_answer) -ForegroundColor White
  }
}

# ------------------------- MAIN FLOW -------------------------
Write-Info "DevCopilot bootstrap starting (realm=$Realm user=$Username)"

if (-not (Test-ServiceUp -Url $KeycloakBaseUrl -TimeoutSec $TimeoutSec)) {
  Write-Warn "Keycloak not reachable at $KeycloakBaseUrl. Ensure it is running (e.g., ./start-keycloak.bat)."
}
if (-not (Test-ServiceUp -Url $BackendBaseUrl/healthz -TimeoutSec $TimeoutSec)) {
  Write-Warn "Backend not reachable at $BackendBaseUrl. Ensure it is running (e.g., start-all.bat)."
}

if ($AutoProvision) {
  Invoke-ProvisionRealm -ScriptPath $ProvisionScriptPath -AdminUser $KCAdminUser -AdminPassword $KCAdminPassword
}

$token = Get-KeycloakToken -BaseUrl $KeycloakBaseUrl -Realm $Realm -ClientId $ClientId -User $Username -Password $Password
Write-Info "Obtained access token (length=$($token.Length))."
$payload = Decode-JwtPayload -Token $token
$roles = $payload.realm_access.roles -join ','
Write-Info "Token roles: $roles"

$session = Invoke-DevCopilotSessionInit -Backend $BackendBaseUrl -Token $token -User $Username
$persona = $session.persona
Write-Info "Resolved persona: $persona (source=$($session.source))"

$Global:DevCopilotContext = New-DevCopilotContext -Backend $BackendBaseUrl -Token $token -User $Username -Persona $persona
$Global:DevCopilotContext.token = $token
$Global:DevCopilotContext.roles = $roles -split ','

if ($SaveProfile) {
  $Global:DevCopilotContext | ConvertTo-Json -Depth 10 | Out-File -FilePath $ProfilePath -Encoding UTF8
  Write-Info "Profile written to $ProfilePath"
}

if ($Ask) {
  Write-Info "Asking one-shot question: $Ask"
  $resp = Invoke-DevCopilotQuestion -Backend $BackendBaseUrl -Token $token -User $Username -Question $Ask -Metadata @{}
  Show-DevCopilotPlan -Resp $resp
  Write-Host "\nAnswer:" -ForegroundColor Yellow
  Write-Host $resp.final_answer -ForegroundColor White
  $Global:DevCopilotContext.last_plan = $resp.plan
}

if ($OpenFrontend) {
  $frontendUrl = 'http://localhost:3000'
  Write-Info "Opening frontend: $frontendUrl"
  Start-Process $frontendUrl
}

if ($Interactive) {
  Start-DevCopilotInteractive -Backend $BackendBaseUrl -Token $token -User $Username -Context ([ref]$Global:DevCopilotContext) -ShowTools
}

Write-Host "\nBootstrap complete. Use:`n  $($MyInvocation.MyCommand.Path) -Interactive`nfor interactive mode later, reusing same parameters." -ForegroundColor Green
Write-Host "Context stored in: `n  $Global:DevCopilotContext" -ForegroundColor DarkCyan

<#!
Sample Questions (copy/paste into interactive):
  my incidents
  show similar incidents to INC0000016
  summarize backlog grooming for last 30 days
  give me risk analysis for change CHG001234 (if change tool integrated)
  fetch key wiki insights about deployment pipeline
  list top 5 incident categories impacting email performance
  draft a github pull request description template for a bug fix touching authentication

#>
