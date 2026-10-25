import { CloudOff } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AppShell, Logo } from './components/AppShell';
import { Alert, Card, Spinner } from './components/ui';
import { errorMessage } from './lib/api';
import { useAuth } from './lib/auth';
import { canManage, useOrgs } from './lib/org';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/Auth';
import { InvitePage } from './pages/Invite';

/** Pages load on demand so the first screen downloads only what it needs. */
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const BillingPage = lazy(() => import('./pages/Billing').then((m) => ({ default: m.BillingPage })));
const BrowserPage = lazy(() => import('./pages/Browser').then((m) => ({ default: m.BrowserPage })));
const InvoiceDetailPage = lazy(() =>
  import('./pages/InvoiceDetail').then((m) => ({ default: m.InvoiceDetailPage })),
);
const InvoicesPage = lazy(() =>
  import('./pages/Invoices').then((m) => ({ default: m.InvoicesPage })),
);
const OnboardingPage = lazy(() =>
  import('./pages/Onboarding').then((m) => ({ default: m.OnboardingPage })),
);
const OverviewPage = lazy(() =>
  import('./pages/Overview').then((m) => ({ default: m.OverviewPage })),
);
const RecurringPage = lazy(() =>
  import('./pages/Recurring').then((m) => ({ default: m.RecurringPage })),
);
const RemindersPage = lazy(() =>
  import('./pages/Reminders').then((m) => ({ default: m.RemindersPage })),
);
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const SearchPage = lazy(() => import('./pages/Search').then((m) => ({ default: m.SearchPage })));
const ClientDetailPage = lazy(() =>
  import('./pages/Clients').then((m) => ({ default: m.ClientDetailPage })),
);
const ClientsPage = lazy(() => import('./pages/Clients').then((m) => ({ default: m.ClientsPage })));
const NewClientPage = lazy(() =>
  import('./pages/Clients').then((m) => ({ default: m.NewClientPage })),
);
const AccountPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.AccountPage })),
);
const OrganizationSettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.OrganizationSettingsPage })),
);
const TeamPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.TeamPage })));

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
    <Suspense fallback={<Spinner />}>
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
              <Route path="/recurring" element={<RecurringPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/browser" element={<BrowserPage />} />
              <Route path="/settings/organization" element={<OrganizationSettingsPage />} />
              <Route path="/settings/team" element={<TeamPage />} />
              <Route path="/settings/account" element={<AccountPage />} />
              <Route path="/settings/billing" element={<BillingPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
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
