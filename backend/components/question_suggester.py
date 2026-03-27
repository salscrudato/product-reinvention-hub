"""Question Suggestion System - Learns patterns from logs to guide users.

Analyzes historical user questions to suggest relevant queries based on:
- Popular question patterns by persona
- Recent successful queries
- Intent-specific templates
- Context-aware recommendations

Runs on backend startup and provides real-time suggestions.
"""

import json
import logging
import re
from pathlib import Path
from collections import defaultdict, Counter
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta

logger = logging.getLogger("agentic_orchestrator_auto").getChild("question_suggester")


class QuestionSuggester:
    """Learns question patterns from logs and suggests helpful queries."""
    
    def __init__(self, log_path: str = "agentic_orchestrator_auto.log"):
        """Initialize suggester with path to orchestrator log."""
        self.log_path = Path(log_path)
        self.patterns_by_persona = defaultdict(dict)
        self.popular_questions = []
        self.intent_templates = {}
        self.last_analyzed = None
        self.analysis_cache_path = Path("question_patterns_cache.json")
        self.max_example_questions = 20
        
    def analyze_logs(self, max_lines: int = 10000, incremental: bool = True) -> Dict[str, Any]:
        """Analyze recent logs to extract question patterns.
        
        Args:
            max_lines: Maximum log lines to analyze
            
        Returns:
            Analysis statistics
        """
        logger.info(f"[QuestionSuggester] Analyzing logs from {self.log_path}")
        
        if not self.log_path.exists():
            logger.warning(f"[QuestionSuggester] Log file not found: {self.log_path}")
            return {"error": "log_not_found", "patterns": 0}
        
        # Load cached patterns for incremental updates
        last_analyzed = None
        if incremental and self.analysis_cache_path.exists():
            self._load_cache()
            last_analyzed = self.last_analyzed

        # Track patterns (new data only)
        questions_by_intent = defaultdict(list)
        questions_by_persona = defaultdict(list)
        successful_queries = []
        question_freq = Counter()
        
        current_question = None
        current_persona = None
        current_intent = None
        current_success = False
        current_question_time = None
        max_timestamp_seen = last_analyzed
        
        try:
            # Read log file (last N lines for performance)
            with open(self.log_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()[-max_lines:]
            
            for line in lines:
                line_ts = self._extract_timestamp(line)
                if line_ts and max_timestamp_seen:
                    if line_ts > max_timestamp_seen:
                        max_timestamp_seen = line_ts
                elif line_ts and not max_timestamp_seen:
                    max_timestamp_seen = line_ts

                # Extract question
                if 'FLOW[QUESTION]' in line:
                    if last_analyzed and line_ts and line_ts <= last_analyzed:
                        current_question = None
                        current_intent = None
                        current_persona = None
                        current_success = False
                        current_question_time = None
                        continue
                    question_match = line.split('FLOW[QUESTION]')[1].strip()
                    if question_match:
                        current_question = question_match
                        current_success = False
                        current_question_time = line_ts
                
                # Extract classification
                elif 'FLOW[CLASSIFIED]' in line and current_question:
                    json_match = re.search(r'\{.*\}', line)
                    if json_match:
                        try:
                            data = json.loads(json_match.group(0))
                            current_intent = data.get('intent', 'unknown')
                            current_persona = data.get('persona', 'unknown')
                        except json.JSONDecodeError:
                            pass
                
                # Track successful completions
                elif 'FLOW[SOLVE_COMPLETE]' in line and current_question:
                    json_match = re.search(r'\{.*\}', line)
                    if json_match:
                        try:
                            data = json.loads(json_match.group(0))
                            errors = data.get('errors', 1)
                            if errors == 0:
                                current_success = True
                                successful_queries.append({
                                    'question': current_question,
                                    'intent': current_intent,
                                    'persona': current_persona,
                                    'timestamp': current_question_time.isoformat() if current_question_time else None
                                })
                        except json.JSONDecodeError:
                            pass
                
                # Store question if we have context
                if current_question and current_intent and current_persona:
                    # Normalize question for pattern matching
                    normalized = self._normalize_question(current_question)
                    
                    if normalized:
                        questions_by_intent[current_intent].append({
                            'question': current_question,
                            'normalized': normalized,
                            'persona': current_persona,
                            'success': current_success,
                            'timestamp': current_question_time
                        })
                        questions_by_persona[current_persona].append({
                            'question': current_question,
                            'normalized': normalized,
                            'intent': current_intent,
                            'success': current_success,
                            'timestamp': current_question_time
                        })
                        question_freq[normalized] += 1
                    
                    # Reset for next question
                    current_question = None
                    current_intent = None
            
            # Build patterns by persona and intent (new data only)
            for persona, questions in questions_by_persona.items():
                intent_counts = defaultdict(int)
                for q in questions:
                    if q['success']:
                        intent_counts[q['intent']] += 1
                
                # Use nested defaultdict structure
                pattern_data = {
                    'top_intents': dict(sorted(intent_counts.items(), key=lambda x: x[1], reverse=True)[:5]),
                    'example_questions': [q['question'] for q in questions if q['success']][:10],
                    'question_count': len(questions)
                }
                # Store in nested defaultdict
                # Merge into existing patterns
                self._merge_persona_patterns(persona, pattern_data)
            
            # Build intent templates from most common patterns (new data only)
            for intent, questions in questions_by_intent.items():
                successful = [q for q in questions if q['success']]
                if successful:
                    # Get most common normalized patterns
                    patterns = Counter([q['normalized'] for q in successful])
                    new_templates = [
                        {'pattern': pattern, 'examples': [q['question'] for q in successful if q['normalized'] == pattern][:3]}
                        for pattern, _ in patterns.most_common(5)
                    ]
                    self._merge_intent_templates(intent, new_templates)
            
            # Store most popular questions (successful, high frequency) (new data only)
            popular = [(q, count) for q, count in question_freq.most_common(20) 
                      if count >= 2]  # At least 2 occurrences
            new_popular_questions = [
                {
                    'pattern': pattern,
                    'frequency': count,
                    'examples': [q['question'] for q in successful_queries if self._normalize_question(q['question']) == pattern][:3]
                }
                for pattern, count in popular
            ]
            self._merge_popular_questions(new_popular_questions)
            
            if max_timestamp_seen and (not last_analyzed or max_timestamp_seen > last_analyzed):
                self.last_analyzed = max_timestamp_seen
            elif not self.last_analyzed:
                self.last_analyzed = datetime.now()
            
            # Cache results
            self._save_cache()
            
            stats = {
                'total_questions': len(successful_queries),
                'unique_patterns': len(question_freq),
                'personas_analyzed': len(self.patterns_by_persona),
                'intents_found': len(self.intent_templates),
                'popular_questions': len(self.popular_questions),
                'analyzed_at': self.last_analyzed.isoformat()
            }
            
            logger.info(f"[QuestionSuggester] Analysis complete: {stats}")
            return stats
            
        except Exception as e:
            logger.error(f"[QuestionSuggester] Analysis failed: {e}", exc_info=True)
            return {"error": str(e), "patterns": 0}
    
    def _normalize_question(self, question: str) -> str:
        """Normalize question to pattern by replacing specific values."""
        # Replace incident numbers
        normalized = re.sub(r'\bINC\d{7}\b', 'INC#######', question, flags=re.IGNORECASE)
        # Replace dates
        normalized = re.sub(r'\d{4}-\d{2}-\d{2}', 'YYYY-MM-DD', normalized)
        # Replace numbers
        normalized = re.sub(r'\b\d+\s+(days?|weeks?|months?)\b', 'N days', normalized)
        # Lowercase
        normalized = normalized.lower().strip()
        return normalized

    def _extract_timestamp(self, line: str) -> Optional[datetime]:
        """Extract timestamp from log line if present."""
        match = re.match(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
        if not match:
            return None
        try:
            return datetime.strptime(match.group(1), '%Y-%m-%d %H:%M:%S')
        except ValueError:
            return None

    def _merge_persona_patterns(self, persona: str, new_pattern_data: Dict[str, Any]):
        """Merge new persona patterns into existing cache."""
        existing = dict(self.patterns_by_persona.get(persona, {}))

        # Merge top intents
        existing_top = existing.get('top_intents', {}) or {}
        new_top = new_pattern_data.get('top_intents', {}) or {}
        for intent, count in new_top.items():
            existing_top[intent] = existing_top.get(intent, 0) + count
        # Keep top 5 intents
        existing['top_intents'] = dict(sorted(existing_top.items(), key=lambda x: x[1], reverse=True)[:5])

        # Merge example questions
        existing_examples = existing.get('example_questions', []) or []
        new_examples = new_pattern_data.get('example_questions', []) or []
        merged_examples = self._dedupe_preserve_order(existing_examples + new_examples)
        existing['example_questions'] = merged_examples[:self.max_example_questions]

        # Merge question count
        existing['question_count'] = int(existing.get('question_count', 0)) + int(new_pattern_data.get('question_count', 0))

        self.patterns_by_persona[persona] = existing

    def _merge_intent_templates(self, intent: str, new_templates: List[Dict[str, Any]]):
        """Merge intent templates by pattern."""
        existing = self.intent_templates.get(intent, []) or []
        existing_map = {item['pattern']: item for item in existing if 'pattern' in item}

        for item in new_templates:
            pattern = item.get('pattern')
            if not pattern:
                continue
            existing_item = existing_map.get(pattern, {'pattern': pattern, 'examples': []})
            merged_examples = self._dedupe_preserve_order((existing_item.get('examples') or []) + (item.get('examples') or []))
            existing_item['examples'] = merged_examples[:3]
            existing_map[pattern] = existing_item

        # Keep at most 5 patterns per intent
        merged_list = list(existing_map.values())
        self.intent_templates[intent] = merged_list[:5]

    def _merge_popular_questions(self, new_popular: List[Dict[str, Any]]):
        """Merge popular questions by pattern."""
        existing = {item.get('pattern'): item for item in self.popular_questions if item.get('pattern')}

        for item in new_popular:
            pattern = item.get('pattern')
            if not pattern:
                continue
            if pattern in existing:
                existing_item = existing[pattern]
                existing_item['frequency'] = int(existing_item.get('frequency', 0)) + int(item.get('frequency', 0))
                merged_examples = self._dedupe_preserve_order((existing_item.get('examples') or []) + (item.get('examples') or []))
                existing_item['examples'] = merged_examples[:3]
                existing[pattern] = existing_item
            else:
                existing[pattern] = item

        # Sort by frequency and keep top 20
        self.popular_questions = sorted(existing.values(), key=lambda x: x.get('frequency', 0), reverse=True)[:20]

    @staticmethod
    def _dedupe_preserve_order(items: List[str]) -> List[str]:
        """Deduplicate list while preserving order."""
        seen = set()
        deduped = []
        for item in items:
            if item not in seen:
                seen.add(item)
                deduped.append(item)
        return deduped
    
    def get_suggestions(
        self, 
        persona: Optional[str] = None, 
        context: Optional[Dict] = None,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """Get question suggestions for user.
        
        Args:
            persona: User's persona (developer, product_owner, etc.)
            context: Additional context (recent incidents, etc.)
            limit: Maximum suggestions to return
            
        Returns:
            List of suggested questions with metadata
        """
        # Load cache if not analyzed yet
        if not self.patterns_by_persona and self.analysis_cache_path.exists():
            self._load_cache()
        
        suggestions = []
        
        # Persona-specific suggestions
        if persona and persona in self.patterns_by_persona:
            persona_data = self.patterns_by_persona[persona]
            examples = persona_data.get('example_questions', [])
            
            for question in examples[:limit]:
                suggestions.append({
                    'question': question,
                    'source': 'persona_popular',
                    'persona': persona,
                    'confidence': 0.9
                })
        
        # Popular questions across all users
        for item in self.popular_questions[:limit]:
            if item['examples']:
                suggestions.append({
                    'question': item['examples'][0],
                    'source': 'popular',
                    'frequency': item['frequency'],
                    'confidence': 0.8
                })
        
        # Context-aware suggestions
        if context:
            # If there are recent incidents in context
            if context.get('incidents'):
                incident_suggestions = self._get_incident_suggestions(context['incidents'])
                suggestions.extend(incident_suggestions[:limit])
        
        # Intent-based starter questions
        intent_starters = self._get_intent_starters(persona)
        suggestions.extend(intent_starters)
        
        # Deduplicate and limit
        seen = set()
        unique_suggestions = []
        for s in suggestions:
            normalized = self._normalize_question(s['question'])
            if normalized not in seen:
                seen.add(normalized)
                unique_suggestions.append(s)
                if len(unique_suggestions) >= limit:
                    break
        
        return unique_suggestions
    
    def _get_incident_suggestions(self, incidents: List[str]) -> List[Dict]:
        """Generate context-aware suggestions based on recent incidents."""
        suggestions = []
        if incidents:
            inc = incidents[0]  # Most recent
            suggestions.append({
                'question': f"What is the summary of {inc}?",
                'source': 'context_incident',
                'confidence': 0.7
            })
            suggestions.append({
                'question': f"Who should {inc} be assigned to?",
                'source': 'context_incident',
                'confidence': 0.75
            })
            suggestions.append({
                'question': f"Show me similar incidents to {inc}",
                'source': 'context_incident',
                'confidence': 0.6
            })
            suggestions.append({
                'question': f"What is the resolution progress on {inc}?",
                'source': 'context_incident',
                'confidence': 0.65
            })
        return suggestions
    
    def _get_intent_starters(self, persona: Optional[str]) -> List[Dict]:
        """Get starter questions for different intents."""
        starters = {
            'developer': [
                {'question': "Show me all incidents opened in the last 3 days", 'intent': 'incident_triage'},
                {'question': "What is the root cause of incident INC0010001?", 'intent': 'incident_analysis'},
                {'question': "Who should incident INC0010001 be assigned to?", 'intent': 'assignment_prediction'},
                {'question': "Which team handles network connectivity issues?", 'intent': 'assignment_prediction'},
                {'question': "Search wiki for troubleshooting guides on @wiki", 'intent': 'knowledge_retrieval'},
                {'question': "What is the resolution progress on INC0010001?", 'intent': 'resolution_progress'},
            ],
            'product_owner': [
                {'question': "What are the top priority incidents this week?", 'intent': 'incident_prioritization'},
                {'question': "Show me incidents by category", 'intent': 'incident_analysis'},
                {'question': "What is the resolution time trend?", 'intent': 'analytics'},
                {'question': "Which assignment groups are overloaded?", 'intent': 'workload_analysis'},
                {'question': "Show me assignment accuracy metrics", 'intent': 'assignment_analytics'},
            ],
            'business_analyst': [
                {'question': "Generate a report on incident volume", 'intent': 'reporting'},
                {'question': "What are the most common issue categories?", 'intent': 'analytics'},
                {'question': "Show me SLA compliance metrics", 'intent': 'sla_monitoring'},
                {'question': "Which teams handle the most incidents?", 'intent': 'assignment_analytics'},
                {'question': "What is the average time to first assignment?", 'intent': 'assignment_metrics'},
            ],
            'service_desk': [
                {'question': "Who should I assign this network issue to?", 'intent': 'assignment_prediction'},
                {'question': "Which team handles password resets?", 'intent': 'assignment_prediction'},
                {'question': "Show me similar incidents to INC0010001", 'intent': 'similar_incidents'},
                {'question': "What assignment groups are available?", 'intent': 'assignment_info'},
                {'question': "Which team should handle this software issue?", 'intent': 'assignment_prediction'},
            ]
        }
        
        persona_starters = starters.get(persona or 'developer', starters['developer'])
        return [
            {
                'question': s['question'],
                'source': 'intent_starter',
                'intent': s['intent'],
                'confidence': 0.5
            }
            for s in persona_starters[:3]
        ]
    
    def _save_cache(self):
        """Save analysis results to cache file."""
        try:
            cache_data = {
                'patterns_by_persona': dict(self.patterns_by_persona),
                'popular_questions': self.popular_questions,
                'intent_templates': self.intent_templates,
                'last_analyzed': self.last_analyzed.isoformat() if self.last_analyzed else None
            }
            with open(self.analysis_cache_path, 'w', encoding='utf-8') as f:
                json.dump(cache_data, f, indent=2)
            logger.info(f"[QuestionSuggester] Cache saved to {self.analysis_cache_path}")
        except Exception as e:
            logger.error(f"[QuestionSuggester] Failed to save cache: {e}")
    
    def _load_cache(self) -> bool:
        """Load analysis results from cache file."""
        try:
            with open(self.analysis_cache_path, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
            
            self.patterns_by_persona = defaultdict(dict, cache_data.get('patterns_by_persona', {}))
            self.popular_questions = cache_data.get('popular_questions', [])
            self.intent_templates = cache_data.get('intent_templates', {})
            
            last_analyzed_str = cache_data.get('last_analyzed')
            if last_analyzed_str:
                self.last_analyzed = datetime.fromisoformat(last_analyzed_str)
            
            logger.info(f"[QuestionSuggester] Cache loaded from {self.analysis_cache_path}")
            return True
        except Exception as e:
            logger.error(f"[QuestionSuggester] Failed to load cache: {e}")
            return False


# Global singleton instance
_question_suggester = None


def get_question_suggester() -> QuestionSuggester:
    """Get or create global question suggester instance."""
    global _question_suggester
    if _question_suggester is None:
        _question_suggester = QuestionSuggester()
    return _question_suggester


def initialize_question_suggester(log_path: str = "agentic_orchestrator_auto.log") -> Dict[str, Any]:
    """Initialize question suggester by loading cached patterns (does NOT analyze logs).
    
    Log analysis should be done by cron job or explicit API call to /question_suggestions/analyze.
    This function only loads pre-computed patterns from cache.
    
    Args:
        log_path: Path to orchestrator log file
        
    Returns:
        Cache load statistics
    """
    logger.info("[QuestionSuggester] Initializing question suggester (loading cache only)...")
    suggester = QuestionSuggester(log_path)
    
    # Load existing cache if available - do NOT analyze logs
    if suggester._load_cache():
        stats = {
            "cache_loaded": True,
            "patterns_count": len(suggester.patterns_by_persona),
            "popular_questions": len(suggester.popular_questions),
            "intents_tracked": len(suggester.intent_templates)
        }
        logger.info(f"[QuestionSuggester] Loaded {stats['patterns_count']} cached patterns")
    else:
        stats = {
            "cache_loaded": False,
            "message": "No cache found. Run /question_suggestions/analyze to build patterns or wait for cron job."
        }
        logger.warning("[QuestionSuggester] No cache found. Suggestions unavailable until analysis runs.")
    
    # Store globally
    global _question_suggester
    _question_suggester = suggester
    
    return stats


def get_question_suggestions(
    persona: Optional[str] = None,
    context: Optional[Dict] = None,
    limit: int = 5
) -> List[Dict[str, Any]]:
    """Get question suggestions for user.
    
    Args:
        persona: User's persona
        context: Additional context
        limit: Maximum suggestions
        
    Returns:
        List of suggested questions
    """
    suggester = get_question_suggester()
    return suggester.get_suggestions(persona, context, limit)
