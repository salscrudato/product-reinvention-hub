# Chat History Persistence - Frontend Integration Guide

**Date:** 2025-02-27  
**Status:** ✅ Backend Complete, Frontend Integration Required  

## Overview

The backend now returns **previous chat messages** (questions and responses) when a user logs in, enabling conversation continuity across sessions. This guide provides step-by-step instructions for integrating this feature into the React frontend.

---

## Backend Changes Summary

### 1. New Function: `get_recent_chat_messages()`

**File:** `backend/components/user_context_manager.py`

**Purpose:** Retrieves recent chat messages from TinyDB `chat_history` table

**API:**
```python
from components.user_context_manager import get_recent_chat_messages

messages = get_recent_chat_messages(username="john.doe", limit=20)
# Returns:
# [
#   {"sender": "user", "text": "What is INC0001?", "timestamp": 1709050800},
#   {"sender": "server", "text": "INC0001 is...", "timestamp": 1709050805},
#   ...
# ]
```

### 2. Enhanced Session Init Endpoint

**Endpoint:** `POST /api/agentic/session/init`

**Enhancement:** Now returns both session context AND recent chat messages

**Request:**
```json
{
  "user_id": "john.doe",
  "question": "",
  "metadata": {},
  "chat_history_limit": 20  // Optional: defaults to 20
}
```

**Response (Enhanced):**
```json
{
  "user_id": "john.doe",
  "persona": "analyst",
  "greeting": "Welcome back, Analyst!",
  "preamble": "...",
  "style": "...",
  "output_format": "...",
  
  // NEW: Session context summary
  "session_context": {
    "has_context": true,
    "summary": "Recent incidents: INC0036400, INC0058418 | Recent topics: pattern_analysis | ...",
    "incident_count": 13,
    "topic_count": 3,
    "turn_count": 15,
    "last_activity": "2025-02-27T10:45:00"
  },
  
  // NEW: Previous chat messages
  "chat_history": [
    {
      "sender": "user",
      "text": "What are the patterns in these 50 incidents?",
      "timestamp": 1709050800
    },
    {
      "sender": "server",
      "text": "Found 5 pattern categories: Config Changes (40%), User Error (20%), ...",
      "timestamp": 1709050825,
      "function_sequence": ["analyze_bulk_work_notes"],
      "feedback_payload": {...}
    },
    ...
  ]
}
```

---

## Frontend Integration Steps

### Step 1: Update Session Init API Call

**File:** `frontend/src/SnowChat.jsx` (or wherever session init happens)

**Current Code (Example):**
```javascript
// Existing - session init call
const initSession = async () => {
  const response = await axios.post('http://localhost:5000/api/agentic/session/init', {
    user_id: loginUsername,
    persona: 'analyst'
  }, { headers: authHeaders() });
  
  // Use persona, greeting, etc.
  const { persona, greeting } = response.data;
};
```

**Enhanced Code:**
```javascript
// STEP 1: Update session init to receive chat history
const initSession = async () => {
  const response = await axios.post('http://localhost:5000/api/agentic/session/init', {
    user_id: loginUsername,
    persona: 'analyst',
    chat_history_limit: 20  // Optional: how many messages to load
  }, { headers: authHeaders() });
  
  const { persona, greeting, session_context, chat_history } = response.data;
  
  // STEP 2: Display session context summary (optional)
  if (session_context && session_context.has_context) {
    console.log('[SessionInit] Loaded context:', session_context.summary);
    // Optional: Show banner: "Resuming session: 13 incidents discussed, last active 5m ago"
  }
  
  // STEP 3: Load chat history into state
  if (chat_history && chat_history.length > 0) {
    // Parse messages for display
    const parsedHistory = chat_history.map(msg => {
      if (msg.sender === 'server' && typeof msg.text === 'object') {
        return {
          ...msg,
          text: msg.text.final_answer || msg.text.response || JSON.stringify(msg.text)
        };
      }
      return msg;
    });
    
    // Set chat history state
    setChatHistory(parsedHistory);
    console.log('[SessionInit] Loaded', parsedHistory.length, 'previous messages');
  }
};
```

### Step 2: Modify `fetchChatHistory()` to Use Session Init

**Current Implementation:**
```javascript
// Existing - separate call to /chat_history
useEffect(() => {
  const fetchChatHistory = async () => {
    const response = await axios.get('http://localhost:5000/chat_history', { 
      params: { username: loginUsername }, 
      headers: authHeaders() 
    });
    const parsedHistory = (response.data.chat_history || []).map(...);
    setChatHistory(parsedHistory);
  };
  fetchChatHistory();
}, []);
```

**Enhanced Implementation (Two Options):**

#### Option A: Use Session Init Response (Recommended)
```javascript
// OPTION A: Get chat history from session init
// No separate fetchChatHistory call needed - already handled in initSession()
useEffect(() => {
  initSession();  // This now loads both persona AND chat history
}, []);
```

#### Option B: Keep Both (Fallback)
```javascript
// OPTION B: Try session init first, fallback to separate endpoint
useEffect(() => {
  const loadSession = async () => {
    try {
      // Try session init (returns chat history)
      const sessionResponse = await axios.post('http://localhost:5000/api/agentic/session/init', {
        user_id: loginUsername,
        chat_history_limit: 20
      }, { headers: authHeaders() });
      
      if (sessionResponse.data.chat_history && sessionResponse.data.chat_history.length > 0) {
        // Use chat history from session init
        setChatHistory(sessionResponse.data.chat_history);
        console.log('[SessionInit] Loaded chat history from session init');
      } else {
        // Fallback: Load from separate endpoint
        await fetchChatHistory();
      }
    } catch (error) {
      console.error('[SessionInit] Failed, falling back to /chat_history:', error);
      await fetchChatHistory();
    }
  };
  
  loadSession();
}, []);
```

### Step 3: Display Session Context Banner (Optional Enhancement)

Add a banner to show users their session is being resumed:

```javascript
// In component state
const [sessionContextBanner, setSessionContextBanner] = useState(null);

// In initSession():
if (session_context && session_context.has_context) {
  const banner = {
    message: `Resuming session: ${session_context.incident_count} incidents discussed`,
    lastActive: session_context.last_activity,
    turnCount: session_context.turn_count
  };
  setSessionContextBanner(banner);
  
  // Auto-hide after 5 seconds
  setTimeout(() => setSessionContextBanner(null), 5000);
}

// In render:
{sessionContextBanner && (
  <Box sx={{ 
    bgcolor: 'info.light', 
    p: 1, 
    mb: 2, 
    borderRadius: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  }}>
    <Typography variant="body2">
      {sessionContextBanner.message} • Last active: {formatTimestamp(sessionContextBanner.lastActive)}
    </Typography>
    <IconButton size="small" onClick={() => setSessionContextBanner(null)}>
      <Close fontSize="small" />
    </IconButton>
  </Box>
)}
```

### Step 4: Handle Empty Chat History (First-Time Users)

```javascript
// After loading chat history
if (!chatHistory || chatHistory.length === 0) {
  // First-time user or no previous messages
  setChatHistory([
    {
      sender: 'server',
      text: `Hello ${loginUsername}! How can I help you today?`,
      timestamp: Date.now()
    }
  ]);
  console.log('[SessionInit] No previous messages, showing welcome message');
}
```

---

## Complete Example: Enhanced SnowChat.jsx

```javascript
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { getKeycloakInstance } from './keycloak';

function SnowChat({ user }) {
  const [chatHistory, setChatHistory] = useState([]);
  const [sessionContext, setSessionContext] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const loginUsername = user?.preferred_username || user?.name || 'unknown';
  
  const authHeaders = () => {
    try {
      const kc = getKeycloakInstance();
      if (kc && kc.token) return { Authorization: `Bearer ${kc.token}` };
    } catch (_) {}
    return {};
  };

  // Initialize session and load chat history
  useEffect(() => {
    const initSession = async () => {
      try {
        setLoading(true);
        
        // Call session init endpoint
        const response = await axios.post('http://localhost:5000/api/agentic/session/init', {
          user_id: loginUsername,
          chat_history_limit: 20
        }, { headers: authHeaders() });
        
        const { persona, greeting, session_context, chat_history } = response.data;
        
        // Store session context
        if (session_context) {
          setSessionContext(session_context);
          console.log('[SessionInit] Context loaded:', session_context.summary);
        }
        
        // Load chat history
        if (chat_history && chat_history.length > 0) {
          const parsed = chat_history.map(msg => {
            // Handle server messages with object text
            if (msg.sender === 'server' && typeof msg.text === 'object') {
              return {
                ...msg,
                text: msg.text.final_answer || msg.text.response || JSON.stringify(msg.text)
              };
            }
            return msg;
          });
          
          setChatHistory(parsed);
          console.log('[SessionInit] Loaded', parsed.length, 'previous messages');
        } else {
          // First-time user - show welcome message
          setChatHistory([{
            sender: 'server',
            text: greeting || `Hello ${loginUsername}! How can I help you today?`,
            timestamp: Date.now()
          }]);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('[SessionInit] Failed:', error);
        
        // Fallback: Try separate chat_history endpoint
        try {
          const historyResponse = await axios.get('http://localhost:5000/chat_history', {
            params: { username: loginUsername },
            headers: authHeaders()
          });
          
          const parsed = (historyResponse.data.chat_history || []).map(msg => {
            if (msg.sender === 'server' && typeof msg.text === 'object') {
              return {
                ...msg,
                text: msg.text.final_answer || JSON.stringify(msg.text)
              };
            }
            return msg;
          });
          
          setChatHistory(parsed);
          console.log('[SessionInit] Loaded', parsed.length, 'messages via fallback');
        } catch (fallbackError) {
          console.error('[SessionInit] Fallback failed:', fallbackError);
          // Show default welcome message
          setChatHistory([{
            sender: 'server',
            text: `Hello ${loginUsername}! How can I help you today?`,
            timestamp: Date.now()
          }]);
        }
        
        setLoading(false);
      }
    };
    
    initSession();
  }, [loginUsername]);

  // Rest of component (handleSendMessage, etc.)
  // ...
}

export default SnowChat;
```

---

## Testing Frontend Integration

### Test Case 1: First-Time User (No Chat History)

**Steps:**
1. Clear state_db.json or use new username
2. Login to SnowChat
3. Verify:
   - Welcome message displayed
   - No previous messages loaded
   - `session_context.has_context` is `false`

**Expected Console Logs:**
```
[SessionInit] No previous messages, showing welcome message
```

### Test Case 2: Returning User (With Chat History)

**Steps:**
1. Login as existing user who has previous conversations
2. Verify:
   - Previous messages displayed in chat
   - Chat scrolls to bottom (most recent)
   - Session context banner shows (if implemented)
   - `session_context.has_context` is `true`

**Expected Console Logs:**
```
[SessionInit] Context loaded: Recent incidents: INC0036400, INC0058418 | Recent topics: pattern_analysis | ...
[SessionInit] Loaded 15 previous messages
```

**Expected Chat Display:**
```
[System Banner] Resuming session: 13 incidents discussed • Last active: 5m ago [X]

[Previous messages loaded from database]
User: What are the patterns in these 50 incidents?
Bot: Found 5 pattern categories: Config Changes (40%), ...

User: Which incidents have documentation gaps?
Bot: 13 incidents have doc gaps: INC0036400, INC0058418, ...

[New messages can be sent]
```

### Test Case 3: Network Error Fallback

**Steps:**
1. Mock session init endpoint to fail
2. Verify:
   - System attempts fallback to `/chat_history` endpoint
   - If both fail, shows default welcome message
   - No crash, graceful degradation

**Expected Console Logs:**
```
[SessionInit] Failed: Error: Network Error
[SessionInit] Loaded 15 messages via fallback
```

### Test Case 4: Chat History Limit

**Steps:**
1. Create user with 50 messages in database
2. Login with `chat_history_limit: 10`
3. Verify:
   - Only last 10 messages loaded
   - Most recent messages shown

**API Call:**
```javascript
await axios.post('http://localhost:5000/api/agentic/session/init', {
  user_id: loginUsername,
  chat_history_limit: 10  // Override default 20
});
```

---

## Configuration

### Backend Environment Variables

```bash
# Enable user context persistence (includes chat history retrieval)
export ENABLE_USER_CONTEXT_PERSISTENCE=1  # Default: enabled

# Default chat history limit (can be overridden via API param)
# MAX_CHAT_HISTORY_LIMIT=20  # Configurable in future
```

### Frontend Configuration

```javascript
// In SnowChat.jsx or config file
const CHAT_HISTORY_LIMIT = 20;  // How many messages to load on init
const SESSION_BANNER_TIMEOUT = 5000;  // Auto-hide banner after 5 seconds
const ENABLE_SESSION_BANNER = true;  // Show session context banner
```

---

## API Reference

### Session Init Endpoint (Enhanced)

**Endpoint:** `POST /api/agentic/session/init`

**Request Body:**
```typescript
interface SessionInitRequest {
  user_id: string;           // Username/email
  question?: string;         // Optional initial question
  metadata?: object;         // Optional metadata
  chat_history_limit?: number;  // Optional: defaults to 20
}
```

**Response:**
```typescript
interface SessionInitResponse {
  user_id: string;
  persona: string;
  source: string;
  greeting: string;
  preamble: string;
  style: string;
  output_format: string;
  
  // Session context
  session_context: {
    has_context: boolean;
    summary: string;
    incident_count: number;
    topic_count: number;
    turn_count: number;
    last_activity: string;  // ISO timestamp
  };
  
  // Chat history
  chat_history: Array<{
    sender: 'user' | 'server';
    text: string;
    timestamp: number;
    function_sequence?: string[];
    feedback_payload?: object;
  }>;
}
```

### Legacy Chat History Endpoint (Still Available)

**Endpoint:** `GET /chat_history`

**Query Parameters:**
- `username` (required): Filter messages by username

**Response:**
```json
{
  "chat_history": [
    {"sender": "user", "text": "...", "username": "john.doe", "timestamp": 1709050800},
    {"sender": "server", "text": "...", "username": "john.doe", "timestamp": 1709050805}
  ]
}
```

**Note:** Frontend should prefer session init endpoint for better performance (one call instead of two).

---

## Migration Path

### Phase 1: Backend Complete ✅
- ✅ `get_recent_chat_messages()` function added
- ✅ Session init enhanced to return chat history
- ✅ Backward compatible (legacy `/chat_history` endpoint still works)

### Phase 2: Frontend Integration (REQUIRED)
- 📋 Update session init API call to receive chat history
- 📋 Load chat history into state from session response
- 📋 Remove separate `/chat_history` call (or keep as fallback)
- 📋 Add session context banner (optional)
- 📋 Test with existing users and new users

### Phase 3: Enhancement (OPTIONAL)
- 📋 Add "Load more messages" button (pagination)
- 📋 Add "Clear history" button
- 📋 Show loading skeleton while fetching history
- 📋 Implement infinite scroll for long histories

---

## Troubleshooting

### Issue: Chat history not loading

**Symptom:** Frontend shows welcome message but user has previous conversations

**Diagnosis:**
1. Check browser console for errors
2. Check backend logs: `[SessionInit] Loaded X chat messages`
3. Verify TinyDB has messages: `cat state_db.json | jq '.chat_history'`

**Solutions:**
- Ensure username matches between frontend and backend
- Check `ENABLE_USER_CONTEXT_PERSISTENCE=1` is set
- Verify session init API call includes `user_id`

### Issue: Duplicate messages appearing

**Symptom:** Messages appear twice in chat

**Cause:** Both session init AND separate `/chat_history` call loading messages

**Solution:** Remove redundant `fetchChatHistory()` call:
```javascript
// BEFORE (WRONG - loads twice)
useEffect(() => {
  initSession();      // Loads chat history
  fetchChatHistory(); // Loads AGAIN
}, []);

// AFTER (CORRECT - loads once)
useEffect(() => {
  initSession();  // Only this call needed
}, []);
```

### Issue: Old messages from wrong user

**Symptom:** User sees messages from different user

**Cause:** TinyDB not filtering by username correctly

**Solution:** Verify username is passed correctly:
```javascript
// Ensure username is from Keycloak
const loginUsername = user?.preferred_username || user?.name;
console.log('[SessionInit] Username:', loginUsername);
```

---

## Summary

✅ **Backend Complete** - Session init returns chat history  
📋 **Frontend Integration Required** - Update SnowChat.jsx to use new response  
⚡ **Performance Gain** - One API call instead of two  
🔄 **Backward Compatible** - Legacy endpoint still works  
🎯 **User Experience** - Conversation continuity across sessions  

**Next Steps:**
1. Update `SnowChat.jsx` session init call
2. Load chat history from response
3. Test with existing/new users
4. Deploy and monitor

This completes the end-to-end implementation for chat history persistence across user sessions!
