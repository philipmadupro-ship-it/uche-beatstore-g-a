/**
 * Browser calls to the signing routes (LABEL-60). Each answers a tagged result
 * so a screen shows the server's own words (and its `code`, e.g. a split-sheet
 * refusal, so the page can say what to do next).
 */
import type { SigningView } from './contract-signing-view';

export type SignResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; code?: string };

async function call<T extends object>(url: string, method: string, body?: unknown): Promise<SignResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: unknown; code?: unknown };
    if (!res.ok) {
      return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}`, ...(typeof json.code === 'string' ? { code: json.code } : {}) };
    }
    return { ok: true, ...json };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

const base = (orgId: string, contractId: string) => `/api/org/${orgId}/contracts/${contractId}`;

export type SigningPayload = SigningView | { schemaReady: false };
export const loadSigning = (orgId: string, contractId: string) => call<SigningPayload>(`${base(orgId, contractId)}/signing`, 'GET');

export const signAsMember = (orgId: string, contractId: string, body: { party_id: string; version: number; document_sha256: string; name: string; drawing?: string }) =>
  call<{ completed: boolean; status: 'sent' | 'signed' }>(`${base(orgId, contractId)}/signing`, 'POST', body);

export const issueSignerLink = (orgId: string, contractId: string, partyId: string) =>
  call<{ token: string; path: string; expiresAt: string }>(`${base(orgId, contractId)}/signing/links`, 'POST', { party_id: partyId });
export const revokeSignerLink = (orgId: string, contractId: string, partyId: string) =>
  call<Record<string, never>>(`${base(orgId, contractId)}/signing/links`, 'DELETE', { party_id: partyId });

export const saveProviderUrl = (orgId: string, contractId: string, url: string | null) =>
  call<{ url: string | null }>(`${base(orgId, contractId)}/signing/provider`, 'PUT', { url });

export const supersedeContract = (orgId: string, contractId: string, reason?: string) =>
  call<{ new_id: string | null }>(`${base(orgId, contractId)}/supersede`, 'POST', reason ? { reason } : {});

export const signatureImageUrl = (orgId: string, contractId: string, signatureId: string) => `${base(orgId, contractId)}/signing/signatures/${signatureId}/image`;

// The external signer's page (no account).
export type PublicSigningPayload = {
  contract: { title: string; typeLabel: string; version: number; status: string };
  you: { role: string; roleLabel: string; name: string };
  parties: { roleLabel: string; name: string }[];
  clauses: { id: string; heading: string; body: string }[];
  documentSha256: string;
  state: 'pending' | 'signed' | 'stale';
  receipt: { signedAt: string; signerName: string | null; documentSha256: string } | null;
  canSign: boolean;
  completed: boolean;
  expiresAt: string | null;
  providerUrl: string | null;
  statement: string;
};
export const loadPublicSigning = (token: string) => call<PublicSigningPayload>(`/api/sign/${encodeURIComponent(token)}`, 'GET');
export const signWithLink = (token: string, body: { version: number; document_sha256: string; name: string; drawing?: string }) =>
  call<{ completed: boolean }>(`/api/sign/${encodeURIComponent(token)}`, 'POST', body);
