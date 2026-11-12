/**
 * Browser-side calls for structured filters and saved views (LABEL-37). Each
 * returns a result the caller can show; none throws on an HTTP error, so a
 * failed save is a message, not a crashed bar.
 */
import { encodeDefinition, type Definition, type NameLookup } from './filters';
import type { ReleaseRun, SongRun } from './filters-store';
import type { ViewDto } from './saved-views';
import type { NamesJson } from './saved-views-route';

export type { NamesJson, ViewDto };
export type RunResult = SongRun | ReleaseRun;

export type RunResponse = {
  result: RunResult;
  /** The definition as THIS viewer may see it (ids they may not see dropped). */
  definition: Definition;
  narrowed: boolean;
  names: NamesJson;
  view: { id: string; name: string; shared: boolean } | null;
};

export type Outcome<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init });
    const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : 'Something went wrong' };
    return { ok: true, data: body as unknown as T };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const toLookup = (n: NamesJson | undefined): NameLookup => ({
  artists: new Map(Object.entries(n?.artists ?? {})),
  parties: new Map(Object.entries(n?.parties ?? {})),
  projects: new Map(Object.entries(n?.projects ?? {})),
});

export function runFilter(orgId: string, source: { view: string } | { definition: Definition }, paging: { offset?: number; limit?: number } = {}): Promise<Outcome<RunResponse>> {
  const q = new URLSearchParams();
  if ('view' in source) q.set('view', source.view);
  else q.set('f', encodeDefinition(source.definition));
  if (paging.offset) q.set('offset', String(paging.offset));
  if (paging.limit) q.set('limit', String(paging.limit));
  return call<RunResponse>(`/api/org/${orgId}/views/run?${q}`);
}

export type ViewList = { schemaReady: boolean; views: ViewDto[]; names: NamesJson; canShare: boolean };

export const listViews = (orgId: string, subject: Definition['subject']) => call<ViewList>(`/api/org/${orgId}/views?subject=${subject}`);

export const createView = (orgId: string, body: { subject: Definition['subject']; name: string; definition: Definition; shared: boolean }) =>
  call<{ view: ViewDto | null; names: NamesJson }>(`/api/org/${orgId}/views`, json('POST', body));

export const patchView = (orgId: string, id: string, body: { name?: string; definition?: Definition; shared?: boolean }) =>
  call<{ view: ViewDto | null; names: NamesJson }>(`/api/org/${orgId}/views/${id}`, json('PATCH', body));

export const deleteView = (orgId: string, id: string) => call<{ ok: true }>(`/api/org/${orgId}/views/${id}`, { method: 'DELETE' });
