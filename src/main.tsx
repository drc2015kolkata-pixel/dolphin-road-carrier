import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initVersionSync } from './lib/versionSync.ts';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

initVersionSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
