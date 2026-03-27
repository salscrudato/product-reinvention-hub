# Central registry for all agentic orchestrator tools
# Import all tool functions and LangChain Tool objects here

from .snowaaonetool import (
    my_fetch_all_incidents,
    fetch_servicenow_incident,
    fetch_servicenow_incident_core,
    fetch_servicenow_incident_genai,
    analyze_incident_core,
    get_incident_table_metadata,
    get_faiss_indices,
    workaround_lookup_core,
    generate_splunk_query_core,
    predict_assignment_group_core,
    splunk_query,
    splunk_completed_query,
    retrieve_context,
    get_similar_incidents_simple,
    code_annotation_tool,
    wiki_rag_tool,
    generate_plan_receipt,
    my_fetch_all_incidents_tool,
    get_similar_incidents_simple_tool,
    fetch_servicenow_incident_tool,
    analyze_incident_tool,
    get_incident_table_metadata_tool,
    get_faiss_indices_tool,
    workaround_lookup_tool,
    predict_assignment_group_tool,
    splunk_query_tool,
    splunk_completed_query_tool,
    retrieve_context_tool,
    find_incidents_by_short_description_tool,
    generate_plan_receipt_tool_def,
    jira_fetch_user_story,
    jira_summarize_user_story,
    jira_fetch_user_story_tool_def,
    jira_summarize_user_story_tool_def
)
from .servicenow_extended_tools import EXTENDED_SERVICE_NOW_TOOLS
from .user_context_tools import fetch_user_incidents, suggest_user_incident_closure_actions, synthesize_user_incident_fix_plan
from .DataDogTools import (
    datadog_get_user_logs,
    datadog_get_service_traces,
    datadog_search_spans,
    datadog_get_user_rum_sessions,
    datadog_get_user_logs_tool,
    datadog_get_service_traces_tool,
    datadog_search_spans_tool,
    datadog_get_user_rum_sessions_tool,
    datadog_auto_investigate,
    datadog_auto_investigate_tool
)

# Central dictionary for all tool functions (for execution)
agentic_orchestrator_auto_tools = {
    # Core functions
    "my_fetch_all_incidents": my_fetch_all_incidents,
    "fetch_servicenow_incident": fetch_servicenow_incident_core,
    "fetch_servicenow_incident_genai": fetch_servicenow_incident_genai,
    "analyze_incident": analyze_incident_core,
    "get_incident_table_metadata": get_incident_table_metadata,
    "get_faiss_indices": get_faiss_indices,
    "workaround_lookup": workaround_lookup_core,
    "generate_splunk_query": generate_splunk_query_core,
    "predict_assignment_group": predict_assignment_group_core,
    "splunk_query": splunk_query,
    "splunk_completed_query": splunk_completed_query,
    "retrieve_context": retrieve_context,
    "find_incidents_by_short_description": find_incidents_by_short_description_tool,
    "get_similar_incidents": get_similar_incidents_simple,
    "code_annotation_tool": code_annotation_tool,
    "wiki_rag_tool": wiki_rag_tool,
    "generate_plan_receipt": generate_plan_receipt,
    "jira_fetch_user_story": jira_fetch_user_story,
    "jira_summarize_user_story": jira_summarize_user_story,
    # LangChain Tool objects (for agent frameworks)
    "my_fetch_all_incidents_tool": my_fetch_all_incidents_tool,
    "get_similar_incidents_simple_tool": get_similar_incidents_simple_tool,
    "fetch_servicenow_incident_tool": fetch_servicenow_incident_tool,
    "analyze_incident_tool": analyze_incident_tool,
    "get_incident_table_metadata_tool": get_incident_table_metadata_tool,
    "get_faiss_indices_tool": get_faiss_indices_tool,
    "workaround_lookup_tool": workaround_lookup_tool,
    "predict_assignment_group_tool": predict_assignment_group_tool,
    "splunk_query_tool": splunk_query_tool,
    "splunk_completed_query_tool": splunk_completed_query_tool,
    "retrieve_context_tool": retrieve_context_tool
    ,"find_incidents_by_short_description_tool": find_incidents_by_short_description_tool
    ,"generate_plan_receipt_tool": generate_plan_receipt_tool_def
    ,"fetch_user_incidents": fetch_user_incidents
    ,"suggest_user_incident_closure_actions": suggest_user_incident_closure_actions
    ,"synthesize_user_incident_fix_plan": synthesize_user_incident_fix_plan
    ,"datadog_get_user_logs": datadog_get_user_logs
    ,"datadog_get_service_traces": datadog_get_service_traces
    ,"datadog_search_spans": datadog_search_spans
    ,"datadog_get_user_rum_sessions": datadog_get_user_rum_sessions
    ,"datadog_get_user_logs_tool": datadog_get_user_logs_tool
    ,"datadog_get_service_traces_tool": datadog_get_service_traces_tool
    ,"datadog_search_spans_tool": datadog_search_spans_tool
    ,"datadog_get_user_rum_sessions_tool": datadog_get_user_rum_sessions_tool
    ,"datadog_auto_investigate": datadog_auto_investigate
    ,"datadog_auto_investigate_tool": datadog_auto_investigate_tool
    ,"jira_fetch_user_story_tool": jira_fetch_user_story_tool_def
    ,"jira_summarize_user_story_tool": jira_summarize_user_story_tool_def
}

# Add extended ServiceNow tools
agentic_orchestrator_auto_tools.update(EXTENDED_SERVICE_NOW_TOOLS)
