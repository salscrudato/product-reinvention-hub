# Agent Capabilities Analysis & Enhancement Roadmap

**Date:** February 26, 2026  
**Context:** Review of existing incident management agents and identification of enhancement opportunities

---

## 1. Current State Analysis

### 1.1 Existing Agents

#### A. Work Notes Summarization (`summarize_work_notes_core`)
**Location:** `backend/components/servicenowgenaitool.py:692`

**Current Capabilities:**
- Fetches work notes chronologically from ServiceNow
- Uses LLM to extract: Problem Statement, Root Cause, Workaround, Resolution Steps, Current Status
- Keyword extraction for insights (resolved, root cause, escalation)
- **Limit:** Processes ONLY ONE incident at a time

**Strengths:**
- Structured extraction with clear sections
- Good prompt engineering for resolution guidance
- Chronological ordering helps understand incident timeline

**Critical Gap Identified from Logs:**
```
User: "For these incidents, what is the overall summary of work notes? 
       I am looking for overall summary ..not just one incident [Referring to 100 incidents]"

System Response: Only processed INC0013485 (1 incident)
Plan: fetch_servicenow_incident → get_incident_work_notes → summarize_incident_work_notes
```

**Problem:** The system treated "these 100 incidents" as a single incident request. No bulk summarization capability exists.

---

#### B. Workaround Lookup (`workaround_lookup_core`)
**Location:** `backend/components/servicenowgenaitool.py:1120`

**Current Capabilities:**
- Fetches similar incidents by ID list
- Extracts work notes and u_workaround field
- Passes to LLM with "Insurance Triage Analyst" persona

**Limitations:**
1. **No Pattern Recognition:** Doesn't identify recurring workarounds across incidents
2. **No Success Rate:** Doesn't track which workarounds actually resolved issues
3. **No Prioritization:** Can't rank workarounds by effectiveness
4. **Siloed Knowledge:** Each query is independent - no learning from past successful resolutions
5. **Simple String Matching:** Uses literal field values, misses semantic similarity
6. **Hard-coded Prompt:** Generic "insurance triage" context, not adaptable to incident types

---

#### C. Developer Incident Tools (`suggest_fix_from_history`)
**Location:** `backend/components/developer_incident_tools.py:159`

**Current Capabilities:**
- Heuristic keyword matching ('cache', 'timeout')
- Fetches resolution history
- Stubbed commit correlation

**Limitations:**
1. **Keyword-Based Only:** No ML pattern recognition
2. **No Code-Level Insights:** Doesn't analyze actual code changes that fixed issues
3. **No Error Signature Clustering:** Can't group similar errors across incidents
4. **Static Rules:** Hard-coded heuristics that don't learn or adapt
5. **Missing Integration:** Doesn't connect to PR diffs, CI/CD pipelines, or observability data

---

#### D. Pattern Analysis (Recipes Only)
**Location:** `backend/components/plan_recipes.py:1060`

**Current State:**
- Recipe named `pattern_analysis` exists
- Builds plan to summarize work notes for multiple incidents (limit 10)
- No dedicated agent - just orchestrates existing tools

**Limitations:**
1. **No Clustering:** Doesn't group incidents by symptom, root cause, or component
2. **No Trend Detection:** Can't identify increasing frequency of specific issues
3. **No Anomaly Detection:** Doesn't flag unusual patterns or outliers
4. **No Classification:** User asked "what are the top 5 categories?" - system has no categorization logic
5. **Human-Dependent:** Relies entirely on LLM to manually analyze concatenated work notes

---

### 1.2 Log Evidence - What Users Are Actually Asking

From recent conversations:

**User Request 1 (Bulk Summarization):**
```
Show me incidents updated in last 3 days (100 incidents returned)
→ What is the pattern in these incidents? Can you classify them?
→ What are the top 5 categories?
→ What is the summary of work notes for incidents with "Performance and Latency Issues"?
→ For these incidents, what is the overall summary? NOT JUST ONE INCIDENT
```

**System Behavior:**
- Returned 100 incidents ✅
- Attempted classification via LLM (generic response) ⚠️
- Provided "top 5 categories" but NO DATA-DRIVEN CLASSIFICATION ❌
- When asked for "overall summary", only processed 1 incident ❌

**Gap:** No batch work notes processing, no real pattern clustering, no category extraction from incident data.

---

## 2. Enhancement Opportunities

### 2.1 HIGH PRIORITY: Bulk Work Notes Analyzer

**Problem:** Users want aggregate insights across 50-100 incidents, but system processes one at a time.

**Proposed Agent:** `BulkWorkNotesAnalyzer`

**Capabilities:**
1. **Parallel Fetch:** Retrieve work notes for multiple incidents concurrently (batch API calls)
2. **Aggregate Summarization:**
   - Identify common themes across incidents
   - Extract recurring problems and solutions
   - Calculate resolution time statistics
   - Detect documentation gaps (which incidents lack root cause/workaround)
3. **Pattern Clustering:**
   - Group incidents by similar symptoms (NLP semantic similarity)
   - Identify top N problem categories with incident counts
   - Detect cross-incident patterns (e.g., "All X failures happen after Y deployments")
4. **Format-Aware:**
   - Persona-specific output (product_owner → business impact, developer → technical details)
   - Configurable aggregation level (summary vs detailed breakdown)

**Implementation Approach:**
```python
def analyze_bulk_work_notes_core(
    incident_numbers: List[str],
    max_concurrent: int = 10,
    aggregation_level: str = "summary",  # summary | detailed | category_breakdown
    persona: str = "product_owner"
) -> Dict[str, Any]:
    """
    Fetch and analyze work notes across multiple incidents.
    
    Returns:
    {
        "incident_count": 100,
        "incidents_analyzed": 95,  # Some might fail to fetch
        "common_themes": [
            {"theme": "Email visibility in BAW", "frequency": 15, "incident_sample": ["INC001", ...]},
            {"theme": "Premium calculation errors", "frequency": 23, "incident_sample": [...]},
        ],
        "top_categories": [
            {"category": "System Errors", "count": 35, "avg_resolution_days": 4.2},
            {"category": "Performance Issues", "count": 18, "avg_resolution_days": 7.1}
        ],
        "documentation_gaps": {
            "missing_root_cause": 78,  # 78% lack root cause
            "missing_workaround": 85,
            "missing_resolution_steps": 92
        },
        "resolution_summary": "Most incidents unresolved or poorly documented...",
        "actionable_insights": [
            "Enforce documentation standards - 92% of incidents lack resolution steps",
            "BAW email rendering is a recurring issue (15 incidents) - needs architectural review"
        ]
    }
    """
```

**Integration:**
- Add to `servicenowgenaitool.py` as new function
- Register in `snowaaonetool.py` tool registry
- Update `plan_recipes.py` `pattern_analysis` intent to use this
- Add pre-planning analyzer hint: "If user references N incidents (N>5), use bulk analyzer"

---

### 2.2 MEDIUM PRIORITY: Intelligent Workaround Agent

**Problem:** Current workaround lookup is naive - no learning, no effectiveness tracking, no prioritization.

**Proposed Agent:** `IntelligentWorkaroundAgent`

**Capabilities:**
1. **Workaround Database:**
   - Extract workarounds from resolved incidents (historical data mine)
   - Store in FAISS index with embeddings for semantic search
   - Track success metrics: resolution time after workaround applied, reopen rate
2. **Pattern-Based Retrieval:**
   - Match current incident to historical patterns using symptom similarity
   - Rank workarounds by: (a) semantic relevance, (b) success rate, (c) recency
3. **Context-Aware Recommendations:**
   - Filter workarounds by component/service affected
   - Consider environment context (prod vs dev, specific CI/CD pipeline)
4. **Feedback Loop:**
   - Track which workarounds users actually applied (via work notes monitoring)
   - Update success scores based on follow-up outcomes
5. **Workaround Lifecycle:**
   - Identify "temporary workarounds becoming permanent hacks"
   - Flag workarounds that should be replaced with proper fixes
   - Suggest when to escalate from workaround to architectural change

**Data Model:**
```python
WorkaroundRecord = {
    "id": "WA-001",
    "description": "Clear cache in Redis cluster and restart service",
    "original_incident": "INC0013200",
    "symptom_embedding": [0.23, 0.45, ...],  # FAISS vector
    "affected_components": ["Redis", "AuthService"],
    "success_rate": 0.87,  # 87% of incidents resolved after applying
    "avg_resolution_time_days": 0.5,
    "applied_count": 23,
    "last_effective_date": "2026-02-20",
    "known_limitations": "Only works if cache corruption, not DB issue",
    "escalation_threshold": 5  # If seen >5 times, escalate for permanent fix
}
```

**Implementation Phases:**
1. **Phase 1:** Historical data mining - extract workarounds from closed incidents (u_workaround field + work notes analysis)
2. **Phase 2:** Semantic indexing - generate embeddings, build FAISS index
3. **Phase 3:** Retrieval agent - semantic search + ranking logic
4. **Phase 4:** Feedback tracking - monitor work notes for "applied workaround", update success metrics
5. **Phase 5:** Proactive escalation - alert when workaround count exceeds threshold

---

### 2.3 MEDIUM PRIORITY: Root Cause Identification Agent

**Problem:** System extracts root causes from work notes (if documented), but can't IDENTIFY root causes from patterns.

**Proposed Agent:** `RootCauseIdentificationAgent`

**Capabilities:**
1. **Symptom-to-Cause Mapping:**
   - Cluster incidents by symptom similarity (error messages, short descriptions)
   - For each cluster, identify common root causes from historical resolutions
   - Build probabilistic model: symptom X → likely root cause Y (confidence %)
2. **Multi-Incident Correlation:**
   - Detect cascading failures (incident A caused incident B)
   - Identify upstream dependencies causing downstream issues
   - Timeline analysis: "All X failures started after deployment Y"
3. **Code-Change Correlation:**
   - Link incidents to recent PRs/commits (from developer_incident_tools)
   - Identify code changes that introduced regression
   - Flag high-risk files (frequently appear in incident root causes)
4. **Configuration Drift Detection:**
   - Compare CMDB CI configurations before/after incident
   - Detect misconfigurations (timeout values, cache sizes, firewall rules)
5. **Environmental Context:**
   - Correlate with external events: deployments, scaling events, dependency outages
   - Integrate with observability data (Splunk, DataDog) to find anomalies

**Advanced Features:**
- **Root Cause Genealogy:** Track parent-child relationships between root causes
  - Example: "Database connection leak" → caused by → "ORM lazy loading bug" → caused by → "Lack of connection pooling"
- **Predictive Root Cause:** Based on symptom + context, suggest likely root cause BEFORE full investigation
- **Root Cause Templates:** For common patterns, provide investigation checklists

**Example Output:**
```json
{
  "incident": "INC0013485",
  "symptom": "BAW emails not visible to processors",
  "likely_root_causes": [
    {
      "cause": "Large attachments (images) exceeding BAW rendering limits",
      "confidence": 0.82,
      "evidence": [
        "15 similar incidents mention 'signature images'",
        "BAW documentation shows 5MB attachment limit",
        "Work notes reference 'large image files'"
      ],
      "historical_precedent": ["INC0012300", "INC0011987"],
      "recommended_investigation": [
        "Check attachment sizes in affected emails",
        "Review BAW server logs for rendering errors",
        "Test with smaller attachments"
      ]
    },
    {
      "cause": "New endorsement workflow not fully supported by BAW",
      "confidence": 0.65,
      "evidence": [
        "Work notes state: 'endorsements is a new use case'",
        "No historical endorsement incidents resolved in BAW"
      ]
    }
  ],
  "suggested_workaround": "Compress images before sending, or use file links instead of attachments",
  "escalation_needed": true,
  "reason": "Architectural limitation - BAW not designed for this use case"
}
```

---

### 2.4 LOW PRIORITY: Incident Fix Suggestion Agent

**Problem:** Developers need specific code-level fixes, not just generic advice.

**Proposed Agent:** `IncidentFixSuggestionAgent`

**Capabilities:**
1. **Code-Level Analysis:**
   - Fetch PR diffs that resolved similar incidents (from `fetch_pull_request_diff`)
   - Extract modified files, functions, config changes
   - Identify patterns: "To fix X, typically need to update Y file, Z lines"
2. **Configuration Fix Templates:**
   - Database: connection pool sizes, timeout values, query optimization
   - Cache: TTL settings, eviction policies, key naming conventions
   - API: rate limits, retry logic, circuit breaker thresholds
3. **Testing Strategy:**
   - Suggest unit tests to add (based on regression patterns)
   - Recommend integration tests (if incident caused by interaction between services)
   - Propose load tests (if performance-related)
4. **Rollback vs Fix:**
   - Identify if incident was introduced by recent change → suggest rollback
   - vs. pre-existing issue → suggest proper fix + technical debt tracking

**Integration with Existing Tools:**
- Use `fetch_related_pull_requests` (developer_incident_tools.py:80)
- Use `suggest_fix_from_history` (developer_incident_tools.py:159) as base, enhance with ML
- Use `propose_code_patch_stub` (developer_incident_tools.py:252) - implement real code generation

---

### 2.5 LOW PRIORITY: Pattern Recognition & Classification Agent

**Problem:** Users ask "what are the top 5 categories" but system has no data-driven classification.

**Proposed Agent:** `PatternRecognitionAgent`

**Capabilities:**
1. **Unsupervised Clustering:**
   - TF-IDF or transformer embeddings on incident short descriptions + work notes
   - K-means or HDBSCAN clustering to find natural groupings
   - Label clusters based on common keywords or dominant theme
2. **Supervised Classification:**
   - Train classifier on manually labeled incidents (use `category` or `subcategory` fields)
   - Predict categories for new incidents
   - Provide confidence scores and alternative categories
3. **Trend Detection:**
   - Time-series analysis: which categories are increasing/decreasing
   - Anomaly detection: unusual spikes in specific incident types
   - Seasonality: "Performance issues spike every Monday after deployments"
4. **Cross-Functional Patterns:**
   - Component correlation: "Database incidents often followed by API incidents"
   - Team correlation: "Team X incidents have longer resolution times"
   - Priority misalignment: "P5 incidents often escalated to P2 - investigate initial triage"

**Output:**
```json
{
  "total_incidents": 100,
  "classification": {
    "top_categories": [
      {
        "category": "System Errors & Access Issues",
        "count": 35,
        "percentage": 35,
        "subcategories": [
          {"name": "Policy Load Failures", "count": 18},
          {"name": "Screen Access Errors", "count": 12},
          {"name": "Login Issues", "count": 5}
        ],
        "sample_incidents": ["INC001", "INC002", "INC003"],
        "avg_resolution_days": 3.2,
        "trending": "stable"
      },
      {
        "category": "Performance & Latency",
        "count": 18,
        "percentage": 18,
        "trending": "increasing",
        "trend_note": "+40% vs last week"
      }
    ]
  },
  "patterns_detected": [
    {
      "pattern": "BAW email rendering failures",
      "frequency": 15,
      "first_seen": "2026-01-15",
      "last_seen": "2026-02-24",
      "status": "recurring_unresolved",
      "recommendation": "Needs architectural investigation"
    }
  ],
  "anomalies": [
    {
      "anomaly": "Premium calculation errors spiked 300% on 2026-02-20",
      "possible_cause": "Deployment of rating engine v2.3.1",
      "affected_incidents": ["INC050", "INC051", ...]
    }
  ]
}
```

---

## 3. Technical Implementation Strategy

### 3.1 Architecture: Specialist Agents Pattern

**Current System:** Monolithic LLM calls with generic prompts  
**Proposed System:** Specialized agents with domain-specific logic

```
┌─────────────────────────────────────────────────────────────┐
│              AgenticOrchestratorAuto (Main)                  │
└────────────────────┬────────────────────────────────────────┘
                     │
      ┌──────────────┼────────────────┐
      │              │                │
      ▼              ▼                ▼
┌──────────┐  ┌──────────────┐  ┌────────────────────┐
│ Recipe   │  │ Pre-Planning │  │ LangGraph Planner  │
│ System   │  │ Analyzer     │  │                    │
└─────┬────┘  └──────┬───────┘  └────────┬───────────┘
      │              │                    │
      └──────────────┴────────────────────┘
                     │
      ┌──────────────┴──────────────────────────────────┐
      │                                                   │
      ▼                                                   ▼
┌──────────────────────┐                    ┌──────────────────────┐
│ SPECIALIST AGENTS    │                    │ TRADITIONAL TOOLS    │
├──────────────────────┤                    ├──────────────────────┤
│ • BulkWorkNotes      │                    │ • fetch_incident     │
│   Analyzer           │                    │ • get_similar        │
│ • Workaround Agent   │                    │ • query_builder      │
│ • Root Cause Agent   │                    │ • wiki_rag           │
│ • Pattern            │                    └──────────────────────┘
│   Recognition        │
│ • Fix Suggestion     │
└──────────┬───────────┘
           │
           │ Store knowledge
           ▼
┌──────────────────────────────────────┐
│  Knowledge Bases                     │
├──────────────────────────────────────┤
│ • Workaround DB (FAISS index)        │
│ • Root Cause Patterns (embedding DB) │
│ • Fix Templates (vector store)       │
│ • Historical Success Metrics (TinyDB)│
└──────────────────────────────────────┘
```

### 3.2 Implementation Phases

**Phase 1: Immediate Fixes (1-2 days)**
- [ ] Fix bulk work notes issue: Detect when user references multiple incidents, route to bulk analyzer
- [ ] Add `analyze_bulk_work_notes_core` function (parallel fetch + aggregate summary)
- [ ] Update `pattern_analysis` recipe to call bulk analyzer for N>5 incidents
- [ ] Add pre-planning hint: "bulk work notes" triggers special handling

**Phase 2: Workaround Agent (1 week)**
- [ ] Data mining: Extract workarounds from last 1000 closed incidents
- [ ] Build workaround embeddings database (FAISS index)
- [ ] Implement `IntelligentWorkaroundAgent` with semantic retrieval
- [ ] Add success tracking: monitor work notes for "applied", "tried", "worked"
- [ ] Create feedback loop: update workaround scores based on outcomes

**Phase 3: Root Cause Agent (2 weeks)**
- [ ] Symptom clustering: Group incidents by similarity
- [ ] Build symptom→root cause mapping from historical data
- [ ] Implement `RootCauseIdentificationAgent` with probabilistic inference
- [ ] Add correlation engine: link to code changes, config drifts, deployments
- [ ] Create root cause genealogy: track cause-effect chains

**Phase 4: Pattern Recognition (1-2 weeks)**
- [ ] Unsupervised clustering: TF-IDF + K-means on incident corpus
- [ ] Label clusters with dominant themes
- [ ] Implement `PatternRecognitionAgent` with classification + trend detection
- [ ] Add anomaly detection: statistical outlier identification
- [ ] Create category prediction model for new incidents

**Phase 5: Fix Suggestion Agent (1 week)**
- [ ] Code-change analysis: Parse PR diffs from resolved incidents
- [ ] Build fix template database: common code patterns for each issue type
- [ ] Implement `IncidentFixSuggestionAgent` with template matching
- [ ] Add testing strategy generator
- [ ] Integrate with GitHub API for real PR recommendations

---

## 4. Recipe & Orchestration Changes

### 4.1 New Recipe: `bulk_work_notes_analysis`

```python
'bulk_work_notes_analysis': [
    # Step 1: Fetch base data for all incidents (if not already in short-term memory)
    {'tool': 'run_incident_query', 'args_fn': _args_incident_query_stm},
    # Step 2: Bulk analyze work notes (parallel fetch + aggregate)
    {'tool': 'analyze_bulk_work_notes', 'args_fn': _args_bulk_work_notes},
    # Step 3: Pattern recognition (classify, cluster, detect trends)
    {'tool': 'recognize_patterns', 'args_fn': _args_pattern_recognition}
]
```

### 4.2 Enhanced Recipe: `workaround_lookup`

```python
'workaround_lookup': [
    {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
    # OLD: {'tool': 'workaround_lookup', 'args_fn': _args_incident},
    # NEW: Intelligent workaround agent with semantic search + success ranking
    {'tool': 'intelligent_workaround_search', 'args_fn': _args_incident},
    {'tool': 'fetch_kb_articles', 'args_fn': _args_kb}
]
```

### 4.3 New Recipe: `root_cause_investigation`

```python
'root_cause_investigation': [
    {'tool': 'fetch_servicenow_incident', 'args_fn': _args_incident},
    {'tool': 'get_incident_work_notes', 'args_fn': _args_incident},
    {'tool': 'identify_root_cause', 'args_fn': _args_root_cause},  # NEW AGENT
    {'tool': 'get_similar_incidents', 'args_fn': _args_incident},
    {'tool': 'correlate_with_changes', 'args_fn': _args_incident},  # Link to PRs/deployments
    {'tool': 'suggest_investigation_steps', 'args_fn': _args_incident}
]
```

### 4.4 Intent Classification Updates

Add to pre-planning analyzer (`system_capabilities.py`):

```python
supported_domains = {
    "incident_management": {
        # ... existing ...
        "bulk_analysis": {
            "description": "Analyze patterns across multiple incidents",
            "triggers": ["pattern", "classify", "categories", "overall summary", "these incidents"],
            "min_incidents": 5,
            "operations": ["bulk_work_notes_analysis", "pattern_recognition", "category_classification"]
        },
        "root_cause_analysis": {
            "description": "Identify root causes for recurring issues",
            "triggers": ["root cause", "why", "what caused", "underlying reason"],
            "operations": ["symptom_clustering", "cause_correlation", "evidence_collection"]
        },
        "workaround_discovery": {
            "description": "Find effective workarounds from historical data",
            "triggers": ["workaround", "temporary fix", "quick solution", "unblock"],
            "operations": ["semantic_workaround_search", "success_ranking", "effectiveness_scoring"]
        }
    }
}
```

---

## 5. Data Requirements & Storage

### 5.1 New Data Stores

**Workaround Knowledge Base:**
```
File: backend/data/workaround_db.json
Index: backend/data/workaround_embeddings.index (FAISS)
Schema: {workaround_id, description, embedding, success_rate, applied_count, ...}
```

**Root Cause Patterns:**
```
File: backend/data/root_cause_patterns.json
Index: backend/data/symptom_embeddings.index (FAISS)
Schema: {symptom, likely_causes, confidence, historical_evidence, ...}
```

**Pattern Clusters:**
```
File: backend/data/incident_clusters.json
Schema: {cluster_id, label, incident_ids, common_keywords, resolution_stats, ...}
```

### 5.2 Caching Strategy

- Cache work notes for frequently accessed incidents (Redis or TinyDB)
- Cache embeddings for incident descriptions (avoid re-computing)
- Cache pattern recognition results (refresh daily)
- Store pre-computed similarity matrices (for quick neighbor lookup)

---

## 6. Success Metrics

### 6.1 Immediate Metrics (Phase 1-2)

**Bulk Work Notes:**
- ✅ Success: Handle 50-100 incident bulk queries without "only processed 1 incident" issue
- ⏱️ Performance: Complete bulk analysis in <30 seconds for 50 incidents
- 📊 Accuracy: 85%+ user satisfaction when asked "overall summary" questions

**Workaround Agent:**
- ✅ Retrieval Accuracy: 80%+ relevant workarounds in top 3 results
- 📈 Success Rate: Track workaround application → resolution (target: 70% effectiveness)
- ⚡ Response Time: <5 seconds for workaround search

### 6.2 Long-Term Metrics (Phase 3-5)

**Root Cause Agent:**
- 🎯 Prediction Accuracy: 75%+ correct root cause in top 3 suggestions
- ⏳ Investigation Time: Reduce time to identify root cause by 40%
- 📉 Recurrence: Reduce recurring incidents by 25% (by addressing root causes)

**Pattern Recognition:**
- 📊 Classification Accuracy: 90%+ correct category assignment
- 🔍 Pattern Discovery: Identify 10+ new recurring patterns per month
- 🚨 Early Detection: Flag anomalies within 1 hour of occurrence

**Fix Suggestion Agent:**
- 💻 Code Relevance: 70%+ developers rate suggestions as "helpful"
- ⏱️ Resolution Speed: 30% faster resolution for incidents with fix suggestions
- ✅ Fix Success Rate: 60%+ suggested fixes directly resolve issue

---

## 7. Next Steps (Immediate Action Plan)

### Priority 1: Fix Current Broken Behavior (THIS WEEK)

**Issue:** User asks for bulk work notes summary (100 incidents), system only processes 1.

**Root Cause:** Recipe `incident_work_notes` and planner don't detect bulk intent from short-term memory.

**Fix:**
1. Update `plan_recipes.py` `_extract_incidents_from_stm()` to check `short_term_memory.incident_count`
2. If incident_count > 5 and user says "these incidents"/"overall summary", trigger `bulk_work_notes_analysis`
3. Implement `analyze_bulk_work_notes_core()` in `servicenowgenaitool.py`:
   - Parallel work notes fetch (ThreadPoolExecutor, max 10 concurrent)
   - Aggregate summaries using LLM chunking strategy (batch 10 incidents per LLM call)
   - Extract common themes, documentation gaps, resolution stats
4. Update pre-planning analyzer to detect "bulk analysis" intent

**Acceptance Criteria:**
- User asks "For these 100 incidents, overall summary" → system processes ALL incidents (or sampled subset)
- Response includes: common themes, top categories, documentation gaps, aggregate stats

### Priority 2: Implement Intelligent Workaround Agent (NEXT 2 WEEKS)

**Tasks:**
1. Data mining: Extract workarounds from `u_workaround` field + work notes (last 1000 closed incidents)
2. Generate embeddings for workaround descriptions (Azure OpenAI text-embedding-ada-002)
3. Build FAISS index for semantic search
4. Implement `intelligent_workaround_search()` function
5. Add success tracking: parse work notes for "tried", "worked", "applied"
6. Create feedback loop: update success scores weekly based on new data

### Priority 3: Pattern Recognition Proof-of-Concept (WEEK 3-4)

**Tasks:**
1. Fetch last 500 closed incidents with resolutions
2. Run TF-IDF vectorization on short_description + work_notes
3. Apply K-means clustering (k=10 to start)
4. Manually label clusters to validate
5. Implement `recognize_patterns()` tool
6. Integrate into `pattern_analysis` recipe

---

## 8. Risk Assessment & Mitigation

### Risk 1: Performance Degradation
**Issue:** Bulk analysis of 100 incidents could timeout or overload ServiceNow API  
**Mitigation:**
- Implement pagination: max 50 incidents per request
- Rate limiting: 10 concurrent API calls max
- Caching: store work notes in Redis for 1 hour
- Sampling: if >50 incidents, analyze random sample + provide count

### Risk 2: LLM Token Limits
**Issue:** Aggregating 100 work note summaries exceeds GPT-4 context window  
**Mitigation:**
- Chunking strategy: process in batches of 10, then aggregate aggregates
- Use gpt-4-turbo (128k context) for bulk summarization
- Implement map-reduce pattern: summarize per incident → aggregate summaries

### Risk 3: Data Quality
**Issue:** Historical incidents have poor documentation → agents learn bad patterns  
**Mitigation:**
- Data cleaning: filter out incidents with <50 char work notes
- Manual validation: sample 10% of mined patterns for human review
- Confidence thresholds: only surface high-confidence patterns (>0.7)
- Continuous feedback: track and remove low-performing workarounds

### Risk 4: Cold Start Problem
**Issue:** New agents have no historical data → can't provide value immediately  
**Mitigation:**
- Fallback to existing tools: if agent returns low confidence, use old workaround_lookup
- Hybrid approach: blend agent suggestions with traditional LLM responses
- Gradual rollout: start with one agent (workaround), expand after validation

---

## 9. Conclusion

The current system has **solid foundational tools** (fetch incidents, work notes, similar incidents) but **lacks intelligent aggregation, pattern recognition, and learning capabilities**.

**Key Gaps:**
1. ❌ No bulk work notes processing (critical user pain point from logs)
2. ❌ No data-driven pattern classification (users ask for categories, get generic LLM response)
3. ❌ No workaround effectiveness tracking (can't rank by success rate)
4. ❌ No root cause identification (only extraction from work notes if documented)
5. ❌ No code-level fix suggestions (developer tools are mostly stubs)

**Recommended Approach:**
- **Phase 1 (Immediate):** Fix bulk work notes - this addresses the most urgent user complaint
- **Phase 2 (Short-term):** Intelligent workaround agent - high ROI, uses existing FAISS infrastructure
- **Phase 3 (Medium-term):** Root cause + pattern recognition - requires more data infrastructure
- **Phase 4 (Long-term):** Fix suggestion agent - most complex, requires GitHub integration

**Success Criteria:**
When a user asks "For these 100 incidents, what are the patterns? What are the top 5 categories? What are the common workarounds?" → the system should provide:
1. ✅ Aggregate statistics (100 incidents analyzed)
2. ✅ Data-driven categories (not just LLM guessing)
3. ✅ Ranked workarounds (by effectiveness, not just recency)
4. ✅ Common root causes (from pattern analysis, not just one incident's work notes)
5. ✅ Actionable insights (prioritized by frequency + business impact)

