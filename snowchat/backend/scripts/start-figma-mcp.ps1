param(
    [string]$Token,
    [string]$FileKey
)

function Write-Status {
    param([string]$Message)
    [Console]::Error.WriteLine($Message)
}

if (-not $Token) {
    $Token = $env:FIGMA_ACCESS_TOKEN
    if (-not $Token) {
        $Token = $env:FIGMA_TOKEN
    }
}

if (-not $Token) {
    $Token = Read-Host "Enter Figma access token (starts with figd_)"
}

if (-not $FileKey) {
    $FileKey = $env:FIGMA_FILE_KEY
}

if (-not $FileKey) {
    $FileKey = Read-Host "Enter Figma file key"
}

if ($Token) {
    $Token = $Token.Trim()
} else {
    $Token = ""
}

if ($FileKey) {
    $FileKey = $FileKey.Trim()
} else {
    $FileKey = ""
}

if (-not $Token) {
    throw "Figma access token is required."
}

if (-not $FileKey) {
    throw "Figma file key is required."
}

$env:FIGMA_ACCESS_TOKEN = $Token
$env:FIGMA_TOKEN = $Token
$env:FIGMA_FILE_KEY = $FileKey

Write-Status "Activating devpilot environment via conda run..."

$conda = Get-Command conda -ErrorAction SilentlyContinue
if (-not $conda) {
    throw "conda is not available in the current session. Ensure Miniconda or Anaconda is installed and conda init has been run."
}

$tokenPreviewLength = [Math]::Min(8, $Token.Length)
$tokenPreview = if ($tokenPreviewLength -gt 0) { $Token.Substring(0, $tokenPreviewLength) } else { "" }

Write-Status ("Token (first 8 chars): {0}..." -f $tokenPreview)
Write-Status ("File Key: {0}" -f $FileKey)
Write-Status "Launching Figma MCP server..."

$pythonArgs = @(
    "run",
    "-n",
    "devpilot",
    "python",
    "-m",
    "mcp_figma.server",
    "--token",
    $Token,
    "--file-key",
    $FileKey
)

$condaInvoker = switch ($conda.CommandType) {
    "Application" { $conda.Source }
    Default { $conda.Name }
}

& $condaInvoker @pythonArgs