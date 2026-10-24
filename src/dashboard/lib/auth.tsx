import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabase } from '../../cloud/client';

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
