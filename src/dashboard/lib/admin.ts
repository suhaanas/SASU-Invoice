import { useQuery } from '@tanstack/react-query';
import { isPlatformAdmin } from './api';
import { useSupabase } from './auth';

/** Whether the signed-in user is a platform admin (decided by the database). */
export function useIsPlatformAdmin() {
  const sb = useSupabase();
  return useQuery({
    queryKey: ['platform-admin'],
    queryFn: () => isPlatformAdmin(sb),
    staleTime: 5 * 60_000,
  });
}
