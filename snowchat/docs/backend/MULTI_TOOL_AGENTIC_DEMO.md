# Multi-Tool Agentic AI Demonstration Guide

## Overview
This guide explains how to demonstrate SnowChat's multi-tool agentic AI capabilities with chained tool execution.

## Current Issues & Fixes

### 1. WikiRAG 404 Error (STILL PRESENT)
**Problem:** Azure OpenAI returns 404 "Resource not found"
**Root Cause:** Either:
- `GPT_MODEL_NAME` environment variable doesn't match Azure deployment name
- Azure endpoint is incorrect
- API version mismatch

**Fix Required:**
Check your `.env` file:
```bash
# For Azure OpenAI, GPT_MODEL_NAME must be the DEPLOYMENT NAME, not the model name
# Incorrect: GPT_MODEL_NAME=gpt-4o-mini
# Correct: GPT_MODEL_NAME=your-deployment-name  (e.g., cna-gpt-35-turbo)

AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-key-here
OPENAI_API_VERSION=2024-05-01-preview
GPT_MODEL_NAME=your-deployment-name  # <-- THIS MUST MATCH YOUR AZURE DEPLOYMENT
```

### 2. Single-Tool Plan (CURRENT BEHAVIOR)
**Problem:** Query `@wiki Can you tell me what are the liability limits for insurance in NJ ? and if there is any incident related to these Coverage limits that requires resolution ?` only generates:
```json
{
  "plan": [
    {"function_name": "wiki_rag_tool", "arguments": {"question": "@wiki..."}}
  ]
}
```

**Expected:** Multi-tool chain:
```json
{
  "plan": [
    {"function_name": "wiki_rag_tool", "arguments": {"question": "liability limits for insurance in NJ"}},
    {"function_name": "find_incidents_by_short_description", "arguments": {"short_description": "Coverage limits", "state": "open"}}
  ]
}
```

## Solution: Enhanced Multi-Tool Chaining

### Step 1: Add Entity Extraction from Wiki Results
Create `backend/components/wiki_entity_extractor.py`:

```python
"""Extract structured entities from WikiRAG results to feed into subsequent tools."""
import re
from typing import Dict, List, Any

def extract_entities_from_wiki(wiki_answer: str) -> Dict[str, Any]:
    """
    Extract key entities from wiki answer that can be used for incident search.
    
    Returns:
        {
            "keywords": ["coverage limits", "liability", "insurance"],
            "dollar_amounts": ["$15,000", "$30,000"],
            "concepts": ["bodily injury", "property damage"],
            "search_terms": "coverage limits liability insurance"
        }
    """
    entities = {
        "keywords": [],
        "dollar_amounts": [],
        "concepts": [],
        "search_terms": ""
    }
    
    # Extract dollar amounts
    dollar_pattern = r'\$[\d,]+'
    entities["dollar_amounts"] = re.findall(dollar_pattern, wiki_answer)
    
    # Extract key concepts (look for bold terms)
    bold_pattern = r'\*\*([^*]+)\*\*'
    entities["concepts"] = re.findall(bold_pattern, wiki_answer)
    
    # Extract potential keywords
    keywords = ["coverage", "limit", "liability", "insurance", "bodily injury", "property damage"]
    found_keywords = [kw for kw in keywords if kw.lower() in wiki_answer.lower()]
    entities["keywords"] = found_keywords
    
    # Build search term
    entities["search_terms"] = " ".join(entities["keywords"][:3])  # Top 3 keywords
    
    return entities
```

### Step 2: Modify Plan Recipes to Support Chained Tools
Update `backend/components/plan_recipes.py`:

```python
# Add new recipe for wiki + incident search
"wiki_then_incidents": {
    "intent": ["wiki_search_with_incidents"],
    "persona": ["all"],
    "steps": [
        {"tool": "wiki_rag_tool", "required": True},
        {"tool": "find_incidents_by_short_description", "required": False, "depends_on": "wiki_rag_tool"}
    ],
    "description": "Search wiki for information, then find related ServiceNow incidents"
}
```

### Step 3: Enhance LangGraph to Support Dependencies
Update `backend/components/langgraph_flow.py` to add dependency resolution:

```python
def execute_step_with_context(step, previous_results):
    """Execute a tool step, passing context from previous steps."""
    tool_name = step["function_name"]
    args = step["arguments"]
    
    # If this tool depends on wiki results, inject entities
    if tool_name == "find_incidents_by_short_description" and "wiki_rag_tool" in previous_results:
        wiki_result = previous_results["wiki_rag_tool"]
        entities = extract_entities_from_wiki(wiki_result.get("summary", {}).get("answer", ""))
        
        # Override search term with extracted entities
        if not args.get("short_description"):
            args["short_description"] = entities["search_terms"]
    
    # Execute tool with updated args
    return execute_tool(tool_name, args)
```

### Step 4: Update UI to Show Chained Execution
Modify `frontend/src/TokenUsageTab.jsx` to display dependencies:

```jsx
{selectedRow.plan_steps && selectedRow.plan_steps.length > 1 && (
  <>
    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0078d4', mb: 1.5 }}>
      🔗 Multi-Tool Agentic Chain
    </Typography>
    <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f0f8ff' }}>
      {selectedRow.plan_steps.map((step, idx) => (
        <Box key={idx} sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Chip label={`${idx + 1}`} color="primary" size="small" sx={{ mr: 1 }} />
          <Typography sx={{ fontFamily: 'monospace' }}>{step}</Typography>
          {idx < selectedRow.plan_steps.length - 1 && (
            <span style={{ margin: '0 8px', color: '#0078d4' }}>→</span>
          )}
        </Box>
      ))}
    </Paper>
  </>
)}
```

## Testing the Multi-Tool Demo

### Test Query 1: Wiki → Incident Search
```
@wiki Can you tell me what are the liability limits for insurance in NJ? 
And if there is any incident related to these Coverage limits that requires resolution?
```

**Expected Flow:**
1. **wiki_rag_tool** retrieves: "$15,000 bodily injury, $30,000 total, $5,000 property"
2. **Entity Extraction** identifies: keywords=["coverage limits", "liability"]
3. **find_incidents_by_short_description** searches ServiceNow with "coverage limits"
4. **Final Answer** combines wiki info + related incidents

### Test Query 2: Multi-Incident Analysis
```
Show me incidents related to NIGO rules and check @wiki for the business rules that apply
```

**Expected Flow:**
1. **find_incidents_by_short_description** finds NIGO-related incidents
2. **wiki_rag_tool** retrieves NIGO business rules
3. **synthesize_user_incident_fix_plan** combines both contexts

## UI Improvements Needed

### 1. Token Usage Tab
- ✅ Already renamed "Plan Steps" → "Agentic Execution Plan"
- ❌ Need to add dependency visualization (arrows between tools)
- ❌ Need to show extracted entities passed between tools

### 2. Interaction Details Modal
- ✅ Already has emoji icons and better typography
- ❌ Need to add "Tool Outputs" section showing intermediate results
- ❌ Need to highlight which tool outputs fed into subsequent tools

### 3. DevCopilot Chat
- ✅ Already shows final answer
- ❌ Need to add expandable "Execution Trace" showing each tool's output
- ❌ Consider adding progress indicator during multi-tool execution

## Quick Implementation Priority

1. **Fix WikiRAG 404 (HIGH)** - Update GPT_MODEL_NAME in .env
2. **Add Entity Extraction (MEDIUM)** - Create wiki_entity_extractor.py
3. **Update Plan Recipes (MEDIUM)** - Add wiki_then_incidents recipe
4. **Enhance UI Display (LOW)** - Improve token usage visualization

## Verification Checklist

- [ ] WikiRAG returns answer (no 404)
- [ ] Plan contains 2+ tools for compound queries
- [ ] Entities extracted from wiki feed into ServiceNow search
- [ ] UI shows "Multi-Tool Agentic Chain" with arrows
- [ ] Token usage tab displays all intermediate outputs
- [ ] Chat history preserves full execution trace

## Example API Response Structure

```json
{
  "plan": [
    {"function_name": "wiki_rag_tool", "arguments": {"question": "liability limits NJ"}},
    {"function_name": "find_incidents_by_short_description", "arguments": {"short_description": "coverage limits"}}
  ],
  "tool_outputs": {
    "wiki_rag_tool": {
      "summary": {"answer": "$15,000 bodily injury..."},
      "entities_extracted": {"keywords": ["coverage limits"], "search_terms": "coverage limits"}
    },
    "find_incidents_by_short_description": {
      "incidents": [{"number": "INC0010001", "short_description": "Coverage limit question"}]
    }
  },
  "final_answer": "Based on NJ insurance requirements (wiki) and 1 related incident...",
  "execution_trace": [
    {"step": 1, "tool": "wiki_rag_tool", "duration_ms": 1200, "status": "ok"},
    {"step": 2, "tool": "find_incidents_by_short_description", "duration_ms": 450, "status": "ok", "used_context_from": "wiki_rag_tool"}
  ]
}
```
