import { useQuery } from '@tanstack/react-query';
import { listFlags } from './api';
import { useSupabase } from './auth';

/**
 * Platform feature switches (admin console → Switches). A flag that is missing
 * or can't be read counts as off, so unfinished features stay hidden.
 */
export function useFeatureFlag(key: string): { enabled: boolean; loading: boolean } {
  const sb = useSupabase();
  const flags = useQuery({
    queryKey: ['flags'],
    queryFn: () => listFlags(sb),
    staleTime: 5 * 60_000,
  });
  return {
    enabled: flags.data?.find((f) => f.key === key)?.enabled === true,
    loading: flags.isPending,
  };
}

/** The AI assistant is "coming soon" until the ai_assistant switch is turned on. */
export const useAiEnabled = () => useFeatureFlag('ai_assistant');
