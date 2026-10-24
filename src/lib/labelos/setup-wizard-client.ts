/**
 * Runs the last step of the setup wizard (LABEL-48) against the real routes.
 * Pure of React and of the DOM: `fetch` is injected, so the sequence, the
 * failure handling and the order are unit-tested (setup-wizard-client.test).
 *
 *  1. POST /api/org/setup — the org, its owner and its settings, one
 *     transaction. If this fails NOTHING exists and the draft stays as it
 *     was. If it answers `created: false` the account already has an org: the
 *     draft is not applied to it (settings are not an edit) and the caller
 *     just opens it.
 *  2. Then, each through the route that owns the rule, one at a time:
 *     roster artists (POST …/contacts), invitations and team logins
 *     (POST …/invitations, …/team-accounts) and the first draft release
 *     (POST …/releases, for the roster artist). Each reports its own
 *     outcome; one failing does not stop the others, and the org stays a
 *     whole, normal org either way.
 */
import {
  releaseRequest,
  rosterNames,
  rosterRequests,
  setupBodyFromDraft,
  teamRequests,
  type FollowUp,
  type FollowUpKind,
  type WizardDraft,
} from './setup-wizard';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type StepResult = {
  kind: FollowUpKind;
  label: string;
  ok: boolean;
  message: string;
  fixIn: string;
  /** A login that was created: the password the creator chose, for the done screen to show ONCE (React state only, never saved). */
  password?: string;
};

export type SetupRun =
  | { status: 'failed'; error: string }
  | { status: 'exists'; home: string }
  | { status: 'created'; home: string; orgId: string; results: StepResult[] };

const JSON_HEADERS = { 'content-type': 'application/json' };

async function send(fetchFn: FetchLike, url: string, method: string, body?: unknown) {
  try {
    const res = await fetchFn(url, { method, headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server.' } as Record<string, unknown> };
  }
}

function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === 'string' && data.error ? data.error : fallback;
}

const DONE: Record<FollowUpKind, string> = {
  roster: 'Added to the roster',
  invitation: 'Invitation sent',
  login: 'Login created. They are asked to choose their own password on first sign-in.',
  release: 'Draft release created',
};

function idOf(data: Record<string, unknown>, key: string): string | null {
  const row = data[key];
  if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') return (row as { id: string }).id;
  return null;
}

export async function runSetup(draft: WizardDraft, fetchFn: FetchLike): Promise<SetupRun> {
  const body = setupBodyFromDraft(draft);
  if (!body) return { status: 'failed', error: 'Choose what kind of account this is and give it a name.' };

  const made = await send(fetchFn, '/api/org/setup', 'POST', body);
  const org = made.data.org as { id?: unknown } | undefined;
  const home = typeof made.data.home === 'string' ? made.data.home : null;
  if (!made.ok || !home || typeof org?.id !== 'string') {
    return { status: 'failed', error: errorOf(made.data, 'Could not set up the organization. Try again.') };
  }
  if (made.data.created !== true) return { status: 'exists', home };

  const orgId = org.id;
  const base = `/api/org/${orgId}`;
  const results: StepResult[] = [];
  const run = async (f: FollowUp) => {
    const r = await send(fetchFn, `${base}${f.path}`, f.method, f.body);
    results.push({
      kind: f.kind,
      label: f.label,
      ok: r.ok,
      message: r.ok ? DONE[f.kind] : errorOf(r.data, `Could not do this (${r.status || 'no connection'}).`),
      fixIn: f.fixIn,
      ...(r.ok && f.kind === 'login' && typeof f.body.password === 'string' ? { password: f.body.password } : {}),
    });
    return r;
  };

  // Roster first: the release below is for one of these artists.
  const artistIds = new Map<string, string>();
  for (const f of rosterRequests(draft)) {
    const r = await run(f);
    const id = r.ok ? idOf(r.data, 'contact') : null;
    if (id) artistIds.set(f.label, id);
  }
  for (const f of teamRequests(draft)) await run(f);

  if (draft.release.enabled && draft.release.title.trim()) {
    let contactId: string | null = null;
    if (draft.face === 'label') {
      const name = rosterNames(draft)[draft.release.artistIndex];
      contactId = (name && artistIds.get(name)) || null;
    } else {
      // An independent artist's one roster artist was made with the org.
      const roster = await send(fetchFn, `${base}/contacts?view=roster`, 'GET');
      const first = Array.isArray(roster.data.contacts) ? (roster.data.contacts[0] as { id?: unknown } | undefined) : undefined;
      contactId = typeof first?.id === 'string' ? first.id : null;
    }
    const request = contactId ? releaseRequest(draft, contactId) : null;
    if (request) await run(request);
    else {
      results.push({
        kind: 'release',
        label: draft.release.title.trim(),
        ok: false,
        message: 'The artist for this release was not available, so it was not created.',
        fixIn: 'Releases',
      });
    }
  }

  return { status: 'created', home, orgId, results };
}
