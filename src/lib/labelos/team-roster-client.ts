/**
 * Runs the entries of the "Team and roster" window (LABEL-50) against the real
 * routes, for both places that use it: the setup wizard (after the org exists)
 * and the Team page (live). `fetch` is injected so the order and the failure
 * handling are unit-tested without a server.
 *
 * Order matters: artists first (a limited member and an artist login point at
 * them), then people, then collaborators. Each request reports its own
 * outcome; one failing never stops the others. A person limited to artists
 * whose artists were not created is reported and NOT sent — an invitation
 * with no artists would be read by the server as the whole organization.
 */
import {
  artistRequests,
  collaboratorRequests,
  personRequest,
  type FollowUp,
  type FollowUpKind,
  type TeamRosterEntries,
} from './team-roster';

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
  /** A login that was created: the password the creator chose, for the screen to show ONCE (React state only, never saved). */
  password?: string;
};

const JSON_HEADERS = { 'content-type': 'application/json' };

export async function send(fetchFn: FetchLike, url: string, method: string, body?: unknown) {
  try {
    const res = await fetchFn(url, { method, headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server.' } as Record<string, unknown> };
  }
}

export function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === 'string' && data.error ? data.error : fallback;
}

export function idOf(data: Record<string, unknown>, key: string): string | null {
  const row = data[key];
  if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') return (row as { id: string }).id;
  return null;
}

export const DONE: Record<FollowUpKind, string> = {
  roster: 'Added to the roster',
  invitation: 'Invitation sent',
  login: 'Login created. They are asked to choose their own password on first sign-in.',
  release: 'Draft release created',
  collaborator: 'Added as a collaborator',
  project_invite: 'Invited to the project',
};

export type RunOptions = {
  orgId: string;
  /** Roster contact ids that already exist, which a limited member may be pointed at. */
  existingArtists: readonly string[];
};

export type TeamRosterRun = {
  results: StepResult[];
  /** Artist name → contact id, for the artists created by this run. */
  artistIds: Map<string, string>;
};

export async function runTeamRoster(entries: TeamRosterEntries, fetchFn: FetchLike, opts: RunOptions): Promise<TeamRosterRun> {
  const base = `/api/org/${opts.orgId}`;
  const results: StepResult[] = [];
  const artistIds = new Map<string, string>();
  const existing = new Set(opts.existingArtists);

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

  for (const entry of entries.artists) {
    const name = entry.name.trim();
    const [contactRequest] = artistRequests(entry);
    if (!contactRequest) continue;
    const r = await run(contactRequest);
    const id = r.ok ? idOf(r.data, 'contact') : null;
    if (id) artistIds.set(name, id);
    const [, invite] = artistRequests(entry, () => id);
    if (invite) await run(invite);
  }

  const resolveArtist = (key: string): string | null => artistIds.get(key.trim()) ?? (existing.has(key) ? key : null);
  for (const person of entries.people) {
    const request = personRequest(person, resolveArtist);
    if (request) {
      await run(request);
    } else if (person.email.trim()) {
      results.push({
        kind: person.mode === 'login' ? 'login' : 'invitation',
        label: person.email.trim(),
        ok: false,
        message: 'The artists they were to see were not available, so nobody was added. Add them from Team.',
        fixIn: 'Team → Add member',
      });
    }
  }

  for (const entry of entries.collaborators) {
    const [contactRequest] = collaboratorRequests(entry);
    if (!contactRequest) continue;
    const r = await run(contactRequest);
    if (!r.ok) continue;
    const [, invite] = collaboratorRequests(entry);
    if (invite) await run(invite);
  }

  return { results, artistIds };
}
