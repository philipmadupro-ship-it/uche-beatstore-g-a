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
 *     the team and roster entries (./team-roster-client, shared with the Team
 *     page: roster artists, invitations, team logins, collaborators) and the
 *     first draft release (POST …/releases, for the roster artist). Each reports its own
 *     outcome; one failing does not stop the others, and the org stays a
 *     whole, normal org either way.
 */
import { releaseRequest, rosterNames, setupBodyFromDraft, type WizardDraft } from './setup-wizard';
import { errorOf, runFollowUp, runTeamRoster, send, type FetchLike, type StepResult } from './team-roster-client';
import type { FollowUp } from './team-roster';

export type { FetchLike, StepResult };

export type SetupRun =
  | { status: 'failed'; error: string }
  | { status: 'exists'; home: string }
  | { status: 'created'; home: string; orgId: string; results: StepResult[] };

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

  // Roster, people and collaborators: the same entries and the same runner as the Team page.
  // An independent artist's one roster artist was made with the org, so there is no roster to add.
  const team = await runTeamRoster(
    { artists: draft.face === 'label' ? draft.roster : [], people: draft.team, collaborators: draft.collaborators },
    fetchFn,
    { orgId, existingArtists: [] },
  );
  const results: StepResult[] = [...team.results];
  const artistIds = team.artistIds;

  const run = (f: FollowUp) => runFollowUp(fetchFn, base, f, results);

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
