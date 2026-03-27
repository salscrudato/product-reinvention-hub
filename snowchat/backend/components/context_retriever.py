"""Semantic Context Retriever for Conversation History (Phase 2+)

Provides FAISS-based semantic search over conversation history to maintain
context across turns and enable entity tracking.

Enhanced with:
- Smart tool inference from vague queries using entity history
- Conversation summarization with key fact preservation
- Proactive context injection for relevant past information
- Memory persistence across sessions via TinyDB
"""

import logging
import json
import os
from typing import List, Dict, Any, Optional
import numpy as np
from datetime import datetime

try:
    from tinydb import TinyDB, Query
    TINYDB_AVAILABLE = True
except ImportError:
    TINYDB_AVAILABLE = False
    logging.warning("[context_retriever] TinyDB not available, memory persistence disabled")

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    logging.warning("[context_retriever] FAISS not available, context retrieval disabled")

logger = logging.getLogger("agentic_orchestrator_auto.context_retriever")


class ConversationContextRetriever:
    """Maintains semantic vector index of conversation history
    
    Each conversation turn (question + answer + incident references) is embedded
    and stored in FAISS for similarity-based retrieval.
    """
    
    def __init__(self, embedding_dim: int = 1536, session_id: Optional[str] = None, 
                 memory_db_path: str = "conversation_memory.json"):
        """Initialize with embedding dimension (default 1536 for OpenAI ada-002)
        
        Args:
            embedding_dim: Dimension of embeddings (1536 for OpenAI ada-002)
            session_id: Optional session ID for multi-session tracking
            memory_db_path: Path to TinyDB file for persistent memory
        """
        self.embedding_dim = embedding_dim
        self.session_id = session_id or f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.conversation_history: List[Dict[str, Any]] = []
        self.embeddings: List[np.ndarray] = []
        
        # Initialize FAISS index
        if FAISS_AVAILABLE:
            self.index = faiss.IndexFlatL2(embedding_dim)
        else:
            self.index = None
        
        # Initialize persistent memory database
        self.memory_db_path = memory_db_path
        if TINYDB_AVAILABLE and memory_db_path:
            try:
                self.memory_db = TinyDB(memory_db_path)
                self.memory_table = self.memory_db.table('conversation_memory')
                self._load_session_from_db()
            except Exception as e:
                logger.warning(f"[context_retriever] Failed to initialize TinyDB: {e}")
                self.memory_db = None
                self.memory_table = None
        else:
            self.memory_db = None
            self.memory_table = None
            
        logger.info(f"[context_retriever] Initialized session={self.session_id}, dim={embedding_dim}, FAISS={'available' if FAISS_AVAILABLE else 'unavailable'}, DB={'available' if self.memory_db else 'unavailable'}")
    
    def add_turn(self, question: str, answer: str, incident_refs: List[str], 
                 metadata: Optional[Dict[str, Any]] = None):
        """Add a conversation turn to the index
        
        Args:
            question: User's question
            answer: System's answer
            incident_refs: List of incident numbers mentioned (e.g., ["INC0010001"])
            metadata: Optional metadata (intent, persona, etc.)
        """
        turn = {
            "question": question,
            "answer": answer[:500],  # Truncate long answers
            "incidents": incident_refs,
            "metadata": metadata or {},
            "turn_index": len(self.conversation_history),
            "timestamp": datetime.now().isoformat()
        }
        
        self.conversation_history.append(turn)
        
        # Create text representation for embedding
        text = self._format_turn_for_embedding(turn)
        
        # Generate embedding (will be done externally and added)
        logger.debug(f"[context_retriever] Added turn {turn['turn_index']}: Q={question[:50]}...")
        
        # Persist to database if available
        self._save_session_to_db()
        
    def add_embedding(self, embedding: np.ndarray):
        """Add embedding vector for the last added turn
        
        Args:
            embedding: 1D numpy array of shape (embedding_dim,)
        """
        if not FAISS_AVAILABLE or self.index is None:
            return
            
        if embedding.shape[0] != self.embedding_dim:
            logger.error(f"[context_retriever] Embedding dimension mismatch: expected {self.embedding_dim}, got {embedding.shape[0]}")
            return
            
        # FAISS expects 2D array (n_samples, dim)
        embedding_2d = embedding.reshape(1, -1).astype('float32')
        self.index.add(x=embedding_2d)  # type: ignore[call-arg]
        self.embeddings.append(embedding)
        
        logger.debug(f"[context_retriever] Added embedding for turn {len(self.embeddings)-1}, index size={self.index.ntotal}")
    
    def retrieve_relevant_context(self, query_embedding: np.ndarray, k: int = 3) -> List[Dict[str, Any]]:
        """Retrieve semantically relevant past turns
        
        Args:
            query_embedding: Embedding of current query
            k: Number of most relevant turns to retrieve
            
        Returns:
            List of conversation turns with similarity scores
        """
        if not FAISS_AVAILABLE or self.index is None or self.index.ntotal == 0:
            logger.debug("[context_retriever] No index available, returning recent history")
            return self.conversation_history[-k:] if self.conversation_history else []
        
        # Search FAISS index
        query_2d = query_embedding.reshape(1, -1).astype('float32')
        k_actual = min(k, self.index.ntotal)
        distances, indices = self.index.search(x=query_2d, k=k_actual)  # type: ignore[call-arg]
        
        # Build results with similarity scores
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < len(self.conversation_history):
                turn = self.conversation_history[idx].copy()
                turn['similarity_score'] = float(1.0 / (1.0 + dist))  # Convert distance to similarity
                turn['distance'] = float(dist)
                results.append(turn)
        
        logger.info(f"[context_retriever] Retrieved {len(results)} relevant turns for query")
        return results
    
    def extract_entities(self, window: int = 5, current_question: str | None = None) -> Dict[str, List[str]]:
        """Extract entities from recent conversation turns
        
        Args:
            window: Number of recent turns to consider
            current_question: Current user question to prioritize for entity extraction
            
        Returns:
            Dictionary of entity types to entity values
        """
        entities: Dict[str, List[str]] = {
            "incidents": [],
            "topics": [],
            "keywords": [],
            "jira_issues": []  # New: Track JIRA issue keys
        }
        
        # CONTEXT SWITCH DETECTION: Check if current question switches from ServiceNow to JIRA
        # Patterns: "user story IN-4", "JIRA issue PROJ-123", "story IN-4"
        jira_context_detected = False
        
        # PRIORITY: Extract incidents and JIRA issues from current question FIRST
        # This ensures "How was INC0010001 resolved?" correctly identifies INC0010001
        # instead of carrying over stale context (e.g., INC0010014 from previous queries)
        if current_question:
            import re
            
            # Check for JIRA context signals
            jira_signals = re.search(r'\b(user\s+stor(?:y|ies)|jira\s+(?:issue|ticket|story)|epic|sprint)\b', current_question, re.IGNORECASE)
            if jira_signals:
                jira_context_detected = True
                logger.debug(f"[context_retriever] JIRA context detected in question: {jira_signals.group(1)}")
            
            # Extract JIRA issue keys (IN-4, PROJ-123, etc.)
            jira_pattern = re.compile(r'\b([A-Z]{2,10}-\d+)\b')
            jira_issues = jira_pattern.findall(current_question)
            if jira_issues:
                logger.debug(f"[context_retriever] Found JIRA issue keys in current question: {jira_issues}")
                entities["jira_issues"].extend(jira_issues)
                jira_context_detected = True
            
            # Extract ServiceNow incidents only if NOT in JIRA context
            if not jira_context_detected:
                incident_pattern = re.compile(r"\b(INC0\d+)\b", re.IGNORECASE)
                current_incidents = [m.upper() for m in incident_pattern.findall(current_question)]
                if current_incidents:
                    logger.debug(f"[context_retriever] Found explicit incidents in current question: {current_incidents}")
                    entities["incidents"].extend(current_incidents)
            
            # Extract keywords from current question
            for pattern in [r"about (.+?)(?:\?|$)", r"related to (.+?)(?:\?|$)", r"regarding (.+?)(?:\?|$)"]:
                match = re.search(pattern, current_question, re.IGNORECASE)
                if match:
                    topic = match.group(1).strip()[:50]
                    entities["keywords"].append(topic)
        
        # Then add entities from conversation history ONLY IF NOT context switch
        # If current question is about JIRA, don't pollute with ServiceNow incidents
        if not jira_context_detected:
            recent_turns = self.conversation_history[-window:] if self.conversation_history else []
            
            for turn in recent_turns:
                # Extract incident numbers from historical turns
                incidents = turn.get("incidents", [])
                entities["incidents"].extend(incidents)
                
                # Extract topics from metadata
                metadata = turn.get("metadata", {})
                if "intent" in metadata:
                    entities["topics"].append(metadata["intent"])
                
                # Extract key phrases from questions (simple extraction)
                question = turn.get("question", "")
                # Look for "about X", "related to X", etc.
                import re
                for pattern in [r"about (.+?)(?:\?|$)", r"related to (.+?)(?:\?|$)", r"regarding (.+?)(?:\?|$)"]:
                    match = re.search(pattern, question, re.IGNORECASE)
                    if match:
                        topic = match.group(1).strip()[:50]
                        entities["keywords"].append(topic)
        else:
            logger.info(f"[context_retriever] CONTEXT SWITCH: Skipping ServiceNow history due to JIRA context in current question")
        
        # Deduplicate while preserving order (current question incidents come first)
        for key in entities:
            seen = set()
            unique = []
            for item in entities[key]:
                if item not in seen:
                    seen.add(item)
                    unique.append(item)
            entities[key] = unique
        
        logger.debug(f"[context_retriever] Extracted entities from {len(self.conversation_history[-window:]) if self.conversation_history else 0} turns + current question: {json.dumps(entities)}")
        return entities
    
    def get_recent_incidents(self, n: int = 10) -> List[str]:
        """Get most recently mentioned incident numbers
        
        Args:
            n: Number of recent incidents to return
            
        Returns:
            List of incident numbers in reverse chronological order
        """
        incidents = []
        for turn in reversed(self.conversation_history):
            incidents.extend(turn.get("incidents", []))
            if len(incidents) >= n:
                break
        
        # Deduplicate while preserving order
        seen = set()
        result = []
        for inc in incidents:
            if inc not in seen:
                seen.add(inc)
                result.append(inc)
        
        return result[:n]
    
    def infer_context_from_vague_query(self, question: str) -> Dict[str, Any]:
        """Infer missing context from vague queries using entity history
        
        When user asks vague questions like "what's the status?", "update it",
        "add a work note", use recent entity history to infer what they mean.
        
        Args:
            question: User's vague question
            
        Returns:
            Inferred context with incident_number, likely_intent, confidence
        """
        # Vague query patterns that need context inference
        vague_patterns = [
            'what\'s the status', 'check status', 'status update',
            'update it', 'update this', 'update that',
            'add a note', 'add work note', 'add comment',
            'close it', 'resolve it', 'fix it',
            'what happened', 'tell me more', 'explain',
            'what\'s next', 'next steps'
        ]
        
        question_lower = question.lower()
        is_vague = any(pattern in question_lower for pattern in vague_patterns)
        
        if not is_vague:
            return {'is_vague': False, 'confidence': 0.0}
        
        # Extract recent entities
        entities = self.extract_entities(window=3)  # Last 3 turns
        incidents = entities.get('incidents', [])
        topics = entities.get('topics', [])
        
        # Infer incident from most recent
        incident_number = incidents[0] if incidents else None
        
        # Infer intent from question pattern
        likely_intent = None
        if any(w in question_lower for w in ['status', 'check', 'how']):
            likely_intent = 'incident_triage'
        elif any(w in question_lower for w in ['update', 'change', 'modify']):
            likely_intent = 'update_incident'
        elif any(w in question_lower for w in ['note', 'comment', 'add']):
            likely_intent = 'add_work_note'
        elif any(w in question_lower for w in ['close', 'resolve', 'fix']):
            likely_intent = 'resolve_incident'
        
        confidence = 0.8 if incident_number and likely_intent else 0.5
        
        logger.info(f"[context_retriever] Inferred context: incident={incident_number}, intent={likely_intent}, confidence={confidence}")
        
        return {
            'is_vague': True,
            'incident_number': incident_number,
            'likely_intent': likely_intent,
            'recent_topics': topics[:3],
            'confidence': confidence
        }
    
    def generate_conversation_summary(self, max_length: int = 500) -> str:
        """Generate concise summary of conversation preserving key facts
        
        Extracts:
        - Incidents discussed
        - Key decisions made
        - Actions taken
        - Unresolved questions
        
        Args:
            max_length: Maximum character length of summary
            
        Returns:
            Concise summary string
        """
        if not self.conversation_history:
            return "No conversation history."
        
        # Extract key facts
        entities = self.extract_entities(window=10)
        incidents = entities.get('incidents', [])
        topics = entities.get('topics', [])
        
        # Build summary sections
        summary_parts = []
        
        if incidents:
            summary_parts.append(f"Discussed incidents: {', '.join(incidents[:5])}")
        
        if topics:
            summary_parts.append(f"Topics: {', '.join(topics[:5])}")
        
        # Extract last user question and system response
        if len(self.conversation_history) >= 1:
            last_turn = self.conversation_history[-1]
            last_q = last_turn.get('question', '')[:100]
            summary_parts.append(f"Latest: {last_q}...")
        
        summary = " | ".join(summary_parts)
        
        # Truncate if needed
        if len(summary) > max_length:
            summary = summary[:max_length-3] + "..."
        
        logger.debug(f"[context_retriever] Generated summary: {summary[:100]}...")
        return summary
    
    def get_proactive_context(self, current_question: str, k: int = 2) -> List[Dict[str, Any]]:
        """Get proactive context relevant to current question
        
        Automatically retrieves past conversations that might be relevant
        without explicit user request.
        
        Args:
            current_question: Current user question
            k: Number of relevant past turns to retrieve
            
        Returns:
            List of relevant past conversation turns
        """
        if not self.conversation_history or not FAISS_AVAILABLE or not self.index:
            return []
        
        try:
            # Generate embedding for current question
            from .servicenowgenaitool import generate_embeddings
            query_embedding = generate_embeddings([current_question])
            
            if not query_embedding or len(query_embedding) == 0:
                return []
            
            query_vector = np.array(query_embedding[0], dtype='float32').reshape(1, -1)
            
            # Search FAISS index
            k_search = min(k, len(self.conversation_history))
            distances, indices = self.index.search(x=query_vector, k=k_search)  # type: ignore[call-arg]
            
            relevant_turns = []
            for idx in indices[0]:
                if 0 <= idx < len(self.conversation_history):
                    turn = self.conversation_history[idx]
                    relevant_turns.append({
                        'question': turn.get('question', ''),
                        'answer': turn.get('answer', '')[:200] + '...',  # Truncate
                        'incidents': turn.get('incident_refs', []),
                        'timestamp': turn.get('timestamp')
                    })
            
            logger.info(f"[context_retriever] Retrieved {len(relevant_turns)} proactive context turns")
            return relevant_turns
            
        except Exception as e:
            logger.warning(f"[context_retriever] Proactive context retrieval failed: {e}")
            return []
    
    def _save_session_to_db(self):
        """Persist current session to TinyDB"""
        if not self.memory_table:
            return
        
        try:
            Session = Query()
            # Update or insert session
            self.memory_table.upsert({
                'session_id': self.session_id,
                'conversation_history': self.conversation_history,
                'last_updated': datetime.now().isoformat()
            }, Session.session_id == self.session_id)
            
            logger.debug(f"[context_retriever] Saved session {self.session_id} to DB")
        except Exception as e:
            logger.warning(f"[context_retriever] Failed to save session: {e}")
    
    def _load_session_from_db(self):
        """Load session from TinyDB if exists"""
        if not self.memory_table:
            return
        
        try:
            Session = Query()
            session_data = self.memory_table.get(Session.session_id == self.session_id)
            
            if session_data and isinstance(session_data, dict):
                self.conversation_history = session_data.get('conversation_history', [])
                logger.info(f"[context_retriever] Loaded session {self.session_id} with {len(self.conversation_history)} turns")
                
                # Rebuild FAISS index from history
                if FAISS_AVAILABLE and self.index and self.conversation_history:
                    try:
                        from .servicenowgenaitool import generate_embeddings
                        questions = [turn.get('question', '') for turn in self.conversation_history]
                        embeddings = generate_embeddings(questions)
                        
                        if embeddings:
                            for emb in embeddings:
                                vector = np.array(emb, dtype='float32').reshape(1, -1)
                                self.index.add(x=vector)  # type: ignore[call-arg]
                                self.embeddings.append(np.array(emb, dtype='float32'))  # type: ignore[arg-type]
                            
                            logger.info(f"[context_retriever] Rebuilt FAISS index with {len(embeddings)} vectors")
                    except Exception as e:
                        logger.warning(f"[context_retriever] Failed to rebuild FAISS index: {e}")
        except Exception as e:
            logger.warning(f"[context_retriever] Failed to load session: {e}")
    
    def _format_turn_for_embedding(self, turn: Dict[str, Any]) -> str:
        """Format turn for embedding generation
        
        Creates a text representation that captures the semantic content
        of the conversation turn including question, answer, and incident context.
        """
        parts = [
            f"Question: {turn['question']}",
            f"Answer: {turn['answer']}",
        ]
        
        if turn['incidents']:
            parts.append(f"Incidents: {', '.join(turn['incidents'])}")
        
        return "\n".join(parts)
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary statistics about the context retriever
        
        Returns:
            Dictionary with statistics
        """
        return {
            "total_turns": len(self.conversation_history),
            "indexed_embeddings": self.index.ntotal if FAISS_AVAILABLE and self.index else 0,
            "recent_incidents": self.get_recent_incidents(5),
            "entities": self.extract_entities(window=5)
        }


# Global instance (singleton pattern)
_global_retriever: Optional[ConversationContextRetriever] = None


def get_retriever() -> ConversationContextRetriever:
    """Get global context retriever instance (singleton)"""
    global _global_retriever
    if _global_retriever is None:
        _global_retriever = ConversationContextRetriever()
    return _global_retriever


def reset_retriever():
    """Reset global retriever (useful for testing)"""
    global _global_retriever
    _global_retriever = None
    logger.info("[context_retriever] Global retriever reset")
