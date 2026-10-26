/**
 * SASU Invoice — cloud dashboard entry point (React SPA under /dashboard/).
 * The invoice editor (app.html) stays a separate, framework-free page.
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { cloudConfig } from '../cloud/config';
import { App, NotConfigured } from './App';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { OrgProvider } from './lib/org';
import { ToastProvider } from './lib/toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Permission/validation errors won't fix themselves on retry.
      retry: (count, err) => !(err instanceof ApiError && err.code) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {cloudConfig ? (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/dashboard">
          <AuthProvider>
            <OrgProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </OrgProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    ) : (
      <NotConfigured />
    )}
  </StrictMode>,
);
