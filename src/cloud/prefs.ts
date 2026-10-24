/**
 * Small per-browser cloud preferences in localStorage. None of these are
 * trusted: the active organization is re-checked against the user's
 * memberships, and every server call is authorized server-side.
 */

const KEYS = {
  activeOrg: 'sasu:v3:activeOrg',
  /** Organization this browser's editor saves to; absent = local only. */
  editorSync: 'sasu:v3:cloudSync',
  importedPrefix: 'sasu:v3:cloudImport:',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

const uuidOrNull = (v: string | null): string | null => (v && UUID.test(v) ? v : null);

export const getActiveOrg = (): string | null => uuidOrNull(get(KEYS.activeOrg));
export const setActiveOrg = (orgId: string | null): void => set(KEYS.activeOrg, orgId);

export const getEditorSyncOrg = (): string | null => uuidOrNull(get(KEYS.editorSync));
export const setEditorSyncOrg = (orgId: string | null): void => set(KEYS.editorSync, orgId);

export interface ImportMarker {
  at: number;
  imported: number;
}

export function getImportMarker(orgId: string): ImportMarker | null {
  try {
    const v = JSON.parse(get(KEYS.importedPrefix + orgId) ?? 'null') as unknown;
    if (v && typeof v === 'object' && 'at' in v && 'imported' in v) return v as ImportMarker;
  } catch {
    /* ignore malformed marker */
  }
  return null;
}

export const setImportMarker = (orgId: string, marker: ImportMarker): void =>
  set(KEYS.importedPrefix + orgId, JSON.stringify(marker));

/** Whether supabase-js has a stored session, without loading supabase-js. */
export function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (/^sb-.+-auth-token$/.test(localStorage.key(i) ?? '')) return true;
    }
  } catch {
    /* storage unavailable */
  }
  return false;
}
