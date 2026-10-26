/**
 * Live dashboard updates. The database announces changes on a private
 * Realtime Broadcast topic per organization ("org:<id>", see the
 * 20261101000001_realtime migration). Messages only say *what* changed
 * ({table, op, id}); we refetch through the normal RLS-protected API, so a
 * broadcast can never reveal data the user couldn't already read.
 */
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { useSupabase } from './auth';

export type LiveStatus = 'connecting' | 'live' | 'off';

export const RealtimeContext = createContext<LiveStatus>('off');

/** Whether the dashboard is receiving live updates right now. */
export const useLiveStatus = (): LiveStatus => useContext(RealtimeContext);

export interface OrgChange {
  table?: string;
  op?: string;
  id?: string | null;
}

/** Refetch everything on screen that belongs to the organization. */
export function invalidateForChange(qc: QueryClient, orgId: string, change: OrgChange): void {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(orgId) });
  // Roles and memberships are keyed by user, not organization.
  if (change.table === 'organization_members')
    void qc.invalidateQueries({ queryKey: ['memberships'] });
}

/** Coalesce bursts (a payment updates the payment, the invoice and the client). */
export function debounce<T>(fn: (arg: T) => void, ms: number): (arg: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (arg: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(arg), ms);
  };
}

/** Subscribe to the organization's topic while the dashboard is open. */
export function useOrgRealtime(orgId: string): LiveStatus {
  const sb = useSupabase();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    let cancelled = false;
    let connectedBefore = false;
    const onChange = debounce<OrgChange>((change) => invalidateForChange(qc, orgId, change), 300);
    const channel = sb.channel(`org:${orgId}`, { config: { private: true } });
    channel.on('broadcast', { event: 'change' }, (msg) =>
      onChange((msg.payload ?? {}) as OrgChange),
    );
    void sb.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((state) => {
        if (cancelled) return;
        setStatus(state === 'SUBSCRIBED' ? 'live' : state === 'CLOSED' ? 'off' : 'connecting');
        // After a reconnect, catch up on anything missed while offline.
        if (state === 'SUBSCRIBED') {
          if (connectedBefore) invalidateForChange(qc, orgId, {});
          connectedBefore = true;
        }
      });
    });
    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [sb, qc, orgId]);

  return status;
}
