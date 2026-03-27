import React from 'react';
import BarChartIcon from '@mui/icons-material/BarChart';
import { IconButton } from '@mui/material';

export default function FeedbackAnalyticsIcon({ onClick, color = '#1976d2' }) {
  return (
    <IconButton onClick={onClick} title="View Feedback Analytics" sx={{ color, bgcolor: 'transparent', '&:hover': { bgcolor: '#e3f2fd' } }}>
      <BarChartIcon fontSize="large" />
    </IconButton>
  );
}
