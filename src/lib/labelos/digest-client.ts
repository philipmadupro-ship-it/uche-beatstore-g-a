/**
 * Browser calls to the weekly-digest routes (LABEL-38). A tagged result
 * instead of a throw, so the panel can show the server's own words. The Slack
 * URL goes out in a PUT body and is never read back: the server answers only
 * `configured`.
 */
export type DigestState = { schemaReady: boolean; enabled: boolean; canManage: boolean; channelConfigured?: boolean; needsReset?: boolean };
type Failed = { ok: false; status: number; error: string };

async function failure(res: Response): Promise<Failed> {
  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}` };
}

const NETWORK: Failed = { ok: false, status: 0, error: 'Could not reach the server' };

export async function fetchDigest(orgId: string): Promise<({ ok: true } & DigestState) | Failed> {
  try {
    const res = await fetch(`/api/org/${orgId}/digest`);
    return res.ok ? { ok: true, ...((await res.json()) as DigestState) } : await failure(res);
  } catch {
    return NETWORK;
  }
}

export async function setDigestEnabled(orgId: string, enabled: boolean): Promise<{ ok: true; enabled: boolean } | Failed> {
  try {
    const res = await fetch(`/api/org/${orgId}/digest`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
    return res.ok ? { ok: true, enabled } : await failure(res);
  } catch {
    return NETWORK;
  }
}

export async function saveSlackWebhook(orgId: string, url: string): Promise<{ ok: true; configured: true } | Failed> {
  try {
    const res = await fetch(`/api/org/${orgId}/digest/slack`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    return res.ok ? { ok: true, configured: true } : await failure(res);
  } catch {
    return NETWORK;
  }
}

export async function removeSlackWebhook(orgId: string): Promise<{ ok: true; configured: false } | Failed> {
  try {
    const res = await fetch(`/api/org/${orgId}/digest/slack`, { method: 'DELETE' });
    return res.ok ? { ok: true, configured: false } : await failure(res);
  } catch {
    return NETWORK;
  }
}
