import { BellRing, Eye, EyeOff, MailCheck, ShieldCheck, Users } from 'lucide-react';
import {
  forwardRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import productOverview from '../assets/product-overview.webp';
import { Logo } from '../components/AppShell';
import { useCaptcha } from '../components/Captcha';
import { Alert, Button, Field, Input } from '../components/ui';
import { useAuth, useAuthProviders } from '../lib/auth';
import { MIN_PASSWORD, passwordProblem, passwordRules } from '../../core/password';

export { MIN_PASSWORD };

/** Only same-app relative paths are allowed as post-login destinations. */
export function safeNext(raw: string | null): string {
  return raw && /^\/(?!\/)[\w\-/?=&#.%]*$/.test(raw) ? raw : '/';
}

const appUrl = (path: string) => `${location.origin}/dashboard${path}`;

/** Live checklist of the password rules under a new-password field. */
export function PasswordChecklist({ password, email = '' }: { password: string; email?: string }) {
  if (!password) return null;
  return (
    <ul className="-mt-2 grid gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {passwordRules(password, email).map((r) => (
        <li key={r.id} className={r.ok ? 'text-ok' : 'text-graphite'}>
          <span aria-hidden>{r.ok ? '✓' : '○'}</span> {r.label}
          <span className="sr-only">{r.ok ? ' (met)' : ' (not met)'}</span>
        </li>
      ))}
    </ul>
  );
}

function authMessage(err: { message?: string; code?: string } | null): string {
  switch (err?.code) {
    case 'invalid_credentials':
      return 'That email and password don’t match.';
    case 'email_not_confirmed':
      return 'Please confirm your email first. Check your inbox for the link.';
    case 'user_already_exists':
      return 'An account with this email already exists. Try signing in.';
    case 'weak_password':
      return `Choose a stronger password: at least ${MIN_PASSWORD} characters with upper- and lowercase letters, a number and a symbol.`;
    case 'captcha_failed':
      return 'The security check failed or expired. Please try again.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'same_password':
      return 'Choose a password different from your current one.';
    default:
      return err?.message || 'Something went wrong. Please try again.';
  }
}

const HIGHLIGHTS = [
  {
    icon: BellRing,
    title: 'Get paid without chasing',
    text: 'Friendly reminders go out on schedule and stop the moment a payment lands.',
  },
  {
    icon: ShieldCheck,
    title: 'Totals you can trust',
    text: 'Every amount is checked on the server, and issued invoices are locked.',
  },
  {
    icon: Users,
    title: 'Built for your team',
    text: 'Invite your accountant or staff with the right permissions for each person.',
  },
] as const;

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
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-4 py-8 sm:px-8">
        <Logo />
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-graphite">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-graphite">{footer}</div>}
        </main>
        <a
          href="/app.html"
          className="mx-auto text-sm text-graphite underline-offset-2 hover:text-ink hover:underline"
        >
          Use the free editor without an account
        </a>
      </div>
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-center lg:py-12 lg:pl-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-32 h-[28rem] w-[28rem] rounded-full bg-brand/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 h-[24rem] w-[24rem] rounded-full bg-brand/20 blur-3xl"
        />
        <div className="relative max-w-lg pr-14">
          <p className="text-xs font-semibold tracking-[0.18em] text-white/60 uppercase">
            SASU Invoice + RecoverFlow
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-bold">
            Invoices out the door. Payments in the bank.
          </h2>
        </div>
        <figure className="relative mt-9 -mr-24">
          <div className="overflow-hidden rounded-l-xl bg-paper shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/15">
            <div
              className="flex items-center gap-1.5 border-b border-rule bg-canvas px-3 py-2"
              aria-hidden
            >
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <img
              src={productOverview}
              width={1600}
              height={900}
              alt="The SASU Invoice dashboard: totals invoiced, paid and outstanding, a chart of invoiced against received, and unpaid balances by age."
              className="block h-auto w-full"
              decoding="async"
            />
          </div>
        </figure>
        <ul className="relative mt-9 grid max-w-2xl grid-cols-3 gap-5 pr-14">
          {HIGHLIGHTS.map(({ icon: Icon, title: t, text }) => (
            <li key={t}>
              <Icon className="h-5 w-5 text-white/80" aria-hidden />
              <span className="mt-2 block text-sm font-semibold">{t}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-white/60">{text}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** Password field with a show/hide toggle. */
const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} {...props} type={visible ? 'text' : 'password'} className="pr-10" />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-faint hover:text-ink"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
          <span className="sr-only">{visible ? 'Hide' : 'Show'}</span>
        </button>
      </div>
    );
  },
);

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" plus an "or" divider. Renders nothing until Google is
 * switched on in Supabase Auth, so email sign-in keeps working on its own.
 */
function SocialSignIn({
  next,
  onError,
  signUp = false,
}: {
  next: string;
  onError: (msg: string) => void;
  signUp?: boolean;
}) {
  const { sb } = useAuth();
  const { google } = useAuthProviders();
  const [busy, setBusy] = useState(false);
  if (!google) return null;

  async function continueWithGoogle() {
    setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: appUrl(next), queryParams: { prompt: 'select_account' } },
    });
    // On success the browser is already leaving for Google.
    if (error) {
      setBusy(false);
      onError(authMessage(error));
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        loading={busy}
        onClick={() => void continueWithGoogle()}
      >
        {!busy && <GoogleIcon />}
        Continue with Google
      </Button>
      {signUp && (
        <p className="mt-2 text-center text-xs text-faint">
          By continuing with Google you agree to the{' '}
          <a href="/terms.html" target="_blank" className="underline">
            terms
          </a>{' '}
          and{' '}
          <a href="/privacy.html" target="_blank" className="underline">
            privacy policy
          </a>
          .
        </p>
      )}
      <div className="my-5 flex items-center gap-3 text-xs text-faint" role="separator">
        <span className="h-px flex-1 bg-rule" />
        or with email
        <span className="h-px flex-1 bg-rule" />
      </div>
    </>
  );
}

/** Errors Supabase passes back in the URL after a failed social sign-in. */
function oauthError(params: URLSearchParams): string | null {
  const hash = new URLSearchParams(location.hash.slice(1));
  const msg = params.get('error_description') ?? hash.get('error_description');
  return msg ? `Google sign-in didn’t complete: ${msg.slice(0, 200)}` : null;
}

export function LoginPage() {
  const { sb, session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => oauthError(params));
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha();
  const next = safeNext(params.get('next'));

  if (session) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const blocked = captcha.blocked();
    if (blocked) return setError(blocked);
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.signInWithPassword({
      email: email.trim(),
      password,
      options: { captchaToken: captcha.token },
    });
    setBusy(false);
    captcha.reset();
    if (err) setError(authMessage(err));
    else navigate(next, { replace: true });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Pick up where you left off."
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
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <SocialSignIn next={next} onError={setError} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-ink">
            Forgot password?
          </Link>
        </div>
        {captcha.widget}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
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
  const captcha = useCaptcha();
  const next = safeNext(params.get('next'));

  if (session) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, email.trim());
    if (problem) return setError(problem);
    if (!accepted) return setError('Please accept the terms and privacy notice to continue.');
    const blocked = captcha.blocked();
    if (blocked) return setError(blocked);
    setBusy(true);
    setError(null);
    const { data, error: err } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: appUrl(next),
        data: { full_name: name.trim().slice(0, 120) },
        captchaToken: captcha.token,
      },
    });
    setBusy(false);
    captcha.reset();
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
      subtitle="Start your 14-day Pro trial. No card needed."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-semibold text-brand-ink" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <SocialSignIn next={next} onError={setError} signUp />
      <form onSubmit={submit} className="space-y-4" noValidate>
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
              placeholder="you@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters with upper- and lowercase letters, a number and a symbol.`}
        >
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <PasswordChecklist password={password} email={email.trim()} />
        <label className="flex items-start gap-2 text-sm text-graphite">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            I agree to the{' '}
            <a href="/terms.html" target="_blank" className="font-medium text-brand-ink underline">
              terms of service
            </a>{' '}
            and the{' '}
            <a
              href="/privacy.html"
              target="_blank"
              className="font-medium text-brand-ink underline"
            >
              privacy policy
            </a>
            . Invoices I store in the cloud are processed on my behalf.
          </span>
        </label>
        {captcha.widget}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
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
  const captcha = useCaptcha();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const blocked = captcha.blocked();
    if (blocked) return setError(blocked);
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: appUrl('/reset-password'),
      captchaToken: captcha.token,
    });
    setBusy(false);
    captcha.reset();
    // Same message whether or not the account exists, so emails can't be probed.
    if (err && (err.code?.startsWith('over_') || err.code === 'captcha_failed'))
      setError(authMessage(err));
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
          {captcha.widget}
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
    const problem = passwordProblem(password, session?.user.email ?? '');
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { error: err } = await sb.auth.updateUser({ password });
    // Other devices signed in with the old password are signed out.
    if (!err) await sb.auth.signOut({ scope: 'others' });
    setBusy(false);
    if (err) setError(authMessage(err));
    else navigate('/', { replace: true });
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="New password">
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <PasswordChecklist password={password} email={session?.user.email ?? ''} />
        <Button type="submit" className="w-full" loading={busy || loading}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
