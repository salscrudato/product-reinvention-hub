from typing import Dict, Any, List
import logging

from .crewai_personas import get_product_owner_agent, get_engineering_lead_agent, get_developer_agent, get_business_owner_agent
from . import developer_incident_tools  # ensure registration side-effects
from . import user_context_tools  # ensure user-context tools register (fetch_user_incidents,...)
from . import snowaaonetool  # ensure wiki_rag_tool (and related incident tools) register
from .shared_registry import FUNCTION_REGISTRY  # access registry for verification

logger = logging.getLogger("agentic_orchestrator_auto.persona_registry")

# Universal tool set - all tools available to all personas (persona filtering disabled for now)
ALL_TOOLS = {
    # Core incident tools
    "fetch_servicenow_incident", "find_incidents_by_short_description", "get_similar_incidents", 
    "fetch_backlog_overview", "run_incident_query", "query_incidents_by_date", 
    "get_incidents_created_today", "get_incidents_by_date_range",
    
    # Incident work notes & metadata
    "get_incident_work_notes", "summarize_incident_work_notes", "add_incident_work_note",
    "fetch_incident_work_notes_summary", "fetch_incident_attachment_list",
    "fetch_incident_state_timeline", "fetch_incident_resolution_history",
    "fetch_incident_assignment_history",
    
    # User-context tools
    "fetch_user_incidents", "suggest_user_incident_closure_actions", 
    "synthesize_user_incident_fix_plan",
    
    # Analytics & metrics
    "fetch_incident_counts_by_priority", "fetch_open_vs_closed_counts",
    "fetch_trending_incidents", "fetch_unassigned_incidents", 
    "fetch_top_assignment_groups", "fetch_mean_time_to_resolution_stats",
    "fetch_ci_incident_density", "fetch_assignment_group_load",
    
    # Code & PR tools
    "code_annotation_tool", "fetch_related_commits_stub", "fetch_recent_commits_for_ci",
    "fetch_pull_request_diff", "analyze_pr_change_risk", 
    "correlate_incident_with_recent_prs", "propose_code_patch_stub",
    "fetch_related_pull_requests", "map_error_signature_to_ci_density",
    "suggest_fix_from_history",
    
    # Change & CMDB
    "fetch_change_records_related", "risk_assess_change", "fetch_cmdb_ci_context",
    "fetch_recent_failed_changes", "create_draft_problem_record",
    
    # Knowledge & documentation
    "wiki_rag_tool", "fetch_kb_articles", "search_design_docs",
    
    # JIRA integration
    "jira_fetch_user_story", "jira_summarize_user_story",
    
    # Other
    "generate_plan_receipt"
}

PERSONA_DEFS: Dict[str, Dict[str, Any]] = {
    "business_owner": {
        "priority": 90,
        "greeting": "Hi, I'm your Business Owner Copilot — ready to audit login flows and entitlement controls.",
        "preamble": "You are acting as a Business Owner focused on compliance, persona governance, and traceable evidence.",
        "factory": get_business_owner_agent,
        "tools": ALL_TOOLS,
        "style": "Focus on persona entitlements, compliance evidence, telemetry insights, and next governance steps.",
        "output_format": [
            "Persona Entitlements",
            "Linked JIRA Evidence",
            "Telemetry Signals",
            "Recommended Actions"
        ]
    },
    "engineering_lead": {
        "priority": 100,
        "greeting": "Hi, I'm your Engineering Lead Copilot — ready to correlate incidents and surface likely technical causes.",
        "preamble": "You are acting as an Engineering Lead focusing on correlation, systemic risk, and technical guidance.",
        "factory": get_engineering_lead_agent,
        "tools": ALL_TOOLS,
        "style": "Correlate incidents, identify systemic patterns, propose probable technical causes, next diagnostic steps.",
        "output_format": [
            "Incident Context",
            "Similarity / Related Incidents",
            "Probable Technical Causes",
            "Next Diagnostic Actions"
        ]
    },
    "developer": {
        "priority": 80,
        "greeting": "Hi, I'm your Developer Copilot — let's reproduce issues and move toward a safe fix.",
        "preamble": "You are acting as a hands-on Developer focusing on reproduction, code hotspots, and safe change steps.",
        "factory": get_developer_agent,
        "tools": ALL_TOOLS,
        "style": "Hands-on implementer focusing on rapid reproduction, actionable fixes, change risk awareness, and code/document alignment.",
        "output_format": [
            "Immediate Triage Findings",
            "Relevant Similar Cases",
            "Suspected Code Areas",
            "Suggested Fix / Next Steps"
        ]
    },
    "product_owner": {
        "priority": 60,
        "greeting": "Hi, I'm your Product Owner Copilot — here to frame impact and prioritization context.",
        "preamble": "You are acting as a Product Owner focusing on business impact, frequency trends, and prioritization.",
        "factory": get_product_owner_agent,
        "tools": ALL_TOOLS,
        "style": "Focus on business impact, frequency trends, documentation gaps, prioritization rationale.",
        "output_format": [
            "Business Impact",
            "Frequency / Pattern",
            "Documentation Gaps",
            "Suggested Backlog Action"
        ]
    },
    # Placeholders for future expansion (SRE & Support Analyst) with minimal fields to avoid breakage now.
    "sre": {
        "priority": 50,
        "greeting": "Hi, I'm your SRE Copilot — focused on reliability signals and mitigation steps.",
        "preamble": "You are acting as an SRE focusing on reliability metrics, error budgets, and mitigations.",
        "factory": get_engineering_lead_agent,
        "tools": ALL_TOOLS,
        "style": "Reliability-centric analysis of incidents and proactive mitigation recommendations.",
        "output_format": ["Reliability Signals", "Error Budget Impact", "Mitigation Options", "Next Actions"]
    },
    "support_analyst": {
        "priority": 40,
        "greeting": "Hi, I'm your Support Analyst Copilot — ready to triage end-user issues efficiently.",
        "preamble": "You are acting as a Support Analyst focusing on quick triage, user impact clarification, and escalation criteria.",
        "factory": get_product_owner_agent,
        "tools": ALL_TOOLS,
        "style": "User impact clarification, severity triage, and escalation guidance.",
        "output_format": ["User Impact", "Known Patterns", "Immediate Guidance", "Escalation Criteria"]
    }
}
logger.debug(f"[persona_registry] Loaded persona definitions: {list(PERSONA_DEFS.keys())}")
if 'wiki_rag_tool' not in FUNCTION_REGISTRY:
    logger.warning('[persona_registry] wiki_rag_tool not present in FUNCTION_REGISTRY after snowaaonetool import; registration may have failed.')
else:
    logger.debug('[persona_registry] Verified wiki_rag_tool registered in FUNCTION_REGISTRY.')

# Basic keyword heuristics for persona selection
PRODUCT_OWNER_KEYWORDS = ["impact", "priority", "backlog", "policy", "runbook", "escalation", "business"]
ENGINEERING_LEAD_KEYWORDS = ["stack trace", "root cause", "deploy", "code ", "refactor", "error rate", "latency", "throughput", "trace", "similar incident", "similar incidents"]
DEVELOPER_OWNERSHIP_KEYWORDS = [
    "my incidents", "my open incidents", "assigned to me", "my backlog", "things assigned to me", "my tickets",
    "incidents for me", "incidents assigned to me", "dev1 incidents", "incidents for dev1"
]
BUSINESS_OWNER_KEYWORDS = [
    "business owner", "login governance", "persona entitlement", "lockout report", "compliance audit"
]


def select_persona(question: str, metadata: Dict[str, Any] | None = None) -> str:
    ql = (question or "").lower()
    if "@lead" in ql:
        return "engineering_lead"
    if "@po" in ql:
        return "business_owner"
    if any(k in ql for k in BUSINESS_OWNER_KEYWORDS):
        return "business_owner"
    if any(k in ql for k in ENGINEERING_LEAD_KEYWORDS):
        return "engineering_lead"
    # Developer hints (more implementation-centric)
    if any(k in ql for k in ("stack trace", "null pointer", "exception", "traceback", "performance test", "memory leak", "optimize", "query plan")):
        return "developer"
    if any(k in ql for k in DEVELOPER_OWNERSHIP_KEYWORDS):
        return "developer"
    if any(k in ql for k in PRODUCT_OWNER_KEYWORDS):
        return "business_owner"
    # Optional metadata hint
    cat = (metadata or {}).get("category") if metadata else None
    if cat in ("developer", "triage", "similar"):
        return "engineering_lead"
    if cat in ("knowledge", "workaround"):
        return "product_owner"
    return "product_owner"

__all__ = ["PERSONA_DEFS", "select_persona"]
