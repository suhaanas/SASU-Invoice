import { CloudOff } from 'lucide-react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppShell, Logo } from './components/AppShell';
import { Alert, Card, Spinner } from './components/ui';
import { errorMessage } from './lib/api';
import { useAuth } from './lib/auth';
import { canManage, useOrgs } from './lib/org';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/Auth';
import { BrowserPage } from './pages/Browser';
import { InvitePage } from './pages/Invite';
import { ClientDetailPage, ClientsPage, NewClientPage } from './pages/Clients';
import { InvoiceDetailPage } from './pages/InvoiceDetail';
import { InvoicesPage } from './pages/Invoices';
import { RemindersPage } from './pages/Reminders';
import { SearchPage } from './pages/Search';
import { OnboardingPage } from './pages/Onboarding';
import { OverviewPage } from './pages/Overview';
import { AccountPage, OrganizationSettingsPage, TeamPage } from './pages/Settings';

function RequireAuth() {
  const { session, loading, recovering } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!session)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (recovering) return <Navigate to="/reset-password" replace />;
  return <Outlet />;
}

/** Signed in and a member of at least one organization. */
function RequireOrg() {
  const { memberships, active, loading, error } = useOrgs();
  if (loading) return <Spinner />;
  if (error) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert tone="danger">{errorMessage(error)}</Alert>
      </div>
    );
  }
  if (memberships.length === 0 || !active) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function OnboardingBanner() {
  const { active } = useOrgs();
  if (!active || active.org.onboarding_completed_at || !canManage(active)) return null;
  return (
    <div className="border-b border-brand/20 bg-brand-wash px-4 py-2 text-center text-sm text-brand-ink">
      Finish setting up {active.org.name}.{' '}
      <a href="/dashboard/onboarding" className="font-semibold underline">
        Continue setup
      </a>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite" element={<InvitePage />} />
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<RequireOrg />}>
          <Route
            element={
              <>
                <OnboardingBanner />
                <AppShell />
              </>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/new" element={<NewClientPage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/browser" element={<BrowserPage />} />
            <Route path="/settings/organization" element={<OrganizationSettingsPage />} />
            <Route path="/settings/team" element={<TeamPage />} />
            <Route path="/settings/account" element={<AccountPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Shown when the build has no Supabase configuration. */
export function NotConfigured() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="max-w-md p-6 text-center">
        <CloudOff className="mx-auto h-9 w-9 text-faint" aria-hidden />
        <h1 className="mt-3 font-display text-xl font-bold">Cloud workspace unavailable</h1>
        <p className="mt-2 text-sm text-graphite">
          Accounts and cloud storage aren’t switched on for this site yet. The free editor works
          fully in your browser.
        </p>
        <a
          href="/app.html"
          className="mt-5 inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white"
        >
          Open the editor
        </a>
      </Card>
    </div>
  );
}
