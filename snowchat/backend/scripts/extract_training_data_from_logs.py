"""Extract training data from agentic_orchestrator_auto.log for ML model training.

Parses FLOW events to build structured datasets for:
- Intent classification
- Tool sequence prediction
- Follow-up detection
- Plan quality scoring

Usage:
    python scripts/extract_training_data_from_logs.py
    
Output:
    training_data_extracted.json - Full training dataset
"""

import re
import json
import sys
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Dict, List, Any, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class LogParser:
    """Parse agentic_orchestrator_auto.log into structured training data."""
    
    def __init__(self, log_path: str):
        self.log_path = log_path
        self.sessions = []
        self.raw_events = []
        
    def parse_line(self, line: str) -> Optional[Dict[str, Any]]:
        """Extract structured data from single log line."""
        # Extract timestamp
        timestamp_match = re.match(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
        if not timestamp_match:
            return None
        
        timestamp = datetime.strptime(timestamp_match.group(1), '%Y-%m-%d %H:%M:%S')
        
        # Parse FLOW[QUESTION]
        if 'FLOW[QUESTION]' in line:
            query = line.split('FLOW[QUESTION]')[1].strip()
            return {
                'type': 'question',
                'timestamp': timestamp,
                'query': query
            }
        
        # Parse FLOW[CLASSIFIED]
        if 'FLOW[CLASSIFIED]' in line:
            json_match = re.search(r'\{.*\}', line)
            if json_match:
                try:
                    metadata = json.loads(json_match.group(0))
                    return {
                        'type': 'classified',
                        'timestamp': timestamp,
                        'intent': metadata.get('intent', 'unknown'),
                        'persona': metadata.get('persona', 'unknown')
                    }
                except json.JSONDecodeError:
                    pass
        
        # Parse FLOW[PLAN_SUMMARY]
        if 'FLOW[PLAN_SUMMARY]' in line:
            plan_text = line.split('FLOW[PLAN_SUMMARY]')[1].strip()
            # Extract tool names: "1. fetch_incident(...); 2. get_similar(...)"
            tools = re.findall(r'\d+\.\s*(\w+)\(', plan_text)
            return {
                'type': 'plan',
                'timestamp': timestamp,
                'tools': tools,
                'plan_text': plan_text
            }
        
        # Parse FLOW[GRAPH_COMPLETE]
        if 'FLOW[GRAPH_COMPLETE]' in line or 'FLOW[SOLVE_COMPLETE]' in line:
            json_match = re.search(r'\{.*\}', line)
            if json_match:
                try:
                    results = json.loads(json_match.group(0))
                    return {
                        'type': 'execution',
                        'timestamp': timestamp,
                        'successes': results.get('successes', 0),
                        'failures': results.get('failures', 0),
                        'errors': results.get('errors', 0),
                        'plan_steps': results.get('plan_steps', 0)
                    }
                except json.JSONDecodeError:
                    pass
        
        # Parse FLOW[SHORTCUT]
        if 'FLOW[SHORTCUT]' in line:
            json_match = re.search(r'\{.*\}', line)
            shortcut_type = 'unknown'
            if 'Catalog prompt' in line:
                shortcut_type = 'catalog'
            elif 'Micro-intent' in line:
                shortcut_type = 'micro_intent'
            elif 'Assignment heuristic' in line:
                shortcut_type = 'assignment'
            elif 'Similarity' in line:
                shortcut_type = 'similarity'
            
            return {
                'type': 'shortcut',
                'timestamp': timestamp,
                'shortcut_type': shortcut_type
            }
        
        return None
    
    def parse_log_file(self) -> List[Dict[str, Any]]:
        """Parse entire log file and group into sessions."""
        print(f"Parsing log file: {self.log_path}")
        
        current_session = []
        last_timestamp = None
        session_timeout = 300  # 5 minutes
        
        with open(self.log_path, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                entry = self.parse_line(line)
                if not entry:
                    continue
                
                self.raw_events.append(entry)
                
                # Start new session if gap > 5 minutes or first event is question
                if last_timestamp:
                    gap = (entry['timestamp'] - last_timestamp).total_seconds()
                    if gap > session_timeout or entry['type'] == 'question':
                        if current_session and any(e['type'] == 'question' for e in current_session):
                            self.sessions.append(current_session)
                        current_session = []
                
                current_session.append(entry)
                last_timestamp = entry['timestamp']
        
        # Add final session
        if current_session and any(e['type'] == 'question' for e in current_session):
            self.sessions.append(current_session)
        
        print(f"Parsed {len(self.raw_events)} events into {len(self.sessions)} sessions")
        return self.sessions
    
    def build_training_dataset(self) -> List[Dict[str, Any]]:
        """Convert sessions into training examples."""
        training_data = []
        
        for session_idx, events in enumerate(self.sessions):
            # Find key events in session
            question = next((e for e in events if e['type'] == 'question'), None)
            classified = next((e for e in events if e['type'] == 'classified'), None)
            plan = next((e for e in events if e['type'] == 'plan'), None)
            execution = next((e for e in events if e['type'] == 'execution'), None)
            shortcut = next((e for e in events if e['type'] == 'shortcut'), None)
            
            if not question:
                continue
            
            query = question['query']
            
            # Extract features
            has_incident = bool(re.search(r'\bINC\d+', query, re.IGNORECASE))
            has_timeframe = bool(re.search(r'\b(today|yesterday|last\s+\d+\s+days?|this\s+week)', query, re.IGNORECASE))
            has_annotation = bool(re.search(r'@(wiki|code|checkpref)', query))
            has_aggregation = bool(re.search(r'\b(how many|count|total|sum|average)', query, re.IGNORECASE))
            has_vague_reference = bool(re.search(r'\b(this|that|these|those|it)\s+(incident|ticket)', query, re.IGNORECASE))
            query_length = len(query.split())
            
            # Build training example
            example = {
                'query': query,
                'intent': classified['intent'] if classified else 'unknown',
                'persona': classified['persona'] if classified else 'unknown',
                'tools_executed': plan['tools'] if plan else [],
                'plan_text': plan['plan_text'] if plan else '',
                'num_tools': len(plan['tools']) if plan else 0,
                'execution_successes': execution['successes'] if execution else None,
                'execution_failures': execution['failures'] if execution else None,
                'execution_errors': execution['errors'] if execution else None,
                'plan_quality_score': self._compute_plan_quality(execution) if execution else None,
                'used_shortcut': shortcut['shortcut_type'] if shortcut else None,
                'timestamp': question['timestamp'].isoformat(),
                'hour': question['timestamp'].hour,
                'day_of_week': question['timestamp'].strftime('%A'),
                'features': {
                    'has_incident': has_incident,
                    'has_timeframe': has_timeframe,
                    'has_annotation': has_annotation,
                    'has_aggregation': has_aggregation,
                    'has_vague_reference': has_vague_reference,
                    'query_length': query_length
                }
            }
            
            training_data.append(example)
        
        return training_data
    
    def _compute_plan_quality(self, execution: Dict[str, Any]) -> float:
        """Compute plan quality score based on execution results."""
        successes = execution.get('successes', 0)
        failures = execution.get('failures', 0)
        total = successes + failures
        
        if total == 0:
            return 0.0
        
        return successes / total
    
    def build_follow_up_dataset(self) -> List[Dict[str, Any]]:
        """Build dataset for follow-up question detection."""
        follow_up_data = []
        
        # Group sessions by time proximity (within 10 minutes = same conversation)
        conversations = []
        current_conversation = []
        last_time = None
        
        for session in self.sessions:
            question = next((e for e in session if e['type'] == 'question'), None)
            if not question:
                continue
            
            if last_time and (question['timestamp'] - last_time).total_seconds() > 600:
                if current_conversation:
                    conversations.append(current_conversation)
                current_conversation = []
            
            current_conversation.append({
                'query': question['query'],
                'timestamp': question['timestamp']
            })
            last_time = question['timestamp']
        
        if current_conversation:
            conversations.append(current_conversation)
        
        # Build follow-up examples
        for conv in conversations:
            if len(conv) < 2:
                continue
            
            for i in range(len(conv)):
                query = conv[i]['query']
                
                # Detect if this is a follow-up
                has_vague_reference = bool(re.search(
                    r'\b(this|that|these|those|it|them)\s+(incident|ticket|issue|story)',
                    query,
                    re.IGNORECASE
                ))
                has_followup_phrase = bool(re.search(
                    r'\b(i am referring|referring to|i meant|about that|about those)',
                    query,
                    re.IGNORECASE
                ))
                
                is_followup = has_vague_reference or has_followup_phrase
                
                # Extract previous context
                previous_queries = [conv[j]['query'] for j in range(max(0, i-3), i)]
                
                # Extract incident numbers from previous queries
                previous_incidents = []
                for prev_q in previous_queries:
                    incidents = re.findall(r'\bINC\d+', prev_q, re.IGNORECASE)
                    previous_incidents.extend(incidents)
                
                follow_up_data.append({
                    'query': query,
                    'is_followup': is_followup,
                    'previous_queries': previous_queries,
                    'previous_incidents': list(set(previous_incidents)),
                    'conversation_position': i,
                    'conversation_length': len(conv)
                })
        
        return follow_up_data


def main():
    """Main execution."""
    log_path = Path(__file__).parent.parent / 'agentic_orchestrator_auto.log'
    output_path = Path(__file__).parent.parent / 'training_data_extracted.json'
    followup_path = Path(__file__).parent.parent / 'followup_training_data.json'
    
    if not log_path.exists():
        print(f"ERROR: Log file not found: {log_path}")
        sys.exit(1)
    
    parser = LogParser(str(log_path))
    parser.parse_log_file()
    
    # Build main training dataset
    training_data = parser.build_training_dataset()
    print(f"\nExtracted {len(training_data)} training examples")
    
    # Build follow-up dataset
    followup_data = parser.build_follow_up_dataset()
    print(f"Extracted {len(followup_data)} follow-up examples")
    
    # Merge with existing datasets for incremental training
    existing_training_data = []
    if output_path.exists():
        try:
            with open(output_path, 'r', encoding='utf-8') as f:
                existing_training_data = json.load(f) or []
        except Exception as e:
            print(f"WARNING: Failed to load existing training data: {e}")

    existing_followup_data = []
    if followup_path.exists():
        try:
            with open(followup_path, 'r', encoding='utf-8') as f:
                existing_followup_data = json.load(f) or []
        except Exception as e:
            print(f"WARNING: Failed to load existing follow-up data: {e}")

    def _training_key(ex: Dict[str, Any]) -> str:
        return "|".join([
            ex.get('timestamp', ''),
            ex.get('query', ''),
            ex.get('intent', ''),
            ex.get('persona', '')
        ])

    def _followup_key(ex: Dict[str, Any]) -> str:
        prev = "||".join(ex.get('previous_queries', []) or [])
        prev_inc = "||".join(ex.get('previous_incidents', []) or [])
        return "|".join([
            ex.get('query', ''),
            prev,
            prev_inc,
            str(ex.get('conversation_position', '')),
            str(ex.get('conversation_length', ''))
        ])

    existing_training_map = { _training_key(ex): ex for ex in existing_training_data }
    for ex in training_data:
        existing_training_map[_training_key(ex)] = ex
    merged_training_data = list(existing_training_map.values())

    existing_followup_map = { _followup_key(ex): ex for ex in existing_followup_data }
    for ex in followup_data:
        existing_followup_map[_followup_key(ex)] = ex
    merged_followup_data = list(existing_followup_map.values())

    # Save datasets
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(merged_training_data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved training data to: {output_path}")
    print(f"Training data size: {len(existing_training_data)} -> {len(merged_training_data)}")
    
    with open(followup_path, 'w', encoding='utf-8') as f:
        json.dump(merged_followup_data, f, indent=2, ensure_ascii=False)
    print(f"Saved follow-up data to: {followup_path}")
    print(f"Follow-up data size: {len(existing_followup_data)} -> {len(merged_followup_data)}")
    
    # Print statistics
    print("\n" + "="*60)
    print("DATASET STATISTICS")
    print("="*60)
    
    intents = {}
    personas = {}
    for ex in merged_training_data:
        intent = ex['intent']
        persona = ex['persona']
        intents[intent] = intents.get(intent, 0) + 1
        personas[persona] = personas.get(persona, 0) + 1
    
    print(f"\nIntent Distribution:")
    for intent, count in sorted(intents.items(), key=lambda x: -x[1]):
        print(f"  {intent:30s}: {count:4d} examples")
    
    print(f"\nPersona Distribution:")
    for persona, count in sorted(personas.items(), key=lambda x: -x[1]):
        print(f"  {persona:30s}: {count:4d} examples")
    
    # Tool execution stats
    total_tools = sum(ex['num_tools'] for ex in merged_training_data if ex['num_tools'])
    avg_tools = total_tools / len(merged_training_data) if merged_training_data else 0
    print(f"\nPlan Statistics:")
    print(f"  Average tools per query: {avg_tools:.2f}")
    
    successful_plans = [ex for ex in merged_training_data if ex['plan_quality_score'] == 1.0]
    print(f"  Perfect plans (100% success): {len(successful_plans)} ({len(successful_plans)/len(merged_training_data)*100:.1f}%)")
    
    # Follow-up stats
    followup_count = sum(1 for ex in merged_followup_data if ex['is_followup'])
    print(f"\nFollow-up Detection:")
    print(f"  Follow-up queries: {followup_count}/{len(merged_followup_data)} ({followup_count/len(merged_followup_data)*100:.1f}%)")


if __name__ == '__main__':
    main()
