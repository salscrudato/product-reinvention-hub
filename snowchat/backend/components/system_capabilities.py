"""System Capabilities Registry

This module defines what the agentic AI system CAN and CANNOT do.
The pre-planning analyzer uses this to validate scope before attempting to plan.

Philosophy
----------
Instead of hard-coding fixes for each edge case, we declaratively define:
- What domains/integrations are supported
- What operations are available within each domain
- What limitations/boundaries exist
- What requests are out of scope

This allows the LLM to reason about feasibility BEFORE planning.
"""

import os
import logging
from typing import Dict, Any, List

# Use unified logger hierarchy to write to agentic_orchestrator_auto.log
logger = logging.getLogger("agentic_orchestrator_auto.system_capabilities")
logger.setLevel(logging.INFO)
logger.propagate = True  # Propagate to parent logger

# ============================================================================
# SYSTEM CAPABILITIES DEFINITION
# ============================================================================

SYSTEM_CAPABILITIES = {
    "supported_domains": {
        "incident_management": {
            "enabled": True,
            "data_source": "ServiceNow",
            "description": "Query, analyze, and manage IT incidents",
            "operations": [
                "query_incidents",
                "fetch_incident_details",
                "get_work_notes",
                "summarize_work_notes",
                "analyze_bulk_work_notes",
                "get_similar_incidents",
                "update_incident",
                "add_work_note",
                "predict_assignment_group",
                "get_incident_history",
                "pattern_recognition",
                "category_classification",
                "intelligent_workaround_search",  # Phase 2
                "identify_root_cause",  # Phase 3
                "track_workaround_outcome"  # Phase 2 feedback
            ],
            "batch_operations": {
                "work_notes": {
                    "supported": True,
                    "max_batch_size": 50,
                    "notes": "Can process multiple incidents for work notes summary"
                },
                "bulk_analysis": {
                    "supported": True,
                    "min_incidents": 5,
                    "max_incidents": 100,
                    "recommended_sample": 50,
                    "notes": "Aggregate pattern analysis, classification, and theme extraction",
                    "triggers": [
                        "these incidents",
                        "overall summary",
                        "aggregate",
                        "patterns",
                        "top categories",
                        "classify",
                        "not just one incident",
                        "common themes",
                        "recurring"
                    ]
                },
                "workaround_search": {
                    "supported": True,
                    "method": "semantic_embedding_search",
                    "features": ["success_tracking", "ranking", "escalation_detection"],
                    "notes": "Phase 2: Intelligent Workaround Agent with FAISS semantic search",
                    "triggers": [
                        "what workarounds",
                        "temporary fix",
                        "known workarounds",
                        "how have others resolved",
                        "any quick fix",
                        "workaround for"
                    ]
                },
                "root_cause_identification": {
                    "supported": True,
                    "method": "symptom_to_cause_mapping",
                    "features": [
                        "historical_pattern_analysis",
                        "cascading_failure_detection",
                        "code_correlation",
                        "confidence_scoring"
                    ],
                    "notes": "Phase 3: Root Cause Identification Agent with multi-incident correlation",
                    "triggers": [
                        "what is the root cause",
                        "why did this happen",
                        "what caused",
                        "identify root cause",
                        "root cause of",
                        "what's causing"
                    ]
                },
                "query": {
                    "supported": True,
                    "max_results": 1000,
                    "max_date_range_days": 90
                }
            },
            "field_formats": {
                "sys_created_on": {
                    "type": "datetime",
                    "format": "YYYY-MM-DD HH:MM:SS",
                    "required": "full timestamp including time component",
                    "example": "2026-02-25 14:30:00"
                },
                "sys_updated_on": {
                    "type": "datetime",
                    "format": "YYYY-MM-DD HH:MM:SS",
                    "required": "full timestamp including time component"
                },
                "opened_at": {
                    "type": "datetime",
                    "format": "YYYY-MM-DD HH:MM:SS",
                    "required": "full timestamp including time component"
                },
                "number": {
                    "type": "string",
                    "pattern": "INC[0-9]{7}",
                    "example": "INC0013485"
                }
            },
            "keywords": ["incident", "INC", "ticket", "issue", "problem", "servicenow"],
            "write_operations": ["update_incident", "add_work_note", "assign_incident"],
            "read_operations": ["query", "fetch", "get", "summarize", "search"]
        },
        
        "knowledge_retrieval": {
            "enabled": True,
            "data_source": "Confluence",
            "description": "Search documentation, runbooks, and wiki pages",
            "operations": [
                "wiki_rag_tool",
                "wiki_search",
                "documentation_lookup"
            ],
            "max_results": 20,
            "keywords": ["wiki", "documentation", "how to", "runbook", "@wiki", "confluence", "docs"],
            "annotations": ["@wiki"],
            "notes": "Use @wiki annotation for targeted documentation search"
        },
        
        "log_analysis": {
            "enabled": True,
            "data_source": "DataDog",
            "description": "Analyze logs, traces, and observability data",
            "operations": [
                "datadog_get_user_logs",
                "datadog_get_service_traces",
                "datadog_search_spans",
                "datadog_auto_investigate"
            ],
            "max_results": 1000,
            "max_time_range_minutes": 1440,  # 24 hours
            "keywords": ["logs", "traces", "@log", "observability", "datadog", "monitoring", "errors"],
            "annotations": ["@log"],
            "notes": "Use @log annotation for log/trace analysis"
        },
        
        "code_search": {
            "enabled": True,
            "data_source": "GitHub",
            "description": "Search code repositories and find similar code",
            "operations": [
                "code_search",
                "find_similar_code",
                "code_rag_tool"
            ],
            "keywords": ["code", "@code", "repository", "function", "class", "github"],
            "annotations": ["@code"],
            "notes": "Use @code annotation for code repository search"
        },
        
        "backlog_management": {
            "enabled": True,
            "data_source": "JIRA",
            "description": "Query and manage JIRA user stories, epics, and development backlog",
            "operations": [
                "jira_fetch_user_story",
                "jira_summarize_user_story",
                "search_jira_issues",
                "fetch_backlog_overview",
                "search_backlog",
                "get_backlog_item"
            ],
            "keywords": ["backlog", "sprint", "story", "epic", "feature", "jira", "user story"],
            "id_patterns": ["[A-Z]{2,10}-\\d+"],
            "notes": "JIRA integration configured - can fetch user stories by ID (e.g., IN-4, PROJ-123)"
        },
        
        "insurance_quote": {
            "enabled": True,
            "data_source": "Insurance Policy System (Mock)",
            "description": "Calculate insurance quotes, analyze policy changes, compare premiums",
            "operations": [
                "list_available_policies",
                "fetch_policy_details",
                "get_zip_risk_rating",
                "get_vehicle_details",
                "calculate_premium",
                "format_quote_comparison"
            ],
            "keywords": [
                "insurance", "premium", "quote", "policy", "auto insurance", 
                "moving", "zip code", "relocation", "coverage", "vehicle",
                "risk rating", "premium impact", "insurance quote"
            ],
            "triggers": [
                "insurance quote",
                "premium impact",
                "moving from",
                "zip code",
                "auto insurance",
                "what will my premium be"
            ],
            "notes": "Mock insurance demo - demonstrates agentic orchestration with policy selection and lean API data flow"
        }
    },
    
    "unsupported_domains": {
        "deployment": {
            "reason": "No integration with deployment systems (Jenkins, Kubernetes)",
            "alternative": "Use Jenkins UI or kubectl commands for deployments",
            "suggest_docs": "I can help find deployment documentation with @wiki",
            "keywords": ["deploy", "release", "deployment", "rollback", "rollout"]
        },
        
        "billing_finance": {
            "reason": "No access to billing or financial systems (EXCEPT: Insurance quotes are supported - see insurance_quote domain)",
            "alternative": "Contact finance team or check billing portal. For insurance quotes, I can help!",
            "keywords": ["cost", "billing", "invoice", "payment", "budget", "expense"],
            "exception_keywords": ["insurance", "premium", "quote", "policy"]
        },
        
        "hr_related": {
            "reason": "No access to HR systems or employee data",
            "alternative": "Contact HR or use HR portal (Workday/BambooHR)",
            "keywords": ["employee", "vacation", "PTO", "salary", "onboarding", "performance review"]
        },
        
        "monitoring_config": {
            "reason": "Read-only access to observability, cannot modify alerts or dashboards",
            "alternative": "Use DataDog UI to configure monitors and alerts",
            "suggest_docs": "I can help find monitoring setup documentation",
            "keywords": ["create alert", "configure monitor", "set up alarm", "create dashboard"]
        },
        
        "database_modifications": {
            "reason": "No direct database access for safety and compliance",
            "alternative": "Use ServiceNow API for incident updates, or request DBA support",
            "keywords": ["update database", "delete records", "modify table", "SQL update"]
        },
        
        "security_credentials": {
            "reason": "Cannot access, store, or manage credentials",
            "alternative": "Use vault systems (HashiCorp Vault, AWS Secrets Manager)",
            "keywords": ["password", "secret", "api key", "credential", "token"]
        }
    },
    
    "clarification_patterns": {
        "ambiguous_references": {
            "patterns": ["it", "that", "this", "the thing", "the issue", "the problem"],
            "without_context": True,
            "ask_for": "Specific incident number (INC0013485), service name, or more details",
            "example": "Which incident are you referring to? Please provide the INC number."
        },
        
        "vague_time_references": {
            "patterns": ["recently", "a while ago", "some time back", "earlier", "before"],
            "ask_for": "Specific date or time range (e.g., 'last 3 days', 'yesterday', 'this week')",
            "example": "When exactly? Try 'yesterday', 'last 3 days', or a specific date."
        },
        
        "incomplete_queries": {
            "patterns": ["find the", "show me", "what about", "tell me about"],
            "ask_for": "Complete the question with what specifically to find/show",
            "example": "What would you like me to find? (incidents, documentation, logs, etc.)"
        },
        
        "missing_scope": {
            "patterns": ["all incidents", "everything", "all of them"],
            "ask_for": "Narrow scope with filters (date range, category, priority, etc.)",
            "example": "That's a lot of data. Can you narrow it down? (time range, category, etc.)"
        }
    },
    
    "capability_boundaries": {
        "max_incident_batch_size": 50,
        "max_date_range_days": 90,
        "max_wiki_results": 20,
        "max_log_entries": 1000,
        "max_code_search_results": 50,
        "max_concurrent_operations": 5,
        
        "read_only_operations": [
            "query", "fetch", "get", "search", "summarize", "analyze", "find"
        ],
        
        "write_operations": [
            "update", "add", "assign", "create", "modify"
        ],
        
        "requires_confirmation": [
            "close_incident", "delete", "assign_to_different_team"
        ],
        
        "time_constraints": {
            "datadog_logs": "Last 24 hours recommended, max 7 days",
            "incident_query": "Last 90 days max",
            "wiki_search": "No time constraints"
        }
    },
    
    "common_pitfalls": {
        "date_queries": [
            "Do NOT use training data dates (June 2024 or earlier)",
            "Always extract current date from system context",
            "ServiceNow datetime fields MUST include time component HH:MM:SS",
            "When user says 'yesterday', 'last week', etc., calculate from current date",
            "Date-only queries (YYYY-MM-DD) will fail - must include time"
        ],
        
        "bulk_operations": [
            "If short_term_memory has incident_count > 1, assume bulk intent",
            "User phrases like 'all', 'these incidents', 'overall summary', 'not just one' indicate bulk",
            "Don't extrapolate from single incident to represent entire dataset",
            "Respect max_batch_size limits, chunk if necessary",
            "Tell user if request exceeds batch limits"
        ],
        
        "context_references": [
            "If user says 'these incidents', 'those', 'from earlier', check short_term_memory",
            "Canonical incident in short_term_memory is the primary reference",
            "Without clear context, ask user for specifics rather than guessing"
        ],
        
        "tool_hallucination": [
            "Only use tools that exist in FUNCTION_REGISTRY",
            "Don't invent tool names or operations",
            "If no suitable tool exists, tell user what you CAN'T do"
        ]
    }
}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_system_capabilities() -> Dict[str, Any]:
    """
    Return complete system capabilities for LLM reasoning.
    
    Returns:
        Dict containing supported/unsupported domains, boundaries, and pitfalls
    """
    return SYSTEM_CAPABILITIES


def is_domain_supported(domain: str) -> bool:
    """
    Check if a domain is supported.
    
    Args:
        domain: Domain identifier (e.g., 'incident_management', 'deployment')
    
    Returns:
        True if domain is in supported_domains and enabled
    """
    supported = SYSTEM_CAPABILITIES.get("supported_domains", {})
    return domain in supported and supported[domain].get("enabled", False)


def get_domain_operations(domain: str) -> List[str]:
    """
    Get available operations for a domain.
    
    Args:
        domain: Domain identifier
    
    Returns:
        List of operation names, or empty list if domain not supported
    """
    if not is_domain_supported(domain):
        return []
    
    supported = SYSTEM_CAPABILITIES.get("supported_domains", {})
    return supported.get(domain, {}).get("operations", [])


def get_unsupported_reason(domain: str) -> str:
    """
    Get reason why a domain is unsupported and alternatives.
    
    Args:
        domain: Domain identifier
    
    Returns:
        Explanation string with reason and alternatives
    """
    unsupported = SYSTEM_CAPABILITIES.get("unsupported_domains", {})
    
    if domain in unsupported:
        info = unsupported[domain]
        message = f"{info['reason']}.\n\n"
        message += f"Alternative: {info['alternative']}"
        
        if info.get('suggest_docs'):
            message += f"\n{info['suggest_docs']}"
        
        return message
    
    return f"Domain '{domain}' is not in the supported or unsupported list."


def check_capability_boundaries(operation_type: str, requested_value: int) -> Dict[str, Any]:
    """
    Check if requested operation is within capability boundaries.
    
    Args:
        operation_type: Type of boundary (e.g., 'max_incident_batch_size')
        requested_value: Value being requested
    
    Returns:
        Dict with 'within_bounds', 'max_allowed', 'requested', 'suggestion'
    """
    boundaries = SYSTEM_CAPABILITIES.get("capability_boundaries", {})
    max_allowed = boundaries.get(operation_type)
    
    if max_allowed is None:
        return {
            "within_bounds": True,
            "reason": "No boundary defined for this operation"
        }
    
    within_bounds = requested_value <= max_allowed
    
    return {
        "within_bounds": within_bounds,
        "max_allowed": max_allowed,
        "requested": requested_value,
        "suggestion": f"Request is within limits" if within_bounds else 
                     f"Requested {requested_value} exceeds limit of {max_allowed}. Please narrow your request."
    }


def identify_domain_from_question(question: str) -> List[str]:
    """
    Identify potential domains based on keywords in question.
    
    Args:
        question: User's question text
    
    Returns:
        List of domain identifiers that might be relevant
    """
    question_lower = question.lower()
    potential_domains = []
    
    # Check supported domains
    for domain, info in SYSTEM_CAPABILITIES.get("supported_domains", {}).items():
        keywords = info.get("keywords", [])
        if any(keyword in question_lower for keyword in keywords):
            potential_domains.append(domain)
    
    # Check unsupported domains (to detect out-of-scope requests)
    for domain, info in SYSTEM_CAPABILITIES.get("unsupported_domains", {}).items():
        keywords = info.get("keywords", [])
        if any(keyword in question_lower for keyword in keywords):
            potential_domains.append(f"unsupported:{domain}")
    
    return potential_domains


def get_clarification_guidance(question: str) -> Dict[str, Any]:
    """
    Identify if question needs clarification based on patterns.
    
    Args:
        question: User's question text
    
    Returns:
        Dict with 'needs_clarification', 'patterns_matched', 'suggested_response'
    """
    question_lower = question.lower()
    patterns = SYSTEM_CAPABILITIES.get("clarification_patterns", {})
    
    # BYPASS: Complete queries that should NOT trigger clarification
    # These patterns indicate the query is already complete and specific
    complete_query_indicators = [
        # Time-based queries
        (r'last \d+ (day|days|week|weeks|month|months|year|years)', 'time_range'),
        (r'in the (last|past) \d+', 'time_range'),
        (r'from .+ to .+', 'time_range'),
        (r'updated (in|on|between)', 'time_range'),
        (r'created (in|on|between)', 'time_range'),
        (r'(yesterday|today|this week|this month)', 'time_range'),
        
        # Specific entity queries
        (r'(inc|incident)\d+', 'incident_number'),
        (r'\b[a-z]{2,10}-\d+\b', 'jira_user_story'),  # JIRA user story IDs (e.g., in-4, scrum-123) - lowercase since question_lower
        (r'user story [a-z]{2,10}-\d+', 'jira_user_story_explicit'),
        (r'@wiki\b', 'wiki_annotation'),  # Wiki annotation - direct wiki search
        (r'incidents (that|which|with)', 'specific_criteria'),
        (r'(show|find|get|fetch) (me )?(the |all )?(incidents|policies|tickets)', 'entity_type'),
        
        # Action with complete object
        (r'(analyze|summarize|classify) (the )?\w+', 'complete_action'),
        (r'what (is|are) the \w+', 'complete_question'),
        (r'(categories|patterns|root cause) (of|for|in)', 'analysis_query'),
        
        # Follow-up questions (clearly referencing previous context/results)
        (r'which (incidents|ones|tickets).*(with|having|suffering|that have)', 'contextual_filter'),
        (r'(show|tell|list|give) me (the )?(incidents|ones|tickets) (with|having|suffering|that)', 'contextual_request'),
        (r'what are the (incidents|tickets) (with|having|that)', 'contextual_question'),
        (r'can you (show|tell|list|identify).*(incidents|tickets)', 'contextual_imperative'),
        (r'(filter|identify|find).*(incidents|those|these)', 'contextual_filter')
    ]
    
    import re
    for pattern, reason in complete_query_indicators:
        if re.search(pattern, question_lower):
            # Query is complete - bypass clarification
            return {
                "needs_clarification": False,
                "patterns_matched": [],
                "suggested_response": None,
                "bypass_reason": reason
            }
    
    matched_patterns = []
    
    for pattern_type, pattern_info in patterns.items():
        if any(p in question_lower for p in pattern_info.get("patterns", [])):
            matched_patterns.append({
                "type": pattern_type,
                "ask_for": pattern_info.get("ask_for"),
                "example": pattern_info.get("example")
            })
    
    if matched_patterns:
        return {
            "needs_clarification": True,
            "patterns_matched": matched_patterns,
            "suggested_response": "\n".join([p["example"] for p in matched_patterns])
        }
    
    return {
        "needs_clarification": False,
        "patterns_matched": [],
        "suggested_response": None
    }


# ============================================================================
# CAPABILITY SUMMARY (For LLM Consumption)
# ============================================================================

def get_capability_summary_for_llm() -> str:
    """
    Generate a concise summary of capabilities for LLM prompts.
    
    Returns:
        Formatted string summarizing what the system can and cannot do
    """
    caps = SYSTEM_CAPABILITIES
    
    summary = "SYSTEM CAPABILITIES SUMMARY\n"
    summary += "=" * 60 + "\n\n"
    
    summary += "WHAT I CAN DO:\n"
    for domain, info in caps.get("supported_domains", {}).items():
        if info.get("enabled"):
            summary += f"\n• {info['description']} ({info['data_source']})\n"
            summary += f"  Operations: {', '.join(info['operations'][:5])}"
            if len(info['operations']) > 5:
                summary += f" (+{len(info['operations']) - 5} more)"
            summary += "\n"
    
    summary += "\n" + "=" * 60 + "\n"
    summary += "WHAT I CANNOT DO:\n"
    for domain, info in caps.get("unsupported_domains", {}).items():
        summary += f"\n• {domain.replace('_', ' ').title()}: {info['reason']}\n"
    
    summary += "\n" + "=" * 60 + "\n"
    summary += "LIMITS:\n"
    boundaries = caps.get("capability_boundaries", {})
    summary += f"• Incident batch size: {boundaries.get('max_incident_batch_size')}\n"
    summary += f"• Date range: {boundaries.get('max_date_range_days')} days\n"
    summary += f"• Log entries: {boundaries.get('max_log_entries')}\n"
    
    return summary


# ============================================================================
# MODULE INITIALIZATION
# ============================================================================

if __name__ == "__main__":
    # Test capability detection
    print(get_capability_summary_for_llm())
    print("\nTesting domain detection:")
    print("Question: 'Show me incidents created yesterday'")
    print(f"Domains: {identify_domain_from_question('Show me incidents created yesterday')}")
    print("\nQuestion: 'Deploy the auth service to production'")
    print(f"Domains: {identify_domain_from_question('Deploy the auth service to production')}")
