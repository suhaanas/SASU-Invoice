import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabase } from '../../cloud/client';
import { cloudConfig } from '../../cloud/config';

/**
 * Social sign-in providers switched on in Supabase Auth (public settings
 * endpoint). A provider shows up in the UI as soon as it's configured; if the
 * check fails, only email sign-in is offered.
 */
export function useAuthProviders(): { google: boolean } {
  const settings = useQuery({
    queryKey: ['auth-settings'],
    queryFn: async () => {
      const res = await fetch(`${cloudConfig!.url}/auth/v1/settings`, {
        headers: { apikey: cloudConfig!.anonKey },
      });
      if (!res.ok) throw new Error(`auth settings ${res.status}`);
      return (await res.json()) as { external?: Record<string, boolean> };
    },
    enabled: !!cloudConfig,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return { google: settings.data?.external?.google === true };
}

interface AuthState {
  sb: SupabaseClient;
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** True after the user followed a password-recovery email link. */
  recovering: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function useSupabase(): SupabaseClient {
  return useAuth().sb;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const sb = getSupabase()!;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let active = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = sb.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [sb]);

  return (
    <AuthContext.Provider value={{ sb, session, user: session?.user ?? null, loading, recovering }}>
      {children}
    </AuthContext.Provider>
  );
}
