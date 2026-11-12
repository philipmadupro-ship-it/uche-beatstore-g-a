/**
 * The browser's side of the artistic direction workspace (LABEL-68): fetch the workspace, read and switch the optional
 * creative approval gate. Pure of React; says what happened in words a toast can show.
 */
import type { CreativeWorkspace } from './creative-workspace';

export async function fetchCreativeWorkspace(orgId: string): Promise<CreativeWorkspace | null> {
  try {
    const res = await fetch(`/api/org/${orgId}/creative`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as CreativeWorkspace;
  } catch {
    return null;
  }
}

/** null = the switch is not available here (not the owner, or no artistic department); otherwise where it stands. */
export async function fetchCreativeGate(orgId: string): Promise<{ enabled: boolean } | null> {
  try {
    const res = await fetch(`/api/org/${orgId}/settings/creative-gate`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { enabled?: boolean };
    return { enabled: body.enabled === true };
  } catch {
    return null;
  }
}

export type GateSwitchResult = { ok: true; enabled: boolean } | { ok: false; error: string };

export async function putCreativeGate(orgId: string, enabled: boolean): Promise<GateSwitchResult> {
  try {
    const res = await fetch(`/api/org/${orgId}/settings/creative-gate`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; enabled?: boolean };
    if (!res.ok) return { ok: false, error: body.error ?? 'Could not save the setting.' };
    return { ok: true, enabled: body.enabled === true };
  } catch {
    return { ok: false, error: 'Could not reach the server. Try again.' };
  }
}
