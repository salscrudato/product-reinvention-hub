import React, { useState } from 'react';
import { Stepper, Step, StepLabel, Box, Paper, Grid, Button, Typography, Radio, RadioGroup, FormControlLabel } from '@mui/material';
import SimilarIncidents from './SimilarIncidents';
import AdvancedSimilarIncidentLookup from './AdvancedSimilarIncidentLookup';
import SmartAssignment from './SmartAssignment';
import ExtractLogs from './ExtractLogs';
import BusinessContext from './BusinessContext';
import WorkaroundLookup from './WorkaroundLookup';
import SmartResolution from './SmartResolution';

const steps = ['Find Similar Incidents', 'Smart Assignment', 'Extract Logs', 'Business Context', 'Workaround Lookup', 'Smart Resolution'];

const MainStepper = () => {
  const [activeStep, setActiveStep] = useState(0);

  // State for each step
  const [similarIncidentsData, setSimilarIncidentsData] = useState([]);
  const [problemIncident, setProblemIncident] = useState({});
  const [assignmentGroup, setAssignmentGroup] = useState(null);
  const [extractLogsData, setExtractLogsData] = useState({
    referenceType: '',
    referenceNumber: '',
    fromTimestamp: null,
    toTimestamp: null,
    query: '',
  });
  const [businessContext, setBusinessContext] = useState('');

  // New state for lookup mode
  const [useAdvancedLookup, setUseAdvancedLookup] = useState(false); // Toggle between simple and advanced lookup

  const handleNext = () => {
    setActiveStep((prevStep) => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
  };

  const handleReset = () => {
    setActiveStep(0);
    setSimilarIncidentsData([]);
    setProblemIncident({});
    setAssignmentGroup(null);
  };

  const renderStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box>
            {/* Toggle for Simple or Advanced Lookup */}
            <Typography variant="h6" sx={{ marginBottom: '20px', fontWeight: 'bold', color: '#004aad' }}>
              Choose Lookup Mode:
            </Typography>
            <Box sx={{ display: 'flex', gap: '20px', justifyContent: 'center', marginBottom: '20px' }}>
              <Box
                onClick={() => setUseAdvancedLookup(false)}
                sx={{
                  cursor: 'pointer',
                  padding: '20px',
                  border: useAdvancedLookup ? '1px solid #ccc' : '2px solid #004aad',
                  borderRadius: '8px',
                  backgroundColor: useAdvancedLookup ? '#f9f9f9' : '#e3f2fd',
                  textAlign: 'center',
                  width: '200px',
                  boxShadow: useAdvancedLookup ? 'none' : '0 4px 10px rgba(0, 0, 0, 0.2)',
                  transition: 'all 0.3s ease',
                }}
              >
                <Typography variant="body1" sx={{ fontWeight: 'bold', color: useAdvancedLookup ? '#555' : '#004aad' }}>
                  Simple Lookup
                </Typography>
                <Typography variant="body2" sx={{ color: useAdvancedLookup ? '#777' : '#004aad' }}>
                  Quickly find similar incidents.
                </Typography>
              </Box>
              <Box
                onClick={() => setUseAdvancedLookup(true)}
                sx={{
                  cursor: 'pointer',
                  padding: '20px',
                  border: useAdvancedLookup ? '2px solid #004aad' : '1px solid #ccc',
                  borderRadius: '8px',
                  backgroundColor: useAdvancedLookup ? '#e3f2fd' : '#f9f9f9',
                  textAlign: 'center',
                  width: '200px',
                  boxShadow: useAdvancedLookup ? '0 4px 10px rgba(0, 0, 0, 0.2)' : 'none',
                  transition: 'all 0.3s ease',
                }}
              >
                <Typography variant="body1" sx={{ fontWeight: 'bold', color: useAdvancedLookup ? '#004aad' : '#555' }}>
                  Advanced Lookup
                </Typography>
                <Typography variant="body2" sx={{ color: useAdvancedLookup ? '#004aad' : '#777' }}>
                  Customize your search with additional fields.
                </Typography>
              </Box>
            </Box>

            {/* Render the appropriate component based on the selected mode */}
            {useAdvancedLookup ? (
              <AdvancedSimilarIncidentLookup
                onSimilarIncidentsFetched={(data) => {
                  setSimilarIncidentsData(data);
                }}
              />
            ) : (
              <SimilarIncidents
                similarIncidentsData={similarIncidentsData}
                problemIncident={problemIncident}
                onSimilarIncidentsFetched={(data, problemIncidentDetails) => {
                  setSimilarIncidentsData(data);
                  setProblemIncident(problemIncidentDetails);
                }}
              />
            )}
          </Box>
        );
      case 1:
        return (
          <SmartAssignment
            similarIncidents={similarIncidentsData}
            problemIncident={problemIncident}
            onAssignmentGroupSelected={(group) => {
              setAssignmentGroup(group);
            }}
          />
        );
      case 2:
        return (
          <ExtractLogs
            extractLogsData={extractLogsData}
            onExtractLogsChange={(data) => setExtractLogsData(data)}
          />
        );
      case 3:
        return (
          <BusinessContext
            onBusinessContextFetched={(context) => {
              setBusinessContext(context);
            }}
          />
        );
      case 4:
        return (
          <WorkaroundLookup
            similarIncidents={similarIncidentsData}
            problemIncident={problemIncident}
            businessContext={businessContext}
          />
        );
      case 5:
        return <SmartResolution />;
      default:
        return 'Unknown step';
    }
  };

  return (
    <div
      style={{
        backgroundImage: 'url(/background.png)',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        backgroundPosition: 'center center',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header Section */}
      <Box
        sx={{
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          color: 'white',
          padding: '20px',
          textAlign: 'center',
          boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
        }}
      >
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold' }}>
          Accenture Service Now GenAI Tool
        </Typography>
      </Box>

      {/* Stepper and Content Section */}
      <Grid
        container
        justifyContent="center"
        alignItems="center"
        sx={{
          flex: 1,
          padding: { xs: '10px', sm: '20px', md: '40px' },
        }}
      >
        <Grid item xs={12} sm={10} md={8} lg={6}>
          <Paper
            elevation={4}
            sx={{
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 10px rgba(0, 0, 0, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              padding: '20px',
            }}
          >
            <Stepper activeStep={activeStep} alternativeLabel>
              {steps.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            <Box sx={{ marginTop: '20px' }}>
              {activeStep === steps.length ? (
                <Box>
                  <Typography sx={{ mt: 2, mb: 1 }}>All steps completed - you&apos;re finished</Typography>
                  <Button onClick={handleReset}>Reset</Button>
                </Box>
              ) : (
                <Box>
                  {renderStepContent(activeStep)}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleBack}
                      disabled={activeStep === 0}
                      sx={{ padding: '10px', fontWeight: 'bold' }}
                    >
                      Back
                    </Button>
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={handleNext}
                      sx={{ padding: '10px', fontWeight: 'bold' }}
                    >
                      Next
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </div>
  );
};

export default MainStepper;