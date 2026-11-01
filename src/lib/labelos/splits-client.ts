/**
 * Browser calls to the split sheet routes (LABEL-28). Each answers a tagged
 * result instead of throwing, so a screen shows the server's own words ("The
 * shares add up to 99.9999%; 0.0001% is still unassigned.").
 */
import type { DriftEntry } from './contract-splits-client';
import type { SplitKind, SplitSheetView } from './splits';

export type SplitsPayload = {
  schemaReady: boolean;
  sheets: SplitSheetView[];
  /** Contracts that name this song the caller may read, with the drift of the sheets against each (LABEL-59). */
  contracts?: { contractId: string; title: string; status: string; type: string; drift: DriftEntry[] }[];
  me: { reach: 'all' | 'own' | 'none'; canWrite: boolean };
  kinds: { key: SplitKind; label: string; roles: { key: string; label: string }[] }[];
};

export type SplitResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; issues?: { message: string }[] };

async function readError(res: Response): Promise<{ error: string; issues?: { message: string }[] }> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; issues?: { message: string }[] };
  return { error: typeof body.error === 'string' && body.error ? body.error : `HTTP ${res.status}`, issues: body.issues };
}

async function send<T extends object>(url: string, method: string, body?: unknown): Promise<SplitResult<T>> {
  try {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(url, {
      method,
      headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status, ...(await readError(res)) };
    return { ok: true, ...((await res.json()) as T) };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

const base = (orgId: string, trackId: string) => `/api/org/${orgId}/tracks/${trackId}/splits`;
type Line = { party_id: string; role: string; share: string };

export const fetchSplits = (orgId: string, trackId: string) => send<SplitsPayload>(base(orgId, trackId), 'GET');

export const startSplitSheet = (orgId: string, trackId: string, body: { kind: SplitKind; lines?: Line[]; note?: string | null }) =>
  send<{ sheet: SplitSheetView }>(base(orgId, trackId), 'POST', body);

export const saveSplitDraft = (orgId: string, trackId: string, sheetId: string, body: { lines?: Line[]; note?: string | null }) =>
  send<{ sheet: SplitSheetView }>(`${base(orgId, trackId)}/${sheetId}`, 'PATCH', body);

export const discardSplitDraft = (orgId: string, trackId: string, sheetId: string) =>
  send<{ deleted: boolean }>(`${base(orgId, trackId)}/${sheetId}`, 'DELETE');

export const circulateSplitSheet = (orgId: string, trackId: string, sheetId: string) =>
  send<{ sheet: SplitSheetView; supersededId: string | null }>(`${base(orgId, trackId)}/${sheetId}/circulate`, 'POST', {});

export const supersedeSplitSheet = (orgId: string, trackId: string, sheetId: string) =>
  send<{ sheet: SplitSheetView }>(`${base(orgId, trackId)}/${sheetId}/supersede`, 'POST', {});

export const acknowledgeSplitLine = (orgId: string, trackId: string, sheetId: string, lineId: string) =>
  send<{ sheet: SplitSheetView | null; complete: boolean }>(`${base(orgId, trackId)}/${sheetId}/signatures`, 'POST', { method: 'acknowledged', line_id: lineId });

export function uploadSignedSplitPdf(orgId: string, trackId: string, sheetId: string, file: File, lineId?: string) {
  const form = new FormData();
  form.set('file', file);
  if (lineId) form.set('line_id', lineId);
  return send<{ sheet: SplitSheetView | null; complete: boolean }>(`${base(orgId, trackId)}/${sheetId}/signatures`, 'POST', form);
}
