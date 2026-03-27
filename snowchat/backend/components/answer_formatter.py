"""answer_formatter

Generic, configuration-lite answer formatting. Avoids hard-coding domain fields.

Applied when ENABLE_GENERIC_FORMATTER env flag is truthy.

Heuristics:
 - Always include original user question.
 - Include rolling summary (if present in metadata) as a compressed history section.
 - Include conversation_context block when present.
 - For each tool output, create a section named after the tool key.
   * Dict values: render key:value lines (truncated) up to max lines.
   * List of dicts: render first N items with key subset (number/id, short_description/description/state/priority if present) but generically discovered.
   * Primitive/list of primitives: render as bullet list or scalar line.
 - Append final synthesized answer at the end.

Truncation:
 - Values > 300 chars are truncated with ellipsis.
 - Max 15 lines per section to minimize token overhead.

Return markdown string with '##' level headings for top-level sections.
"""
from __future__ import annotations
from typing import Any, Dict, List
import os, json

MAX_LINES_PER_SECTION = int(os.getenv('FORMATTER_MAX_LINES', '15'))
TRUNCATE_LEN = int(os.getenv('FORMATTER_TRUNCATE_LEN', '300'))

def _truncate(val: Any) -> str:
    s = ''
    try:
        if isinstance(val, (dict, list)):
            s = json.dumps(val, default=str)
        else:
            s = str(val)
    except Exception:
        s = str(val)
    if len(s) > TRUNCATE_LEN:
        return s[:TRUNCATE_LEN] + '…'
    return s

def _flatten_dict(d: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    for k, v in d.items():
        if isinstance(v, dict):
            # shallow render
            inner_preview = ', '.join(f"{ik}={_truncate(iv)}" for ik, iv in list(v.items())[:4])
            lines.append(f"{k}: {{ {inner_preview} }}")
        elif isinstance(v, list):
            lines.append(f"{k}: list[{len(v)}]")
        else:
            lines.append(f"{k}: {_truncate(v)}")
        if len(lines) >= MAX_LINES_PER_SECTION:
            break
    return lines

def _format_list_of_dicts(rows: List[Dict[str, Any]]) -> List[str]:
    if not rows:
        return []
    # discover common keys
    common_keys = set(rows[0].keys())
    for r in rows[1:5]:  # only sample first few
        common_keys &= set(r.keys())
    # Prioritize a small subset if too many keys
    preferred_order = [
        'number','id','incident_number','short_description','description','state','status','priority','assigned_to'
    ]
    ordered_keys = [k for k in preferred_order if k in common_keys]
    if not ordered_keys:
        ordered_keys = list(common_keys)[:5]
    lines: List[str] = []
    for idx, r in enumerate(rows[:MAX_LINES_PER_SECTION]):
        parts = []
        for k in ordered_keys:
            val = r.get(k)
            if isinstance(val, dict) and 'value' in val:
                val = val.get('value')
            parts.append(f"{k}={_truncate(val)}")
        line = f"- {idx+1}. " + "; ".join(parts)
        lines.append(line)
    return lines

def format_answer(question: str, final_answer: str, metadata: Dict[str, Any] | None, tool_outputs: Dict[str, Any] | None) -> str:
    md: Dict[str, Any] = metadata or {}
    outputs: Dict[str, Any] = tool_outputs or {}
    sections: List[str] = []

    # Question
    if question:
        sections.append("## Question\n" + _truncate(question) + "\n")

    # Rolling summary
    if 'rolling_summary' in md and md.get('rolling_summary'):
        sections.append("## Compressed History\n" + _truncate(md.get('rolling_summary')) + "\n")

    # Conversation context (merged card + summary)
    if 'conversation_context' in md and isinstance(md.get('conversation_context'), dict):
        cc_lines = _flatten_dict(md['conversation_context'])
        sections.append("## Conversation Context\n" + '\n'.join(cc_lines) + "\n")

    # Incident context card generically
    card = md.get('incident_context_card') or md.get('card')
    if isinstance(card, dict):
        card_lines = _flatten_dict(card)
        sections.append("## Context Card\n" + '\n'.join(card_lines) + "\n")

    # Tool outputs
    for name, val in outputs.items():
        try:
            # Special handling for structured work notes summarization
            if name in ('summarize_incident_work_notes', 'summarize_work_notes') and isinstance(val, dict):
                if val.get('summary_method') == 'structured_resolution':
                    # Format structured resolution output for DevCopilot guidance
                    structured_lines = []
                    incident_num = val.get('incident_number', 'Unknown')
                    structured_lines.append(f"**Incident:** {incident_num}")
                    structured_lines.append("")
                    
                    if 'problem_statement' in val and val['problem_statement'] != 'Not documented':
                        structured_lines.append("### 🔍 Problem Statement")
                        structured_lines.append(val['problem_statement'])
                        structured_lines.append("")
                    
                    if 'root_cause' in val and val['root_cause'] not in ('Not documented', 'Not yet identified'):
                        structured_lines.append("### 🎯 Root Cause")
                        structured_lines.append(val['root_cause'])
                        structured_lines.append("")
                    
                    if 'workaround' in val and val['workaround'] not in ('None documented', 'Not documented'):
                        structured_lines.append("### ⚡ Workaround (Temporary Fix)")
                        structured_lines.append(val['workaround'])
                        structured_lines.append("")
                    
                    if 'resolution_steps' in val and val['resolution_steps'] != 'No resolution steps recorded':
                        structured_lines.append("### ✅ Resolution Steps (Permanent Fix)")
                        structured_lines.append(val['resolution_steps'])
                        structured_lines.append("")
                    
                    if val.get('original_length', 0) > 0:
                        structured_lines.append(f"_Extracted from {val['original_length']} characters of work notes_")
                    
                    sections.append("## Resolution Guidance\n" + '\n'.join(structured_lines) + "\n")
                    continue
            
            # Standard output formatting
            if isinstance(val, dict):
                lines = _flatten_dict(val)
            elif isinstance(val, list) and val and all(isinstance(x, dict) for x in val):
                lines = _format_list_of_dicts(val)
            elif isinstance(val, list):
                lines = [f"- {_truncate(x)}" for x in val[:MAX_LINES_PER_SECTION]]
            else:
                lines = [ _truncate(val) ]
            header = f"## Tool: {name}" if len(name) < 60 else "## Tool Output"
            sections.append(header + "\n" + '\n'.join(lines) + "\n")
        except Exception:
            continue

    # Final answer
    if final_answer:
        sections.append("## Answer\n" + final_answer + "\n")

    return '\n'.join(sections)

__all__ = [ 'format_answer' ]