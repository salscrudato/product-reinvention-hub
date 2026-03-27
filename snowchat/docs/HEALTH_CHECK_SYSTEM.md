# Service Health Check System

## Overview
Real-time health monitoring for external integrations: ServiceNow, Wiki RAG (Confluence), and JIRA.

## Architecture

### Backend Components
- **`backend/components/service_health_check.py`** - Core health check logic
  - `check_servicenow_health()` - Tests ServiceNow API connectivity with lightweight incident query
  - `check_wiki_health()` - Validates FAISS index loading and document count
  - `check_jira_health()` - Verifies JIRA API authentication
  - `get_all_services_health()` - Aggregates all service statuses

### API Endpoint
- **`/api/integrations/health`** (GET) - Returns comprehensive health status
  - Status codes: `200` (healthy), `503` (degraded/down)
  - Response format:
    ```json
    {
      "overall_status": "healthy" | "degraded" | "down",
      "services": {
        "servicenow": {
          "status": "healthy",
          "response_time_ms": 765.21,
          "authenticated": true,
          "instance": "https://dev192699.service-now.com",
          "error": null
        },
        "wiki": {
          "status": "healthy",
          "index_loaded": true,
          "docs_count": 26,
          "error": null
        },
        "jira": {
          "status": "down",
          "response_time_ms": 0,
          "authenticated": false,
          "server": "not_configured",
          "error": "JIRA credentials not configured"
        }
      },
      "timestamp": 1770246502.566
    }
    ```

### Frontend Components
- **`frontend/src/HealthStatus.jsx`** - React component with Material UI
  - Icon-based status indicator (CheckCircle/Warning/Error)
  - Popover details on click
  - Auto-polls every 30 seconds
  - Color-coded status chips (green/yellow/red)
  - Response time display for ServiceNow/JIRA
  - Document count display for Wiki RAG

- **Integration:** Added to MainTabs.jsx header (top-right corner)

## Health Status Definitions

### ServiceNow
- **Healthy:** API returns 200, JSON parses correctly, `result` field present
- **Degraded:** Unexpected response format or non-200/401/403 status codes
- **Down:** Timeout, connection error, authentication failure (401), or access forbidden (403)

### Wiki RAG
- **Healthy:** FAISS index file exists, loads successfully, contains vectors (ntotal > 0)
- **Degraded:** Index exists but is empty (ntotal = 0)
- **Down:** Index file missing, load failure, or missing dependencies (faiss/pickle)

### JIRA
- **Healthy:** `/rest/api/2/myself` returns 200 with valid user data
- **Degraded:** Unexpected response format
- **Down:** Credentials not configured, timeout, connection error, or authentication failure

## Required Environment Variables

### ServiceNow
```bash
SERVICENOW_INSTANCE=https://dev192699.service-now.com
SERVICENOW_USER=your_username
SERVICENOW_PASSWORD=your_password
```

### JIRA (Optional)
```bash
JIRA_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@domain.com
JIRA_API_TOKEN=your_api_token
```

### Wiki RAG (Automatic)
- Uses local FAISS index at `backend/Embeddings_Lookup_cache.index`
- Optional docs cache at `backend/../faiss_docs.pkl`

## Operational Behavior

### Health Check Timeouts
- **Request timeout:** 5 seconds per service
- **Frontend polling:** 30 seconds

### Error Handling
- Graceful degradation - if one service fails, others continue
- Truncated error messages (max 100 chars) prevent log spam
- Overall status reflects worst-case service state

### Logging
- All health checks logged to `agentic_orchestrator_auto.log`
- Format: `[HealthCheck] ServiceName status | timing/details`
- Example:
  ```
  2026-02-04 16:48:17,567 INFO agentic_orchestrator_auto.health_check: [HealthCheck] ServiceNow healthy | 4893ms
  2026-02-04 16:48:22,563 INFO agentic_orchestrator_auto.health_check: [HealthCheck] Wiki healthy | 0 vectors, 26 docs
  ```

## Usage Scenarios

### Preventing Integration Failures
- User sees red icon before attempting ServiceNow query → checks logs/credentials
- Wiki RAG degraded → reindex Confluence documents
- JIRA down → skips JIRA-related workflows

### Debugging Root Causes
1. User reports "incident query not working"
2. Check health status indicator - ServiceNow shows "Authentication failed (401)"
3. Update SERVICENOW_PASSWORD environment variable
4. Wait 30s for next health poll or restart backend
5. Green icon confirms fix

### Monitoring Performance
- ServiceNow response times > 3 seconds → investigate network/API performance
- Wiki index load failures → check FAISS file corruption
- JIRA timeouts → verify VPN/network access

## Maintenance

### Adding New Services
1. Add `check_<service>_health()` function to `service_health_check.py`
2. Include in `get_all_services_health()` aggregation
3. Update `HealthStatus.jsx` to display new service status
4. Document environment variables in this README

### Updating Health Criteria
- Adjust timeout in `HEALTH_CHECK_TIMEOUT` constant
- Modify status thresholds (e.g., response_time_ms > 5000 = degraded)
- Add new fields to health response (e.g., `last_successful_query`)

## Troubleshooting

### "ServiceNow down" but backend works
- Check environment variables: `echo $SERVICENOW_USER`
- Test credentials manually: `curl -u user:pass https://dev192699.service-now.com/api/now/table/incident?sysparm_limit=1`
- Verify network access (VPN required?)

### "Wiki down" but RAG queries work
- FAISS index path may be incorrect (check relative path calculation)
- Verify file exists: `ls -la backend/Embeddings_Lookup_cache.index`
- Check file permissions

### Frontend shows old status after fix
- Wait up to 30 seconds for next poll
- Force refresh by clicking health icon to trigger immediate fetch
- Clear browser cache if stuck

### JIRA always shows "not_configured"
- JIRA integration is optional
- Set environment variables if JIRA features are needed
- Status "down" with this message is expected for non-JIRA deployments

## Related Files
- `backend/app.py` - Endpoint registration
- `backend/agentic_orchestrator_auto.log` - Health check logs
- `frontend/src/MainTabs.jsx` - UI integration point
- `.env` - Environment variable definitions (not in repo)
