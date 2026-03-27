"""User Session Context Manager

Maintains persistent context across user sessions using TinyDB.

This module:
1. Extracts meaningful context from each Q&A turn (incidents, entities, topics, analysis)
2. Stores context in TinyDB keyed by username
3. Loads context when user logs back in
4. Enables conversation continuity across sessions

Context Structure:
- last_discussed_incidents: List of incident numbers from recent turns
- active_topics: Topics/intents from recent queries (e.g., "backlog_grooming", "pattern_analysis")
- tool_usage_history: Recent tools executed (helps predict user patterns)
- session_entities: Entities extracted from conversation (assignment groups, CIs, etc.)
- last_analysis_summary: Summary of most recent bulk analysis for context continuity
- session_start: Timestamp when current session started
- last_activity: Timestamp of last Q&A turn

Token Efficiency:
- Stores only lightweight references (incident numbers, entity names, not full data)
- Limits context to recent history (last 20 incidents, last 10 turns)
- Compresses data for minimal token impact (<200 tokens per user)
"""

import logging
import os
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from tinydb import TinyDB, Query

logger = logging.getLogger("agentic_orchestrator_auto.user_context")

# Feature flag
ENABLED = os.getenv("ENABLE_USER_CONTEXT_PERSISTENCE", "1").lower() in ("1", "true", "yes", "on")

# Context retention limits
MAX_INCIDENTS_RETAINED = 20
MAX_TOPICS_RETAINED = 10
MAX_TOOLS_RETAINED = 15
CONTEXT_TTL_DAYS = 7  # Context expires after 7 days of inactivity


class UserContextManager:
    """Manages persistent user session context in TinyDB"""
    
    def __init__(self, db_path: str = "state_db.json"):
        """Initialize context manager with TinyDB connection
        
        Args:
            db_path: Path to TinyDB database file (ignored, uses singleton)
        """
        from .db_singleton import get_state_db
        self.db = get_state_db()  # Use singleton instance for performance
        self.context_table = self.db.table("user_session_context")
        logger.info(f"[UserContext] Initialized (enabled={ENABLED}, using singleton)")
    
    def save_context_from_turn(
        self,
        username: str,
        question: str,
        tool_outputs: Dict[str, Any],
        metadata: Dict[str, Any],
        final_answer: Optional[str] = None
    ) -> None:
        """Save context extracted from a Q&A turn
        
        Args:
            username: User identifier
            question: User's question
            tool_outputs: Dict of tool outputs from orchestrator
            metadata: Request metadata (intent, persona, etc.)
            final_answer: Synthesized answer (optional)
        """
        if not ENABLED or not username:
            return
        
        try:
            # Extract meaningful context from this turn
            incidents = self._extract_incidents_from_outputs(tool_outputs)
            topics = self._extract_topics(question, metadata)
            tools_used = list(tool_outputs.keys()) if tool_outputs else []
            entities = self._extract_entities(metadata, tool_outputs)
            analysis_summary = self._extract_analysis_summary(tool_outputs, metadata)
            
            # Get existing context or create new
            User = Query()
            existing = self.context_table.search(User.username == username)
            
            if existing:
                context = existing[0]
                # Merge new data with existing
                context = self._merge_context(
                    context,
                    incidents=incidents,
                    topics=topics,
                    tools=tools_used,
                    entities=entities,
                    analysis_summary=analysis_summary
                )
            else:
                # Create new context
                context = {
                    "username": username,
                    "last_discussed_incidents": incidents[:MAX_INCIDENTS_RETAINED],
                    "active_topics": topics[:MAX_TOPICS_RETAINED],
                    "tool_usage_history": tools_used[:MAX_TOOLS_RETAINED],
                    "session_entities": entities,
                    "last_analysis_summary": analysis_summary,
                    "session_start": datetime.now().isoformat(),
                    "last_activity": datetime.now().isoformat(),
                    "turn_count": 1
                }
            
            # Update last activity and turn count
            context["last_activity"] = datetime.now().isoformat()
            context["turn_count"] = context.get("turn_count", 0) + 1
            
            # Save to TinyDB
            if existing:
                self.context_table.update(context, User.username == username)
                logger.info(f"[UserContext] Updated context for {username} | "
                          f"incidents={len(context.get('last_discussed_incidents', []))} "
                          f"topics={len(context.get('active_topics', []))} "
                          f"turns={context.get('turn_count')}")
            else:
                self.context_table.insert(context)
                logger.info(f"[UserContext] Created new context for {username}")
        
        except Exception as e:
            logger.warning(f"[UserContext] Failed to save context for {username}: {e}", exc_info=True)
    
    def load_context(self, username: str) -> Optional[Dict[str, Any]]:
        """Load persistent context for user
        
        Args:
            username: User identifier
            
        Returns:
            Context dict or None if no context exists or expired
        """
        if not ENABLED or not username:
            return None
        
        try:
            User = Query()
            results = self.context_table.search(User.username == username)
            
            if not results:
                logger.info(f"[UserContext] No existing context for {username}")
                return None
            
            context = results[0]
            
            # Check if context is expired
            last_activity = datetime.fromisoformat(context.get("last_activity", "2000-01-01"))
            age_days = (datetime.now() - last_activity).days
            
            if age_days > CONTEXT_TTL_DAYS:
                logger.info(f"[UserContext] Context for {username} expired ({age_days} days old)")
                self.clear_context(username)
                return None
            
            logger.info(f"[UserContext] Loaded context for {username} | "
                       f"incidents={len(context.get('last_discussed_incidents', []))} "
                       f"topics={len(context.get('active_topics', []))} "
                       f"age={age_days}d")
            
            return context
        
        except Exception as e:
            logger.warning(f"[UserContext] Failed to load context for {username}: {e}", exc_info=True)
            return None
    
    def clear_context(self, username: str) -> None:
        """Clear context for user (e.g., on logout or expiry)
        
        Args:
            username: User identifier
        """
        if not ENABLED or not username:
            return
        
        try:
            User = Query()
            removed = self.context_table.remove(User.username == username)
            logger.info(f"[UserContext] Cleared context for {username} ({removed} records removed)")
        except Exception as e:
            logger.warning(f"[UserContext] Failed to clear context for {username}: {e}")
    
    def format_context_for_injection(self, context: Dict[str, Any]) -> str:
        """Format context as a compact string for LLM injection
        
        Args:
            context: User context dict
            
        Returns:
            Formatted context string (token-efficient)
        """
        parts = []
        
        # Recent incidents
        incidents = context.get("last_discussed_incidents", [])
        if incidents:
            parts.append(f"Recent incidents: {', '.join(incidents[:10])}")
        
        # Active topics
        topics = context.get("active_topics", [])
        if topics:
            parts.append(f"Recent topics: {', '.join(topics[:5])}")
        
        # Entities (assignment groups, CIs, etc.)
        entities = context.get("session_entities", {})
        if entities:
            entity_summary = []
            if entities.get("assignment_groups"):
                entity_summary.append(f"Assignment groups: {', '.join(entities['assignment_groups'][:3])}")
            if entities.get("configuration_items"):
                entity_summary.append(f"CIs: {', '.join(entities['configuration_items'][:3])}")
            if entity_summary:
                parts.append(" | ".join(entity_summary))
        
        # Last analysis summary
        if context.get("last_analysis_summary"):
            summary = context["last_analysis_summary"]
            if isinstance(summary, dict):
                parts.append(f"Last analysis: {summary.get('type', 'unknown')} on {summary.get('incident_count', 0)} incidents")
        
        # Session stats
        turn_count = context.get("turn_count", 0)
        last_activity = context.get("last_activity", "")
        if last_activity:
            try:
                last_dt = datetime.fromisoformat(last_activity)
                minutes_ago = int((datetime.now() - last_dt).total_seconds() / 60)
                if minutes_ago < 60:
                    time_str = f"{minutes_ago}m ago"
                elif minutes_ago < 1440:
                    time_str = f"{minutes_ago // 60}h ago"
                else:
                    time_str = f"{minutes_ago // 1440}d ago"
                parts.append(f"Session: {turn_count} turns, last active {time_str}")
            except:
                pass
        
        return " | ".join(parts) if parts else "No prior context"
    
    # ─────────────────────────────────────────────────────────────────────────
    # PRIVATE HELPER METHODS
    # ─────────────────────────────────────────────────────────────────────────
    
    def _extract_incidents_from_outputs(self, tool_outputs: Dict[str, Any]) -> List[str]:
        """Extract incident numbers from tool outputs"""
        incidents = []
        
        for tool_name, output in tool_outputs.items():
            if isinstance(output, dict):
                # Direct incident fetch
                if "number" in output and isinstance(output["number"], str):
                    incidents.append(output["number"])
                
                # Bulk results
                if "incidents" in output and isinstance(output["incidents"], list):
                    for item in output["incidents"]:
                        if isinstance(item, dict) and "number" in item:
                            incidents.append(item["number"])
                
                # Backlog overview
                if "sample" in output and isinstance(output["sample"], list):
                    for item in output["sample"]:
                        if isinstance(item, dict) and "number" in item:
                            incidents.append(item["number"])
                
                # Similar incidents
                if "results" in output and isinstance(output["results"], list):
                    for item in output["results"]:
                        if isinstance(item, dict) and "number" in item:
                            incidents.append(item["number"])
                
                # Drill-down data from bulk analysis
                if "sample_incidents" in output and isinstance(output["sample_incidents"], list):
                    incidents.extend([i for i in output["sample_incidents"] if isinstance(i, str)])
            
            elif isinstance(output, list):
                # Handle chunked outputs
                for chunk in output:
                    if isinstance(chunk, dict) and "number" in chunk:
                        incidents.append(chunk["number"])
        
        # Deduplicate while preserving order
        seen = set()
        unique_incidents = []
        for inc in incidents:
            if inc not in seen:
                seen.add(inc)
                unique_incidents.append(inc)
        
        return unique_incidents[:MAX_INCIDENTS_RETAINED]
    
    def _extract_topics(self, question: str, metadata: Dict[str, Any]) -> List[str]:
        """Extract topics/intents from question and metadata"""
        topics = []
        
        # Intent from metadata
        intent = metadata.get("intent")
        if intent:
            topics.append(intent)
        
        # Annotation from metadata
        annotation = metadata.get("annotation")
        if annotation:
            topics.append(annotation.replace("@", ""))
        
        # Keyword-based topic detection
        q_lower = question.lower()
        topic_keywords = {
            "backlog": ["backlog", "aging", "pending", "queue"],
            "pattern_analysis": ["pattern", "common", "trend", "similar issues"],
            "workaround": ["workaround", "temporary fix", "mitigation"],
            "root_cause": ["root cause", "why", "reason for"],
            "assignment": ["assign", "route", "team", "group"],
            "escalation": ["escalate", "priority", "urgent", "critical"]
        }
        
        for topic, keywords in topic_keywords.items():
            if any(keyword in q_lower for keyword in keywords):
                if topic not in topics:
                    topics.append(topic)
        
        return topics[:MAX_TOPICS_RETAINED]
    
    def _extract_entities(self, metadata: Dict[str, Any], tool_outputs: Dict[str, Any]) -> Dict[str, List[str]]:
        """Extract entities (assignment groups, CIs, users, etc.)"""
        entities: Dict[str, List[str]] = {
            "assignment_groups": [],
            "configuration_items": [],
            "users": []
        }
        
        # From metadata
        if "entities" in metadata and isinstance(metadata["entities"], dict):
            meta_entities = metadata["entities"]
            if "assignment_groups" in meta_entities:
                entities["assignment_groups"].extend(meta_entities["assignment_groups"])
        
        # From tool outputs
        for output in tool_outputs.values():
            if isinstance(output, dict):
                # Assignment group
                if "assignment_group" in output:
                    ag = output["assignment_group"]
                    if isinstance(ag, str) and ag not in entities["assignment_groups"]:
                        entities["assignment_groups"].append(ag)
                
                # Configuration item
                if "cmdb_ci" in output or "configuration_item" in output:
                    ci = output.get("cmdb_ci") or output.get("configuration_item")
                    if isinstance(ci, str) and ci not in entities["configuration_items"]:
                        entities["configuration_items"].append(ci)
        
        # Limit sizes
        for key in entities:
            entities[key] = entities[key][:10]
        
        return entities
    
    def _extract_analysis_summary(self, tool_outputs: Dict[str, Any], metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract summary from bulk analysis tools"""
        # Check for bulk analysis
        if "analyze_bulk_work_notes" in tool_outputs:
            output = tool_outputs["analyze_bulk_work_notes"]
            if isinstance(output, dict):
                return {
                    "type": "bulk_work_notes",
                    "incident_count": output.get("total_incidents", 0),
                    "categories": list(output.get("incidents_by_category", {}).keys())[:5],
                    "has_doc_gaps": len(output.get("incidents_with_doc_gaps", [])) > 0,
                    "timestamp": datetime.now().isoformat()
                }
        
        # Backlog overview
        if "fetch_backlog_overview" in tool_outputs:
            output = tool_outputs["fetch_backlog_overview"]
            if isinstance(output, dict):
                return {
                    "type": "backlog_overview",
                    "incident_count": output.get("total_count", 0),
                    "priority_distribution": output.get("by_priority", {}),
                    "timestamp": datetime.now().isoformat()
                }
        
        return None
    
    def _merge_context(
        self,
        existing: Dict[str, Any],
        incidents: List[str],
        topics: List[str],
        tools: List[str],
        entities: Dict[str, List[str]],
        analysis_summary: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Merge new context data with existing context"""
        # Merge incidents (deduplicate, recent first)
        all_incidents = incidents + existing.get("last_discussed_incidents", [])
        seen = set()
        merged_incidents = []
        for inc in all_incidents:
            if inc not in seen:
                seen.add(inc)
                merged_incidents.append(inc)
        existing["last_discussed_incidents"] = merged_incidents[:MAX_INCIDENTS_RETAINED]
        
        # Merge topics (deduplicate, recent first)
        all_topics = topics + existing.get("active_topics", [])
        seen_topics = set()
        merged_topics = []
        for topic in all_topics:
            if topic not in seen_topics:
                seen_topics.add(topic)
                merged_topics.append(topic)
        existing["active_topics"] = merged_topics[:MAX_TOPICS_RETAINED]
        
        # Merge tools (deduplicate, recent first)
        all_tools = tools + existing.get("tool_usage_history", [])
        seen_tools = set()
        merged_tools = []
        for tool in all_tools:
            if tool not in seen_tools:
                seen_tools.add(tool)
                merged_tools.append(tool)
        existing["tool_usage_history"] = merged_tools[:MAX_TOOLS_RETAINED]
        
        # Merge entities
        session_entities = existing.get("session_entities", {})
        for entity_type, entity_list in entities.items():
            if entity_type not in session_entities:
                session_entities[entity_type] = []
            session_entities[entity_type] = list(set(session_entities[entity_type] + entity_list))[:10]
        existing["session_entities"] = session_entities
        
        # Update analysis summary if new one provided
        if analysis_summary:
            existing["last_analysis_summary"] = analysis_summary
        
        return existing


# Global singleton instance
_global_manager: Optional[UserContextManager] = None


def get_user_context_manager() -> UserContextManager:
    """Get or create global user context manager instance"""
    global _global_manager
    if _global_manager is None:
        _global_manager = UserContextManager()
    return _global_manager


def save_turn_context(
    username: str,
    question: str,
    tool_outputs: Dict[str, Any],
    metadata: Dict[str, Any],
    final_answer: Optional[str] = None
) -> None:
    """Convenience function to save turn context
    
    Args:
        username: User identifier
        question: User's question
        tool_outputs: Tool outputs from orchestrator
        metadata: Request metadata
        final_answer: Synthesized answer (optional)
    """
    if ENABLED:
        manager = get_user_context_manager()
        manager.save_context_from_turn(username, question, tool_outputs, metadata, final_answer)


def load_user_context(username: str) -> Optional[Dict[str, Any]]:
    """Convenience function to load user context
    
    Args:
        username: User identifier
        
    Returns:
        Context dict or None
    """
    if not ENABLED:
        return None
    
    manager = get_user_context_manager()
    return manager.load_context(username)


def clear_user_context(username: str) -> None:
    """Convenience function to clear user context
    
    Args:
        username: User identifier
    """
    if ENABLED:
        manager = get_user_context_manager()
        manager.clear_context(username)


def format_context_for_llm(context: Optional[Dict[str, Any]]) -> str:
    """Convenience function to format context for LLM injection
    
    Args:
        context: User context dict
        
    Returns:
        Formatted context string
    """
    if not context:
        return "No prior session context"
    
    manager = get_user_context_manager()
    return manager.format_context_for_injection(context)


def get_recent_chat_messages(username: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Retrieve recent chat messages for user from TinyDB chat_history table
    
    Args:
        username: User identifier
        limit: Maximum number of messages to return (default: 20)
        
    Returns:
        List of chat messages in chronological order
        
    Format:
        [
            {"sender": "user", "text": "Question...", "timestamp": "..."},
            {"sender": "server", "text": "Response...", "timestamp": "..."},
            ...
        ]
    """
    if not username:
        return []
    
    try:
        from tinydb import TinyDB, Query
        from .db_singleton import get_state_db
        db = get_state_db()
        chat_table = db.table("chat_history")
        
        User = Query()
        # Tolerant matching (same logic as generic_tool_orchestrator.py)
        try:
            cond_top_exact = (User.username == username)
            cond_top_ci = User.username.test(lambda s: isinstance(s, str) and s.lower() == username.lower())
            cond_text_nested = User.text.test(lambda t: isinstance(t, dict) and (
                t.get('username') == username or 
                (isinstance(t.get('username'), str) and t.get('username').lower() == username.lower())
            ))
            combined = cond_top_exact | cond_top_ci | cond_text_nested
            messages = chat_table.search(combined)
        except Exception:
            # Fallback to simple equality
            messages = chat_table.search(User.username == username)
        
        # Convert to dicts for type safety
        messages_as_dicts = [dict(msg) for msg in messages]
        
        # Sort by timestamp (oldest first)
        messages_sorted = sorted(messages_as_dicts, key=lambda x: x.get("timestamp", 0))
        
        # Return most recent N messages
        recent = messages_sorted[-limit:] if len(messages_sorted) > limit else messages_sorted
        
        logger.info(f"[UserContext] Retrieved {len(recent)} recent chat messages for {username}")
        return recent
    
    except Exception as e:
        logger.warning(f"[UserContext] Failed to retrieve chat messages for {username}: {e}")
        return []


__all__ = [
    "UserContextManager",
    "get_user_context_manager",
    "save_turn_context",
    "load_user_context",
    "clear_user_context",
    "format_context_for_llm",
    "get_recent_chat_messages",
    "ENABLED"
]
