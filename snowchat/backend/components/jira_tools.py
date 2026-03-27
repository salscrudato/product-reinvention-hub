"""Utilities and tool functions for interacting with Atlassian JIRA user stories.

This module provides lightweight wrappers around the JIRA Cloud REST API that can be
used by the agentic planner. The helpers handle authentication via API token, perform
basic issue searches, and format issue data so that downstream LLM summarisation stays
consistent.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

try:
    import openai
except Exception:  # pragma: no cover - openai is expected to be available in runtime
    openai = None  # type: ignore

from dotenv import load_dotenv

load_dotenv()

LOGGER = logging.getLogger("agentic_orchestrator_auto.jira")
if not LOGGER.handlers:
    file_handler = logging.FileHandler('snowchat_backend.log', mode='a', encoding='utf-8')
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    LOGGER.addHandler(file_handler)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.WARNING)
    LOGGER.addHandler(console_handler)
LOGGER.setLevel(logging.INFO)

DEFAULT_FIELDS = "summary,status,priority,assignee,reporter,created,updated,description"  # limit payload


def _default_project() -> Optional[str]:
    project = os.getenv("JIRA_DEFAULT_PROJECT")
    if project:
        return project.strip()
    return None


class JiraConfigurationError(RuntimeError):
    """Raised when configuration for JIRA is missing."""


def _get_auth() -> Tuple[str, str]:
    email = os.getenv("JIRA_EMAIL") or os.getenv("CONFLUENCE_EMAIL")
    token = os.getenv("JIRA_API_TOKEN") or os.getenv("CONFLUENCE_API_TOKEN")
    if not email or not token:
        raise JiraConfigurationError("JIRA_EMAIL/JIRA_API_TOKEN (or Confluence equivalents) must be configured.")
    return email, token


def _get_base_url() -> str:
    explicit = os.getenv("JIRA_API_BASE")
    if explicit:
        return explicit.rstrip('/')
    instance = os.getenv("JIRA_INSTANCE")
    if not instance:
        raise JiraConfigurationError("JIRA_INSTANCE or JIRA_API_BASE must be configured.")
    parsed = urlparse(instance)
    if not parsed.scheme or not parsed.netloc:
        raise JiraConfigurationError("JIRA_INSTANCE must be a valid URL.")
    return f"{parsed.scheme}://{parsed.netloc}/rest/api/3"


def _request(method: str, path: str, *, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    base_url = _get_base_url()
    email, token = _get_auth()
    url = f"{base_url}{path}"
    headers = {"Accept": "application/json"}
    try:
        LOGGER.debug("[JIRA] %s %s params=%s", method, url, params)
        response = requests.request(method, url, params=params, auth=(email, token), headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as exc:  # pragma: no cover - runtime IO
        LOGGER.error("[JIRA] Request failed: %s", exc)
        raise


def _flatten_adf(node: Any) -> str:
    """Best-effort conversion of Atlassian Document Format to plain text."""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        if isinstance(node, list):
            return "\n".join(filter(None, (_flatten_adf(item) for item in node)))
        return ""
    node_type = node.get("type")
    if node_type == "text":
        text = node.get("text", "")
        marks = node.get("marks") or []
        if marks:
            for mark in marks:
                mark_type = mark.get("type")
                if mark_type == "strong":
                    text = f"**{text}**"
                elif mark_type == "em":
                    text = f"*{text}*"
                elif mark_type == "code":
                    text = f"`{text}`"
        return text
    if node_type in ("paragraph", "heading", "bulletList", "orderedList", "listItem"):
        content = node.get("content") or []
        pieces = [
            _flatten_adf(child) for child in content
        ]
        pieces = [p for p in pieces if p]
        return " ".join(pieces).strip()
    if node_type == "hardBreak":
        return "\n"
    # Fallback recursively for any other node types
    content = node.get("content")
    if isinstance(content, list):
        return "\n".join(filter(None, (_flatten_adf(child) for child in content)))
    return ""


def _extract_description(fields: Dict[str, Any]) -> str:
    description = fields.get("description")
    if not description:
        return ""
    try:
        return _flatten_adf(description).strip()
    except Exception:  # pragma: no cover - defensive
        return str(description)


def _shape_issue(issue: Dict[str, Any]) -> Dict[str, Any]:
    fields = issue.get("fields", {}) if isinstance(issue, dict) else {}
    description = _extract_description(fields)
    data = {
        "key": issue.get("key"),
        "summary": fields.get("summary"),
        "status": (fields.get("status") or {}).get("name"),
        "priority": (fields.get("priority") or {}).get("name"),
        "assignee": ((fields.get("assignee") or {}).get("displayName")),
        "reporter": ((fields.get("reporter") or {}).get("displayName")),
        "story_points": fields.get("customfield_10016"),  # common default for story points (Scrum)
        "created": fields.get("created"),
        "updated": fields.get("updated"),
        "description": description,
    }
    return data


def search_jira_issues(query: str, *, max_results: int = 3) -> List[Dict[str, Any]]:
    safe_query = (query or "").strip()
    if not safe_query:
        return []
    safe_query = safe_query.replace('"', '\\"')
    default_project = _default_project()
    if default_project and "project" not in (query or "").lower():
        jql = f'project = "{default_project}" AND text ~ "{safe_query}" ORDER BY updated DESC'
    else:
        jql = f'text ~ "{safe_query}" ORDER BY updated DESC'
    payload = _request("GET", "/search", params={
        "jql": jql,
        "maxResults": max_results,
        "fields": DEFAULT_FIELDS
    })
    issues = payload.get("issues", []) if isinstance(payload, dict) else []
    return [_shape_issue(issue) for issue in issues]


def fetch_jira_issue(issue_key: str) -> Dict[str, Any]:
    issue_key = (issue_key or "").strip()
    if not issue_key:
        raise ValueError("issue_key is required")
    raw = _request("GET", f"/issue/{issue_key}", params={"fields": DEFAULT_FIELDS})
    return _shape_issue(raw)


def jira_fetch_user_story(*, issue_key: Optional[str] = None, query: Optional[str] = None, max_results: int = 3) -> Dict[str, Any]:
    """Fetch a user story by key or search query."""
    try:
        if issue_key:
            issue = fetch_jira_issue(issue_key)
            return {"issue": issue}
        if query:
            matches = search_jira_issues(query, max_results=max_results)
            return {
                "matches": matches,
                "note": "Multiple matches returned" if len(matches) != 1 else "Single match identified",
                "query": query
            }
        return {"error": "issue_key_or_query_required"}
    except JiraConfigurationError as conf_err:
        return {"error": str(conf_err)}
    except requests.exceptions.RequestException as exc:
        return {"error": f"Failed to contact JIRA: {exc}"}
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.error("[JIRA] Unexpected error in jira_fetch_user_story: %s", exc, exc_info=True)
        return {"error": f"Unexpected error fetching user story: {exc}"}


def _build_summary_prompt(issue: Dict[str, Any], user_question: Optional[str]) -> str:
    summary_lines = [
        f"Issue Key: {issue.get('key')}",
        f"Summary: {issue.get('summary')}",
        f"Status: {issue.get('status')}",
        f"Priority: {issue.get('priority')}",
        f"Assignee: {issue.get('assignee') or 'Unassigned'}",
        f"Reporter: {issue.get('reporter') or 'Unknown'}",
        f"Story Points: {issue.get('story_points')}",
        f"Created: {issue.get('created')}",
        f"Updated: {issue.get('updated')}"
    ]
    description = issue.get('description') or 'No description provided.'
    prompt = (
        "You are a product development copilot. Summarize the following JIRA user story for a "
        "cross-functional audience. Provide structured sections: Overview, Current Status, "
        "Key Acceptance Criteria or Requirements, Risks / Blockers, and Recommended Next Steps. "
        "Use concise bullet points when possible.\n\n"
        + "\n".join(summary_lines)
        + "\n\nDescription:\n"
        + description
    )
    if user_question:
        prompt += "\n\nUser Question / Additional Context:\n" + user_question
    return prompt


def jira_summarize_user_story(*, issue_key: Optional[str] = None, query: Optional[str] = None, user_question: Optional[str] = None) -> Dict[str, Any]:
    """Fetch (if necessary) and summarize a user story via LLM."""
    try:
        resolved_issue: Optional[Dict[str, Any]] = None
        matches: List[Dict[str, Any]] = []
        if issue_key:
            resolved_issue = fetch_jira_issue(issue_key)
        elif query:
            matches = search_jira_issues(query, max_results=3)
            if len(matches) == 1:
                resolved_issue = fetch_jira_issue(matches[0]["key"])
            else:
                return {
                    "error": "ambiguous_user_story",
                    "matches": matches,
                    "message": "Multiple stories match the description. Please specify the exact key.",
                    "query": query
                }
        else:
            return {"error": "issue_key_or_query_required"}
        if not resolved_issue:
            return {"error": "user_story_not_found", "issue_key": issue_key}
        if openai is None:
            return {"error": "openai_not_available", "issue": resolved_issue}
        model = os.getenv("GPT_MODEL_NAME", "gpt-3.5-turbo")
        prompt = _build_summary_prompt(resolved_issue, user_question)
        LOGGER.info("[JIRA] Summarising user story %s with model %s", resolved_issue.get('key'), model)
        response = openai.chat.completions.create(  # type: ignore[attr-defined]
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful AI assistant."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=600
        )
        summary = response.choices[0].message.content.strip() if response and response.choices else ""
        return {
            "issue": resolved_issue,
            "summary": summary,
            "model": model
        }
    except JiraConfigurationError as conf_err:
        return {"error": str(conf_err)}
    except requests.exceptions.RequestException as exc:  # pragma: no cover - runtime IO
        return {"error": f"Failed to contact JIRA: {exc}"}
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.error("[JIRA] Unexpected error in jira_summarize_user_story: %s", exc, exc_info=True)
        return {"error": f"Unexpected error summarizing user story: {exc}"}


def extract_issue_key(text: str) -> Optional[str]:
    """Return the first JIRA issue key pattern (e.g., SCRUM-123 or US-45) found in text."""
    if not text:
        return None
    pattern = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")
    match = pattern.search(text.upper())
    if match:
        return match.group(1)
    return None


__all__ = [
    "jira_fetch_user_story",
    "jira_summarize_user_story",
    "search_jira_issues",
    "fetch_jira_issue",
    "extract_issue_key"
]
