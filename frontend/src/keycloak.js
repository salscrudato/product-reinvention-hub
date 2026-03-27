import Keycloak from 'keycloak-js';

// Helper to trim and fallback for env variables
const sanitize = (v, fallback) => {
  if (!v || typeof v !== 'string') return fallback;
  const t = v.trim();
  return t.length ? t : fallback;
};

// Resolve configuration from environment with explicit defaults.
// We keep legacy defaults (snowchat realm/client) but surface diagnostics if a
// developer intended to use the devpilot realm and forgot to export vars.
const resolvedConfig = {
  url: sanitize(process.env.REACT_APP_KEYCLOAK_URL, 'http://localhost:8080'),
  realm: sanitize(process.env.REACT_APP_KEYCLOAK_REALM, 'snowchat'),
  clientId: sanitize(process.env.REACT_APP_KEYCLOAK_CLIENT_ID, 'snowchat-frontend'),
};

const loginHint = sanitize(process.env.REACT_APP_KEYCLOAK_LOGIN_HINT, '');

// Diagnostic: if devpilot-specific environment variables are missing but other tooling (e.g. DevFrontendDeveloperProfile.ps1)
// is commonly used, warn loudly to help avoid silent 401s against the wrong realm/client.
const expectedRealm = 'devpilot';
const expectedClient = 'devpilot-frontend';
const usingDevpilot = resolvedConfig.realm === expectedRealm && resolvedConfig.clientId === expectedClient;

// Emit a grouped console diagnostic once at module load.
try {
  // eslint-disable-next-line no-console
  console.groupCollapsed('[Keycloak Init] Configuration');
  // eslint-disable-next-line no-console
  console.log('Base URL      :', resolvedConfig.url);
  // eslint-disable-next-line no-console
  console.log('Realm         :', resolvedConfig.realm);
  // eslint-disable-next-line no-console
  console.log('Client ID     :', resolvedConfig.clientId);
  // eslint-disable-next-line no-console
  console.log('Login Hint    :', loginHint || '<none>');
  // eslint-disable-next-line no-console
  console.log('Devpilot Mode :', usingDevpilot ? 'YES' : 'NO');
  if (!usingDevpilot && (process.env.REACT_APP_EXPECT_DEVPILOT === '1' || process.env.REACT_APP_FORCE_DEVPILOT === '1')) {
    // eslint-disable-next-line no-console
    console.warn('[Keycloak Init] Expected devpilot realm/client not active. Did you run DevFrontendDeveloperProfile.ps1 or export REACT_APP_KEYCLOAK_* vars?');
  }
  if (!usingDevpilot && resolvedConfig.realm === 'snowchat') {
    // eslint-disable-next-line no-console
    console.info('[Keycloak Init] Using legacy snowchat realm defaults. Set REACT_APP_KEYCLOAK_REALM=devpilot and REACT_APP_KEYCLOAK_CLIENT_ID=devpilot-frontend to switch.');
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
} catch (_e) { /* non-fatal */ }

const keycloak = new Keycloak(resolvedConfig);

let keycloakInitialized = false;

const initOptions = {
  onLoad: 'check-sso',
  checkLoginIframe: false,
  pkceMethod: 'S256',
};

let keycloakInitPromise = null;
export const initializeKeycloak = () => {
  if (keycloakInitialized) return Promise.resolve(keycloak);
  if (!keycloakInitPromise) {
    keycloakInitPromise = keycloak
      .init(initOptions)
      .then((authenticated) => {
        if (!authenticated) {
          const loginOptions = loginHint ? { loginHint } : undefined;
          if (loginOptions) {
            keycloak.login(loginOptions);
          } else {
            keycloak.login();
          }
          return keycloak;
        }
        keycloakInitialized = true;
        // eslint-disable-next-line no-console
        console.info('[Keycloak Init] Authenticated:', keycloak.authenticated, 'Realm:', keycloak.realm, 'Client:', keycloak.clientId);
        return keycloak;
      })
      .catch((err) => {
        keycloakInitPromise = null; // allow retry on next call
        // eslint-disable-next-line no-console
        console.error('[Keycloak Init] Failed:', err);
        throw err;
      });
  }
  return keycloakInitPromise;
};

// Convenience export for components that might want a lazy token fetch
export const getKeycloakInstance = () => keycloak;

export default keycloak;