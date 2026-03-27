# Universal Orchestrator Design

## Vision
Transform the orchestrator from domain-specific (ServiceNow/JIRA) to a **domain-agnostic framework** where domain expertise lives in configuration files, not code.

## Architecture Layers

### Layer 1: Universal Orchestrator (Code)
**File:** `universal_orchestrator.py`

**Responsibilities:**
- Multi-stage workflow execution
- VFS context management
- Configuration loading and validation
- LangGraph execution (reuse existing)
- Tool routing via FUNCTION_REGISTRY

**Does NOT contain:**
- ServiceNow-specific logic
- JIRA-specific logic
- Domain keywords or heuristics
- Hardcoded personas

### Layer 2: Orchestration Configs (YAML/JSON)
**Directory:** `orchestration_configs/`

**Structure:**
```yaml
# orchestration_configs/incident_investigation.yaml

domain: "servicenow_incidents"
enabled: true
version: 1

# Multi-stage definition
stages:
  - name: "investigation"
    description: "Deep incident analysis and correlation"
    max_iterations: 15
    vfs_workspace: "/investigation/{incident_number}/"
    tools:
      - fetch_servicenow_incident
      - get_related_incidents
      - splunk_query
      - datadog_get_user_logs
    prompt: |
      You are a forensic incident investigator specializing in IT operations.
      
      METHODOLOGY:
      1. Fetch incident details (description, symptoms, timeline)
      2. Analyze error patterns from logs
      3. Correlate with similar historical incidents
      4. Document findings in VFS: /investigation/{incident_number}/analysis.md
      
      CONSTRAINTS:
      - Max 15 tool calls
      - Store large log data in VFS, not context
      - Focus on root cause, not workarounds
  
  - name: "resolution"
    description: "Solution recommendation and knowledge base search"
    max_iterations: 10
    vfs_workspace: "/resolution/{incident_number}/"
    tools:
      - fetch_kb_articles
      - search_similar_resolutions
      - generate_recommendation
    prompt: |
      You are a solution architect specializing in incident remediation.
      
      CONTEXT:
      - Read investigation results from: /investigation/{incident_number}/analysis.md
      
      METHODOLOGY:
      1. Extract root cause from investigation
      2. Search knowledge base for applicable solutions
      3. Rank solutions by relevance and success rate
      4. Generate actionable recommendation
      
      OUTPUT:
      - Solution steps in priority order
      - KB article references
      - Rollback plan

# Activation patterns
activation:
  keywords: ["investigate incident", "root cause", "incident analysis"]
  entity_patterns:
    - regex: '\b(INC\d{7}|INC\d{4,})\b'
      type: "incident_number"
  personas: ["developer", "engineering_lead"]

# Synthesis strategy
synthesis:
  template: |
    ## Incident Investigation Summary
    
    **Investigation Findings:**
    {stage_results.investigation}
    
    **Recommended Resolution:**
    {stage_results.resolution}
    
    **Next Steps:**
    {action_items}
```

### Layer 3: Tool Registry (Existing)
**File:** `shared_registry.py`

**No Changes Required:**
- Tools remain registered via decorators
- Universal orchestrator calls tools from FUNCTION_REGISTRY
- Domain logic stays in tool implementation

## Adding New Domains

### Example: Insurance Claims Processing

**New Config File:** `orchestration_configs/insurance_claim_processing.yaml`

```yaml
domain: "insurance_claims"
enabled: true
version: 1

stages:
  - name: "intake"
    description: "Claim intake and policy validation"
    max_iterations: 8
    vfs_workspace: "/claims/{claim_id}/intake/"
    tools:
      - fetch_claim_details
      - validate_policy_coverage
      - check_deductible
    prompt: |
      You are a claims intake specialist.
      
      RESPONSIBILITIES:
      1. Validate claim completeness (date, description, amount)
      2. Verify policy is active and covers claim type
      3. Calculate deductible and coverage limits
      4. Flag missing documentation
      
      STORE in VFS:
      - /claims/{claim_id}/intake/validation_report.json
  
  - name: "investigation"
    description: "Fraud detection and damage assessment"
    max_iterations: 12
    vfs_workspace: "/claims/{claim_id}/investigation/"
    tools:
      - fraud_risk_analysis
      - assess_damage_photos
      - cross_reference_claims_history
      - external_data_lookup
    prompt: |
      You are a claims investigator.
      
      CONTEXT:
      - Read intake validation from: /claims/{claim_id}/intake/validation_report.json
      
      INVESTIGATE:
      1. Fraud risk score (check for suspicious patterns)
      2. Damage assessment (photo analysis, repair estimates)
      3. Historical claims for this policyholder
      4. External validation (weather data, police reports)
      
      RED FLAGS:
      - Multiple claims in short period
      - Inconsistent timelines
      - Inflated damage estimates
  
  - name: "decision"
    description: "Payout calculation and approval workflow"
    max_iterations: 6
    vfs_workspace: "/claims/{claim_id}/decision/"
    tools:
      - calculate_payout
      - approval_workflow_policy_admin
      - generate_settlement_letter
    prompt: |
      You are an underwriter making final claim decisions.
      
      CONTEXT:
      - Investigation findings: /claims/{claim_id}/investigation/report.md
      
      DECISION LOGIC:
      1. If fraud_risk > 0.7 → DENY with explanation
      2. If damage_assessment < deductible → DENY (below deductible)
      3. Otherwise → APPROVE with calculated payout
      
      WORKFLOW:
      - Payouts > $10k require supervisor approval
      - Integrate with PolicyAdmin system for settlement

activation:
  keywords: ["claim", "claimant", "policy", "damage", "settlement"]
  entity_patterns:
    - regex: '\b(CLM\d{7})\b'
      type: "claim_number"
    - regex: '\b(POL\d{9})\b'
      type: "policy_number"
  personas: ["claims_adjuster", "underwriter", "business_owner"]

synthesis:
  template: |
    ## Claim Decision Summary
    
    **Claim ID:** {claim_id}
    **Policy:** {policy_number}
    
    **Decision:** {decision}
    **Payout Amount:** {payout_amount}
    
    **Rationale:**
    {decision_rationale}
    
    **Next Steps:**
    {action_items}
```

**New Tool Registration:**

```python
# components/insurance_tools.py

from .shared_registry import FUNCTION_REGISTRY

@register_tool_function("fetch_claim_details")
def fetch_claim_details(claim_id: str) -> Dict[str, Any]:
    """Fetch claim from insurance system."""
    # Integration with PolicyAdmin or ClaimCenter
    return {"claim_id": claim_id, "status": "pending", ...}

@register_tool_function("fraud_risk_analysis")
def fraud_risk_analysis(claim_id: str) -> Dict[str, Any]:
    """ML-based fraud detection."""
    # Call fraud detection model
    return {"fraud_risk": 0.15, "confidence": 0.92, ...}

@register_tool_function("approval_workflow_policy_admin")
def approval_workflow_policy_admin(claim_id: str, payout: float) -> Dict[str, Any]:
    """Trigger PolicyAdmin approval workflow."""
    # Integration with PolicyAdmin API
    return {"workflow_id": "WF-12345", "status": "pending_approval"}
```

**Usage:**

```bash
# User query:
"Investigate claim CLM0012345 and recommend settlement amount"

# Universal orchestrator:
1. Loads insurance_claim_processing.yaml
2. Detects CLM0012345 via entity patterns
3. Executes 3-stage workflow:
   - intake → validates policy POL123456789
   - investigation → fraud_risk=0.15, damage=$8,500
   - decision → approve $7,200 (after $1,300 deductible)
4. Returns synthesized summary
```

## Migration Path

### Phase 1: Extract Current Logic to Configs (Week 1)
- Create `incident_investigation.yaml` from hardcoded logic
- Create `jira_story_analysis.yaml` from JIRA-specific code
- Keep `agentic_orchestrator_auto.py` as fallback

### Phase 2: Build Universal Orchestrator (Week 2)
- Create `universal_orchestrator.py`:
  - Config loader
  - Multi-stage executor
  - VFS integration
  - Stage prompt injection
- New endpoint: `/universal_orchestrate`

### Phase 3: Parallel Testing (Week 3)
- A/B test: existing orchestrator vs. universal orchestrator
- Validate quality parity on ServiceNow/JIRA queries

### Phase 4: Deprecate Old Orchestrator (Week 4)
- Migrate all traffic to `/universal_orchestrate`
- Mark `agentic_orchestrator_auto.py` as legacy

### Phase 5: Enable User Extensions (Ongoing)
- Document config schema
- Provide examples (insurance, quotes, HR workflows)
- Users add new YAML files → instant new domain support

## Benefits

### For Developers
✅ Add new domains without touching orchestrator code
✅ Test new workflows by editing YAML (no deploys)
✅ Version control for orchestration logic (Git diff on configs)
✅ Clear separation: framework (code) vs. domain (config)

### For Business
✅ Insurance team can define claim workflows independently
✅ Quote generation team can define quote workflows
✅ No Python knowledge required (YAML editing)
✅ Faster time-to-market for new use cases

### For Architecture
✅ Single orchestrator for all domains
✅ Consistent VFS usage patterns
✅ Reusable multi-stage execution engine
✅ Tool registry remains unchanged (backward compatible)

## Example Configs to Create

1. **incident_investigation.yaml** - ServiceNow incident deep dive
2. **jira_story_planning.yaml** - User story acceptance criteria generation
3. **insurance_claim_processing.yaml** - End-to-end claims workflow
4. **policy_quote_generation.yaml** - Quote calculation and approval
5. **hr_onboarding.yaml** - Employee onboarding workflow
6. **procurement_approval.yaml** - Purchase requisition routing

## File Structure

```
backend/components/
├── universal_orchestrator.py           ← NEW: Domain-agnostic framework
├── virtual_file_system.py              ← NEW: VFS implementation
├── orchestration_config_loader.py      ← NEW: YAML/JSON loader
├── agentic_orchestrator_auto.py        ← LEGACY: Keep for fallback
├── agentic_orchestrator_api.py         ← UPDATE: Add /universal_orchestrate
├── shared_registry.py                  ← UNCHANGED
└── orchestration_configs/              ← NEW DIRECTORY
    ├── incident_investigation.yaml
    ├── jira_story_analysis.yaml
    ├── insurance_claim_processing.yaml
    ├── policy_quote_generation.yaml
    └── schema.json                      ← Config validation schema
```

## Next Steps

**Decision Required:**
Do we proceed with this architecture? If yes:

1. Create VFS implementation (200 lines)
2. Create config loader (150 lines)
3. Create universal orchestrator (400 lines)
4. Migrate 1 working example (incident_investigation.yaml)
5. A/B test vs. existing orchestrator

**Total Effort:** ~1-2 weeks for production-ready universal framework
**Payoff:** Infinite domain extensibility with zero code changes
