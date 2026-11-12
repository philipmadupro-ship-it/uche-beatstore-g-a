/**
 * Browser calls to the samples route (LABEL-29). Tagged results, never a throw,
 * so the screen can show the server's own words.
 */
import type { SamplesDeclared } from './legal-readiness';

export type SamplesPayload = {
  value: SamplesDeclared;
  label: string;
  cleared: boolean;
  hasFile: boolean;
  /** Only for `rights.read` and `catalog.write`. */
  note?: string | null;
  canWrite: boolean;
};

export type SamplesResult = { ok: true; schemaReady: boolean; samples: SamplesPayload | null } | { ok: false; status: number; error: string };

async function call(method: 'GET' | 'PUT', orgId: string, trackId: string, body?: unknown): Promise<SamplesResult> {
  try {
    const res = await fetch(`/api/org/${orgId}/tracks/${trackId}/samples`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: unknown; schemaReady?: boolean; samples?: SamplesPayload };
    if (!res.ok) return { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}` };
    return { ok: true, schemaReady: json.schemaReady !== false, samples: json.samples ?? null };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

export const fetchSamples = (orgId: string, trackId: string) => call('GET', orgId, trackId);
export const saveSamples = (orgId: string, trackId: string, body: { samples: SamplesDeclared; note?: string | null }) => call('PUT', orgId, trackId, body);
