/**
 * The organization the dashboard is working in. The remembered choice is only
 * a preference: it is used only if it is still among the user's memberships.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getActiveOrg, setActiveOrg } from '../../cloud/prefs';
import { listMemberships, type Membership } from './api';
import { useAuth } from './auth';

interface OrgState {
  memberships: Membership[];
  active: Membership | null;
  loading: boolean;
  error: unknown;
  select(orgId: string): void;
  refetch(): Promise<unknown>;
}

const OrgContext = createContext<OrgState | null>(null);

export function useOrgs(): OrgState {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrgs outside OrgProvider');
  return ctx;
}

/** The active organization; only use under a route that guarantees one. */
export function useActiveOrg(): Membership {
  const { active } = useOrgs();
  if (!active) throw new Error('No active organization');
  return active;
}

export const canManage = (m: Membership): boolean => m.role === 'owner' || m.role === 'admin';

export function OrgProvider({ children }: { children: ReactNode }) {
  const { sb, user } = useAuth();
  const [preferred, setPreferred] = useState<string | null>(() => getActiveOrg());
  const query = useQuery({
    queryKey: ['memberships', user?.id],
    queryFn: () => listMemberships(sb, user!.id),
    enabled: !!user,
  });

  const memberships = useMemo(() => query.data ?? [], [query.data]);
  const active = memberships.find((m) => m.org.id === preferred) ?? memberships[0] ?? null;

  const select = useCallback((orgId: string) => {
    setActiveOrg(orgId);
    setPreferred(orgId);
  }, []);

  return (
    <OrgContext.Provider
      value={{
        memberships,
        active,
        loading: query.isPending && !!user,
        error: query.error,
        select,
        refetch: query.refetch,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}
