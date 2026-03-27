import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, List, ListItem, ListItemText, Select, MenuItem, CircularProgress } from '@mui/material';
import axios from 'axios';

const SmartAssignment = ({ similarIncidents, problemIncident, onAssignmentGroupSelected }) => {
  const [rankedGroups, setRankedGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRankedGroups = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await axios.post('http://127.0.0.1:5000/predict_assignment_group', {
          incident_number: problemIncident.incident_number,
          short_description: problemIncident.short_description,
          similar_incidents: similarIncidents,
        });

        if (response.data.ranked_groups) {
          setRankedGroups(response.data.ranked_groups);
          setSelectedGroup(response.data.ranked_groups[0]); // Default to the top-ranked group
        } else {
          setError('Failed to fetch ranked assignment groups.');
        }
      } catch (err) {
        setError('An error occurred while fetching ranked assignment groups.');
      } finally {
        setLoading(false);
      }
    };

    fetchRankedGroups();
  }, [similarIncidents, problemIncident]);

  const handleGroupSelection = () => {
    // Pass the selected group back to the parent component
    onAssignmentGroupSelected(selectedGroup);
  };

  return (
    <Paper elevation={3} sx={{ padding: '20px', marginTop: '20px' }}>
      <Typography variant="h5" component="h2" sx={{ color: '#004aad', fontWeight: 'bold', marginBottom: '20px' }}>
        Smart Assignment
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100px' }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {rankedGroups.length > 0 ? (
            <Box sx={{ marginBottom: '20px' }}>
              <Typography variant="body1" sx={{ marginBottom: '10px' }}>
                Select applicable Assignment Values from GenAI suggested values..
              </Typography>
              <Select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                fullWidth
                sx={{ marginBottom: '15px' }}
              >
                {rankedGroups.map((group, index) => (
                  <MenuItem key={index} value={group}>
                    {group}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          ) : (
            <Typography variant="body1" color="error">
              {error || 'No assignment groups available.'}
            </Typography>
          )}
        </>
      )}

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
    </Paper>
  );
};

export default SmartAssignment;