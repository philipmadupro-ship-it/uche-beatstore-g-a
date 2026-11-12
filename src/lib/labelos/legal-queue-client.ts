/**
 * Browser call to the legal queue (LABEL-31). A tagged result instead of a
 * throw, so the screen shows the server's own words. The shape is the route's
 * `LegalQueue` (lib/labelos/legal-queue-store), restated through a type import
 * so a client component pulls in no server code.
 */
import type { LegalQueue } from './legal-queue-store';

export type LegalQueueResult = ({ ok: true } & LegalQueue) | { ok: false; status: number; error: string };

export async function fetchLegalQueue(orgId: string): Promise<LegalQueueResult> {
  try {
    const res = await fetch(`/api/org/${orgId}/legal/queue`, { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as Partial<LegalQueue> & { error?: unknown };
    if (!res.ok) return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}` };
    return { ok: true, schemaReady: json.schemaReady !== false, items: json.items ?? [], restricted: json.restricted ?? 0, truncated: json.truncated === true };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

/** The legal pack of a release, as a link a browser follows (the server audits and streams it). */
export const legalPackHref = (orgId: string, releaseId: string, format: 'zip' | 'csv' = 'zip'): string =>
  `/api/org/${orgId}/releases/${releaseId}/legal-pack${format === 'csv' ? '?format=csv' : ''}`;
