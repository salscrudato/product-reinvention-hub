import React from 'react';
import { Box, Typography } from '@mui/material';

const Header = () => {
  return (
    <Box
      sx={{
        backgroundColor: '#004aad',
        color: 'white',
        padding: '10px', // Reduce padding
        textAlign: 'center',
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
      }}
    >
      <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', margin: 0 }}>
        Accenture Service Now GenAI Tool
      </Typography>
    </Box>
  );
};

export default Header;