import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Building2,
  PenLine,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { setEditorSyncOrg } from '../../cloud/prefs';
import { EmailActivity } from '../components/EmailActivity';
import { InvoiceTable } from '../components/InvoiceTable';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  buttonVariants,
  cn,
} from '../components/ui';
import {
  CLIENT_PAGE_SIZE,
  INVOICE_PAGE_SIZE,
  PAYMENT_METHODS,
  clientBalances,
  createClient,
  errorMessage,
  getClient,
  listClients,
  listEmailMessages,
  listInvoices,
  listRecentPayments,
  updateClient,
  type ClientBalance,
  type ClientInput,
  type ClientRow,
  todayIn,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date, money } from '../lib/format';
import { useActiveOrg } from '../lib/org';
import { COUNTRIES, CURRENCIES } from '../lib/options';
import { useToast } from '../lib/toast';

const clientTitle = (c: Pick<ClientRow, 'name' | 'company'>) => c.company || c.name;

/** Outstanding amounts as "£1,200.00 · $300.00" (one entry per currency, never summed). */
function Outstanding({ balances }: { balances: ClientBalance[] }) {
  const open = balances.filter((b) => b.outstanding_minor > 0);
  if (open.length === 0) return <span className="text-faint">—</span>;
  return (
    <span className="tabular-nums">
      {open.map((b, i) => (
        <span key={b.currency} className={b.overdue_minor > 0 ? 'text-danger' : undefined}>
          {i > 0 && ' · '}
          {money(b.outstanding_minor, b.currency)}
        </span>
      ))}
    </span>
  );
}

// --- List ------------------------------------------------------------------------

export function ClientsPage() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get('page')) || 0);
  const archived = params.get('archived') === '1';
  const [search, setSearch] = useState(params.get('q') ?? '');

  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (p) => {
          if ((p.get('q') ?? '') === search) return p;
          const next = new URLSearchParams(p);
          if (search) next.set('q', search);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [search, setParams]);

  const opts = { page, search: params.get('q') ?? '', archived };
  const list = useQuery({
    queryKey: ['clients', org.id, opts],
    queryFn: () => listClients(sb, org.id, opts),
    placeholderData: keepPreviousData,
  });
  const balances = useQuery({
    queryKey: ['client-balances', org.id],
    queryFn: () => clientBalances(sb, org.id),
  });
  const byClient = new Map<string, ClientBalance[]>();
  balances.data?.forEach((b) =>
    byClient.set(b.client_id, [...(byClient.get(b.client_id) ?? []), b]),
  );

  const setParam = (key: string, value: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone you invoice. Clients are also added automatically when you save an invoice."
        actions={
          <Link to="/clients/new" className={buttonVariants()}>
            <Plus className="h-4 w-4" aria-hidden /> Add client
          </Link>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-rule p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Search clients"
              placeholder="Search by name, company or email"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div
            className="flex rounded-lg border border-field p-0.5 text-sm"
            role="group"
            aria-label="Show"
          >
            {[
              ['', 'Active'],
              ['1', 'Archived'],
            ].map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={(value === '1') === archived}
                onClick={() => setParam('archived', value!)}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium',
                  (value === '1') === archived
                    ? 'bg-brand-wash text-brand-ink'
                    : 'text-graphite hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.isPending ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : list.error ? (
          <div className="p-5">
            <Alert tone="danger">{errorMessage(list.error)}</Alert>
          </div>
        ) : list.data.rows.length === 0 ? (
          <EmptyState
            icon={<UserRound className="h-5 w-5" />}
            title={
              opts.search
                ? 'No matching clients'
                : archived
                  ? 'No archived clients'
                  : 'No clients yet'
            }
          >
            {opts.search
              ? 'Try a different search.'
              : archived
                ? undefined
                : 'Add a client, or save an invoice with a client in the editor.'}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
                    <th scope="col" className="px-5 py-2.5">
                      Client
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Email
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      Last invoice
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right">
                      Outstanding
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {list.data.rows.map((c) => {
                    const bal = byClient.get(c.id) ?? [];
                    const last = bal
                      .map((b) => b.last_issue_date)
                      .filter(Boolean)
                      .sort()
                      .at(-1);
                    return (
                      <tr key={c.id} className="hover:bg-hover/60">
                        <td className="px-5 py-3">
                          <Link
                            to={`/clients/${c.id}`}
                            className="font-semibold hover:text-brand-ink hover:underline"
                          >
                            {clientTitle(c)}
                          </Link>
                          {c.company && c.name && (
                            <div className="text-xs text-graphite">{c.name}</div>
                          )}
                        </td>
                        <td className="max-w-56 truncate px-3 py-3 text-graphite">
                          {c.email || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-graphite">{date(last)}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <Outstanding balances={bal} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > CLIENT_PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-rule px-5 py-3 text-sm text-graphite">
                <span>
                  {page * CLIENT_PAGE_SIZE + 1}–{Math.min(total, (page + 1) * CLIENT_PAGE_SIZE)} of{' '}
                  {total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setParam('page', String(page - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={(page + 1) * CLIENT_PAGE_SIZE >= total}
                    onClick={() => setParam('page', String(page + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

// --- Form ------------------------------------------------------------------------

const EMPTY: ClientInput = {
  name: '',
  company: '',
  email: '',
  phone: '',
  address: '',
  delivery_address: '',
  country: null,
  tax_id: '',
  reg_number: '',
  preferred_currency: null,
  payment_terms_days: null,
  notes: '',
};

/** Only editable columns, so stray row fields (id, org_id…) are never sent. */
const pickInput = (f: ClientInput): ClientInput => ({
  name: f.name,
  company: f.company,
  email: f.email,
  phone: f.phone,
  address: f.address,
  delivery_address: f.delivery_address,
  country: f.country,
  tax_id: f.tax_id,
  reg_number: f.reg_number,
  preferred_currency: f.preferred_currency,
  payment_terms_days: f.payment_terms_days,
  notes: f.notes,
});

function ClientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ClientInput;
  submitLabel: string;
  onSubmit: (input: ClientInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ClientInput>(initial);
  const [terms, setTerms] = useState(
    initial.payment_terms_days === null ? '' : String(initial.payment_terms_days),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ClientInput>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() && !form.company.trim())
      return setError('Enter a contact name or a company name.');
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()))
      return setError('Enter a valid email address.');
    const days = terms.trim() === '' ? null : Number(terms);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) {
      return setError('Payment terms must be a whole number of days between 0 and 365.');
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...pickInput(form),
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        tax_id: form.tax_id.trim(),
        reg_number: form.reg_number.trim(),
        payment_terms_days: days,
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 p-5">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              value={form.company}
              onChange={(e) => set({ company: e.target.value })}
            />
          )}
        </Field>
        <Field label="Contact name">
          {(p) => (
            <Input
              {...p}
              maxLength={200}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Email">
          {(p) => (
            <Input
              {...p}
              type="email"
              maxLength={254}
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          )}
        </Field>
        <Field label="Phone">
          {(p) => (
            <Input
              {...p}
              type="tel"
              maxLength={50}
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Billing address">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={1000}
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Country">
          {(p) => (
            <Select
              {...p}
              value={form.country ?? ''}
              onChange={(e) => set({ country: e.target.value || null })}
            >
              <option value="">Not set</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Preferred currency">
          {(p) => (
            <Select
              {...p}
              value={form.preferred_currency ?? ''}
              onChange={(e) => set({ preferred_currency: e.target.value || null })}
            >
              <option value="">Organization default</option>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Payment terms (days)" hint="Leave empty to use your default.">
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          )}
        </Field>
        <Field label="Tax / VAT number">
          {(p) => (
            <Input
              {...p}
              maxLength={60}
              value={form.tax_id}
              onChange={(e) => set({ tax_id: e.target.value })}
            />
          )}
        </Field>
        <Field label="Company number">
          {(p) => (
            <Input
              {...p}
              maxLength={60}
              value={form.reg_number}
              onChange={(e) => set({ reg_number: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Internal notes" hint="Only your team sees these.">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={5000}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function NewClientPage() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Add client" />
      <Card>
        <ClientForm
          initial={EMPTY}
          submitLabel="Add client"
          onCancel={() => navigate('/clients')}
          onSubmit={async (input) => {
            const id = await createClient(sb, org.id, input);
            await qc.invalidateQueries({ queryKey: ['clients', org.id] });
            toast(`${clientTitle(input)} added`);
            navigate(`/clients/${id}`, { replace: true });
          }}
        />
      </Card>
    </>
  );
}

// --- Detail -----------------------------------------------------------------------

const TABS = ['overview', 'invoices', 'payments', 'emails'] as const;
type Tab = (typeof TABS)[number];

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab)
    ? (params.get('tab') as Tab)
    : 'overview';
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const client = useQuery({ queryKey: ['client', id], queryFn: () => getClient(sb, id) });

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      updateClient(sb, id, { archived_at: archived ? new Date().toISOString() : null }),
    onSuccess: async (_d, archived) => {
      setArchiving(false);
      toast(archived ? 'Client archived' : 'Client restored');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['client', id] }),
        qc.invalidateQueries({ queryKey: ['clients', org.id] }),
      ]);
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (client.isPending) return <Skeleton className="h-96" />;
  if (client.error) return <Alert tone="danger">{errorMessage(client.error)}</Alert>;
  if (!client.data) {
    return (
      <Card>
        <EmptyState icon={<UserRound className="h-5 w-5" />} title="Client not found" />
      </Card>
    );
  }
  const c = client.data;

  return (
    <>
      <Link
        to="/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-graphite hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Clients
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold">
            {clientTitle(c)}
            {c.archived_at && <Badge>Archived</Badge>}
          </h1>
          {c.company && c.name && <p className="mt-1 text-sm text-graphite">{c.name}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!c.archived_at && (
            <a
              href={`/app.html?client=${c.id}`}
              onClick={() => setEditorSyncOrg(org.id)}
              className={buttonVariants()}
            >
              <PenLine className="h-4 w-4" aria-hidden /> New invoice
            </a>
          )}
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={editing}>
            Edit
          </Button>
          <Button
            variant="secondary"
            onClick={() => (c.archived_at ? archive.mutate(false) : setArchiving(true))}
          >
            {c.archived_at ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden />
            ) : (
              <Archive className="h-4 w-4" aria-hidden />
            )}
            {c.archived_at ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </div>

      {editing ? (
        <Card>
          <CardHeader title="Edit client" />
          <ClientForm
            initial={pickInput(c)}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              await updateClient(sb, c.id, input);
              await Promise.all([
                qc.invalidateQueries({ queryKey: ['client', id] }),
                qc.invalidateQueries({ queryKey: ['clients', org.id] }),
              ]);
              toast('Client saved');
              setEditing(false);
            }}
          />
        </Card>
      ) : (
        <>
          <div
            className="mb-4 flex gap-1 border-b border-rule"
            role="tablist"
            aria-label="Client sections"
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })}
                className={cn(
                  '-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold capitalize',
                  tab === t
                    ? 'border-brand text-brand-ink'
                    : 'border-transparent text-graphite hover:text-ink',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'overview' && <ClientOverview client={c} />}
            {tab === 'invoices' && <ClientInvoices clientId={c.id} />}
            {tab === 'payments' && <ClientPayments clientId={c.id} />}
            {tab === 'emails' && <ClientEmails clientId={c.id} />}
          </div>
        </>
      )}

      <ConfirmDialog
        open={archiving}
        title={`Archive ${clientTitle(c)}?`}
        confirmLabel="Archive"
        loading={archive.isPending}
        onCancel={() => setArchiving(false)}
        onConfirm={() => archive.mutate(true)}
      >
        The client is hidden from your client list. Their invoices and payments are kept unchanged,
        and you can restore them any time.
      </ConfirmDialog>
    </>
  );
}

function ClientOverview({ client: c }: { client: ClientRow }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const balances = useQuery({
    queryKey: ['client-balances', org.id, c.id],
    queryFn: () => clientBalances(sb, org.id, c.id),
  });
  const country = c.country
    ? (COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country)
    : null;
  const rows: [string, string | null][] = [
    ['Email', c.email],
    ['Phone', c.phone],
    ['Billing address', c.address],
    ['Country', country],
    ['Preferred currency', c.preferred_currency],
    ['Payment terms', c.payment_terms_days === null ? null : `${c.payment_terms_days} days`],
    ['Tax / VAT number', c.tax_id],
    ['Company number', c.reg_number],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="Details" />
        <dl className="divide-y divide-rule text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
                <dt className="text-graphite">{label}</dt>
                <dd className="whitespace-pre-wrap break-words">{value}</dd>
              </div>
            ))}
          {c.reminders_opted_out_at && (
            <div className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-graphite">Reminder emails</dt>
              <dd>
                Opted out on {date(c.reminders_opted_out_at)} from their invoice link. Automatic
                reminders are not sent.
              </dd>
            </div>
          )}
          {c.notes && (
            <div className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-graphite">Internal notes</dt>
              <dd className="whitespace-pre-wrap break-words">{c.notes}</dd>
            </div>
          )}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Balance" description="Issued invoices, per currency." />
        {balances.isPending ? (
          <Skeleton className="m-5 h-20" />
        ) : balances.error ? (
          <div className="p-5">
            <Alert tone="danger">{errorMessage(balances.error)}</Alert>
          </div>
        ) : balances.data.length === 0 ? (
          <p className="px-5 py-4 text-sm text-graphite">No issued invoices yet.</p>
        ) : (
          <div className="divide-y divide-rule">
            {balances.data.map((b) => (
              <dl key={b.currency} className="grid grid-cols-2 gap-y-1 px-5 py-4 text-sm">
                <dt className="text-graphite">Invoiced</dt>
                <dd className="text-right tabular-nums">{money(b.invoiced_minor, b.currency)}</dd>
                <dt className="text-graphite">Paid</dt>
                <dd className="text-right tabular-nums">{money(b.paid_minor, b.currency)}</dd>
                <dt className="font-semibold">Outstanding</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {money(b.outstanding_minor, b.currency)}
                </dd>
                {b.overdue_minor > 0 && (
                  <>
                    <dt className="text-danger">of which overdue</dt>
                    <dd className="text-right tabular-nums text-danger">
                      {money(b.overdue_minor, b.currency)}
                    </dd>
                  </>
                )}
              </dl>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ClientInvoices({ clientId }: { clientId: string }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const [page, setPage] = useState(0);
  const list = useQuery({
    queryKey: ['invoices', org.id, { clientId, page }],
    queryFn: () => listInvoices(sb, org.id, { page, search: '', docType: '', clientId }),
    placeholderData: keepPreviousData,
  });
  if (list.isPending) return <Skeleton className="h-40" />;
  if (list.error) return <Alert tone="danger">{errorMessage(list.error)}</Alert>;
  return (
    <Card>
      {list.data.rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title="No documents for this client yet"
        />
      ) : (
        <>
          <InvoiceTable orgId={org.id} rows={list.data.rows} today={todayIn(org.timezone)} />
          {list.data.total > INVOICE_PAGE_SIZE && (
            <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={(page + 1) * INVOICE_PAGE_SIZE >= list.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label]));

function ClientPayments({ clientId }: { clientId: string }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const payments = useQuery({
    queryKey: ['client-payments', org.id, clientId],
    queryFn: () => listRecentPayments(sb, org.id, { clientId, limit: 100 }),
  });
  if (payments.isPending) return <Skeleton className="h-40" />;
  if (payments.error) return <Alert tone="danger">{errorMessage(payments.error)}</Alert>;
  return (
    <Card>
      {payments.data.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title="No payments recorded for this client"
        />
      ) : (
        <ul className="divide-y divide-rule">
          {payments.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold tabular-nums">{money(p.amount_minor, p.currency)}</p>
                <p className="text-xs text-graphite">
                  {date(p.paid_on)} · {METHOD_LABEL[p.method]}
                  {p.reference && ` · ${p.reference}`}
                </p>
              </div>
              <Link to={`/invoices/${p.invoice_id}`} className="text-sm font-medium text-brand-ink">
                {p.invoice?.number}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ClientEmails({ clientId }: { clientId: string }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const messages = useQuery({
    queryKey: ['emails', org.id, 'client', clientId],
    queryFn: () => listEmailMessages(sb, org.id, { clientId, limit: 100 }),
  });
  if (messages.isPending) return <Skeleton className="h-40" />;
  if (messages.error) return <Alert tone="danger">{errorMessage(messages.error)}</Alert>;
  return (
    <Card>
      {messages.data.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title="No emails sent to this client yet"
        />
      ) : (
        <EmailActivity messages={messages.data} showInvoice />
      )}
    </Card>
  );
}
