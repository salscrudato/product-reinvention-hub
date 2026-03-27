const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",  // Allow your React app on localhost:3000 to connect
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Enable CORS for all HTTP routes
app.use(cors({
  origin: 'http://localhost:3000',  // Allow React app to connect
  methods: ['GET', 'POST'],
  credentials: true
}));

// Example endpoint (you can remove if unnecessary)
app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

io.on('connection', (socket) => {
  console.log('A user connected');
  
  // Listen for the 'newData' event from Python
  socket.on('newData', (data) => {
    console.log('Received new data:', data);
    
    // Emit the data back to the React frontend (client)
    io.emit('newDataReceived', data);  // Emit to all connected clients (React app)
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start the server
const port = 5000;
server.listen(port, () => {
  console.log(`Express server running on http://localhost:${port}`);
});
