# Context & Memory Management Analysis

## Issue Summary

User observed that when asking "**what are the incidents related to APS requirements?**", the system:
1. ❌ Did NOT use prior conversation context effectively
2. ❌ Should have triggered `get_similar_incidents` with the user's natural language query
3. ✅ Instead triggered `incident_triage` intent which fetched INC0010007 from prior context, but then searched for "APS requierments" (user's typo) literally

## Root Cause Analysis

### 1. **Intent Classification Mismatch**
**Current Behavior:**
```python
# intent_classifier.py - Line 10
KEYWORD_PATTERNS = [
    (r"similar incidents?|find (?:related|similar) incident", 'similar_incidents'),
    ...
]
```

**Problem:** Query "what are the incidents **related to** APS requirements" contains "related to" but the regex requires "related incident" (singular) or "similar incident". The pattern **doesn't match questions like:**
- "incidents related to X"
- "incidents about Y"  
- "incidents for Z"

**Result:** Classified as `incident_triage` instead of `similar_incidents`

---

### 2. **Recipe Execution Without Context Awareness**

**Log Evidence:**
```json
{
  "intent": "incident_triage",
  "plan": [
    {"function_name": "fetch_servicenow_incident", "arguments": {"incident_number": "INC0010007"}},
    {"function_name": "get_similar_incidents", "arguments": {"short_description": "APS requierments"}}
  ]
}
```

**What Happened:**
1. Recipe for `incident_triage` executed: `[fetch_servicenow_incident, get_similar_incidents, fetch_kb_articles]`
2. `_args_incident()` extracted `INC0010007` from **compressed conversation history**
3. Used user's literal query text "APS requierments" for similarity search
4. ❌ **Lost semantic meaning** - searching for typo "requierments" instead of understanding user wants incidents about "APS requirements"

**Compressed Context from Logs:**
```
"<compressed_recent_dialogue>
...
INC0010003: 90981330 and 90993157---APSs received from UMR
...
INC0010007: \"Intervention Needed - 01889974 Joe Sup\"
</compressed_recent_dialogue>"
```

**Problem:** The system saw "APS" mentioned in INC0010003's short description but didn't make the semantic connection.

---

### 3. **Missing Short-Term Memory & Context Tracking**

**Current Architecture:**
```python
# agentic_orchestrator_auto.py - Line 23
ENABLE_CONTEXT_SUMMARY: rolling summary compression of older context.
ENABLE_CHAT_SUMMARIES: inject compressed prior chat summaries.
ENABLE_CONTEXT_MESSAGES_SUMMARY: compress recent dialogue messages into one system message.
```

**What's Missing:**
1. ❌ **No semantic entity tracking** across conversation turns
2. ❌ **No coreference resolution** ("APS requirements" → mentions in previous incidents)
3. ❌ **No conversation state machine** to track:
   - Last discussed incident(s)
   - Topics/entities mentioned
   - User's current focus
4. ❌ **Compression loses semantic links** - "APS" in INC0010003 description gets compressed away

---

## LangChain Memory Solutions

### **What LangChain Provides:**

#### 1. **ConversationBufferMemory**
```python
from langchain.memory import ConversationBufferMemory

memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True,
    output_key="output"
)
```
**Use Case:** Keep full conversation history for semantic lookups

#### 2. **ConversationSummaryMemory**
```python
from langchain.memory import ConversationSummaryMemory

memory = ConversationSummaryMemory(
    llm=llm,
    memory_key="history",
    return_messages=True
)
```
**Use Case:** Intelligently summarize while preserving key entities/topics

#### 3. **ConversationEntityMemory**
```python
from langchain.memory import ConversationEntityMemory

memory = ConversationEntityMemory(
    llm=llm,
    entity_extraction_prompt=...,  # Extract: incidents, topics, requirements
    entity_summarization_prompt=... # Track relationships
)
```
**Use Case:** Track entities like "APS", "INC0010003", "requirements" across turns

#### 4. **ConversationKGMemory** (Knowledge Graph)
```python
from langchain.memory import ConversationKGMemory

memory = ConversationKGMemory(
    llm=llm,
    memory_key="knowledge_graph"
)
```
**Use Case:** Build relationships: "INC0010003" ↔ "APS" ↔ "requirements"

#### 5. **VectorStoreRetrieverMemory**
```python
from langchain.memory import VectorStoreRetrieverMemory
from langchain.vectorstores import FAISS

memory = VectorStoreRetrieverMemory(
    retriever=FAISS.from_texts([], embedding).as_retriever(search_kwargs=dict(k=5))
)
```
**Use Case:** Semantic search over conversation history

---

## Recommended Fixes

### **Immediate (Low-Hanging Fruit)**

#### Fix 1: Improve Intent Classification Pattern
```python
# intent_classifier.py - Update pattern
KEYWORD_PATTERNS = [
    # OLD: (r"similar incidents?|find (?:related|similar) incident", 'similar_incidents'),
    # NEW: Catch "related to", "about", "for", etc.
    (r"(?:similar|related|about|regarding|for) (?:incidents?|issues?)|find.*(?:similar|related)", 'similar_incidents'),
    ...
]
```

#### Fix 2: Add Semantic Query Extraction
```python
# plan_recipes.py - Enhance _args_incident
def _args_incident_semantic(question: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract semantic meaning from user query, not just incident numbers"""
    
    # If user asks "incidents related to X", extract X
    match = re.search(r"incidents? (?:related to|about|regarding|for) (.+?)(?:\?|$)", question, re.I)
    if match:
        topic = match.group(1).strip()
        return {'short_description': topic}
    
    # Fallback to existing logic
    return _args_incident(question, metadata)
```

#### Fix 3: Add Context-Aware Argument Extraction
```python
def _args_with_context(question: str, metadata: Dict[str, Any], context_messages: List[Dict]) -> Dict[str, Any]:
    """Use LLM to extract arguments considering conversation context"""
    
    from .llm_interface import call_llm
    
    prompt = f"""
    Based on this conversation history:
    {json.dumps(context_messages[-5:], indent=2)}
    
    User asks: "{question}"
    
    Extract the best search query for finding related ServiceNow incidents.
    Return JSON: {{"search_query": "...", "reasoning": "..."}}
    """
    
    result = call_llm(prompt, response_format={"type": "json_object"})
    return {'short_description': json.loads(result)['search_query']}
```

---

### **Medium-Term (Architecture Changes)**

#### Enhancement 1: Add ConversationEntityMemory
```python
# agentic_orchestrator_auto.py - In solve() method
from langchain.memory import ConversationEntityMemory

class AgenticOrchestratorAuto:
    def __init__(self):
        self.entity_memory = ConversationEntityMemory(
            llm=self.llm,
            k=10  # Track last 10 entities
        )
    
    def solve(self, question, context_messages, metadata):
        # Extract entities from conversation
        entities = self.entity_memory.load_memory_variables({"input": question})
        
        # Inject entities into metadata for recipe arg functions
        metadata['entities'] = entities
        
        # After execution, save new entities
        self.entity_memory.save_context(
            {"input": question},
            {"output": final_answer}
        )
```

#### Enhancement 2: Semantic Context Retrieval
```python
# New file: components/context_retriever.py
from langchain.vectorstores import FAISS
from langchain.embeddings import OpenAIEmbeddings

class ConversationContextRetriever:
    def __init__(self):
        self.vectorstore = FAISS.from_texts([], OpenAIEmbeddings())
        self.conversation_history = []
    
    def add_turn(self, question: str, answer: str, incident_refs: List[str]):
        """Add conversation turn with incident references"""
        doc = f"Q: {question}\nA: {answer}\nIncidents: {', '.join(incident_refs)}"
        self.vectorstore.add_texts([doc])
        self.conversation_history.append({
            "question": question,
            "answer": answer,
            "incidents": incident_refs
        })
    
    def retrieve_relevant_context(self, query: str, k: int = 3) -> List[Dict]:
        """Retrieve semantically relevant past turns"""
        docs = self.vectorstore.similarity_search(query, k=k)
        return [self.parse_doc(doc) for doc in docs]
```

#### Enhancement 3: Intent Re-Routing Based on Context
```python
# intent_classifier.py - Add context-aware classification
def classify_with_context(question: str, context_messages: List[Dict], 
                         entities: Dict[str, Any]) -> Tuple[str, float]:
    """
    If user's question references previous topics/entities,
    upgrade intent classification confidence
    """
    
    base_intent, base_confidence = classify_intent(question)
    
    # Check if question references prior entities
    if entities:
        for entity_type, entity_values in entities.items():
            if any(val.lower() in question.lower() for val in entity_values):
                # User is asking about something from prior context
                # Boost "similar_incidents" intent
                if "related" in question.lower() or "about" in question.lower():
                    return "similar_incidents", 0.95
    
    return base_intent, base_confidence
```

---

### **Long-Term (Full LangChain Integration)**

#### Option 1: LangChain Agent with Memory
```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain.memory import ConversationEntityMemory
from langchain.prompts import MessagesPlaceholder

agent = create_openai_functions_agent(
    llm=llm,
    tools=servicenow_tools,
    prompt=ChatPromptTemplate.from_messages([
        ("system", "You are a ServiceNow assistant..."),
        MessagesPlaceholder(variable_name="chat_history"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
        ("human", "{input}")
    ])
)

memory = ConversationEntityMemory(
    llm=llm,
    memory_key="chat_history",
    return_messages=True
)

agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    memory=memory,
    verbose=True
)
```

#### Option 2: LangGraph with Persistent Memory State
```python
from langgraph.graph import StateGraph
from langgraph.checkpoint.memory import MemorySaver

class ConversationState(TypedDict):
    messages: List[BaseMessage]
    entities: Dict[str, List[str]]
    incident_context: Dict[str, Any]
    last_query_embedding: List[float]

workflow = StateGraph(ConversationState)
workflow.add_node("classify_intent", classify_with_memory)
workflow.add_node("retrieve_context", retrieve_semantic_context)
workflow.add_node("execute_tools", execute_with_context)

# Persistent checkpoints
memory = MemorySaver()
app = workflow.compile(checkpointer=memory)
```

---

## Implementation Priority

### **Phase 1 (This Week)**
1. ✅ Fix intent classification regex patterns
2. ✅ Add semantic query extraction to `_args_incident`
3. ✅ Test with "incidents related to X" queries

### **Phase 2 (Next Sprint)**
1. 🔧 Integrate `ConversationEntityMemory` for entity tracking
2. 🔧 Add context-aware intent re-routing
3. 🔧 Build `ConversationContextRetriever` for semantic lookups

### **Phase 3 (Future)**
1. 🚀 Full LangChain Agent with memory integration
2. 🚀 Replace recipe system with memory-aware planning
3. 🚀 Add LangGraph persistent conversation state

---

## Test Cases

### Test 1: Context-Aware Similarity Search
```
User: "what are the incidents opened today?"
Bot: [Returns INC0010001-INC0010013 including INC0010003 mentioning "APSs received from UMR"]

User: "what are the incidents related to APS requirements?"
Expected Intent: similar_incidents
Expected Args: {"short_description": "APS requirements"} 
Expected Result: INC0010003 (semantic match) + similar incidents from FAISS
```

### Test 2: Entity Memory Tracking
```
User: "show me INC0010007"
Bot: [Shows incident]
Entities Tracked: {"incidents": ["INC0010007"], "topics": ["Joe Sup", "ePolicy"]}

User: "are there similar incidents?"
Expected: Should search for incidents similar to INC0010007 (using tracked entity)
```

### Test 3: Typo Tolerance
```
User: "incidents related to APS requierments?"
Expected: System should:
1. Extract "APS requierments" 
2. Use embedding similarity (typo-tolerant) not exact string match
3. Return incidents with "APS requirements", "APS", "Application Processing Service"
```

---

## Summary

**Current State:**
- ❌ Intent classification too narrow (regex-based)
- ❌ Recipe args use literal query text, not semantic understanding
- ❌ Compression loses entity/topic relationships
- ❌ No conversation state tracking

**LangChain Provides:**
- ✅ `ConversationEntityMemory` - Track entities across turns
- ✅ `VectorStoreRetrieverMemory` - Semantic conversation search  
- ✅ `ConversationKGMemory` - Build knowledge graphs of relationships
- ✅ Agent memory injection - Automatic context propagation

**Recommendation:** Start with **Phase 1** (regex + semantic extraction) for immediate improvement, then progressively adopt LangChain memory components in Phases 2-3.
