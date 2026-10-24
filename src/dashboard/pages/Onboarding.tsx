/**
 * Business onboarding: ten short steps, most of them optional. The
 * organization is created after the basics (steps 1–5); later steps save into
 * its settings as you go, so leaving halfway loses nothing.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Check, FileUp, HardDriveUpload, ImagePlus, PenLine } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Logo } from '../components/AppShell';
import { Alert, Button, Card, Field, Input, Select, Textarea, cn } from '../components/ui';
import { loadInvoices, loadProfile, saveInvoicePrefix, saveProfile } from '../../core/storage';
import { profileSchema } from '../../core/validate';
import { setEditorSyncOrg } from '../../cloud/prefs';
import { LogoError, processLogo } from '../../ui/logo';
import {
  createOrganization,
  errorMessage,
  getSettings,
  updateOrganization,
  updateSettings,
  uploadLogo,
  type OrgSettings,
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

const STEPS = [
  'Company name',
  'Business email',
  'Address',
  'Country',
  'Currency',
  'Tax',
  'Logo',
  'Numbering',
  'Payment',
  'First invoice',
] as const;

interface Draft {
  name: string;
  email: string;
  address: string;
  country: string;
  currency: string;
  taxLabel: string;
  taxRate: string;
  taxId: string;
  prefix: string;
  paymentTerms: string;
  paymentInstructions: string;
}

const EMPTY: Draft = {
  name: '',
  email: '',
  address: '',
  country: '',
  currency: 'USD',
  taxLabel: 'Tax',
  taxRate: '0',
  taxId: '',
  prefix: 'INV-',
  paymentTerms: 'Payment due within 30 days',
  paymentInstructions: '',
};

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: 'png' | 'jpeg' | 'webp' } {
  const [head, b64 = ''] = dataUrl.split(',');
  const ext = /image\/(png|jpeg|webp)/.exec(head ?? '')?.[1] as 'png' | 'jpeg' | 'webp';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { blob: new Blob([bytes], { type: `image/${ext}` }), ext };
}

export function OnboardingPage() {
  const { sb, user } = useAuth();
  const { active, memberships, refetch, select } = useOrgs();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const creatingNew = params.has('new') || memberships.length === 0;
  const resuming =
    !creatingNew && !!active && canManage(active) && !active.org.onboarding_completed_at;

  const [orgId, setOrgId] = useState<string | null>(resuming ? active.org.id : null);
  const [step, setStep] = useState(resuming ? 5 : 0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [logo, setLogo] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // When resuming, prefill from what's already saved.
  useEffect(() => {
    if (!resuming) return;
    void getSettings(sb, active.org.id).then((s: OrgSettings) =>
      setDraft((d) => ({
        ...d,
        name: active.org.name,
        email: s.business.email,
        address: s.business.address,
        country: active.org.country ?? '',
        currency: active.org.default_currency,
        taxLabel: s.tax_label,
        taxRate: String(s.tax_rate),
        taxId: s.business.taxId,
        prefix: s.invoice_prefix,
        paymentTerms: s.payment_terms || d.paymentTerms,
        paymentInstructions: s.payment_instructions,
      })),
    );
    // Only on first render of a resumed onboarding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!creatingNew && !resuming && step === 0) return <Navigate to="/" replace />;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const business = () => ({
    name: draft.name.trim(),
    email: draft.email.trim(),
    address: draft.address.trim(),
    phone: '',
    website: '',
    taxId: draft.taxId.trim(),
    legal: { form: '', capital: '', regNumber: '', regPlace: '' },
  });

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setStep((s) => s + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveBasics() {
    if (!orgId) {
      const id = await createOrganization(sb, {
        name: draft.name.trim(),
        country: draft.country,
        currency: draft.currency,
        timezone: browserTimezone(),
      });
      setOrgId(id);
      await updateSettings(sb, id, user!.id, { business: business() });
      await refetch();
      select(id);
    } else {
      await updateOrganization(sb, orgId, {
        name: draft.name.trim(),
        country: draft.country || null,
        default_currency: draft.currency,
      });
      await updateSettings(sb, orgId, user!.id, { business: business() });
    }
  }

  async function finish() {
    await updateOrganization(sb, orgId!, { onboarding_completed_at: new Date().toISOString() });
    // Give the editor these business details if it has none yet (never overwrite).
    if (!loadProfile()) {
      const profile = profileSchema.safeParse({
        business: business(),
        logo,
        logoShape: 'square',
        accent: '#5b5ef4',
        currency: draft.currency,
        locale: localeForCountry(draft.country || null),
        paymentTerms: draft.paymentTerms,
        bankDetails: draft.paymentInstructions,
        footer: '',
        taxLabel: draft.taxLabel || 'Tax',
        taxRate: Number(draft.taxRate) || 0,
        legalMentions: [],
      });
      if (profile.success) saveProfile(profile.data);
    }
    await refetch();
    void qc.invalidateQueries();
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === 0 && !draft.name.trim()) return setError('Enter your company or trading name.');
    if (step === 1 && draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())) {
      return setError('Enter a valid email address, or skip this step.');
    }
    if (step < 4) return setStep((s) => s + 1);
    if (step === 4) return void run(saveBasics);
    if (step === 5) {
      const rate = Number(draft.taxRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100)
        return setError('Tax rate must be between 0 and 100.');
      return void run(() =>
        updateSettings(sb, orgId!, user!.id, {
          tax_label: draft.taxLabel.trim() || 'Tax',
          tax_rate: rate,
          business: business(),
        }),
      );
    }
    if (step === 6) {
      return void run(async () => {
        if (!logo) return;
        const { blob, ext } = dataUrlToBlob(logo);
        const path = await uploadLogo(sb, orgId!, blob, ext);
        await updateSettings(sb, orgId!, user!.id, { logo_path: path });
      });
    }
    if (step === 7) {
      if (!/^[\w\-/.#]{0,20}$/.test(draft.prefix))
        return setError('Use up to 20 letters, digits or - / . #');
      return void run(async () => {
        await updateSettings(sb, orgId!, user!.id, { invoice_prefix: draft.prefix });
        saveInvoicePrefix(draft.prefix);
      });
    }
    if (step === 8) {
      return void run(async () => {
        await updateSettings(sb, orgId!, user!.id, {
          payment_terms: draft.paymentTerms.trim().slice(0, 500),
          payment_instructions: draft.paymentInstructions.trim().slice(0, 2000),
        });
        await finish();
      });
    }
  };

  const skip = () => {
    setError(null);
    if (step === 8) return void run(finish);
    setStep((s) => s + 1);
  };
  const optional = [1, 2, 3, 5, 6, 7, 8].includes(step);
  const localCount = step === 9 ? loadInvoices().length : 0;

  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          {memberships.length > 0 && (
            <Link to="/" className="text-sm font-medium text-graphite hover:text-ink">
              {step >= 9 ? 'Go to dashboard' : 'Finish later'}
            </Link>
          )}
        </div>

        <ol className="mb-6 flex gap-1.5" aria-label="Onboarding progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">
                Step {i + 1}: {label}
                {i < step ? ' (done)' : ''}
              </span>
              <span
                className={cn(
                  'block h-1.5 rounded-full',
                  i < step ? 'bg-brand' : i === step ? 'bg-brand/50' : 'bg-rule',
                )}
                aria-hidden
              />
            </li>
          ))}
        </ol>
        <p className="mb-1 text-sm font-medium text-graphite">
          Step {step + 1} of {STEPS.length}
        </p>

        <Card className="p-6">
          {step === 9 ? (
            <FirstInvoice orgId={orgId!} localCount={localCount} />
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              {error && <Alert tone="danger">{error}</Alert>}
              <StepBody
                step={step}
                draft={draft}
                set={set}
                logo={logo}
                setLogo={setLogo}
                setError={setError}
              />
              <div className="flex items-center justify-between gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setStep((s) => Math.max(resuming ? 5 : 0, s - 1))}
                  disabled={step === 0 || busy || (step === 5 && !!orgId && !!resuming)}
                >
                  Back
                </Button>
                <div className="flex gap-2">
                  {optional && (
                    <Button variant="secondary" onClick={skip} disabled={busy}>
                      Skip
                    </Button>
                  )}
                  <Button type="submit" loading={busy}>
                    {step === 4 && !orgId ? 'Create organization' : 'Continue'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function StepTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-xl font-bold">{title}</h1>
      {children && <p className="mt-1 text-sm text-graphite">{children}</p>}
    </div>
  );
}

function StepBody({
  step,
  draft,
  set,
  logo,
  setLogo,
  setError,
}: {
  step: number;
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  logo: string;
  setLogo: (v: string) => void;
  setError: (v: string | null) => void;
}) {
  switch (step) {
    case 0:
      return (
        <>
          <StepTitle title="What’s your business called?">
            This appears on your invoices. You can change it later.
          </StepTitle>
          <Field label="Company or trading name">
            {(p) => (
              <Input
                {...p}
                autoFocus
                maxLength={120}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    case 1:
      return (
        <>
          <StepTitle title="Business email">
            Clients see this on invoices and can reply to it.
          </StepTitle>
          <Field label="Email">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoFocus
                value={draft.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    case 2:
      return (
        <>
          <StepTitle title="Business address">
            Many countries require your address on invoices.
          </StepTitle>
          <Field label="Address">
            {(p) => (
              <Textarea
                {...p}
                autoFocus
                rows={4}
                maxLength={1000}
                value={draft.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    case 3:
      return (
        <>
          <StepTitle title="Where is your business based?">
            We use this for sensible defaults like number formats.
          </StepTitle>
          <Field label="Country">
            {(p) => (
              <Select
                {...p}
                autoFocus
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
        </>
      );
    case 4:
      return (
        <>
          <StepTitle title="Default currency">
            New invoices start in this currency. Each invoice can still use another one.
          </StepTitle>
          <Field label="Currency">
            {(p) => (
              <Select
                {...p}
                autoFocus
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
        </>
      );
    case 5:
      return (
        <>
          <StepTitle title="Tax">
            Your default tax and your tax/VAT registration number, if you have one.
          </StepTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax label" hint="VAT, GST, Sales tax…">
              {(p) => (
                <Input
                  {...p}
                  maxLength={30}
                  value={draft.taxLabel}
                  onChange={(e) => set({ taxLabel: e.target.value })}
                />
              )}
            </Field>
            <Field label="Default rate (%)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  inputMode="decimal"
                  value={draft.taxRate}
                  onChange={(e) => set({ taxRate: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Tax / VAT number" hint="Leave empty if you’re not registered.">
            {(p) => (
              <Input
                {...p}
                maxLength={80}
                value={draft.taxId}
                onChange={(e) => set({ taxId: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    case 6:
      return (
        <>
          <StepTitle title="Your logo">
            PNG, JPEG or WebP up to 2 MB. It’s re-encoded to strip hidden data.
          </StepTitle>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-field px-4 py-8 text-sm text-graphite hover:bg-hover">
            {logo ? (
              <img src={logo} alt="Logo preview" className="max-h-20 max-w-48 object-contain" />
            ) : (
              <ImagePlus className="h-8 w-8" aria-hidden />
            )}
            <span className="font-semibold text-brand-ink">
              {logo ? 'Choose a different file' : 'Choose a file'}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setLogo(await processLogo(file));
                  setError(null);
                } catch (err) {
                  setError(
                    err instanceof LogoError ? err.message : 'That image could not be read.',
                  );
                }
              }}
            />
          </label>
        </>
      );
    case 7:
      return (
        <>
          <StepTitle title="Invoice numbering">
            Invoices are numbered in sequence with this prefix.
          </StepTitle>
          <Field
            label="Prefix"
            hint={`A new invoice series starts at ${draft.prefix || 'INV-'}001. Existing numbering carries on.`}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={20}
                value={draft.prefix}
                onChange={(e) => set({ prefix: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    case 8:
      return (
        <>
          <StepTitle title="How should clients pay you?">
            Shown at the bottom of every invoice.
          </StepTitle>
          <Field label="Payment terms">
            {(p) => (
              <Input
                {...p}
                maxLength={500}
                value={draft.paymentTerms}
                onChange={(e) => set({ paymentTerms: e.target.value })}
              />
            )}
          </Field>
          <Field label="Payment instructions" hint="Bank details, PayPal address or payment link.">
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                maxLength={2000}
                value={draft.paymentInstructions}
                onChange={(e) => set({ paymentInstructions: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    default:
      return null;
  }
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
