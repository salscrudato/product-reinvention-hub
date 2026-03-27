# Setup Windows Task Scheduler for Automated ML Retraining
# This script creates a scheduled task to run retrain_pipeline.py weekly

param(
    [string]$TaskName = "SnowChat_ML_Retraining",
    [string]$Description = "Automated ML Intent Classifier Retraining",
    [string]$Schedule = "Weekly",
    [string]$DayOfWeek = "Sunday",
    [string]$Time = "02:00",
    [switch]$Force,
    [switch]$RunNow
)

# Get paths
$BackendDir = Split-Path -Parent $PSScriptRoot
$PythonScript = Join-Path $BackendDir "scripts\retrain_pipeline.py"
$LogDir = Join-Path $BackendDir "logs"

# Create logs directory if it doesn't exist
if (!(Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
    Write-Host "[OK] Created logs directory: $LogDir" -ForegroundColor Green
}

# Get Python executable path (try conda first, then system python)
$PythonExe = $null
try {
    $condaEnv = conda info --envs | Select-String "devpilot" | ForEach-Object { $_.Line -split '\s+' | Where-Object { $_ -match '^[A-Z]:\\' } }
    if ($condaEnv) {
        $PythonExe = Join-Path $condaEnv "python.exe"
        Write-Host "[OK] Found Conda Python: $PythonExe" -ForegroundColor Green
    }
} catch {
    Write-Host "[WARN] Conda not found, trying system Python..." -ForegroundColor Yellow
}

if (!$PythonExe -or !(Test-Path $PythonExe)) {
    $PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
    if ($PythonExe) {
        Write-Host "[OK] Found System Python: $PythonExe" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Python not found. Please ensure Python is installed and in PATH." -ForegroundColor Red
        exit 1
    }
}

# Verify script exists
if (!(Test-Path $PythonScript)) {
    Write-Host "[ERROR] Script not found: $PythonScript" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== SnowChat ML Retraining Task Scheduler Setup ===" -ForegroundColor Cyan
Write-Host "Task Name: $TaskName"
Write-Host "Schedule: $Schedule at $Time on $DayOfWeek"
Write-Host "Python: $PythonExe"
Write-Host "Script: $PythonScript"
Write-Host ""

# Check if task already exists
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($ExistingTask) {
    if ($Force) {
        Write-Host "[WARN] Task already exists. Force flag set, removing old task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    } else {
        Write-Host "[ERROR] Task '$TaskName' already exists. Use -Force to overwrite." -ForegroundColor Red
        exit 1
    }
}

# Build task action (command to run)
$ActionArgs = @(
    $PythonScript,
    "--notify"
)

$Action = New-ScheduledTaskAction `
    -Execute $PythonExe `
    -Argument ($ActionArgs -join ' ') `
    -WorkingDirectory $BackendDir

# Build trigger based on schedule type
$Trigger = switch ($Schedule) {
    "Weekly" {
        $TriggerTime = [DateTime]::Parse($Time)
        New-ScheduledTaskTrigger `
            -Weekly `
            -DaysOfWeek $DayOfWeek `
            -At $TriggerTime
    }
    "Daily" {
        $TriggerTime = [DateTime]::Parse($Time)
        New-ScheduledTaskTrigger `
            -Daily `
            -At $TriggerTime
    }
    default {
        Write-Host "❌ ERROR: Unsupported schedule type: $Schedule" -ForegroundColor Red
        exit 1
    }
}

# Task settings
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 10)

# Task principal (run with current user privileges)
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

# Register the task
try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Description $Description `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Force | Out-Null
    
    Write-Host "[SUCCESS] Task '$TaskName' created successfully!" -ForegroundColor Green
    Write-Host ""
    
    # Display task info
    Write-Host "Task Details:" -ForegroundColor Cyan
    Write-Host "  Status: Ready"
    Write-Host "  Next Run: $(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Select-Object -ExpandProperty NextRunTime)"
    Write-Host "  Last Run: $(Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo | Select-Object -ExpandProperty LastRunTime)"
    Write-Host ""
    
    # Optionally run now
    if ($RunNow) {
        Write-Host "[RUN] Running task now..." -ForegroundColor Yellow
        Start-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 3
        
        $TaskInfo = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
        Write-Host "  Last Result: $($TaskInfo.LastTaskResult)" -ForegroundColor $(if ($TaskInfo.LastTaskResult -eq 0) { "Green" } else { "Red" })
        Write-Host ""
    }
    
    Write-Host "Useful Commands:" -ForegroundColor Cyan
    Write-Host "  View task:        Get-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  Run task now:     Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  View history:     Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    Write-Host "  Remove task:      Unregister-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  View logs:        Get-Content '$LogDir\retrain_pipeline.log' -Tail 50"
    Write-Host ""
    
} catch {
    Write-Host "[ERROR] Failed to create scheduled task" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
