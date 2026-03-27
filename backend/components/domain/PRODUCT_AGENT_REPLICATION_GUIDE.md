# Product-Specific Agent Replication Guide

**Created:** January 22, 2026  
**Purpose:** Template for creating specialized agents for each insurance product line

---

## ✅ Completed: Life & Annuity NIGO Agent

**File:** `backend/components/domain/life_annuity_nigo_agent.py`

**What it does:**
- Analyzes NIGO incidents for Life & Annuity products
- Queries Wiki for L&A-specific knowledge (procedures, business rules)
- Finds similar resolved NIGO cases
- Generates step-by-step resolution plans
- Identifies clarifications needed

**Registered Tools:**
1. `analyze_la_nigo_incident(incident_number)` - Full incident analysis
2. `get_nigo_resolution_steps(nigo_type)` - Standard resolution procedures

---

## 🎯 Pattern to Replicate for Other Products

### Product Lines Needing Agents

| Product Line | Key Concepts | Priority |
|--------------|-------------|----------|
| **P&C (Property & Casualty)** | Claims processing, damage assessment, liability determination | High |
| **Group Benefits** | Enrollment issues, eligibility, plan administration | High |
| **Voluntary Benefits** | Election processing, payroll deduction, enrollment periods | Medium |

---

## 📋 Template Structure

### 1. Agent Class Structure

```python
class {ProductLine}{ConceptName}Agent:
    """
    Specialized agent for {Product Line} {Concept} resolution.
    
    {Concept} in {Product Line} involves:
    - [Key characteristic 1]
    - [Key characteristic 2]
    - [Key characteristic 3]
    
    This agent:
    1. Analyzes {concept} incidents using Wiki knowledge
    2. Identifies root cause and resolution path
    3. Generates step-by-step resolution plan
    4. References similar past resolutions
    """
    
    def __init__(self):
        self.product_line = "{Product Line}"
        self.domain_concepts = [
            "{primary_concept}", "{related_concept_1}", "{related_concept_2}"
        ]
    
    def analyze_incident(self, incident_number: str) -> Dict[str, Any]:
        """Main analysis function following the pattern."""
        # Step 1: Fetch incident
        # Step 2: Query Wiki with product-specific context
        # Step 3: Find similar incidents
        # Step 4: Generate analysis
        # Step 5: Create resolution plan
        # Step 6: Identify clarifications
        pass
    
    def _query_wiki_knowledge(self, incident_text: str) -> Dict[str, Any]:
        """Query Wiki with product-specific keywords."""
        query_1 = f"{self.product_line} {concept} procedures: {incident_text}"
        query_2 = f"{self.product_line} business rules: {incident_text}"
        # Execute Wiki RAG queries
        pass
    
    def _find_similar_incidents(self, incident_text: str) -> List[Dict]:
        """Find similar incidents in this product line."""
        search_text = f"{self.product_line} {concept} {incident_text}"
        # Execute similarity search
        pass
    
    def _analyze_type(self, incident_text: str, wiki_context: Dict) -> Dict:
        """Classify the issue type within this product line."""
        # Product-specific classification logic
        pass
    
    def _generate_resolution_plan(self, ...) -> Dict[str, Any]:
        """Generate resolution plan using product-specific templates."""
        # Product-specific resolution steps
        pass
```

### 2. Tool Registration Pattern

```python
@register_tool_function("analyze_{product_abbreviation}_{concept}_incident")
def analyze_tool(incident_number: str) -> Dict[str, Any]:
    """
    Analyze {Product Line} {Concept} incident.
    
    Args:
        incident_number: ServiceNow incident number
    
    Returns:
        Comprehensive analysis with resolution guidance
    """
    agent = {ProductLine}{Concept}Agent()
    return agent.analyze_incident(incident_number)
```

---

## 🔨 Example: P&C Claims Processing Agent

### File: `backend/components/domain/pc_claims_agent.py`

```python
"""
Property & Casualty Claims Processing Agent

Specialized for P&C claims resolution including:
- Auto claims (collision, comprehensive, liability)
- Property claims (homeowners, renters)
- Subrogation issues
- Adjuster assignment
"""

class PropertyCasualtyClaimsAgent:
    """Agent for P&C claims processing issues."""
    
    def __init__(self):
        self.product_line = "Property & Casualty"
        self.domain_concepts = [
            "claims", "claim processing", "adjuster", "liability",
            "damage assessment", "subrogation", "settlement"
        ]
    
    def analyze_claims_incident(self, incident_number: str) -> Dict[str, Any]:
        """
        Analyze P&C claims incident.
        
        Workflow:
        1. Fetch claim incident details
        2. Query Wiki for claims procedures (auto vs property)
        3. Find similar claim resolutions
        4. Identify claim type (coverage, processing, payment)
        5. Generate resolution with adjuster guidance
        6. Identify missing documentation
        """
        # Fetch incident
        incident = fetch_servicenow_incident_core(incident_number)
        combined_text = f"{incident['short_description']}. {incident['description']}"
        
        # Query Wiki for P&C claims knowledge
        wiki_context = self._query_wiki_knowledge(combined_text)
        
        # Find similar claims
        similar_claims = self._find_similar_claims(combined_text)
        
        # Classify claim issue type
        claims_analysis = self._analyze_claims_type(combined_text, wiki_context)
        
        # Generate resolution plan
        resolution_plan = self._generate_resolution_plan(
            incident, claims_analysis, wiki_context, similar_claims
        )
        
        return {
            "incident_summary": {...},
            "claims_analysis": claims_analysis,
            "wiki_knowledge": wiki_context,
            "similar_claims": similar_claims,
            "resolution_plan": resolution_plan,
            "clarifications_needed": [...]
        }
    
    def _query_wiki_knowledge(self, incident_text: str) -> Dict[str, Any]:
        """Query Wiki for P&C claims knowledge."""
        # Query 1: Claims processing procedures
        query_1 = f"Property Casualty claims processing procedures: {incident_text}"
        wiki_result_1 = perform_wiki_rag(query_1)
        
        # Query 2: Coverage and adjuster guidelines
        query_2 = f"Property Casualty coverage guidelines and adjuster protocols: {incident_text}"
        wiki_result_2 = perform_wiki_rag(query_2)
        
        return {
            "procedures": wiki_result_1.get('answer', ''),
            "guidelines": wiki_result_2.get('answer', ''),
            "sources": list(set(wiki_result_1.get('sources', []) + wiki_result_2.get('sources', [])))
        }
    
    def _analyze_claims_type(self, incident_text: str, wiki_context: Dict) -> Dict:
        """Classify P&C claim issue type."""
        text_lower = incident_text.lower()
        
        claim_patterns = {
            "coverage_question": ["coverage", "covered", "policy limit", "exclusion"],
            "payment_delay": ["payment", "settle", "check", "delay", "pending"],
            "adjuster_assignment": ["adjuster", "assign", "no adjuster", "waiting"],
            "documentation": ["document", "missing", "require", "photo", "estimate"],
            "subrogation": ["subrogation", "recovery", "other party", "liable"],
            "total_loss": ["total loss", "totaled", "salvage"],
            "liability_dispute": ["liability", "fault", "dispute", "disagreement"]
        }
        
        detected_type = "general_claim_issue"
        for claim_type, keywords in claim_patterns.items():
            if any(keyword in text_lower for keyword in keywords):
                detected_type = claim_type
                break
        
        return {
            "claim_type": detected_type.replace("_", " ").title(),
            "severity": self._assess_severity(text_lower),
            "likely_cause": self._get_claim_cause(detected_type),
            "typical_resolution_time": self._get_resolution_time(detected_type)
        }
    
    def _generate_resolution_plan(self, incident, claims_analysis, wiki_context, similar_claims):
        """Generate P&C claims resolution plan."""
        claim_type = claims_analysis['claim_type'].lower().replace(" ", "_")
        
        # Get claim-type-specific steps
        steps = self._get_claims_resolution_template(claim_type)
        
        # Add Wiki guidance
        if wiki_context.get('procedures'):
            steps.append({
                "step": len(steps) + 1,
                "action": "Follow Claims Procedures",
                "description": "Apply documented P&C claims handling procedures",
                "details": wiki_context['procedures'][:300] + "..."
            })
        
        return {
            "steps": steps,
            "estimated_time": claims_analysis['typical_resolution_time'],
            "required_roles": ["Claims Adjuster", "Claims Supervisor"],
            "success_criteria": [
                "Claim status updated",
                "All required documentation received",
                "Coverage determination made",
                "Settlement processed (if applicable)"
            ]
        }
    
    def _get_claims_resolution_template(self, claim_type: str) -> List[Dict]:
        """Get resolution steps by claim type."""
        templates = {
            "coverage_question": [
                {"step": 1, "action": "Review Policy", "description": "Pull policy and review coverage sections"},
                {"step": 2, "action": "Check Exclusions", "description": "Verify no exclusions apply"},
                {"step": 3, "action": "Consult Underwriting", "description": "If unclear, escalate to underwriting"},
                {"step": 4, "action": "Provide Coverage Determination", "description": "Communicate decision to claimant"}
            ],
            "payment_delay": [
                {"step": 1, "action": "Check Payment Status", "description": "Verify payment processing stage"},
                {"step": 2, "action": "Identify Delay Cause", "description": "Determine what's blocking payment"},
                {"step": 3, "action": "Resolve Blockers", "description": "Address missing info or approvals"},
                {"step": 4, "action": "Process Payment", "description": "Release payment once cleared"}
            ],
            "adjuster_assignment": [
                {"step": 1, "action": "Check Assignment Queue", "description": "Verify claim in assignment pool"},
                {"step": 2, "action": "Review Adjuster Capacity", "description": "Check adjuster workloads"},
                {"step": 3, "action": "Assign Adjuster", "description": "Assign based on expertise and location"},
                {"step": 4, "action": "Notify Claimant", "description": "Provide adjuster contact information"}
            ]
        }
        
        return templates.get(claim_type, [
            {"step": 1, "action": "Investigate Claim", "description": "Review all claim details"},
            {"step": 2, "action": "Gather Information", "description": "Collect necessary documentation"},
            {"step": 3, "action": "Make Determination", "description": "Decide on appropriate action"},
            {"step": 4, "action": "Execute Resolution", "description": "Implement solution"}
        ])


# Tool Registration
@register_tool_function("analyze_pc_claims_incident")
def analyze_pc_claims_incident_tool(incident_number: str) -> Dict[str, Any]:
    """
    Analyze Property & Casualty claims incident.
    
    Specialized for P&C claims issues including coverage questions,
    payment delays, adjuster assignment, and documentation requirements.
    """
    agent = PropertyCasualtyClaimsAgent()
    return agent.analyze_claims_incident(incident_number)
```

---

## 🔨 Example: Group Benefits Enrollment Agent

### File: `backend/components/domain/group_benefits_agent.py`

```python
"""
Group Benefits Enrollment Agent

Specialized for Group Benefits enrollment and eligibility issues:
- New hire enrollments
- Qualifying life events (QLE)
- Open enrollment issues
- Eligibility determination
"""

class GroupBenefitsEnrollmentAgent:
    """Agent for Group Benefits enrollment issues."""
    
    def __init__(self):
        self.product_line = "Group Benefits"
        self.domain_concepts = [
            "enrollment", "eligibility", "open enrollment",
            "qualifying life event", "QLE", "plan election"
        ]
    
    def analyze_enrollment_incident(self, incident_number: str) -> Dict[str, Any]:
        """Analyze Group Benefits enrollment incident."""
        # Similar pattern to L&A NIGO Agent
        # Product-specific logic for enrollment issues
        pass
    
    def _query_wiki_knowledge(self, incident_text: str) -> Dict[str, Any]:
        """Query Wiki for Group Benefits knowledge."""
        query_1 = f"Group Benefits enrollment procedures and requirements: {incident_text}"
        query_2 = f"Group Benefits eligibility rules and QLE guidelines: {incident_text}"
        # Execute queries
        pass
    
    def _analyze_enrollment_type(self, incident_text: str, wiki_context: Dict) -> Dict:
        """Classify enrollment issue type."""
        enrollment_patterns = {
            "new_hire": ["new hire", "new employee", "onboarding"],
            "qle": ["qualifying life event", "qle", "marriage", "birth", "divorce"],
            "open_enrollment": ["open enrollment", "annual enrollment", "oe"],
            "eligibility": ["eligibility", "eligible", "waiting period", "qualification"],
            "plan_change": ["plan change", "switch plan", "change coverage"],
            "termination": ["termination", "cobra", "continuation", "leave"]
        }
        # Classification logic
        pass
    
    def _get_enrollment_resolution_template(self, enrollment_type: str) -> List[Dict]:
        """Resolution steps by enrollment type."""
        templates = {
            "new_hire": [
                {"step": 1, "action": "Verify Hire Date", "description": "Confirm employee start date"},
                {"step": 2, "action": "Check Waiting Period", "description": "Determine eligibility date"},
                {"step": 3, "action": "Process Enrollment", "description": "Enter elections in system"},
                {"step": 4, "action": "Generate Confirmation", "description": "Send enrollment confirmation"}
            ],
            "qle": [
                {"step": 1, "action": "Validate QLE", "description": "Verify qualifying event occurred"},
                {"step": 2, "action": "Check Documentation", "description": "Ensure proper evidence provided"},
                {"step": 3, "action": "Calculate Enrollment Window", "description": "Determine if within 30-day window"},
                {"step": 4, "action": "Process Election Change", "description": "Update coverage elections"}
            ]
        }
        return templates.get(enrollment_type, [])


@register_tool_function("analyze_gb_enrollment_incident")
def analyze_gb_enrollment_incident_tool(incident_number: str) -> Dict[str, Any]:
    """Analyze Group Benefits enrollment incident."""
    agent = GroupBenefitsEnrollmentAgent()
    return agent.analyze_enrollment_incident(incident_number)
```

---

## 📦 Implementation Checklist

For each new product-specific agent:

### Phase 1: Setup (30 minutes)
- [ ] Create agent file: `backend/components/domain/{product}_{concept}_agent.py`
- [ ] Define agent class with `__init__` setting product_line and domain_concepts
- [ ] Copy base structure from L&A NIGO Agent

### Phase 2: Domain Knowledge (2-3 hours)
- [ ] Identify key concepts/patterns in this product line
- [ ] Define classification logic (similar to `_analyze_nigo_type`)
- [ ] Create resolution step templates for each concept type
- [ ] Map typical resolution times and required roles

### Phase 3: Wiki Integration (1-2 hours)
- [ ] Define product-specific Wiki queries in `_query_wiki_knowledge`
- [ ] Test Wiki queries return relevant results
- [ ] Add Wiki source references to response

### Phase 4: Similar Incident Search (1 hour)
- [ ] Customize `_find_similar_incidents` with product keywords
- [ ] Test similarity search finds relevant past incidents
- [ ] Add filters for resolved incidents

### Phase 5: Tool Registration (30 minutes)
- [ ] Create tool wrapper function with `@register_tool_function`
- [ ] Add comprehensive docstring with examples
- [ ] Export in `__all__` list

### Phase 6: Testing (2-3 hours)
- [ ] Test with real incidents from logs
- [ ] Verify Wiki queries return useful knowledge
- [ ] Validate resolution plans are actionable
- [ ] Check clarifications identify real gaps

### Phase 7: Integration (1 hour)
- [ ] Import in `snowaaonetool.py`
- [ ] Add to tool registry
- [ ] Update intent classifier to route product-specific queries
- [ ] Test end-to-end through orchestrator

---

## 🎯 Success Metrics Per Agent

Each agent should achieve:

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Wiki Hit Rate** | >80% | % of queries returning relevant Wiki content |
| **Classification Accuracy** | >85% | % of incidents correctly classified by type |
| **Resolution Plan Usefulness** | >90% | User feedback on actionability of steps |
| **Clarification Relevance** | >80% | % of clarifications that identify real gaps |
| **Similar Incident Match** | >70% | % of similar incidents actually relevant |

---

## 🚀 Rollout Plan

### Week 1: Foundation
- ✅ Complete L&A NIGO Agent (Done!)
- Test with real L&A NIGO incidents
- Gather user feedback

### Week 2: P&C
- Create P&C Claims Agent
- Test with claims processing incidents
- Deploy to production

### Week 3: Group Benefits
- Create Group Benefits Enrollment Agent
- Test with enrollment incidents
- Deploy to production

### Week 4: Voluntary Benefits
- Create Voluntary Benefits Agent
- Test with election/payroll incidents
- Deploy to production

### Week 5: Refinement
- Gather feedback across all agents
- Enhance Wiki integration
- Optimize classification logic

---

## 📚 Related Documentation

- **L&A NIGO Agent:** `backend/components/domain/life_annuity_nigo_agent.py`
- **Quick Win Tools:** `backend/components/QUICK_WIN_TOOLS.md`
- **Wiki RAG:** `backend/components/CustomWikiRAG.py`
- **Tool Registration:** `backend/components/shared_registry.py`

---

**Status:** Template Ready - Use L&A NIGO Agent as reference implementation  
**Next Action:** Integrate L&A NIGO Agent into orchestrator and test with real incidents
