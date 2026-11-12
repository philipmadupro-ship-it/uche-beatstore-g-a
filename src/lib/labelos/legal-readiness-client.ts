/**
 * Browser call to the legal-readiness route (LABEL-29). Answers a tagged
 * result instead of throwing, as the credit and split clients do.
 */
import type { ReadinessView } from './legal-readiness';

export type LegalReadinessPayload = { ok: true; schemaReady: boolean; readiness: ReadinessView | null } | { ok: false; status: number; error: string };

export async function fetchLegalReadiness(orgId: string, trackId: string): Promise<LegalReadinessPayload> {
  try {
    const res = await fetch(`/api/org/${orgId}/tracks/${trackId}/legal-readiness`);
    const body = (await res.json().catch(() => ({}))) as { error?: unknown; schemaReady?: boolean; readiness?: ReadinessView };
    if (!res.ok) return { ok: false, status: res.status, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
    return { ok: true, schemaReady: body.schemaReady !== false, readiness: body.readiness ?? null };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}
