import {
  BarChart3,
  BellRing,
  Building2,
  Contact,
  CreditCard,
  Search,
  ChevronsUpDown,
  FileText,
  HardDriveUpload,
  LayoutDashboard,
  LogOut,
  Menu,
  PenLine,
  Repeat,
  Shield,
  Plus,
  Settings,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { canManage, useActiveOrg, useOrgs } from '../lib/org';
import { useQueryClient } from '@tanstack/react-query';
import { useIsPlatformAdmin } from '../lib/admin';
import { cn } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/clients', label: 'Clients', icon: Contact },
  { to: '/reminders', label: 'RecoverFlow AI', icon: BellRing },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/browser', label: 'This browser', icon: HardDriveUpload },
  { to: '/settings/organization', label: 'Business settings', icon: Building2, manage: true },
  { to: '/settings/team', label: 'Team', icon: Users },
  { to: '/settings/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings/account', label: 'Account', icon: User },
] as const;

export function Logo() {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 font-display text-[15px] font-bold"
      aria-label="SASU Invoice dashboard"
    >
      <svg width="24" height="24" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect width="22" height="22" rx="6" fill="#16181D" />
        <path d="M6 7h10M6 11h7M6 15h5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <circle cx="17" cy="15" r="3" fill="#5B5EF4" />
      </svg>
      SASU Invoice
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const org = useActiveOrg();
  const admin = useIsPlatformAdmin();
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <a
        href="/app.html"
        className="mb-3 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-white hover:bg-brand-ink"
      >
        <PenLine className="h-4 w-4" aria-hidden /> Open editor
      </a>
      {NAV.filter((n) => !('manage' in n) || canManage(org)).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={'end' in item}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-graphite hover:bg-hover hover:text-ink',
              isActive && 'bg-brand-wash text-brand-ink hover:bg-brand-wash hover:text-brand-ink',
            )
          }
        >
          <item.icon className="h-4 w-4" aria-hidden />
          {item.label}
        </NavLink>
      ))}
      {admin.data && (
        <NavLink
          to="/admin"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'mt-2 flex h-9 items-center gap-2.5 rounded-lg border-t border-rule px-3 pt-2 text-sm font-medium text-graphite hover:bg-hover hover:text-ink',
              isActive && 'bg-brand-wash text-brand-ink',
            )
          }
        >
          <Shield className="h-4 w-4" aria-hidden />
          Platform admin
        </NavLink>
      )}
    </nav>
  );
}

/** Small disclosure menu that closes on outside click and Escape. */
function Menu_({
  label,
  button,
  children,
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium hover:bg-hover"
      >
        {button}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-rule bg-paper p-1 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const menuItem =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover';

function OrgSwitcher() {
  const { memberships, select } = useOrgs();
  const active = useActiveOrg();
  const navigate = useNavigate();
  return (
    <Menu_
      label="Switch organization"
      button={
        <>
          <Building2 className="h-4 w-4 text-graphite" aria-hidden />
          <span className="max-w-40 truncate">{active.org.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-faint" aria-hidden />
        </>
      }
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Organizations
          </p>
          {memberships.map((m) => (
            <button
              key={m.org.id}
              type="button"
              className={cn(menuItem, m.org.id === active.org.id && 'font-semibold text-brand-ink')}
              onClick={() => {
                select(m.org.id);
                close();
                navigate('/');
              }}
            >
              <span className="truncate">{m.org.name}</span>
              <span className="ml-auto text-xs capitalize text-faint">{m.role}</span>
            </button>
          ))}
          <div className="my-1 border-t border-rule" />
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close();
              navigate('/onboarding?new=1');
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> New organization
          </button>
        </>
      )}
    </Menu_>
  );
}

function AccountMenu() {
  const { sb, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <Menu_
      label="Account menu"
      button={
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-bold uppercase text-white">
          {(user?.email ?? '?').slice(0, 1)}
        </span>
      }
    >
      {(close) => (
        <>
          <p className="truncate px-3 py-2 text-sm text-graphite">{user?.email}</p>
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              close();
              navigate('/settings/account');
            }}
          >
            <Settings className="h-4 w-4" aria-hidden /> Account settings
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={async () => {
              close();
              await sb.auth.signOut();
              qc.clear();
              navigate('/login');
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </>
      )}
    </Menu_>
  );
}

function HeaderSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="ml-auto flex min-w-0 flex-1 justify-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <label className="relative w-full max-w-72">
        <span className="sr-only">Search invoices and clients</span>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="h-9 w-full rounded-lg border border-field bg-canvas pl-8 pr-3 text-sm placeholder:text-faint focus:border-brand focus:bg-paper focus:outline-none"
        />
      </label>
    </form>
  );
}

export function AppShell() {
  // Drawer links close it themselves (Sidebar onNavigate).
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr] print:block">
      <aside className="hidden border-r border-rule bg-paper lg:block print:hidden">
        <div className="flex h-14 items-center border-b border-rule px-5">
          <Logo />
        </div>
        <Sidebar />
      </aside>

      {drawer && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-paper shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-rule px-4">
              <Logo />
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-hover"
                onClick={() => setDrawer(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center gap-2 border-b border-rule bg-paper/90 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-hover lg:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <OrgSwitcher />
          <HeaderSearch />
          <AccountMenu />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
