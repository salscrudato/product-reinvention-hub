import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Modal } from '@mui/material';

const PromptAndQuestionModal = ({ onSubmit }) => {
  const [isOpen, setIsOpen] = useState(false); // Modal open/close state
  const [userQuestion, setUserQuestion] = useState(''); // User question input
  const [prompt, setPrompt] = useState(''); // Prompt input

  const handleSubmit = () => {
    // Pass the user question and prompt to the parent component
    onSubmit({ userQuestion, prompt });
    setUserQuestion('');
    setPrompt('');
    setIsOpen(false); // Close the modal
  };

  return (
    <Box>
      {/* Button to open the modal */}
      <Button
        variant="contained"
        color="primary"
        onClick={() => setIsOpen(true)}
        sx={{ marginBottom: '20px', fontWeight: 'bold' }}
      >
        Add Prompt and Question
      </Button>

      {/* Modal Dialog */}
      <Modal open={isOpen} onClose={() => setIsOpen(false)}>
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
            onClick={handleSubmit}
            sx={{ padding: '10px', fontWeight: 'bold' }}
          >
            Submit
          </Button>
        </Box>
      </Modal>
    </Box>
  );
};

export default PromptAndQuestionModal;