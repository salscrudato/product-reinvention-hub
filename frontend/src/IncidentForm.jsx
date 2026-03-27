import React, { useState } from 'react';
import { analyzeIncident } from './api';
import { Box, TextField, Button, Typography, Paper } from '@mui/material';
import ResponseTable from './ResponseTable'; // Import the new component

const IncidentForm = () => {
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
      const result = await analyzeIncident(incidentNumber, question, folderPath);
      setResponse({
        incident_number: incidentNumber,
        question: question,
        folder_path: folderPath,
        response: result.response, // Assuming the API returns a "response" field
      });
    } catch (err) {
      setError('Failed to fetch response. Please try again.');
    }
  };

  return (
    <Box sx={{ padding: '20px', maxWidth: '600px', margin: '20px auto' }}>
      <Paper elevation={3} sx={{ padding: '20px' }}>
        <Typography variant="h5" component="h2" sx={{ marginBottom: '20px', textAlign: 'center' }}>
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

        {response && <ResponseTable response={response} />} {/* Use the new component */}

        {error && (
          <Typography variant="body1" color="error" sx={{ marginTop: '20px' }}>
            {error}
          </Typography>
        )}
      </Paper>
    </Box>
  );
};

export default IncidentForm;