"""
General Clarification Engine - Universal context clarification framework for DevCopilot

This module provides a general-purpose clarification system that can be used across
ANY tool or intent when the planner needs additional context to generate an optimal plan.

Unlike wiki_clarification_engine.py (wiki-specific), this engine is tool-agnostic and
works with intent-based clarification templates.

Architecture:
1. Plan Feasibility Analyzer - Detects when planner needs more information
2. Intent-Specific Templates - Clarification patterns per intent type
3. Dynamic Question Generator - Creates contextual questions based on missing parameters
4. Multi-Turn State Manager - Tracks clarification sessions across intents
5. Response Processor - Enriches original request with gathered context

Author: DevCopilot Enhancement Framework
Date: January 20, 2026
"""

import logging
import os
import re
import json
from typing import Dict, List, Optional, Any, Tuple, Set
from datetime import datetime
from enum import Enum

logger = logging.getLogger("agentic_orchestrator_auto").getChild("general_clarification")
logger.setLevel(logging.INFO)


class ClarificationTrigger(Enum):
    """Reasons why clarification might be needed."""
    MISSING_REQUIRED_PARAM = "missing_required_parameter"
    AMBIGUOUS_ENTITY = "ambiguous_entity_reference"
    MULTIPLE_PATHS = "multiple_execution_paths"
    INSUFFICIENT_CONTEXT = "insufficient_context"
    CONFLICTING_INPUTS = "conflicting_inputs"
    NEED_CONFIRMATION = "need_user_confirmation"


class ClarificationType(Enum):
    """Types of clarification questions."""
    PARAMETER_VALUE = "parameter_value"  # Ask for specific parameter value
    ENTITY_SELECTION = "entity_selection"  # Choose from multiple entities
    EXECUTION_PATH = "execution_path"  # Choose approach/method
    CONFIRMATION = "confirmation"  # Yes/No confirmation
    CONTEXT_ENRICHMENT = "context_enrichment"  # Additional background info


# Intent-specific clarification templates
CLARIFICATION_TEMPLATES = {
    "incident_management": {
        "missing_incident_number": {
            "trigger": ClarificationTrigger.MISSING_REQUIRED_PARAM,
            "type": ClarificationType.PARAMETER_VALUE,
            "question": "Which incident would you like to {action}?",
            "hints": [
                "Provide the incident number (e.g., INC0010003)",
                "Or describe the incident briefly",
                "Recent incidents: {recent_incidents}"
            ],
            "required_for": ["fetch_incident", "update_incident", "incident_analysis"]
        },
        "ambiguous_date_field": {
            "trigger": ClarificationTrigger.AMBIGUOUS_ENTITY,
            "type": ClarificationType.ENTITY_SELECTION,
            "question": "When you say '{date_term}', which date do you mean?",
            "options": [
                {"id": "opened_at", "label": "Opened - when incident was reported (most common)", "default": True},
                {"id": "sys_created_on", "label": "Created - when system record was created"},
                {"id": "sys_updated_on", "label": "Updated - when incident was last modified"},
                {"id": "closed_at", "label": "Closed - when incident was resolved"}
            ],
            "context": "ServiceNow tracks multiple timestamps. 'Opened' is typically what users mean.",
            "keywords": ["opened", "created", "updated", "modified", "closed", "date", "time", "when"],
            "required_for": ["query_incidents_by_date", "get_incidents_by_date_range"]
        },
        "ambiguous_field": {
            "trigger": ClarificationTrigger.AMBIGUOUS_ENTITY,
            "type": ClarificationType.ENTITY_SELECTION,
            "question": "Which field did you mean?",
            "options": ["short_description", "work_notes", "assignment_group", "priority", "state"],
            "context": "ServiceNow incidents have many fields."
        },
        "update_confirmation": {
            "trigger": ClarificationTrigger.NEED_CONFIRMATION,
            "type": ClarificationType.CONFIRMATION,
            "question": "You're about to update {entity}. Proceed?",
            "options": ["Yes, proceed", "No, cancel", "Show me what will change first"]
        }
    },
    
    "code_analysis": {
        "missing_repository": {
            "trigger": ClarificationTrigger.MISSING_REQUIRED_PARAM,
            "type": ClarificationType.PARAMETER_VALUE,
            "question": "Which repository should I analyze?",
            "hints": [
                "Provide repository name or URL",
                "Available repos: {available_repos}",
                "Or use 'current' for active workspace"
            ]
        },
        "analysis_scope": {
            "trigger": ClarificationTrigger.MULTIPLE_PATHS,
            "type": ClarificationType.EXECUTION_PATH,
            "question": "What type of code analysis?",
            "options": [
                {"id": "security", "label": "Security vulnerabilities"},
                {"id": "performance", "label": "Performance issues"},
                {"id": "code_quality", "label": "Code quality metrics"},
                {"id": "dependencies", "label": "Dependency analysis"},
                {"id": "comprehensive", "label": "Comprehensive analysis"}
            ]
        }
    },
    
    "data_query": {
        "missing_time_range": {
            "trigger": ClarificationTrigger.MISSING_REQUIRED_PARAM,
            "type": ClarificationType.PARAMETER_VALUE,
            "question": "What time range should I query?",
            "options": [
                {"id": "1h", "label": "Last hour"},
                {"id": "24h", "label": "Last 24 hours"},
                {"id": "7d", "label": "Last 7 days"},
                {"id": "30d", "label": "Last 30 days"},
                {"id": "custom", "label": "Custom range (please specify)"}
            ]
        },
        "data_source_selection": {
            "trigger": ClarificationTrigger.AMBIGUOUS_ENTITY,
            "type": ClarificationType.ENTITY_SELECTION,
            "question": "Which data source?",
            "options": ["ServiceNow", "Confluence", "GitHub", "DataDog", "Splunk"],
            "context": "Your query could apply to multiple sources."
        }
    },
    
    "deployment": {
        "environment_confirmation": {
            "trigger": ClarificationTrigger.NEED_CONFIRMATION,
            "type": ClarificationType.CONFIRMATION,
            "question": "⚠️ You're deploying to **{environment}**. This is irreversible. Confirm?",
            "options": ["Yes, deploy", "No, cancel", "Show deployment plan first"],
            "critical": True
        },
        "rollback_strategy": {
            "trigger": ClarificationTrigger.MULTIPLE_PATHS,
            "type": ClarificationType.EXECUTION_PATH,
            "question": "How should I handle deployment failure?",
            "options": [
                {"id": "auto_rollback", "label": "Automatic rollback"},
                {"id": "manual_rollback", "label": "Manual intervention"},
                {"id": "forward_fix", "label": "Forward fix (no rollback)"}
            ]
        }
    },
    
    "user_management": {
        "ambiguous_user": {
            "trigger": ClarificationTrigger.AMBIGUOUS_ENTITY,
            "type": ClarificationType.ENTITY_SELECTION,
            "question": "Multiple users match '{query}'. Which one?",
            "options_from_search": True,  # Dynamically populated
            "context": "Please select the correct user."
        }
    }
}


class GeneralClarificationEngine:
    """Universal clarification engine for all DevCopilot planning scenarios."""
    
    def __init__(self):
        self.state_storage = {}  # In-memory state tracking
        self.templates = CLARIFICATION_TEMPLATES
    
    def analyze_plan_feasibility(
        self,
        question: str,
        detected_intent: Optional[str],
        extracted_entities: Dict[str, Any],
        available_tools: List[str],
        context_messages: List[Dict[str, Any]],
        planner_confidence: float = 1.0
    ) -> Dict[str, Any]:
        """
        Analyze if the planner has sufficient information to generate a good plan.
        
        Args:
            question: User's original question
            detected_intent: Intent classification result (e.g., 'incident_management')
            extracted_entities: Entities extracted from question (incidents, users, etc.)
            available_tools: List of tool names available for this intent
            context_messages: Conversation history
            planner_confidence: Planner's confidence in current plan (0.0-1.0)
        
        Returns:
            {
                "needs_clarification": bool,
                "triggers": List[ClarificationTrigger],
                "missing_params": List[str],
                "ambiguous_entities": List[Dict],
                "suggested_clarifications": List[str],
                "reason": str
            }
        """
        logger.info(
            f"[CLARIFY] Analyzing plan feasibility | intent={detected_intent} "
            f"entities={list(extracted_entities.keys())} confidence={planner_confidence:.2f}"
        )
        
        triggers = []
        missing_params = []
        ambiguous_entities = []
        suggested_clarifications = []
        
        # 1. Check for required parameters based on intent
        if detected_intent:
            required_params = self._get_required_params_for_intent(detected_intent, available_tools)
            for param in required_params:
                if param not in extracted_entities or not extracted_entities[param]:
                    missing_params.append(param)
                    triggers.append(ClarificationTrigger.MISSING_REQUIRED_PARAM)
                    logger.info(f"[CLARIFY] Missing required param: {param}")
        
        # 2. Check for ambiguous entity references
        ambiguous = self._detect_ambiguous_entities(question, extracted_entities, context_messages)
        if ambiguous:
            ambiguous_entities.extend(ambiguous)
            triggers.append(ClarificationTrigger.AMBIGUOUS_ENTITY)
            logger.info(f"[CLARIFY] Ambiguous entities: {[e['entity_type'] for e in ambiguous]}")
        
        # 3. Check if multiple execution paths exist
        if detected_intent and self._has_multiple_execution_paths(detected_intent, question, extracted_entities):
            triggers.append(ClarificationTrigger.MULTIPLE_PATHS)
            logger.info("[CLARIFY] Multiple execution paths detected")
        
        # 4. Check planner confidence
        if planner_confidence < 0.6:
            triggers.append(ClarificationTrigger.INSUFFICIENT_CONTEXT)
            logger.info(f"[CLARIFY] Low planner confidence: {planner_confidence:.2f}")
        
        # 5. Check for conflicting inputs
        conflicts = self._detect_conflicting_inputs(extracted_entities, question)
        if conflicts:
            triggers.append(ClarificationTrigger.CONFLICTING_INPUTS)
            logger.info(f"[CLARIFY] Conflicting inputs: {conflicts}")
        
        # 6. Check if critical action needs confirmation
        if detected_intent and self._is_critical_action(detected_intent, question):
            triggers.append(ClarificationTrigger.NEED_CONFIRMATION)
            logger.info("[CLARIFY] Critical action requires confirmation")
        
        # Generate suggested clarifications
        if missing_params:
            suggested_clarifications.append(f"missing_{missing_params[0]}")
        if ambiguous_entities:
            suggested_clarifications.append(f"ambiguous_{ambiguous_entities[0]['entity_type']}")
        if ClarificationTrigger.MULTIPLE_PATHS in triggers:
            suggested_clarifications.append("execution_path")
        if ClarificationTrigger.NEED_CONFIRMATION in triggers:
            suggested_clarifications.append("confirmation")
        
        needs_clarification = len(triggers) > 0
        
        reason = self._generate_feasibility_reason(
            needs_clarification,
            triggers,
            missing_params,
            ambiguous_entities,
            planner_confidence
        )
        
        result = {
            "needs_clarification": needs_clarification,
            "triggers": [t.value for t in triggers],
            "missing_params": missing_params,
            "ambiguous_entities": ambiguous_entities,
            "suggested_clarifications": suggested_clarifications,
            "reason": reason,
            "confidence": planner_confidence
        }
        
        logger.info(
            f"[CLARIFY] Analysis complete | needs_clarification={needs_clarification} "
            f"triggers={len(triggers)} suggestions={len(suggested_clarifications)}"
        )
        
        return result
    
    def generate_clarification_request(
        self,
        question: str,
        intent: str,
        analysis: Dict[str, Any],
        context_messages: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Generate contextual clarification questions based on feasibility analysis.
        
        Args:
            question: Original user question
            intent: Detected intent
            analysis: Output from analyze_plan_feasibility()
            context_messages: Conversation history
        
        Returns:
            {
                "clarification_text": str,
                "questions": List[Dict],  # Multiple questions if needed
                "state_id": str,
                "priority": str  # "critical", "high", "normal"
            }
        """
        logger.info(
            f"[CLARIFY] Generating clarification | intent={intent} "
            f"suggestions={len(analysis['suggested_clarifications'])}"
        )
        
        questions = []
        priority = "normal"
        
        # Get intent-specific templates
        intent_templates = self.templates.get(intent, {})
        
        # Build questions from suggested clarifications
        for suggestion in analysis['suggested_clarifications'][:3]:  # Limit to 3 questions
            template_key = suggestion
            
            # Handle generic cases
            if suggestion.startswith("missing_"):
                param_name = suggestion.replace("missing_", "")
                template_key = f"missing_{param_name}"
                if template_key not in intent_templates:
                    # Generic missing parameter template
                    questions.append({
                        "id": f"param_{param_name}",
                        "type": ClarificationType.PARAMETER_VALUE.value,
                        "question": f"What value should I use for **{param_name.replace('_', ' ')}**?",
                        "hint": f"This parameter is required to proceed.",
                        "required": True
                    })
                    continue
            
            elif suggestion.startswith("ambiguous_"):
                entity_type = suggestion.replace("ambiguous_", "")
                template_key = f"ambiguous_{entity_type}"
            
            # Use template if available
            if template_key in intent_templates:
                template = intent_templates[template_key]
                question_obj = self._build_question_from_template(
                    template,
                    question,
                    analysis,
                    context_messages
                )
                questions.append(question_obj)
                
                if template.get("critical"):
                    priority = "critical"
            
            # Execution path selection
            elif suggestion == "execution_path":
                if "analysis_scope" in intent_templates:
                    template = intent_templates["analysis_scope"]
                    question_obj = self._build_question_from_template(
                        template,
                        question,
                        analysis,
                        context_messages
                    )
                    questions.append(question_obj)
            
            # Confirmation request
            elif suggestion == "confirmation":
                confirm_key = next((k for k in intent_templates.keys() if "confirmation" in k), None)
                if confirm_key:
                    template = intent_templates[confirm_key]
                    question_obj = self._build_question_from_template(
                        template,
                        question,
                        analysis,
                        context_messages
                    )
                    questions.append(question_obj)
                    priority = "high"
        
        # Build clarification text
        if priority == "critical":
            clarification_text = "⚠️ **Critical Decision Required**\n\n"
        elif priority == "high":
            clarification_text = "**Confirmation Needed**\n\n"
        else:
            clarification_text = "I need some additional information to proceed:\n\n"
        
        clarification_text += "Before I can create an optimal execution plan, please help me with:\n\n"
        
        # Create state ID
        state_id = f"clarify_{intent}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        
        # Store state
        self.state_storage[state_id] = {
            "original_question": question,
            "intent": intent,
            "analysis": analysis,
            "questions": questions,
            "timestamp": datetime.now().isoformat(),
            "context_messages": context_messages[-5:] if context_messages else []
        }
        
        result = {
            "clarification_text": clarification_text,
            "questions": questions,
            "state_id": state_id,
            "priority": priority,
            "intent": intent
        }
        
        logger.info(
            f"[CLARIFY] Generated {len(questions)} questions | "
            f"state_id={state_id} priority={priority}"
        )
        
        return result
    
    def process_clarification_responses(
        self,
        state_id: str,
        responses: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Process user's responses to clarification questions and enrich original request.
        
        Args:
            state_id: Clarification session ID
            responses: Dict mapping question IDs to user responses
        
        Returns:
            {
                "enriched_question": str,
                "enriched_entities": Dict[str, Any],
                "enriched_metadata": Dict[str, Any],
                "ready_to_plan": bool
            }
        """
        logger.info(
            f"[CLARIFY] Processing responses | state_id={state_id} "
            f"responses={list(responses.keys())}"
        )
        
        if state_id not in self.state_storage:
            logger.warning(f"[CLARIFY] Unknown state_id: {state_id}")
            return {
                "enriched_question": "",
                "enriched_entities": {},
                "enriched_metadata": {},
                "ready_to_plan": False,
                "error": "Session expired or not found"
            }
        
        state = self.state_storage[state_id]
        original_question = state['original_question']
        intent = state['intent']
        questions = state['questions']
        
        enriched_entities = {}
        metadata_additions = {}
        clarification_summary = []
        
        # Process each response
        for question in questions:
            q_id = question['id']
            if q_id not in responses:
                if question.get('required'):
                    logger.warning(f"[CLARIFY] Missing required response for: {q_id}")
                    return {
                        "enriched_question": original_question,
                        "enriched_entities": enriched_entities,
                        "enriched_metadata": metadata_additions,
                        "ready_to_plan": False,
                        "error": f"Required response missing: {question['question']}"
                    }
                continue
            
            user_response = responses[q_id]
            q_type = question['type']
            
            # Extract structured data from response
            if q_type == ClarificationType.PARAMETER_VALUE.value:
                param_name = q_id.replace("param_", "")
                enriched_entities[param_name] = user_response
                clarification_summary.append(f"{param_name}={user_response}")
            
            elif q_type == ClarificationType.ENTITY_SELECTION.value:
                entity_type = q_id.replace("entity_", "")
                enriched_entities[entity_type] = user_response
                clarification_summary.append(f"Selected {entity_type}: {user_response}")
            
            elif q_type == ClarificationType.EXECUTION_PATH.value:
                metadata_additions['execution_path'] = user_response
                clarification_summary.append(f"Approach: {user_response}")
            
            elif q_type == ClarificationType.CONFIRMATION.value:
                confirmed = user_response.lower() in ['yes', '1', 'proceed', 'confirm', 'true']
                metadata_additions['user_confirmed'] = confirmed
                clarification_summary.append(f"Confirmed: {confirmed}")
                
                if not confirmed:
                    return {
                        "enriched_question": original_question,
                        "enriched_entities": enriched_entities,
                        "enriched_metadata": metadata_additions,
                        "ready_to_plan": False,
                        "cancelled": True,
                        "reason": "User cancelled operation"
                    }
        
        # Build enriched question
        enriched_question = original_question
        if clarification_summary:
            enriched_question += f" [Clarified: {'; '.join(clarification_summary)}]"
        
        # Cleanup state
        del self.state_storage[state_id]
        
        result = {
            "enriched_question": enriched_question,
            "enriched_entities": enriched_entities,
            "enriched_metadata": metadata_additions,
            "ready_to_plan": True,
            "original_question": original_question,
            "intent": intent
        }
        
        logger.info(
            f"[CLARIFY] Responses processed | entities={list(enriched_entities.keys())} "
            f"ready={result['ready_to_plan']}"
        )
        
        return result
    
    def _get_required_params_for_intent(self, intent: str, tools: List[str]) -> List[str]:
        """Determine required parameters based on intent and available tools."""
        # Intent-specific required params
        intent_requirements = {
            "incident_management": ["incident_number"],
            "code_analysis": ["repository"],
            "data_query": ["data_source", "time_range"],
            "deployment": ["environment", "version"],
            "user_management": ["username"]
        }
        return intent_requirements.get(intent, [])
    
    def _detect_ambiguous_entities(
        self,
        question: str,
        entities: Dict[str, Any],
        context: List[Dict]
    ) -> List[Dict]:
        """Detect ambiguous entity references."""
        ambiguous = []
        
        # Check for ambiguous date field references (opened vs created vs updated)
        date_field_patterns = [
            (r'\b(opened|created|updated|modified|closed)\b.*\b(in|during|from|between|last|past|since)\b', "ambiguous_date_field"),
            (r'\b(in|during|from|between|last|past|since)\b.*\b(days?|weeks?|months?|years?)\b', "ambiguous_date_field")
        ]
        
        q_lower = question.lower()
        for pattern, entity_type in date_field_patterns:
            if re.search(pattern, q_lower):
                # Extract which date term user mentioned
                date_match = re.search(r'\b(opened|created|updated|modified|closed)\b', q_lower)
                date_term = date_match.group(1) if date_match else "date"
                
                # Only flag as ambiguous if term could mean multiple fields
                ambiguous_terms = ["created", "updated", "modified"]  # "opened" is usually clear
                if date_term in ambiguous_terms or not date_match:
                    ambiguous.append({
                        "entity_type": "ambiguous_date_field",
                        "mention": date_term,
                        "resolvable": True,  # We can offer choices
                        "detected_term": date_term
                    })
                    break  # Only report once
        
        # Check for vague references
        vague_patterns = [
            (r'\b(this|that|it|these|those)\b', "ambiguous_pronoun"),
            (r'\bthe\s+(incident|ticket|issue)\b', "non_specific_reference"),
            (r'\b(user|person|someone)\b(?!\s+\w+)', "ambiguous_user")
        ]
        
        for pattern, entity_type in vague_patterns:
            if re.search(pattern, q_lower):
                # Check if we have context to resolve it
                has_context = self._can_resolve_from_context(entity_type, context)
                if not has_context:
                    ambiguous.append({
                        "entity_type": entity_type,
                        "mention": pattern,
                        "resolvable": False
                    })
        
        return ambiguous
    
    def _can_resolve_from_context(self, entity_type: str, context: List[Dict]) -> bool:
        """Check if entity can be resolved from conversation context."""
        if not context:
            return False
        
        # Look for explicit entity mentions in recent context
        recent = context[-3:] if len(context) > 3 else context
        for msg in recent:
            content = msg.get('content', '') or msg.get('text', '')
            if entity_type == "ambiguous_pronoun" and re.search(r'\bINC\d+\b', content):
                return True
            if entity_type == "ambiguous_user" and re.search(r'\b[a-z]+\.[a-z]+@', content):
                return True
        
        return False
    
    def _has_multiple_execution_paths(
        self,
        intent: str,
        question: str,
        entities: Dict[str, Any]
    ) -> bool:
        """Check if multiple execution approaches exist."""
        # Intents with inherent path ambiguity
        multi_path_intents = ["code_analysis", "data_query", "troubleshooting"]
        
        if intent in multi_path_intents:
            # Check if user specified an approach
            approach_keywords = ["analyze", "investigate", "search", "query", "check"]
            has_approach = any(kw in question.lower() for kw in approach_keywords)
            return not has_approach or len([kw for kw in approach_keywords if kw in question.lower()]) > 1
        
        return False
    
    def _detect_conflicting_inputs(
        self,
        entities: Dict[str, Any],
        question: str
    ) -> List[str]:
        """Detect conflicting parameter values."""
        conflicts = []
        
        # Example: user says "production" but entities extracted "development"
        # This would need intent-specific logic
        
        return conflicts
    
    def _is_critical_action(self, intent: str, question: str) -> bool:
        """Check if action requires explicit confirmation."""
        critical_intents = ["deployment", "deletion", "user_management"]
        critical_keywords = ["delete", "remove", "deploy", "production", "drop", "revoke"]
        
        if intent in critical_intents:
            return True
        
        return any(kw in question.lower() for kw in critical_keywords)
    
    def _generate_feasibility_reason(
        self,
        needs_clarification: bool,
        triggers: List[ClarificationTrigger],
        missing_params: List[str],
        ambiguous_entities: List[Dict],
        confidence: float
    ) -> str:
        """Generate human-readable reason for clarification decision."""
        if not needs_clarification:
            return f"Plan feasible: All required information present (confidence={confidence:.2f})"
        
        reasons = []
        if missing_params:
            reasons.append(f"missing parameters: {', '.join(missing_params)}")
        if ambiguous_entities:
            types = [e['entity_type'] for e in ambiguous_entities]
            reasons.append(f"ambiguous references: {', '.join(types)}")
        if ClarificationTrigger.MULTIPLE_PATHS in triggers:
            reasons.append("multiple execution approaches")
        if ClarificationTrigger.NEED_CONFIRMATION in triggers:
            reasons.append("critical action requires confirmation")
        if confidence < 0.6:
            reasons.append(f"low planner confidence ({confidence:.2f})")
        
        return f"Clarification needed: {'; '.join(reasons)}"
    
    def _build_question_from_template(
        self,
        template: Dict[str, Any],
        original_question: str,
        analysis: Dict[str, Any],
        context: List[Dict]
    ) -> Dict[str, Any]:
        """Build a structured question from a template."""
        question_obj = {
            "id": template.get("id", f"q_{len(self.state_storage)}"),
            "type": template['type'].value if isinstance(template['type'], ClarificationType) else template['type'],
            "question": template['question'],
            "required": template.get("required", True)
        }
        
        # Add options if present
        if 'options' in template:
            question_obj['options'] = template['options']
        
        # Add hints
        if 'hints' in template:
            question_obj['hints'] = template['hints']
        
        # Add context
        if 'context' in template:
            question_obj['context'] = template['context']
        
        return question_obj


# Global singleton
_general_clarification_engine = None

def get_general_clarification_engine() -> GeneralClarificationEngine:
    """Get or create the global clarification engine instance."""
    global _general_clarification_engine
    if _general_clarification_engine is None:
        _general_clarification_engine = GeneralClarificationEngine()
    return _general_clarification_engine


# Convenience functions for orchestrator integration

def should_request_clarification(
    question: str,
    intent: Optional[str],
    entities: Dict[str, Any],
    tools: List[str],
    context: List[Dict],
    planner_confidence: float = 1.0
) -> bool:
    """Quick check if clarification is needed before planning."""
    engine = get_general_clarification_engine()
    analysis = engine.analyze_plan_feasibility(
        question, intent, entities, tools, context, planner_confidence
    )
    return analysis['needs_clarification']


def generate_clarification(
    question: str,
    intent: str,
    entities: Dict[str, Any],
    tools: List[str],
    context: List[Dict],
    planner_confidence: float = 1.0
) -> Dict[str, Any]:
    """Generate clarification request if needed."""
    engine = get_general_clarification_engine()
    analysis = engine.analyze_plan_feasibility(
        question, intent, entities, tools, context, planner_confidence
    )
    
    if analysis['needs_clarification']:
        return engine.generate_clarification_request(question, intent, analysis, context)
    else:
        return {
            "needs_clarification": False,
            "analysis": analysis
        }
