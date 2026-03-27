import React, { useState, useEffect } from 'react';
import { Box, TextField, Button, Typography, Paper, List, ListItem, ListItemText, CircularProgress, Modal } from '@mui/material';
import axios from 'axios';

const AdvancedSimilarIncidentLookup = ({ onSimilarIncidentsFetched }) => {
  const [metadataLabels, setMetadataLabels] = useState([]); // Labels from metadata
  const [selectedLabels, setSelectedLabels] = useState([]); // Labels selected by the user
  const [fieldValues, setFieldValues] = useState({}); // Values entered for selected fields
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false); // Spinner state
  const [loadingMetadata, setLoadingMetadata] = useState(true); // Spinner for metadata loading

  // Modal state for user question and prompt
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userQuestion, setUserQuestion] = useState('');
  const [prompt, setPrompt] = useState('');

  // Fetch metadata on component mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        setLoadingMetadata(true); // Show spinner while loading metadata
        const response = await axios.get('http://127.0.0.1:5000/incident_table_metadata');

        // Safely access the metadata array
        const referenceFieldsData =
          response.data?.metadata?.result?.referenceFieldsData?.incident?.fields || [];

        // Ensure it's an array before mapping
        if (Array.isArray(referenceFieldsData)) {
          const labels = referenceFieldsData.map((field) => ({
            name: field.name,
            label: field.label,
          }));
          setMetadataLabels(labels);
        } else {
          console.error('referenceFieldsData is not an array.');
          setMetadataLabels([]);
        }
      } catch (err) {
        console.error('Failed to fetch metadata:', err);
        setMetadataLabels([]); // Set an empty array if the fetch fails
      } finally {
        setLoadingMetadata(false); // Hide spinner after loading metadata
      }
    };

    fetchMetadata();
  }, []);

  // Handle moving labels from left to right
  const handleAddLabel = (label) => {
    setSelectedLabels((prev) => [...prev, label]);
    setMetadataLabels((prev) => prev.filter((item) => item !== label));
  };

  // Handle moving labels from right to left
  const handleRemoveLabel = (label) => {
    setMetadataLabels((prev) => [...prev, label]);
    setSelectedLabels((prev) => prev.filter((item) => item !== label));
    setFieldValues((prev) => {
      const updatedValues = { ...prev };
      delete updatedValues[label.name];
      return updatedValues;
    });
  };

  // Handle value input for selected fields
  const handleFieldValueChange = (label, value) => {
    setFieldValues((prev) => ({
      ...prev,
      [label.name]: value,
    }));
  };

  // Handle modal submission to invoke the MCP method
  const handlePerformAnalysis = async () => {
    try {
      setLoading(true); // Show spinner
      const response = await axios.post('http://127.0.0.1:5000/mcp', {
        question: userQuestion,
        prompt,
        metadata: fieldValues, // Include metadata (user-entered field values)
      });
      console.log('MCP Response:', response.data);
      setIsModalOpen(false); // Close the modal
    } catch (err) {
      console.error('Failed to perform analysis:', err);
    } finally {
      setLoading(false); // Hide spinner
    }
  };

  return (
    <Paper elevation={3} sx={{ padding: '20px', marginTop: '20px' }}>
      <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '20px' }}>
        Advanced Similar Incident Lookup
      </Typography>

      {loadingMetadata ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100px' }}>
          <CircularProgress size={40} sx={{ color: '#004aad' }} />
          <Typography variant="body1" sx={{ marginLeft: '10px', color: '#004aad' }}>
            Loading ServiceNow Incident Fields...
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
          {/* Left Multi-Select Box */}
          <Box
            sx={{
              flex: 1,
              maxHeight: '300px',
              overflowY: 'auto',
              border: '2px solid #004aad',
              borderRadius: '8px',
              padding: '10px',
            }}
          >
            <Typography variant="h6" sx={{ marginBottom: '10px', color: '#004aad' }}>
              Available Fields
            </Typography>
            <List>
              {metadataLabels.map((label) => (
                <ListItem key={label.name} button onClick={() => handleAddLabel(label)}>
                  <ListItemText primary={label.label} />
                </ListItem>
              ))}
            </List>
          </Box>

          {/* Right Multi-Select Box */}
          <Box
            sx={{
              flex: 1,
              maxHeight: '300px',
              overflowY: 'auto',
              border: '2px solid #004aad',
              borderRadius: '8px',
              padding: '10px',
            }}
          >
            <Typography variant="h6" sx={{ marginBottom: '10px', color: '#004aad' }}>
              Selected Fields
            </Typography>
            <List>
              {selectedLabels.map((label) => (
                <ListItem key={label.name} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <ListItemText primary={label.label} />
                  <TextField
                    label={`Enter value for ${label.label}`}
                    variant="outlined"
                    fullWidth
                    onChange={(e) => handleFieldValueChange(label, e.target.value)}
                    sx={{ marginTop: '10px' }}
                  />
                  <Button
                    variant="text"
                    color="error"
                    onClick={() => handleRemoveLabel(label)}
                    sx={{ marginTop: '5px', alignSelf: 'flex-end' }}
                  >
                    Remove
                  </Button>
                </ListItem>
              ))}
            </List>
          </Box>
        </Box>
      )}

      {/* Button to open the modal */}
      <Button
        variant="contained"
        color="primary"
        fullWidth
        onClick={() => setIsModalOpen(true)}
        disabled={loading || loadingMetadata} // Disable button while loading
        sx={{ padding: '10px', fontWeight: 'bold', marginBottom: '20px' }}
      >
        Perform Autonomous Analysis
      </Button>

      {/* Modal Dialog */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '400px',
            bgcolor: 'background.paper',
            boxShadow: 24,
            p: 4,
            borderRadius: '8px',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 'bold', marginBottom: '20px', color: '#004aad' }}>
            Add Prompt and Question
          </Typography>
          <TextField
            label="User Question"
            variant="outlined"
            fullWidth
            value={userQuestion}
            onChange={(e) => setUserQuestion(e.target.value)}
            sx={{ marginBottom: '15px' }}
          />
          <TextField
            label="Prompt"
            variant="outlined"
            fullWidth
            multiline
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            sx={{ marginBottom: '15px' }}
          />
          <Button
            variant="contained"
            color="primary"
            onClick={handlePerformAnalysis}
            sx={{ padding: '10px', fontWeight: 'bold' }}
          >
            Submit and Analyze
          </Button>
        </Box>
      </Modal>

      {error && (
        <Typography variant="body1" color="error" sx={{ marginTop: '20px' }}>
          {error}
        </Typography>
      )}
    </Paper>
  );
};

export default AdvancedSimilarIncidentLookup;