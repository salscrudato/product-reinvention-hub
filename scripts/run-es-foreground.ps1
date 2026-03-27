# Run Elasticsearch in foreground to observe startup logs
param(
    [string]$EsHome = 'C:\dev\elasticsearch-9.1.4'
)
Set-Location $EsHome
Write-Host "Running Elasticsearch in foreground from $EsHome\bin\elasticsearch.bat"
& "$EsHome\bin\elasticsearch.bat"
Write-Host "Elasticsearch process exited."