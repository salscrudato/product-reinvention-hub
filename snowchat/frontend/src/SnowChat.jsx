import React, { useState, useEffect, useRef } from 'react';
import { Box, TextField, Button, Typography, Paper, List, ListItem, ListItemText, IconButton } from '@mui/material';
import { ThumbUp, ThumbDown, Close } from '@mui/icons-material';
import axios from 'axios';
import { getKeycloakInstance } from './keycloak';
import { annotationCommands } from './annotationCommands';
import './SnowChat.css'; // Import the CSS file for styling

function SnowChat({ user }) {
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false); // State to toggle chat widget visibility
  const [chatboxSize, setChatboxSize] = useState({ width: 350, height: 500 }); // State for chatbox size
  const [likedQuestions, setLikedQuestions] = useState({});
  const [annotationDropdown, setAnnotationDropdown] = useState(false);
  const [annotationFilter, setAnnotationFilter] = useState('');
  const [caretPos, setCaretPos] = useState(0);
  const inputRef = useRef();
  const [activeWikiClarificationStateId, setActiveWikiClarificationStateId] = useState(null);

  // Defensive: fallback if user or user.name is undefined
  const safeUser = user || { id: 'unknown', name: 'Unknown', session_id: 'unknown' };
  const loginUsername = safeUser.preferred_username || safeUser.name || safeUser.id;
  const authHeaders = () => {
    try {
      const kc = getKeycloakInstance();
      if (kc && kc.token) return { Authorization: `Bearer ${kc.token}` };
    } catch (_) {}
    return {};
  };

  // Fetch chat history on component mount
  useEffect(() => {
    const fetchChatHistory = async () => {
      try {
  const response = await axios.get('http://localhost:5000/chat_history', { params: { username: loginUsername }, headers: authHeaders() });
        // Parse each chat message to ensure 'text' is always a string
        const parsedHistory = (response.data.chat_history || []).map((chat) => {
          // If the message is from the server and text is an object, extract final_answer or stringified object
          if (chat.sender === 'server' && typeof chat.text === 'object' && chat.text !== null) {
            let answer = chat.text.final_answer || chat.text.response || JSON.stringify(chat.text);
            let function_sequence = chat.text.function_sequence || null;
            let feedback_payload = chat.text.feedback_payload || null;
            return {
              ...chat,
              text: answer,
              function_sequence,
              feedback_payload,
            };
          }
          return chat;
        });
        setChatHistory(parsedHistory);
      } catch (error) {
        console.error("Error fetching chat history:", error);
      }
    };

    fetchChatHistory();
  }, []);

  // Greet the user when the chat opens
  useEffect(() => {
    if (isOpen && chatHistory.length === 0 && safeUser.preferred_username) {
      setChatHistory([
        {
          sender: 'server',
          text: `Hello ${safeUser.preferred_username}! How can I help you today?`,
          question: null,
          function_sequence: null,
          feedback_payload: null,
        },
      ]);
    }
  }, [isOpen, safeUser.preferred_username, chatHistory.length]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    setChatHistory((prevHistory) => [...prevHistory, { sender: 'user', text: message }]);
    setLoading(true);

    let response;
    let usedAgentic = false;
    try {
      // Build metadata with wiki clarification state if active
      const requestMetadata = {};
      if (activeWikiClarificationStateId) {
        requestMetadata.wiki_clarification_state_id = activeWikiClarificationStateId;
        console.log('[SnowChat] Including wiki_clarification_state_id in request:', activeWikiClarificationStateId);
      }

      // Try agentic orchestrator first
      response = await axios.post('http://localhost:5000/agentic_orchestrate', {
        messages: chatHistory.map(chat => ({
          role: chat.sender === 'user' ? 'user' : 'assistant',
          content: typeof chat.text === 'string' ? chat.text : JSON.stringify(chat.text),
        })).concat([{ role: 'user', content: message }]),
        prompt: "You are an intelligent assistant for ServiceNow incident management.",
        metadata: requestMetadata,
        username: loginUsername,
        agent_type: "plan_and_execute"
      }, { headers: authHeaders() });
      usedAgentic = true;
    } catch (error) {
      // Fallback to legacy orchestrator if agentic fails
      try {
        response = await axios.post('http://localhost:5000/orchestrate', {
          question: message,
          prompt: "You are an intelligent assistant for ServiceNow incident management.",
          username: loginUsername
        }, { headers: authHeaders() });
        usedAgentic = false;
      } catch (legacyError) {
        setChatHistory((prevHistory) => [
          ...prevHistory,
          { sender: 'server', text: "An error occurred while processing your request." },
        ]);
        setLoading(false);
        setMessage('');
        return;
      }
    }

    // Handle backend error with code and description
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

    // Extract the answer string using legacy/agentic logic
    let answer = "No response from server.";
    let function_sequence = null;
    let feedback_payload = null;
    if (usedAgentic && response.data && response.data.final_answer) {
      answer = response.data.final_answer;
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

    // Fallback: always use function_sequence and feedback_payload from backend if present
    if (response.data.function_sequence) function_sequence = response.data.function_sequence;
    if (response.data.feedback_payload) feedback_payload = response.data.feedback_payload;

    // Extract wiki clarification state ID from response metadata
    if (response.data.metadata && response.data.metadata.awaiting_wiki_clarification) {
      const stateId = response.data.metadata.wiki_clarification_state_id;
      setActiveWikiClarificationStateId(stateId);
      console.log('[SnowChat] Wiki clarification active, state_id:', stateId);
    } else {
      // Clear state ID after clarification is resolved
      if (activeWikiClarificationStateId) {
        console.log('[SnowChat] Wiki clarification resolved, clearing state_id');
        setActiveWikiClarificationStateId(null);
      }
    }

    setChatHistory((prevHistory) => [
      ...prevHistory,
      {
        sender: 'server',
        text: answer,
        id: response.data.id,
        question: message,
        function_sequence: function_sequence,
        feedback_payload: feedback_payload,
      },
    ]);
    setLoading(false);
    setMessage('');
  };

  // Like/dislike handlers for function sequence feedback
  const handleLike = async (question, function_sequence) => {
    try {
      await axios.post("http://localhost:5000/function_sequence_feedback", {
  user_id: safeUser.sub || loginUsername,
  username: loginUsername, // Always send username
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
  username: loginUsername, // Always send username
        question,
        liked: false,
        function_sequence,
      }, { baseURL: undefined });
      setLikedQuestions((prev) => ({ ...prev, [question]: false }));
    } catch (err) {
      alert("Failed to record feedback");
    }
  };

  const handleResize = (e) => {
    const newWidth = e.target.offsetWidth;
    const newHeight = e.target.offsetHeight;
    setChatboxSize({ width: newWidth, height: newHeight });
  };

  // Annotation autocomplete logic
  const handleInputChange = (e) => {
    const val = e.target.value;
    setMessage(val);
    const cursor = e.target.selectionStart;
    setCaretPos(cursor);
    // Show dropdown if '@' is typed and filter
    const lastAt = val.lastIndexOf('@', cursor - 1);
    if (lastAt !== -1) {
      const afterAt = val.slice(lastAt + 1, cursor);
      setAnnotationFilter(afterAt);
      setAnnotationDropdown(true);
    } else {
      setAnnotationDropdown(false);
    }
  };

  const handleAnnotationSelect = (cmd) => {
    // Insert annotation at caret position
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

  // Render annotation tokens in chat history and input
  const renderWithAnnotations = (text) => {
    if (typeof text !== 'string') {
      // Optionally stringify objects, or just return an empty string
      if (text && typeof text === 'object') {
        text = JSON.stringify(text);
      } else {
        return '';
      }
    }
    let out = [];
    let lastIdx = 0;
    let matches = [];
    // Find all annotation matches and their positions
    annotationCommands.forEach(({ command, color, style }) => {
      let idx = text.indexOf(command, lastIdx);
      while (idx !== -1) {
        matches.push({ idx, command, color, style });
        idx = text.indexOf(command, idx + command.length);
      }
    });
    // Sort matches by position
    matches = matches.sort((a, b) => a.idx - b.idx);
    let cursor = 0;
    matches.forEach(({ idx, command, color, style }) => {
      if (idx > cursor) out.push(text.slice(cursor, idx));
      out.push(
        <span key={idx + command} style={{ color: color || '#1976d2', fontWeight: style === 'bold' ? 'bold' : 'normal' }}>
          {command}
        </span>
      );
      out.push(' '); // Add a whitespace after annotation
      cursor = idx + command.length;
    });
    if (cursor < text.length) out.push(text.slice(cursor));
    return out.length ? out : text;
  };

  return (
    <div className={`chat-widget ${isOpen ? 'open' : ''}`}>
      {!isOpen && (
        <Button className="chat-toggle-button" onClick={() => setIsOpen(true)}>
          Chat
        </Button>
      )}
      {isOpen && (
        <Paper
          elevation={3}
          className="chat-box"
          style={{ width: `${chatboxSize.width}px`, height: `${chatboxSize.height}px` }}
          onResize={handleResize}
        >
          <Box className="chat-header">
            <Typography variant="h6" sx={{ color: '#fff', fontWeight: 'bold', fontStyle: 'italic', fontSize: '1.25rem' }}>DevCopilot</Typography>
            <Typography
              variant="h6"
              sx={{ ml: 2, flex: 1, color: '#fff', fontWeight: 'bold', fontStyle: 'italic', fontSize: '1.25rem' }}
            >
              {safeUser.name ? `Signed in as: ${safeUser.name}` : ''}
            </Typography>
            <IconButton onClick={() => setIsOpen(false)}>
              <Close />
            </IconButton>
          </Box>
          <Box className="chat-content">
            <List>
              {chatHistory.map((chat, index) => (
                <ListItem key={index} className={chat.sender === 'user' ? 'user-message' : 'server-message'}>
                  <ListItemText
                    primary={renderWithAnnotations(chat.text)}
                    secondary={
                      chat.sender === 'user'
                        ? (
                            <span style={{ color: '#228B22', fontWeight: 'bold', fontStyle: 'italic' }}>{chat.username || safeUser.name || 'User'}</span>
                          )
                        : (
                            <span style={{ color: '#008080', fontWeight: 'bold', fontStyle: 'italic' }}>DevCopilot</span>
                          )
                    }
                    primaryTypographyProps={{
                      style: {
                        color: chat.sender === 'user' ? '#004aad' : '#333',
                        fontWeight: chat.sender === 'user' ? 'bold' : 'normal',
                      },
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
                </ListItem>
              ))}
              {loading && (
                <ListItem className="server-message">
                  <ListItemText primary="..." />
                </ListItem>
              )}
            </List>
          </Box>
          <Box className="chat-input" style={{ position: 'relative' }}>
            <TextField
              variant="outlined"
              placeholder="Type your message..."
              value={message}
              onChange={handleInputChange}
              fullWidth
              disabled={loading}
              sx={{ bgcolor: '#fff' }}
              inputRef={inputRef}
              onClick={e => setCaretPos(e.target.selectionStart)}
              onKeyUp={e => setCaretPos(e.target.selectionStart)}
            />
            {annotationDropdown && (
              <Paper className="annotation-dropdown" style={{ position: 'absolute', left: 0, bottom: 50, zIndex: 10, width: '100%' }}>
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
              disabled={loading}
              sx={{ ml: 1 }}
            >
              Send
            </Button>
          </Box>
        </Paper>
      )}
    </div>
  );
}

export default SnowChat;

