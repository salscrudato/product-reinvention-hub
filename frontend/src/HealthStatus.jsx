import React, { useState, useEffect } from 'react';
import {
  Box,
  Tooltip,
  IconButton,
  Popover,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  CheckCircle,
  Error,
  Warning,
  HealthAndSafety,
} from '@mui/icons-material';

/**
 * HealthStatus Component - Displays real-time integration health status.
 * 
 * Shows health for:
 * - ServiceNow API
 * - Wiki/Confluence RAG
 * - JIRA API
 * 
 * Polls backend every 30 seconds for updates.
 */
const HealthStatus = () => {
  const [healthData, setHealthData] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch health status from backend
  const fetchHealth = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/integrations/health');
      const data = await response.json();
      setHealthData(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch health status:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);
  const id = open ? 'health-popover' : undefined;

  // Get overall status icon and color
  const getOverallStatusIcon = () => {
    if (loading) {
      return <CircularProgress size={24} style={{ color: '#1976d2' }} />;
    }
    
    if (error || !healthData) {
      return <Error style={{ color: '#f44336' }} />;
    }

    const status = healthData.overall_status;
    if (status === 'healthy') {
      return <CheckCircle style={{ color: '#4caf50' }} />;
    } else if (status === 'degraded') {
      return <Warning style={{ color: '#ff9800' }} />;
    } else {
      return <Error style={{ color: '#f44336' }} />;
    }
  };

  // Get service status icon
  const getServiceStatusIcon = (status) => {
    if (status === 'healthy') {
      return <CheckCircle style={{ color: '#4caf50', fontSize: 20 }} />;
    } else if (status === 'degraded') {
      return <Warning style={{ color: '#ff9800', fontSize: 20 }} />;
    } else {
      return <Error style={{ color: '#f44336', fontSize: 20 }} />;
    }
  };

  // Get status chip color
  const getStatusChipColor = (status) => {
    if (status === 'healthy') return 'success';
    if (status === 'degraded') return 'warning';
    return 'error';
  };

  // Format response time
  const formatResponseTime = (ms) => {
    if (!ms) return 'N/A';
    return `${Math.round(ms)}ms`;
  };

  return (
    <>
      <Tooltip title="Integration Health Status">
        <IconButton
          onClick={handleClick}
          style={{
            padding: '8px',
            marginLeft: '8px',
          }}
          aria-describedby={id}
        >
          {getOverallStatusIcon()}
        </IconButton>
      </Tooltip>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <Box sx={{ p: 2, minWidth: 350, maxWidth: 450 }}>
          <Typography variant="h6" gutterBottom style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <HealthAndSafety />
            Integration Health
          </Typography>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Box sx={{ p: 1 }}>
              <Chip
                label={`Error: ${error}`}
                color="error"
                variant="outlined"
                size="small"
              />
            </Box>
          )}

          {!loading && !error && healthData && (
            <>
              <Box sx={{ mb: 2 }}>
                <Chip
                  label={`Overall: ${healthData.overall_status}`}
                  color={getStatusChipColor(healthData.overall_status)}
                  size="small"
                />
              </Box>

              <List dense>
                {/* ServiceNow Health */}
                <ListItem>
                  <ListItemIcon>
                    {getServiceStatusIcon(healthData.services.servicenow.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body1" fontWeight="bold">
                        ServiceNow
                      </Typography>
                    }
                    secondary={
                      <>
                        <Typography variant="caption" display="block">
                          Status: {healthData.services.servicenow.status}
                        </Typography>
                        {healthData.services.servicenow.response_time_ms > 0 && (
                          <Typography variant="caption" display="block">
                            Response: {formatResponseTime(healthData.services.servicenow.response_time_ms)}
                          </Typography>
                        )}
                        {healthData.services.servicenow.error && (
                          <Typography variant="caption" color="error" display="block">
                            Error: {healthData.services.servicenow.error}
                          </Typography>
                        )}
                        {healthData.services.servicenow.authenticated && (
                          <Chip
                            label="Authenticated"
                            color="success"
                            size="small"
                            variant="outlined"
                            style={{ marginTop: '4px' }}
                          />
                        )}
                      </>
                    }
                  />
                </ListItem>

                {/* Wiki Health */}
                <ListItem>
                  <ListItemIcon>
                    {getServiceStatusIcon(healthData.services.wiki.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body1" fontWeight="bold">
                        Wiki RAG
                      </Typography>
                    }
                    secondary={
                      <>
                        <Typography variant="caption" display="block">
                          Status: {healthData.services.wiki.status}
                        </Typography>
                        {healthData.services.wiki.docs_count > 0 && (
                          <Typography variant="caption" display="block">
                            Documents: {healthData.services.wiki.docs_count}
                          </Typography>
                        )}
                        {healthData.services.wiki.index_loaded && (
                          <Chip
                            label="Index Loaded"
                            color="success"
                            size="small"
                            variant="outlined"
                            style={{ marginTop: '4px' }}
                          />
                        )}
                        {healthData.services.wiki.error && (
                          <Typography variant="caption" color="error" display="block">
                            Error: {healthData.services.wiki.error}
                          </Typography>
                        )}
                      </>
                    }
                  />
                </ListItem>

                {/* JIRA Health */}
                <ListItem>
                  <ListItemIcon>
                    {getServiceStatusIcon(healthData.services.jira.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="body1" fontWeight="bold">
                        JIRA
                      </Typography>
                    }
                    secondary={
                      <>
                        <Typography variant="caption" display="block">
                          Status: {healthData.services.jira.status}
                        </Typography>
                        {healthData.services.jira.response_time_ms > 0 && (
                          <Typography variant="caption" display="block">
                            Response: {formatResponseTime(healthData.services.jira.response_time_ms)}
                          </Typography>
                        )}
                        {healthData.services.jira.error && (
                          <Typography variant="caption" color="error" display="block">
                            Error: {healthData.services.jira.error}
                          </Typography>
                        )}
                        {healthData.services.jira.authenticated && (
                          <Chip
                            label="Authenticated"
                            color="success"
                            size="small"
                            variant="outlined"
                            style={{ marginTop: '4px' }}
                          />
                        )}
                      </>
                    }
                  />
                </ListItem>
              </List>

              <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                Last checked: {new Date(healthData.timestamp * 1000).toLocaleTimeString()}
              </Typography>
            </>
          )}
        </Box>
      </Popover>
    </>
  );
};

export default HealthStatus;
