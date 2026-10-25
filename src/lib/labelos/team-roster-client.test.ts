import { describe, expect, it } from 'vitest';
import { runTeamRoster } from './team-roster-client';
import type { FetchLike } from './team-roster-client';
import { emptyCollaborator, emptyPerson, type TeamRosterEntries } from './team-roster';

const ORG = '22222222-2222-4222-8222-222222222222';
const EXISTING = '33333333-3333-4333-8333-333333333333';
type Call = { url: string; method: string; body: Record<string, unknown> };

function server(handlers: Record<string, (c: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : {} };
    calls.push(call);
    const out = handlers[`${call.method} ${url.replace(`/api/org/${ORG}`, '')}`]?.(call) ?? { status: 404, body: { error: 'no handler' } };
    const status = out.status ?? 200;
    return { ok: status < 400, status, json: async () => out.body };
  };
  return { calls, fetchFn };
}

const contact = (c: Call) => ({ status: 201, body: { contact: { id: `id-${c.body.name as string}` } } });
const ok = { status: 201, body: {} };
const entries = (e: Partial<TeamRosterEntries>): TeamRosterEntries => ({ artists: [], people: [], collaborators: [], ...e });

describe('runTeamRoster', () => {
  it('creates artists first so a limited member and an artist login can point at them', async () => {
    const s = server({ 'POST /contacts': contact, 'POST /invitations': () => ok });
    const run = await runTeamRoster(
      entries({
        artists: [{ name: 'Nova', email: 'n@x.test', invite: true }],
        people: [{ ...emptyPerson(), email: 'a@x.test', fn: 'a_and_r', scope: 'artists', artists: ['Nova', EXISTING] }],
      }),
      s.fetchFn,
      { orgId: ORG, existingArtists: [EXISTING] },
    );
    expect(s.calls.map((c) => `${c.method} ${c.url.replace(`/api/org/${ORG}`, '')}`)).toEqual(['POST /contacts', 'POST /invitations', 'POST /invitations']);
    expect(s.calls[1].body).toMatchObject({ role: 'artist', contact_ids: ['id-Nova'] });
    expect(s.calls[2].body).toMatchObject({ role: 'member', contact_ids: ['id-Nova', EXISTING] });
    expect(run.results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(run.artistIds.get('Nova')).toBe('id-Nova');
  });

  it('a failed artist does not stop the others, and its login is not sent unscoped', async () => {
    const s = server({
      'POST /contacts': (c) => (c.body.name === 'Nova' ? { status: 409, body: { error: 'Artist limit reached' } } : contact(c)),
      'POST /invitations': () => ok,
    });
    const run = await runTeamRoster(
      entries({
        artists: [{ name: 'Nova', email: 'n@x.test', invite: true }, { name: 'Kai', email: '' }],
        people: [{ ...emptyPerson(), email: 'a@x.test', fn: 'legal', scope: 'artists', artists: ['Nova'] }],
      }),
      s.fetchFn,
      { orgId: ORG, existingArtists: [] },
    );
    expect(run.results.find((r) => r.label === 'Nova')).toMatchObject({ ok: false, message: 'Artist limit reached' });
    expect(run.results.find((r) => r.label === 'Kai')?.ok).toBe(true);
    expect(s.calls.filter((c) => c.url.endsWith('/invitations'))).toEqual([]);
    expect(run.results.find((r) => r.label === 'a@x.test')).toMatchObject({ ok: false });
    expect(run.results.find((r) => r.label === 'a@x.test')?.message).toMatch(/artist/i);
  });

  it('hands a created login password back once, for the screen to show', async () => {
    const s = server({ 'POST /team-accounts': () => ok });
    const run = await runTeamRoster(
      entries({ people: [{ ...emptyPerson(), email: 'l@x.test', fn: 'legal', mode: 'login', name: 'Lee', password: 'a-good-password-1' }] }),
      s.fetchFn,
      { orgId: ORG, existingArtists: [] },
    );
    expect(run.results[0]).toMatchObject({ kind: 'login', ok: true, password: 'a-good-password-1' });
  });

  it('a collaborator is a contact, and an invitation to its project only when the contact was made', async () => {
    const P = '44444444-4444-4444-8444-444444444444';
    const s = server({ 'POST /contacts': contact, [`POST /projects/${P}/members`]: () => ok });
    const run = await runTeamRoster(
      entries({ collaborators: [{ ...emptyCollaborator(), name: 'Kai', email: 'k@x.test', projectId: P, projectRole: 'editor' }] }),
      s.fetchFn,
      { orgId: ORG, existingArtists: [] },
    );
    expect(s.calls.map((c) => c.url.replace(`/api/org/${ORG}`, ''))).toEqual(['/contacts', `/projects/${P}/members`]);
    expect(run.results.map((r) => r.kind)).toEqual(['collaborator', 'project_invite']);

    const failing = server({ 'POST /contacts': () => ({ status: 409, body: { error: 'Someone with this email is already in the directory.' } }) });
    const second = await runTeamRoster(
      entries({ collaborators: [{ ...emptyCollaborator(), name: 'Kai', email: 'k@x.test', projectId: P }] }),
      failing.fetchFn,
      { orgId: ORG, existingArtists: [] },
    );
    expect(failing.calls).toHaveLength(1);
    expect(second.results).toHaveLength(1);
    expect(second.results[0].ok).toBe(false);
  });

  it('a network failure is a result, not an exception', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('offline');
    };
    const run = await runTeamRoster(entries({ artists: [{ name: 'Nova', email: '' }] }), fetchFn, { orgId: ORG, existingArtists: [] });
    expect(run.results[0]).toMatchObject({ ok: false, message: 'Could not reach the server.' });
  });

  it('an invitation whose email did not go out does not read as sent', async () => {
    const s = server({ 'POST /invitations': () => ({ status: 201, body: { emailSent: false } }) });
    const run = await runTeamRoster(entries({ people: [{ ...emptyPerson(), email: 'a@x.test', fn: 'legal' }] }), s.fetchFn, { orgId: ORG, existingArtists: [] });
    expect(run.results[0]).toMatchObject({ ok: true });
    expect(run.results[0].message).toMatch(/email could not be sent/);
    expect(run.failed.people).toEqual([]);
  });

  it('what did not go through comes back for another try; what did does not', async () => {
    const s = server({
      'POST /contacts': (c) => (c.body.name === 'Nova' ? { status: 409, body: { error: 'x' } } : contact(c)),
      'POST /invitations': () => ok,
    });
    const nova = { name: 'Nova', email: 'n@x.test', invite: true };
    const run = await runTeamRoster(
      entries({ artists: [nova, { name: 'Kai', email: '' }], people: [{ ...emptyPerson(), email: 'a@x.test', fn: 'legal' }] }),
      s.fetchFn,
      { orgId: ORG, existingArtists: [] },
    );
    expect(run.failed.artists).toEqual([nova]);
    expect(run.failed.people).toEqual([]);
    // The login the failed artist asked for says why it was not sent.
    expect(run.results.find((r) => r.label === 'n@x.test')?.message).toMatch(/was not added/);
  });

  it('a member is never sent with fewer artists than they were given', async () => {
    const s = server({
      'POST /contacts': (c) => (c.body.name === 'Kai' ? { status: 409, body: { error: 'x' } } : contact(c)),
      'POST /invitations': () => ok,
    });
    const person = { ...emptyPerson(), email: 'a@x.test', fn: 'legal' as const, scope: 'artists' as const, artists: ['Nova', 'Kai'] };
    const run = await runTeamRoster(entries({ artists: [{ name: 'Nova', email: '' }, { name: 'Kai', email: '' }], people: [person] }), s.fetchFn, { orgId: ORG, existingArtists: [] });
    expect(s.calls.some((c) => c.url.endsWith('/invitations'))).toBe(false);
    expect(run.failed.people).toEqual([person]);
  });

  it('a 2xx without a contact id still counts as created: the entry is not offered for retry (it would duplicate the artist)', async () => {
    const s = server({ 'POST /contacts': () => ({ status: 201, body: {} }) });
    const run = await runTeamRoster(entries({ artists: [{ name: 'Nova', email: 'n@x.test', invite: true }] }), s.fetchFn, { orgId: ORG, existingArtists: [] });
    expect(run.failed.artists).toEqual([]);
    expect(run.results[0].ok).toBe(true);
    expect(run.results[1]).toMatchObject({ ok: false });
    expect(run.results[1].message).toMatch(/was added, but/);
  });
});
