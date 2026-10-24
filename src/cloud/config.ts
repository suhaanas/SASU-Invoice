/**
 * Cloud configuration from build-time env. Both values are public by design
 * (the anon key only grants what RLS allows). When they're missing the app
 * still works fully offline; cloud features just aren't offered.
 */
import { z } from 'zod';

const isAllowedUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'https:' || (local && url.protocol === 'http:');
  } catch {
    return false;
  }
};

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().refine(isAllowedUrl, 'must be an https:// URL'),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export function parseCloudConfig(env: Record<string, unknown>): CloudConfig | null {
  const r = envSchema.safeParse(env);
  if (!r.success) return null;
  return {
    url: r.data.VITE_SUPABASE_URL.replace(/\/+$/, ''),
    anonKey: r.data.VITE_SUPABASE_ANON_KEY,
  };
}

export const cloudConfig: CloudConfig | null = parseCloudConfig(
  import.meta.env as Record<string, unknown>,
);
