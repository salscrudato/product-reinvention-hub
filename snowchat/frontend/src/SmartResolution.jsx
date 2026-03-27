import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Paper } from '@mui/material';
import axios from 'axios';

const SmartResolution = () => {
  const [incidentNumber, setIncidentNumber] = useState('');
  const [question, setQuestion] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setResponse(null);

    try {
      const result = await axios.post('http://127.0.0.1:5000/analyze_incident', {
        incident_number: incidentNumber,
        question: question,
        folder_path: folderPath,
      });
      setResponse(result.data);
    } catch (err) {
      setError('Failed to fetch response. Please try again.');
    }
  };

  return (
    <Paper elevation={3} sx={{ padding: '20px' }}>
      <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '20px' }}>
        Incident Analysis
      </Typography>
      <form onSubmit={handleSubmit}>
        <TextField
          label="Incident Number"
          variant="outlined"
          fullWidth
          value={incidentNumber}
          onChange={(e) => setIncidentNumber(e.target.value)}
          sx={{ marginBottom: '15px' }}
          required
        />
        <TextField
          label="Question"
          variant="outlined"
          fullWidth
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          sx={{ marginBottom: '15px' }}
          required
        />
        <TextField
          label="Folder Path"
          variant="outlined"
          fullWidth
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          sx={{ marginBottom: '15px' }}
          required
        />
        <Button
          type="submit"
          variant="contained"
          color="primary"
          fullWidth
          sx={{ padding: '10px', fontWeight: 'bold' }}
        >
          Submit
        </Button>
      </form>

      {response && (
        <Box sx={{ marginTop: '20px' }}>
          <Typography variant="h6" component="h3" sx={{ marginBottom: '10px' }}>
            Response:
          </Typography>
          <pre>{JSON.stringify(response, null, 2)}</pre>
        </Box>
      )}

      {error && (
        <Typography variant="body1" color="error" sx={{ marginTop: '20px' }}>
          {error}
        </Typography>
      )}
    </Paper>
  );
};

export default SmartResolution;