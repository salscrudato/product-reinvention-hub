"""
Conversation Memory Enhancer using LangChain Memory Modules
Solves the "context not retained" problem by tracking entities and conversation flow.

Author: SnowChat Team
Date: 2026-03-13
"""
import os
import logging
from typing import List, Dict, Any, Optional
from tinydb import TinyDB, Query
import warnings

logger = logging.getLogger("conversation_memory_enhancer")

# LangChain imports - using langchain 0.3.26+ structure
try:
    # Suppress deprecation warnings since memory classes still work
    warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")
    from langchain.memory import ConversationEntityMemory, ConversationSummaryMemory  # type: ignore
    from langchain_openai import AzureChatOpenAI
    LANGCHAIN_AVAILABLE = True
except ImportError as e:
    LANGCHAIN_AVAILABLE = False
    logger.warning(f"LangChain memory modules not available - using basic context: {e}")


class ConversationMemoryEnhancer:
    """
    Enhances conversation context using LangChain's memory modules.
    
    Features:
    - Entity tracking (incident numbers, keywords, topics)
    - Conversation summarization for token efficiency
    - Pronoun/reference resolution
    - Context injection for LLM prompts
    """
    
    def __init__(self, username: str, db_path: str = "state_db.json"):
        self.username = username
        self.db = TinyDB(db_path)
        self.chat_table = self.db.table("chat_history")
        
        # Initialize LangChain memory if available
        if LANGCHAIN_AVAILABLE:
            llm = AzureChatOpenAI(
                azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
                api_key=os.getenv("AZURE_OPENAI_API_KEY"),  # type: ignore
                api_version=os.getenv("OPENAI_API_VERSION"),
                azure_deployment=os.getenv("GPT_MODEL_NAME")
            )
            
            # Entity memory: tracks incidents, keywords, topics
            self.entity_memory = ConversationEntityMemory(
                llm=llm,
                return_messages=True,
                k=10  # Keep last 10 turns of entities
            )
            
            # Summary memory: compresses old conversations
            self.summary_memory = ConversationSummaryMemory(
                llm=llm,
                max_token_limit=800,
                return_messages=True
            )
            
            logger.info(f"[MemoryEnhancer] Initialized for {username} with LangChain modules")
        else:
            self.entity_memory = None
            self.summary_memory = None
            logger.warning(f"[MemoryEnhancer] Initialized for {username} WITHOUT LangChain (basic mode)")
    
    
    def load_conversation_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Load recent conversation history from TinyDB.
        
        Args:
            limit: Number of recent Q&A pairs to load
            
        Returns:
            List of conversation turns: [{"input": "Q1", "output": "A1"}, ...]
        """
        User = Query()
        messages = self.chat_table.search(User.username == self.username)
        
        # Sort by timestamp
        messages = sorted(messages, key=lambda x: x.get("timestamp", 0))
        
        # Build Q&A pairs
        qa_pairs = []
        i = 0
        while i < len(messages) - 1 and len(qa_pairs) < limit:
            if messages[i]["sender"] == "user" and i + 1 < len(messages):
                # Find next server response
                j = i + 1
                while j < len(messages) and messages[j]["sender"] != "server":
                    j += 1
                
                if j < len(messages):
                    user_text = messages[i].get("text", "")
                    server_msg = messages[j].get("text", {})
                    
                    # Extract final answer if text is dict
                    if isinstance(server_msg, dict):
                        server_text = server_msg.get("final_answer", str(server_msg))
                    else:
                        server_text = server_msg
                    
                    qa_pairs.append({
                        "input": user_text,
                        "output": server_text
                    })
                    i = j + 1
                else:
                    break
            else:
                i += 1
        
        return qa_pairs[-limit:] if qa_pairs else []
    
    
    def update_memory(self, question: str, answer: str, metadata: Optional[Dict[str, Any]] = None):
        """
        Update conversation memory with new Q&A pair.
        
        Args:
            question: User's question
            answer: System's answer
            metadata: Optional metadata (tool outputs, incident numbers, etc.)
        """
        if not LANGCHAIN_AVAILABLE:
            return
        
        # Save to entity memory (tracks entities like incident numbers)
        if self.entity_memory:
            try:
                self.entity_memory.save_context(
                    {"input": question},
                    {"output": answer}
                )
                logger.debug(f"[MemoryEnhancer] Entity memory updated")
            except Exception as e:
                logger.warning(f"[MemoryEnhancer] Entity memory update failed: {e}")
        
        # Save to summary memory (compresses old context)
        if self.summary_memory:
            try:
                self.summary_memory.save_context(
                    {"input": question},
                    {"output": answer}
                )
                logger.debug(f"[MemoryEnhancer] Summary memory updated")
            except Exception as e:
                logger.warning(f"[MemoryEnhancer] Summary memory update failed: {e}")
    
    
    def get_enriched_context(self, current_question: str) -> Dict[str, Any]:
        """
        Get enriched context for current question using LangChain memory.
        
        Args:
            current_question: The current user question
            
        Returns:
            Dict with:
            - entities: Tracked entities from conversation
            - summary: Conversation summary
            - context_messages: Formatted context for LLM prompt
        """
        enriched = {
            "entities": {},
            "summary": "",
            "context_messages": []
        }
        
        if not LANGCHAIN_AVAILABLE:
            # Fallback: load basic history
            qa_pairs = self.load_conversation_history(limit=5)
            enriched["context_messages"] = [
                {"role": "user", "content": qa["input"]} 
                for qa in qa_pairs
            ] + [
                {"role": "assistant", "content": qa["output"]} 
                for qa in qa_pairs
            ]
            return enriched
        
        # Get entity memory context
        if self.entity_memory:
            try:
                entity_vars = self.entity_memory.load_memory_variables(
                    {"input": current_question}
                )
                enriched["entities"] = entity_vars.get("entities", {})
                
                # Add entity context to messages
                if enriched["entities"]:
                    entity_text = self._format_entities_for_prompt(enriched["entities"])
                    enriched["context_messages"].insert(0, {
                        "role": "system",
                        "content": f"<tracked_entities>{entity_text}</tracked_entities>"
                    })
                
                logger.debug(f"[MemoryEnhancer] Loaded {len(enriched['entities'])} entities")
            except Exception as e:
                logger.warning(f"[MemoryEnhancer] Entity loading failed: {e}")
        
        # Get summary memory context
        if self.summary_memory:
            try:
                summary_vars = self.summary_memory.load_memory_variables({})
                enriched["summary"] = summary_vars.get("history", "")
                
                if enriched["summary"]:
                    enriched["context_messages"].insert(0, {
                        "role": "system",
                        "content": f"<conversation_summary>{enriched['summary']}</conversation_summary>"
                    })
                
                logger.debug(f"[MemoryEnhancer] Loaded conversation summary")
            except Exception as e:
                logger.warning(f"[MemoryEnhancer] Summary loading failed: {e}")
        
        return enriched
    
    
    def _format_entities_for_prompt(self, entities: Dict[str, Any]) -> str:
        """
        Format tracked entities for injection into LLM prompt.
        
        Args:
            entities: Entity dict from ConversationEntityMemory
            
        Returns:
            Formatted string for system prompt
        """
        parts = []
        for entity_name, entity_info in entities.items():
            if isinstance(entity_info, str):
                parts.append(f"- {entity_name}: {entity_info}")
            elif isinstance(entity_info, dict):
                desc = entity_info.get("description", entity_info.get("summary", ""))
                if desc:
                    parts.append(f"- {entity_name}: {desc}")
        
        return "\n".join(parts[:10])  # Limit to 10 entities to avoid bloat
    
    
    def clear_memory(self):
        """Clear all in-memory conversation state."""
        if self.entity_memory:
            try:
                self.entity_memory.clear()
            except Exception as e:
                logger.warning(f"[MemoryEnhancer] Entity memory clear failed: {e}")
        
        if self.summary_memory:
            try:
                self.summary_memory.clear()
            except Exception as e:
                logger.warning(f"[MemoryEnhancer] Summary memory clear failed: {e}")
        
        logger.info(f"[MemoryEnhancer] Memory cleared for {self.username}")


def enhance_question_with_context(
    question: str, 
    username: str, 
    metadata: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Convenience function to enhance a question with conversation context.
    
    Usage in agentic_orchestrator_auto.py:
        from components.conversation_memory_enhancer import enhance_question_with_context
        
        enhanced = enhance_question_with_context(question, username, metadata)
        metadata.update(enhanced)  # Adds entities, summary, context
    
    Args:
        question: Current user question
        username: User identifier
        metadata: Existing metadata dict (will be enriched)
        
    Returns:
        Enhanced metadata with conversation context
    """
    enhancer = ConversationMemoryEnhancer(username)
    
    # Load conversation history and populate memory
    qa_pairs = enhancer.load_conversation_history(limit=10)
    for qa in qa_pairs:
        enhancer.update_memory(qa["input"], qa["output"])
    
    # Get enriched context
    enriched = enhancer.get_enriched_context(question)
    
    # Merge with existing metadata
    return {
        "conversation_entities": enriched["entities"],
        "conversation_summary": enriched["summary"],
        "enhanced_context_messages": enriched["context_messages"]
    }


# ==================== EXAMPLE USAGE ====================

if __name__ == "__main__":
    # Test with your actual scenario
    enhancer = ConversationMemoryEnhancer(username="snow_admin")
    
    # Simulate the 3 Q&A pairs that failed
    enhancer.update_memory(
        "Find me the incidents related to PAS and NIGO",
        "Found 6 incidents: INC0010062 (Chronic care rider NIGO), INC0010007 (Banking Information NIGO), INC0010002, INC0010053, INC0010078, INC0010095"
    )
    
    enhancer.update_memory(
        "What is the Work around for Bank NIGO Incident?",
        "INC0010062: Remove chronic care rider XML blocks"  # WRONG
    )
    
    # Get context for third question
    context = enhancer.get_enriched_context(
        "This was not the Bank NIGO incident.....can you check again ?"
    )
    
    print(f"\n{'='*60}")
    print("TRACKED ENTITIES:")
    print(f"{'='*60}")
    for entity, info in context["entities"].items():
        print(f"{entity}: {info}")
    
    print(f"\n{'='*60}")
    print("CONVERSATION SUMMARY:")
    print(f"{'='*60}")
    print(context["summary"])
    
    print(f"\n{'='*60}")
    print("CONTEXT MESSAGES FOR LLM:")
    print(f"{'='*60}")
    for msg in context["context_messages"]:
        print(f"{msg['role']}: {msg['content'][:200]}...")
