import React, { useState } from 'react';
import { Box, Typography, Paper, TextField, Button, CircularProgress, MenuItem, Select } from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import axios from 'axios';

const ExtractLogs = () => {
  const [dataSource, setDataSource] = useState('Splunk'); // Splunk or DataDog
  const [indices, setIndices] = useState(['']); // Array of indices (for Splunk)
  const [keyValuePairs, setKeyValuePairs] = useState([{ key: '', value: '' }]); // Array of key-value pairs
  const [fromTimestamp, setFromTimestamp] = useState(dayjs());
  const [toTimestamp, setToTimestamp] = useState(dayjs());
  const [generatedQuery, setGeneratedQuery] = useState(''); // For displaying the generated query
  const [loading, setLoading] = useState(false); // Loading state

  // Function to fetch the generated query using OpenAI
  const handleGenerateQuery = async () => {
    setLoading(true); // Start loading
    try {
      const payload = {
        data_source: dataSource,
        indexes: indices.filter((index) => index), // Only include non-empty indices
        key_values: Object.fromEntries(
          keyValuePairs.filter((pair) => pair.key && pair.value).map((pair) => [pair.key, pair.value])
        ), // Convert key-value pairs to an object
        timestamp_start: fromTimestamp.format('YYYY-MM-DDTHH:mm:ss'),
        timestamp_end: toTimestamp.format('YYYY-MM-DDTHH:mm:ss'),
      };

      const endpoint =
        dataSource === 'Splunk'
          ? 'http://localhost:5000/generate_splunk_query'
          : 'http://localhost:5000/generate_query';

      const response = await axios.post(endpoint, payload);
      setGeneratedQuery(response.data.query); // Display the generated query
    } catch (error) {
      console.error('Error generating query:', error);
      setGeneratedQuery('Failed to generate query.');
    } finally {
      setLoading(false); // Stop loading
    }
  };

  const handleAddIndex = () => {
    setIndices([...indices, '']);
  };

  const handleRemoveIndex = (index) => {
    setIndices(indices.filter((_, i) => i !== index));
  };

  const handleIndexChange = (index, value) => {
    const updatedIndices = [...indices];
    updatedIndices[index] = value;
    setIndices(updatedIndices);
  };

  const handleAddKeyValuePair = () => {
    setKeyValuePairs([...keyValuePairs, { key: '', value: '' }]);
  };

  const handleRemoveKeyValuePair = (index) => {
    setKeyValuePairs(keyValuePairs.filter((_, i) => i !== index));
  };

  const handleKeyValueChange = (index, field, value) => {
    const updatedKeyValuePairs = [...keyValuePairs];
    updatedKeyValuePairs[index][field] = value;
    setKeyValuePairs(updatedKeyValuePairs);
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Paper elevation={3} sx={{ padding: '20px', marginTop: '20px' }}>
        <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '20px' }}>
          Extract Logs
        </Typography>

        {/* Data Source Selection */}
        <Box sx={{ marginBottom: '20px' }}>
          <Typography variant="body1" sx={{ marginBottom: '10px' }}>
            Select Data Source
          </Typography>
          <Select
            value={dataSource}
            onChange={(e) => setDataSource(e.target.value)}
            fullWidth
            sx={{ marginBottom: '15px' }}
          >
            <MenuItem value="Splunk">Splunk</MenuItem>
            <MenuItem value="DataDog">DataDog</MenuItem>
          </Select>
        </Box>

        {/* Splunk-Specific Fields */}
        {dataSource === 'Splunk' && (
          <Box sx={{ marginBottom: '20px' }}>
            <Typography variant="body1" sx={{ marginBottom: '10px' }}>
              Indices
            </Typography>
            {indices.map((index, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <TextField
                  value={index}
                  onChange={(e) => handleIndexChange(i, e.target.value)}
                  fullWidth
                  variant="outlined"
                  placeholder="Enter index"
                  sx={{ marginRight: '10px' }}
                />
                <Button variant="contained" color="error" onClick={() => handleRemoveIndex(i)}>
                  Remove
                </Button>
              </Box>
            ))}
            <Button variant="contained" onClick={handleAddIndex}>
              Add Index
            </Button>
          </Box>
        )}

        {/* Common Fields */}
        <Box sx={{ marginBottom: '20px' }}>
          <Typography variant="body1" sx={{ marginBottom: '10px' }}>
            Key-Value Pairs
          </Typography>
          {keyValuePairs.map((pair, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
              <TextField
                value={pair.key}
                onChange={(e) => handleKeyValueChange(i, 'key', e.target.value)}
                fullWidth
                variant="outlined"
                placeholder="Enter key"
                sx={{ marginRight: '10px' }}
              />
              <TextField
                value={pair.value}
                onChange={(e) => handleKeyValueChange(i, 'value', e.target.value)}
                fullWidth
                variant="outlined"
                placeholder="Enter value"
                sx={{ marginRight: '10px' }}
              />
              <Button variant="contained" color="error" onClick={() => handleRemoveKeyValuePair(i)}>
                Remove
              </Button>
            </Box>
          ))}
          <Button variant="contained" onClick={handleAddKeyValuePair}>
            Add Key-Value Pair
          </Button>
        </Box>

        {/* Timestamp Fields */}
        <Box sx={{ marginBottom: '20px' }}>
          <Typography variant="body1" sx={{ marginBottom: '10px' }}>
            Timestamps
          </Typography>
          <Box sx={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ marginBottom: '5px' }}>
                From
              </Typography>
              <DateTimePicker
                value={fromTimestamp}
                onChange={(newValue) => setFromTimestamp(newValue)}
                renderInput={(props) => <TextField {...props} fullWidth />}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ marginBottom: '5px' }}>
                To
              </Typography>
              <DateTimePicker
                value={toTimestamp}
                onChange={(newValue) => setToTimestamp(newValue)}
                renderInput={(props) => <TextField {...props} fullWidth />}
              />
            </Box>
          </Box>
        </Box>

        {/* Generate Query Button */}
        <Box sx={{ textAlign: 'center', marginBottom: '20px' }}>
          <Button
            variant="contained"
            onClick={handleGenerateQuery}
            disabled={loading}
            sx={{ padding: '10px 20px', fontWeight: 'bold', fontSize: '16px' }}
          >
            {loading ? <CircularProgress size={24} /> : 'Generate Query using LLM'}
          </Button>
        </Box>

        {/* Loader with Message */}
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
              LLM is working on the Query...
            </Typography>
          </Box>
        )}

        {/* Generated Query */}
        <Box sx={{ marginBottom: '20px' }}>
          <Typography variant="body1" sx={{ marginBottom: '10px' }}>
            Generated Query
          </Typography>
          <TextField
            value={generatedQuery}
            fullWidth
            variant="outlined"
            multiline
            rows={4}
            InputProps={{
              readOnly: true,
            }}
          />
        </Box>
      </Paper>
    </LocalizationProvider>
  );
};

export default ExtractLogs;