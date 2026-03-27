# Health Status Icon - User Guide

## What is the Health Status Icon?

A visual indicator in the top-right corner of the SnowChat application that shows the real-time health of external integrations (ServiceNow, Wiki, JIRA).

## Icon Colors & Meanings

### 🟢 Green CheckCircle Icon
**Status:** All services healthy  
**Meaning:** ServiceNow, Wiki, and JIRA are operational and authenticated  
**Action:** No action needed - system ready for queries

### 🟡 Yellow Warning Icon
**Status:** One or more services degraded  
**Meaning:** Services partially working but experiencing issues (slow response, unexpected formats)  
**Action:** Click icon to see which service has issues; queries may be slower or fail

### 🔴 Red Error Icon
**Status:** One or more services down  
**Meaning:** Service is unreachable, not authenticated, or completely unavailable  
**Action:** Click icon for details; contact admin if issue persists

### 🔵 Blue Spinner
**Status:** Checking services...  
**Meaning:** First health check in progress (app just loaded)  
**Action:** Wait 3-5 seconds for status to update

## How to Use

### Step 1: Check Status at a Glance
Look at the icon in the header (top-right corner). If green, all systems are operational.

### Step 2: Click Icon for Details
Click the health icon to see a detailed popup showing:
- **Overall Status:** healthy/degraded/down
- **ServiceNow:** Connection status, response time, authentication
- **Wiki RAG:** Index status, document count
- **JIRA:** Connection status, authentication (if configured)

### Step 3: Interpret Error Messages
Common error messages and what they mean:

#### ServiceNow Errors
- **"Authentication failed (401)"** → Invalid credentials; contact admin to update SERVICENOW_PASSWORD
- **"Request timeout (>5s)"** → ServiceNow instance slow or unreachable; check network/VPN
- **"Connection error"** → Cannot reach ServiceNow; verify SERVICENOW_INSTANCE URL
- **"JSON parse error"** → ServiceNow returning invalid data; likely auth or API version issue

#### Wiki RAG Errors
- **"FAISS index file not found"** → Index not built; admin needs to run vectorization script
- **"Index is empty"** → Index exists but has no documents; reindex Confluence wiki
- **"Failed to load index"** → File corrupted; delete and rebuild index

#### JIRA Errors
- **"JIRA credentials not configured"** → Expected if JIRA not used; no action needed
- **"Authentication failed (401)"** → Invalid JIRA_API_TOKEN; admin needs to update credentials
- **"Request timeout"** → JIRA server slow or unreachable

### Step 4: Wait for Auto-Refresh
The health status automatically refreshes every 30 seconds. After admin fixes an issue:
1. Wait up to 30 seconds
2. Icon should change from red/yellow to green
3. If still red, click icon to see updated error message

### Step 5: When to Contact Admin
Contact your admin if:
- Icon is red for > 5 minutes
- ServiceNow shows "Authentication failed"
- Wiki shows "Index file not found"
- Response times consistently > 5 seconds

## Example Scenarios

### Scenario 1: ServiceNow Down Before Query
**What You See:**
- Red icon in header

**What You Do:**
1. Click icon
2. See "ServiceNow: Authentication failed (401)"
3. Don't attempt incident queries (they will fail)
4. Contact admin or wait for fix

**Result:** Saved time by not debugging failed queries

### Scenario 2: Wiki Degraded
**What You See:**
- Yellow icon in header

**What You Do:**
1. Click icon
2. See "Wiki RAG: Index is empty"
3. Avoid using @wiki annotations
4. Notify admin to reindex

**Result:** Understand why @wiki queries return no results

### Scenario 3: All Systems Operational
**What You See:**
- Green icon in header

**What You Do:**
1. Proceed with normal queries
2. Confidence that ServiceNow/Wiki/JIRA integrations are working

**Result:** Peace of mind when submitting queries

## Popup Details Explained

### Overall Status Badge
- **Green chip:** "Overall: healthy" - All services operational
- **Yellow chip:** "Overall: degraded" - At least one service has issues
- **Red chip:** "Overall: down" - At least one service completely unavailable

### Service Status Icons
Each service shows an icon indicating its health:
- ✅ **Green checkmark:** Service healthy
- ⚠️ **Yellow warning:** Service degraded
- ❌ **Red X:** Service down

### Service Details
**ServiceNow:**
- **Status:** healthy/degraded/down
- **Response:** Time in milliseconds (e.g., "771ms")
- **Authenticated:** Green badge if successfully logged in
- **Error:** Red text showing specific error message

**Wiki RAG:**
- **Status:** healthy/degraded/down
- **Documents:** Number of indexed Confluence pages (e.g., "26")
- **Index Loaded:** Green badge if FAISS index successfully loaded
- **Error:** Red text showing specific error message

**JIRA:**
- **Status:** healthy/degraded/down
- **Response:** Time in milliseconds (only if configured)
- **Authenticated:** Green badge if successfully logged in
- **Error:** Red text showing specific error message

### Last Checked Timestamp
Bottom of popup shows when health was last verified:
- Example: "Last checked: 4:48:55 PM"
- Updates automatically every 30 seconds

## Troubleshooting

### Icon Not Appearing
- **Cause:** Frontend not connected to backend
- **Fix:** Verify backend running on http://localhost:5000, refresh browser

### Icon Stuck on Blue Spinner
- **Cause:** Cannot reach /api/integrations/health endpoint
- **Fix:** Check browser console for CORS errors, verify backend started

### Icon Shows Red But Queries Work
- **Cause:** Health check stricter than actual query requirements
- **Fix:** Ignore if queries succeed; report if inconsistent behavior

### Icon Shows Green But Queries Fail
- **Cause:** Health check passed but specific query has issues
- **Fix:** Health checks basic connectivity; report issue to admin

### Popup Won't Open
- **Cause:** JavaScript error or Material UI issue
- **Fix:** Refresh browser, check console for errors

## Best Practices

1. **Check Before Heavy Workflows:** Before running complex multi-step queries, verify green status
2. **Monitor During Critical Operations:** Keep eye on icon when processing important incidents
3. **Report Persistent Issues:** If icon red for > 1 hour, escalate to admin
4. **Don't Panic on Yellow:** Degraded doesn't mean broken - queries may still work but slower
5. **Trust the Icon:** If red, don't waste time debugging queries - system is down

## Admin Notes

### Forcing Manual Refresh
To force immediate health check (instead of waiting 30s):
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Run: `window.location.reload()`
4. Or just refresh the page (Ctrl+R / Cmd+R)

### Health Check Logs
All health checks logged to `backend/agentic_orchestrator_auto.log`:
```
2026-02-04 16:48:17 INFO agentic_orchestrator_auto.health_check: [HealthCheck] ServiceNow healthy | 771ms
2026-02-04 16:48:22 INFO agentic_orchestrator_auto.health_check: [HealthCheck] Wiki healthy | 0 vectors, 26 docs
```

Search logs for `[HealthCheck]` to see historical health status.

### Disabling Health Checks
If health checks cause issues, temporarily disable by:
1. Comment out `<HealthStatus />` line in `frontend/src/MainTabs.jsx`
2. Rebuild frontend: `npm run build`

**Note:** Not recommended - health checks are lightweight (< 5s total)

## FAQ

**Q: Why is JIRA always red?**  
A: JIRA is optional. If your deployment doesn't use JIRA, red status is expected and safe to ignore.

**Q: How often does it check?**  
A: Every 30 seconds automatically. Manual checks happen when clicking icon.

**Q: Does checking affect performance?**  
A: Minimal impact. Health checks use lightweight API calls (single incident fetch for ServiceNow, index metadata for Wiki).

**Q: Can I see historical health?**  
A: Not in UI currently. Check backend logs for historical health check results.

**Q: What if all icons are green but I still have issues?**  
A: Health checks verify basic connectivity, not query syntax or data quality. Your query may have other issues (syntax, permissions, data filters).

## Keyboard Shortcuts
(Future enhancement - not implemented yet)
- **Alt+H:** Toggle health status popup
- **Alt+Shift+H:** Force manual health refresh

## Related Documentation
- [HEALTH_CHECK_SYSTEM.md](HEALTH_CHECK_SYSTEM.md) - Technical architecture
- [HEALTH_CHECK_IMPLEMENTATION_SUMMARY.md](HEALTH_CHECK_IMPLEMENTATION_SUMMARY.md) - Implementation details
- [backend/components/service_health_check.py](backend/components/service_health_check.py) - Source code
