import React, { useState, useEffect } from 'react';
import './App.css';  // Import the CSS file to style the components
import DataReceiver from './DataReceiver';  // Import the DataReceiver component
import DevCopilot from './DevCopilot';
import MainTabs from './MainTabs';

function App() {
  const [showDevCopilot, setShowDevCopilot] = useState(false);

  useEffect(() => {
    alert('App.js loaded: MainTabs should be visible');
    console.log('App.js loaded: MainTabs should be visible');
  }, []);

  if (showDevCopilot) {
    return (
      <div className="flash-transition">
        <DevCopilot />
        <button onClick={() => setShowDevCopilot(false)} style={{ position: 'fixed', top: 20, left: 20, zIndex: 1001 }}>Back</button>
      </div>
    );
  }

  return (
    <MainTabs />
  );
}

export default App;
