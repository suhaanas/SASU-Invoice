import { MailCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../components/AppShell';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

export const MIN_PASSWORD = 10;

/** Only same-app relative paths are allowed as post-login destinations. */
export function safeNext(raw: string | null): string {
  return raw && /^\/(?!\/)[\w\-/?=&#.%]*$/.test(raw) ? raw : '/';
}

const appUrl = (path: string) => `${location.origin}/dashboard${path}`;

function authMessage(err: { message?: string; code?: string } | null): string {
  switch (err?.code) {
    case 'invalid_credentials':
      return 'That email and password don’t match.';
    case 'email_not_confirmed':
      return 'Please confirm your email first. Check your inbox for the link.';
    case 'user_already_exists':
      return 'An account with this email already exists. Try signing in.';
    case 'weak_password':
      return `Choose a stronger password (at least ${MIN_PASSWORD} characters, not a common one).`;
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'same_password':
      return 'Choose a password different from your current one.';
    default:
      return err?.message || 'Something went wrong. Please try again.';
  }
}

function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="font-display text-xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-graphite">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </Card>
      {footer && <div className="mt-5 text-sm text-graphite">{footer}</div>}
      <a href="/app.html" className="mt-6 text-sm text-graphite underline-offset-2 hover:underline">
        Use the free editor without an account
      </a>
    </div>
  );
}

export function LoginPage() {
  const { sb, session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  if (session) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(authMessage(err));
    else navigate(next, { replace: true });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to SASU Invoice."
      footer={
        <>
          New here?{' '}
          <Link
            className="font-semibold text-brand-ink"
            to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-ink">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { sb, session } = useAuth();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const next = safeNext(params.get('next'));

  if (session) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD)
      return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    if (!accepted) return setError('Please accept the terms and privacy notice to continue.');
    setBusy(true);
    setError(null);
    const { data, error: err } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: appUrl(next), data: { full_name: name.trim().slice(0, 120) } },
    });
    setBusy(false);
    if (err) return setError(authMessage(err));
    if (!data.session) setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex flex-col items-center text-center">
          <MailCheck className="h-10 w-10 text-brand" aria-hidden />
          <p className="mt-3 text-sm text-graphite">
            We sent a confirmation link to <strong className="text-ink">{sentTo}</strong>. Open it
            to activate your account.
          </p>
          <Link to="/login" className="mt-5 text-sm font-semibold text-brand-ink">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Cloud invoices, clients and your team in one place. 14-day Pro trial, no card needed."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-semibold text-brand-ink" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Your name">
          {(p) => (
            <Input
              {...p}
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Work email">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <label className="flex items-start gap-2 text-sm text-graphite">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            I agree to the terms of service and the privacy notice. Invoices I store in the cloud
            are processed on my behalf.
          </span>
        </label>
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { sb } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: appUrl('/reset-password'),
    });
    setBusy(false);
    // Same message whether or not the account exists, so emails can't be probed.
    if (err && err.code?.startsWith('over_')) setError(authMessage(err));
    else setSent(true);
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We’ll email you a link to choose a new password."
      footer={
        <Link to="/login" className="font-semibold text-brand-ink">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="ok">
          If an account exists for {email.trim()}, a reset link is on its way.
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { sb, session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && !session) {
    return (
      <AuthLayout title="Link expired">
        <Alert tone="warn">This reset link is invalid or has expired.</Alert>
        <Link to="/forgot-password" className="mt-4 block text-sm font-semibold text-brand-ink">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(authMessage(err));
    else navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={busy || loading}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
