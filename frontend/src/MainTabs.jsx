import React, { useState } from 'react';
import { Tabs, Tab, Box, Paper, Grid, Typography } from '@mui/material';
import SimilarIncidents from './SimilarIncidents';
import SmartResolution from './SmartResolution';
import WorkaroundLookup from './WorkaroundLookup';
import SmartAssignment from './SmartAssignment';
import DevCopilot from './DevCopilot';
import TokenUsageTab from './TokenUsageTab';
import PromptManagerPage from './PromptManagerPage';
import HealthStatus from './HealthStatus';

const MainTabs = () => {
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <div
      style={{
        backgroundImage: 'url(/background.png)', // Use background.png from the public folder
        backgroundSize: 'cover', // Ensure the image covers the entire viewport
        backgroundRepeat: 'no-repeat', // Prevent the image from repeating
        backgroundAttachment: 'fixed', // Keep the background fixed during scrolling
        backgroundPosition: 'center center', // Center the image
        minHeight: '100vh', // Full viewport height
        display: 'flex', // Use flexbox for layout
        flexDirection: 'column', // Stack content vertically
      }}
    >
      {/* Header Section */}
      <Box
        sx={{
          backgroundColor: 'rgba(0, 0, 0, 0.6)', // Semi-transparent black background for contrast
          color: 'white',
          padding: '20px',
          textAlign: 'center',
          boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold' }}>
          Accenture Service Now GenAI Tool
        </Typography>
        {/* Health Status Icon in top-right corner of header */}
        <Box sx={{ position: 'absolute', right: 20 }}>
          <HealthStatus />
        </Box>
      </Box>

      {/* Main Content Section */}
      <Grid
        container
        justifyContent="center"
        alignItems="center"
        sx={{
          flex: 1, // Take up remaining space
          padding: { xs: '10px', sm: '20px', md: '40px' }, // Adjust padding for different screen sizes
        }}
      >
        <Grid item xs={12} sm={10} md={8} lg={6}>
          <Paper
            elevation={4}
            sx={{
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 10px rgba(0, 0, 0, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.8)', // Semi-transparent white background
            }}
          >
            <Tabs
              value={activeTab}
              onChange={handleTabChange}
              indicatorColor="primary"
              textColor="inherit"
              variant="fullWidth"
              sx={{
                backgroundColor: '#004aad',
                '& .MuiTab-root': {
                  color: '#fff',
                  fontWeight: 'bold',
                  textTransform: 'none',
                  padding: '12px 16px', // Ensure consistent padding
                  minHeight: '48px', // Ensure consistent height
                },
                '& .Mui-selected': {
                  color: '#fff',
                },
                '& .MuiTabs-indicator': {
                  backgroundColor: '#fff', // Ensure the indicator is visible
                },
              }}
            >
              <Tab label="DevCopilot" />
              <Tab label="Similar Incidents" />
              <Tab label="Smart Resolution" />
              <Tab label="Workaround Lookup" />
              <Tab label="Smart Assignment" />
              <Tab label="Token Usage" />
              <Tab label="Prompts" />
            </Tabs>
          </Paper>

          <Box
            sx={{
              marginTop: '20px',
              padding: { xs: '10px', sm: '20px', md: '30px' }, // Adjust padding for different screen sizes
              backgroundColor: 'rgba(255, 255, 255, 0.7)', // Semi-transparent white background
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              height: { xs: '400px', sm: '500px', md: '600px' }, // Adjust height for different screen sizes
              overflow: 'auto',
            }}
          >
            <Typography
              variant="h5"
              sx={{
                color: '#004aad',
                fontWeight: 'bold',
                marginBottom: '20px',
                textAlign: 'center',
              }}
            >
              {activeTab === 0 && 'DevCopilot'}
              {activeTab === 1 && 'Similar Incidents'}
              {activeTab === 2 && 'Smart Resolution'}
              {activeTab === 3 && 'Workaround Lookup'}
              {activeTab === 4 && 'Smart Assignment'}
              {activeTab === 5 && 'Token Usage'}
              {activeTab === 6 && 'Prompt Manager'}
            </Typography>

            {activeTab === 0 && <DevCopilot />}
            {activeTab === 1 && <SimilarIncidents />}
            {activeTab === 2 && <SmartResolution />}
            {activeTab === 3 && <WorkaroundLookup />}
            {activeTab === 4 && <SmartAssignment />}
            {activeTab === 5 && <TokenUsageTab username={null} />}
            {activeTab === 6 && <PromptManagerPage />}
          </Box>
        </Grid>
      </Grid>
    </div>
  );
};

export default MainTabs;