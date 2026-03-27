import React, { useState, useEffect, useRef } from 'react';
import ConversationTimeline from './ConversationTimeline';
import HistoryIcon from '@mui/icons-material/History';
import FeedbackAnalytics from './FeedbackAnalytics';
import FeedbackAnalyticsIcon from './FeedbackAnalyticsIcon';
import QuestionHelper from './QuestionHelper';
import { Box, TextField, Button, Typography, Paper, List, ListItem, ListItemText, IconButton, Collapse, Divider, Chip } from '@mui/material';
import { ThumbUp, ThumbDown, Close } from '@mui/icons-material';
import axios from 'axios';
import { getKeycloakInstance } from './keycloak';
import { annotationCommands } from './annotationCommands';
import './SnowChat.css';
import TokenUsageTab from './TokenUsageTab';

function DevCopilot(props) {
  const { user } = props;
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [likedQuestions, setLikedQuestions] = useState({});
  const [annotationDropdown, setAnnotationDropdown] = useState(false);
  const [annotationFilter, setAnnotationFilter] = useState('');
  const [caretPos, setCaretPos] = useState(0);
  const inputRef = useRef();
  const chatContentRef = useRef(); // Add ref for chat content auto-scroll
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [persona, setPersona] = useState(null);
  const [personaGreeting, setPersonaGreeting] = useState(null);
  const [personaStyle, setPersonaStyle] = useState(null);
  const [personaOutputFormat, setPersonaOutputFormat] = useState([]);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const [tokenAggregate, setTokenAggregate] = useState(null);
  const [activeWikiClarificationStateId, setActiveWikiClarificationStateId] = useState(null);
  const [sessionContextBanner, setSessionContextBanner] = useState(null);

  // Define safeUser and loginUsername BEFORE any hooks that reference them to avoid TDZ runtime errors.
  const safeUser = user || { id: 'unknown', name: 'Unknown', session_id: 'unknown' };
  const loginUsername = safeUser.preferred_username || safeUser.name || safeUser.id;

  // Auto-scroll to bottom when chat history changes
  useEffect(() => {
    if (chatContentRef.current) {
      chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    let interval;
    const poll = async () => {
      try {
        const resp = await axios.get(`http://127.0.0.1:5000/token_metrics?username=${encodeURIComponent(loginUsername)}`);
        if (resp.data && resp.data.enabled) {
          setTokenAggregate(resp.data.aggregate);
        }
      } catch (_) { /* swallow */ }
    };
    poll();
    interval = setInterval(poll, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [loginUsername]);

  const authHeaders = () => {
    try {
      const kc = getKeycloakInstance();
      if (kc && kc.token) {
        return { Authorization: `Bearer ${kc.token}` };
      }
    } catch (_) {}
    return {};
  };

  // Initialize session and load chat history in one call
  useEffect(() => {
    if (!loginUsername) {
      console.warn('[DevCopilot] Skipping session init - loginUsername not available');
      return;
    }
    
    const initSession = async () => {
      try {
        console.info('[DevCopilot] Starting session init for', loginUsername);
        // Enhanced session init now returns both persona AND chat history
        const resp = await axios.post('http://localhost:5000/session/init', {
          user_id: loginUsername,
          metadata: {},
          chat_history_limit: 20  // Load last 20 messages
        }, { headers: authHeaders() });
        
        const data = resp.data;
        console.info('[DevCopilot] Session init response', data);
        
        // Set persona data
        setPersona(data.persona);
        setPersonaGreeting(data.greeting);
        setPersonaStyle(data.style);
        setPersonaOutputFormat(data.output_format || []);
        
        // Process session context if available
        if (data.session_context && data.session_context.has_context) {
          console.info('[DevCopilot] Restored session context:', data.session_context.summary);
          // Show banner for 8 seconds
          setSessionContextBanner({
            message: `Resuming session: ${data.session_context.incident_count || 0} incidents discussed`,
            lastActive: data.session_context.last_activity,
            turnCount: data.session_context.turn_count || 0
          });
          setTimeout(() => setSessionContextBanner(null), 8000);
        }
        
        // Load chat history from session init response
        if (data.chat_history && data.chat_history.length > 0) {
          // Parse messages (backend already does most parsing, but double-check)
          const parsedHistory = data.chat_history.map((chat) => {
            if (chat.sender === 'server' && typeof chat.text === 'object' && chat.text !== null) {
              let answer = chat.text.final_answer || chat.text.response || JSON.stringify(chat.text);
              return {
                ...chat,
                text: answer,
                function_sequence: chat.function_sequence || null,
                feedback_payload: chat.feedback_payload || null,
              };
            }
            return chat;
          });
          console.info('[DevCopilot] Loaded', parsedHistory.length, 'previous messages from session init');
          setChatHistory(parsedHistory);
        } else {
          // First-time user or no previous messages - show greeting
          console.info('[DevCopilot] No previous messages, showing greeting');
          const greetingMessage = {
            sender: 'server',
            text: data.greeting || `Hi, I'm your ${data.persona || 'DevCopilot'} — ready to help!`,
            question: null,
            function_sequence: null,
            feedback_payload: null,
          };
          console.info('[DevCopilot] Setting greeting message:', greetingMessage);
          setChatHistory([greetingMessage]);
          // Wait for next tick to verify state was set
          setTimeout(() => {
            console.info('[DevCopilot] Chat history after setting greeting - length:', chatHistory.length);
          }, 100);
        }
      } catch (e) {
        console.warn('[DevCopilot] session/init failed (using default greeting):', e.message);
        // Show default greeting without fallback (session/init is the primary endpoint)
        if (safeUser.preferred_username) {
          setChatHistory([
            {
              sender: 'server',
              text: `Hello ${safeUser.preferred_username}!`,
              question: null,
              function_sequence: null,
              feedback_payload: null,
            },
          ]);
        }
      }
    };
    
    initSession();
  }, [loginUsername]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    
    console.log('[DevCopilot] ═══════════ SEND MESSAGE START ═══════════');
    console.log('[DevCopilot] Message:', message);
    console.log('[DevCopilot] Username:', loginUsername);
    console.log('[DevCopilot] Current chat history length:', chatHistory.length);
    
    setChatHistory((prevHistory) => {
      const newHistory = [...prevHistory, { sender: 'user', text: message }];
      console.log('[DevCopilot] Updated chat history length:', newHistory.length);
      return newHistory;
    });
    setLoading(true);
    let response;
    let usedAgentic = false;
    try {
      console.log('[DevCopilot] Preparing request to /agentic_orchestrate_auto');
      console.log('[DevCopilot] Backend URL: http://localhost:5000/agentic_orchestrate_auto');
      console.log('[DevCopilot] Request payload:', {
        messages_count: chatHistory.length + 1,
        username: loginUsername,
        persona: persona,
        message_preview: message.substring(0, 100)
      });
      // Build metadata with wiki clarification state if active
      const requestMetadata = { persona };
      if (activeWikiClarificationStateId) {
        requestMetadata.wiki_clarification_state_id = activeWikiClarificationStateId;
        console.log('[DevCopilot] Including wiki_clarification_state_id in request:', activeWikiClarificationStateId);
      }

      response = await axios.post('http://localhost:5000/agentic_orchestrate_auto', {
        messages: chatHistory.map(chat => ({
          role: chat.sender === 'user' ? 'user' : 'assistant',
          content: typeof chat.text === 'string' ? chat.text : JSON.stringify(chat.text),
        })).concat([{ role: 'user', content: message }]),
        prompt: `You are an intelligent assistant for ServiceNow incident management. Persona: ${persona || 'unknown'}. Style: ${personaStyle || ''}. Output sections: ${(personaOutputFormat||[]).join(', ')}`,
        metadata: requestMetadata,
        username: loginUsername,
        agent_type: "plan_and_execute"
      }, { 
        headers: authHeaders(),
        timeout: 60000  // 60 second timeout
      });
      console.debug('[DevCopilot] Sent orchestrate_auto metadata/persona', { persona, personaStyle, personaOutputFormat });
      usedAgentic = true;
      console.log('[DevCopilot] ✅ Response received from backend');
      console.log('[DevCopilot] Response data keys:', Object.keys(response.data));
      console.log('[DevCopilot] Response has final_answer:', !!response.data.final_answer);
      console.log('[DevCopilot] Received response:', response.data);
    } catch (error) {
      console.error('[DevCopilot] ❌ Error during agentic_orchestrate_auto request');
      console.error('[DevCopilot] Error type:', error.name);
      console.error('[DevCopilot] Error message:', error.message);
      if (error.response) {
        console.error('[DevCopilot] Response status:', error.response.status);
        console.error('[DevCopilot] Response data:', error.response.data);
      } else if (error.request) {
        console.error('[DevCopilot] No response received from backend');
        console.error('[DevCopilot] Request was:', error.request);
      } else {
        console.error('[DevCopilot] Error setting up request:', error.message);
      }
      console.error('[DevCopilot] Full error:', error);
      
      try {
        console.log('[DevCopilot] Attempting fallback to /orchestrate endpoint');
        console.log('[DevCopilot] Fallback request:', {
          question: message,
          user: safeUser
        });
        response = await axios.post('http://localhost:5000/orchestrate', {
          question: message,
          prompt: "You are an intelligent assistant for ServiceNow incident management.",
          username: loginUsername
        }, { headers: authHeaders() });
        usedAgentic = false;
        console.log('[DevCopilot] ✅ Response received from fallback endpoint');
        console.log('[DevCopilot] Response data:', response.data);
      } catch (legacyError) {
        console.error('[DevCopilot] ❌ Error during fallback orchestrate request');
        console.error('[DevCopilot] Fallback error:', legacyError);
        console.error('[DevCopilot] Both primary and fallback endpoints failed');
        setChatHistory((prevHistory) => {
          const errorHistory = [
            ...prevHistory,
            { sender: 'server', text: "An error occurred while processing your request." },
          ];
          console.log('[DevCopilot] Added error message to chat, new length:', errorHistory.length);
          return errorHistory;
        });
        setLoading(false);
        setMessage('');
        console.log('[DevCopilot] ═══════════ SEND MESSAGE END (ERROR) ═══════════');
        return;
      }
    }
    if (response.data && response.data.error) {
      setChatHistory((prevHistory) => [
        ...prevHistory,
        {
          sender: 'server',
          text: `System error: ${response.data.error}\n${response.data.traceback || ''}`,
          question: message,
          function_sequence: null,
          feedback_payload: null,
        },
      ]);
      setLoading(false);
      setMessage('');
      return;
    }
    let answer = "No response from server.";
    let function_sequence = null;
    let feedback_payload = null;
    
    console.log('[DevCopilot] Processing response...');
    console.log('[DevCopilot] usedAgentic:', usedAgentic);
    
    if (usedAgentic && response.data && response.data.final_answer) {
      answer = response.data.final_answer;
      console.log('[DevCopilot] Using final_answer from response');
    } else if (usedAgentic && response.data && response.data.agent_result) {
      if (typeof response.data.agent_result === 'object' && response.data.agent_result !== null && response.data.agent_result.final_answer) {
        answer = response.data.agent_result.final_answer;
      } else {
        answer = response.data.agent_result;
      }
      function_sequence = response.data.plan || null;
      feedback_payload = response.data.plan_results || null;
    } else if (usedAgentic && response.data && response.data.results) {
      answer = JSON.stringify(response.data.results);
      function_sequence = response.data.plan || null;
      feedback_payload = response.data.results || null;
    } else if (!usedAgentic && response.data && response.data.response) {
      if (typeof response.data.response === 'object' && response.data.response !== null) {
        answer = response.data.response.final_answer || "No response from server.";
        function_sequence = response.data.response.function_sequence || null;
        feedback_payload = response.data.response.feedback_payload || null;
      } else {
        answer = response.data.response;
      }
    }
    if (response.data.function_sequence) function_sequence = response.data.function_sequence;
    if (response.data.feedback_payload) feedback_payload = response.data.feedback_payload;

    // Extract suggested questions from response
    const suggested_questions = response.data.suggested_questions || [];
    if (suggested_questions.length > 0) {
      console.log('[DevCopilot] Received suggested questions:', suggested_questions);
    }

    // Extract wiki clarification state ID from response metadata
    if (response.data.metadata && response.data.metadata.awaiting_wiki_clarification) {
      const stateId = response.data.metadata.wiki_clarification_state_id;
      setActiveWikiClarificationStateId(stateId);
      console.log('[DevCopilot] Wiki clarification active, state_id:', stateId);
    } else {
      // Clear state ID after clarification is resolved
      if (activeWikiClarificationStateId) {
        console.log('[DevCopilot] Wiki clarification resolved, clearing state_id');
        setActiveWikiClarificationStateId(null);
      }
    }

    console.log('[DevCopilot] Adding server response to chat history');
    console.log('[DevCopilot] Answer length:', answer.length);
    console.log('[DevCopilot] Answer preview:', answer.substring(0, 200));
    
    setChatHistory((prevHistory) => {
      const newHistory = [
        ...prevHistory,
        {
          sender: 'server',
          text: answer,
          id: response.data.id,
          question: message,
          function_sequence: function_sequence,
          feedback_payload: feedback_payload,
          suggested_questions: suggested_questions,
        },
      ];
      console.log('[DevCopilot] Updated chat history with server response, new length:', newHistory.length);
      return newHistory;
    });
    setLoading(false);
    setMessage('');
    console.log('[DevCopilot] ═══════════ SEND MESSAGE END (SUCCESS) ═══════════');
  };

  const handleLike = async (question, function_sequence) => {
    try {
      await axios.post("http://localhost:5000/function_sequence_feedback", {
  user_id: safeUser.sub || loginUsername,
  username: loginUsername,
        question,
        liked: true,
        function_sequence,
      }, { baseURL: undefined });
      setLikedQuestions((prev) => ({ ...prev, [question]: true }));
    } catch (err) {
      alert("Failed to record feedback");
    }
  };

  const handleDislike = async (question, function_sequence) => {
    try {
      await axios.post("http://localhost:5000/function_sequence_feedback", {
  user_id: safeUser.sub || loginUsername,
  username: loginUsername,
        question,
        liked: false,
        function_sequence,
      }, { baseURL: undefined });
      setLikedQuestions((prev) => ({ ...prev, [question]: false }));
    } catch (err) {
      alert("Failed to record feedback");
    }
  };

  const handleSelectSuggestedQuestion = (question) => {
    console.log('[DevCopilot] Selected suggested question:', question);
    setMessage(question);
    // Auto-focus input field
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setMessage(val);
    const cursor = e.target.selectionStart;
    setCaretPos(cursor);
    const lastAt = val.lastIndexOf('@', cursor - 1);
    if (lastAt !== -1) {
      const afterAt = val.slice(lastAt + 1, cursor);
      setAnnotationFilter(afterAt);
      setAnnotationDropdown(true);
    } else {
      setAnnotationDropdown(false);
    }
  };

  const handleKeyDown = (e) => {
    // Send on Enter, but Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading && message.trim()) {
        handleSendMessage();
      }
    }
  };

  const handleAnnotationSelect = (cmd) => {
    const before = message.slice(0, caretPos);
    const after = message.slice(caretPos);
    const lastAt = before.lastIndexOf('@');
    const newMsg = before.slice(0, lastAt) + cmd + after;
    setMessage(newMsg);
    setAnnotationDropdown(false);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(lastAt + cmd.length, lastAt + cmd.length);
      }
    }, 0);
  };

  // Extract context for QuestionHelper (recent incidents from chat)
  const getContextForSuggestions = () => {
    const incidents = [];
    // Extract incident numbers from chat history
    const incidentPattern = /INC\d{7}/gi;
    chatHistory.forEach(chat => {
      if (typeof chat.text === 'string') {
        const matches = chat.text.match(incidentPattern);
        if (matches) {
          matches.forEach(inc => {
            if (!incidents.includes(inc)) {
              incidents.push(inc);
            }
          });
        }
      }
    });
    return { incidents: incidents.slice(0, 5) };  // Last 5 unique incidents
  };

  const renderWithAnnotations = (text) => {
    if (typeof text !== 'string') {
      if (text && typeof text === 'object') {
        text = JSON.stringify(text);
      } else {
        return '';
      }
    }
    let out = [];
    let lastIdx = 0;
    let matches = [];
    annotationCommands.forEach(({ command, color, style }) => {
      let idx = text.indexOf(command, lastIdx);
      while (idx !== -1) {
        matches.push({ idx, command, color, style });
        idx = text.indexOf(command, idx + command.length);
      }
    });
    matches = matches.sort((a, b) => a.idx - b.idx);
    let cursor = 0;
    matches.forEach(({ idx, command, color, style }) => {
      if (idx > cursor) out.push(text.slice(cursor, idx));
      out.push(
        <span key={idx + command} style={{ color: color || '#1976d2', fontWeight: style === 'bold' ? 'bold' : 'normal' }}>
          {command}
        </span>
      );
      out.push(' ');
      cursor = idx + command.length;
    });
    if (cursor < text.length) out.push(text.slice(cursor));
    return out.length ? out : text;
  };

  // Removed unused onHide handler (was used for Hide DevCopilot button)

  // MainTabs-style IHM, desktop optimized
  return (
    <div
      style={{
        backgroundImage: 'url(/background.png)',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        backgroundPosition: 'center center',
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      {/* Timeline & Analytics Buttons - styled horizontal group */}
      {/* Timeline & Analytics Buttons - styled horizontal group, separated from Hide DevCopilot */}
      <Box sx={{
        position: 'fixed',
        top: 72, // move below Hide DevCopilot button
        right: 24,
        zIndex: 2100, // higher than Hide DevCopilot
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        padding: '6px 18px',
      }}>
        <IconButton onClick={() => setTimelineOpen(true)} title="View Conversation Timeline" sx={{ color: '#1976d2', bgcolor: 'transparent', '&:hover': { bgcolor: '#e3f2fd' } }}>
          <HistoryIcon fontSize="large" />
        </IconButton>
        <FeedbackAnalyticsIcon onClick={() => setAnalyticsOpen(true)} color="#1976d2" />
      </Box>
      <ConversationTimeline open={timelineOpen} onClose={() => setTimelineOpen(false)} user={props.user || {}} />
      <FeedbackAnalytics open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />
      {tokenAggregate && !showTokens && (
        <Box sx={{ position:'fixed', bottom:16, right:24, zIndex:2000, background:'rgba(255,255,255,0.95)', p:1.5, borderRadius:'16px', boxShadow:'0 2px 8px rgba(0,0,0,0.15)', display:'flex', gap:1, alignItems:'center' }}>
          <Chip label={`Tokens ${tokenAggregate.total_tokens}`} color="secondary" size="small" />
          <Chip label={`Savings ${tokenAggregate.savings_percent}%`} color="success" size="small" />
          <Chip label={`Cost $${tokenAggregate.total_cost_usd}`} size="small" />
        </Box>
      )}
      {/* ...existing chat UI code... */}
      <Box
        sx={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <Paper
          sx={{
            maxWidth: '1400px',
            width: '85vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '20px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            backgroundColor: 'rgba(255, 255, 255, 0.97)',
            padding: '36px',
            overflow: 'hidden'
          }}
        >
          <Box className="chat-header" sx={{ 
            background: 'linear-gradient(135deg, #0078d4 0%, #0063b1 100%)', // Gradient for modern look
            borderRadius: '14px', 
            padding: '20px 24px', // Increased padding
            marginBottom: '24px', 
            display: 'flex', 
            alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,120,212,0.25)' // Added shadow
          }}>
            <Typography variant="h4" sx={{ // Changed from h5 to h4
              color: '#fff', 
              fontWeight: 700, 
              fontStyle: 'normal', 
              flex: 1,
              letterSpacing: '0.5px',
              fontSize: '1.75rem',
              textShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}>🤖 DevCopilot - Agentic AI Assistant</Typography>
            {persona && (
              <Chip 
                label={persona} 
                sx={{ 
                  bgcolor: 'rgba(255,255,255,0.2)', 
                  color: '#fff', 
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }} 
              />
            )}
          </Box>
          
          {/* Session Context Banner - shown when resuming a session */}
          {sessionContextBanner && (
            <Box sx={{ 
              bgcolor: '#e3f2fd', 
              borderLeft: '4px solid #0078d4',
              p: 1.5, 
              mb: 2, 
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 4px rgba(0,120,212,0.1)',
              animation: 'fadeIn 0.5s ease-in'
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#0078d4' }}>
                  📋 {sessionContextBanner.message}
                </Typography>
                {sessionContextBanner.turnCount > 0 && (
                  <Chip 
                    label={`${sessionContextBanner.turnCount} turns`} 
                    size="small" 
                    sx={{ bgcolor: '#fff', color: '#0078d4', fontWeight: 500 }}
                  />
                )}
              </Box>
              <IconButton 
                size="small" 
                onClick={() => setSessionContextBanner(null)}
                sx={{ color: '#0078d4' }}
              >
                <Close fontSize="small" />
              </IconButton>
            </Box>
          )}
          
          {/* Chat message list rendering */}
          <Box ref={chatContentRef} className="chat-content" sx={{ 
            flex: '1 1 auto',
            minHeight: '150px',
            maxHeight: showTokens ? '350px' : '500px',
            overflowY: 'auto', 
            marginBottom: '20px',
            paddingRight: '8px', // Space for scrollbar
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: '#f1f1f1',
              borderRadius: '10px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: '#888',
              borderRadius: '10px',
              '&:hover': {
                background: '#555',
              },
            },
          }}>
            <List>
              {chatHistory.map((chat, index) => (
                <ListItem key={index} className={chat.sender === 'user' ? 'user-message' : 'server-message'}>
                  <ListItemText
                    primary={renderWithAnnotations(chat.text)}
                    secondary={
                      chat.sender === 'user'
                        ? <span style={{ color: '#228B22', fontWeight: 700, fontStyle: 'italic', fontSize: '0.9rem' }}>👤 {chat.username || safeUser.name || 'User'}</span>
                        : <span style={{ color: '#008080', fontWeight: 700, fontStyle: 'italic', fontSize: '0.9rem' }}>🤖 DevCopilot AI</span>
                    }
                    primaryTypographyProps={{
                      style: {
                        color: chat.sender === 'user' ? '#004aad' : '#2c3e50',
                        fontWeight: chat.sender === 'user' ? 600 : 400,
                        fontSize: '1rem',
                        lineHeight: '1.7',
                        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
                      }
                    }}
                  />
                  {chat.sender === 'server' && chat.feedback_payload && (
                    <Box className="feedback-buttons">
                      <IconButton
                        onClick={() => handleLike(chat.question, chat.function_sequence)}
                        color={likedQuestions[chat.question] === true ? 'primary' : 'default'}
                        size="small"
                        sx={{ mr: 1 }}
                      >
                        <ThumbUp />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDislike(chat.question, chat.function_sequence)}
                        color={likedQuestions[chat.question] === false ? 'secondary' : 'default'}
                        size="small"
                      >
                        <ThumbDown />
                      </IconButton>
                    </Box>
                  )}
                  {/* Display suggested questions below server responses */}
                  {chat.sender === 'server' && chat.suggested_questions && chat.suggested_questions.length > 0 && index === chatHistory.length - 1 && (
                    <Box sx={{ 
                      position: 'fixed',
                      bottom: 80,
                      left: 0,
                      right: 0,
                      bgcolor: 'linear-gradient(to bottom, rgba(255,255,255,0.98), white)',
                      borderTop: '3px solid #0078d4',
                      boxShadow: '0 -6px 30px rgba(0,120,212,0.15)',
                      zIndex: 1000,
                      maxHeight: '220px',
                      overflowY: 'auto',
                      animation: 'slideUp 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      backdropFilter: 'blur(10px)'
                    }}>
                      <Box sx={{ 
                        maxWidth: '1400px', 
                        mx: 'auto', 
                        p: 2.5,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5
                      }}>
                        {/* Header with animated icon */}
                        <Box sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between',
                          mb: 0.5
                        }}>
                          <Typography variant="subtitle2" sx={{ 
                            fontWeight: 700, 
                            color: '#0078d4',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            fontSize: '15px'
                          }}>
                            <span style={{ 
                              fontSize: '22px',
                              animation: 'pulse 2s ease-in-out infinite'
                            }}>💡</span>
                            Quick follow-up questions ({chat.suggested_questions.length})
                          </Typography>
                          <Typography variant="caption" sx={{ 
                            color: '#666',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            animation: 'fadeIn 1s ease-in'
                          }}>
                            <span style={{ fontSize: '16px' }}>←</span> Scroll to explore <span style={{ fontSize: '16px' }}>→</span>
                          </Typography>
                        </Box>
                        
                        {/* Horizontal auto-scrolling suggestions carousel */}
                        <Box sx={{ 
                          display: 'flex',
                          gap: 2,
                          overflowX: 'auto',
                          pb: 1.5,
                          scrollBehavior: 'smooth',
                          position: 'relative',
                          '&::-webkit-scrollbar': {
                            height: '12px',
                          },
                          '&::-webkit-scrollbar-track': {
                            bgcolor: 'rgba(0, 120, 212, 0.1)',
                            borderRadius: '6px',
                            boxShadow: 'inset 0 0 6px rgba(0,0,0,0.1)'
                          },
                          '&::-webkit-scrollbar-thumb': {
                            background: 'linear-gradient(90deg, #0078d4, #00a4ef)',
                            borderRadius: '6px',
                            border: '2px solid rgba(255,255,255,0.3)',
                            boxShadow: '0 2px 6px rgba(0,120,212,0.4)',
                            transition: 'all 0.3s ease',
                            '&:hover': {
                              background: 'linear-gradient(90deg, #005a9e, #0078d4)',
                              transform: 'scaleY(1.2)'
                            }
                          }
                        }}>
                          {chat.suggested_questions.map((suggestion, idx) => (
                            <Box
                              key={idx}
                              onClick={() => {
                                setMessage(suggestion);
                                setTimeout(() => handleSendMessage(), 100);
                              }}
                              sx={{
                                minWidth: '320px',
                                maxWidth: '420px',
                                p: 2,
                                background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
                                borderRadius: '12px',
                                border: '2px solid transparent',
                                backgroundClip: 'padding-box',
                                cursor: 'pointer',
                                transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                display: 'flex',
                                gap: 1.5,
                                alignItems: 'flex-start',
                                flexShrink: 0,
                                position: 'relative',
                                overflow: 'hidden',
                                animation: `fadeInSlide 0.5s ease-out ${idx * 0.1}s both`,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                '&::before': {
                                  content: '""',
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  background: 'linear-gradient(135deg, #0078d4, #00a4ef)',
                                  opacity: 0,
                                  transition: 'opacity 0.4s ease',
                                  borderRadius: '12px',
                                  zIndex: -1
                                },
                                '&:hover': {
                                  transform: 'translateY(-4px) scale(1.02)',
                                  boxShadow: '0 8px 24px rgba(0, 120, 212, 0.3)',
                                  border: '2px solid #0078d4',
                                  '&::before': {
                                    opacity: 0.05
                                  }
                                },
                                '&:active': {
                                  transform: 'translateY(-2px) scale(0.98)',
                                }
                              }}
                            >
                              <Box
                                sx={{
                                  minWidth: '28px',
                                  height: '28px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: 'linear-gradient(135deg, #0078d4, #00a4ef)',
                                  color: 'white',
                                  borderRadius: '50%',
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  flexShrink: 0,
                                  boxShadow: '0 2px 8px rgba(0, 120, 212, 0.4)',
                                  transition: 'all 0.3s ease'
                                }}
                              >
                                {idx + 1}
                              </Box>
                              <Typography
                                variant="body2"
                                sx={{
                                  color: '#2c3e50',
                                  lineHeight: 1.6,
                                  fontSize: '13.5px',
                                  fontWeight: 500,
                                  overflow: 'hidden',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 3,
                                  WebkitBoxOrient: 'vertical',
                                  wordBreak: 'break-word'
                                }}
                              >
                                {suggestion}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  )}
                </ListItem>
              ))}
              {loading && (
                <ListItem className="server-message">
                  <ListItemText primary="..." />
                </ListItem>
              )}
            </List>
          </Box>

          {/* Question Helper - Shows suggested questions */}
          <QuestionHelper
            persona={persona}
            onSelectQuestion={handleSelectSuggestedQuestion}
            context={getContextForSuggestions()}
            loginUsername={loginUsername}
          />

          <Box className="chat-input" sx={{ 
            position: 'relative', 
            mb: 2,
            display: 'flex',
            gap: 2,
            alignItems: 'flex-start'
          }}>
            <TextField
              variant="outlined"
              placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              fullWidth
              multiline
              maxRows={4}
              disabled={loading}
              sx={{ 
                bgcolor: '#fff',
                '& .MuiOutlinedInput-root': {
                  borderRadius: '12px',
                  fontSize: '1rem',
                  '&:hover fieldset': {
                    borderColor: '#0078d4',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#0078d4',
                    borderWidth: '2px',
                  },
                },
              }}
              inputRef={inputRef}
              onClick={e => setCaretPos(e.target.selectionStart)}
              onKeyUp={e => setCaretPos(e.target.selectionStart)}
            />
            {annotationDropdown && (
              <Paper className="annotation-dropdown" sx={{ 
                position: 'absolute', 
                left: 0, 
                bottom: '100%',
                marginBottom: '8px',
                zIndex: 10, 
                width: '100%',
                maxHeight: '200px',
                overflowY: 'auto',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                borderRadius: '12px'
              }}>
                {annotationCommands.filter(a => a.command.toLowerCase().includes(annotationFilter.toLowerCase())).map(a => (
                  <ListItem button key={a.command} onClick={() => handleAnnotationSelect(a.command)}>
                    <span style={{ color: a.color, fontWeight: a.style === 'bold' ? 'bold' : 'normal' }}>{a.command}</span>
                    <span style={{ marginLeft: 8, color: '#888', fontSize: 12 }}>{a.label}</span>
                  </ListItem>
                ))}
              </Paper>
            )}
            <Button
              variant="contained"
              onClick={handleSendMessage}
              disabled={loading || !message.trim()}
              sx={{ 
                minWidth: '140px',
                height: '56px',
                borderRadius: '12px',
                fontWeight: 'bold',
                fontSize: '1rem',
                textTransform: 'none',
                background: 'linear-gradient(135deg, #0078d4 0%, #0063b1 100%)',
                boxShadow: '0 4px 12px rgba(0,120,212,0.3)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #0063b1 0%, #004e8c 100%)',
                  boxShadow: '0 6px 16px rgba(0,120,212,0.4)',
                },
                '&:disabled': {
                  background: '#ccc',
                },
              }}
            >
              {loading ? 'Asking...' : 'Ask DevCopilot'}
            </Button>
            <Button
              variant="outlined"
              onClick={() => setShowTokens(v => !v)}
              disabled={loading}
              sx={{ 
                minWidth: '140px',
                height: '56px',
                borderRadius: '12px',
                fontWeight: 'bold',
                fontSize: '0.95rem',
                textTransform: 'none',
                borderWidth: '2px',
                borderColor: showTokens ? '#0078d4' : '#999',
                color: showTokens ? '#0078d4' : '#666',
                '&:hover': {
                  borderWidth: '2px',
                  borderColor: '#0078d4',
                  bgcolor: 'rgba(0,120,212,0.05)',
                },
              }}
            >
              {showTokens ? '▼ Hide Tokens' : '▶ Show Tokens'}
            </Button>
          </Box>
          <Collapse in={showTokens} unmountOnExit>
            <Paper elevation={3} sx={{ 
              p: 3, 
              mb: 2, 
              bgcolor: 'rgba(248,251,255,1)',
              borderRadius: '14px',
              border: '1px solid #e3f2fd',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ 
                  fontWeight: 'bold', 
                  color: '#0078d4', 
                  flex: 1,
                  letterSpacing: '0.3px'
                }}>Token Usage (live)</Typography>
                <Chip 
                  label="Refresh 5s" 
                  size="small" 
                  color="primary" 
                  sx={{ 
                    fontWeight: 600,
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.7 },
                    },
                  }}
                />
              </Box>
              <Divider sx={{ mb: 2 }} />
              <TokenUsageTab apiBase="http://127.0.0.1:5000" username={loginUsername} />
            </Paper>
          </Collapse>
        </Paper>
      </Box>
    </div>
  );
}

export default DevCopilot;
