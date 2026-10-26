/**
 * Browser calls to the credit and party routes (LABEL-27). Each answers a
 * tagged result instead of throwing, so a screen shows the server's own words
 * ("You can only propose a credit that names you") rather than a generic
 * failure.
 */
import type { CreditScope } from './credit-roles';
import type { CreditView, PartyView } from './credits';

export type CreditsPayload = {
  schemaReady: boolean;
  credits: CreditView[];
  me: { reach: 'all' | 'own' | 'none'; canPropose: boolean; canWrite: boolean; ownPartyId: string | null };
  roles: { key: string; label: string; scope: CreditScope; detail: string | null }[];
};

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' && body.error ? body.error : `HTTP ${res.status}`;
}

async function send<T extends object>(url: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res) };
    return { ok: true, ...((await res.json()) as T) };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

const base = (orgId: string, trackId: string) => `/api/org/${orgId}/tracks/${trackId}/credits`;

export const fetchCredits = (orgId: string, trackId: string) => send<CreditsPayload>(base(orgId, trackId), 'GET');

export type ProposeInput = { role: string; role_detail?: string | null; party_id?: string; name?: string };
export const proposeCredit = (orgId: string, trackId: string, body: ProposeInput) => send<{ credit: CreditView }>(base(orgId, trackId), 'POST', body);

export const decideCredit = (orgId: string, trackId: string, creditId: string, action: 'confirm' | 'dispute', note?: string) =>
  send<{ credit: CreditView }>(`${base(orgId, trackId)}/${creditId}`, 'PATCH', { action, ...(note ? { note } : {}) });

export const fetchParties = (orgId: string) => send<{ parties: PartyView[] }>(`/api/org/${orgId}/parties`, 'GET');
