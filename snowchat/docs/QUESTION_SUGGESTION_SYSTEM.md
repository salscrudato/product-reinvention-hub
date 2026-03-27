# Question Suggestion System - Implementation Guide

**Date:** January 21, 2026  
**Feature:** Intelligent question suggestions based on learned patterns from logs  
**Status:** ✅ IMPLEMENTED

## Overview

The Question Suggestion System analyzes historical user interactions from logs to learn patterns and suggest relevant questions to users. It helps new users discover what questions to ask and guides experienced users toward successful query patterns.

## Architecture

### Backend Components

#### 1. Question Suggester (`question_suggester.py`)

**Purpose:** Core analytics engine that learns from logs and provides suggestions

**Key Classes:**
- `QuestionSuggester` - Main analyzer class
  - `analyze_logs()` - Parses orchestrator logs to extract patterns
  - `get_suggestions()` - Returns personalized suggestions for users
  - `_normalize_question()` - Normalizes questions to identify patterns

**Features:**
- **Pattern Recognition:** Identifies common question structures
- **Persona-Specific:** Tracks questions by user role (developer, product_owner, etc.)
- **Intent Mapping:** Associates questions with successful intents
- **Frequency Tracking:** Identifies popular/trending questions
- **Context-Awareness:** Generates incident-specific suggestions

**Data Sources:**
- `agentic_orchestrator_auto.log` - Parses FLOW events:
  - `FLOW[QUESTION]` - User queries
  - `FLOW[CLASSIFIED]` - Intent and persona classification
  - `FLOW[SOLVE_COMPLETE]` - Success/failure outcomes

**Caching:**
- Results cached to `question_patterns_cache.json`
- Reduces startup time on subsequent runs
- Auto-refreshes when logs are analyzed

#### 2. Backend Integration (`app.py`)

**Startup Initialization:**
```python
# On backend startup (in __main__ block) - ONLY loads cache, does NOT analyze logs
if QUESTION_SUGGESTER_AVAILABLE:
    stats = initialize_question_suggester()  # Loads cached patterns
    # Analysis done by cron job or explicit API call
```

**API Endpoints:**

**`POST /question_suggestions`** - Get personalized suggestions
```json
Request:
{
  "persona": "developer",
  "limit": 5,
  "context": {
    "incidents": ["INC0010001", "INC0010013"]
  }
}

Response:
{
  "suggestions": [
    {
      "question": "What is the summary of incident INC0010001?",
      "source": "persona_popular",
      "confidence": 0.9
    },
    {
      "question": "Show me all incidents opened in last 3 days",
      "source": "popular",
      "frequency": 15,
      "confidence": 0.8
    }
  ],
  "persona": "developer",
  "count": 5
}
```

**`POST /question_suggestions/analyze`** - Trigger manual re-analysis
- Requires admin role (checked via `_has_prompt_admin()`)
- Re-parses logs and rebuilds patterns
- Returns analysis statistics

**`GET /question_suggestions/health`** - Health check
```json
{
  "available": true,
  "last_analyzed": "2026-01-21T10:30:00",
  "patterns_loaded": 3,
  "popular_questions": 12,
  "intents_tracked": 8
}
```

### Frontend Components

#### QuestionHelper Component (`QuestionHelper.jsx`)

**Purpose:** Interactive UI component that displays suggestions and allows selection

**Features:**
- **Auto-Display:** Shows suggestions on first mount when persona is available
- **Toggle View:** Click lightbulb icon to show/hide
- **One-Click Selection:** Click suggestion to auto-fill input field
- **Visual Indicators:**
  - Color-coded badges by suggestion source
  - Confidence bars for quality indication
  - Refresh button to reload suggestions

**Props:**
```jsx
<QuestionHelper
  persona="developer"               // User's role
  onSelectQuestion={(q) => {...}}  // Callback when suggestion clicked
  context={{ incidents: [...] }}   // Contextual data
  loginUsername="user@company.com" // Current user
/>
```

**Suggestion Sources:**
- `persona_popular` - Questions popular for this persona (Primary badge)
- `popular` - Trending across all users (Success badge)
- `context_incident` - Related to recent incidents (Warning badge)
- `intent_starter` - Getting started templates (Secondary badge)

#### DevCopilot Integration

**Added to:** `DevCopilot.jsx`

**Integration Points:**
1. **Import:** `import QuestionHelper from './QuestionHelper';`
2. **Handler:** `handleSelectSuggestedQuestion()` - Auto-fills message input
3. **Context Extraction:** `getContextForSuggestions()` - Pulls incidents from chat history
4. **Placement:** Between chat content and input field

**Context Building:**
```javascript
const getContextForSuggestions = () => {
  const incidents = [];
  const incidentPattern = /INC\d{7}/gi;
  chatHistory.forEach(chat => {
    const matches = chat.text.match(incidentPattern);
    if (matches) incidents.push(...matches);
  });
  return { incidents: incidents.slice(0, 5) };
};
```

## How It Works

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CRON JOB (Regular Intervals)             │
│  1. Triggered by scheduled task (e.g., daily at 3 AM)      │
│  2. POST /question_suggestions/analyze                      │
│  3. Parse agentic_orchestrator_auto.log                     │
│  4. Extract questions + intents + personas                  │
│  5. Calculate frequencies and success rates                 │
│  6. Build pattern templates by persona/intent               │
│  7. Cache results to question_patterns_cache.json           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND STARTUP                          │
│  1. Load question_patterns_cache.json (if exists)           │
│  2. If no cache found, log warning                          │
│  3. Ready to serve cached suggestions                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   USER OPENS CHAT                           │
│  1. QuestionHelper auto-mounts                              │
│  2. Calls POST /question_suggestions with persona           │
│  3. Backend returns personalized suggestions                │
│  4. Component displays suggestions with visual indicators   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                USER CLICKS SUGGESTION                       │
│  1. handleSelectSuggestedQuestion() fires                   │
│  2. Question text auto-fills message input                  │
│  3. Input field auto-focuses for editing                    │
│  4. User presses Enter to send                              │
└─────────────────────────────────────────────────────────────┘
```

### Pattern Normalization

Questions are normalized to identify patterns:

**Original:** "Show me incident INC0010013 details"
**Normalized:** "show me incident inc####### details"

**Normalization Rules:**
- `INC\d{7}` → `INC#######`
- `\d{4}-\d{2}-\d{2}` → `YYYY-MM-DD`
- `\d+ (days|weeks)` → `N days`
- Lowercase all text

This allows the system to recognize "Show me incident INC0010001" and "Show me incident INC0010005" as the same pattern.

### Suggestion Ranking

Suggestions are ranked by:

1. **Persona Match** (0.9 confidence)
   - Questions successful for user's persona
   - Top 5 most frequent patterns

2. **Popular Questions** (0.8 confidence)
   - Frequently asked across all users
   - Minimum 2 occurrences

3. **Context-Aware** (0.7 confidence)
   - Generated from recent incidents in chat
   - Example: "What is the summary of INC0010001?"

4. **Intent Starters** (0.5 confidence)
   - Pre-defined templates by persona
   - Help new users discover capabilities

## Configuration

### Environment Variables

None required - works out of the box

**Optional:**
- `FLASK_NO_RELOAD=1` - Disable auto-reload (prevents duplicate initialization)
- `PROMPT_CATALOG_ADMIN_ROLES=prompt_admin` - Roles allowed to trigger re-analysis

### File Paths

- **Log Source:** `backend/agentic_orchestrator_auto.log`
- **Cache:** `backend/question_patterns_cache.json`
- **Component:** `frontend/src/QuestionHelper.jsx`

### Tuning Parameters

In `question_suggester.py`:

```python
# Analysis depth
max_lines: int = 10000  # Last N lines to parse (default 10k)

# Popularity threshold
if count >= 2:  # Minimum occurrences to be "popular"

# Pattern limits
top_intents = sorted(...)[:5]  # Top 5 intents per persona
example_questions = [...][:10]  # Max 10 examples
```

## Testing

### Backend Health Check

```bash
curl http://localhost:5000/question_suggestions/health
```

**Expected Response:**
```json
{
  "available": true,
  "last_analyzed": "2026-01-21T10:30:15.123456",
  "patterns_loaded": 3,
  "popular_questions": 12,
  "intents_tracked": 8
}
```

### Get Suggestions

```bash
curl -X POST http://localhost:5000/question_suggestions \
  -H "Content-Type: application/json" \
  -d '{"persona": "developer", "limit": 3}'
```

### Manual Re-Analysis (Admin Only)

```bash
curl -X POST http://localhost:5000/question_suggestions/analyze \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Frontend Testing

1. **Start backend + frontend:**
   ```powershell
   cd c:\dev\snowchat
   .\start-all.ps1 -Quick -NoKeycloak
   ```

2. **Open DevCopilot interface**

3. **Verify auto-display:**
   - QuestionHelper should show on page load
   - Lightbulb icon with "Not sure what to ask?" text

4. **Click lightbulb:**
   - Panel expands showing suggestions
   - Each suggestion has badge and confidence bar

5. **Click a suggestion:**
   - Question auto-fills input field
   - Input field receives focus
   - Panel collapses

6. **Check browser console:**
   ```
   [QuestionHelper] Loaded suggestions: [...]
   [DevCopilot] Selected suggested question: "..."
   ```

## Maintenance

### Log Rotation

The system analyzes the last 10,000 lines by default. If your log grows large:

**Option 1:** Increase analysis depth
```python
suggester.analyze_logs(max_lines=50000)
```

**Option 2:** Implement log rotation
```bash
# In backend directory
mv agentic_orchestrator_auto.log agentic_orchestrator_auto.log.1
touch agentic_orchestrator_auto.log
```

### Cache Management

**Clear cache to force re-analysis:**
```bash (REQUIRED)

**IMPORTANT:** Backend startup only loads cached patterns. You MUST schedule periodic analysis via cron job or Task Scheduler:

**Via cron (Linux):**
```cron
# Daily at 3 AM - analyze logs and rebuild pattern cache
0 3 * * * curl -X POST http://localhost:5000/question_suggestions/analyze \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Via Task Scheduler (Windows):**
```powershell
$action = New-ScheduledTaskAction -Execute 'curl' -Argument '-X POST http://localhost:5000/question_suggestions/analyze -H "Authorization: Bearer $ADMIN_TOKEN"'
$trigger = New-ScheduledTaskTrigger -Daily -At 3AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "SnowChat-RefreshSuggestions"
```

**Initial Setup (First Time):**
If no cache exists, manually trigger analysis once:
```bash
curl -X POST http://localhost:5000/question_suggestions/analyze \
  -H "Authorization: Bearer $ADMIN_TOKEN
# Daily at 3 AM
0 3 * * * curl -X POST http://localhost:5000/question_suggestions/analyze \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Via Task Scheduler (Windows):**
```powershell
$action = New-ScheduledTaskAction -Execute 'curl' -Argument '-X POST http://localhost:5000/question_suggestions/analyze'
$trigger = New-ScheduledTaskTrigger -Daily -At 3AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "SnowChat-RefreshSuggestions"
```

## Troubleshooting

### Issue: No suggestions appear

**Diagnosis:**
```bash
curl http://localhost:5000/question_suggestions/health
```

**Solutions:**
- **Log file missing:** Ensure `agentic_orchestrator_auto.log` exists
- **No data:** Ask a few questions in DevCopilot to populate logs
- **Module not loaded:** Check backend logs for import errors

### Issue: Suggestions are stale

**Solution:** Trigger manual re-analysis
```bash
curl -X POST http://localhost:5000/question_suggestions/analyze \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### Issue: Frontend not showing component

**Check:**
1. Import error in `DevCopilot.jsx`
2. Backend endpoint returning 503
3. Browser console errors

**Fix:**
```bash
cd frontend
npm install  # Ensure all dependencies installed
```

## Performance Considerations

### Startup Time

- Initial analysis: ~2-5 seconds (10k lines)
- Cached load: <100ms
- Memory overhead: ~5-10MB

### Request Latency

- Suggestion endpoint: <50ms (cached)
- First request: ~200ms (loads cache)

### Scalability

- **Single instance:** Works well up to 100k log lines
- **Multiple instances:** Consider Redis for shared cache
- **Heavy traffic:** Pre-compute suggestions, serve from cache

## Future Enhancements

### Planned Features

1. **User Feedback Loop**
   - Track which suggestions users click
   - Adjust confidence scores based on usage
   - Remove rarely-clicked suggestions

2. **Intent Prediction**
   - Predict user's next question based on chat context
   - Example: After asking "What is INC001?", suggest "Show similar incidents"

3. **Multi-Turn Conversations**
   - Suggest follow-up questions
   - Build question sequences for common workflows

4. **A/B Testing**
   - Test different suggestion algorithms
   - Measure click-through rates

5. **Collaborative Filtering**
   - "Users who asked X also asked Y"
   - Team-based suggestion sharing

### Integration Opportunities

- **Slack Bot:** Send daily "Top Questions" digest
- **Email Notifications:** Weekly question suggestions
- **Mobile App:** Push notifications with helpful queries
- **Voice Interface:** "Alexa, suggest a SnowChat question"

## Related Files

- `backend/components/question_suggester.py` - Core suggester engine
- `backend/app.py` - API endpoints and initialization
- `frontend/src/QuestionHelper.jsx` - React component
- `frontend/src/DevCopilot.jsx` - Integration point
- `backend/question_patterns_cache.json` - Cached patterns (auto-generated)

## Support

For issues or questions:
1. Check backend logs: `backend/agentic_orchestrator_auto.log`
2. Check frontend console: Browser DevTools
3. Verify health endpoint: `GET /question_suggestions/health`
4. Review this document for configuration/troubleshooting

---

**Version:** 1.0.0  
**Last Updated:** January 21, 2026  
**Author:** DevPilot AI Enhancement
