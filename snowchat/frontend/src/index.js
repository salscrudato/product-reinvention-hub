import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import MainStepper from './MainStepper';
import SnowChat from './SnowChat';
import DevCopilot from './DevCopilot';
import PromptManagerPage from './PromptManagerPage';
import reportWebVitals from './reportWebVitals';
import { initializeKeycloak } from './keycloak';
import keycloak from './keycloak';

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [showDevCopilot, setShowDevCopilot] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [inferredPersona, setInferredPersona] = useState('developer');

  const toggleDevCopilot = () => {
    setShowDevCopilot(prev => {
      const next = !prev;
      if (next) setShowPrompts(false); // enforce exclusivity
      return next;
    });
  };
  const togglePrompts = () => {
    setShowPrompts(prev => {
      const next = !prev;
      if (next) setShowDevCopilot(false); // enforce exclusivity
      return next;
    });
  };

  useEffect(() => {
    // Initialize Keycloak
    initializeKeycloak()
      .then((keycloakInstance) => {
        setIsAuthenticated(keycloakInstance.authenticated);
        if (keycloakInstance.authenticated) {
          keycloakInstance.loadUserInfo().then((info) => setUserInfo(info));
          // Infer persona from username heuristic (simple mapping)
          const uname = keycloakInstance.tokenParsed?.preferred_username || '';
          let guess = 'developer';
          if (/^po/i.test(uname)) guess = 'business_owner';
          else if (/^el/i.test(uname)) guess = 'engineering_lead';
          else if (/^dev/i.test(uname)) guess = 'developer';
          setInferredPersona(guess);
        }
      })
      .catch((error) => {
        console.error('Keycloak initialization failed:', error);
      });
  }, []);

  const handleLogout = () => {
    keycloak.logout();
  };

  if (!isAuthenticated) {
    return <div>Loading...</div>; // Show a loading screen while authenticating
  }

  return (
    <div>
      {/* Header with user info and logout button */}
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', backgroundColor: '#004aad', color: 'white' }}>
  <h1>Accenture Snow Chat</h1>
        <div>
          <span>Welcome, {userInfo?.preferred_username || 'User'}!</span>
          <button
            onClick={handleLogout}
            style={{
              marginLeft: '10px',
              padding: '5px 10px',
              backgroundColor: 'red',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 1000, display:'flex' }}>
        <button
          onClick={toggleDevCopilot}
          style={{ padding: '10px 20px', backgroundColor: showDevCopilot ? '#005499' : '#0078d4', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', transition:'background .25s' }}
        >
          {showDevCopilot ? 'Close DevCopilot' : 'Open DevCopilot'}
        </button>
        <button
          onClick={togglePrompts}
          style={{ marginLeft:'10px', padding: '10px 20px', backgroundColor: showPrompts ? '#4a136d' : '#6a1b9a', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', transition:'background .25s' }}
        >
          {showPrompts ? 'Close Prompts' : 'Prompt Manager'}
        </button>
      </div>
      {/* Main content: toggle between MainStepper+SnowChat, DevCopilot, and Prompt Manager */}
      {showPrompts ? (
        <div style={{ padding:'20px' }}>
          <PromptManagerPage userPersona={inferredPersona} />
        </div>
      ) : !showDevCopilot ? (
        <>
          <MainStepper />
          <SnowChat user={userInfo} />
        </>
      ) : (
        <DevCopilot user={userInfo} />
      )}
      <div style={{ position:'fixed', bottom:4, left:4, fontSize:10, color:'#666', background:'#fff', padding:'2px 6px', borderRadius:4, opacity:0.85 }}>build:prompts-integrated</div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
