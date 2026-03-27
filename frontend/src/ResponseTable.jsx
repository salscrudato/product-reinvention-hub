import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography, Box } from '@mui/material';

const ResponseTable = ({ response }) => {
  if (!response) {
    return null; // Do not render anything if there is no response
  }

  return (
    <Box sx={{ marginTop: '20px' }}>
      <Typography
        variant="h6"
        component="h3"
        sx={{ marginBottom: '10px', textAlign: 'center', color: '#004aad', fontWeight: 'bold' }}
      >
        ServiceNow API Response
      </Typography>
      <TableContainer component={Paper} elevation={3}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ backgroundColor: '#004aad', color: 'white', fontWeight: 'bold' }}>Field</TableCell>
              <TableCell sx={{ backgroundColor: '#004aad', color: 'white', fontWeight: 'bold' }}>Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', color: '#004aad' }}>Incident Number</TableCell>
              <TableCell>{response.incident_number}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', color: '#004aad' }}>Question</TableCell>
              <TableCell>{response.question}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', color: '#004aad' }}>Folder Path</TableCell>
              <TableCell>{response.folder_path}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', color: '#004aad' }}>Response</TableCell>
              <TableCell sx={{ color: '#2e7d32', fontWeight: 'bold' }}>{response.response}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default ResponseTable;