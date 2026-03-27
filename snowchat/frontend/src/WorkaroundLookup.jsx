import React, { useState } from 'react';
import {
  Typography,
  Box,
  Paper,
  Button,
  CircularProgress,
  TextField,
  List,
  ListItem,
  ListItemText,
  Modal,
} from '@mui/material';
import { styled } from '@mui/system';
import axios from 'axios';

// Styled Modal Box
const StyledModalBox = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '80%',
  maxHeight: '80%',
  overflowY: 'auto',
  backgroundColor: 'white',
  border: '2px solid #004aad',
  boxShadow: 24,
  padding: theme.spacing(4),
  borderRadius: '8px',
}));

const WorkaroundLookup = ({ problemIncident, similarIncidents, businessContext }) => {
  const [question, setQuestion] = useState(''); // User's natural language question
  const [llmResponse, setLlmResponse] = useState(''); // GPT response
  const [loading, setLoading] = useState(false); // Loading state
  const [error, setError] = useState(null); // Error state
  const [isModalOpen, setIsModalOpen] = useState(false); // Modal state

  // Handle the "Ask Question" button click
  const handleAskQuestion = async () => {
    if (!question) {
      setError('Please enter a question.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post('http://localhost:5000/workaround_lookup', {
        similar_incident_ids: similarIncidents.map((incident) => incident.number), // Pass incident numbers
        business_context: businessContext, // Pass business context
        question,
      });
      setLlmResponse(formatResponse(response.data.response)); // Format the response
      setIsModalOpen(true); // Open the modal
    } catch (err) {
      console.error('Error querying LLM:', err);
      setError('Failed to query LLM. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Format the response for better readability
  const formatResponse = (response) => {
    if (!response) return 'No response available.';
    return response
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line) // Remove empty lines
      .join('\n\n'); // Add spacing between paragraphs
  };

  return (
    <Paper elevation={3} sx={{ padding: '20px' }}>
      <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '10px' }}>
        Workaround Lookup
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: '20px' }}>
        <strong>Problem Incident:</strong> {problemIncident.short_description || 'No problem incident provided.'}
      </Typography>

      {/* Display Similar Incidents */}
      <Typography variant="h6" sx={{ marginBottom: '10px' }}>
        Similar Incidents:
      </Typography>
      <List>
        {similarIncidents.length > 0 ? (
          similarIncidents.map((incident, index) => (
            <ListItem key={index} sx={{ marginBottom: '10px' }}>
              <ListItemText
                primary={`Incident Number: ${incident.number}`}
                secondary={`Short Description: ${incident.short_description}`}
              />
            </ListItem>
          ))
        ) : (
          <Typography>No similar incidents available.</Typography>
        )}
      </List>

      {/* Display Business Context */}
      <Typography variant="h6" sx={{ marginTop: '20px', marginBottom: '10px' }}>
        Business Context:
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: '20px' }}>
        {businessContext || 'No business context available.'}
      </Typography>

      {/* Ask Question */}
      <Box sx={{ marginTop: '20px' }}>
        <TextField
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          fullWidth
          variant="outlined"
          placeholder="Ask a question about the similar incidents or business context"
          sx={{ marginBottom: '20px' }}
        />
        <Button
          variant="contained"
          onClick={handleAskQuestion}
          disabled={loading}
          sx={{ padding: '10px 20px', fontWeight: 'bold', fontSize: '16px' }}
        >
          {loading ? <CircularProgress size={24} /> : 'Ask Question'}
        </Button>
      </Box>

      {/* Error Message */}
      {error && (
        <Typography variant="body1" sx={{ color: 'red', marginTop: '20px' }}>
          {error}
        </Typography>
      )}

      {/* Modal for Response */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <StyledModalBox>
          <Typography variant="h6" sx={{ marginBottom: '10px', color: '#004aad', fontWeight: 'bold' }}>
            Accenture ServiceNow Tool Response:
          </Typography>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
            {llmResponse}
          </Typography>
          <Box sx={{ textAlign: 'right', marginTop: '20px' }}>
            <Button variant="contained" onClick={() => setIsModalOpen(false)}>
              Close
            </Button>
          </Box>
        </StyledModalBox>
      </Modal>
    </Paper>
  );
};

export default WorkaroundLookup;