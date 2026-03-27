import React, { useEffect, useState } from 'react';
import { Drawer, Typography, IconButton, Divider, List, ListItem, ListItemText } from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import CloseIcon from '@mui/icons-material/Close';
import axios from 'axios';

export default function FeedbackAnalytics({ open, onClose }) {
  const [analytics, setAnalytics] = useState({ feedback_data: [], feedback_trends: {} });

  useEffect(() => {
    if (open) {
      axios.get('http://localhost:5000/feedback_analytics/feedback_analytics')
        .then(res => setAnalytics(res.data));
    }
  }, [open]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <div style={{ width: 400, padding: 24 }}>
        <Typography variant="h6" gutterBottom>
          <BarChartIcon style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Feedback Analytics
          <IconButton onClick={onClose} style={{ float: 'right' }}><CloseIcon /></IconButton>
        </Typography>
        <Divider />
        <Typography variant="subtitle1" sx={{ mt: 2 }}>Feedback Trends (Daily)</Typography>
        <List>
          {Object.entries(analytics.feedback_trends).map(([date, trend]) => (
            <ListItem key={date}>
              <ListItemText
                primary={date}
                secondary={`👍 ${trend.positive}   👎 ${trend.negative}`}
              />
            </ListItem>
          ))}
        </List>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1">Q&A Feedback</Typography>
        <List>
          {analytics.feedback_data.map((item, idx) => (
            <ListItem key={idx}>
              <ListItemText
                primary={<span><strong>Q:</strong> {item.question}<br /><strong>A:</strong> {item.answer}</span>}
                secondary={<span>
                  {item.function_sequence && <span><strong>Function:</strong> {JSON.stringify(item.function_sequence)}<br /></span>}
                  <span>{item.liked ? '👍' : '👎'} {item.timestamp}</span>
                </span>}
              />
            </ListItem>
          ))}
        </List>
      </div>
    </Drawer>
  );
}
