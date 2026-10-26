/**
 * Business onboarding: one short form (name, country, currency) creates the
 * organization and you're in. Everything else (address, tax, logo, numbering,
 * payment details) lives in Settings and is suggested by the getting-started
 * checklist on the dashboard, so nobody has to fill in ten screens up front.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Check, FileUp, HardDriveUpload, PenLine } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Logo } from '../components/AppShell';
import { Alert, Button, Card, Field, Input, Select } from '../components/ui';
import { loadInvoices, loadProfile, saveProfile } from '../../core/storage';
import { profileSchema } from '../../core/validate';
import { setEditorSyncOrg } from '../../cloud/prefs';
import {
  createOrganization,
  errorMessage,
  getSettings,
  updateOrganization,
  updateSettings,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManage, useOrgs } from '../lib/org';
import {
  COUNTRIES,
  CURRENCIES,
  browserTimezone,
  currencyForCountry,
  localeForCountry,
} from '../lib/options';

interface Draft {
  name: string;
  country: string;
  currency: string;
}

/** A starting country (and its currency) guessed from the browser's language. */
function guessDraft(): Draft {
  let region = '';
  try {
    region = new Intl.Locale(navigator.language).maximize().region ?? '';
  } catch {
    // Unusual language tags: no guess.
  }
  return COUNTRIES.some((c) => c.code === region)
    ? { name: '', country: region, currency: currencyForCountry(region) ?? 'USD' }
    : { name: '', country: '', currency: 'USD' };
}

export function OnboardingPage() {
  const { sb, user } = useAuth();
  const { active, memberships, refetch, select } = useOrgs();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const creatingNew = params.has('new') || memberships.length === 0;
  // Older organizations created before onboarding was shortened.
  const resuming =
    !creatingNew && !!active && canManage(active) && !active.org.onboarding_completed_at;

  const [orgId, setOrgId] = useState<string | null>(resuming ? active.org.id : null);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    resuming
      ? {
          name: active.org.name,
          country: active.org.country ?? '',
          currency: active.org.default_currency,
        }
      : guessDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!creatingNew && !resuming && !done) return <Navigate to="/" replace />;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  async function create() {
    const name = draft.name.trim();
    let id = orgId;
    if (!id) {
      id = await createOrganization(sb, {
        name,
        country: draft.country,
        currency: draft.currency,
        timezone: browserTimezone(),
      });
      setOrgId(id);
    } else {
      await updateOrganization(sb, id, {
        name,
        country: draft.country || null,
        default_currency: draft.currency,
      });
    }
    const settings: OrgSettingsBusiness | null = resuming
      ? (await getSettings(sb, id)).business
      : null;
    const business = {
      name,
      email: settings?.email || user?.email || '',
      address: settings?.address ?? '',
      phone: settings?.phone ?? '',
      website: settings?.website ?? '',
      taxId: settings?.taxId ?? '',
      legal: settings?.legal ?? { form: '', capital: '', regNumber: '', regPlace: '' },
    };
    await updateSettings(sb, id, user!.id, { business });
    await updateOrganization(sb, id, { onboarding_completed_at: new Date().toISOString() });
    // Give the editor these business details if it has none yet (never overwrite).
    if (!loadProfile()) {
      const profile = profileSchema.safeParse({
        business,
        logo: '',
        logoShape: 'square',
        accent: '#5b5ef4',
        currency: draft.currency,
        locale: localeForCountry(draft.country || null),
        paymentTerms: 'Payment due within 30 days',
        bankDetails: '',
        footer: '',
        taxLabel: 'Tax',
        taxRate: 0,
        legalMentions: [],
      });
      if (profile.success) saveProfile(profile.data);
    }
    await refetch();
    select(id);
    void qc.invalidateQueries();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return setError('Enter your company or trading name.');
    setBusy(true);
    setError(null);
    try {
      await create();
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          {memberships.length > 0 && (
            <Link to="/" className="text-sm font-medium text-graphite hover:text-ink">
              {done ? 'Go to dashboard' : 'Cancel'}
            </Link>
          )}
        </div>
        <p className="mb-1 text-sm font-medium text-graphite">Step {done ? 2 : 1} of 2</p>
        <Card className="p-6">
          {done ? (
            <FirstInvoice orgId={orgId!} localCount={loadInvoices().length} />
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-5">
              <StepTitle
                title={resuming ? 'Confirm your business details' : 'Set up your workspace'}
              >
                Takes 30 seconds. You can add your logo, address, tax and payment details later.
              </StepTitle>
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Company or trading name" hint="This appears on your invoices.">
                {(p) => (
                  <Input
                    {...p}
                    autoFocus
                    autoComplete="organization"
                    maxLength={120}
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country">
                  {(p) => (
                    <Select
                      {...p}
                      value={draft.country}
                      onChange={(e) =>
                        set({
                          country: e.target.value,
                          currency: currencyForCountry(e.target.value) ?? draft.currency,
                        })
                      }
                    >
                      <option value="">Choose a country</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Default currency">
                  {(p) => (
                    <Select
                      {...p}
                      value={draft.currency}
                      onChange={(e) => set({ currency: e.target.value })}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} · {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Button type="submit" size="lg" className="w-full" loading={busy}>
                {orgId ? 'Save and continue' : 'Create workspace'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

type OrgSettingsBusiness = Awaited<ReturnType<typeof getSettings>>['business'];

function StepTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-xl font-bold">{title}</h1>
      {children && <p className="mt-1 text-sm text-graphite">{children}</p>}
    </div>
  );
}

function FirstInvoice({ orgId, localCount }: { orgId: string; localCount: number }) {
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="rounded-full bg-ok-wash p-2 text-ok">
          <Check className="h-5 w-5" aria-hidden />
        </span>
        <StepTitle title="You’re all set">
          Your organization is ready. What would you like to do first?
        </StepTitle>
      </div>
      <div className="grid gap-3">
        {localCount > 0 && (
          <Link
            to="/browser"
            className="flex items-start gap-3 rounded-xl border border-rule p-4 hover:border-brand hover:bg-brand-wash/40"
          >
            <HardDriveUpload className="mt-0.5 h-5 w-5 text-brand" aria-hidden />
            <span>
              <span className="block font-semibold">
                Import {localCount} document{localCount === 1 ? '' : 's'} from this browser
              </span>
              <span className="text-sm text-graphite">
                Review them first; nothing is uploaded without your confirmation.
              </span>
            </span>
          </Link>
        )}
        <a
          href="/app.html"
          onClick={() => setEditorSyncOrg(orgId)}
          className="flex items-start gap-3 rounded-xl border border-rule p-4 hover:border-brand hover:bg-brand-wash/40"
        >
          <PenLine className="mt-0.5 h-5 w-5 text-brand" aria-hidden />
          <span>
            <span className="block font-semibold">Create your first invoice</span>
            <span className="text-sm text-graphite">
              Opens the editor with cloud saving turned on for this browser.
            </span>
          </span>
        </a>
        <Link
          to="/"
          className="flex items-start gap-3 rounded-xl border border-rule p-4 hover:border-brand hover:bg-brand-wash/40"
        >
          <FileUp className="mt-0.5 h-5 w-5 text-brand" aria-hidden />
          <span>
            <span className="block font-semibold">Go to the dashboard</span>
            <span className="text-sm text-graphite">
              You can import or create invoices any time.
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
