Param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4',
    [int]$Lines = 200
)

$yml = Join-Path $EsHome 'config\elasticsearch.yml'
if (-not (Test-Path $yml)) { Write-Host "Missing: $yml" -ForegroundColor Red; exit 1 }
$all = Get-Content -Path $yml -ErrorAction Stop | Select-Object -First $Lines
for ($i = 0; $i -lt $all.Length; $i++) {
    $ln = $i + 1
    $text = $all[$i]
    Write-Host ("{0,4}: {1}" -f $ln, $text)
}
