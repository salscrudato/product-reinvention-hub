"""rolling_summary

Provides RollingConversationSummarizer to compress prior conversation turns into a short summary,
reducing prompt token usage. Controlled by ENABLE_CONTEXT_SUMMARY flag.

Design goals:
- Deterministic length cap via configurable max_chars (default 1200)
- Field-aware: preserve any explicit incident numbers and action verbs
- Incremental update: previous summary + new user/assistant turn compressed
- Token savings estimation returned with each update

Public API:
class RollingConversationSummarizer:
    update(history: list[dict]) -> dict
        history items are {'role': 'user'|'assistant', 'content': str}
        returns { 'summary': str, 'token_savings_estimate': int, 'dropped_turns': int }

If summary exceeds max_chars, apply secondary compression (drop oldest sentences first).

This module avoids external LLM calls (lightweight heuristic summarizer) so it's safe offline.
"""
from __future__ import annotations
import re, time
from typing import List, Dict, Any

SENTENCE_SPLIT = re.compile(r'(?:\.|\?|!)(?:\s+)')
INC_PATTERN = re.compile(r"\bINC0*\d+\b", re.IGNORECASE)

class RollingConversationSummarizer:
    def __init__(self, max_chars: int = 1200):
        self.max_chars = max_chars
        self.last_summary: str = ''
        self.turn_count: int = 0

    def _extract_incidents(self, text: str) -> List[str]:
        return [m.upper() for m in INC_PATTERN.findall(text or '')]

    def _compress(self, text: str) -> str:
        # Remove excessive whitespace, collapse multiple spaces
        t = re.sub(r'\s+', ' ', text).strip()
        if len(t) <= self.max_chars:
            return t
        # Secondary compression: keep incident sentences + most recent sentences
        sentences = SENTENCE_SPLIT.split(t)
        if not sentences:
            return t[:self.max_chars]
        incident_sentences = [s for s in sentences if INC_PATTERN.search(s)]
        # Preserve earliest and latest incident context: take first 2 and last 3 incident sentences
        core_incident = []
        if incident_sentences:
            core_incident.extend(incident_sentences[:2])
            tail = incident_sentences[-3:]
            for t in tail:
                if t not in core_incident:
                    core_incident.append(t)
        # Guarantee earliest incident sentence always present at position 0
        earliest = incident_sentences[0] if incident_sentences else None
        if earliest and earliest not in core_incident:
            core_incident.insert(0, earliest)
        recent_sentences = sentences[-5:]  # last 5 as fallback context
        kept = []
        seen = set()
        for s in core_incident + recent_sentences:
            s_norm = s.strip()
            if s_norm and s_norm not in seen:
                kept.append(s_norm)
                seen.add(s_norm)
            joined = '. '.join(kept)
            if len(joined) >= self.max_chars - 50:  # stop near cap
                break
        return joined[:self.max_chars]

    def update(self, history: List[Dict[str, Any]]) -> Dict[str, Any]:
        # Filter only user/assistant roles
        linear = []
        for h in history:
            if not isinstance(h, dict):
                continue
            role = h.get('role')
            content = h.get('content')
            if role in ('user','assistant') and isinstance(content, str):
                linear.append((role, content))
        self.turn_count = len(linear)
        # Identify earliest incident-containing turns (up to 2)
        earliest_incident_parts = []
        for r, c in linear:
            if INC_PATTERN.search(c):
                tag = 'U' if r == 'user' else 'A'
                incidents = self._extract_incidents(c)
                earliest_incident_parts.append(f"{tag}:{c} [incidents={','.join(incidents)}]")
                if len(earliest_incident_parts) >= 2:
                    break
        # Build recent slice
        raw_parts = []
        for r, c in linear[-12:]:  # limit to last 12 turns for recent conversation
            incidents = self._extract_incidents(c)
            tag = 'U' if r == 'user' else 'A'
            if incidents:
                raw_parts.append(f"{tag}:{c} [incidents={','.join(incidents)}]")
            else:
                raw_parts.append(f"{tag}:{c}")
        # Prepend earliest incident parts (deduplicated)
        composite_parts = []
        seen = set()
        for p in earliest_incident_parts + raw_parts:
            if p not in seen:
                composite_parts.append(p)
                seen.add(p)
        raw_parts = composite_parts
        composite = ' \n'.join(raw_parts)
        new_summary_base = (self.last_summary + ' ' + composite).strip() if self.last_summary else composite
        summary = self._compress(new_summary_base)
        # Estimate token savings (rough heuristic: 4 chars per token, compare length vs raw concatenation)
        raw_len = len(new_summary_base)
        saved_chars = max(raw_len - len(summary), 0)
        token_savings_estimate = int(saved_chars / 4)
        dropped_turns = max(self.turn_count - 12, 0)
        self.last_summary = summary
        return {
            'summary': summary,
            'token_savings_estimate': token_savings_estimate,
            'dropped_turns': dropped_turns,
            'turns_included': min(self.turn_count, 12)
        }

__all__ = ['RollingConversationSummarizer']
