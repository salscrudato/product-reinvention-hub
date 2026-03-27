import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, CircularProgress, Chip, Stack, Divider, FormControl, InputLabel, Select, MenuItem, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import axios from 'axios';

const TokenUsageTab = ({ apiBase = 'http://127.0.0.1:5000', username }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // Separate state for background refresh
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [aggregate, setAggregate] = useState(null);
  const [paging, setPaging] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [personaFilter, setPersonaFilter] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);

  const fetchMetrics = useCallback(async (opts = {}) => {
    const isBackgroundRefresh = opts.isBackgroundRefresh || false;
    
    // Only show loading spinner on initial load, not during background refresh
    if (!isBackgroundRefresh) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    
    setError(null);
    try {
      const nextPage = opts.page || page;
      const nextSize = opts.pageSize || pageSize;
      const qp = new URLSearchParams();
      qp.set('page', String(nextPage));
      qp.set('page_size', String(nextSize));
      if (username) qp.set('username', username);
      const url = `${apiBase}/token_metrics?${qp.toString()}`;
      const resp = await axios.get(url);
      if (resp.data.enabled) {
        setEntries(resp.data.entries || []);
        setAggregate(resp.data.aggregate || null);
        setPaging(resp.data.paging || null);
        setPage(nextPage);
        setPageSize(nextSize);
      } else {
        setError('Token metrics disabled');
      }
    } catch (e) {
      setError(e.message || 'Failed fetching metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBase, username, page, pageSize]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(() => fetchMetrics({ page, pageSize, isBackgroundRefresh: true }), 5000); // refresh every 5s
    return () => clearInterval(interval);
  }, [page, pageSize]); // Removed fetchMetrics from deps to prevent infinite loop

  const personas = useMemo(() => {
    const set = new Set();
    entries.forEach(e => { if (e.persona) set.add(e.persona); });
    return Array.from(set);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(e => !personaFilter || e.persona === personaFilter);
  }, [entries, personaFilter]);

  const exportCsv = () => {
    if (!filteredEntries.length) return;
    const headers = ['timestamp','persona','username','question','prompt_tokens','context_tokens','completion_tokens','total_tokens','baseline_estimate','savings_tokens','savings_percent','cache_hit','micro_intent','plan_steps'];
    const lines = [headers.join(',')];
    filteredEntries.forEach(e => {
      const row = headers.map(h => {
        let v = e[h];
        if (Array.isArray(v)) v = v.join('|');
        if (typeof v === 'string') {
          const esc = v.replace(/"/g,'""');
          return '"'+esc+'"';
        }
        return v === undefined ? '' : v;
      }).join(',');
      lines.push(row);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'token_usage.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <Box sx={{ textAlign: 'center', p: 4 }}><CircularProgress /><Typography variant="body2" sx={{ mt: 2 }}>Loading token usage...</Typography></Box>;
  }
  if (error) {
    return <Box sx={{ textAlign: 'center', p: 4 }}><Typography color="error">{error}</Typography></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ 
        mb: 2.5, 
        fontWeight: 700, 
        color: '#0078d4',
        fontSize: '1.4rem',
        borderBottom: '3px solid #0078d4',
        paddingBottom: '8px',
        letterSpacing: '0.3px'
      }}>
        📊 Token Usage & Agentic Analytics {username && `(User: ${username})`}
      </Typography>
      {aggregate && (
        <Paper sx={{ p: 2, mb: 2 }} elevation={2}>
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
            <Chip label={`Interactions: ${aggregate.count}`} color="primary" />
            <Chip label={`Total: ${aggregate.total_tokens}`} color="secondary" />
            <Chip label={`Baseline: ${aggregate.baseline_tokens}`} />
            <Chip label={`Savings: ${aggregate.savings_tokens}`} />
            <Chip label={`Savings %: ${aggregate.savings_percent}%`} />
            <Chip label={`Cost: $${aggregate.total_cost_usd}`} />
            {paging && (
              <Chip label={`Page ${paging.page}/${paging.total_pages}`} />
            )}
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Persona</InputLabel>
              <Select value={personaFilter} label="Persona" onChange={e => setPersonaFilter(e.target.value)}>
                <MenuItem value=""><em>All</em></MenuItem>
                {personas.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
            <Button size="small" variant="outlined" onClick={exportCsv}>Export CSV</Button>
          </Stack>
          {paging && (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
              <Button size="small" variant="contained" disabled={!paging.has_prev} onClick={() => fetchMetrics({ page: page - 1 })}>Prev</Button>
              <Button size="small" variant="contained" disabled={!paging.has_next} onClick={() => fetchMetrics({ page: page + 1 })}>Next</Button>
              <FormControl size="small" sx={{ minWidth: 90 }}>
                <InputLabel>Page Size</InputLabel>
                <Select value={pageSize} label="Page Size" onChange={e => fetchMetrics({ page: 1, pageSize: parseInt(e.target.value,10) })}>
                  {[5,10,20].map(sz => <MenuItem key={sz} value={sz}>{sz}</MenuItem>)}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">
                Showing {paging.start_index + 1}-{paging.end_index_exclusive} of {paging.total_rows}
              </Typography>
            </Stack>
          )}
        </Paper>
      )}
      <Paper sx={{ p: 2, overflow: 'auto', bgcolor: '#fafbfc', borderRadius: 2, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }} elevation={2}>
        <Table size="small">
          <TableHead sx={{ bgcolor: '#f0f4f8' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Date / Time</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Persona</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Question</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Prompt</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Context</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Completion</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Baseline</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Savings</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, color: '#0078d4', fontSize: '0.9rem' }}>Savings %</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#0078d4' }}>Micro Intent</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#0078d4' }}>Cache</TableCell>
              <TableCell sx={{ fontWeight: 600, color: '#0078d4' }}>Agentic Plan</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredEntries.map(e => {
              const lowSavings = e.savings_percent < 10;
              const highTokens = e.total_tokens > 2000; // heuristic threshold
              const timestampValue = (() => {
                if (typeof e.timestamp === 'number') {
                  return new Date(e.timestamp * 1000);
                }
                if (typeof e.timestamp === 'string' && e.timestamp) {
                  const parsed = new Date(e.timestamp);
                  return Number.isNaN(parsed.getTime()) ? null : parsed;
                }
                return null;
              })();
              const timestampDisplay = timestampValue ? timestampValue.toLocaleString() : '—';
              return (
                <TableRow 
                  key={e.timestamp} 
                  hover 
                  onClick={() => setSelectedRow(e)} 
                  sx={{ 
                    cursor: 'pointer', 
                    bgcolor: lowSavings ? 'rgba(255,0,0,0.06)' : highTokens ? 'rgba(255,165,0,0.10)' : undefined,
                    '&:hover': { bgcolor: lowSavings ? 'rgba(255,0,0,0.12)' : highTokens ? 'rgba(255,165,0,0.18)' : 'rgba(0,120,212,0.08)' },
                    transition: 'background-color 0.2s'
                  }}
                >
                  <TableCell sx={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>{timestampDisplay}</TableCell>
                  <TableCell sx={{ fontSize: '0.85rem', fontWeight: 500 }}>{e.persona || ''}</TableCell>
                  <TableCell title={e.question} sx={{ fontSize: '0.85rem', fontWeight: 500, color: '#004578' }}>{(e.question || '').slice(0,50)}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>{e.prompt_tokens}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>{e.context_tokens}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>{e.completion_tokens}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0078d4' }}>{e.total_tokens}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.85rem', fontWeight: 500, color: '#666' }}>{e.baseline_estimate}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#2e7d32' }}>{e.savings_tokens}</TableCell>
                  <TableCell align="right" sx={{ fontSize: '0.9rem', fontWeight: 700, color: e.savings_percent > 20 ? '#2e7d32' : e.savings_percent < 10 ? '#d32f2f' : '#ed6c02' }}>{e.savings_percent}%</TableCell>
                  <TableCell sx={{ fontSize: '0.85rem', fontStyle: 'italic', color: '#555' }}>{e.micro_intent || ''}</TableCell>
                  <TableCell sx={{ fontSize: '1rem' }}>{e.cache_hit ? '✓' : ''}</TableCell>
                  <TableCell sx={{ fontSize: '0.85rem', fontWeight: 500 }}>{Array.isArray(e.plan_steps) ? e.plan_steps.join(',') : ''}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
      <Divider sx={{ my: 2 }} />
      <Typography variant="body2" color="text.secondary">
        Metrics update every 8s (current page retained). Savings reflect difference between heuristic baseline and actual total tokens. Use page size control to adjust slice.
      </Typography>
      <Dialog open={!!selectedRow} onClose={() => setSelectedRow(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ bgcolor: '#f8f9fa', borderBottom: '3px solid #0078d4', fontWeight: 700, fontSize: '1.5rem' }}>💬 Interaction Details</DialogTitle>
        <DialogContent dividers sx={{ bgcolor: '#fafbfc' }}>
          {selectedRow && (
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0078d4', mb: 1, fontSize: '1.05rem' }}>❓ Question</Typography>
              <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#ffffff', borderLeft: '4px solid #228B22' }}>
                <Typography variant="body1" sx={{ fontSize: '1rem', lineHeight: 1.7, color: '#333' }}>{selectedRow.question}</Typography>
              </Paper>
              <Typography variant="caption" sx={{ display: 'block', mb: 2.5, fontSize: '0.85rem', fontStyle: 'italic', color: '#666', fontWeight: 500 }}>
                ⏰ Asked at: {(() => {
                  if (typeof selectedRow.timestamp === 'number') {
                    return new Date(selectedRow.timestamp * 1000).toLocaleString();
                  }
                  if (typeof selectedRow.timestamp === 'string' && selectedRow.timestamp) {
                    const parsed = new Date(selectedRow.timestamp);
                    return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString();
                  }
                  return 'Unavailable';
                })()}
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: '#ffffff', borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0078d4', mb: 1.5, fontSize: '1.05rem' }}>📊 Execution Metrics</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Chip label={`👤 ${selectedRow.persona || 'n/a'}`} sx={{ fontWeight: 600, bgcolor: '#e3f2fd' }} />
                  <Chip label={`🎯 ${selectedRow.micro_intent || 'n/a'}`} sx={{ fontWeight: 600, bgcolor: '#fff3e0' }} />
                  <Chip label={`⚡ Cache: ${selectedRow.cache_hit ? 'Hit' : 'Miss'}`} color={selectedRow.cache_hit ? 'success' : 'default'} sx={{ fontWeight: 600 }} />
                  <Chip label={`🔢 Total: ${selectedRow.total_tokens}`} color="primary" sx={{ fontWeight: 700 }} />
                  <Chip label={`💰 Saved: ${selectedRow.savings_tokens}`} color="success" sx={{ fontWeight: 600 }} />
                  <Chip label={`📈 ${selectedRow.savings_percent}%`} color="success" sx={{ fontWeight: 700 }} />
                  <Chip label={`📏 Baseline: ${selectedRow.baseline_estimate}`} sx={{ fontWeight: 500 }} />
                  <Chip label={`📝 Prompt: ${selectedRow.prompt_tokens}`} sx={{ fontWeight: 500 }} />
                  <Chip label={`📚 Context: ${selectedRow.context_tokens}`} sx={{ fontWeight: 500 }} />
                  <Chip label={`✍️ Output: ${selectedRow.completion_tokens}`} sx={{ fontWeight: 500 }} />
                </Stack>
              </Paper>
              {selectedRow.final_answer_preview && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0078d4', mb: 1.5, fontSize: '1.1rem' }}>💡 AI Response Preview</Typography>
                  <Paper variant="outlined" sx={{ p: 2.5, mb: 2, maxHeight: 200, overflow: 'auto', bgcolor: '#f0f8ff', borderLeft: '4px solid #008080', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                    <Typography variant="body1" sx={{ fontSize: '0.95rem', lineHeight: 1.8, color: '#2c3e50', whiteSpace: 'pre-wrap', fontFamily: 'system-ui, -apple-system, sans-serif' }}>{selectedRow.final_answer_preview}</Typography>
                  </Paper>
                </>
              )}
              {Array.isArray(selectedRow.plan_steps) && selectedRow.plan_steps.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0078d4', mb: 1.5, fontSize: '1.1rem' }}>🤖 Agentic Execution Plan</Typography>
                  <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f8f9fa', borderLeft: '4px solid #0078d4' }}>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      {selectedRow.plan_steps.map((p, idx) => (
                        <Chip 
                          key={p} 
                          label={`${idx + 1}. ${p}`} 
                          variant="outlined" 
                          sx={{ 
                            fontWeight: 500, 
                            fontSize: '0.9rem',
                            borderColor: '#0078d4',
                            color: '#004578',
                            '&:hover': { bgcolor: '#e3f2fd' }
                          }} 
                        />
                      ))}
                    </Stack>
                  </Paper>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedRow(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TokenUsageTab;
