/**
 * Cloudflare Turnstile bot check for sign-up, sign-in and password reset.
 * Supabase Auth verifies the token server-side (supabase/config.toml
 * [auth.captcha]). Renders nothing until VITE_TURNSTILE_SITE_KEY is set, so
 * local development and tests work without it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'flexible';
    },
  ): string;
  remove(id: string): void;
}

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Whether a bot check must be passed before submitting auth forms. */
export const captchaEnabled = /^[0-9A-Za-z_-]{10,}$/.test(SITE_KEY);

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error('Turnstile unavailable'));
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile unavailable'));
    };
    document.head.append(s);
  });
  return loading;
}

/**
 * The widget. Tokens are single-use: remount it (change `key`) after each
 * submit so a fresh token is issued.
 */
export function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!captchaEnabled || !box.current) return;
    let id: string | null = null;
    let api: TurnstileApi | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !box.current) return;
        api = t;
        id = t.render(box.current, {
          sitekey: SITE_KEY,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
          theme: 'light',
          size: 'flexible',
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (api && id) api.remove(id);
    };
    // onToken is a state setter from the parent; render once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!captchaEnabled) return null;
  return <div ref={box} className="min-h-[65px]" aria-label="Security check" />;
}

export const CAPTCHA_REQUIRED = 'Please complete the security check above.';

/**
 * Bot check state for one auth form: render `widget`, call `blocked()` before
 * submitting, pass `token` as `options.captchaToken`, then `reset()`.
 */
export function useCaptcha(): {
  widget: ReactNode;
  token: string | undefined;
  blocked: () => string | null;
  reset: () => void;
} {
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  return {
    widget: <Captcha key={round} onToken={setToken} />,
    token: token ?? undefined,
    blocked: () => (captchaEnabled && !token ? CAPTCHA_REQUIRED : null),
    reset: () => {
      setToken(null);
      setRound((r) => r + 1);
    },
  };
}
