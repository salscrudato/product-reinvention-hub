<#
.SYNOPSIS
  Unified test runner for SnowChat agentic planner (retrieval + tool binding) and API.

.DESCRIPTION
  - Loads (optionally) backend/.env if present (python-dotenv is handled inside code paths)
  - Sets/overrides runtime environment variables for retrieval planner + LangChain .bind_tools mode
  - Optionally installs dependencies
  - Starts backend (Flask) server (in-process background) and waits on /healthz
  - Runs planner harness for one or many questions (no tool execution, just planning)
  - Calls /agentic_orchestrate API for one or many questions (full planning + tool execution + answer synthesis)
  - Can switch between 'prompt' and 'langchain' tool binding modes
  - Provides simulation mode for DataDog (DATADOG_SIMULATE=1)
  - Tails logs for interactive monitoring

.PARAMETERS
  See param() below. Notable:
    -QuestionsFile path/to/file.txt  (each line = question)
    -Questions  "Q1","Q2"         (array of questions)
    -Question   "Single question"   (single question convenience)
    Combine -RunHarness and/or -CallAPI to apply to all provided questions.

.EXAMPLES
  # Full run: deps, backend, harness + API for one question, tail logs
  powershell -ExecutionPolicy Bypass -File .\run_snowchat_full.ps1 -InstallDeps -StartBackend -RunHarness -CallAPI -Question "Investigate login failures @log for checkout service"

  # Multiple questions from file (each line) only planner harness
  .\run_snowchat_full.ps1 -StartBackend -RunHarness -QuestionsFile questions.txt

  # Multiple inline questions, API only, prompt JSON planning mode
  .\run_snowchat_full.ps1 -CallAPI -ToolBindingMode prompt -Questions "Investigate latency spikes @log","Summarize wiki architecture @wiki"

  # Compare binding vs prompt quickly (two invocations)
  .\run_snowchat_full.ps1 -StartBackend -RunHarness -Question "Investigate errors @log"
  .\run_snowchat_full.ps1 -RunHarness -ToolBindingMode prompt -Question "Investigate errors @log"

.NOTES
  - Script does NOT modify backend/.env; it sets process-level env vars.
  - Stop backend: use Stop-Process -Id <PID> or close the PowerShell session.
#>
param(
  [switch]$InstallDeps,
  [switch]$UseAzure,
  [string]$OpenAIKey = $env:OPENAI_API_KEY,
  [string]$AzureKey = $env:AZURE_OPENAI_API_KEY,
  [string]$AzureEndpoint = $env:AZURE_OPENAI_ENDPOINT,
  [string]$AzureAPIVersion = $(if ($env:OPENAI_API_VERSION) { $env:OPENAI_API_VERSION } else { '2024-05-01-preview' }),
  [string]$Model = $(if ($env:GPT_MODEL_NAME) { $env:GPT_MODEL_NAME } else { 'gpt-4o-mini' }),
  [string]$PlannerVersion = 'retrieval',
  [string]$ToolBindingMode = 'langchain',
  [int]$MaxToolSchemas = 8,
  [double]$ToolRetrievalMinSim = 0.0,
  [switch]$StrictAnnotations,
  [switch]$SimulateDatadog = $true,
  [switch]$VerboseAgentic = $true,
  [string]$Question = 'Investigate login failures @log for checkout service past 30 minutes',
  [string[]]$Questions = @(),
  [string]$QuestionsFile,
  [switch]$RunHarness,
  [switch]$CallAPI,
  [switch]$StartBackend,
  [int]$Port = 5000,
  [int]$HealthRetries = 15,
  [int]$HealthDelayMs = 500,
  [switch]$TailLogs,
  [switch]$PromptModeSwitch,
  [switch]$LangChainModeSwitch,
  [string]$PythonExe = 'python'
)
$ErrorActionPreference = 'Stop'

# --- Optional .env auto-loader (backend/.env) ---
function Load-DotEnvIfPresent {
  $envPath = Join-Path -Path (Join-Path (Get-Location) 'backend') '.env'
  if (-not (Test-Path $envPath)) { return }
  try {
    Get-Content -Path $envPath | ForEach-Object {
      $line = $_.Trim()
      if (-not $line) { return }
      if ($line.StartsWith('#')) { return }
      $eq = $line.IndexOf('=')
      if ($eq -lt 1) { return }
      $k = $line.Substring(0,$eq).Trim()
      $v = $line.Substring($eq+1).Trim().Trim('"')
      # Only set if not already defined in current process
      if (-not (Get-Item -Path env:$k -ErrorAction SilentlyContinue)) {
        Set-Item -Path env:$k -Value $v
      }
    }
    Write-Host "Loaded environment defaults from backend/.env" -ForegroundColor DarkGray
  } catch {
    Write-Warning "Failed to parse backend/.env: $($_.Exception.Message)"
  }
}

function Write-Section($title) { Write-Host "`n==== $title ====\n" -ForegroundColor Cyan }

function Load-Questions {
  $all = @()
  if ($QuestionsFile) {
    if (-not (Test-Path $QuestionsFile)) { throw "Questions file not found: $QuestionsFile" }
    $fileLines = Get-Content -Path $QuestionsFile | Where-Object { $_.Trim().Length -gt 0 }
    $all += $fileLines
  }
  if ($Questions -and $Questions.Count -gt 0) { $all += $Questions }
  if (-not $all -and $Question) { $all += $Question }
  if (-not $all) { $all = @('Investigate login failures @log for checkout service past 30 minutes') }
  return $all
}

function Set-Env {
  Write-Section "Setting Environment Variables"
  if ($UseAzure) {
    # Normalize / trim incoming values (parameters may be empty strings)
    $resolvedAzureKey = ($AzureKey | ForEach-Object { $_ })
    $resolvedAzureEndpoint = ($AzureEndpoint | ForEach-Object { $_ })
    if ($resolvedAzureKey) { $resolvedAzureKey = $resolvedAzureKey.Trim() }
    if ($resolvedAzureEndpoint) { $resolvedAzureEndpoint = $resolvedAzureEndpoint.Trim() }
    # If still empty, try environment (maybe loaded from .env)
    if (-not $resolvedAzureKey) { $resolvedAzureKey = $env:AZURE_OPENAI_API_KEY }
    if (-not $resolvedAzureEndpoint) { $resolvedAzureEndpoint = $env:AZURE_OPENAI_ENDPOINT }
    if ($resolvedAzureKey) { $resolvedAzureKey = $resolvedAzureKey.Trim() }
    if ($resolvedAzureEndpoint) { $resolvedAzureEndpoint = $resolvedAzureEndpoint.Trim() }
    # Last resort: allow user to pass azure key via OPENAI_API_KEY if they forgot -AzureKey
    if (-not $resolvedAzureKey -and $env:OPENAI_API_KEY) { $resolvedAzureKey = $env:OPENAI_API_KEY.Trim() }
    if (-not $resolvedAzureKey -or -not $resolvedAzureEndpoint) {
      Write-Host "AzureKey='$resolvedAzureKey' AzureEndpoint='$resolvedAzureEndpoint'" -ForegroundColor Yellow
      throw "Azure mode selected but AzureKey or AzureEndpoint missing (after trim & fallback). Use -AzureKey and -AzureEndpoint explicitly."
    }
    $env:AZURE_OPENAI_API_KEY = $resolvedAzureKey
    $env:AZURE_OPENAI_ENDPOINT = $resolvedAzureEndpoint
    $env:OPENAI_API_VERSION = $AzureAPIVersion
    if (-not $env:OPENAI_API_KEY) { $env:OPENAI_API_KEY = $resolvedAzureKey }
    Write-Host "(Azure) Using endpoint: $resolvedAzureEndpoint" -ForegroundColor DarkGray
  } else {
    if (-not $OpenAIKey) {
      # Try fallback to AZURE key if present even without -UseAzure (user might have only azure values set)
      if ($env:AZURE_OPENAI_API_KEY -and $env:AZURE_OPENAI_ENDPOINT) {
        Write-Host "OPENAI_API_KEY missing, but Azure values found. Consider re-running with -UseAzure." -ForegroundColor Yellow
      }
      throw "OPENAI_API_KEY not supplied. Provide -OpenAIKey or set environment variable."
    }
    $env:OPENAI_API_KEY = $OpenAIKey.Trim()
  }
  if ($PromptModeSwitch) { $ToolBindingMode = 'prompt' }
  if ($LangChainModeSwitch) { $ToolBindingMode = 'langchain' }
  $env:GPT_MODEL_NAME = $Model
  $env:PLANNER_VERSION = $PlannerVersion
  $env:TOOL_BINDING_MODE = $ToolBindingMode
  $env:MAX_TOOL_SCHEMAS = "$MaxToolSchemas"
  $env:TOOL_RETRIEVAL_MIN_SIM = "$ToolRetrievalMinSim"
  if ($SimulateDatadog) { $env:DATADOG_SIMULATE = '1' } else { Remove-Item Env:DATADOG_SIMULATE -ErrorAction SilentlyContinue }
  if ($StrictAnnotations) { $env:STRICT_ANNOTATIONS = '1' } else { Remove-Item Env:STRICT_ANNOTATIONS -ErrorAction SilentlyContinue }
  if ($VerboseAgentic) { $env:AGENTIC_VERBOSE = '1' } else { Remove-Item Env:AGENTIC_VERBOSE -ErrorAction SilentlyContinue }
  Write-Host "GPT_MODEL_NAME=$($env:GPT_MODEL_NAME)"; Write-Host "PLANNER_VERSION=$($env:PLANNER_VERSION)"; Write-Host "TOOL_BINDING_MODE=$($env:TOOL_BINDING_MODE)"
  Write-Host "DATADOG_SIMULATE=$($env:DATADOG_SIMULATE) STRICT_ANNOTATIONS=$($env:STRICT_ANNOTATIONS) AGENTIC_VERBOSE=$($env:AGENTIC_VERBOSE)"
  Write-Host "MAX_TOOL_SCHEMAS=$($env:MAX_TOOL_SCHEMAS) TOOL_RETRIEVAL_MIN_SIM=$($env:TOOL_RETRIEVAL_MIN_SIM)"
}

function Install-Dependencies {
  Write-Section "Installing Dependencies"
  if (-not (Test-Path "requirements.txt")) { throw "requirements.txt not found at repo root." }
  & $PythonExe -m pip install --upgrade pip
  & $PythonExe -m pip install -r requirements.txt
}

$global:BackendProcess = $null

function Start-BackendServer {
  Write-Section "Starting Backend"
  $script = "backend/app.py"
  if (-not (Test-Path $script)) { throw "Cannot find backend/app.py. Run from repo root." }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $PythonExe
  $psi.Arguments = $script
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $global:BackendProcess = New-Object System.Diagnostics.Process
  $BackendProcess.StartInfo = $psi
  [void]$BackendProcess.Start()
  Start-Sleep -Milliseconds 300
  Write-Host "Backend PID: $($BackendProcess.Id)"
  Register-ObjectEvent -InputObject $BackendProcess -EventName OutputDataReceived -Action { if ($EventArgs.Data) { Write-Host "[backend stdout] $($EventArgs.Data)" } } | Out-Null
  Register-ObjectEvent -InputObject $BackendProcess -EventName ErrorDataReceived -Action { if ($EventArgs.Data) { Write-Host "[backend stderr] $($EventArgs.Data)" -ForegroundColor Yellow } } | Out-Null
  $BackendProcess.BeginOutputReadLine(); $BackendProcess.BeginErrorReadLine()
  Write-Host "Waiting for health endpoint..."
  $ok = $false
  for ($i=0; $i -lt $HealthRetries; $i++) {
    try {
      $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 3 -ErrorAction Stop
      if ($resp.status -eq 'ok') { $ok = $true; break }
    } catch { Start-Sleep -Milliseconds $HealthDelayMs }
  }
  if (-not $ok) { Write-Warning "Health check did not pass within timeout." } else { Write-Host "Health check OK." }
}

function Run-PlannerHarness([string]$Q) {
  Write-Host "-- Harness: $Q" -ForegroundColor Cyan
  $harness = "backend/test_planner_harness.py"
  if (-not (Test-Path $harness)) { Write-Warning "Harness not found"; return }
  & $PythonExe $harness $Q
}

function Call-AgenticAPI([string]$Q) {
  Write-Host "-- API Call: $Q" -ForegroundColor Green
  $jsonBody = @{ messages = @(@{ role = "user"; content = $Q }); prompt=""; metadata=@{}; username="testuser" } | ConvertTo-Json -Depth 6
  try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/agentic_orchestrate" -Method POST -ContentType 'application/json' -Body $jsonBody -TimeoutSec 180
    ($resp | ConvertTo-Json -Depth 7) | Write-Host
  } catch { Write-Host "API call failed: $($_.Exception.Message)" -ForegroundColor Red }
}

function Tail-Logs {
  Write-Section "Tailing Logs (Ctrl+C to stop)"
  $logFiles = @('snowchat_backend.log','agentic_orchestrator.log','agentic_orchestrator_auto.log') | Where-Object { Test-Path $_ }
  if (-not $logFiles) { Write-Warning "No log files yet."; return }
  Write-Host "Files: $($logFiles -join ', ')"
  Get-Content -Path $logFiles -Tail 40 -Wait
}

function Show-Summary($QuestionsList) {
  Write-Section "Summary"
  Write-Host "PlannerVersion=$PlannerVersion BindingMode=$ToolBindingMode Strict=$StrictAnnotations SimDatadog=$SimulateDatadog" -ForegroundColor Cyan
  Write-Host "Questions processed: $($QuestionsList.Count)" -ForegroundColor Cyan
  if ($BackendProcess) { Write-Host "Backend PID: $($BackendProcess.Id)" }
}

# ----------------- MAIN -----------------
try {
  # Load backend/.env BEFORE setting/validating required keys
  Load-DotEnvIfPresent
  $questionsList = Load-Questions
  Set-Env
  if ($InstallDeps) { Install-Dependencies }
  if ($StartBackend) { Start-BackendServer }
  if ($RunHarness) { foreach ($q in $questionsList) { Run-PlannerHarness -Q $q } }
  if ($CallAPI) {
    if (-not $BackendProcess) { Write-Warning "Backend not started; starting automatically."; Start-BackendServer }
    foreach ($q in $questionsList) { Call-AgenticAPI -Q $q }
  }
  if ($TailLogs) { Tail-Logs }
  Show-Summary -QuestionsList $questionsList
}
catch {
  Write-Host "[FATAL] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
