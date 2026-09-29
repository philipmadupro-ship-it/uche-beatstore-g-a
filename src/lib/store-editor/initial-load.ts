/**
 * The Store Editor's first load, one source at a time.
 *
 * The page used to fetch six endpoints with `Promise.all` and then parse all
 * six bodies with a second `Promise.all`. One body that was not JSON (an HTML
 * error page, an empty 500) rejected the lot: the profile never reached the
 * form, the form kept its empty defaults, and the next "Save changes" PATCHed
 * those defaults over the saved profile — bio, socials and prices wiped by a
 * failure in the promo-code list.
 *
 * Each source now settles on its own, and `saveScope` says which writes are
 * safe: a save may only write what it actually loaded.
 */

export const STORE_EDITOR_SOURCES = {
  profile: '/api/profile',
  playlists: '/api/playlists',
  summary: '/api/tracks/store-summary',
  projects: '/api/projects',
  promoCodes: '/api/promo-codes',
  licenses: '/api/licenses',
} as const;

export type StoreEditorSource = keyof typeof STORE_EDITOR_SOURCES;

export type SourceResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number | null; error: string };

export type StoreEditorLoad = Record<StoreEditorSource, SourceResult>;

/**
 * Fetch and parse one endpoint without ever throwing. A non-2xx response, a
 * body that is not a JSON object, and a network failure are all `ok: false`.
 * A failed response's `{ error }` is kept for the message, never as data.
 */
export async function loadSource(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceResult> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : 'Network error' };
  }
  let body: unknown = null;
  let parsed = true;
  try {
    body = await res.json();
  } catch {
    parsed = false;
  }
  const isObject = parsed && body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!res.ok) {
    const detail = isObject && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: detail };
  }
  if (!isObject) {
    return { ok: false, status: res.status, error: 'Response was not JSON' };
  }
  return { ok: true, data: body as Record<string, unknown> };
}

export async function loadStoreEditor(fetchImpl: typeof fetch = fetch): Promise<StoreEditorLoad> {
  const keys = Object.keys(STORE_EDITOR_SOURCES) as StoreEditorSource[];
  const results = await Promise.all(keys.map((key) => loadSource(STORE_EDITOR_SOURCES[key], fetchImpl)));
  return Object.fromEntries(keys.map((key, i) => [key, results[i]])) as StoreEditorLoad;
}

/**
 * A 2xx JSON `/api/profile` means the saved profile was read — including a new
 * producer's absent one, whose form legitimately starts empty.
 */
export function profileLoaded(load: Pick<StoreEditorLoad, 'profile'>): boolean {
  return load.profile.ok;
}

export type SaveScope = {
  /** PATCH /api/profile with the form. Off unless the form was filled from the saved profile. */
  profile: boolean;
  /** Featured-playlist flags. Off unless the playlist list loaded, or un-featuring is computed from nothing. */
  playlists: boolean;
  /** Featured-project flags, same reason. */
  projects: boolean;
};

export function saveScope(load: StoreEditorLoad): SaveScope {
  return {
    profile: profileLoaded(load),
    playlists: load.playlists.ok && Array.isArray(load.playlists.data.playlists),
    projects: load.projects.ok && Array.isArray(load.projects.data.projects),
  };
}

const SOURCE_LABELS: Record<StoreEditorSource, string> = {
  profile: 'profile',
  playlists: 'playlists',
  summary: 'store summary',
  projects: 'projects',
  promoCodes: 'promo codes',
  licenses: 'license tiers',
};

/** Human list of what failed, for one toast rather than six. */
export function failedSourceLabels(load: StoreEditorLoad): string[] {
  return (Object.keys(load) as StoreEditorSource[])
    .filter((key) => !load[key].ok)
    .map((key) => SOURCE_LABELS[key]);
}
