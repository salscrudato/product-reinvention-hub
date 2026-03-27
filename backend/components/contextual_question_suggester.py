"""
Contextual Question Suggester - Generates follow-up questions based on conversation history

Tracks the last 3 questions and their results to suggest relevant next questions.
Dynamically updates after each user interaction for a fluid conversational experience.
"""

import json
import logging
import re
from typing import Dict, List, Optional, Any
from collections import deque
import openai
from os import getenv

logger = logging.getLogger("agentic_orchestrator_auto").getChild("contextual_suggester")


class ContextualQuestionSuggester:
    """Generates contextual follow-up questions based on recent conversation history."""
    
    def __init__(self, max_history: int = 3):
        """
        Initialize suggester with conversation history limit.
        
        Args:
            max_history: Number of recent Q&A pairs to track (default: 3)
        """
        self.max_history = max_history
        # Conversation history per user: {username: deque of Q&A pairs}
        self.user_histories: Dict[str, deque] = {}
        
    def add_to_history(
        self, 
        username: str, 
        question: str, 
        answer: str,
        intent: Optional[str] = None,
        tool_outputs: Optional[Dict] = None
    ):
        """
        Add a Q&A interaction to user's history.
        
        Args:
            username: User identifier
            question: User's question
            answer: System's answer
            intent: Classified intent (backlog_grooming, incident_detail, etc.)
            tool_outputs: Outputs from tools executed
        """
        if username not in self.user_histories:
            self.user_histories[username] = deque(maxlen=self.max_history)
        
        self.user_histories[username].append({
            'question': question,
            'answer': answer,
            'intent': intent,
            'tool_outputs': tool_outputs,
            'has_incidents': self._has_incidents(tool_outputs),
            'has_user_stories': self._has_user_stories(tool_outputs),
            'entities_mentioned': self._extract_entities(question, answer)
        })
        
        logger.info(f"[ContextualSuggester] Added to history for {username}: '{question[:50]}...' | History size: {len(self.user_histories[username])}")
    
    def _has_incidents(self, tool_outputs: Optional[Dict]) -> bool:
        """Check if tool outputs contain incidents."""
        if not tool_outputs:
            return False
        
        # Check for incidents in various tool outputs
        for tool_name, output in tool_outputs.items():
            if not isinstance(output, dict):
                continue
            
            if 'sample' in output and isinstance(output['sample'], list):
                return any('number' in item and str(item.get('number', '')).startswith('INC') 
                          for item in output['sample'])
            
            if 'incidents' in output and isinstance(output['incidents'], list):
                return len(output['incidents']) > 0
            
            if 'number' in output and str(output.get('number', '')).startswith('INC'):
                return True
        
        return False
    
    def _has_user_stories(self, tool_outputs: Optional[Dict]) -> bool:
        """Check if tool outputs contain user stories/JIRA items."""
        if not tool_outputs:
            return False
        
        for tool_name, output in tool_outputs.items():
            if not isinstance(output, dict):
                continue
            
            if any(key in output for key in ['issues', 'stories', 'user_stories']):
                return True
        
        return False
    
    def _extract_entities(self, question: str, answer: str) -> Dict[str, List[str]]:
        """Extract entity mentions from question and answer."""
        entities = {
            'incidents': [],
            'dates': [],
            'priorities': [],
            'components': []
        }
        
        text = f"{question} {answer}"
        
        # Extract incident numbers
        inc_pattern = r'\bINC\d{7}\b'
        entities['incidents'] = list(set(re.findall(inc_pattern, text, re.IGNORECASE)))
        
        # Extract dates
        date_patterns = [
            r'\d{4}-\d{2}-\d{2}',
            r'last \d+ days?',
            r'past \w+',
            r'yesterday|today|tomorrow'
        ]
        for pattern in date_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            entities['dates'].extend(matches)
        
        # Extract priorities
        pri_pattern = r'\b(critical|high|medium|low|p[1-4])\b'
        entities['priorities'] = list(set(re.findall(pri_pattern, text, re.IGNORECASE)))
        
        # Extract component mentions
        comp_pattern = r'\b(database|api|frontend|backend|login|email|dashboard)\b'
        entities['components'] = list(set(re.findall(comp_pattern, text, re.IGNORECASE)))
        
        return entities
    
    def get_contextual_suggestions(
        self, 
        username: str,
        limit: int = 5,
        use_llm: bool = True
    ) -> List[str]:
        """
        Generate contextual follow-up questions based on recent history.
        
        Args:
            username: User identifier
            limit: Maximum number of suggestions to return
            use_llm: Use LLM for intelligent suggestion generation (True) or templates (False)
            
        Returns:
            List of suggested follow-up questions
        """
        history = self.user_histories.get(username, deque())
        
        if not history:
            return self._get_default_suggestions(limit)
        
        if use_llm:
            return self._generate_llm_suggestions(history, limit)
        else:
            return self._generate_template_suggestions(history, limit)
    
    def _generate_llm_suggestions(
        self, 
        history: deque, 
        limit: int
    ) -> List[str]:
        """Generate suggestions using LLM based on conversation history."""
        try:
            # Build context from history
            context_items = []
            for i, item in enumerate(reversed(history), 1):
                context_items.append(
                    f"{i}. Q: {item['question']}\n"
                    f"   A: {item['answer'][:200]}...\n"
                    f"   Intent: {item.get('intent', 'unknown')}"
                )
            
            context = "\n".join(context_items)
            
            prompt = f"""Based on this recent conversation history, suggest {limit} natural follow-up questions the user might ask next.

Recent conversation (most recent first):
{context}

Generate questions that:
1. Build on the previous topics discussed
2. Dig deeper into specific items mentioned (incidents, user stories, etc.)
3. Explore related areas (root cause, impact, resolution)
4. Help the user take action (assignments, updates, analysis)

Return ONLY the questions, one per line, without numbering or explanations.
Make them conversational and specific to what was just discussed."""

            model = getenv("GPT_MODEL_NAME", "gpt-4")
            
            response = openai.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are an expert at suggesting relevant follow-up questions for incident management and ServiceNow conversations. You have deep domain knowledge in:\n- Life & Annuity Insurance: NIGO types (successor owner, APS, underwriting, payment, compliance, signature, policy admin)\n- Property & Casualty Insurance: NIGO types (binding, coverage, vehicle, property, underwriting, premium, documentation)\n- Insurance operations: policy administration, requirements, claim processing\nSuggest questions that leverage this domain expertise."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=300,
                temperature=0.7
            )
            
            suggestions_text = response.choices[0].message.content.strip()
            suggestions = [line.strip() for line in suggestions_text.split('\n') if line.strip()]
            
            # Clean up any numbering that might have snuck in
            cleaned = []
            for s in suggestions:
                # Remove leading numbers and dots
                clean = re.sub(r'^\d+[\.\)]\s*', '', s)
                if clean:
                    cleaned.append(clean)
            
            logger.info(f"[ContextualSuggester] Generated {len(cleaned)} LLM suggestions")
            return cleaned[:limit]
            
        except Exception as e:
            logger.error(f"[ContextualSuggester] LLM generation failed: {e}", exc_info=True)
            return self._generate_template_suggestions(history, limit)
    
    def _generate_template_suggestions(
        self, 
        history: deque, 
        limit: int
    ) -> List[str]:
        """Generate suggestions using templates and patterns (fallback)."""
        suggestions = []
        latest = history[-1] if history else None
        
        if not latest:
            return self._get_default_suggestions(limit)
        
        intent = latest.get('intent', 'unknown')
        entities = latest.get('entities_mentioned', {})
        has_incidents = latest.get('has_incidents', False)
        has_user_stories = latest.get('has_user_stories', False)
        
        # Intent-based suggestions
        if intent == 'backlog_grooming':
            suggestions.extend([
                "List those incidents",  # References cached incidents
                "Show me the critical priority ones",
                "What's causing the oldest incidents?",
                "Who should these be assigned to?",
                "Are there any patterns in these incidents?"
            ])
        
        elif intent == 'incident_detail':
            if entities.get('incidents'):
                inc = entities['incidents'][0]
                suggestions.extend([
                    f"What's the root cause of {inc}?",
                    f"Show me similar incidents to {inc}",
                    f"Has {inc} been resolved?",
                    f"Who is working on {inc}?",
                    "What's the impact of this incident?"
                ])
                
                # Add L&A NIGO-specific suggestions if keywords detected
                question_lower = latest.get('question', '').lower()
                if any(kw in question_lower for kw in ['life', 'annuity', 'aps', 'successor', 'nigo']):
                    suggestions.extend([
                        f"What NIGO type is {inc}?",
                        f"Show me L&A NIGO resolution procedures for {inc}",
                        f"What are common L&A NIGO resolution steps?",
                        "Find similar Life & Annuity NIGO cases"
                    ])
                
                # Add P&C NIGO-specific suggestions if keywords detected
                if any(kw in question_lower for kw in ['auto', 'property', 'homeowner', 'vehicle', 'vin', 'binding']):
                    suggestions.extend([
                        f"What P&C NIGO type is {inc}?",
                        f"Show me P&C NIGO resolution procedures for {inc}",
                        f"What are common P&C NIGO resolution steps?",
                        "Find similar Property & Casualty NIGO cases"
                    ])
        
        elif intent == 'code_retrieval':
            suggestions.extend([
                "Show me the related commits",
                "What files were changed?",
                "Who wrote this code?",
                "Are there any tests for this?",
                "Show me the code review comments"
            ])
        
        elif intent == 'wiki_search':
            suggestions.extend([
                "Show me more details from those pages",  # References cached pages
                "Are there related documentation pages?",
                "What are the prerequisites?",
                "Show me examples",
                "Is there a video tutorial?"
            ])
        
        # Entity-based suggestions
        if has_incidents:
            suggestions.extend([
                "Analyze those incidents for patterns",
                "What's the average resolution time?",
                "Group them by component",
                "Show me the timeline"
            ])
        
        if has_user_stories:
            suggestions.extend([
                "What's the status of those stories?",
                "Show me the acceptance criteria",
                "Who is assigned to them?",
                "When are they due?"
            ])
        
        # Priority-based suggestions
        if entities.get('priorities'):
            pri = entities['priorities'][0]
            suggestions.extend([
                f"Show me more {pri} priority items",
                f"What's causing {pri} priority incidents?",
                f"How many {pri} priority items are open?"
            ])
        
        # Component-based suggestions
        if entities.get('components'):
            comp = entities['components'][0]
            suggestions.extend([
                f"Show me all incidents in {comp}",
                f"Who owns the {comp} component?",
                f"What's the health of {comp}?"
            ])
        
        # Remove duplicates while preserving order
        seen = set()
        unique_suggestions = []
        for s in suggestions:
            if s.lower() not in seen:
                seen.add(s.lower())
                unique_suggestions.append(s)
        
        logger.info(f"[ContextualSuggester] Generated {len(unique_suggestions)} template suggestions")
        return unique_suggestions[:limit]
    
    def _get_default_suggestions(self, limit: int) -> List[str]:
        """Get default starter questions when no history exists."""
        default = [
            "What are the top incidents in the backlog?",
            "Show me critical incidents from the last 7 days",
            "What user stories are assigned to me?",
            "Search the wiki for deployment procedures",
            "Show me recent code changes in the API",
            "What incidents are aging the most?",
            "Find similar incidents to INC0010001",
            "Who is working on authentication issues?",
            # Insurance domain suggestions
            "What are the current Life & Annuity NIGO types?",
            "Show me P&C NIGO resolution procedures",
            "What L&A NIGO incidents need attention?",
            "Help me resolve an APS NIGO issue",
            "What are common successor owner NIGO problems?"
        ]
        return default[:limit]
    
    def clear_history(self, username: str):
        """Clear conversation history for a user."""
        if username in self.user_histories:
            del self.user_histories[username]
            logger.info(f"[ContextualSuggester] Cleared history for {username}")
    
    def get_history_summary(self, username: str) -> Dict[str, Any]:
        """Get a summary of user's conversation history."""
        history = self.user_histories.get(username, deque())
        
        if not history:
            return {
                'questions_asked': 0,
                'intents_covered': [],
                'entities_discussed': {}
            }
        
        intents = [item.get('intent') for item in history if item.get('intent')]
        
        all_entities = {
            'incidents': [],
            'dates': [],
            'priorities': [],
            'components': []
        }
        
        for item in history:
            entities = item.get('entities_mentioned', {})
            for key in all_entities:
                all_entities[key].extend(entities.get(key, []))
        
        # Deduplicate
        for key in all_entities:
            all_entities[key] = list(set(all_entities[key]))
        
        return {
            'questions_asked': len(history),
            'intents_covered': list(set(intents)),
            'entities_discussed': all_entities,
            'recent_questions': [item['question'] for item in history]
        }


# Global singleton instance
_contextual_suggester: Optional[ContextualQuestionSuggester] = None


def get_contextual_suggester() -> ContextualQuestionSuggester:
    """Get or create the global contextual suggester instance."""
    global _contextual_suggester
    if _contextual_suggester is None:
        _contextual_suggester = ContextualQuestionSuggester(max_history=3)
    return _contextual_suggester


__all__ = [
    'ContextualQuestionSuggester',
    'get_contextual_suggester'
]
