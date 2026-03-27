"""
Wiki Clarification Engine - Enhances Wiki RAG with interactive clarification workflow.

This module adds intelligence to Wiki RAG by:
1. Analyzing incoming wiki requests for specificity and context
2. Generating clarifying questions when needed to refine search scope
3. Tracking multi-turn clarification state in conversation
4. Performing targeted Wiki RAG with combined original + clarification context
5. Correlating Wiki findings back to the original question

Author: DevPilot AI Enhancement
Date: January 20, 2026
"""

import logging
import os
import re
import json
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime

# Use agentic orchestrator logger for consistency
logger = logging.getLogger("agentic_orchestrator_auto").getChild("wiki_clarification")
logger.setLevel(logging.INFO)

# Topic and keyword extraction patterns for wiki context analysis
WIKI_TOPICS = {
    "configuration": ["config", "setup", "configuration", "settings", "parameters", "environment"],
    "troubleshooting": ["error", "issue", "problem", "debug", "fix", "troubleshoot", "resolve", "broken", "failing"],
    "procedures": ["procedure", "process", "workflow", "steps", "how to", "guide", "tutorial"],
    "definitions": ["what is", "definition", "explain", "describe", "meaning", "purpose"],
    "architecture": ["architecture", "design", "structure", "components", "modules", "integration"],
    "requirements": ["requirement", "spec", "specification", "needs", "criteria", "aps", "dhd"],
    "best_practices": ["best practice", "recommendation", "guideline", "standard", "convention"],
    "api_reference": ["api", "endpoint", "method", "function", "interface", "reference"]
}

# ServiceNow/incident-specific keywords that might need wiki documentation
SERVICENOW_KEYWORDS = {
    "aps": "Application Performance Suite",
    "dhd": "Data Hub Deployment",
    "mrio": "Manual Registry Input/Output",
    "assignment_group": "Assignment Group Configuration",
    "work_notes": "Work Notes Documentation",
    "priority": "Priority Classification",
    "sla": "Service Level Agreement",
    "cmdb": "Configuration Management Database"
}


class WikiClarificationEngine:
    """Manages interactive clarification workflow for Wiki RAG requests."""
    
    def __init__(self):
        self.state_storage = {}  # In-memory state tracking (could be TinyDB in production)
    
    def analyze_wiki_request_clarity(
        self, 
        question: str, 
        context_messages: List[Dict[str, Any]],
        has_wiki_annotation: bool = True
    ) -> Dict[str, Any]:
        """
        Analyze if a wiki request needs clarification based on specificity.
        
        Args:
            question: The user's wiki question/request
            context_messages: Recent conversation history
            has_wiki_annotation: Whether @wiki annotation was explicitly used
        
        Returns:
            {
                "needs_clarification": bool,
                "clarity_score": float (0.0-1.0),
                "detected_topics": List[str],
                "detected_keywords": List[str],
                "context_entities": Dict[str, Any],  # Incidents, user references, etc.
                "reason": str  # Why clarification is/isn't needed
            }
        """
        logger.info(f"[WIKI_CLARIFY] Analyzing request clarity | question='{question[:100]}'")
        
        q_lower = question.lower()
        clarity_score = 0.0
        detected_topics = []
        detected_keywords = []
        context_entities = self._extract_context_entities(context_messages)
        
        # Clarity indicators (higher score = more specific)
        
        # 1. Specific topic detection (0.3 points)
        for topic, patterns in WIKI_TOPICS.items():
            if any(pattern in q_lower for pattern in patterns):
                detected_topics.append(topic)
                clarity_score += 0.3
                break  # Only count first topic match
        
        # 2. Domain-specific keywords (0.2 points)
        for keyword, full_name in SERVICENOW_KEYWORDS.items():
            if keyword in q_lower:
                detected_keywords.append(keyword)
                clarity_score += 0.05  # Up to 0.2 for 4 keywords
        
        # 3. Question specificity (0.3 points)
        specific_indicators = [
            r'\b(how to|step by step|procedure for|guide for)\b',  # Process questions
            r'\b(configure|setup|install|enable|disable)\b',       # Action verbs
            r'\b(INC\d+|incident \w+|ticket \w+)\b',              # Specific references
            r'\b(error code|error message|exception)\b',           # Error specificity
            r'\b(version \d+|release \d+)\b'                       # Version specificity
        ]
        specific_matches = sum(1 for pattern in specific_indicators if re.search(pattern, q_lower))
        clarity_score += min(0.3, specific_matches * 0.1)
        
        # 4. Interrogative questions (0.15 points) - what, when, how, why indicate specific inquiry
        interrogative_patterns = [
            r'\b(what|when|where|how|why|which)\b.*\?',  # Question with interrogative word
            r'\b(what|when|where|how|why|which)\s+\w+',  # Interrogative + word (implied question)
        ]
        if any(re.search(pattern, q_lower) for pattern in interrogative_patterns):
            clarity_score += 0.15
        
        # 5. Context correlation (0.2 points) - references to prior conversation
        if context_entities.get('incidents') or context_entities.get('topics'):
            # User is asking about something in context
            clarity_score += 0.2
        
        # 6. Multiple words/terms (0.15 points) - longer questions are usually more specific
        # Remove @wiki annotation before counting
        clean_question = re.sub(r'@\w+', '', question).strip()
        word_count = len([w for w in clean_question.split() if len(w) > 3])  # Words > 3 chars
        if word_count >= 5:  # At least 5 meaningful words
            clarity_score += 0.15
        
        # Cap at 1.0
        clarity_score = min(1.0, clarity_score)
        
        # Decision threshold: 
        # - If @wiki annotation present: clarity_score < 0.3 means needs clarification (more lenient)
        # - Otherwise: clarity_score < 0.5 (stricter)
        # Rationale: explicit @wiki shows user intent to search wiki, respect that
        threshold = 0.3 if has_wiki_annotation else 0.5
        needs_clarification = clarity_score < threshold
        
        reason = self._generate_clarity_reason(
            needs_clarification, 
            clarity_score, 
            detected_topics, 
            detected_keywords, 
            context_entities
        )
        
        result = {
            "needs_clarification": needs_clarification,
            "clarity_score": clarity_score,
            "detected_topics": detected_topics,
            "detected_keywords": detected_keywords,
            "context_entities": context_entities,
            "reason": reason
        }
        
        logger.info(
            f"[WIKI_CLARIFY] Analysis complete | "
            f"needs_clarification={needs_clarification} clarity_score={clarity_score:.2f} "
            f"topics={detected_topics} keywords={detected_keywords}"
        )
        
        return result
    
    def _extract_context_entities(self, context_messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Extract incidents, topics, and key entities from conversation history."""
        entities = {
            "incidents": [],
            "topics": [],
            "mentioned_terms": []
        }
        
        if not context_messages:
            return entities
        
        # Analyze last 5 messages for context
        recent_messages = context_messages[-5:] if len(context_messages) > 5 else context_messages
        
        for msg in recent_messages:
            content = msg.get('content', '') or msg.get('answer', '') or msg.get('text', '')
            
            # Extract incident numbers
            incidents = re.findall(r'\b(INC\d+)\b', content, re.IGNORECASE)
            entities['incidents'].extend(incidents)
            
            # Extract ServiceNow-specific terms
            for keyword in SERVICENOW_KEYWORDS.keys():
                if keyword.lower() in content.lower():
                    entities['mentioned_terms'].append(keyword)
            
            # Extract topic keywords
            content_lower = content.lower()
            for topic, patterns in WIKI_TOPICS.items():
                if any(pattern in content_lower for pattern in patterns):
                    entities['topics'].append(topic)
        
        # Deduplicate
        entities['incidents'] = list(set(entities['incidents']))
        entities['topics'] = list(set(entities['topics']))
        entities['mentioned_terms'] = list(set(entities['mentioned_terms']))
        
        return entities
    
    def _generate_clarity_reason(
        self, 
        needs_clarification: bool, 
        score: float, 
        topics: List[str], 
        keywords: List[str], 
        context: Dict[str, Any]
    ) -> str:
        """Generate human-readable explanation for clarity decision."""
        if needs_clarification:
            reasons = []
            if score < 0.2:
                reasons.append("very generic request")
            elif score < 0.4:
                reasons.append("lacks specific focus area")
            
            if not topics:
                reasons.append("no clear topic identified")
            if not keywords and not context['incidents']:
                reasons.append("no domain-specific context")
            
            return f"Clarification needed: {', '.join(reasons)} (score={score:.2f})"
        else:
            reasons = []
            if topics:
                reasons.append(f"topics: {', '.join(topics)}")
            if keywords:
                reasons.append(f"keywords: {', '.join(keywords)}")
            if context['incidents']:
                reasons.append(f"incident context: {', '.join(context['incidents'][:2])}")
            
            return f"Sufficiently specific: {', '.join(reasons)} (score={score:.2f})"
    
    def generate_clarification_questions(
        self, 
        question: str, 
        analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate contextual clarification questions to refine wiki search.
        
        Args:
            question: Original user question
            analysis: Output from analyze_wiki_request_clarity()
        
        Returns:
            {
                "clarification_text": str,  # Question to show user
                "suggested_options": List[Dict],  # Structured options
                "followup_prompt": str,  # How user should respond
                "state_id": str  # For tracking this clarification session
            }
        """
        logger.info(f"[WIKI_CLARIFY] Generating clarification questions | question='{question[:100]}'")
        
        context_entities = analysis['context_entities']
        detected_topics = analysis['detected_topics']
        detected_keywords = analysis['detected_keywords']
        
        # Build context-aware clarification
        clarification_parts = []
        options = []
        
        # Start with acknowledgment of context
        if context_entities['incidents']:
            incidents_str = ', '.join(context_entities['incidents'][:3])
            clarification_parts.append(
                f"I can search the Wiki for documentation related to {incidents_str}."
            )
        else:
            clarification_parts.append(
                "I can search the Wiki for relevant documentation."
            )
        
        # Ask for specific focus if unclear
        if not detected_topics:
            clarification_parts.append(
                "\n\n**What aspect would you like me to focus on?**"
            )
            options = [
                {"id": "configuration", "label": "Configuration & Setup Procedures"},
                {"id": "troubleshooting", "label": "Troubleshooting & Error Resolution"},
                {"id": "architecture", "label": "Architecture & Design Documentation"},
                {"id": "requirements", "label": "Requirements & Specifications"},
                {"id": "best_practices", "label": "Best Practices & Guidelines"},
                {"id": "other", "label": "Other (please specify)"}
            ]
        else:
            # Topic detected but might need keyword refinement
            clarification_parts.append(
                f"\n\nI detected you're interested in **{detected_topics[0]}** documentation."
            )
            
            # If we have context entities, ask for specific search terms
            if context_entities['mentioned_terms']:
                terms_str = ', '.join(context_entities['mentioned_terms'][:3])
                clarification_parts.append(
                    f"\n\n**Should I focus on specific terms like: {terms_str}?** "
                    "Or would you like me to search more broadly?"
                )
                options = [
                    {"id": "specific_terms", "label": f"Yes, focus on {terms_str}"},
                    {"id": "broader_search", "label": "Search more broadly"},
                    {"id": "custom_terms", "label": "Use different terms (please specify)"}
                ]
            else:
                clarification_parts.append(
                    "\n\n**What specific keywords or concepts should I search for?**"
                )
                # Suggest keywords based on context
                if context_entities['incidents']:
                    clarification_parts.append(
                        "\n\n*Suggestions based on context:*"
                    )
                    suggestions = self._suggest_keywords_from_context(context_entities)
                    for i, suggestion in enumerate(suggestions[:5], 1):
                        options.append({
                            "id": f"suggestion_{i}",
                            "label": suggestion,
                            "keywords": [suggestion.lower()]
                        })
        
        # Create followup prompt
        followup_prompt = (
            "\n\n*Please respond with:*\n"
            "- A number from the options above, or\n"
            "- Your own specific search terms/keywords, or\n"
            "- Additional context about what you're looking for"
        )
        
        # Generate unique state ID for tracking
        state_id = f"wiki_clarify_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        
        # Store state for continuation
        self.state_storage[state_id] = {
            "original_question": question,
            "analysis": analysis,
            "timestamp": datetime.now().isoformat(),
            "options": options
        }
        
        result = {
            "clarification_text": ''.join(clarification_parts),
            "suggested_options": options,
            "followup_prompt": followup_prompt,
            "state_id": state_id
        }
        
        logger.info(
            f"[WIKI_CLARIFY] Generated {len(options)} clarification options | "
            f"state_id={state_id}"
        )
        
        return result
    
    def _suggest_keywords_from_context(self, context_entities: Dict[str, Any]) -> List[str]:
        """Generate keyword suggestions based on conversation context."""
        suggestions = []
        
        # Add ServiceNow terms if mentioned
        for term in context_entities['mentioned_terms']:
            if term in SERVICENOW_KEYWORDS:
                suggestions.append(f"{SERVICENOW_KEYWORDS[term]} ({term.upper()})")
        
        # Add topic-based suggestions
        for topic in context_entities['topics']:
            if topic == 'troubleshooting':
                suggestions.append("Error Resolution Steps")
            elif topic == 'configuration':
                suggestions.append("Configuration Guide")
            elif topic == 'requirements':
                suggestions.append("System Requirements")
        
        # Add incident-specific suggestions if present
        if context_entities['incidents']:
            suggestions.append("Incident Resolution Procedures")
            suggestions.append("Related Documentation")
        
        return suggestions[:5]  # Limit to 5 suggestions
    
    def process_clarification_response(
        self, 
        state_id: str, 
        user_response: str
    ) -> Dict[str, Any]:
        """
        Process user's response to clarification and prepare refined Wiki RAG query.
        
        Args:
            state_id: The clarification session ID
            user_response: User's clarification response
        
        Returns:
            {
                "refined_question": str,  # Combined original + clarification
                "search_keywords": List[str],  # Extracted keywords
                "search_filters": Dict[str, Any],  # Optional filters (topic, etc.)
                "correlation_context": str  # Context for answering original question
            }
        """
        logger.info(
            f"[WIKI_CLARIFY] Processing clarification response | "
            f"state_id={state_id} response='{user_response[:100]}'"
        )
        
        if state_id not in self.state_storage:
            logger.warning(f"[WIKI_CLARIFY] Unknown state_id: {state_id}")
            return {
                "refined_question": user_response,
                "search_keywords": [],
                "search_filters": {},
                "correlation_context": "User provided clarification but context was lost."
            }
        
        state = self.state_storage[state_id]
        original_question = state['original_question']
        analysis = state['analysis']
        options = state['options']
        
        # Extract search refinements from user response
        search_keywords = []
        search_filters = {}
        
        # Check if user selected an option number
        option_match = re.match(r'^(\d+)', user_response.strip())
        if option_match and options:
            option_idx = int(option_match.group(1)) - 1
            if 0 <= option_idx < len(options):
                selected = options[option_idx]
                search_filters['topic'] = selected.get('id')
                search_keywords.extend(selected.get('keywords', [selected['label']]))
                logger.info(f"[WIKI_CLARIFY] User selected option {option_idx + 1}: {selected['label']}")
        
        # Extract keywords from freeform response
        response_lower = user_response.lower()
        for keyword in SERVICENOW_KEYWORDS.keys():
            if keyword in response_lower:
                search_keywords.append(keyword)
        
        # Extract quoted terms as high-priority keywords
        quoted_terms = re.findall(r'"([^"]+)"', user_response)
        search_keywords.extend(quoted_terms)
        
        # Build refined question combining original + clarification
        if search_keywords:
            keywords_str = ', '.join(search_keywords)
            refined_question = (
                f"{original_question} "
                f"[Focus: {keywords_str}] "
                f"[User clarification: {user_response}]"
            )
        else:
            refined_question = f"{original_question} [User clarification: {user_response}]"
        
        # Build correlation context for final answer
        correlation_context = (
            f"Original question: {original_question}\n"
            f"User clarification: {user_response}\n"
            f"Context entities: {analysis['context_entities']}\n"
            f"Search focus: {search_keywords or 'general'}"
        )
        
        result = {
            "refined_question": refined_question,
            "search_keywords": list(set(search_keywords)),  # Deduplicate
            "search_filters": search_filters,
            "correlation_context": correlation_context
        }
        
        logger.info(
            f"[WIKI_CLARIFY] Refined query prepared | "
            f"keywords={result['search_keywords']} filters={search_filters}"
        )
        
        # Clean up state after processing
        del self.state_storage[state_id]
        
        return result


# Global singleton instance
_wiki_clarification_engine = None

def get_wiki_clarification_engine() -> WikiClarificationEngine:
    """Get or create the global wiki clarification engine instance."""
    global _wiki_clarification_engine
    if _wiki_clarification_engine is None:
        _wiki_clarification_engine = WikiClarificationEngine()
    return _wiki_clarification_engine


# Convenience functions for use in orchestrator

def should_clarify_wiki_request(question: str, context_messages: List[Dict], has_wiki_annotation: bool = True) -> bool:
    """Quick check if wiki request needs clarification."""
    engine = get_wiki_clarification_engine()
    analysis = engine.analyze_wiki_request_clarity(question, context_messages, has_wiki_annotation)
    return analysis['needs_clarification']


def generate_wiki_clarification(question: str, context_messages: List[Dict], has_wiki_annotation: bool = True) -> Dict[str, Any]:
    """Generate clarification questions for a wiki request."""
    engine = get_wiki_clarification_engine()
    analysis = engine.analyze_wiki_request_clarity(question, context_messages, has_wiki_annotation)
    
    if analysis['needs_clarification']:
        return engine.generate_clarification_questions(question, analysis)
    else:
        # No clarification needed, return direct execution signal
        return {
            "clarification_text": None,
            "needs_clarification": False,
            "analysis": analysis
        }
