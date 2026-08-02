import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  setPersistence,
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBVTWSRyv7mzVhXLj5NHmg_MKKyWYgeBXg',
  authDomain: 'smartcutservices-9ce54.firebaseapp.com',
  projectId: 'smartcutservices-9ce54',
  storageBucket: 'smartcutservices-9ce54.firebasestorage.app',
  messagingSenderId: '12148835666',
  appId: '1:12148835666:web:d18d80cedd5a36ec81e68b',
  measurementId: 'G-TXG8KQDBBG',
};

const firebaseState = globalThis.__SMART_CAISSE_FIREBASE__ || (globalThis.__SMART_CAISSE_FIREBASE__ = {});

export const app = firebaseState.app || initializeApp(firebaseConfig);
firebaseState.app = app;

export const db = firebaseState.db || getFirestore(app);
firebaseState.db = db;

export const auth = firebaseState.auth || getAuth(app);
firebaseState.auth = auth;

// Use an isolated in-memory Auth instance for privileged actions such as
// authorizing a cashier discount. It never replaces the cashier session.
const adminCheckApp = firebaseState.adminCheckApp || initializeApp(firebaseConfig, 'smart-caisse-admin-check');
firebaseState.adminCheckApp = adminCheckApp;
export const adminCheckAuth = firebaseState.adminCheckAuth || getAuth(adminCheckApp);
firebaseState.adminCheckAuth = adminCheckAuth;
export const adminCheckDb = firebaseState.adminCheckDb || getFirestore(adminCheckApp);
firebaseState.adminCheckDb = adminCheckDb;

async function configurePersistence() {
  const modes = [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence];
  for (const mode of modes) {
    try {
      await setPersistence(auth, mode);
      return;
    } catch (_) {}
  }
}

export const authReadyPromise = firebaseState.authReadyPromise || configurePersistence();
firebaseState.authReadyPromise = authReadyPromise;

export const adminCheckReadyPromise = firebaseState.adminCheckReadyPromise || setPersistence(adminCheckAuth, inMemoryPersistence);
firebaseState.adminCheckReadyPromise = adminCheckReadyPromise;
