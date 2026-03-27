import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Paper, List, ListItem, ListItemText, CircularProgress } from '@mui/material';
import axios from 'axios';

const SimilarIncidents = ({ similarIncidentsData, problemIncident, onSimilarIncidentsFetched }) => {
  const [incidentNumber, setIncidentNumber] = useState(problemIncident.incident_number || '');
  const [shortDescription, setShortDescription] = useState(problemIncident.short_description || '');
  const [similarIncidents, setSimilarIncidents] = useState(similarIncidentsData || []);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false); // Spinner state
  const [progressMessage, setProgressMessage] = useState(''); // Progress message

  // New state for metadata-based field selection
  const [metadataLabels, setMetadataLabels] = useState([]); // Labels from metadata
  const [selectedLabels, setSelectedLabels] = useState([]); // Labels selected by the user
  const [fieldValues, setFieldValues] = useState({}); // Values entered for selected fields


  const handleFetchSimilarIncidents = async () => {
    setError(null);
    setSimilarIncidents([]);
    setLoading(true); // Show spinner
    setProgressMessage('Fetching similar incidents from ServiceNow...'); // Stage 1

    try {
      // Step 1: Fetch similar incidents from ServiceNow
      const response = await axios.get('http://127.0.0.1:5000/similar_incidents', {
        params: {
          incident_number: incidentNumber,
          incident_short_description: shortDescription,
        },
      });

      if (response.data.similar_incidents) {
        setProgressMessage('Verifying similar incidents with LLM...'); // Stage 2

        // Simulate LLM verification delay (for demonstration purposes)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        setSimilarIncidents(response.data.similar_incidents);
        onSimilarIncidentsFetched(response.data.similar_incidents, {
          incident_number: incidentNumber,
          short_description: shortDescription,
        });

        setProgressMessage('Ready to display similar incidents.'); // Stage 3
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay before removing spinner
      } else {
        setError('No similar incidents found.');
      }
    } catch (err) {
      setError('Failed to fetch similar incidents. Please try again.');
    } finally {
      setLoading(false); // Hide spinner
      setProgressMessage(''); // Clear progress message
    }
  };

  return (
    <Paper elevation={3} sx={{ padding: '20px', marginTop: '20px' }}>
      <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '20px' }}>
        Find Similar Incidents
      </Typography>

      {loading && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
            padding: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.05)', // Light background for spinner section
            borderRadius: '8px',
          }}
        >
          <CircularProgress size={40} sx={{ color: '#004aad', marginBottom: '10px' }} />
          <Typography
            variant="body1"
            sx={{
              color: '#004aad',
              fontWeight: 'bold',
              textAlign: 'center',
              fontSize: '1.2rem',
            }}
          >
            {progressMessage}
          </Typography>
        </Box>
      )}

      <Box sx={{ marginBottom: '20px' }}>
        <TextField
          label="Incident Number"
          variant="outlined"
          fullWidth
          value={incidentNumber}
          onChange={(e) => setIncidentNumber(e.target.value)}
          sx={{ marginBottom: '15px' }}
        />
        <Typography variant="body1" sx={{ textAlign: 'center', marginBottom: '10px' }}>
          OR
        </Typography>
        <TextField
          label="Short Description"
          variant="outlined"
          fullWidth
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          sx={{ marginBottom: '15px' }}
        />
        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={handleFetchSimilarIncidents}
          disabled={loading} // Disable button while loading
          sx={{ padding: '10px', fontWeight: 'bold' }}
        >
          {loading ? 'Fetching...' : 'Fetch Similar Incidents'}
        </Button>
      </Box>

      {error && (
        <Typography variant="body1" color="error" sx={{ marginTop: '20px' }}>
          {error}
        </Typography>
      )}

      {similarIncidents.length > 0 && (
        <Box sx={{ marginTop: '20px' }}>
          <Typography variant="h6" component="h3" sx={{ marginBottom: '10px' }}>
            Similar Incidents:
          </Typography>
          <List>
            {similarIncidents.map((incident, index) => (
              <ListItem key={index} sx={{ borderBottom: '1px solid #ddd' }}>
                <ListItemText
                  primary={`Incident Number: ${incident.number}`}
                  secondary={`Short Description: ${incident.short_description}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Paper>
  );
};

export default SimilarIncidents;