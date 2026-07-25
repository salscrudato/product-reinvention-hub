# scripts/start-local.ps1 — boot the server locally from keys.md
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1

$root     = Split-Path $PSScriptRoot -Parent
$keysFile = Join-Path $root 'keys.md'

if (-not (Test-Path $keysFile)) {
    Write-Error "keys.md not found at $keysFile"
    exit 1
}

$keys = Get-Content $keysFile -Raw

# ONE generic parse of the keys.md tables — identical semantics to scripts/dev.mjs:
# rows of `VAR` | `value`, fill-only (an existing shell value always wins), values
# never printed. Hand-written per-variable patterns were silently missing vars whose
# row prose did not match the guessed shape (COSMOS_KEY's row reads ", primary)"
# BEFORE the var name, so /api/ai never mounted); one shared pattern cannot drift.
# Single-quoted so PS5 treats the backticks as literal, not escape characters.
$rx     = [regex]'`([A-Z][A-Z0-9_]{2,})`[^|\r\n]*\|\s*`([^`]+)`'
$filled = @()
foreach ($m in $rx.Matches($keys)) {
    $name  = $m.Groups[1].Value
    $value = $m.Groups[2].Value
    if (-not [System.Environment]::GetEnvironmentVariable($name)) {
        [System.Environment]::SetEnvironmentVariable($name, $value)
        $filled += $name
    }
}
if ($filled.Count -gt 0) {
    Write-Host "[start-local] env filled from keys.md: $($filled -join ', ')"
} else {
    Write-Host '[start-local] keys.md present; every var already set in the shell.'
}

$env:AZURE_BLOB_CONTAINER = 'uploads'
if (-not $env:PORT) { $env:PORT = '8080' }

# SAFETY (mirrors scripts/dev.mjs): cosmos.js falls back to the LIVE demo database
# 'prodhub' whenever COSMOS_DB is unset, so pin the isolated workstream DB unless an
# explicit non-prod value already came from keys.md or the shell.
$isolatedDb = 'prodhub-sal'
if ((-not $env:COSMOS_DB) -or ($env:COSMOS_DB -eq 'prodhub')) {
    if ($env:COSMOS_DB -eq 'prodhub') {
        Write-Warning "[start-local] COSMOS_DB was 'prodhub' (the LIVE demo) - overriding to '$isolatedDb'."
    }
    $env:COSMOS_DB = $isolatedDb
}
Write-Host "[start-local] Cosmos database: $($env:COSMOS_DB)  (isolated workstream - never the live 'prodhub')."

# The host refuses to boot without a JWT secret (server/lib/otp.js) and keys.md does
# not carry one - it is per-environment, not a shared service credential. An ephemeral
# random secret is correct for local dev; set AUTH_JWT_SECRET in your shell to keep
# sessions across restarts.
if (-not $env:AUTH_JWT_SECRET) {
    $bytes = New-Object 'System.Byte[]' 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $env:AUTH_JWT_SECRET = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    Write-Host '[start-local] AUTH_JWT_SECRET not set - generated an ephemeral dev secret (sessions reset on restart).'
}

Write-Host "[start-local] credentials loaded - starting server on port $($env:PORT)"

$serverJs = Join-Path $root 'server/server.js'
node $serverJs
