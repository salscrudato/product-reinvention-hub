import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, Chip, IconButton, Collapse, Tooltip, CircularProgress } from '@mui/material';
import { LightbulbOutlined, Close, Refresh } from '@mui/icons-material';
import axios from 'axios';

/**
 * QuestionHelper - Suggests helpful questions to users based on learned patterns
 * 
 * Features:
 * - Auto-loads on mount or user click
 * - Shows persona-specific suggestions
 * - Context-aware (includes recent incidents)
 * - Click suggestion to auto-fill input
 */
function QuestionHelper({ persona, onSelectQuestion, context, loginUsername }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoShown, setAutoShown] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('questionHelper_dismissed') === 'true';
  });

  useEffect(() => {
    if (!autoShown && persona && !dismissed) {
      loadSuggestions();
      setAutoShown(true);
    }
  }, [persona, autoShown, dismissed]);

  const loadSuggestions = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post('http://localhost:5000/question_suggestions', {
        persona: persona || 'developer',
        context: {
          incidents: context?.incidents || [],
          username: loginUsername
        },
        limit: 6
      });

      if (response.data && response.data.suggestions) {
        setSuggestions(response.data.suggestions);
        if (response.data.suggestions.length > 0 && !autoShown) {
          setOpen(true);
        }
        console.log('[QuestionHelper] Loaded suggestions:', response.data.suggestions);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('[QuestionHelper] Failed to load suggestions:', err);
      setError('Failed to load suggestions');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (question) => {
    if (onSelectQuestion) {
      onSelectQuestion(question);
    }
    setOpen(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    setOpen(false);
    localStorage.setItem('questionHelper_dismissed', 'true');
    console.log('[QuestionHelper] User dismissed helper - will not auto-show again');
  };

  const handleRefresh = () => {
    loadSuggestions();
  };

  const toggleOpen = () => {
    if (!open && suggestions.length === 0) {
      loadSuggestions();
    }
    setOpen(!open);
  };

  const getSourceColor = (source) => {
    switch (source) {
      case 'persona_popular':
        return 'primary';
      case 'popular':
        return 'success';
      case 'context_incident':
        return 'warning';
      case 'intent_starter':
        return 'secondary';
      default:
        return 'default';
    }
  };

  const getSourceLabel = (source) => {
    switch (source) {
      case 'persona_popular':
        return 'Popular for you';
      case 'popular':
        return 'Trending';
      case 'context_incident':
        return 'Related';
      case 'intent_starter':
        return 'Getting started';
      default:
        return 'Suggested';
    }
  };

  if (dismissed) {
    return null;
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          cursor: 'pointer',
          p: 1,
          borderRadius: 1,
          '&:hover': { 
            backgroundColor: 'rgba(0, 74, 173, 0.08)',
            '& .lightbulb-icon': {
              color: 'primary.main'
            }
          }
        }}
        onClick={toggleOpen}
        role="button"
        aria-label="Toggle question suggestions"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && toggleOpen()}
      >
        <LightbulbOutlined 
          className="lightbulb-icon"
          sx={{ 
            mr: 1, 
            color: open ? 'primary.main' : (suggestions.length > 0 ? 'warning.main' : 'text.secondary'),
            fontSize: 24,
            animation: !open && suggestions.length > 0 ? 'pulse 2s ease-in-out infinite' : 'none',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1, transform: 'scale(1)' },
              '50%': { opacity: 0.7, transform: 'scale(1.1)' }
            }
          }} 
        />
        <Typography 
          variant="body2" 
          sx={{ 
            color: open ? 'primary.main' : 'text.secondary',
            fontWeight: open ? 600 : 400
          }}
        >
          {open ? 'Question Helper' : 'Not sure what to ask? Click for suggestions'}
        </Typography>
        {!open && suggestions.length > 0 && (
          <Chip 
            label={suggestions.length} 
            size="small" 
            color="primary" 
            sx={{ ml: 1, height: 20, fontSize: 11 }}
          />
        )}
      </Box>

      <Collapse in={open}>
        <Paper 
          elevation={3} 
          sx={{ 
            mt: 2, 
            p: 2, 
            backgroundColor: '#f9fafb',
            border: '1px solid #e0e0e0'
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600, color: '#004aad' }}>
              💡 Suggested Questions
            </Typography>
            <Box>
              <Tooltip title="Refresh suggestions">
                <IconButton size="small" onClick={handleRefresh} disabled={loading}>
                  <Refresh sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Close">
                <IconButton size="small" onClick={() => setOpen(false)}>
                  <Close sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Don't show automatically anymore">
                <IconButton size="small" onClick={handleDismiss} sx={{ ml: 0.5 }}>
                  <Close sx={{ fontSize: 16, color: 'error.main' }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={30} />
            </Box>
          )}

          {error && !loading && (
            <Typography variant="body2" color="error" sx={{ textAlign: 'center', py: 2 }}>
              {error}
            </Typography>
          )}

          {!loading && !error && suggestions.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <LightbulbOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                No suggestions yet
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 12 }}>
                Suggestions appear after the system learns from usage patterns.<br/>
                Try asking questions like "What is incident INC0010001?" to get started.
              </Typography>
            </Box>
          )}

          {!loading && !error && suggestions.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {suggestions.map((suggestion, index) => (
                <Paper
                  key={index}
                  elevation={1}
                  sx={{
                    p: 1.5,
                    cursor: 'pointer',
                    backgroundColor: '#ffffff',
                    border: '1px solid #e0e0e0',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      backgroundColor: '#f0f7ff',
                      borderColor: '#004aad',
                      transform: 'translateX(4px)',
                      boxShadow: 2
                    },
                    '&:focus': {
                      outline: '2px solid #004aad',
                      outlineOffset: 2
                    }
                  }}
                  onClick={() => handleSuggestionClick(suggestion.question)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSuggestionClick(suggestion.question)}
                  aria-label={`Use suggestion: ${suggestion.question}`}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        flex: 1,
                        color: '#2c3e50',
                        fontSize: 14,
                        lineHeight: 1.5
                      }}
                    >
                      "{suggestion.question}"
                    </Typography>
                    <Chip
                      label={getSourceLabel(suggestion.source)}
                      size="small"
                      color={getSourceColor(suggestion.source)}
                      sx={{
                        height: 22,
                        fontSize: 11,
                        fontWeight: 500,
                        flexShrink: 0
                      }}
                    />
                  </Box>
                  
                  {suggestion.confidence && (
                    <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box
                        sx={{
                          width: `${suggestion.confidence * 100}%`,
                          height: 3,
                          backgroundColor: suggestion.confidence > 0.7 ? '#4caf50' : '#ff9800',
                          borderRadius: 1.5
                        }}
                      />
                      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                        {Math.round(suggestion.confidence * 100)}%
                      </Typography>
                    </Box>
                  )}
                </Paper>
              ))}
            </Box>
          )}

          <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #e0e0e0' }}>
            <Typography 
              variant="caption" 
              sx={{ 
                display: 'block', 
                textAlign: 'center', 
                color: 'text.secondary',
                fontSize: 11
              }}
            >
              💡 Personalized for your role ({persona || 'developer'})
              {context?.incidents?.length > 0 && ` • ${context.incidents.length} recent incident${context.incidents.length > 1 ? 's' : ''} detected`}
            </Typography>
          </Box>
        </Paper>
      </Collapse>
    </Box>
  );
}

export default QuestionHelper;
