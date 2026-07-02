// Firebase web app config — public identifiers, safe in the bundle.
// AWS-SWAP: replace with Amplify config (Auth/API/Storage endpoints) once implemented.
import type { FirebaseOptions } from 'firebase/app'

export const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyCoqf7-ty_z-0VI6EDGs56MHy-RH_5giN8',
  authDomain: 'productreinvention.firebaseapp.com',
  projectId: 'productreinvention',
  storageBucket: 'productreinvention.firebasestorage.app',
  messagingSenderId: '621888798672',
  appId: '1:621888798672:web:7cae95f217eb015eb603d5',
  measurementId: 'G-82E4D44Q56',
}

// Region where Cloud Functions v2 are deployed.
export const FUNCTIONS_REGION = 'us-central1'
