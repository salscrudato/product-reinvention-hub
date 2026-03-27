# ServiceNow Agent Enhancement Plan
**Date:** January 19, 2026  
**Objective:** Expand ServiceNow incident API coverage from 3-5 agents to 10-15 specialized agents

## Executive Summary

### Current Problems Identified
1. **Work Notes Extraction Failure:** User query "what is the summary of the work notes in this incident?" failed because:
   - `fetch_servicenow_incident` returns `"work_notes": ""` (empty string)
   - No dedicated tool exists to extract/summarize work_notes separately
   - Incident INC0010013 shows `"work_notes": ""` in the raw response

2. **Date-Filtered Queries Failed:** User query "how many incidents were created today?" failed because:
   - No tool exists for date-based filtering
   - `fetch_all_incidents` returns fixed list without date parameters
   - Need `sys_created_on` field filtering capability

3. **Tool Hallucination:** Planner consistently references non-existent tools:
   - `fetch_kb_articles` - appears 20+ times in logs but not implemented
   - Log error: `"Tool 'fetch_kb_articles' not found"`

### Current ServiceNow Tool Inventory (as of 2026-01-19)

#### servicenowgenaitool.py (887 lines)
**Core Functions:**
1. `fetch_servicenow_incident_core(incident_number)` - Get single incident by number
2. `fetch_all_incidents_core(limit=100)` - Get all incidents (no filtering)
3. `analyze_incident_core(incident_number, question, folder_path)` - RAG-based analysis
4. `get_similar_incidents_simple(short_description)` - FAISS similarity search
5. `predict_assignment_group_core(incident_number, short_description, similar_incidents)` - ML prediction
6. `workaround_lookup_core(similar_incident_ids, question)` - LLM-based workaround generation
7. `generate_splunk_query_core(indexes, key_values, timestamp_start, timestamp_end)` - Splunk query builder
8. `splunk_query(query)` - Execute Splunk search
9. `fetch_incident_table_metadata_core()` - Get incident schema
10. `get_incident_table_metadata()` - Schema endpoint wrapper

#### snowaaonetool.py (526 lines)
**Registered LangChain Tools:**
- `find_incidents_by_short_description_tool` - Substring search
- `wiki_rag_tool` - @wiki annotation handler
- `my_fetch_all_incidents_tool` - Wrapper for fetch_all
- `get_similar_incidents_simple_tool` - Similarity wrapper
- `fetch_servicenow_incident_tool` - Single incident wrapper

**Total Current Coverage:** ~5 incident-specific tools

---

## Proposed 10-15 New ServiceNow Agents

### Category 1: Work Notes Management (Priority 1 - User Pain Point)

#### 1. `get_incident_work_notes`
**Purpose:** Extract work_notes field with proper formatting  
**Input Schema:**
```python
class GetWorkNotesInput(BaseModel):
    incident_number: str
    include_empty: bool = False  # Return "No work notes" vs error
```
**Output Schema:**
```python
class GetWorkNotesOutput(BaseModel):
    incident_number: str
    work_notes: str
    work_notes_count: int  # Number of entries if multi-line
    last_updated: Optional[str]
```
**Implementation:**
```python
def get_incident_work_notes_core(incident_number: str, include_empty: bool = False):
    incident = fetch_servicenow_incident_core(incident_number)
    if not incident or "error" in incident:
        return {"error": "Incident not found"}
    
    work_notes = incident.get("work_notes", "")
    work_notes_list = incident.get("work_notes_list", "")
    
    if not work_notes and not work_notes_list:
        if include_empty:
            return {
                "incident_number": incident_number,
                "work_notes": "No work notes recorded",
                "work_notes_count": 0
            }
        return {"error": "No work notes found"}
    
    # Parse work_notes_list if available (journal entries)
    return {
        "incident_number": incident_number,
        "work_notes": work_notes or work_notes_list,
        "work_notes_count": len([x for x in (work_notes or work_notes_list).split('\n') if x.strip()]),
        "last_updated": incident.get("sys_updated_on")
    }
```

#### 2. `summarize_incident_work_notes`
**Purpose:** LLM-powered summarization of work notes  
**Input Schema:**
```python
class SummarizeWorkNotesInput(BaseModel):
    incident_number: str
    max_tokens: int = 200
    style: str = "bullet_points"  # or "paragraph", "timeline"
```
**Output Schema:**
```python
class SummarizeWorkNotesOutput(BaseModel):
    incident_number: str
    summary: str
    original_length: int
    summary_method: str
```
**Implementation:**
```python
def summarize_incident_work_notes_core(incident_number: str, max_tokens: int = 200, style: str = "bullet_points"):
    notes_data = get_incident_work_notes_core(incident_number, include_empty=True)
    if "error" in notes_data:
        return notes_data
    
    work_notes = notes_data["work_notes"]
    if work_notes == "No work notes recorded":
        return {
            "incident_number": incident_number,
            "summary": "No work notes available to summarize",
            "original_length": 0,
            "summary_method": "none"
        }
    
    prompt = f"""Summarize the following incident work notes in {style} format:

Work Notes:
{work_notes}

Provide a concise summary highlighting key actions, decisions, and current status."""
    
    response = openai.chat.completions.create(
        model=GPT_MODEL_NAME,
        messages=[
            {"role": "system", "content": "You are an expert at summarizing technical incident notes."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=max_tokens
    )
    
    summary = response.choices[0].message.content or "Summary generation failed"
    
    return {
        "incident_number": incident_number,
        "summary": summary.strip(),
        "original_length": len(work_notes),
        "summary_method": style
    }
```

#### 3. `add_incident_work_note`
**Purpose:** Append work note entry to incident  
**Input Schema:**
```python
class AddWorkNoteInput(BaseModel):
    incident_number: str
    work_note: str
    username: Optional[str] = None
```
**Output Schema:**
```python
class AddWorkNoteOutput(BaseModel):
    incident_number: str
    status: str  # "success" or "error"
    message: str
    sys_id: str
```
**Implementation:**
```python
def add_incident_work_note_core(incident_number: str, work_note: str, username: str = None):
    # First get incident sys_id
    incident = fetch_servicenow_incident_core(incident_number)
    if not incident or "error" in incident:
        return {"error": "Incident not found"}
    
    sys_id = incident.get("sys_id")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    user_prefix = f"[{username}] " if username else ""
    formatted_note = f"{user_prefix}{timestamp}: {work_note}"
    
    url = f"{servicenow_instance}/api/now/table/incident/{sys_id}"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    
    # Append to existing work_notes
    current_notes = incident.get("work_notes", "")
    updated_notes = f"{current_notes}\n{formatted_note}" if current_notes else formatted_note
    
    payload = {"work_notes": updated_notes}
    
    try:
        response = requests.patch(url, auth=_sn_auth(), headers=headers, json=payload)
        response.raise_for_status()
        return {
            "incident_number": incident_number,
            "status": "success",
            "message": f"Work note added successfully",
            "sys_id": sys_id
        }
    except requests.exceptions.RequestException as e:
        return {"error": f"Failed to add work note: {e}"}
```

---

### Category 2: Date-Filtered Queries (Priority 1 - User Pain Point)

#### 4. `query_incidents_by_date`
**Purpose:** Query incidents with date filtering  
**Input Schema:**
```python
class QueryByDateInput(BaseModel):
    date_field: str = "sys_created_on"  # or sys_updated_on, opened_at, closed_at
    start_date: Optional[str] = None  # YYYY-MM-DD format
    end_date: Optional[str] = None
    state: Optional[str] = None  # Filter by state
    limit: int = 100
```
**Output Schema:**
```python
class QueryByDateOutput(BaseModel):
    incidents: List[Dict]
    total_count: int
    date_range: str
    query_params: Dict
```
**Implementation:**
```python
def query_incidents_by_date_core(date_field: str = "sys_created_on", 
                                  start_date: str = None, 
                                  end_date: str = None,
                                  state: str = None,
                                  limit: int = 100):
    # Build ServiceNow query string
    query_parts = []
    
    if start_date:
        start_datetime = f"{start_date} 00:00:00"
        query_parts.append(f"{date_field}GREATERTHANOREQUALTO{start_datetime}")
    
    if end_date:
        end_datetime = f"{end_date} 23:59:59"
        query_parts.append(f"{date_field}LESSTHANOREQUALTO{end_datetime}")
    
    if state:
        query_parts.append(f"state={state}")
    
    query_string = "^".join(query_parts) if query_parts else ""
    
    url = f"{servicenow_instance}/api/now/table/incident?sysparm_query={query_string}&sysparm_limit={limit}"
    headers = {"Accept": "application/json"}
    
    try:
        response = requests.get(url, auth=_sn_auth(), headers=headers)
        response.raise_for_status()
        result = response.json()
        incidents = result.get("result", [])
        
        return {
            "incidents": incidents,
            "total_count": len(incidents),
            "date_range": f"{start_date or 'beginning'} to {end_date or 'now'}",
            "query_params": {
                "date_field": date_field,
                "start_date": start_date,
                "end_date": end_date,
                "state": state
            }
        }
    except requests.exceptions.RequestException as e:
        return {"error": f"Date query failed: {e}"}
```

#### 5. `get_incidents_created_today`
**Purpose:** Convenience function for "incidents created today" queries  
**Input Schema:**
```python
class IncidentsCreatedTodayInput(BaseModel):
    include_closed: bool = False
    timezone: str = "UTC"  # For proper date boundary
```
**Output Schema:**
```python
class IncidentsCreatedTodayOutput(BaseModel):
    incident_numbers: List[str]
    incident_count: int
    created_date: str
    incidents: List[Dict]
```
**Implementation:**
```python
def get_incidents_created_today_core(include_closed: bool = False, timezone: str = "UTC"):
    from datetime import datetime, timedelta
    import pytz
    
    tz = pytz.timezone(timezone)
    today = datetime.now(tz).date()
    today_str = today.strftime("%Y-%m-%d")
    
    result = query_incidents_by_date_core(
        date_field="sys_created_on",
        start_date=today_str,
        end_date=today_str,
        state=None if include_closed else "1,2,3",  # Open states
        limit=500
    )
    
    if "error" in result:
        return result
    
    incidents = result["incidents"]
    incident_numbers = [inc.get("number") for inc in incidents if inc.get("number")]
    
    return {
        "incident_numbers": incident_numbers,
        "incident_count": len(incidents),
        "created_date": today_str,
        "incidents": incidents
    }
```

#### 6. `get_incidents_by_date_range`
**Purpose:** Flexible date range queries with analytics  
**Input Schema:**
```python
class DateRangeInput(BaseModel):
    days_back: Optional[int] = None  # e.g., 7 for last week
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None
    group_by: Optional[str] = None  # "day", "week", "priority"
```
**Output Schema:**
```python
class DateRangeOutput(BaseModel):
    incidents: List[Dict]
    total_count: int
    analytics: Dict  # Breakdown by group_by parameter
    date_range_description: str
```
**Implementation:**
```python
def get_incidents_by_date_range_core(days_back: int = None, 
                                       start_date: str = None, 
                                       end_date: str = None,
                                       group_by: str = None):
    from datetime import datetime, timedelta
    from collections import defaultdict
    
    # Calculate dates
    if days_back:
        end = datetime.now().date()
        start = end - timedelta(days=days_back)
        start_date = start.strftime("%Y-%m-%d")
        end_date = end.strftime("%Y-%m-%d")
    
    result = query_incidents_by_date_core(
        start_date=start_date,
        end_date=end_date,
        limit=500
    )
    
    if "error" in result:
        return result
    
    incidents = result["incidents"]
    
    # Perform analytics if group_by specified
    analytics = {}
    if group_by == "priority":
        priority_counts = defaultdict(int)
        for inc in incidents:
            priority = inc.get("priority", "unknown")
            priority_counts[priority] += 1
        analytics = dict(priority_counts)
    elif group_by == "day":
        day_counts = defaultdict(int)
        for inc in incidents:
            created = inc.get("sys_created_on", "")[:10]  # YYYY-MM-DD
            day_counts[created] += 1
        analytics = dict(sorted(day_counts.items()))
    
    return {
        "incidents": incidents,
        "total_count": len(incidents),
        "analytics": analytics,
        "date_range_description": f"{start_date} to {end_date}" + (f" ({days_back} days)" if days_back else "")
    }
```

---

### Category 3: CRUD Operations (Priority 2)

#### 7. `create_incident`
**Purpose:** Create new incident via API  
**Input Schema:**
```python
class CreateIncidentInput(BaseModel):
    short_description: str
    description: str
    caller_id: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    priority: Optional[int] = 4
    impact: Optional[int] = 3
    urgency: Optional[int] = 3
```
**Output Schema:**
```python
class CreateIncidentOutput(BaseModel):
    incident_number: str
    sys_id: str
    status: str
    created_on: str
```

#### 8. `update_incident_field`
**Purpose:** Update specific field(s) on incident  
**Input Schema:**
```python
class UpdateFieldInput(BaseModel):
    incident_number: str
    field_updates: Dict[str, Any]  # {field_name: new_value}
```
**Output Schema:**
```python
class UpdateFieldOutput(BaseModel):
    incident_number: str
    updated_fields: List[str]
    status: str
```

#### 9. `update_incident_status`
**Purpose:** Change incident state (convenience wrapper)  
**Input Schema:**
```python
class UpdateStatusInput(BaseModel):
    incident_number: str
    new_state: str  # "in_progress", "resolved", "closed"
    resolution_notes: Optional[str] = None
```

#### 10. `close_incident`
**Purpose:** Close incident with proper workflow  
**Input Schema:**
```python
class CloseIncidentInput(BaseModel):
    incident_number: str
    close_code: str
    close_notes: str
    resolved_by: Optional[str] = None
```

---

### Category 4: Assignment Operations (Priority 2)

#### 11. `assign_incident`
**Purpose:** Assign incident to user/group  
**Input Schema:**
```python
class AssignIncidentInput(BaseModel):
    incident_number: str
    assigned_to: Optional[str] = None  # user sys_id or username
    assignment_group: Optional[str] = None  # group sys_id or name
```

#### 12. `reassign_incident`
**Purpose:** Reassign with audit trail  
**Input Schema:**
```python
class ReassignIncidentInput(BaseModel):
    incident_number: str
    new_assigned_to: str
    reassignment_reason: Optional[str] = None
```

---

### Category 5: Field-Specific Extraction (Priority 3)

#### 13. `get_incident_comments`
**Purpose:** Extract comments field  
**Input Schema:**
```python
class GetCommentsInput(BaseModel):
    incident_number: str
    include_work_notes: bool = False
```

#### 14. `get_incident_timeline`
**Purpose:** Chronological history of incident  
**Input Schema:**
```python
class GetTimelineInput(BaseModel):
    incident_number: str
    include_audit: bool = True
```

#### 15. `get_incident_attachments`
**Purpose:** List attachments metadata  
**Input Schema:**
```python
class GetAttachmentsInput(BaseModel):
    incident_number: str
    include_urls: bool = True
```

---

## Implementation Strategy

### Phase 1: Critical Fixes (Week 1)
1. Implement `get_incident_work_notes` ✅
2. Implement `summarize_incident_work_notes` ✅
3. Implement `get_incidents_created_today` ✅
4. Register all 3 tools in `snowaaonetool.py`
5. Test with user's exact failed queries

### Phase 2: Date Operations (Week 1-2)
1. Implement `query_incidents_by_date`
2. Implement `get_incidents_by_date_range`
3. Add date validation and timezone handling

### Phase 3: CRUD Operations (Week 2-3)
1. Implement `create_incident`
2. Implement `update_incident_field`
3. Implement `update_incident_status`
4. Implement `close_incident`
5. Add proper error handling and validation

### Phase 4: Assignment & Extraction (Week 3-4)
1. Implement assignment tools
2. Implement field-specific extractors
3. Comprehensive testing

---

## Registration Pattern

### Step 1: Add to servicenowgenaitool.py
```python
@blueprint.route('/get_incident_work_notes', methods=['GET'])
def get_incident_work_notes():
    incident_number = request.args.get('incident_number')
    include_empty = request.args.get('include_empty', 'false').lower() == 'true'
    return jsonify(get_incident_work_notes_core(incident_number, include_empty))
```

### Step 2: Register in shared_registry.py
```python
from .servicenowgenaitool import (
    get_incident_work_notes_core,
    summarize_incident_work_notes_core,
    get_incidents_created_today_core
)

FUNCTION_REGISTRY["get_incident_work_notes"] = get_incident_work_notes_core
FUNCTION_REGISTRY["summarize_incident_work_notes"] = summarize_incident_work_notes_core
FUNCTION_REGISTRY["get_incidents_created_today"] = get_incidents_created_today_core
```

### Step 3: Create LangChain Tools in snowaaonetool.py
```python
get_incident_work_notes_tool = Tool(
    name="get_incident_work_notes",
    func=lambda args: get_incident_work_notes_core(
        _normalize_args(args, "incident_number"),
        _normalize_args(args, "include_empty", default=False)
    ),
    description="Extract work_notes field from a ServiceNow incident. Returns formatted work notes or indicates if none exist.",
    args_schema=GetWorkNotesInput,
    return_schema=GetWorkNotesOutput
)
```

---

## Testing Scenarios

### Test 1: Work Notes Summary (User's Failed Query)
**Query:** "what is the summary of the work notes in this incident?"  
**Expected Flow:**
1. Planner calls `get_incident_work_notes(INC0010013)`
2. Returns `{"work_notes": "", "work_notes_count": 0}`
3. Planner calls `summarize_incident_work_notes(INC0010013)`
4. Returns summary: "No work notes available to summarize"
5. User gets clear message instead of error

### Test 2: Incidents Created Today (User's Failed Query)
**Query:** "how many incidents were created today?"  
**Expected Flow:**
1. Planner calls `get_incidents_created_today()`
2. Returns `{"incident_count": 5, "incident_numbers": ["INC0010013", ...]}`
3. User gets count and list

### Test 3: Date Range Analytics
**Query:** "show me incidents from last week grouped by priority"  
**Expected Flow:**
1. Planner calls `get_incidents_by_date_range(days_back=7, group_by="priority")`
2. Returns incidents + analytics breakdown
3. User gets formatted report

---

## Architecture Compliance

### Follows Existing Patterns ✅
- Uses `_sn_auth()` for ServiceNow authentication
- Implements `_core()` functions + Flask blueprint routes
- Uses Pydantic schemas for input/output validation
- Registers via `@register_tool_function` decorator
- Creates LangChain `Tool` wrappers in snowaaonetool.py
- Logs to `snowchat_backend.log`

### Maintains Separation of Concerns ✅
- **servicenowgenaitool.py:** Core API logic + Flask routes
- **snowaaonetool.py:** LangChain tool wrappers + registration
- **shared_registry.py:** Function registry for orchestrator
- **agentic_orchestrator_auto.py:** Planner integration (no changes needed)

---

## Success Metrics

### Before Enhancement
- **Tool Count:** 5 ServiceNow agents
- **Query Success Rate:** ~60% (work notes/date queries fail)
- **Planner Hallucinations:** 20+ references to `fetch_kb_articles` (not implemented)
- **User Satisfaction:** Low (multiple failed queries in logs)

### After Enhancement
- **Tool Count:** 15 ServiceNow agents
- **Query Success Rate Target:** >90%
- **New Capabilities:** Work notes extraction, date filtering, CRUD operations, assignment management
- **Reduced Hallucinations:** Proper tool validation + comprehensive coverage

---

## Next Steps

1. **Review this plan with stakeholders**
2. **Prioritize tools 1-6** (work notes + date operations)
3. **Create feature branch:** `feature/servicenow-agent-expansion`
4. **Implement Phase 1** (3 tools, week 1)
5. **Test against user's failed queries**
6. **Iterate based on feedback**

---

## References
- **Copilot Instructions:** `.github/copilot-instructions.md`
- **Current Implementation:** `backend/components/servicenowgenaitool.py`
- **Tool Registration:** `backend/components/snowaaonetool.py`
- **Log Analysis:** `backend/agentic_orchestrator_auto.log` (lines 8506-8727)
- **Architecture Doc:** `AGENTIC_AI_PROJECT_INTENTION.md`
