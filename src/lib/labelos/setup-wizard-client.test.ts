import { describe, expect, it } from 'vitest';
import { runSetup, type FetchLike } from './setup-wizard-client';
import { emptyEntry, newDraft, withFace, type WizardDraft } from './setup-wizard';

const ORG = '22222222-2222-4222-8222-222222222222';

type Call = { url: string; method: string; body: unknown };

function server(handlers: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const key = `${call.method} ${url.replace(`/api/org/${ORG}`, '')}`;
    const h = handlers[key];
    const out = h ? h(call) : { status: 404, body: { error: `no handler ${key}` } };
    const status = out.status ?? 200;
    return { ok: status < 400, status, json: async () => out.body };
  };
  return { calls, fetchFn };
}

const created = { body: { org: { id: ORG, slug: 'x', kind: 'label' }, home: '/o/x', created: true }, status: 201 };

const label = (over: Partial<WizardDraft> = {}): WizardDraft => ({ ...withFace(newDraft(), 'label'), name: 'Northside', ...over });

describe('runSetup', () => {
  it('creates nothing and says why when the org request fails', async () => {
    const s = server({ 'POST /api/org/setup': () => ({ status: 409, body: { error: 'Nope' } }) });
    const run = await runSetup(label({ roster: [{ name: 'Nova', email: '' }] }), s.fetchFn);
    expect(run).toEqual({ status: 'failed', error: 'Nope' });
    expect(s.calls).toHaveLength(1);
  });

  it('a draft without a face or name never reaches the network', async () => {
    const s = server({});
    expect((await runSetup(newDraft(), s.fetchFn)).status).toBe('failed');
    expect(s.calls).toEqual([]);
  });

  it('an existing org is opened, not changed: nothing else is sent', async () => {
    const s = server({ 'POST /api/org/setup': () => ({ body: { org: { id: ORG }, home: '/o/x', created: false } }) });
    expect(await runSetup(label({ roster: [{ name: 'Nova', email: '' }] }), s.fetchFn)).toEqual({ status: 'exists', home: '/o/x' });
    expect(s.calls).toHaveLength(1);
  });

  it('sends the settings with the org and then roster, team and release in that order', async () => {
    const s = server({
      'POST /api/org/setup': () => created,
      'POST /contacts': (c) => ({ status: 201, body: { contact: { id: `id-${(c.body as { name: string }).name}` } } }),
      'POST /invitations': () => ({ status: 201, body: {} }),
      'POST /team-accounts': () => ({ status: 201, body: {} }),
      'POST /releases': () => ({ status: 201, body: {} }),
    });
    const draft = label({
      roster: [{ name: 'Nova', email: '' }, { name: 'Kai', email: 'k@x.test' }],
      team: [
        { ...emptyEntry(), email: 'm@x.test', fn: 'marketing' },
        { ...emptyEntry(), email: 'l@x.test', fn: 'legal', mode: 'login', name: 'Lee', password: 'a-good-password-1' },
      ],
      release: { enabled: true, title: 'First', type: 'ep', artistIndex: 1 },
    });
    const run = await runSetup(draft, s.fetchFn);
    expect(s.calls.map((c) => `${c.method} ${c.url.replace(`/api/org/${ORG}`, '')}`)).toEqual([
      'POST /api/org/setup', 'POST /contacts', 'POST /contacts', 'POST /invitations', 'POST /team-accounts', 'POST /releases',
    ]);
    expect(s.calls[0].body).toMatchObject({ face: 'label', name: 'Northside', settings: { legal_gate: 'on', departments_off: [] } });
    expect(s.calls[5].body).toEqual({ title: 'First', type: 'ep', contact_id: 'id-Kai' });
    expect(run).toMatchObject({ status: 'created', home: '/o/x', orgId: ORG });
    if (run.status === 'created') expect(run.results.every((r) => r.ok)).toBe(true);
  });

  it('one failure is reported on its own line and does not stop the rest', async () => {
    const s = server({
      'POST /api/org/setup': () => created,
      'POST /contacts': () => ({ status: 409, body: { error: 'That email is already in the directory.' } }),
      'POST /invitations': () => ({ status: 201, body: {} }),
    });
    const run = await runSetup(
      label({ roster: [{ name: 'Nova', email: 'n@x.test' }], team: [{ ...emptyEntry(), email: 'm@x.test', fn: 'marketing' }], release: { enabled: true, title: 'First', type: 'single', artistIndex: 0 } }),
      s.fetchFn,
    );
    if (run.status !== 'created') throw new Error('expected created');
    expect(run.results.map((r) => [r.kind, r.ok])).toEqual([['roster', false], ['invitation', true], ['release', false]]);
    expect(run.results[0].message).toBe('That email is already in the directory.');
    expect(run.results[0].fixIn).toBe('the roster');
    // The release did not go out against a guessed artist.
    expect(s.calls.some((c) => c.url.endsWith('/releases'))).toBe(false);
  });

  it('an independent artist\'s release goes to the roster artist made with the org', async () => {
    const s = server({
      'POST /api/org/setup': () => ({ status: 201, body: { org: { id: ORG, slug: 'n', kind: 'artist' }, home: '/o/n', created: true } }),
      'GET /contacts?view=roster': () => ({ body: { contacts: [{ id: 'self' }] } }),
      'POST /releases': () => ({ status: 201, body: {} }),
    });
    const draft = { ...withFace(newDraft(), 'independent'), name: 'Nova', release: { enabled: true, title: 'Debut', type: 'single' as const, artistIndex: 0 } };
    await runSetup(draft, s.fetchFn);
    expect(s.calls[2].body).toEqual({ title: 'Debut', type: 'single', contact_id: 'self' });
  });

  it('a created login carries the password it was made with, for the done screen to show once; an invitation and a failed login carry none', async () => {
    const s = server({
      'POST /api/org/setup': () => created,
      'POST /invitations': () => ({ status: 201, body: {} }),
      'POST /team-accounts': (c) => ((c.body as { name: string }).name === 'Lee' ? { status: 201, body: {} } : { status: 409, body: { error: 'taken' } }),
    });
    const run = await runSetup(
      label({
        team: [
          { ...emptyEntry(), email: 'm@x.test', fn: 'marketing' },
          { ...emptyEntry(), email: 'l@x.test', fn: 'legal', mode: 'login', name: 'Lee', password: 'a-good-password-1' },
          { ...emptyEntry(), email: 'k@x.test', fn: 'legal', mode: 'login', name: 'Kim', password: 'another-good-pass-2' },
        ],
      }),
      s.fetchFn,
    );
    if (run.status !== 'created') throw new Error('expected created');
    expect(run.results.map((r) => r.password)).toEqual([undefined, 'a-good-password-1', undefined]);
  });

  it('a network error is a line, not a throw', async () => {
    let n = 0;
    const fetchFn: FetchLike = async () => {
      if (n++ === 0) return { ok: true, status: 201, json: async () => created.body };
      throw new Error('offline');
    };
    const run = await runSetup(label({ team: [{ ...emptyEntry(), email: 'm@x.test', fn: 'marketing' }] }), fetchFn);
    if (run.status !== 'created') throw new Error('expected created');
    expect(run.results[0]).toMatchObject({ ok: false, message: 'Could not reach the server.' });
  });
});
