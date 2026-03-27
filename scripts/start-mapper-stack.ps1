# Start SnowChat Backend + Mapper Frontend together
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-mapper-stack.ps1

$backendDir = 'C:\dev\snowchat\backend'
$mapperDir = 'C:\dev\mapper'

Write-Host "[1/2] Starting SnowChat Backend (port 5000)..." -ForegroundColor Cyan

# Start backend in minimized window
$backendScript = @"
conda activate devpilot
cd $backendDir
python app.py
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript -WindowStyle Minimized

Write-Host "Waiting 10 seconds for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host "[2/2] Starting Mapper Frontend (port 3000)..." -ForegroundColor Cyan

# Start frontend in minimized window
$frontendScript = @"
cd $mapperDir
npm run dev
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript -WindowStyle Minimized

Write-Host "`n✅ Both services started!" -ForegroundColor Green
Write-Host "  Backend:  http://localhost:5000" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "`nCheck the minimized windows for logs." -ForegroundColor Yellow
