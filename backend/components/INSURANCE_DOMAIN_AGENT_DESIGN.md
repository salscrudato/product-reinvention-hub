# Insurance Domain Agent - Full-Fledged Design

**Date:** January 21, 2026  
**Status:** 🎯 Design Phase - Ready for Implementation

---

## Executive Summary

Based on log analysis, users frequently ask domain-specific questions about:
1. **NIGO (Not In Good Order)** - Policy status and compliance issues  
2. **APS (Attending Physician Statement)** - Medical underwriting requirements
3. **PAS (Policy Admin System)** - Task creation and workflow issues
4. **Coverage Limits** - State-specific insurance regulations
5. **Requirements & Specifications** - Business rules and configurations

These queries currently fail or provide poor answers because the system lacks domain knowledge integration.

---

## Domain Analysis from Logs

### 1. NIGO-Related Incidents (Found: 3+)

**Incident Examples:**
- `INC0010001`: "Intervention Needed: 22986759 - NIGO successor owner"
- `INC0010002`: "RCA: 22087148 - Alternate policy added to base; NIGO status"

**User Queries:**
- "How many incidents we have so far that are open and related to NIGO Rules?"
- "Can you review the rules from @wiki related to NIGO rules and provide a solution?"

**Current Gap:** No NIGO rule engine or knowledge base integration

---

### 2. APS-Related Incidents (Found: 10+)

**Incident Examples:**
- `INC0010003`: "90981330 and 90993157---APSs received from UMR pathway did not link properly to original APS requirement"
- `INC0010004`: "20590551 ---APS order did not properly progress"

**User Queries:**
- "Give me incidents related to APS Requirements"
- "What are the APS related incidents and what do we have for them on the @wiki?"
- "How many incidents we have that have issues with APS Pre Issue Requirement?"

**Current Gap:** No APS workflow tracking or requirement validation

---

### 3. PAS Task Creation Issues (Found: 5+)

**Incident Examples:**
- `INC0010013`: "PAS - Can't create new tasks in PAS"
- Multiple queries about "Task creation failure"

**User Queries:**
- "What is the incident that has issues with creating tasks in PAS system?"
- "Give me list of incidents with issues related to Task creation in PAS"
- "What is the workaround for Task creation failure incidents?"

**Current Gap:** No PAS system integration or task workflow knowledge

---

### 4. Coverage Limits & Regulations (Found: 8+)

**User Queries:**
- "@wiki what are the coverage limits for insurance in NJ?"
- "@wiki what are the liability limits for insurance in NJ?"
- "What are coverage limits related rules for NJ insurance?"

**Current Gap:** No regulatory knowledge base or state-specific rule engine

---

## Full-Fledged Insurance Domain Agent Architecture

### **Core Components**

```
┌─────────────────────────────────────────────────────────────┐
│          Insurance Domain Agent (Orchestrator)              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐ │
│  │  NIGO Rules   │  │  APS Workflow │  │  PAS System   │ │
│  │    Engine     │  │    Manager    │  │   Integration │ │
│  └───────┬───────┘  └───────┬───────┘  └────────┬───────┘ │
│          │                  │                    │         │
│          └──────────┬───────┴────────────────────┘         │
│                     │                                       │
│          ┌──────────▼──────────────┐                       │
│          │  Domain Knowledge Base  │                       │
│          │  - Rules & Regulations  │                       │
│          │  - Process Workflows    │                       │
│          │  - Best Practices       │                       │
│          │  - Compliance Checks    │                       │
│          └─────────────────────────┘                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│              Integration Layer                               │
├─────────────────────────────────────────────────────────────┤
│  ServiceNow  │  Wiki RAG  │  KB Articles  │  JIRA         │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### **Phase 1: NIGO Domain Agent** (3-5 days) ⭐ **START HERE**

#### 1.1 NIGO Knowledge Base
**File:** `backend/components/domain/nigo_knowledge_base.py`

```python
class NIGOKnowledgeBase:
    """NIGO (Not In Good Order) domain knowledge and rules."""
    
    NIGO_REASONS = {
        "successor_owner": {
            "description": "Beneficiary or owner succession issues",
            "resolution": "Verify successor documentation and ownership transfer",
            "typical_duration": "3-5 days",
            "wiki_ref": "Beneficiary Management > Succession Planning"
        },
        "alternate_policy": {
            "description": "Multiple policies on same base policy",
            "resolution": "Review policy consolidation rules and base policy status",
            "typical_duration": "2-3 days",
            "wiki_ref": "Policy Administration > Multiple Coverage"
        },
        "incomplete_application": {
            "description": "Missing required application fields",
            "resolution": "Generate missing data request to agent",
            "typical_duration": "1-2 weeks",
            "wiki_ref": "Application Processing > Required Fields"
        }
    }
    
    def classify_nigo_type(self, incident_description: str) -> dict:
        """Classify NIGO incident by type."""
        # Use embeddings + keyword matching
        
    def get_resolution_steps(self, nigo_type: str) -> list:
        """Return step-by-step resolution guide."""
        
    def check_compliance_requirements(self, nigo_type: str, state: str) -> dict:
        """Validate state-specific compliance needs."""
        
    def find_similar_nigo_resolutions(self, incident_number: str) -> list:
        """Find previously resolved similar NIGO cases."""
```

#### 1.2 NIGO Agent Tools
**Registered Tools:**

```python
@register_tool_function("analyze_nigo_incident")
def analyze_nigo_incident_tool(incident_number: str):
    """Analyze NIGO incident and provide resolution guidance.
    
    Returns:
    - NIGO classification (type and subtype)
    - Root cause analysis
    - Resolution steps with timeline
    - Similar resolved cases
    - Compliance requirements by state
    - Wiki/KB article references
    """
    
@register_tool_function("get_nigo_statistics")
def get_nigo_statistics_tool(days_back: int = 30, group_by: str = "type"):
    """Get NIGO incident statistics and trends.
    
    Returns:
    - Count by NIGO type
    - Average resolution time by type
    - Open vs resolved breakdown
    - Recurring patterns
    - Top assignment groups
    """

@register_tool_function("validate_nigo_resolution")
def validate_nigo_resolution_tool(incident_number: str, proposed_action: str):
    """Validate if proposed resolution meets compliance requirements.
    
    Returns:
    - Compliance check result
    - Missing steps or documentation
    - State-specific requirements
    - Risk assessment
    """
```

#### 1.3 NIGO Rule Engine
**File:** `backend/components/domain/nigo_rules_engine.py`

```python
class NIGORulesEngine:
    """Business rules for NIGO validation and resolution."""
    
    def validate_successor_owner(self, policy_data: dict) -> dict:
        """Validate successor owner documentation requirements."""
        required_docs = [
            "Death Certificate",
            "Successor Owner Designation Form",
            "Proof of Successor Identity"
        ]
        # Check against policy data
        
    def validate_alternate_policy(self, base_policy: str, alternate_policy: str) -> dict:
        """Validate alternate policy against base policy rules."""
        # Check for conflicts, coverage overlap, premium impacts
        
    def calculate_nigo_priority(self, incident: dict) -> int:
        """Calculate priority based on policy value, age, state regulations."""
        # High priority: Large policies, regulatory deadline approaching
```

---

### **Phase 2: APS Workflow Manager** (3-5 days)

#### 2.1 APS Knowledge Base
**File:** `backend/components/domain/aps_knowledge_base.py`

```python
class APSKnowledgeBase:
    """Attending Physician Statement domain knowledge."""
    
    APS_TRIGGERS = {
        "age_based": {
            "non_smoker": {"age_threshold": 50, "coverage_threshold": 500000},
            "smoker": {"age_threshold": 45, "coverage_threshold": 300000}
        },
        "health_conditions": [
            "diabetes", "heart disease", "cancer history", "high blood pressure"
        ],
        "risk_bands": {
            "low": {"aps_required": False, "accelerated_underwriting": True},
            "medium": {"aps_required": True, "medical_exam": False},
            "high": {"aps_required": True, "medical_exam": True}
        }
    }
    
    def determine_aps_requirement(self, applicant: dict) -> dict:
        """Determine if APS is required based on risk factors."""
        
    def track_aps_lifecycle(self, aps_order_id: str) -> dict:
        """Track APS order from request to receipt."""
        # Ordered → Sent to Provider → Received → Reviewed → Linked to Application
        
    def validate_aps_completion(self, aps_data: dict) -> dict:
        """Validate APS has all required medical information."""
```

#### 2.2 APS Agent Tools

```python
@register_tool_function("analyze_aps_incident")
def analyze_aps_incident_tool(incident_number: str):
    """Analyze APS-related incident and provide resolution.
    
    Returns:
    - APS lifecycle status (ordered/received/linked)
    - Missing information or documentation
    - Provider communication status
    - Resolution steps
    - Similar APS issues resolved
    """

@register_tool_function("check_aps_requirements")
def check_aps_requirements_tool(applicant_data: dict):
    """Determine if APS is required for applicant.
    
    Args:
        applicant_data: Age, smoking status, health conditions, coverage amount
    
    Returns:
        - aps_required: bool
        - reason: str (age-based, health condition, coverage amount)
        - risk_band: str (low/medium/high)
        - alternative_requirements: list (medical exam, paramed, etc.)
    """

@register_tool_function("track_aps_order")
def track_aps_order_tool(aps_order_id: str):
    """Track APS order status through lifecycle.
    
    Returns:
    - Current status
    - Days since order
    - Provider information
    - Expected completion date
    - Escalation needed (if delayed)
    """
```

#### 2.3 APS Workflow Automation

```python
class APSWorkflowAutomation:
    """Automate APS workflow processes."""
    
    def auto_order_aps(self, application_id: str):
        """Automatically order APS when requirements detected."""
        
    def link_received_aps(self, aps_doc_id: str, application_id: str):
        """Link received APS to application (solves INC0010003 pattern)."""
        
    def escalate_delayed_aps(self, aps_order_id: str):
        """Auto-escalate APS orders exceeding expected turnaround time."""
```

---

### **Phase 3: PAS System Integration** (4-6 days)

#### 3.1 PAS Knowledge Base
**File:** `backend/components/domain/pas_knowledge_base.py`

```python
class PASKnowledgeBase:
    """Policy Administration System domain knowledge."""
    
    TASK_TYPES = {
        "underwriting_review": {
            "assignment": "Underwriting Team",
            "sla_days": 3,
            "prerequisites": ["application_complete", "aps_received"]
        },
        "new_business_setup": {
            "assignment": "New Business Team",
            "sla_days": 2,
            "prerequisites": ["policy_approved", "payment_received"]
        },
        "compliance_check": {
            "assignment": "Compliance Team",
            "sla_days": 1,
            "prerequisites": ["application_complete"]
        }
    }
    
    TASK_CREATION_FAILURES = {
        "timeout": {
            "cause": "Database connection pool exhaustion",
            "workaround": "Increase timeout to 15s (temporary)",
            "permanent_fix": "Optimize connection pooling"
        },
        "api_unavailable": {
            "cause": "PAS API endpoint down",
            "workaround": "Manual task creation in PAS UI",
            "permanent_fix": "Implement retry logic with exponential backoff"
        }
    }
    
    def validate_task_prerequisites(self, task_type: str, context: dict) -> dict:
        """Validate all prerequisites are met before task creation."""
        
    def get_task_creation_workaround(self, error_type: str) -> dict:
        """Get workaround for specific task creation failure."""
        
    def diagnose_task_failure(self, incident_number: str) -> dict:
        """Diagnose root cause of task creation failure."""
```

#### 3.2 PAS Agent Tools

```python
@register_tool_function("analyze_pas_task_failure")
def analyze_pas_task_failure_tool(incident_number: str):
    """Analyze PAS task creation failure and provide resolution.
    
    Returns:
    - Failure type (timeout, API unavailable, validation error)
    - Root cause
    - Immediate workaround
    - Permanent fix recommendation
    - Similar incidents and resolutions
    """

@register_tool_function("get_pas_workarounds")
def get_pas_workarounds_tool(issue_type: str):
    """Get documented workarounds for PAS issues.
    
    Args:
        issue_type: "task_creation", "workflow", "integration"
    
    Returns:
    - Step-by-step workaround procedures
    - Success rate of workaround
    - When to escalate
    - Permanent fix status
    """

@register_tool_function("validate_pas_task_creation")
def validate_pas_task_creation_tool(task_data: dict):
    """Validate task creation request before submission.
    
    Returns:
    - Validation result (pass/fail)
    - Missing prerequisites
    - Configuration issues
    - Recommended assignment group
    """
```

#### 3.3 PAS System Integration Layer

```python
class PASSystemIntegration:
    """Direct integration with PAS system (if API available)."""
    
    def create_task(self, task_type: str, policy_id: str, data: dict):
        """Create task in PAS system with retry logic."""
        
    def get_task_status(self, task_id: str):
        """Get current status of task in PAS."""
        
    def reassign_task(self, task_id: str, new_group: str):
        """Reassign task to different team."""
```

---

### **Phase 4: Regulatory Compliance Engine** (5-7 days)

#### 4.1 State-Specific Rules
**File:** `backend/components/domain/regulatory_knowledge_base.py`

```python
class RegulatoryKnowledgeBase:
    """State-specific insurance regulations and compliance rules."""
    
    STATE_RULES = {
        "NJ": {
            "coverage_limits": {
                "bodily_injury_per_person": 15000,
                "bodily_injury_total": 30000,
                "property_damage": 5000
            },
            "aps_requirements": {
                "age_threshold": 50,
                "coverage_threshold": 500000
            },
            "nigo_deadlines": {
                "standard": 30,  # days
                "expedited": 10
            }
        },
        # Add other states...
    }
    
    def get_state_requirements(self, state: str, requirement_type: str) -> dict:
        """Get state-specific requirements."""
        
    def validate_compliance(self, policy_data: dict, state: str) -> dict:
        """Validate policy meets state compliance requirements."""
        
    def check_regulatory_deadlines(self, incident_type: str, opened_date: str, state: str) -> dict:
        """Check if incident resolution is within regulatory deadlines."""
```

#### 4.2 Compliance Agent Tools

```python
@register_tool_function("check_state_compliance")
def check_state_compliance_tool(policy_number: str, state: str):
    """Check if policy meets state-specific compliance requirements.
    
    Returns:
    - Compliance status (compliant/non-compliant/pending)
    - Missing requirements
    - Regulatory deadlines
    - Required actions
    """

@register_tool_function("get_coverage_limits")
def get_coverage_limits_tool(state: str, coverage_type: str = "auto"):
    """Get state-mandated minimum coverage limits.
    
    Returns:
    - Minimum coverage amounts by category
    - Recommended coverage levels
    - Recent regulatory changes
    - Wiki/regulatory references
    """

@register_tool_function("validate_regulatory_deadline")
def validate_regulatory_deadline_tool(incident_number: str):
    """Check if incident resolution meets regulatory deadlines.
    
    Returns:
    - Deadline date
    - Days remaining
    - Escalation needed (if approaching deadline)
    - Compliance risk assessment
    """
```

---

## Unified Insurance Domain Agent

### Master Agent Orchestrator
**File:** `backend/components/domain/insurance_domain_agent.py`

```python
class InsuranceDomainAgent:
    """Unified orchestrator for all insurance domain agents."""
    
    def __init__(self):
        self.nigo_agent = NIGOKnowledgeBase()
        self.aps_agent = APSKnowledgeBase()
        self.pas_agent = PASKnowledgeBase()
        self.regulatory_agent = RegulatoryKnowledgeBase()
        
    def analyze_incident(self, incident_number: str) -> dict:
        """Analyze incident using appropriate domain agent(s)."""
        incident = fetch_servicenow_incident_core(incident_number)
        
        # Classify incident domain
        if "NIGO" in incident.get('short_description', ''):
            return self.nigo_agent.analyze(incident)
        elif "APS" in incident.get('short_description', ''):
            return self.aps_agent.analyze(incident)
        elif "PAS" in incident.get('short_description', '') or "task" in incident.get('short_description', '').lower():
            return self.pas_agent.analyze(incident)
        else:
            # Multi-domain analysis
            return self.multi_domain_analysis(incident)
    
    def get_domain_recommendations(self, question: str, context: dict) -> dict:
        """Get recommendations from all relevant domain agents."""
        
    def cross_reference_domains(self, incident_number: str) -> dict:
        """Find cross-domain impacts (e.g., NIGO blocking APS requirement)."""
```

---

## Integration with Existing System

### 1. Tool Registration
All domain agent tools registered in `snowaaonetool.py`:

```python
from .domain.nigo_knowledge_base import analyze_nigo_incident, get_nigo_statistics
from .domain.aps_knowledge_base import analyze_aps_incident, check_aps_requirements
from .domain.pas_knowledge_base import analyze_pas_task_failure, get_pas_workarounds
from .domain.regulatory_knowledge_base import check_state_compliance, get_coverage_limits

# Register all domain tools
DOMAIN_TOOLS = [
    "analyze_nigo_incident",
    "get_nigo_statistics",
    "validate_nigo_resolution",
    "analyze_aps_incident",
    "check_aps_requirements",
    "track_aps_order",
    "analyze_pas_task_failure",
    "get_pas_workarounds",
    "validate_pas_task_creation",
    "check_state_compliance",
    "get_coverage_limits",
    "validate_regulatory_deadline"
]
```

### 2. LangGraph Integration
Domain agents automatically invoked based on question classification:

```python
# In agentic_orchestrator_auto.py
def _classify_domain(self, question: str) -> str:
    """Classify question to appropriate domain agent."""
    if any(keyword in question.lower() for keyword in ['nigo', 'not in good order']):
        return 'nigo'
    elif any(keyword in question.lower() for keyword in ['aps', 'attending physician', 'medical records']):
        return 'aps'
    elif any(keyword in question.lower() for keyword in ['pas', 'task creation', 'task']):
        return 'pas'
    elif any(keyword in question.lower() for keyword in ['coverage', 'limits', 'regulatory', 'compliance']):
        return 'regulatory'
    return 'general'
```

### 3. Wiki RAG Enhancement
Domain-specific wiki sections automatically prioritized:

```python
# In CustomWikiRAG.py
DOMAIN_WIKI_SECTIONS = {
    'nigo': ['Policy Status Management', 'NIGO Resolution Procedures'],
    'aps': ['Medical Underwriting', 'APS Order Process', 'Attending Physician Requirements'],
    'pas': ['Policy Administration System', 'Task Management', 'Workflow Configuration'],
    'regulatory': ['State Regulations', 'Compliance Requirements', 'Coverage Limits']
}
```

---

## Testing & Validation

### Unit Tests
**File:** `backend/tests/test_domain_agents.py`

```python
def test_nigo_classification():
    """Test NIGO incident classification."""
    result = analyze_nigo_incident("INC0010001")
    assert result['nigo_type'] == 'successor_owner'
    assert 'resolution_steps' in result

def test_aps_requirement_determination():
    """Test APS requirement logic."""
    applicant = {"age": 52, "smoker": False, "coverage": 600000}
    result = check_aps_requirements(applicant)
    assert result['aps_required'] == True
    assert result['reason'] == 'age_based'

def test_pas_workaround_retrieval():
    """Test PAS workaround documentation."""
    result = get_pas_workarounds("task_creation")
    assert 'timeout' in result
    assert 'workaround' in result['timeout']
```

### Integration Tests
Test with real ServiceNow incidents:
- NIGO incidents: INC0010001, INC0010002
- APS incidents: INC0010003, INC0010004
- PAS incidents: INC0010013

### User Acceptance Testing
Real user queries from logs:
1. "How many incidents we have so far that are open and related to NIGO Rules?"
2. "Give me incidents related to APS Requirements"
3. "What is the workaround for Task creation failure incidents?"
4. "What are the coverage limits for insurance in NJ?"

---

## Implementation Priority Matrix

| Component | Priority | Impact | Complexity | Est. Time | Dependencies |
|-----------|----------|--------|------------|-----------|--------------|
| **NIGO Agent** | 🔴 Critical | Very High | Medium | 3-5 days | Quick Win Tools |
| **APS Agent** | 🔴 Critical | Very High | Medium | 3-5 days | NIGO Agent, Wiki RAG |
| **PAS Agent** | 🟡 High | High | Low-Med | 4-6 days | ServiceNow API |
| **Regulatory Engine** | 🟢 Medium | Medium | High | 5-7 days | Wiki RAG, KB Articles |
| **Unified Orchestrator** | 🟡 High | High | Medium | 2-3 days | All domain agents |

**Total Implementation Time:** 17-26 days for full system

---

## Success Metrics

### Before Domain Agents:
- ❌ "How many NIGO incidents?" → Tool not found
- ❌ "APS requirement validation" → No answer
- ❌ "PAS task workaround" → Generic response
- ❌ "Coverage limits for NJ" → Wiki returns no answer

### After Domain Agents:
- ✅ "How many NIGO incidents?" → Instant count with breakdown
- ✅ "APS requirement validation" → Accurate risk assessment
- ✅ "PAS task workaround" → Step-by-step procedure
- ✅ "Coverage limits for NJ" → Exact regulatory requirements

### KPIs:
1. **Domain Query Success Rate:** Target 95% (from <40%)
2. **Time to Resolution:** Reduce by 60% for domain-specific incidents
3. **Compliance Accuracy:** 100% for regulatory requirements
4. **User Satisfaction:** Increase by 70% for insurance-specific queries

---

## Next Steps

### Immediate (This Week):
1. ✅ Complete Quick Win Tools (Done!)
2. ⏳ Start NIGO Agent implementation
3. ⏳ Create domain knowledge base files structure
4. ⏳ Gather NIGO/APS/PAS business rules from wiki

### Short-term (Next 2 Weeks):
1. Complete NIGO + APS agents
2. Integrate with existing Wiki RAG
3. Add domain-specific KB articles
4. Test with real incidents

### Long-term (Next Month):
1. Complete PAS + Regulatory agents
2. Build unified orchestrator
3. Production deployment
4. User training and documentation

---

**Status:** 📋 Design Complete - Ready for Phase 1 Implementation  
**Recommendation:** Start with NIGO Agent (highest impact, moderate complexity)
