<#
rebuild_frontend_with_prompts.ps1

Purpose:
  Ensures the React frontend is rebuilt using the latest source that contains the Prompts tab.
  Cleans old build artifacts, stops lingering jobs, reinstalls dependencies (optional), and starts dev server.

Usage:
  pwsh ./scripts/rebuild_frontend_with_prompts.ps1          # default port 3000
  pwsh ./scripts/rebuild_frontend_with_prompts.ps1 -Port 8081
  pwsh ./scripts/rebuild_frontend_with_prompts.ps1 -FreshInstall

Options:
  -Port <int>           Change dev server port (default 3000)
  -FreshInstall         Deletes node_modules and reinstalls
  -SkipInstall          Skips npm install (faster when deps unchanged)
  -NoBrowser            Do not auto-open browser
  -Verbose              Verbose output

Result:
  Starts a single background PowerShell job named DevCopilotFrontend.
  Prints verification scan for Prompts tab in MainTabs.jsx.

Notes:
  If Prompts tab still missing, verify you're hitting the dev server (check console for 'App.js loaded').
  Clear browser cache or hard reload (Ctrl+Shift+R) if stale bundle persists.
#>
[CmdletBinding()] param(
  [int]$Port = 3000,
  [switch]$FreshInstall,
  [switch]$SkipInstall,
  [switch]$NoBrowser
)

# Use common parameter -Verbose
if ($PSBoundParameters.ContainsKey('Verbose')) { $VerbosePreference='Continue' }

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[ERR]  $m" -ForegroundColor Red }

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$frontendDir = Join-Path $repoRoot 'frontend'
if (-not (Test-Path $frontendDir)) { Write-Err "Frontend directory not found: $frontendDir"; exit 1 }

Write-Info "Repo root: $repoRoot"

# Stop existing jobs
Get-Job -Name DevCopilotFrontend -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Info "Stopping existing frontend job Id=$($_.Id)"
  Stop-Job $_ -ErrorAction SilentlyContinue; Receive-Job $_ -ErrorAction SilentlyContinue | Out-Null; Remove-Job $_ -ErrorAction SilentlyContinue
}

# Optional full reinstall
if ($FreshInstall) {
  Write-Info "FreshInstall requested: removing node_modules and lockfile"
  Remove-Item -Recurse -Force (Join-Path $frontendDir 'node_modules') -ErrorAction SilentlyContinue
  Remove-Item -Force (Join-Path $frontendDir 'package-lock.json') -ErrorAction SilentlyContinue
}

# Always remove prior build output
Write-Info "Removing prior build directory (if exists)"
Remove-Item -Recurse -Force (Join-Path $frontendDir 'build') -ErrorAction SilentlyContinue

# Optional install
if (-not $SkipInstall) {
  Write-Info "(Re)installing dependencies"
  Push-Location $frontendDir
  npm install | Write-Host
  Pop-Location
} else {
  Write-Info "Skipping npm install by request"
}

# Simple source verification
$mainTabs = Join-Path $frontendDir 'src' 'MainTabs.jsx'
if (Test-Path $mainTabs) {
  $content = Get-Content $mainTabs -Raw
  if ($content -match '<Tab label="Prompts"') {
    Write-Info "Verified Prompts tab present in MainTabs.jsx"
  } else {
    Write-Warn "Prompts tab NOT detected in MainTabs.jsx. Check branch or pull latest changes."
  }
} else { Write-Warn "MainTabs.jsx not found at expected path." }

# Ensure PORT env var
$env:PORT = $Port
Write-Info "Set PORT=$Port"

# Start dev server job
Write-Info "Starting frontend dev server (npm start)"
Start-Job -Name DevCopilotFrontend -ScriptBlock {
  param($Dir)
  Set-Location $Dir
  npm start 2>&1 | Write-Host
} -ArgumentList $frontendDir | Out-Null

Start-Sleep -Seconds 4
Write-Info "Checking that job started:"
Get-Job -Name DevCopilotFrontend | Format-Table Id, Name, State

Write-Info "Expected URL: http://localhost:$Port"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }

Write-Host "Rebuild complete. Use Get-Job DevCopilotFrontend for status. Ctrl+Shift+R in browser for hard reload." -ForegroundColor Green