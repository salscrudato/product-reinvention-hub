<#
Deduplicate xpack.security blocks in elasticsearch.yml safely.
Creates a timestamped backup and keeps the last occurrence of xpack.security.* entries.
Usage: .\dedup-elasticsearch-yml.ps1 -Apply
#>
[CmdletBinding()]
param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [switch]$Apply
)
$EsYml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $EsYml)) { Write-Error "Missing $EsYml"; exit 2 }

$raw = Get-Content -Raw -Path $EsYml -ErrorAction Stop
$lines = $raw -split "\r?\n"

# Collect indices of lines that contain xpack.security entries
$pattern = '^(\s*)xpack\.security(\.|:)' # lines starting xpack.security or xpack: \n constructs
$occurrences = @()
for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) { $occurrences += $i }
}

if ($occurrences.Count -le 1) {
    Write-Host "No duplicate xpack.security top-level blocks detected (count=$($occurrences.Count)). No action needed."
    if (-not $Apply) { exit 0 } else { Write-Host "Nothing to apply."; exit 0 }
}

Write-Host "Found $($occurrences.Count) xpack.security occurrences at line indexes: $($occurrences -join ', ')"

# Strategy: keep the last occurrence; remove earlier occurrences until the last block's start.
$keepIndex = $occurrences[-1]
Write-Host "Keeping block starting at line index $keepIndex (1-based: $([int]($keepIndex+1)))"

# Remove all earlier xpack.security blocks: define a helper to remove a block starting at idx
function Remove-BlockAt([int]$startIdx) {
    # Remove from startIdx downwards until a blank line followed by non-indented or until a top-level comment
    $j = $startIdx
    while ($j -lt $lines.Count) {
        $line = $lines[$j]
        # End of block heuristic: next top-level key (no leading space) OR blank line with next non-indented
        if ($j -ne $startIdx -and $line -match '^[^\s#]') { break }
        $j++
    }
    # Remove lines from startIdx to j-1
    $count = $j - $startIdx
    if ($count -gt 0) {
        for ($k=0; $k -lt $count; $k++) { $lines[$startIdx] = $null; $startIdx++ }
    }
}

# Remove occurrences before keepIndex, iterate from earliest to right before keepIndex
$toRemove = $occurrences | Where-Object { $_ -lt $keepIndex }
if ($toRemove.Count -eq 0) { Write-Host "No earlier blocks to remove." }
else {
    # Remove from last earlier to first to preserve indices
    foreach ($idx in ($toRemove | Sort-Object -Descending)) {
        Write-Host "Removing block at index $idx (line $([int]($idx+1)))"
        Remove-BlockAt $idx
    }
}

# Rebuild file without $null entries
$newLines = $lines | Where-Object { $_ -ne $null }

if (-not $Apply) {
    Write-Host "Dry run: changes would produce $($newLines.Count) lines (original $($lines.Count))."
    Write-Host "Run with -Apply to write changes and create a backup."
    exit 0
}

$bak = "$EsYml.$((Get-Date).ToString('yyyyMMddHHmmss')).dedup.bak"
Copy-Item -Path $EsYml -Destination $bak -Force
$newLines | Out-File -FilePath $EsYml -Encoding utf8 -Force
Write-Host "Wrote cleaned elasticsearch.yml (backup saved to $bak)"
