from typing import List, Optional
from .shared_registry import FUNCTION_REGISTRY

try:  # Attempt real import; tolerate absence
    from crewai import Agent  # type: ignore
except Exception:  # pragma: no cover
    class Agent:  # type: ignore
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)
        def __repr__(self):  # pragma: no cover
            return f"StubAgent(role={getattr(self,'role',None)})"

# Mapping of high-level capability keywords to existing tool names.
# This gives the persona a constrained tool set aligned with our orchestrator.
PRODUCT_OWNER_TOOL_MAP: List[str] = [
    'find_incidents_by_short_description',
    'fetch_servicenow_incident',
    'wiki_rag_tool'
]

ENGINEERING_LEAD_TOOL_MAP: List[str] = [
    'fetch_servicenow_incident',
    'find_incidents_by_short_description',
    'get_similar_incidents',
    'code_annotation_tool',
    'wiki_rag_tool'
]

DEVELOPER_TOOL_MAP: List[str] = [
    'fetch_servicenow_incident',
    'get_similar_incidents',
    'code_annotation_tool',
    'run_incident_query',
    'fetch_kb_articles',
    'fetch_change_records_related',
    'risk_assess_change',
    'fetch_cmdb_ci_context'
]

BUSINESS_OWNER_TOOL_MAP: List[str] = [
    'jira_fetch_user_story',
    'jira_summarize_user_story',
    'fetch_backlog_overview',
    'generate_plan_receipt'
]


def get_product_owner_agent(allow_delegation: bool = False, verbose: bool = False) -> Agent:
    """Return a CrewAI Agent (or stub) modeling a Product Owner persona.

    The Product Owner focuses on:
    - Understanding incident impact & frequency (uses incident search & fetch tools)
    - Checking documentation / runbooks for business & process alignment (wiki rag)
    - Framing prioritization questions (scoped here as tool reasoning, not execution)

    Tools are filtered to ensure they exist in FUNCTION_REGISTRY to avoid runtime errors.
    """
    available_tools = [t for t in PRODUCT_OWNER_TOOL_MAP if t in FUNCTION_REGISTRY]

    backstory = (
        "You are the Product Owner responsible for reliability and business value of the Email Delivery and Queue Management platform. "
        "You triage user-impacting issues, assess incident patterns for prioritization, and ensure sufficient documentation/runbooks exist."
    )

    goal = (
        "Identify the most impactful user problems, reference existing knowledge, surface missing documentation, "
        "and suggest prioritization context (frequency, severity, business impact)."
    )

    role = "Product Owner"

    # CrewAI Agent takes optional 'tools'; since our tools are plain callables in FUNCTION_REGISTRY, we attach them directly.
    tools = [FUNCTION_REGISTRY[t] for t in available_tools]

    return Agent(
        role=role,
        goal=goal,
        backstory=backstory,
        tools=tools,
        allow_delegation=allow_delegation,
        verbose=verbose
    )

def get_engineering_lead_agent(allow_delegation: bool = True, verbose: bool = False) -> Agent:
    """Return a CrewAI Agent (or stub) modeling an Engineering Lead persona.

    Focus areas:
    - Rapid technical triage (fetch incident, similarity lookups)
    - Pattern recognition across incidents (get_similar_incidents + short description searches)
    - Code-level traceability for suspected root causes (code_annotation_tool)
    - Ensuring procedural / runbook alignment (wiki_rag_tool)
    - Optionally delegates specialized follow-up (allow_delegation default True)
    """
    available_tools = [t for t in ENGINEERING_LEAD_TOOL_MAP if t in FUNCTION_REGISTRY]

    backstory = (
        "You are the Engineering Lead overseeing the Email Delivery stack. You balance speed and rigor: correlate incoming incidents, "
        "identify systemic risks, surface probable technical root causes, and guide responders toward validated fixes or workarounds."
    )

    goal = (
        "Produce concise, technically grounded assessments: confirm incident context, find similar historical cases, highlight code modules likely involved, "
        "and point to authoritative docs or runbooks for next steps."
    )

    role = "Engineering Lead"
    tools = [FUNCTION_REGISTRY[t] for t in available_tools]
    return Agent(
        role=role,
        goal=goal,
        backstory=backstory,
        tools=tools,
        allow_delegation=allow_delegation,
        verbose=verbose
    )

def get_business_owner_agent(allow_delegation: bool = False, verbose: bool = False) -> Agent:
    available_tools = [t for t in BUSINESS_OWNER_TOOL_MAP if t in FUNCTION_REGISTRY]
    backstory = (
        "You are the Business Owner responsible for login governance, regulatory alignment, and persona entitlements across the portal. "
        "You review evidence from JIRA, telemetry, and automated tests before approving releases."
    )
    goal = (
        "Audit authentication flows for compliance, verify persona entitlements, and ensure traceable acceptance criteria with supporting telemetry."
    )
    role = "Business Owner"
    tools = [FUNCTION_REGISTRY[t] for t in available_tools]
    return Agent(
        role=role,
        goal=goal,
        backstory=backstory,
        tools=tools,
        allow_delegation=allow_delegation,
        verbose=verbose
    )

def get_developer_agent(allow_delegation: bool = True, verbose: bool = False) -> Agent:
    available_tools = [t for t in DEVELOPER_TOOL_MAP if t in FUNCTION_REGISTRY]
    backstory = (
        "You are a Senior Developer responsible for implementing fixes and enhancements. You focus on reproducing issues, "
        "identifying code-level hotspots, consulting relevant KB/runbooks, and quickly assessing change risk to proceed safely."
    )
    goal = (
        "Deliver concise, implementation-ready guidance: confirm incident facts, highlight similar historical resolutions, "
        "pinpoint probable code modules, and outline a minimal safe fix or experiment path."
    )
    role = "Developer"
    tools = [FUNCTION_REGISTRY[t] for t in available_tools]
    return Agent(
        role=role,
        goal=goal,
        backstory=backstory,
        tools=tools,
        allow_delegation=allow_delegation,
        verbose=verbose
    )

__all__ = [
    "get_product_owner_agent",
    "get_engineering_lead_agent",
    "get_business_owner_agent",
    "get_developer_agent"
]
