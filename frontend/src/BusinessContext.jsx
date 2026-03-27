import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, Select, MenuItem, Button, CircularProgress, TextField } from '@mui/material';
import axios from 'axios';

const BusinessContext = () => {
  const [indices, setIndices] = useState([]); // List of available FAISS indices
  const [selectedIndex, setSelectedIndex] = useState(''); // User-selected index
  const [problemStatement, setProblemStatement] = useState(''); // Problem statement input
  const [llmResponse, setLlmResponse] = useState(''); // Response from OpenAI LLM
  const [loading, setLoading] = useState(false); // Loading state
  const [error, setError] = useState(null); // Error state

  // Fetch available FAISS indices on component mount
  useEffect(() => {
    const fetchIndices = async () => {
      try {
        const response = await axios.get('http://localhost:5000/faiss_indices'); // Backend endpoint to fetch indices
        setIndices(response.data.indices);
      } catch (err) {
        console.error('Error fetching indices:', err);
        setError('Failed to fetch indices. Please try again.');
      }
    };

    fetchIndices();
  }, []);

  // Handle the "Retrieve Context" button click
  const handleRetrieveContext = async () => {
    if (!selectedIndex || !problemStatement) {
      setError('Please select an index and provide a problem statement.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Call the retrieve_context API
      const response = await axios.post('http://localhost:5000/retrieve_context', {
        index: selectedIndex,
        problem_statement: problemStatement,
      });

      // Step 2: Set the LLM response
      setLlmResponse(response.data.response);
    } catch (err) {
      console.error('Error retrieving context or querying LLM:', err);
      setError('Failed to retrieve context or query LLM. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper elevation={3} sx={{ padding: '20px' }}>
      <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '10px' }}>
        Business Context
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: '20px', fontStyle: 'italic', color: '#555' }}>
        This page lets you search in the related business rules vector index (the index you select).
      </Typography>

      {/* Select FAISS Index */}
      <Box sx={{ marginBottom: '20px' }}>
        <Typography variant="body1" sx={{ marginBottom: '10px' }}>
          Select FAISS Index
        </Typography>
        <Select
          value={selectedIndex}
          onChange={(e) => setSelectedIndex(e.target.value)}
          fullWidth
          displayEmpty
        >
          <MenuItem value="" disabled>
            Select an index
          </MenuItem>
          {indices.map((index) => (
            <MenuItem key={index} value={index}>
              {index}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {/* Input Problem Statement */}
      <Box sx={{ marginBottom: '20px' }}>
        <Typography variant="body1" sx={{ marginBottom: '10px' }}>
          Enter Problem Statement
        </Typography>
        <TextField
          value={problemStatement}
          onChange={(e) => setProblemStatement(e.target.value)}
          fullWidth
          variant="outlined"
          placeholder="Describe the problem statement"
        />
      </Box>

      {/* Retrieve Context Button */}
      <Box sx={{ textAlign: 'center', marginBottom: '20px' }}>
        <Button
          variant="contained"
          onClick={handleRetrieveContext}
          disabled={loading}
          sx={{ padding: '10px 20px', fontWeight: 'bold', fontSize: '16px' }}
        >
          {loading ? <CircularProgress size={24} /> : 'Retrieve Context and Query LLM'}
        </Button>
      </Box>

      {/* Loader and Error Message */}
      {loading && (
        <Box sx={{ textAlign: 'center', marginBottom: '20px' }}>
          <Typography
            variant="h6"
            sx={{
              color: '#ff5722',
              fontWeight: 'bold',
              animation: 'pulse 1.5s infinite',
              '@keyframes pulse': {
                '0%': { opacity: 0.5 },
                '50%': { opacity: 1 },
                '100%': { opacity: 0.5 },
              },
            }}
          >
            Retrieving context and querying LLM...
          </Typography>
        </Box>
      )}
      {error && (
        <Typography variant="body1" sx={{ color: 'red', marginBottom: '20px' }}>
          {error}
        </Typography>
      )}

      {/* LLM Response */}
      {llmResponse && (
        <Box sx={{ marginBottom: '20px' }}>
          <Typography variant="body1" sx={{ fontWeight: 'bold', marginBottom: '10px' }}>
            LLM Response
          </Typography>
          <Paper
            elevation={1}
            sx={{
              padding: '10px',
              backgroundColor: '#f9f9f9',
              maxHeight: '300px', // Set a fixed height
              overflowY: 'auto', // Enable vertical scrolling
              border: '1px solid #ddd',
              borderRadius: '8px',
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {llmResponse}
            </Typography>
          </Paper>
        </Box>
      )}
    </Paper>
  );
};

export default BusinessContext;