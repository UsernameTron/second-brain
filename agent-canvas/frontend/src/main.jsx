import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Apply the remembered theme before the first paint. Default is light: the
// light theme exists because the dark one caused real eye strain, so a dark OS
// setting must not hand that back to someone on first sign-in. The account
// preference reconciles a moment later in App.
try {
  document.documentElement.dataset.theme = localStorage.getItem('ac_theme') || 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
