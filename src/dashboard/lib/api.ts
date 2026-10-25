/**
 * Typed data access for the dashboard. Reads go straight to Postgres through
 * RLS; privileged changes call security-definer RPCs that re-check roles.
 * Nothing here is a security boundary: the database is.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { CloudError, callFunction, cloudErrorMessage } from '../../cloud/invoices';
import type { EmailKind, Tone } from '../../core/emails';
import { businessSchema } from '../../core/validate';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  country: string | null;
  default_currency: string;
  timezone: string;
  onboarding_completed_at: string | null;
}

export interface Membership {
  role: OrgRole;
  org: Organization;
}

export interface OrgSettings {
  org_id: string;
  business: z.infer<typeof businessSchema>;
  invoice_prefix: string;
  tax_label: string;
  tax_rate: number;
  payment_terms: string;
  payment_instructions: string;
  logo_path: string | null;
  email_from_name: string;
  email_reply_to: string;
  email_signature: string;
  reminders_enabled: boolean;
  reminder_send_hour: number;
  reminders_weekdays_only: boolean;
}

export interface Subscription {
  plan_code: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
}

export interface Plan {
  code: string;
  name: string;
  price_minor: number;
  currency: string;
  billing_interval: 'month' | 'year';
  limits: {
    cloud_invoices: number;
    users: number;
    email_sends_per_month: number;
    ai_requests_per_month: number;
  };
}

export interface CloudInvoiceRow {
  id: string;
  local_id: string;
  doc_type: 'invoice' | 'quote' | 'credit' | 'receipt' | 'proforma';
  number: string;
  status: string;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  client_name: string;
  total_minor: number;
  paid_minor: number;
  balance_minor: number;
  client_id: string | null;
  issued_at: string | null;
  updated_at: string;
  source: 'editor' | 'import';
}

export interface Member {
  user_id: string;
  role: OrgRole;
  created_at: string;
  profile: { full_name: string; email: string } | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Error with a user-facing message; `code` is our SQLSTATE (SA4xx) when known. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function fail(error: { message: string; code?: string } | null): never {
  const code = error?.code;
  // Our SQL functions raise SA4xx codes with messages written for users.
  if (code?.startsWith('SA')) throw new ApiError(error!.message, code);
  if (code === '42501') throw new ApiError('You do not have permission to do that.', code);
  throw new ApiError('Something went wrong. Please try again.', code);
}

export async function listMemberships(sb: SupabaseClient, userId: string): Promise<Membership[]> {
  const { data, error } = await sb
    .from('organization_members')
    .select(
      'role, org:organizations(id, name, country, default_currency, timezone, onboarding_completed_at)',
    )
    .eq('user_id', userId)
    .order('created_at');
  if (error) fail(error);
  return (data as unknown as { role: OrgRole; org: Organization | null }[])
    .filter((m): m is Membership => m.org !== null)
    .sort((a, b) => a.org.name.localeCompare(b.org.name));
}

export async function createOrganization(
  sb: SupabaseClient,
  input: { name: string; country: string; currency: string; timezone: string },
): Promise<string> {
  const { data, error } = await sb.rpc('create_organization', {
    p_name: input.name,
    p_country: input.country || null,
    p_currency: input.currency,
    p_timezone: input.timezone,
  });
  if (error) fail(error);
  return data as string;
}

export async function updateOrganization(
  sb: SupabaseClient,
  orgId: string,
  patch: Partial<
    Pick<
      Organization,
      'name' | 'country' | 'default_currency' | 'timezone' | 'onboarding_completed_at'
    >
  >,
): Promise<void> {
  const { error } = await sb.from('organizations').update(patch).eq('id', orgId);
  if (error) fail(error);
}

const BLANK_BUSINESS = businessSchema.parse({
  name: '',
  address: '',
  email: '',
  phone: '',
  website: '',
  taxId: '',
});

export async function getSettings(sb: SupabaseClient, orgId: string): Promise<OrgSettings> {
  const { data, error } = await sb
    .from('organization_settings')
    .select('*')
    .eq('org_id', orgId)
    .single();
  if (error) fail(error);
  // Stored JSON is re-validated like anything else crossing a trust boundary.
  const business = businessSchema.safeParse({ ...BLANK_BUSINESS, ...(data.business as object) });
  return {
    ...(data as OrgSettings),
    tax_rate: Number(data.tax_rate),
    business: business.success ? business.data : BLANK_BUSINESS,
  };
}

export async function updateSettings(
  sb: SupabaseClient,
  orgId: string,
  userId: string,
  patch: Partial<Omit<OrgSettings, 'org_id'>>,
): Promise<void> {
  const { error } = await sb
    .from('organization_settings')
    .update({ ...patch, updated_by: userId })
    .eq('org_id', orgId);
  if (error) fail(error);
}

export async function getSubscription(
  sb: SupabaseClient,
  orgId: string,
): Promise<{ sub: Subscription | null; plans: Plan[] }> {
  const [subRes, plansRes] = await Promise.all([
    sb
      .from('subscriptions')
      .select('plan_code, status, trial_ends_at, current_period_end, cancel_at_period_end')
      .eq('org_id', orgId)
      .maybeSingle(),
    sb
      .from('plans')
      .select('code, name, price_minor, currency, billing_interval, limits')
      .order('sort_order'),
  ]);
  if (subRes.error) fail(subRes.error);
  if (plansRes.error) fail(plansRes.error);
  return { sub: subRes.data as Subscription | null, plans: plansRes.data as Plan[] };
}

/** Mirrors app.effective_plan() in SQL, for display only. */
export function effectivePlanCode(sub: Subscription | null, now = Date.now()): string {
  if (!sub) return 'free';
  if (sub.status === 'active' || sub.status === 'past_due') return sub.plan_code;
  if (sub.status === 'trialing' && sub.trial_ends_at && Date.parse(sub.trial_ends_at) > now)
    return sub.plan_code;
  if (
    sub.status === 'canceled' &&
    sub.current_period_end &&
    Date.parse(sub.current_period_end) > now
  )
    return sub.plan_code;
  return 'free';
}

export const INVOICE_PAGE_SIZE = 25;

const INVOICE_COLUMNS =
  'id, local_id, doc_type, number, status, currency, issue_date, due_date, client_name, total_minor, paid_minor, balance_minor, client_id, issued_at, updated_at, source';

export const PAYMENT_FILTERS = ['', 'draft', 'open', 'partial', 'overdue', 'paid'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];
export const INVOICE_SORTS = ['updated', 'due', 'issued', 'amount'] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export interface InvoiceQuery {
  page: number;
  search: string;
  docType: string;
  filter?: PaymentFilter;
  sort?: InvoiceSort;
  clientId?: string;
  /** Today in the organization's timezone (for "overdue"). */
  today?: string;
}

/** Text safe to embed in a PostgREST or() filter. */
export const searchTerm = (raw: string): string =>
  raw
    .replace(/[%_,()\\"*:]/g, ' ')
    .trim()
    .slice(0, 80);

export async function listInvoices(
  sb: SupabaseClient,
  orgId: string,
  opts: InvoiceQuery,
): Promise<{ rows: CloudInvoiceRow[]; total: number }> {
  let q = sb.from('invoices').select(INVOICE_COLUMNS, { count: 'exact' }).eq('org_id', orgId);
  if (opts.docType) q = q.eq('doc_type', opts.docType);
  if (opts.clientId) q = q.eq('client_id', opts.clientId);
  const open = () =>
    q
      .eq('doc_type', 'invoice')
      .not('issued_at', 'is', null)
      .gt('balance_minor', 0)
      .neq('status', 'Cancelled');
  switch (opts.filter) {
    case 'draft':
      q = q.is('issued_at', null);
      break;
    case 'open':
      q = open();
      break;
    case 'partial':
      q = open().gt('paid_minor', 0);
      break;
    case 'overdue':
      q = open().lt('due_date', opts.today ?? new Date().toISOString().slice(0, 10));
      break;
    case 'paid':
      q = q.eq('status', 'Paid');
      break;
  }
  switch (opts.sort) {
    case 'due':
      q = q.order('due_date', { ascending: true, nullsFirst: false });
      break;
    case 'issued':
      q = q.order('issue_date', { ascending: false, nullsFirst: false });
      break;
    case 'amount':
      q = q.order('total_minor', { ascending: false });
      break;
    default:
      q = q.order('updated_at', { ascending: false });
  }
  const term = searchTerm(opts.search);
  if (term) q = q.or(`number.ilike.%${term}%,client_name.ilike.%${term}%`);
  const from = opts.page * INVOICE_PAGE_SIZE;
  const { data, error, count } = await q.range(from, from + INVOICE_PAGE_SIZE - 1);
  if (error) fail(error);
  return { rows: data as unknown as CloudInvoiceRow[], total: count ?? 0 };
}

export async function countInvoices(sb: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await sb
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (error) fail(error);
  return count ?? 0;
}

/** Cloud ids of every document in the org (for import de-duplication). */
export async function listCloudLocalIds(sb: SupabaseClient, orgId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('invoices')
      .select('local_id')
      .eq('org_id', orgId)
      .range(from, from + 999);
    if (error) fail(error);
    data.forEach((r) => ids.add(r.local_id as string));
    if (data.length < 1000) return ids;
  }
}

export async function deleteDraft(sb: SupabaseClient, invoiceId: string): Promise<void> {
  const { error } = await sb.rpc('delete_draft_invoice', { p_invoice: invoiceId });
  if (error) fail(error);
}

export async function listMembers(sb: SupabaseClient, orgId: string): Promise<Member[]> {
  const { data, error } = await sb
    .from('organization_members')
    .select('user_id, role, created_at, profile:profiles(full_name, email)')
    .eq('org_id', orgId)
    .order('created_at');
  if (error) fail(error);
  return data as unknown as Member[];
}

export async function listInvitations(sb: SupabaseClient, orgId: string): Promise<Invitation[]> {
  const { data, error } = await sb
    .from('organization_invitations')
    .select('id, email, role, expires_at, accepted_at, revoked_at, created_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return data as Invitation[];
}

export async function createInvitation(
  sb: SupabaseClient,
  orgId: string,
  email: string,
  role: OrgRole,
): Promise<string> {
  const { data, error } = await sb.rpc('create_invitation', {
    p_org: orgId,
    p_email: email,
    p_role: role,
  });
  if (error) fail(error);
  return data as string;
}

export async function revokeInvitation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc('revoke_invitation', { p_invitation: id });
  if (error) fail(error);
}

export async function acceptInvitation(sb: SupabaseClient, token: string): Promise<string> {
  const { data, error } = await sb.rpc('accept_invitation', { p_token: token });
  if (error) fail(error);
  return data as string;
}

export async function removeMember(
  sb: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<void> {
  const { error } = await sb.rpc('remove_member', { p_org: orgId, p_user: userId });
  if (error) fail(error);
}

export async function updateMemberRole(
  sb: SupabaseClient,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<void> {
  const { error } = await sb.rpc('update_member_role', {
    p_org: orgId,
    p_user: userId,
    p_role: role,
  });
  if (error) fail(error);
}

export async function getProfile(
  sb: SupabaseClient,
  userId: string,
): Promise<{ full_name: string; email: string }> {
  const { data, error } = await sb
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single();
  if (error) fail(error);
  return data;
}

export async function updateProfile(
  sb: SupabaseClient,
  userId: string,
  fullName: string,
): Promise<void> {
  const { error } = await sb.from('profiles').update({ full_name: fullName }).eq('id', userId);
  if (error) fail(error);
}

export async function getPendingDeletion(
  sb: SupabaseClient,
): Promise<{ created_at: string } | null> {
  const { data, error } = await sb
    .from('account_deletion_requests')
    .select('created_at')
    .in('status', ['pending', 'processing'])
    .maybeSingle();
  if (error) fail(error);
  return data;
}

export async function requestAccountDeletion(sb: SupabaseClient, reason: string): Promise<void> {
  const { error } = await sb.from('account_deletion_requests').insert({ reason });
  if (error) fail(error);
}

export const LOGO_BUCKET = 'org-assets';

export async function uploadLogo(
  sb: SupabaseClient,
  orgId: string,
  file: Blob,
  ext: 'png' | 'jpeg' | 'webp',
): Promise<string> {
  const path = `${orgId}/logo-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const { error } = await sb.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: `image/${ext}`, upsert: false });
  if (error)
    throw new ApiError('The logo could not be uploaded. Use a PNG, JPEG or WebP under 2 MB.');
  return path;
}

export async function logoUrl(sb: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await sb.storage.from(LOGO_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof CloudError) return cloudErrorMessage(err);
  if (err instanceof Error && /fetch|network/i.test(err.message))
    return 'Could not reach the server. Check your connection.';
  return 'Something went wrong. Please try again.';
}

// --- Phase 2: invoice detail, payments, sharing ---------------------------------

export interface InvoiceDetail extends CloudInvoiceRow {
  revision: number;
  document: unknown;
}

export async function getInvoice(sb: SupabaseClient, id: string): Promise<InvoiceDetail | null> {
  const { data, error } = await sb
    .from('invoices')
    .select(`${INVOICE_COLUMNS}, revision, document`)
    .eq('id', id)
    .maybeSingle();
  if (error) fail(error);
  return data as InvoiceDetail | null;
}

export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'online', label: 'Online payment' },
  { value: 'other', label: 'Other' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];

export interface PaymentRow {
  id: string;
  invoice_id: string;
  amount_minor: number;
  currency: string;
  paid_on: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  source: 'manual' | 'opening_balance';
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  invoice?: { number: string; client_name: string } | null;
}

const PAYMENT_COLUMNS =
  'id, invoice_id, amount_minor, currency, paid_on, method, reference, notes, source, created_at, voided_at, void_reason';

export async function listPayments(sb: SupabaseClient, invoiceId: string): Promise<PaymentRow[]> {
  const { data, error } = await sb
    .from('invoice_payments')
    .select(PAYMENT_COLUMNS)
    .eq('invoice_id', invoiceId)
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return data as PaymentRow[];
}

/** Recent valid payments across the org, optionally for one client. */
export async function listRecentPayments(
  sb: SupabaseClient,
  orgId: string,
  opts: { limit?: number; clientId?: string } = {},
): Promise<PaymentRow[]> {
  let q = sb
    .from('invoice_payments')
    .select(`${PAYMENT_COLUMNS}, invoice:invoices!inner(number, client_name, client_id)`)
    .eq('org_id', orgId)
    .is('voided_at', null)
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 10);
  if (opts.clientId) q = q.eq('invoice.client_id', opts.clientId);
  const { data, error } = await q;
  if (error) fail(error);
  return data as unknown as PaymentRow[];
}

export async function recordPayment(
  sb: SupabaseClient,
  input: {
    invoiceId: string;
    amountMinor: number;
    paidOn: string;
    method: PaymentMethod;
    reference: string;
    notes: string;
  },
): Promise<void> {
  const { error } = await sb.rpc('record_payment', {
    p_invoice: input.invoiceId,
    p_amount_minor: input.amountMinor,
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
    p_notes: input.notes,
  });
  if (error) fail(error);
}

export async function voidPayment(
  sb: SupabaseClient,
  paymentId: string,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc('void_payment', { p_payment: paymentId, p_reason: reason });
  if (error) fail(error);
}

export interface ShareRow {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
}

export async function listShares(sb: SupabaseClient, invoiceId: string): Promise<ShareRow[]> {
  const { data, error } = await sb
    .from('invoice_shares')
    .select('id, created_at, expires_at, revoked_at, last_viewed_at, view_count')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return data as ShareRow[];
}

export async function createShare(
  sb: SupabaseClient,
  invoiceId: string,
  days: number,
): Promise<string> {
  const { data, error } = await sb.rpc('create_invoice_share', {
    p_invoice: invoiceId,
    p_days: days,
  });
  if (error) fail(error);
  return data as string;
}

export async function revokeShare(sb: SupabaseClient, shareId: string): Promise<void> {
  const { error } = await sb.rpc('revoke_invoice_share', { p_share: shareId });
  if (error) fail(error);
}

export const shareUrl = (token: string): string => `${location.origin}/invoice.html#t=${token}`;

export interface HistoryEntry {
  id: number;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
}

export async function invoiceHistory(
  sb: SupabaseClient,
  invoiceId: string,
): Promise<HistoryEntry[]> {
  const { data, error } = await sb
    .from('audit_logs')
    .select('id, action, metadata, created_at, actor_id')
    .eq('entity_type', 'invoice')
    .eq('entity_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) fail(error);
  return data as HistoryEntry[];
}

// --- Phase 2: clients ---------------------------------------------------------------

export interface ClientRow {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  delivery_address: string;
  country: string | null;
  tax_id: string;
  reg_number: string;
  preferred_currency: string | null;
  payment_terms_days: number | null;
  notes: string;
  archived_at: string | null;
  created_at: string;
  reminders_opted_out_at: string | null;
}

export type ClientInput = Omit<
  ClientRow,
  'id' | 'archived_at' | 'created_at' | 'reminders_opted_out_at'
>;

export const CLIENT_PAGE_SIZE = 25;

export async function listClients(
  sb: SupabaseClient,
  orgId: string,
  opts: { page: number; search: string; archived: boolean },
): Promise<{ rows: ClientRow[]; total: number }> {
  let q = sb
    .from('clients')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
    .order('company')
    .order('name');
  q = opts.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  const term = searchTerm(opts.search);
  if (term) q = q.or(`name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%`);
  const from = opts.page * CLIENT_PAGE_SIZE;
  const { data, error, count } = await q.range(from, from + CLIENT_PAGE_SIZE - 1);
  if (error) fail(error);
  return { rows: data as ClientRow[], total: count ?? 0 };
}

export async function getClient(sb: SupabaseClient, id: string): Promise<ClientRow | null> {
  const { data, error } = await sb.from('clients').select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  return data as ClientRow | null;
}

export async function createClient(
  sb: SupabaseClient,
  orgId: string,
  input: ClientInput,
): Promise<string> {
  const { data, error } = await sb
    .from('clients')
    .insert({ ...input, org_id: orgId })
    .select('id')
    .single();
  if (error) fail(error);
  return data.id as string;
}

export async function updateClient(
  sb: SupabaseClient,
  id: string,
  patch: Partial<ClientInput> & { archived_at?: string | null },
): Promise<void> {
  const { error } = await sb.from('clients').update(patch).eq('id', id);
  if (error) fail(error);
}

export interface ClientBalance {
  client_id: string;
  currency: string;
  invoiced_minor: number;
  paid_minor: number;
  outstanding_minor: number;
  overdue_minor: number;
  invoice_count: number;
  last_issue_date: string | null;
}

export async function clientBalances(
  sb: SupabaseClient,
  orgId: string,
  clientId?: string,
): Promise<ClientBalance[]> {
  const { data, error } = await sb.rpc('client_balances', {
    p_org: orgId,
    p_client: clientId ?? null,
  });
  if (error) fail(error);
  return data as ClientBalance[];
}

// --- Phase 2: dashboard -------------------------------------------------------------

export interface DashboardSummary {
  currency: string;
  today: string;
  invoicedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  outstandingCount: number;
  overdueMinor: number;
  overdueCount: number;
  partialMinor: number;
  partialCount: number;
  dueWeekMinor: number;
  dueWeekCount: number;
  paymentsMonthMinor: number;
  monthly: { month: string; invoicedMinor: number; receivedMinor: number }[];
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  statusCounts: { paid: number; partial: number; unpaid: number; overdue: number };
}

export async function dashboardSummary(
  sb: SupabaseClient,
  orgId: string,
  currency: string,
): Promise<DashboardSummary> {
  const { data, error } = await sb.rpc('dashboard_summary', { p_org: orgId, p_currency: currency });
  if (error) fail(error);
  return data as DashboardSummary;
}

export async function orgCurrencies(sb: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await sb.rpc('org_currencies', { p_org: orgId });
  if (error) fail(error);
  return (data as { currency: string }[]).map((r) => r.currency);
}

export async function countActiveClients(sb: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await sb
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('archived_at', null);
  if (error) fail(error);
  return count ?? 0;
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function searchAll(
  sb: SupabaseClient,
  orgId: string,
  raw: string,
): Promise<{ invoices: CloudInvoiceRow[]; clients: ClientRow[] }> {
  const term = searchTerm(raw);
  if (!term) return { invoices: [], clients: [] };
  const [inv, cli] = await Promise.all([
    listInvoices(sb, orgId, { page: 0, search: term, docType: '' }),
    listClients(sb, orgId, { page: 0, search: term, archived: false }),
  ]);
  return { invoices: inv.rows.slice(0, 10), clients: cli.rows.slice(0, 10) };
}

// --- Phase 3: RecoverFlow (email, reminders, AI) ---------------------------------------

export type EmailStatus =
  | 'queued'
  | 'accepted'
  | 'sent'
  | 'delivery_delayed'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed';

export interface EmailMessageRow {
  id: string;
  invoice_id: string | null;
  client_id: string | null;
  reminder_job_id: string | null;
  kind: EmailKind;
  to_email: string;
  subject: string;
  body_text: string;
  status: EmailStatus;
  error: string | null;
  created_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
  invoice?: { number: string } | null;
}

export async function listEmailMessages(
  sb: SupabaseClient,
  orgId: string,
  opts: { invoiceId?: string; clientId?: string; limit?: number } = {},
): Promise<EmailMessageRow[]> {
  let q = sb
    .from('email_messages')
    .select(
      'id, invoice_id, client_id, reminder_job_id, kind, to_email, subject, body_text, status, error, created_at, accepted_at, delivered_at, invoice:invoices(number)',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.invoiceId) q = q.eq('invoice_id', opts.invoiceId);
  if (opts.clientId) q = q.eq('client_id', opts.clientId);
  const { data, error } = await q;
  if (error) fail(error);
  return data as unknown as EmailMessageRow[];
}

export interface ReminderRule {
  id: string;
  offset_days: number;
  kind: Exclude<EmailKind, 'new_invoice' | 'payment_received'>;
  tone: Tone;
  is_active: boolean;
}

export async function listRules(sb: SupabaseClient, orgId: string): Promise<ReminderRule[]> {
  const { data, error } = await sb
    .from('reminder_rules')
    .select('id, offset_days, kind, tone, is_active')
    .eq('org_id', orgId)
    .order('offset_days');
  if (error) fail(error);
  return data as ReminderRule[];
}

export async function saveRule(
  sb: SupabaseClient,
  orgId: string,
  rule: Omit<ReminderRule, 'id'> & { id?: string },
): Promise<void> {
  const fields = {
    offset_days: rule.offset_days,
    kind: rule.kind,
    tone: rule.tone,
    is_active: rule.is_active,
  };
  const { error } = rule.id
    ? await sb.from('reminder_rules').update(fields).eq('id', rule.id)
    : await sb.from('reminder_rules').insert({ ...fields, org_id: orgId });
  if (error?.code === '23505') throw new ApiError('There is already a reminder at that timing.');
  if (error) fail(error);
}

export async function deleteRule(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('reminder_rules').delete().eq('id', id);
  if (error) fail(error);
}

export async function setRemindersEnabled(
  sb: SupabaseClient,
  orgId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await sb.rpc('set_reminders_enabled', { p_org: orgId, p_enabled: enabled });
  if (error) fail(error);
}

export interface TemplateRow {
  kind: EmailKind;
  subject: string;
  body: string;
}

export async function listTemplates(sb: SupabaseClient, orgId: string): Promise<TemplateRow[]> {
  const { data, error } = await sb
    .from('email_templates')
    .select('kind, subject, body')
    .eq('org_id', orgId);
  if (error) fail(error);
  return data as TemplateRow[];
}

export async function saveTemplate(
  sb: SupabaseClient,
  orgId: string,
  t: TemplateRow,
): Promise<void> {
  const { error } = await sb
    .from('email_templates')
    .upsert(
      { org_id: orgId, kind: t.kind, subject: t.subject, body: t.body },
      { onConflict: 'org_id,kind' },
    );
  if (error) fail(error);
}

export async function resetTemplate(
  sb: SupabaseClient,
  orgId: string,
  kind: EmailKind,
): Promise<void> {
  const { error } = await sb.from('email_templates').delete().eq('org_id', orgId).eq('kind', kind);
  if (error) fail(error);
}

export interface ReminderStatus {
  blockReason: string | null;
  paused: boolean;
  disputed: boolean;
  disputeNote: string;
}

export async function reminderStatus(
  sb: SupabaseClient,
  invoiceId: string,
): Promise<ReminderStatus> {
  const { data, error } = await sb.rpc('invoice_reminder_status', { p_invoice: invoiceId });
  if (error) fail(error);
  return data as ReminderStatus;
}

export async function setRemindersPaused(
  sb: SupabaseClient,
  invoiceId: string,
  paused: boolean,
): Promise<void> {
  const { error } = await sb.rpc('set_invoice_reminders_paused', {
    p_invoice: invoiceId,
    p_paused: paused,
  });
  if (error) fail(error);
}

export async function setDispute(
  sb: SupabaseClient,
  invoiceId: string,
  open: boolean,
  note = '',
): Promise<void> {
  const { error } = await sb.rpc('set_invoice_dispute', {
    p_invoice: invoiceId,
    p_open: open,
    p_note: note,
  });
  if (error) fail(error);
}

export interface ReminderJobRow {
  id: string;
  invoice_id: string;
  offset_days: number;
  kind: EmailKind;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'skipped';
  attempts: number;
  last_error: string | null;
  cancel_reason: string | null;
  scheduled_for: string;
  next_attempt_at: string;
  invoice?: { number: string; client_name: string } | null;
}

export async function listReminderJobs(
  sb: SupabaseClient,
  orgId: string,
  opts: { invoiceId?: string; limit?: number } = {},
): Promise<ReminderJobRow[]> {
  let q = sb
    .from('reminder_jobs')
    .select(
      'id, invoice_id, offset_days, kind, status, attempts, last_error, cancel_reason, scheduled_for, next_attempt_at, invoice:invoices(number, client_name)',
    )
    .eq('org_id', orgId)
    .order('scheduled_for', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.invoiceId) q = q.eq('invoice_id', opts.invoiceId);
  const { data, error } = await q;
  if (error) fail(error);
  return data as unknown as ReminderJobRow[];
}

export async function listSuppressions(
  sb: SupabaseClient,
  orgId: string,
): Promise<{ email: string; reason: string; created_at: string }[]> {
  const { data, error } = await sb
    .from('email_suppressions')
    .select('email, reason, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return data as { email: string; reason: string; created_at: string }[];
}

export async function removeSuppression(
  sb: SupabaseClient,
  orgId: string,
  email: string,
): Promise<void> {
  const { error } = await sb.rpc('remove_email_suppression', { p_org: orgId, p_email: email });
  if (error) fail(error);
}

/** This month's usage of metered features (UTC calendar month, as enforced in SQL). */
export async function monthlyUsage(
  sb: SupabaseClient,
  orgId: string,
): Promise<Record<string, number>> {
  const period = new Date().toISOString().slice(0, 7);
  const { data, error } = await sb
    .from('usage_counters')
    .select('metric, used')
    .eq('org_id', orgId)
    .eq('period', period);
  if (error) fail(error);
  return Object.fromEntries(
    (data as { metric: string; used: number }[]).map((r) => [r.metric, r.used]),
  );
}

export async function sendInvoiceEmail(
  sb: SupabaseClient,
  input: {
    invoiceId: string;
    kind: EmailKind;
    to: string;
    subject: string;
    body: string;
    requestId: string;
  },
): Promise<{ messageId: string; status: string; duplicate?: boolean }> {
  return (await callFunction(sb, 'send-email', { ...input })) as {
    messageId: string;
    status: string;
  };
}

export interface ReplyAnalysis {
  summary: string;
  intent: 'will_pay' | 'paid_already' | 'dispute' | 'question' | 'needs_more_time' | 'other';
  dispute: boolean;
  dispute_reason: string | null;
  proposed_payment_date: string | null;
  suggested_actions: string[];
  suggested_reply: string;
  requires_verification: boolean;
}

export type AiRequest =
  | { action: 'draft_reminder'; invoiceId: string; kind: EmailKind; tone: Tone }
  | { action: 'rewrite'; orgId: string; subject: string; body: string; tone: Tone }
  | { action: 'analyze_reply'; orgId: string; text: string }
  | { action: 'explain_outstanding'; orgId: string; currency: string };

export async function askAssistant<T>(sb: SupabaseClient, req: AiRequest): Promise<T> {
  return (await callFunction(sb, 'ai-assistant', { ...req })) as T;
}

// --- Phase 4: billing ---------------------------------------------------------------------

export async function planChangeProblems(
  sb: SupabaseClient,
  orgId: string,
  plan: string,
): Promise<string[]> {
  const { data, error } = await sb.rpc('plan_change_check', { p_org: orgId, p_plan: plan });
  if (error) fail(error);
  return data as string[];
}

export interface BillingInvoice {
  id: string;
  billedAt: string | null;
  status: string;
  totalMinor: number;
  currency: string;
  invoiceNumber: string | null;
}

type BillingRequest =
  | { action: 'select_plan'; orgId: string; plan: string }
  | { action: 'cancel' | 'resume' | 'portal' | 'invoices'; orgId: string }
  | { action: 'invoice_pdf'; orgId: string; invoiceId: string };

export async function billing<T>(sb: SupabaseClient, req: BillingRequest): Promise<T> {
  return (await callFunction(sb, 'billing', { ...req })) as T;
}

export async function countMembers(sb: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await sb
    .from('organization_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('org_id', orgId);
  if (error) fail(error);
  return count ?? 0;
}
