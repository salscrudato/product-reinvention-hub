<#!
Snowchat Unified Startup (PowerShell Edition)

Parameters:
  -Debug        : Verbose diagnostic output
  -Backend      : Auto start backend (Flask)
  -NoKafka      : Skip Kafka (spool events)
  -Quick        : Alias for -NoKafka
  -Log          : Write combined log to snowchat_backend.log
  -NoFrontend   : Skip React dev server
  -NoKeycloak   : Skip Keycloak

Environment variables honored:
  KAFKA_HOME, KAFKA_PORT, KEYCLOAK_HOME, KAFKA_RAW_TOPIC

Exit Codes:
  0 success (summary reached)
  1 missing hard dependency (Python)
  2 unexpected internal error
!#>
[CmdletBinding()]param(
    [switch]$Debug,
    [switch]$Backend,
    [switch]$NoKafka,
    [switch]$Quick,
    [switch]$Log,
    [switch]$NoFrontend,
    [switch]$NoKeycloak
)

$ErrorActionPreference = 'Stop'
$host.UI.RawUI.WindowTitle = "Snowchat Startup" + ($(if($Debug){' [DEBUG]'} else {''}))

# ---------------- Configuration & Helpers ----------------
$Global:LogFile = Join-Path -Path (Get-Location) -ChildPath 'snowchat_backend.log'
if($Log){ if(Test-Path $LogFile){ Remove-Item $LogFile -Force -ErrorAction SilentlyContinue } }
$Summary = [ordered]@{
    Kafka          = 'false'
    KafkaPort      = ''
    Keycloak       = '0'
    Frontend       = '0'
    BackendAuto    = $(if($Backend){'1'} else {'0'})
    KafkaRawTopic  = ($env:KAFKA_RAW_TOPIC | ForEach-Object { if($_){$_} else {'crew-raw-events'} })
    Version        = 'ps1-1'
}

function Write-Log {
    param([string]$Message,[string]$Level='INFO')
    $stamp = (Get-Date).ToString('u')
    $line = "[$Level] $Message"
    if($Debug){ Write-Host $line } elseif($Level -in 'ERROR','WARN'){ Write-Host $line }
    if($Log){ Add-Content -Path $LogFile -Value "$stamp $line" }
}
function Write-DebugMsg { if($Debug){ Write-Log -Message $args[0] -Level 'DBG' } }

function Test-Port { param([int]$Port,[string]$Host='localhost',[int]$TimeoutMs=1200)
    try{
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($Host,$Port,$null,$null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs) -and $client.Connected
        $client.Close(); return $ok
    }catch{ return $false }
}

function Ensure-Topics {
    param([int]$Port)
    if(-not $Script:KafkaPython){ Write-Log "kafka-python not available; skipping topic ensure" 'WARN'; return $false }
    try {
        $rc = & python -m kafka_scripts.create_topics 2>$null; if($LASTEXITCODE -eq 0){ Write-Log "Topics ensured" 'INFO'; return $true } else { Write-Log "Topic creation non-zero exit $LASTEXITCODE" 'WARN'; return $false }
    } catch { Write-Log "Topic ensure exception: $($_.Exception.Message)" 'WARN'; return $false }
}

# --------------- Parse composite flags ---------------
if($Quick){ $NoKafka = $true }

Write-Log (if($Debug){'DEBUG mode enabled'} else {'Startup'}) 'INFO'
Write-DebugMsg "Args Debug=$Debug Backend=$Backend NoKafka=$NoKafka Quick=$Quick Log=$Log NoFrontend=$NoFrontend NoKeycloak=$NoKeycloak"

# --------------- Python detection ---------------
$python = Get-Command python -ErrorAction SilentlyContinue
if(-not $python){ Write-Log 'Python not found' 'ERROR'; exit 1 }
try { & python -c "import kafka" 2>$null; if($LASTEXITCODE -eq 0){ $Script:KafkaPython = $true } else { $Script:KafkaPython = $false } }
catch { $Script:KafkaPython = $false }
if(-not $Script:KafkaPython){ Write-Log 'kafka-python missing; event streaming may be disabled' 'WARN' }

# --------------- Kafka strategy ---------------
$KafkaEnabled = $false
$KafkaPort = if($env:KAFKA_PORT){ [int]$env:KAFKA_PORT } else { 9092 }
$Summary.KafkaPort = $KafkaPort
if($NoKafka){ Write-Log 'Kafka skipped by flag (spooling)' 'INFO' }
else {
    # Detect native
    if(-not $env:KAFKA_HOME){
        $candidate = 'C:\dev\kafka\bin\windows\kafka-server-start.bat'
        if(Test-Path $candidate){ $env:KAFKA_HOME = 'C:\dev\kafka' }
    }
    if($env:KAFKA_HOME){
        Write-Log "Native Kafka detected at $($env:KAFKA_HOME)" 'INFO'
        if(-not (Test-Port -Port $KafkaPort -TimeoutMs 800)){
            $zkBat = Join-Path $env:KAFKA_HOME 'bin\windows\zookeeper-server-start.bat'
            $broBat = Join-Path $env:KAFKA_HOME 'bin\windows\kafka-server-start.bat'
            if((Test-Path $zkBat) -and (Test-Path $broBat)){
                Write-Log "Starting Zookeeper & Broker..." 'INFO'
                Start-Process cmd /k "call `"$zkBat`" `"$env:KAFKA_HOME\config\zookeeper.properties`"" | Out-Null
                Start-Sleep -Seconds 5
                Start-Process cmd /k "call `"$broBat`" `"$env:KAFKA_HOME\config\server.properties`"" | Out-Null
                Write-Log "Waiting for Kafka port $KafkaPort" 'INFO'
                $tries=0; while($tries -lt 25 -and -not (Test-Port -Port $KafkaPort)){ Start-Sleep -Seconds 2; $tries++ }
                if(-not (Test-Port -Port $KafkaPort)){ Write-Log "Port $KafkaPort unreachable; spooling fallback" 'WARN' }
                else { $KafkaEnabled = $true }
            } else { Write-Log 'Missing native kafka scripts; skipping' 'WARN' }
        } else { Write-Log "Broker already running on $KafkaPort" 'INFO'; $KafkaEnabled = $true }
    } elseif(Test-Path 'kafka\docker-compose.yml') {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if($docker){
            Write-Log 'Starting docker compose Kafka stack' 'INFO'
            Push-Location kafka
            try { & docker compose up -d 2>$null } catch { try { & docker-compose up -d 2>$null } catch { Write-Log 'Docker compose up failed' 'WARN' } }
            Pop-Location
            $tries=0; while($tries -lt 25 -and -not (Test-Port -Port 9092)){ Start-Sleep -Seconds 2; $tries++ }
            if(Test-Port -Port 9092){ $KafkaEnabled = $true; $Summary.KafkaPort = 9092 } else { Write-Log 'Docker broker unreachable; spooling fallback' 'WARN' }
        } else { Write-Log 'Docker not on PATH; skipping Kafka docker' 'INFO' }
    } else {
        Write-Log 'No native or docker Kafka; spooling fallback' 'INFO'
    }
}

if($KafkaEnabled){
    if(Ensure-Topics -Port $KafkaPort){ $KafkaEnabled = $true } else { Write-Log 'Topic ensure failed (continuing with spool if needed)' 'WARN' }
}
$Summary.Kafka = $(if($KafkaEnabled){'true'} else {'false'})

# --------------- Keycloak ---------------
$KeycloakOk = 0
if($NoKeycloak){ Write-Log 'Keycloak skipped by flag' 'INFO' }
else {
    if(Test-Path 'start-keycloak.bat'){
        Write-Log 'Launching Keycloak via start-keycloak.bat' 'INFO'
        Start-Process cmd /k "call start-keycloak.bat" | Out-Null
        $KeycloakOk = 1
    } elseif($env:KEYCLOAK_HOME){
        $kc = Join-Path $env:KEYCLOAK_HOME 'bin\kc.bat'
        if(Test-Path $kc){
            Write-Log "Launching Keycloak from KEYCLOAK_HOME=$($env:KEYCLOAK_HOME)" 'INFO'
            Start-Process cmd /k "cd /d `"$($env:KEYCLOAK_HOME)\bin`" && kc.bat start-dev" | Out-Null
            $KeycloakOk = 1
        } else { Write-Log 'KEYCLOAK_HOME set but kc.bat missing' 'WARN' }
    } else { Write-Log 'Keycloak not started (no script / KEYCLOAK_HOME)' 'INFO' }
}
$Summary.Keycloak = $KeycloakOk

# --------------- Frontend ---------------
$FrontendOk = 0
if($NoFrontend){ Write-Log 'Frontend skipped by flag' 'INFO' }
else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if($node -and $npm -and (Test-Path 'frontend/package.json')){
        if(-not (Test-Path 'frontend/node_modules')){
            Write-Log 'Installing frontend dependencies' 'INFO'
            Push-Location frontend
            if($Debug){ & npm install } else { & npm install *> ..\frontend-install.log }
            Pop-Location
        }
        if(Test-Path 'frontend/node_modules'){
            Write-Log 'Starting React dev server' 'INFO'
            Start-Process cmd /k "cd frontend && npm start" | Out-Null
            $FrontendOk = 1
        } else { Write-Log 'node_modules missing after install attempt' 'ERROR' }
    } else { Write-Log 'Frontend prerequisites missing (node/npm/package.json)' 'INFO' }
}
$Summary.Frontend = $FrontendOk

# --------------- Backend ---------------
if($Backend){
    Write-Log 'Starting backend (Flask)' 'INFO'
    $env:FLASK_APP = 'backend/app.py'
    Start-Process cmd /k "python backend/app.py" | Out-Null
} else { Write-Log "Backend not auto-started (use -Backend)" 'INFO' }

# --------------- Summary ---------------
Write-Host "`n================= SUMMARY =================" -ForegroundColor Cyan
Write-Host ("Kafka........: {0} (port={1})" -f $Summary.Kafka,$Summary.KafkaPort)
Write-Host ("Keycloak.....: {0}" -f $Summary.Keycloak)
Write-Host ("Frontend.....: {0}" -f $Summary.Frontend)
Write-Host ("Backend Auto.: {0}" -f $Summary.BackendAuto)
Write-Host ("Raw Topic....: {0}" -f $Summary.KafkaRawTopic)
Write-Host ("Version......: {0}" -f $Summary.Version)
Write-Host "===========================================" -ForegroundColor Cyan

if($Log){
    Add-Content -Path $LogFile -Value "SUMMARY: $(ConvertTo-Json $Summary -Compress)"
    Write-Host "Log written to $LogFile"
}

exit 0

trap {
    Write-Log "Unhandled error: $($_.Exception.Message)" 'ERROR'
    if($Log){ Add-Content -Path $LogFile -Value "FATAL: $($_ | Out-String)" }
    exit 2
}
