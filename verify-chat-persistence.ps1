# Quick Verification Script
# Run this after sending a message to verify chat persistence

$ErrorActionPreference = "Stop"

Write-Host "`n╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  CHAT PERSISTENCE VERIFICATION                     ║" -ForegroundColor Yellow
Write-Host "╚════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Check backend logs for save confirmation
Write-Host "1. Checking Backend Logs..." -ForegroundColor Cyan
$recentLogs = Get-Content C:\dev\snowchat\backend\agentic_orchestrator_auto.log -Tail 50
$saveSuccess = $recentLogs | Select-String "Chat messages saved successfully"
$incoming = $recentLogs | Select-String "INCOMING REQUEST"

if ($incoming) {
    Write-Host "   ✅ Backend received request" -ForegroundColor Green
    $incoming | Select-Object -Last 1 | ForEach-Object { Write-Host "      $($_.Line.Substring(0, [Math]::Min(100, $_.Line.Length)))..." -ForegroundColor Gray }
} else {
    Write-Host "   ❌ No recent requests found" -ForegroundColor Red
}

if ($saveSuccess) {
    Write-Host "   ✅ Chat messages saved to TinyDB!" -ForegroundColor Green
    $saveSuccess | Select-Object -Last 1 | ForEach-Object { Write-Host "      $($_.Line.Substring(0, [Math]::Min(100, $_.Line.Length)))..." -ForegroundColor Gray }
} else {
    Write-Host "   ⚠️  No save confirmation found (check if message was sent)" -ForegroundColor Yellow
}

Write-Host "`n2. Checking TinyDB Database..." -ForegroundColor Cyan
Push-Location C:\dev\snowchat\backend

try {
    $pythonOutput = & python -c @"
from tinydb import TinyDB, Query
db = TinyDB('state_db.json')
chat = db.table('chat_history')
all_msgs = chat.all()
print(f'Total messages: {len(all_msgs)}')

if len(all_msgs) > 0:
    # Group by username
    from collections import defaultdict
    by_user = defaultdict(int)
    for msg in all_msgs:
        by_user[msg.get('username', 'unknown')] += 1
    
    print('\\nMessages by user:')
    for user, count in by_user.items():
        print(f'  {user}: {count} messages')
    
    # Show last 3 messages
    print('\\nLast 3 messages:')
    for msg in all_msgs[-3:]:
        sender = msg.get('sender', '?')
        username = msg.get('username', '?')
        text = str(msg.get('text', ''))[:80]
        timestamp = msg.get('timestamp', 0)
        print(f'  [{sender}] {username}: {text}...')
else:
    print('Database is empty - no messages saved yet')
"@

    $pythonOutput | ForEach-Object {
        if ($_ -match "Total messages: 0") {
            Write-Host "   ⚠️  $_ (Send a message first)" -ForegroundColor Yellow
        } elseif ($_ -match "Total messages:") {
            Write-Host "   ✅ $_" -ForegroundColor Green
        } else {
            Write-Host "   $_" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "   ❌ Error checking database: $_" -ForegroundColor Red
}

Pop-Location

Write-Host "`n3. CORS Test..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5000/session/init" -Method POST `
        -Headers @{'Origin'='http://localhost:8081'; 'Content-Type'='application/json'} `
        -Body '{"user_id":"test"}' -UseBasicParsing
    
    $corsHeader = $response.Headers['Access-Control-Allow-Origin']
    if ($corsHeader -eq 'http://localhost:8081') {
        Write-Host "   ✅ CORS working correctly: $corsHeader" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  CORS header: $corsHeader" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ CORS test failed: $_" -ForegroundColor Red
}

Write-Host "`n╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  NEXT STEPS                                        ║" -ForegroundColor Yellow
Write-Host "╚════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

Write-Host "If database shows 0 messages:" -ForegroundColor Yellow
Write-Host "  1. Send a test message in the chat" -ForegroundColor White
Write-Host "  2. Run this script again`n" -ForegroundColor White

Write-Host "If messages are saved (>0):" -ForegroundColor Green
Write-Host "  1. Logout from DevCopilot" -ForegroundColor White
Write-Host "  2. Login again as snow_admin" -ForegroundColor White
Write-Host "  3. Chat history should restore automatically!`n" -ForegroundColor White

Write-Host "To monitor logs in real-time:" -ForegroundColor Cyan
Write-Host "  Get-Content C:\dev\snowchat\backend\agentic_orchestrator_auto.log -Wait -Tail 20`n" -ForegroundColor Gray
