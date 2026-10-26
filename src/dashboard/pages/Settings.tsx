import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ImagePlus, Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { setActiveOrg, setEditorSyncOrg } from '../../cloud/prefs';
import { saveInvoicePrefix } from '../../core/storage';
import { LogoError, processLogo } from '../../ui/logo';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '../components/ui';
import {
  createInvitation,
  errorMessage,
  getPendingDeletion,
  getProfile,
  getSettings,
  listInvitations,
  listMembers,
  logoUrl,
  removeMember,
  requestAccountDeletion,
  revokeInvitation,
  updateMemberPermissions,
  updateMemberRole,
  updateOrganization,
  updateProfile,
  updateSettings,
  uploadLogo,
  type Member,
  type MemberPermissions,
  type OrgRole,
  type OrgSettings,
} from '../lib/api';
import { useAuth, useSupabase } from '../lib/auth';
import { canManage, useActiveOrg, useOrgs } from '../lib/org';
import { COUNTRIES, CURRENCIES, timezones } from '../lib/options';
import { useToast } from '../lib/toast';
import { PasswordChecklist } from './Auth';
import { passwordProblem } from '../../core/password';

// --- Business settings ---------------------------------------------------------

export function OrganizationSettingsPage() {
  const sb = useSupabase();
  const active = useActiveOrg();
  const settings = useQuery({
    queryKey: ['settings', active.org.id],
    queryFn: () => getSettings(sb, active.org.id),
  });
  if (!canManage(active)) return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader
        title="Business settings"
        description="Details used on your invoices and across the workspace."
      />
      {settings.isPending ? (
        <Skeleton className="h-96" />
      ) : settings.error ? (
        <Alert tone="danger">{errorMessage(settings.error)}</Alert>
      ) : (
        <OrganizationForm key={active.org.id} settings={settings.data} />
      )}
    </>
  );
}

function OrganizationForm({ settings }: { settings: OrgSettings }) {
  const sb = useSupabase();
  const { user } = useAuth();
  const { org } = useActiveOrg();
  const { refetch } = useOrgs();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: org.name,
    country: org.country ?? '',
    currency: org.default_currency,
    timezone: org.timezone,
    email: settings.business.email,
    phone: settings.business.phone,
    website: settings.business.website,
    address: settings.business.address,
    taxId: settings.business.taxId,
    taxLabel: settings.tax_label,
    taxRate: String(settings.tax_rate),
    prefix: settings.invoice_prefix,
    paymentTerms: settings.payment_terms,
    paymentInstructions: settings.payment_instructions,
    emailFromName: settings.email_from_name,
    emailReplyTo: settings.email_reply_to,
    emailSignature: settings.email_signature,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      const rate = Number(form.taxRate);
      if (!form.name.trim()) throw new Error('Enter your business name.');
      if (!Number.isFinite(rate) || rate < 0 || rate > 100)
        throw new Error('Tax rate must be between 0 and 100.');
      if (form.emailReplyTo.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.emailReplyTo.trim()))
        throw new Error('Reply-to must be a valid email address.');
      if (!/^[\w\-/.#]{0,20}$/.test(form.prefix))
        throw new Error('Invoice prefix: up to 20 letters, digits or - / . #');
      await updateOrganization(sb, org.id, {
        name: form.name.trim(),
        country: form.country || null,
        default_currency: form.currency,
        timezone: form.timezone,
      });
      await updateSettings(sb, org.id, user!.id, {
        business: {
          ...settings.business,
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          website: form.website.trim(),
          address: form.address.trim(),
          taxId: form.taxId.trim(),
        },
        tax_label: form.taxLabel.trim() || 'Tax',
        tax_rate: rate,
        invoice_prefix: form.prefix,
        payment_terms: form.paymentTerms.trim(),
        payment_instructions: form.paymentInstructions.trim(),
        email_from_name: form.emailFromName.trim().slice(0, 80),
        email_reply_to: form.emailReplyTo.trim().toLowerCase(),
        email_signature: form.emailSignature.trim().slice(0, 1000),
      });
      if (form.prefix) saveInvoicePrefix(form.prefix);
    },
    onSuccess: async () => {
      setError(null);
      toast('Settings saved');
      await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['settings', org.id] })]);
    },
    onError: (err) =>
      setError(err instanceof Error && !('code' in err) ? err.message : errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const tzs = timezones();

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <CardHeader title="Business" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Business name">
            {(p) => (
              <Input
                {...p}
                maxLength={120}
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
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            )}
          </Field>
          <Field label="Website">
            {(p) => (
              <Input
                {...p}
                value={form.website}
                onChange={(e) => set({ website: e.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
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
                value={form.country}
                onChange={(e) => set({ country: e.target.value })}
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
          <Field label="Timezone" hint="Used for due dates and, later, reminder timing.">
            {(p) => (
              <Select
                {...p}
                value={form.timezone}
                onChange={(e) => set({ timezone: e.target.value })}
              >
                {(tzs.includes(form.timezone) ? tzs : [form.timezone, ...tzs]).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <LogoCard path={settings.logo_path} />

      <Card>
        <CardHeader
          title="Email"
          description="How invoice and reminder emails appear to your clients."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Sender name"
            hint={`Shown as “${form.emailFromName || form.name} via SASU Invoice”.`}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={80}
                placeholder={form.name}
                value={form.emailFromName}
                onChange={(e) => set({ emailFromName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Replies go to" hint="Leave empty to use your business email.">
            {(p) => (
              <Input
                {...p}
                type="email"
                placeholder={form.email}
                value={form.emailReplyTo}
                onChange={(e) => set({ emailReplyTo: e.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Signature" hint="Used for {{signature}} in emails.">
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  maxLength={1000}
                  placeholder={form.name}
                  value={form.emailSignature}
                  onChange={(e) => set({ emailSignature: e.target.value })}
                />
              )}
            </Field>
          </div>
          <p className="text-xs text-graphite sm:col-span-2">
            Emails are sent from SASU Invoice’s verified address so they reach inboxes and can’t be
            spoofed; your clients reply straight to you.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Invoicing defaults" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Default currency">
            {(p) => (
              <Select
                {...p}
                value={form.currency}
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
          <Field label="Invoice number prefix" hint="Applies when a new invoice series starts.">
            {(p) => (
              <Input
                {...p}
                maxLength={20}
                value={form.prefix}
                onChange={(e) => set({ prefix: e.target.value })}
              />
            )}
          </Field>
          <Field label="Tax label">
            {(p) => (
              <Input
                {...p}
                maxLength={30}
                value={form.taxLabel}
                onChange={(e) => set({ taxLabel: e.target.value })}
              />
            )}
          </Field>
          <Field label="Default tax rate (%)">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={100}
                step="any"
                value={form.taxRate}
                onChange={(e) => set({ taxRate: e.target.value })}
              />
            )}
          </Field>
          <Field label="Tax / VAT number">
            {(p) => (
              <Input
                {...p}
                maxLength={80}
                value={form.taxId}
                onChange={(e) => set({ taxId: e.target.value })}
              />
            )}
          </Field>
          <Field label="Payment terms">
            {(p) => (
              <Input
                {...p}
                maxLength={500}
                value={form.paymentTerms}
                onChange={(e) => set({ paymentTerms: e.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Payment instructions">
              {(p) => (
                <Textarea
                  {...p}
                  rows={4}
                  maxLength={2000}
                  value={form.paymentInstructions}
                  onChange={(e) => set({ paymentInstructions: e.target.value })}
                />
              )}
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function LogoCard({ path }: { path: string | null }) {
  const sb = useSupabase();
  const { user } = useAuth();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const url = useQuery({
    queryKey: ['logo', path],
    queryFn: () => logoUrl(sb, path!),
    enabled: !!path,
    staleTime: 30 * 60_000,
  });
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const dataUrl = await processLogo(file);
      const [head, b64 = ''] = dataUrl.split(',');
      const ext = /image\/(png|jpeg|webp)/.exec(head ?? '')![1] as 'png' | 'jpeg' | 'webp';
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
        type: `image/${ext}`,
      });
      const newPath = await uploadLogo(sb, org.id, blob, ext);
      await updateSettings(sb, org.id, user!.id, { logo_path: newPath });
      await qc.invalidateQueries({ queryKey: ['settings', org.id] });
      toast('Logo updated');
    } catch (err) {
      toast(err instanceof LogoError ? err.message : errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Logo" description="PNG, JPEG or WebP up to 2 MB." />
      <div className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex h-20 w-40 items-center justify-center rounded-lg border border-rule bg-canvas">
          {url.data ? (
            <img
              src={url.data}
              alt={`${org.name} logo`}
              className="max-h-16 max-w-36 object-contain"
            />
          ) : (
            <ImagePlus className="h-6 w-6 text-faint" aria-hidden />
          )}
        </div>
        <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-field px-4 text-sm font-semibold hover:bg-hover">
          {busy ? 'Uploading…' : path ? 'Replace logo' : 'Upload logo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </Card>
  );
}

// --- Team ----------------------------------------------------------------------------

export function TeamPage() {
  const sb = useSupabase();
  const { user } = useAuth();
  const active = useActiveOrg();
  const { refetch, select, memberships } = useOrgs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const manage = canManage(active);
  const orgId = active.org.id;
  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => listMembers(sb, orgId) });
  const invites = useQuery({
    queryKey: ['invitations', orgId],
    queryFn: () => listInvitations(sb, orgId),
    enabled: manage,
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [link, setLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const invite = useMutation({
    mutationFn: () => createInvitation(sb, orgId, email.trim(), role),
    onSuccess: (token) => {
      setLink(`${location.origin}/dashboard/invite#token=${token}`);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['invitations', orgId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(sb, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invitations', orgId] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role: r }: { userId: string; role: OrgRole }) =>
      updateMemberRole(sb, orgId, userId, r),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members', orgId] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => removeMember(sb, orgId, m.user_id),
    onSuccess: async (_d, m) => {
      setRemoving(null);
      if (m.user_id === user!.id) {
        const nextOrg = memberships.find((x) => x.org.id !== orgId);
        setActiveOrg(nextOrg?.org.id ?? null);
        if (nextOrg) select(nextOrg.org.id);
        await refetch();
        navigate('/');
        toast(`You left ${active.org.name}`);
      } else {
        toast('Member removed');
        void qc.invalidateQueries({ queryKey: ['members', orgId] });
      }
    },
    onError: (err) => {
      setRemoving(null);
      toast(errorMessage(err), 'error');
    },
  });

  return (
    <>
      <PageHeader title="Team" description="People who can access this organization." />
      <div className="space-y-6">
        {manage && (
          <Card>
            <CardHeader
              title="Invite someone"
              description="They’ll need to sign in with this email address to join."
            />
            <form
              className="space-y-4 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                setLink(null);
                invite.mutate();
              }}
            >
              {invite.error && <Alert tone="danger">{errorMessage(invite.error)}</Alert>}
              <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
                <Field label="Email">
                  {(p) => (
                    <Input
                      {...p}
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Role">
                  {(p) => (
                    <Select
                      {...p}
                      value={role}
                      onChange={(e) => setRole(e.target.value as OrgRole)}
                    >
                      <option value="member">Member</option>
                      {active.role === 'owner' && <option value="admin">Admin</option>}
                    </Select>
                  )}
                </Field>
                <Button type="submit" loading={invite.isPending}>
                  <UserPlus className="h-4 w-4" aria-hidden /> Create invite
                </Button>
              </div>
              {link && (
                <Alert tone="ok">
                  <p className="font-semibold">
                    Invitation created. Send this link to them; it works once and expires in 7 days.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Input
                      readOnly
                      value={link}
                      aria-label="Invitation link"
                      onFocus={(e) => e.target.select()}
                      className="text-ink"
                    />
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void navigator.clipboard.writeText(link).then(() => toast('Link copied'))
                      }
                      aria-label="Copy invitation link"
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <p className="mt-2 text-xs">
                    Invitation emails will be sent automatically once email sending is set up.
                  </p>
                </Alert>
              )}
            </form>
          </Card>
        )}

        <Card>
          <CardHeader title="Members" />
          {members.isPending ? (
            <Skeleton className="m-5 h-24" />
          ) : members.error ? (
            <div className="p-5">
              <Alert tone="danger">{errorMessage(members.error)}</Alert>
            </div>
          ) : (
            <ul className="divide-y divide-rule">
              {members.data.map((m) => {
                const self = m.user_id === user!.id;
                // The last owner can't leave or be removed (the database refuses it too).
                const lastOwner =
                  m.role === 'owner' && members.data.filter((x) => x.role === 'owner').length === 1;
                const canRemove =
                  !lastOwner &&
                  (self ||
                    active.role === 'owner' ||
                    (active.role === 'admin' && m.role === 'member'));
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-hover text-xs font-bold uppercase">
                      {(m.profile?.full_name || m.profile?.email || '?').slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {m.profile?.full_name || m.profile?.email}
                        {self && <span className="ml-1.5 font-normal text-faint">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-graphite">{m.profile?.email}</p>
                    </div>
                    {active.role === 'owner' && !self ? (
                      <Select
                        aria-label={`Role for ${m.profile?.email}`}
                        className="h-8 w-auto text-[13px]"
                        value={m.role}
                        onChange={(e) =>
                          changeRole.mutate({ userId: m.user_id, role: e.target.value as OrgRole })
                        }
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </Select>
                    ) : (
                      <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'} className="capitalize">
                        {m.role}
                      </Badge>
                    )}
                    {canRemove && (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(m)}>
                        {self ? (
                          'Leave'
                        ) : (
                          <Trash2
                            className="h-3.5 w-3.5"
                            aria-label={`Remove ${m.profile?.email}`}
                          />
                        )}
                      </Button>
                    )}
                    {manage && m.role === 'member' && <MemberPermissionsRow member={m} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {manage && (invites.data?.length ?? 0) > 0 && (
          <Card>
            <CardHeader title="Pending invitations" />
            <ul className="divide-y divide-rule">
              {invites.data!.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{inv.email}</span>
                  <Badge className="capitalize">{inv.role}</Badge>
                  <span className="text-xs text-faint">
                    expires {new Date(inv.expires_at).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={revoke.isPending && revoke.variables === inv.id}
                    onClick={() => revoke.mutate(inv.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!removing}
        title={removing?.user_id === user!.id ? `Leave ${active.org.name}?` : 'Remove this member?'}
        confirmLabel={removing?.user_id === user!.id ? 'Leave' : 'Remove'}
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      >
        {removing?.user_id === user!.id
          ? 'You’ll lose access to this organization’s documents. An owner can invite you again.'
          : `${removing?.profile?.email} will lose access immediately.`}
      </ConfirmDialog>
    </>
  );
}

const PERMISSION_LABELS: [keyof MemberPermissions, string][] = [
  ['record_payments', 'Record payments'],
  ['send_emails', 'Send emails'],
  ['manage_clients', 'Add and edit clients'],
  ['view_reports', 'View reports'],
];

function MemberPermissionsRow({ member }: { member: Member }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (perms: MemberPermissions) =>
      updateMemberPermissions(sb, org.id, member.user_id, perms),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', org.id] }),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const perms = member.permissions;
  return (
    <fieldset className="w-full pl-11 text-xs" disabled={save.isPending}>
      <legend className="sr-only">Permissions for {member.profile?.email}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-graphite">
        {PERMISSION_LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-brand"
              checked={perms[key] !== false}
              onChange={(e) => save.mutate({ ...perms, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// --- Account -------------------------------------------------------------------------

function ProfileForm({ initialName }: { initialName: string }) {
  const { sb, user } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const saveName = useMutation({
    mutationFn: () => updateProfile(sb, user!.id, name.trim().slice(0, 120)),
    onSuccess: () => toast('Profile saved'),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        saveName.mutate();
      }}
    >
      <div className="min-w-60 flex-1">
        <Field label="Your name">
          {(p) => (
            <Input {...p} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
      </div>
      <Button type="submit" variant="secondary" loading={saveName.isPending}>
        Save
      </Button>
    </form>
  );
}

export function AccountPage() {
  const { sb, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const profile = useQuery({
    queryKey: ['profile', user!.id],
    queryFn: () => getProfile(sb, user!.id),
  });
  const deletion = useQuery({
    queryKey: ['deletion', user!.id],
    queryFn: () => getPendingDeletion(sb),
  });
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const changePassword = useMutation({
    mutationFn: async () => {
      const problem = passwordProblem(password, user!.email ?? '');
      if (problem) throw new Error(problem);
      const { error } = await sb.auth.updateUser({ password });
      if (error)
        throw new Error(
          error.code === 'same_password' ? 'Choose a different password.' : error.message,
        );
      // Other devices signed in with the old password are signed out.
      await sb.auth.signOut({ scope: 'others' });
    },
    onSuccess: () => {
      setPassword('');
      toast('Password changed');
    },
    onError: (err) => toast(err instanceof Error ? err.message : errorMessage(err), 'error'),
  });
  const requestDelete = useMutation({
    mutationFn: () => requestAccountDeletion(sb, reason.trim().slice(0, 1000)),
    onSuccess: () => {
      setConfirmDelete(false);
      void qc.invalidateQueries({ queryKey: ['deletion', user!.id] });
      toast('Deletion request received');
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast(errorMessage(err), 'error');
    },
  });

  return (
    <>
      <PageHeader title="Account" description={user?.email} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" />
          {profile.data ? (
            <ProfileForm initialName={profile.data.full_name} />
          ) : (
            <Skeleton className="m-5 h-10" />
          )}
        </Card>

        <Card>
          <CardHeader title="Password" />
          <form
            className="flex flex-wrap items-end gap-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              changePassword.mutate();
            }}
          >
            <div className="min-w-60 flex-1">
              <Field label="New password">
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button type="submit" variant="secondary" loading={changePassword.isPending}>
              Change password
            </Button>
            <div className="basis-full pt-2">
              <PasswordChecklist password={password} email={user!.email ?? ''} />
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Sign out"
            description="Sign out of this browser. Documents saved in this browser stay here."
          />
          <div className="p-5">
            <Button
              variant="secondary"
              onClick={async () => {
                await sb.auth.signOut();
                setEditorSyncOrg(null);
                qc.clear();
                navigate('/login');
              }}
            >
              Sign out
            </Button>
          </div>
        </Card>

        <Card className="border-danger/30">
          <CardHeader
            title="Delete account"
            description="Ask us to delete your account and the personal data linked to it."
          />
          <div className="space-y-3 p-5 text-sm">
            {deletion.data ? (
              <Alert tone="warn">
                Your deletion request from {new Date(deletion.data.created_at).toLocaleDateString()}{' '}
                is being processed. Organizations you own must be transferred or closed first; we’ll
                contact you if anything needs your decision.
              </Alert>
            ) : (
              <>
                <p className="text-graphite">
                  Invoices are business records that may need to be kept for several years by law,
                  so organization data isn’t deleted instantly. We review each request and confirm
                  by email.
                </p>
                <Field label="Reason (optional)">
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={2}
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  )}
                </Field>
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Request account deletion
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Request account deletion?"
        confirmLabel="Send request"
        tone="danger"
        loading={requestDelete.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => requestDelete.mutate()}
      >
        We’ll review your request and email you before anything is deleted.
      </ConfirmDialog>
    </>
  );
}
