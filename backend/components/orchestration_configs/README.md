# Orchestration Configurations Directory

This directory contains **domain-specific orchestration workflow configurations** that define how the Universal Orchestrator handles different types of user queries.

## Overview

Instead of hardcoding domain logic (ServiceNow, JIRA, Insurance, etc.) in Python, we define **workflows as YAML configurations**. This enables:

✅ **Non-developers** can add new domains (HR, Procurement, etc.) without touching code  
✅ **Rapid iteration** - edit YAML, no redeployment needed (hot-reload)  
✅ **Version control** - track workflow changes in Git  
✅ **Domain isolation** - clear separation between framework and business logic  

## Architecture

```
User Query
    ↓
Universal Orchestrator
    ↓
Loads Best Matching Config (incident_investigation.yaml)
    ↓
Executes Multi-Stage Workflow
    ├─ Stage 1: Investigation (15 iterations, specialized prompt)
    ├─ Stage 2: Resolution (10 iterations, different prompt)
    └─ Synthesis: Combines stage outputs
    ↓
Returns Final Answer
```

## Adding a New Domain

### Example: Insurance Claims Processing

**1. Create Config File:** `insurance_claim_processing.yaml`

```yaml
domain: "insurance_claims"
enabled: true
version: 1

metadata:
  description: "End-to-end claim processing workflow"
  created_by: "insurance_team"
  tags: ["insurance", "claims", "underwriting"]

stages:
  - name: "intake"
    description: "Claim intake and validation"
    max_iterations: 8
    vfs_workspace: "/claims/{claim_id}/intake/"
    
    tools:
      - fetch_claim_details
      - validate_policy_coverage
      - check_deductible
    
    prompt: |
      You are a claims intake specialist.
      
      RESPONSIBILITIES:
      1. Validate claim completeness
      2. Verify policy is active
      3. Calculate deductible
      4. Flag missing documentation
      
      VFS USAGE:
      - Store validation: /claims/{claim_id}/intake/report.json
  
  - name: "investigation"
    description: "Fraud detection and damage assessment"
    max_iterations: 12
    vfs_workspace: "/claims/{claim_id}/investigation/"
    
    tools:
      - fraud_risk_analysis
      - assess_damage_photos
      - cross_reference_claims_history
    
    prompt: |
      You are a claims investigator.
      
      CONTEXT:
      - Read intake report: /claims/{claim_id}/intake/report.json
      
      INVESTIGATE:
      1. Fraud risk score
      2. Damage assessment
      3. Historical claims
      
      RED FLAGS:
      - Multiple claims in short period
      - Inconsistent timelines

activation:
  keywords: ["claim", "claimant", "policy", "damage"]
  entity_patterns:
    - regex: '\b(CLM\d{7})\b'
      type: "claim_number"
  personas: ["claims_adjuster", "underwriter", "*"]

synthesis:
  template: |
    ## Claim Decision Summary
    
    **Claim ID:** {claim_id}
    
    **Investigation Results:**
    {stage_results.investigation}
    
    **Recommendation:**
    {stage_results.decision}
```

**2. Register Tools in Python**

```python
# components/insurance_tools.py

from .snowaaonetool import register_tool_function

@register_tool_function("fetch_claim_details")
def fetch_claim_details(claim_id: str):
    """Fetch claim from insurance system."""
    # Integration with PolicyAdmin/ClaimCenter
    return {"claim_id": claim_id, "status": "pending"}

@register_tool_function("fraud_risk_analysis")
def fraud_risk_analysis(claim_id: str):
    """ML-based fraud detection."""
    return {"fraud_risk": 0.15, "confidence": 0.92}
```

**3. Deploy**

```bash
# Drop YAML file in directory
cp insurance_claim_processing.yaml backend/components/orchestration_configs/

# Restart backend (or wait for hot-reload)
# Config auto-loads within 30 seconds
```

**4. Test**

```bash
# User query:
"Investigate claim CLM0012345"

# Universal orchestrator:
# 1. Detects CLM0012345 via entity_patterns
# 2. Loads insurance_claim_processing.yaml (best match)
# 3. Executes intake → investigation → decision stages
# 4. Returns synthesized answer
```

## Config Structure

### Required Fields

| Field | Type | Description |
|---|---|---|
| `domain` | string | Unique identifier (lowercase, underscores) |
| `stages` | array | Ordered list of workflow stages (min 1) |
| `activation` | object | Criteria for activating this config |

### Stage Definition

| Field | Type | Description |
|---|---|---|
| `name` | string | Stage identifier |
| `description` | string | Human-readable purpose |
| `max_iterations` | int | Maximum tool calls (1-50) |
| `tools` | array | Allowed tools for this stage |
| `prompt` | string | Stage-specific system prompt |
| `vfs_workspace` | string | VFS directory path (optional) |

### Activation Criteria

```yaml
activation:
  keywords: ["keyword1", "keyword2"]  # Query must contain these
  entity_patterns:
    - regex: '\b(INC\d{7})\b'         # Regex pattern
      type: "incident_number"          # Entity type name
  personas: ["developer", "*"]         # Allowed personas (* = all)
```

### VFS (Virtual File System)

Store large outputs (logs, traces) in VFS to prevent LLM context overflow:

```yaml
vfs_workspace: "/investigation/{incident_number}/"

# In prompt:
vfs_write("/investigation/{incident_number}/logs.json", log_data)
logs = vfs_read("/investigation/{incident_number}/logs.json")
```

**Variable Substitution:**
- `{incident_number}` → First detected incident number
- `{claim_id}` → First detected claim ID
- `{jira_story}` → First detected JIRA story ID

## Existing Configs

| Config File | Domain | Stages | Use Case |
|---|---|---|---|
| `incident_investigation.yaml` | ServiceNow Incidents | investigation, resolution | Root cause analysis |

## Best Practices

### 1. Multi-Stage Design

Break complex workflows into stages:
- Each stage has **specialized prompt** (investigator vs. resolver)
- Each stage has **iteration budget** (prevent runaway loops)
- Stages **communicate via VFS** (read previous stage outputs)

### 2. Prompt Engineering

```yaml
prompt: |
  You are a [role].
  
  METHODOLOGY:
  1. Step 1
  2. Step 2
  
  CONSTRAINTS:
  - Max X tool calls
  - Store large data in VFS
  - Focus on [objective]
  
  VFS USAGE:
  - /path/to/output.md
  
  OUTPUT REQUIREMENTS:
  - Specific deliverables
```

### 3. Tool Restrictions

Only list tools needed for that stage:

```yaml
stages:
  - name: "investigation"
    tools:
      - fetch_incident
      - splunk_query      # Only investigation tools
  
  - name: "resolution"
    tools:
      - wiki_rag_tool
      - fetch_kb_articles  # Only resolution tools
```

### 4. Entity Patterns

Make patterns **specific** to avoid false matches:

```yaml
# ✅ GOOD: Specific pattern
- regex: '\b(CLM\d{7})\b'
  type: "claim_number"

# ❌ BAD: Too generic
- regex: '\d{7}'
  type: "id"
```

### 5. Synthesis Templates

Use placeholders for stage results:

```yaml
synthesis:
  template: |
    ## Summary
    
    **Investigation:**
    {stage_results.investigation}
    
    **Resolution:**
    {stage_results.resolution}
    
    **Next Steps:**
    {action_items}
```

## Validation

Configs are validated on load against `schema.json`:

```bash
# Check logs for validation errors:
tail -f backend/agentic_orchestrator_auto.log | grep CONFIG_VALIDATION
```

Common errors:
- Missing required fields
- `max_iterations` out of range (1-50)
- Empty `tools` array
- Invalid `domain` format (must be lowercase_underscore)

## Hot-Reload

Configs auto-reload every **30 seconds** (configurable via `CONFIG_RELOAD_INTERVAL`):

```bash
# Edit config
vim orchestration_configs/incident_investigation.yaml

# Wait 30 seconds
# Config automatically reloaded, no restart needed
```

## Feature Flag

Enable universal orchestrator:

```bash
# .env or environment variable
ENABLE_UNIVERSAL_ORCHESTRATOR=1

# Restart backend
```

When disabled, system falls back to existing orchestrator.

## Debugging

### Enable Detailed Logging

```bash
# .env
SNOWCHAT_LOG_LEVEL=DEBUG
```

### Check Config Loading

```bash
tail -f agentic_orchestrator_auto.log | grep "FLOW\[CONFIG"

# Example output:
# FLOW[CONFIG_LOAD] Loading config | {"path": "incident_investigation.yaml"}
# FLOW[CONFIG_VALIDATE] Config validated | {"domain": "servicenow_incidents", "stages": 2}
# FLOW[CONFIG_MATCH] Best match found | {"domain": "servicenow_incidents", "score": 0.85}
```

### Check VFS Usage

```bash
tail -f agentic_orchestrator_auto.log | grep "FLOW\[VFS"

# Example output:
# FLOW[VFS_WRITE] File written | {"path": "/investigation/INC001/logs.json", "size_bytes": 45231}
# FLOW[VFS_READ] File read | {"path": "/investigation/INC001/logs.json"}
```

## Roadmap

### Phase 1 (Complete)
- ✅ Config loader with hot-reload
- ✅ VFS implementation
- ✅ Multi-stage orchestration
- ✅ Example: ServiceNow incidents

### Phase 2 (Next)
- Add JIRA story analysis config
- Add insurance claim processing config
- Enhanced synthesis (Jinja2 templating)
- Config versioning system

### Phase 3 (Future)
- Web UI for config editing
- Config testing framework
- A/B testing between configs
- Config marketplace/sharing

## Support

Questions? Check:
1. **Logs:** `agentic_orchestrator_auto.log`
2. **Schema:** `schema.json` for full specification
3. **Examples:** Existing YAML files in this directory
4. **Code:** `universal_orchestrator.py` for implementation details
