import React, { useEffect, useState } from 'react';
import { Drawer, List, ListItem, ListItemText, Typography, IconButton, Divider } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import CloseIcon from '@mui/icons-material/Close';
import axios from 'axios';
import { InputBase } from '@mui/material';

export default function ConversationTimeline({ open, onClose, user }) {
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      axios.get('http://localhost:5000/chat_history', {
        params: { username: user?.name || user?.preferred_username || user?.id }
      }).then(res => {
        setHistory(res.data.chat_history || []);
      });
    }
  }, [open, user]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <div style={{ width: 400, padding: 24 }}>
        <Typography variant="h6" gutterBottom>
          <HistoryIcon style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Conversation Timeline
          <IconButton onClick={onClose} style={{ float: 'right' }}><CloseIcon /></IconButton>
        </Typography>
        <Divider />
        <InputBase
          placeholder="Search history..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ width: '100%', mb: 2, mt: 1, bgcolor: '#f5f5f5', borderRadius: 2, px: 2 }}
        />
        <List>
          {history
            .map((msg, idx) => ({ msg, idx }))
            .filter(({ msg }) => {
              if (!search.trim()) return true;
              const s = search.toLowerCase();
              return (
                (typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text)).toLowerCase().includes(s) ||
                (msg.sender && msg.sender.toLowerCase().includes(s)) ||
                (msg.function_sequence && JSON.stringify(msg.function_sequence).toLowerCase().includes(s)) ||
                (msg.tool_outputs && JSON.stringify(msg.tool_outputs).toLowerCase().includes(s))
              );
            })
            .map(({ msg, idx }) => {
              // Highlight search matches in text
              let text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
              if (search.trim() && text.toLowerCase().includes(search.toLowerCase())) {
                const i = text.toLowerCase().indexOf(search.toLowerCase());
                text = <span>{text.substring(0, i)}<span style={{ background: '#ffe066' }}>{text.substring(i, i + search.length)}</span>{text.substring(i + search.length)}</span>;
              }
              // Metadata visualization
              const toolNames = msg.tool_outputs ? Object.keys(msg.tool_outputs).join(', ') : null;
              const feedback = msg.feedback_payload ? (msg.feedback_payload.liked ? '👍' : msg.feedback_payload.liked === false ? '👎' : null) : null;
              return (
                <ListItem key={idx} alignItems="flex-start">
                  <ListItemText
                    primary={
                      <span>
                        <strong>{msg.sender === 'user' ? 'User' : (msg.sender || 'AI')}:</strong> {text}
                        {feedback && <span style={{ marginLeft: 8 }}>{feedback}</span>}
                      </span>
                    }
                    secondary={
                      <>
                        {msg.timestamp && (
                          <span style={{ color: '#888', fontSize: 12 }}>
                            {new Date(msg.timestamp).toLocaleString()}
                          </span>
                        )}
                        {toolNames && (
                          <div style={{ fontSize: 12, color: '#8e24aa' }}>
                            <strong>Tools:</strong> {toolNames}
                          </div>
                        )}
                        {msg.function_sequence && (
                          <div style={{ fontSize: 12, color: '#1976d2' }}>
                            <strong>Function Sequence:</strong> {JSON.stringify(msg.function_sequence)}
                          </div>
                        )}
                        {msg.tool_outputs && (
                          <div style={{ fontSize: 12, color: '#008080' }}>
                            <strong>Tool Outputs:</strong> {JSON.stringify(msg.tool_outputs)}
                          </div>
                        )}
                      </>
                    }
                  />
                </ListItem>
              );
            })}
        </List>
      </div>
    </Drawer>
  );
}
