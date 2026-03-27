"""Mapper Conversation History Storage

Stores conversation history for the Data Mapper Wizard using TinyDB.

Storage Structure:
- mapper_conversations table: All chat messages
- mapper_context_cache table: Cached entity contexts per conversation

Database: state_db.json (shared with SnowChat)
"""

import logging
import os
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from pathlib import Path

try:
    from tinydb import TinyDB, Query
    TINYDB_AVAILABLE = True
except ImportError:
    TINYDB_AVAILABLE = False
    logging.warning("TinyDB not available - conversation history will not be persisted")

logger = logging.getLogger("mapper_agentic_orchestrator.conversation_store")

# Database file (shared with SnowChat for unified storage)
DB_PATH = Path(__file__).resolve().parent.parent.parent / "state_db.json"

class MapperConversationStore:
    """Persistent storage for mapper conversations"""
    
    def __init__(self, db_path: Optional[str] = None):
        """Initialize conversation store
        
        Args:
            db_path: Optional custom database path (defaults to state_db.json)
        """
        if not TINYDB_AVAILABLE:
            logger.warning("[ConversationStore] TinyDB not available - using in-memory fallback")
            self.db = None
            self.conversations_table = None
            self.context_cache_table = None
            self._memory_store: List[Dict[str, Any]] = []
            return
        
        try:
            self.db_path = Path(db_path) if db_path else DB_PATH
            self.db = TinyDB(str(self.db_path))
            self.conversations_table = self.db.table('mapper_conversations')
            self.context_cache_table = self.db.table('mapper_context_cache')
            logger.info(f"[ConversationStore] Initialized with database: {self.db_path}")
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to initialize TinyDB: {e}")
            self.db = None
            self.conversations_table = None
            self.context_cache_table = None
            self._memory_store = []
    
    def store_message(
        self,
        conversation_id: str,
        project_id: str,
        username: str,
        role: str,
        message: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Store a conversation message
        
        Args:
            conversation_id: Unique conversation identifier
            project_id: Data mapper project ID
            username: User identifier
            role: Message role (user/assistant/system)
            message: Message content
            metadata: Optional metadata (entities_extracted, intent, etc.)
        
        Returns:
            True if stored successfully
        """
        try:
            record = {
                "conversation_id": conversation_id,
                "project_id": project_id,
                "username": username,
                "role": role,
                "message": message,
                "timestamp": datetime.utcnow().isoformat(),
                "metadata": metadata or {}
            }
            
            if self.conversations_table:
                self.conversations_table.insert(record)
            else:
                self._memory_store.append(record)
            
            logger.debug(f"[ConversationStore] Stored message for conversation {conversation_id}")
            return True
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to store message: {e}")
            return False
    
    def get_conversation_history(
        self,
        conversation_id: str,
        limit: int = 50,
        since_hours: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve conversation history
        
        Args:
            conversation_id: Conversation identifier
            limit: Maximum messages to return (most recent)
            since_hours: Only return messages from last N hours
        
        Returns:
            List of message records, sorted chronologically
        """
        try:
            if self.conversations_table:
                Conversation = Query()
                messages = self.conversations_table.search(
                    Conversation.conversation_id == conversation_id
                )
            else:
                messages = [
                    m for m in self._memory_store 
                    if m.get("conversation_id") == conversation_id
                ]
            
            # Filter by time if specified
            if since_hours:
                cutoff = datetime.utcnow() - timedelta(hours=since_hours)
                messages = [
                    m for m in messages
                    if datetime.fromisoformat(m.get("timestamp", "")) > cutoff
                ]
            
            # Sort chronologically and limit
            messages.sort(key=lambda x: x.get("timestamp", ""))
            # Ensure all items are dictionaries
            dict_messages = [m if isinstance(m, dict) else m.__dict__ for m in messages]
            return dict_messages[-limit:] if limit else dict_messages
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to retrieve history: {e}")
            return []
    
    def get_recent_entities(
        self,
        conversation_id: str,
        limit: int = 10
    ) -> List[str]:
        """Get recently extracted entity names from conversation
        
        Args:
            conversation_id: Conversation identifier
            limit: Maximum entities to return
        
        Returns:
            List of entity names (most recent first)
        """
        try:
            history = self.get_conversation_history(conversation_id, limit=20)
            entities = []
            
            # Extract entities from metadata in reverse chronological order
            for message in reversed(history):
                metadata = message.get("metadata", {})
                
                # Check various metadata formats
                if "entities_extracted" in metadata:
                    extracted = metadata["entities_extracted"]
                    if isinstance(extracted, list):
                        entities.extend(extracted)
                
                if "extracted_entity_names" in metadata:
                    extracted = metadata["extracted_entity_names"]
                    if isinstance(extracted, list):
                        entities.extend(extracted)
                
                # Stop if we have enough
                if len(entities) >= limit:
                    break
            
            # Remove duplicates while preserving order
            seen = set()
            unique_entities = []
            for entity in entities:
                if entity not in seen:
                    seen.add(entity)
                    unique_entities.append(entity)
            
            return unique_entities[:limit]
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to get recent entities: {e}")
            return []
    
    def store_context_cache(
        self,
        conversation_id: str,
        context_key: str,
        context_data: Dict[str, Any]
    ) -> bool:
        """Store cached context for conversation
        
        Args:
            conversation_id: Conversation identifier
            context_key: Context identifier (e.g., 'last_entities', 'project_docs')
            context_data: Context data to cache
        
        Returns:
            True if stored successfully
        """
        try:
            record = {
                "conversation_id": conversation_id,
                "context_key": context_key,
                "context_data": context_data,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            if self.context_cache_table:
                # Update or insert
                ContextCache = Query()
                self.context_cache_table.upsert(
                    record,
                    (ContextCache.conversation_id == conversation_id) &
                    (ContextCache.context_key == context_key)
                )
            
            logger.debug(f"[ConversationStore] Cached context {context_key} for {conversation_id}")
            return True
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to cache context: {e}")
            return False
    
    def get_context_cache(
        self,
        conversation_id: str,
        context_key: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve cached context
        
        Args:
            conversation_id: Conversation identifier
            context_key: Context identifier
        
        Returns:
            Cached context data, or None if not found
        """
        try:
            if not self.context_cache_table:
                return None
            
            ContextCache = Query()
            results = self.context_cache_table.search(
                (ContextCache.conversation_id == conversation_id) &
                (ContextCache.context_key == context_key)
            )
            
            if results:
                return results[0].get("context_data")
            
            return None
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to retrieve context cache: {e}")
            return None
    
    def get_conversation_summary(self, conversation_id: str) -> Dict[str, Any]:
        """Get summary statistics for a conversation
        
        Args:
            conversation_id: Conversation identifier
        
        Returns:
            Dict with summary stats (message_count, entities_extracted, etc.)
        """
        try:
            history = self.get_conversation_history(conversation_id)
            
            user_messages = [m for m in history if m.get("role") == "user"]
            assistant_messages = [m for m in history if m.get("role") == "assistant"]
            
            all_entities = self.get_recent_entities(conversation_id, limit=100)
            
            return {
                "conversation_id": conversation_id,
                "total_messages": len(history),
                "user_messages": len(user_messages),
                "assistant_messages": len(assistant_messages),
                "entities_extracted": len(all_entities),
                "entity_names": all_entities[:20],  # Sample
                "first_message_at": history[0].get("timestamp") if history else None,
                "last_message_at": history[-1].get("timestamp") if history else None
            }
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to get summary: {e}")
            return {"conversation_id": conversation_id, "error": str(e)}
    
    def cleanup_old_conversations(self, days: int = 30) -> int:
        """Delete conversations older than specified days
        
        Args:
            days: Delete conversations older than this many days
        
        Returns:
            Number of conversations deleted
        """
        try:
            if not self.conversations_table:
                return 0
            
            cutoff = datetime.utcnow() - timedelta(days=days)
            cutoff_str = cutoff.isoformat()
            
            Conversation = Query()
            deleted = self.conversations_table.remove(
                Conversation.timestamp < cutoff_str
            )
            
            logger.info(f"[ConversationStore] Cleaned up {len(deleted)} old conversations")
            return len(deleted)
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to cleanup: {e}")
            return 0
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete all messages for a conversation
        
        Args:
            conversation_id: Conversation to delete
        
        Returns:
            True if deleted successfully
        """
        try:
            if self.conversations_table:
                Conversation = Query()
                self.conversations_table.remove(
                    Conversation.conversation_id == conversation_id
                )
            else:
                self._memory_store = [
                    m for m in self._memory_store
                    if m.get("conversation_id") != conversation_id
                ]
            
            # Also delete cached context
            if self.context_cache_table:
                ContextCache = Query()
                self.context_cache_table.remove(
                    ContextCache.conversation_id == conversation_id
                )
            
            logger.info(f"[ConversationStore] Deleted conversation {conversation_id}")
            return True
            
        except Exception as e:
            logger.error(f"[ConversationStore] Failed to delete conversation: {e}")
            return False
    
    def close(self):
        """Close database connection"""
        if self.db:
            self.db.close()
            logger.info("[ConversationStore] Database closed")


# Global singleton instance
_global_store: Optional[MapperConversationStore] = None


def get_conversation_store() -> MapperConversationStore:
    """Get or create global conversation store instance"""
    global _global_store
    if _global_store is None:
        _global_store = MapperConversationStore()
    return _global_store


__all__ = [
    "MapperConversationStore",
    "get_conversation_store"
]
